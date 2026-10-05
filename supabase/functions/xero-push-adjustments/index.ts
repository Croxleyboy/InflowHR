import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token'

function getSupabase() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
}

function getXeroEnv() {
  const clientId = Deno.env.get('XERO_CLIENT_ID')
  const clientSecret = Deno.env.get('XERO_CLIENT_SECRET')
  const redirectUri = Deno.env.get('XERO_REDIRECT_URI')
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Missing XERO_CLIENT_ID, XERO_CLIENT_SECRET, or XERO_REDIRECT_URI env vars')
  }
  return { clientId, clientSecret, redirectUri }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://app.inflowhr.com',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function getValidXeroToken(companyId: string): Promise<{
  accessToken: string
  tenantId: string
} | null> {
  const sb = getSupabase()
  const { data: row } = await sb
    .from('xero_integrations')
    .select('access_token, refresh_token, expires_at, tenant_id')
    .eq('company_id', companyId)
    .single()

  if (!row?.access_token || !row?.tenant_id) return null

  if (row.expires_at && new Date(row.expires_at) > new Date(Date.now() + 60_000)) {
    return { accessToken: row.access_token, tenantId: row.tenant_id }
  }

  if (!row.refresh_token) return null
  const { clientId, clientSecret } = getXeroEnv()

  const res = await fetch(XERO_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + btoa(`${clientId}:${clientSecret}`),
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: row.refresh_token,
    }),
  })

  if (!res.ok) {
    await sb.from('xero_integrations').update({
      sync_status: 'error',
      sync_error: 'Token refresh failed — reconnect to Xero',
      updated_at: new Date().toISOString(),
    }).eq('company_id', companyId)
    return null
  }

  const tokens = await res.json()
  const expiresAt = new Date(Date.now() + (tokens.expires_in || 1800) * 1000).toISOString()

  await sb.from('xero_integrations').update({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || row.refresh_token,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  }).eq('company_id', companyId)

  return { accessToken: tokens.access_token, tenantId: row.tenant_id }
}

