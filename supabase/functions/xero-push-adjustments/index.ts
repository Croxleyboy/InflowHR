import { getSupabase, getValidXeroToken, corsHeaders, json } from '../_shared/xero.ts'

const XERO_PAYROLL_UK = 'https://api.xero.com/payroll.xro/1.0'

function sanitise(raw: string): string {
  return raw.slice(0, 500).replace(/[<>"'&]/g, '')
}

interface Adjustment {
  overtime: { employee_id: string; hours: number; multiplier: number }[]
  unpaid_leave: { employee_id: string; days: number }[]
  benefit_changes: { employee_id: string; benefit: string; monthly_cost: number }[]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const sb = getSupabase()

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Unauthorized' }, 401)
    const { data: { user }, error: authErr } = await sb.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

    const { company_id, pay_run_id, adjustments } = await req.json() as {
      company_id: string
      pay_run_id: string
      adjustments: Adjustment
    }
    if (!company_id) return json({ error: 'company_id required' }, 400)
    if (!pay_run_id) return json({ error: 'pay_run_id required' }, 400)
    if (!adjustments) return json({ error: 'adjustments required' }, 400)

    const { data: cu } = await sb
      .from('company_users')
      .select('role')
      .eq('auth_user_id', user.id)
      .eq('company_id', company_id)
      .eq('is_active', true)
      .maybeSingle()
    if (!cu || (cu.role !== 'admin' && cu.role !== 'hr')) return json({ error: 'Access denied' }, 403)

    const creds = await getValidXeroToken(company_id)
    if (!creds) return json({ error: 'Xero not connected — please connect first' }, 400)

    const xeroHeaders = {
      Authorization: `Bearer ${creds.accessToken}`,
      'xero-tenant-id': creds.tenantId,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }

    // Collect all employee IDs from adjustments
    const allEmpIds = new Set<string>()
    for (const a of adjustments.overtime) allEmpIds.add(a.employee_id)
    for (const a of adjustments.unpaid_leave) allEmpIds.add(a.employee_id)
    for (const a of adjustments.benefit_changes) allEmpIds.add(a.employee_id)

    if (allEmpIds.size === 0) return json({ error: 'No adjustments to push' }, 400)

    // Load employees with xero_employee_id and hourly_rate
    const { data: employees } = await sb
      .from('employees')
      .select('id, first_name, last_name, xero_employee_id, hourly_rate, annual_salary')
      .in('id', [...allEmpIds])

    const empMap: Record<string, {
      xeroId: string | null
      name: string
      hourlyRate: number
      annualSalary: number
    }> = {}
    for (const e of (employees || [])) {
      empMap[e.id] = {
        xeroId: e.xero_employee_id,
        name: `${e.first_name} ${e.last_name}`,
        hourlyRate: e.hourly_rate || 0,
        annualSalary: e.annual_salary || 0,
      }
    }

    // Get the pay run period from our DB
    const { data: payRun } = await sb
      .from('pay_runs')
      .select('period_start, period_end')
      .eq('id', pay_run_id)
      .single()
    if (!payRun) return json({ error: 'Pay run not found' }, 404)

    // Fetch earning rates and deduction types from Xero to map adjustments
    const earningsRates = await fetchXeroRates(xeroHeaders, 'EarningsRates')
    const deductionTypes = await fetchXeroRates(xeroHeaders, 'DeductionTypes')

    // Find or auto-detect the relevant Xero pay item IDs
    const overtimeRateId = findRateId(earningsRates, ['OVERTIME', 'OVERTIMEEARNINGS', 'OT'])
    const unpaidLeaveDeductionId = findRateId(deductionTypes, ['UNPAID', 'UNPAIDLEAVE', 'LEAVE WITHOUT PAY'])
    const defaultEarningsId = findRateId(earningsRates, ['ORDINARY', 'REGULAR', 'STANDARD', 'ORDINARYTIMEEARNINGS'])

    // Get or create a draft pay run in Xero for this period
    const payrollCalendarId = await getPayrollCalendarId(sb, company_id, xeroHeaders)
    if (!payrollCalendarId) {
      return json({ error: 'No payroll calendar found in Xero. Please set one up in Xero first.' }, 400)
    }

    // Find an existing draft pay run in Xero for this period, or create one
    const xeroPayRun = await findOrCreateXeroPayRun(
      xeroHeaders, payrollCalendarId, payRun.period_start, payRun.period_end
    )
    if (!xeroPayRun) {
      return json({ error: 'Could not find or create a pay run in Xero for this period. Create one manually in Xero first.' }, 400)
    }

    // Get payslip stubs from the pay run — these map employees to PayslipIDs
    const payslipStubs = await getPayslipStubs(xeroHeaders, xeroPayRun.PayRunID)

    const results: { employee: string; status: string; lines: number; error?: string }[] = []
    const skipped: { employee: string; reason: string }[] = []

    // Group adjustments by employee
    const empAdjustments: Record<string, {
      overtimeHours: number
      overtimeMultiplier: number
      unpaidLeaveDays: number
      benefitChanges: { benefit: string; monthlyCost: number }[]
    }> = {}

    for (const ot of adjustments.overtime) {
      if (!empAdjustments[ot.employee_id]) empAdjustments[ot.employee_id] = { overtimeHours: 0, overtimeMultiplier: 1.5, unpaidLeaveDays: 0, benefitChanges: [] }
      empAdjustments[ot.employee_id].overtimeHours += ot.hours
      empAdjustments[ot.employee_id].overtimeMultiplier = ot.multiplier
    }
    for (const ul of adjustments.unpaid_leave) {
      if (!empAdjustments[ul.employee_id]) empAdjustments[ul.employee_id] = { overtimeHours: 0, overtimeMultiplier: 1.5, unpaidLeaveDays: 0, benefitChanges: [] }
      empAdjustments[ul.employee_id].unpaidLeaveDays += ul.days
    }
    for (const bc of adjustments.benefit_changes) {
      if (!empAdjustments[bc.employee_id]) empAdjustments[bc.employee_id] = { overtimeHours: 0, overtimeMultiplier: 1.5, unpaidLeaveDays: 0, benefitChanges: [] }
      empAdjustments[bc.employee_id].benefitChanges.push({ benefit: bc.benefit, monthlyCost: bc.monthly_cost })
    }

    // Push adjustment lines to each employee's payslip
    for (const [empId, adj] of Object.entries(empAdjustments)) {
      const emp = empMap[empId]
      if (!emp) { skipped.push({ employee: empId, reason: 'Employee not found' }); continue }
      if (!emp.xeroId) { skipped.push({ employee: emp.name, reason: 'No Xero employee mapping — sync employees first' }); continue }

      // Find this employee's payslip stub in the Xero pay run
      const stub = payslipStubs.find(s =>
        (s.EmployeeID || s.employeeID) === emp.xeroId
      )
      if (!stub) {
        skipped.push({ employee: emp.name, reason: 'Employee not found in Xero pay run — they may not be assigned to this payroll calendar' })
        continue
      }

      const payslipId = stub.PayslipID || stub.payslipID
      if (!payslipId) {
        skipped.push({ employee: emp.name, reason: 'No PayslipID found for employee in pay run' })
        continue
      }

      // Build earnings and deduction lines
      const earningsLines: Record<string, unknown>[] = []
      const deductionLines: Record<string, unknown>[] = []

      // Overtime: hours × rate × multiplier as an earnings line
      if (adj.overtimeHours > 0) {
        const rateId = overtimeRateId || defaultEarningsId
        if (rateId) {
          earningsLines.push({
            EarningsRateID: rateId,
            RatePerUnit: emp.hourlyRate > 0
              ? Math.round(emp.hourlyRate * adj.overtimeMultiplier * 100) / 100
              : undefined,
            NumberOfUnits: adj.overtimeHours,
          })
        } else {
          skipped.push({ employee: emp.name, reason: 'No overtime or default earnings rate found in Xero' })
          continue
        }
      }

      // Unpaid leave: deduction of daily rate × days
      if (adj.unpaidLeaveDays > 0) {
        const dailyRate = emp.annualSalary > 0 ? Math.round(emp.annualSalary / 260 * 100) / 100 : 0
        const amount = Math.round(dailyRate * adj.unpaidLeaveDays * 100) / 100
        if (unpaidLeaveDeductionId && amount > 0) {
          deductionLines.push({
            DeductionTypeID: unpaidLeaveDeductionId,
            Amount: amount,
          })
        } else if (amount > 0) {
          earningsLines.push({
            EarningsRateID: defaultEarningsId,
            RatePerUnit: -dailyRate,
            NumberOfUnits: adj.unpaidLeaveDays,
          })
        }
      }

      // Benefit changes: add or deduct based on monthly cost
      for (const bc of adj.benefitChanges) {
        if (bc.monthlyCost > 0) {
          if (defaultEarningsId) {
            earningsLines.push({
              EarningsRateID: defaultEarningsId,
              RatePerUnit: bc.monthlyCost,
              NumberOfUnits: 1,
            })
          }
        } else if (bc.monthlyCost < 0) {
          const firstDeduction = deductionTypes[0]
          const dedId = firstDeduction ? (firstDeduction.DeductionTypeID || firstDeduction.deductionTypeID) : null
          if (dedId) {
            deductionLines.push({
              DeductionTypeID: dedId,
              Amount: Math.abs(bc.monthlyCost),
            })
          }
        }
      }

      if (earningsLines.length === 0 && deductionLines.length === 0) {
        skipped.push({ employee: emp.name, reason: 'No adjustment lines to push' })
        continue
      }

      // Update the payslip with adjustment lines
      const payslipPayload: Record<string, unknown> = { PayslipID: payslipId }
      if (earningsLines.length > 0) payslipPayload.EarningsLines = earningsLines
      if (deductionLines.length > 0) payslipPayload.DeductionLines = deductionLines

      const psRes = await fetch(`${XERO_PAYROLL_UK}/Payslips/${payslipId}`, {
        method: 'POST',
        headers: xeroHeaders,
        body: JSON.stringify(payslipPayload),
      })

      if (!psRes.ok) {
        const errText = await psRes.text()
        results.push({ employee: emp.name, status: 'failed', lines: 0, error: sanitise(errText) })
        continue
      }

      results.push({
        employee: emp.name,
        status: 'updated',
        lines: earningsLines.length + deductionLines.length,
      })
    }

    const successCount = results.filter(r => r.status === 'updated').length
    const failedCount = results.filter(r => r.status === 'failed').length

    // GDPR audit log
    const auditDetail = `Xero payslip adjustment push — Pay run: ${pay_run_id}. ` +
      `Updated: ${successCount}, Failed: ${failedCount}, Skipped: ${skipped.length}. ` +
      `Data sent: overtime hours/rates, unpaid leave deductions, benefit adjustment amounts.`
    await sb.from('payroll_audit_log').insert({
      company_id,
      user_id: user.id,
      action: 'Xero Adjustment Push',
      detail: auditDetail,
      status: failedCount > 0 && successCount === 0 ? 'error' : 'success',
    })

    return json({
      xero_pay_run_id: xeroPayRun.PayRunID,
      pushed: successCount,
      failed: failedCount,
      skipped: skipped.length,
      results,
      skipped_details: skipped,
    })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
})

// Helper: fetch Xero pay item rates (EarningsRates or DeductionTypes)
async function fetchXeroRates(
  headers: Record<string, string>,
  endpoint: string
): Promise<Record<string, unknown>[]> {
  // Try direct endpoint first
  const res = await fetch(`${XERO_PAYROLL_UK}/${endpoint}`, { headers })
  if (res.ok) {
    const body = await res.json()
    return body[endpoint] || body[endpoint.charAt(0).toLowerCase() + endpoint.slice(1)] || []
  }
  // Fallback: PayItems wrapper (some Xero setups)
  const piRes = await fetch(`${XERO_PAYROLL_UK}/PayItems`, { headers })
  if (piRes.ok) {
    const piBody = await piRes.json()
    const payItems = piBody.PayItems || piBody.payItems || {}
    return payItems[endpoint] || payItems[endpoint.charAt(0).toLowerCase() + endpoint.slice(1)] || []
  }
  return []
}

// Helper: find a rate ID by keyword matching on name/type
function findRateId(
  rates: Record<string, unknown>[],
  keywords: string[]
): string | undefined {
  for (const r of rates) {
    const name = ((r.Name || r.name || '') as string).toUpperCase()
    const etype = ((r.EarningsType || r.earningsType || r.DeductionType || r.deductionType || '') as string).toUpperCase()
    for (const kw of keywords) {
      if (name.includes(kw) || etype.includes(kw)) {
        return (r.EarningsRateID || r.earningsRateID || r.DeductionTypeID || r.deductionTypeID) as string
      }
    }
  }
  return undefined
}

// Helper: get or fetch the payroll calendar ID
async function getPayrollCalendarId(
  sb: ReturnType<typeof getSupabase>,
  companyId: string,
  headers: Record<string, string>
): Promise<string | null> {
  const { data } = await sb
    .from('xero_integrations')
    .select('payroll_calendar_id')
    .eq('company_id', companyId)
    .single()

  if (data?.payroll_calendar_id) return data.payroll_calendar_id

  const calRes = await fetch(`${XERO_PAYROLL_UK}/PayrollCalendars`, { headers })
  if (!calRes.ok) return null
  const calBody = await calRes.json()
  const calendars = calBody.PayrollCalendars || calBody.payrollCalendars || []
  if (!calendars.length) return null

  const calId = calendars[0].PayrollCalendarID || calendars[0].payrollCalendarID
  if (calId) {
    await sb.from('xero_integrations').update({ payroll_calendar_id: calId }).eq('company_id', companyId)
  }
  return calId || null
}

// Helper: find an existing draft pay run or create one
async function findOrCreateXeroPayRun(
  headers: Record<string, string>,
  payrollCalendarId: string,
  periodStart: string,
  periodEnd: string
): Promise<{ PayRunID: string; PayRunStatus: string } | null> {
  // List pay runs and look for a Draft one covering this period
  const listRes = await fetch(`${XERO_PAYROLL_UK}/PayRuns`, { headers })
  if (!listRes.ok) return null

  const listBody = await listRes.json()
  const payRuns = listBody.PayRuns || listBody.payRuns || []

  // Xero dates come as /Date(epoch)/ strings — parse them
  for (const pr of payRuns) {
    const status = pr.PayRunStatus || pr.payRunStatus || ''
    if (status !== 'Draft' && status !== 'DRAFT') continue

    const prStart = parseXeroDate(pr.PeriodStartDate || pr.periodStartDate)
    const prEnd = parseXeroDate(pr.PeriodEndDate || pr.periodEndDate)
    if (!prStart || !prEnd) continue

    if (prStart <= periodStart && prEnd >= periodEnd) {
      return { PayRunID: pr.PayRunID || pr.payRunID, PayRunStatus: status }
    }
  }

  // No existing draft — create one
  const createRes = await fetch(`${XERO_PAYROLL_UK}/PayRuns`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      PayrollCalendarID: payrollCalendarId,
      PayRunPeriodStartDate: periodStart,
      PayRunPeriodEndDate: periodEnd,
    }),
  })

  if (!createRes.ok) return null

  const createBody = await createRes.json()
  const created = createBody.PayRuns?.[0] || createBody.payRuns?.[0] || createBody.PayRun || createBody.payRun
  if (!created) return null
  return { PayRunID: created.PayRunID || created.payRunID, PayRunStatus: 'Draft' }
}

// Helper: get payslip stubs from a Xero pay run
async function getPayslipStubs(
  headers: Record<string, string>,
  payRunId: string
): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${XERO_PAYROLL_UK}/PayRuns/${payRunId}`, { headers })
  if (!res.ok) return []
  const body = await res.json()
  const payRun = body.PayRuns?.[0] || body.payRuns?.[0] || body.PayRun || body.payRun
  if (!payRun) return []
  return payRun.Payslips || payRun.payslips || []
}

// Parse Xero's /Date(epoch)/ format to YYYY-MM-DD
function parseXeroDate(val: unknown): string | null {
  if (!val) return null
  const s = String(val)
  const match = s.match(/\/Date\((\d+)[+-]?\d*\)\//)
  if (match) {
    const d = new Date(parseInt(match[1], 10))
    return d.toISOString().slice(0, 10)
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  return null
}