const XERO_PAYROLL_V1 = 'https://api.xero.com/payroll.xro/1.0'
const XERO_PAYROLL_V2 = 'https://api.xero.com/payroll.xro/2.0'

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

    let baseUrl = XERO_PAYROLL_V1
    let apiLabel = 'AU'
    const testRes = await fetch(`${baseUrl}/PayRuns`, {
      headers: { Authorization: xeroHeaders.Authorization, 'xero-tenant-id': xeroHeaders['xero-tenant-id'], Accept: 'application/json' },
    })
    if (!testRes.ok) {
      const errText = await testRes.text()
      if (errText.includes('AU Customer') || errText.includes('ValidationException') || testRes.status === 400 || testRes.status === 404) {
        baseUrl = XERO_PAYROLL_V2
        apiLabel = 'UK'
      } else {
        return json({ error: 'Failed to connect to Xero Payroll API', detail: sanitise(errText) }, 502)
      }
    }

    const allEmpIds = new Set<string>()
    for (const a of adjustments.overtime) allEmpIds.add(a.employee_id)
    for (const a of adjustments.unpaid_leave) allEmpIds.add(a.employee_id)
    for (const a of adjustments.benefit_changes) allEmpIds.add(a.employee_id)

    if (allEmpIds.size === 0) return json({ error: 'No adjustments to push' }, 400)

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

    const { data: payRun } = await sb
      .from('pay_runs')
      .select('period_start, period_end')
      .eq('id', pay_run_id)
      .single()
    if (!payRun) return json({ error: 'Pay run not found' }, 404)

    const earningsRates = await fetchXeroRates(baseUrl, xeroHeaders, 'EarningsRates')
    const deductionTypes = await fetchXeroRates(baseUrl, xeroHeaders, 'DeductionTypes')

    const overtimeRateId = findRateId(earningsRates, ['OVERTIME', 'OVERTIMEEARNINGS', 'OT'])
    const unpaidLeaveDeductionId = findRateId(deductionTypes, ['UNPAID', 'UNPAIDLEAVE', 'LEAVE WITHOUT PAY'])
    const defaultEarningsId = findRateId(earningsRates, ['ORDINARY', 'REGULAR', 'STANDARD', 'ORDINARYTIMEEARNINGS'])

    let xeroPayRun = await findExistingDraftPayRun(baseUrl, xeroHeaders)
    if (!xeroPayRun) {
      const payrollCalendarId = await getPayrollCalendarId(sb, company_id, baseUrl, xeroHeaders)
      if (!payrollCalendarId) {
        return json({ error: 'No draft pay run found and no payroll calendar in Xero. Either create a draft pay run manually in Xero for this period, or set up a payroll calendar.' }, 400)
      }
      xeroPayRun = await createXeroPayRun(baseUrl, xeroHeaders, payrollCalendarId, payRun.period_start, payRun.period_end)
      if (!xeroPayRun) {
        return json({ error: 'Could not create a pay run in Xero for this period. Create one manually in Xero first.' }, 400)
      }
    }

    let payslipStubs = await getPayslipsFromEndpoint(baseUrl, xeroHeaders, xeroPayRun.id)
    if (payslipStubs.length === 0) {
      payslipStubs = await getPayslipsFromPayRun(baseUrl, xeroHeaders, xeroPayRun.id)
    }

    const results: { employee: string; status: string; lines: number; error?: string }[] = []
    const skipped: { employee: string; reason: string }[] = []

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

    for (const [empId, adj] of Object.entries(empAdjustments)) {
      const emp = empMap[empId]
      if (!emp) { skipped.push({ employee: empId, reason: 'Employee not found' }); continue }
      if (!emp.xeroId) { skipped.push({ employee: emp.name, reason: 'No Xero employee mapping — sync employees first' }); continue }

      const stub = payslipStubs.find(s =>
        (s.employeeID || s.EmployeeID) === emp.xeroId
      )
      if (!stub) {
        skipped.push({ employee: emp.name, reason: `Not found in Xero pay run (${payslipStubs.length} stubs in run)` })
        continue
      }

      const payslipId = stub.paySlipID || stub.payslipID || stub.PayslipID || stub.PaySlipID
      if (!payslipId) {
        skipped.push({ employee: emp.name, reason: 'No payslip ID found for employee in pay run' })
        continue
      }

      const earningsLines: Record<string, unknown>[] = []
      const deductionLines: Record<string, unknown>[] = []

      if (adj.overtimeHours > 0) {
        const rateId = overtimeRateId || defaultEarningsId
        if (rateId) {
          earningsLines.push({
            earningsRateID: rateId,
            ratePerUnit: emp.hourlyRate > 0 ? Math.round(emp.hourlyRate * adj.overtimeMultiplier * 100) / 100 : undefined,
            numberOfUnits: adj.overtimeHours,
          })
        } else {
          skipped.push({ employee: emp.name, reason: 'No overtime or default earnings rate found in Xero' })
          continue
        }
      }

      if (adj.unpaidLeaveDays > 0) {
        const dailyRate = emp.annualSalary > 0 ? Math.round(emp.annualSalary / 260 * 100) / 100 : 0
        const amount = Math.round(dailyRate * adj.unpaidLeaveDays * 100) / 100
        if (unpaidLeaveDeductionId && amount > 0) {
          deductionLines.push({ deductionTypeID: unpaidLeaveDeductionId, amount })
        } else if (amount > 0 && defaultEarningsId) {
          earningsLines.push({ earningsRateID: defaultEarningsId, ratePerUnit: -dailyRate, numberOfUnits: adj.unpaidLeaveDays })
        }
      }

      for (const bc of adj.benefitChanges) {
        if (bc.monthlyCost > 0 && defaultEarningsId) {
          earningsLines.push({ earningsRateID: defaultEarningsId, ratePerUnit: bc.monthlyCost, numberOfUnits: 1 })
        } else if (bc.monthlyCost < 0) {
          const firstDeduction = deductionTypes[0]
          const dedId = firstDeduction ? (firstDeduction.DeductionTypeID || firstDeduction.deductionTypeID) as string : null
          if (dedId) {
            deductionLines.push({ deductionTypeID: dedId, amount: Math.abs(bc.monthlyCost) })
          }
        }
      }

      if (earningsLines.length === 0 && deductionLines.length === 0) {
        skipped.push({ employee: emp.name, reason: 'No adjustment lines to push' })
        continue
      }

      const payslipPayload: Record<string, unknown> = {
        paySlipID: payslipId,
      }
      if (earningsLines.length > 0) payslipPayload.earningsLines = earningsLines
      if (deductionLines.length > 0) payslipPayload.deductionLines = deductionLines

      const psRes = await fetch(`${baseUrl}/Payslips/${payslipId}`, {
        method: 'POST',
        headers: xeroHeaders,
        body: JSON.stringify(payslipPayload),
      })

      if (!psRes.ok) {
        const errText = await psRes.text()
        results.push({ employee: emp.name, status: 'failed', lines: 0, error: `Xero ${psRes.status}: ${sanitise(errText)}` })
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

    const failedSummary = results
      .filter(r => r.status === 'failed')
      .map(r => `${r.employee}: ${r.error || 'unknown'}`)
      .join('; ')

    const auditDetail = `Xero payslip adjustment push (${apiLabel}) — Pay run: ${pay_run_id}. ` +
      `Updated: ${successCount}, Failed: ${failedCount}, Skipped: ${skipped.length}.` +
      (failedSummary ? ` Failures: ${failedSummary}.` : '') +
      ` Data sent: overtime hours/rates, unpaid leave deductions, benefit adjustment amounts.`
    await sb.from('payroll_audit_log').insert({
      company_id,
      user_id: user.id,
      action: 'Xero Adjustment Push',
      detail: auditDetail,
      status: failedCount > 0 && successCount === 0 ? 'error' : 'success',
    })

    return json({
      xero_pay_run_id: xeroPayRun.id,
      api: apiLabel,
      pushed: successCount,
      failed: failedCount,
      skipped: skipped.length,
      results,
      skipped_details: skipped,
      failed_summary: failedSummary || null,
    })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
})

async function fetchXeroRates(
  baseUrl: string,
  headers: Record<string, string>,
  endpoint: string
): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${baseUrl}/${endpoint}`, { headers })
  if (res.ok) {
    const body = await res.json()
    return body[endpoint] || body[endpoint.charAt(0).toLowerCase() + endpoint.slice(1)]
      || body.earningsRates || body.deductionTypes || []
  }
  const piRes = await fetch(`${baseUrl}/PayItems`, { headers })
  if (piRes.ok) {
    const piBody = await piRes.json()
    const payItems = piBody.PayItems || piBody.payItems || {}
    return payItems[endpoint] || payItems[endpoint.charAt(0).toLowerCase() + endpoint.slice(1)] || []
  }
  return []
}

function findRateId(
  rates: Record<string, unknown>[],
  keywords: string[]
): string | undefined {
  for (const r of rates) {
    const name = ((r.Name || r.name || '') as string).toUpperCase()
    const etype = ((r.EarningsType || r.earningsType || r.DeductionType || r.deductionType || '') as string).toUpperCase()
    for (const kw of keywords) {
      if (name.includes(kw) || etype.includes(kw)) {
        return (r.earningsRateID || r.EarningsRateID || r.deductionTypeID || r.DeductionTypeID) as string
      }
    }
  }
  return undefined
}

async function getPayrollCalendarId(
  sb: ReturnType<typeof getSupabase>,
  companyId: string,
  baseUrl: string,
  headers: Record<string, string>
): Promise<string | null> {
  const { data } = await sb
    .from('xero_integrations')
    .select('payroll_calendar_id')
    .eq('company_id', companyId)
    .single()

  if (data?.payroll_calendar_id) return data.payroll_calendar_id

  const calRes = await fetch(`${baseUrl}/PayrollCalendars`, { headers })
  if (!calRes.ok) return null
  const calBody = await calRes.json()
  const calendars = calBody.PayrollCalendars || calBody.payrollCalendars
    || calBody.PayCalendars || calBody.payCalendars || []
  if (!calendars.length) return null

  const calId = calendars[0].PayrollCalendarID || calendars[0].payrollCalendarID
    || calendars[0].PayCalendarID || calendars[0].payCalendarID
  if (calId) {
    await sb.from('xero_integrations').update({ payroll_calendar_id: calId }).eq('company_id', companyId)
  }
  return calId || null
}

async function findExistingDraftPayRun(
  baseUrl: string,
  headers: Record<string, string>
): Promise<{ id: string } | null> {
  const listRes = await fetch(`${baseUrl}/PayRuns`, { headers })
  if (!listRes.ok) return null

  const listBody = await listRes.json()
  const payRuns = listBody.payRuns || listBody.PayRuns || []

  let bestDraft: { id: string; end: string } | null = null
  for (const pr of payRuns) {
    const status = ((pr.payRunStatus || pr.PayRunStatus || '') as string).toUpperCase()
    if (status !== 'DRAFT') continue

    const prId = pr.payRunID || pr.PayRunID
    const prEnd = pr.periodEndDate || pr.PeriodEndDate || ''
    if (!prId) continue

    const endStr = typeof prEnd === 'string' ? prEnd.slice(0, 10) : ''
    if (!bestDraft || (endStr && endStr > bestDraft.end)) {
      bestDraft = { id: prId, end: endStr }
    }
  }
  return bestDraft ? { id: bestDraft.id } : null
}

async function createXeroPayRun(
  baseUrl: string,
  headers: Record<string, string>,
  payrollCalendarId: string,
  periodStart: string,
  periodEnd: string
): Promise<{ id: string } | null> {
  const createPayload = {
    payrollCalendarID: payrollCalendarId,
    periodStartDate: periodStart,
    periodEndDate: periodEnd,
  }

  const createRes = await fetch(`${baseUrl}/PayRuns`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(createPayload),
  })

  if (!createRes.ok) return null

  const createBody = await createRes.json()
  const created = createBody.payRun || createBody.PayRun
    || createBody.payRuns?.[0] || createBody.PayRuns?.[0]
  if (!created) return null
  return { id: created.payRunID || created.PayRunID }
}

async function getPayslipsFromEndpoint(
  baseUrl: string,
  headers: Record<string, string>,
  payRunId: string
): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${baseUrl}/Payslips?PayRunID=${payRunId}`, { headers })
  if (!res.ok) return []
  const body = await res.json()
  return body.paySlips || body.payslips || body.Payslips || body.PaySlips || []
}

async function getPayslipsFromPayRun(
  baseUrl: string,
  headers: Record<string, string>,
  payRunId: string
): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${baseUrl}/PayRuns/${payRunId}`, { headers })
  if (!res.ok) return []
  const body = await res.json()
  const payRun = body.payRun || body.PayRun || body.payRuns?.[0] || body.PayRuns?.[0]
  if (!payRun) return []
  return payRun.paySlips || payRun.payslips || payRun.Payslips || payRun.PaySlips || []
}
