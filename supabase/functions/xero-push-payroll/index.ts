import { getSupabase, getValidXeroToken, corsHeaders, json } from '../_shared/xero.ts'

const XERO_PAYROLL_V2 = 'https://api.xero.com/payroll.xro/2.0'

function sanitise(raw: string): string {
  return raw.slice(0, 500).replace(/[<>"'&]/g, '')
}

function getWeekdaysInRange(startDate: string, endDate: string): string[] {
  const days: string[] = []
  const start = new Date(startDate.split('T')[0])
  const end = new Date(endDate.split('T')[0])
  const current = new Date(start)
  while (current <= end) {
    const dow = current.getDay()
    if (dow >= 1 && dow <= 5) {
      days.push(current.toISOString().split('T')[0])
    }
    current.setDate(current.getDate() + 1)
  }
  return days
}

interface OvertimeEntry {
  employee_id: string
  hours: number
  multiplier: number
}

interface UnpaidLeaveEntry {
  employee_id: string
  days: number
}

interface BenefitChangeEntry {
  employee_id: string
  benefit: string
  monthly_cost: number
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

    const body = await req.json()
    const { company_id, pay_run_id, period_start, period_end, overtime, unpaid_leave, benefit_changes } = body as {
      company_id: string
      pay_run_id: string
      period_start: string
      period_end: string
      overtime: OvertimeEntry[]
      unpaid_leave: UnpaidLeaveEntry[]
      benefit_changes: BenefitChangeEntry[]
    }

    if (!company_id) return json({ error: 'company_id required' }, 400)
    if (!pay_run_id) return json({ error: 'pay_run_id required' }, 400)
    if (!period_start || !period_end) return json({ error: 'period_start and period_end required' }, 400)

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

    const allEmpIds = new Set<string>()
    for (const o of (overtime || [])) allEmpIds.add(o.employee_id)
    for (const u of (unpaid_leave || [])) allEmpIds.add(u.employee_id)
    for (const b of (benefit_changes || [])) allEmpIds.add(b.employee_id)

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

    // Get earnings rate mappings
    const { data: rateMappings } = await sb
      .from('xero_earning_rate_mappings')
      .select('inflow_rate_name, xero_earnings_rate_id')
      .eq('company_id', company_id)

    let regularRateId = rateMappings?.find(m => m.inflow_rate_name === 'default')?.xero_earnings_rate_id
    let overtimeRateId = rateMappings?.find(m => m.inflow_rate_name === 'overtime')?.xero_earnings_rate_id

    // Auto-detect earnings rates from Xero if not mapped
    if (!regularRateId || !overtimeRateId) {
      const rateRes = await fetch(`${XERO_PAYROLL_V2}/EarningsRates`, { headers: xeroHeaders })
      if (rateRes.ok) {
        const rateBody = await rateRes.json()
        const rates = rateBody.earningsRates || rateBody.EarningsRates || []

        if (!regularRateId) {
          const reg = rates.find((r: any) => {
            const n = (r.name || r.Name || '').toUpperCase()
            return n.includes('REGULAR') || n.includes('ORDINARY') || n.includes('STANDARD')
          }) || rates[0]
          if (reg) {
            regularRateId = reg.earningsRateID || reg.EarningsRateID
            await sb.from('xero_earning_rate_mappings').upsert({
              company_id, inflow_rate_name: 'default', xero_earnings_rate_id: regularRateId!,
            }, { onConflict: 'company_id,inflow_rate_name' })
          }
        }

        if (!overtimeRateId) {
          const ot = rates.find((r: any) => {
            const n = (r.name || r.Name || '').toUpperCase()
            return n.includes('OVERTIME') || n.includes('OT ')
          })
          if (ot) {
            overtimeRateId = ot.earningsRateID || ot.EarningsRateID
            await sb.from('xero_earning_rate_mappings').upsert({
              company_id, inflow_rate_name: 'overtime', xero_earnings_rate_id: overtimeRateId!,
            }, { onConflict: 'company_id,inflow_rate_name' })
          }
        }
      }

      if (!regularRateId) {
        return json({ error: 'No earning rates found in Xero. Please set up at least one earning rate.' }, 400)
      }
    }

    // Use overtime rate if mapped, otherwise fall back to regular rate
    const effectiveOtRateId = overtimeRateId || regularRateId!

    // Fetch all timesheets for the period to find employee timesheet IDs
    const tsListRes = await fetch(`${XERO_PAYROLL_V2}/Timesheets`, { headers: xeroHeaders })
    let allTimesheets: any[] = []
    if (tsListRes.ok) {
      const tsBody = await tsListRes.json()
      allTimesheets = tsBody.timesheets || tsBody.Timesheets || []
    }

    const timesheetResults: {
      employee: string
      status: string
      hours: number
      multiplier: number
      rate: number
      amount: number
      earningsRateId?: string
      lines_posted?: number
      error?: string
    }[] = []
    const skipped: { employee: string; reason: string }[] = []
    const manualItems: {
      employee: string
      type: 'unpaid_leave' | 'benefit_addition' | 'benefit_deduction'
      description: string
      amount: number
      days?: number
    }[] = []

    // Push overtime via Timesheets/Lines
    for (const ot of (overtime || [])) {
      const emp = empMap[ot.employee_id]
      if (!emp) { skipped.push({ employee: ot.employee_id, reason: 'Employee not found' }); continue }
      if (!emp.xeroId) { skipped.push({ employee: emp.name, reason: 'No Xero employee mapping — sync employees first' }); continue }
      if (ot.hours <= 0) { skipped.push({ employee: emp.name, reason: 'No overtime hours' }); continue }

      // Find the employee's auto-created timesheet for this period
      const empTimesheets = allTimesheets.filter((ts: any) => ts.employeeID === emp.xeroId)
      if (!empTimesheets.length) {
        skipped.push({ employee: emp.name, reason: 'No timesheet found in Xero for this employee — ensure a pay run is open' })
        continue
      }

      const ts = empTimesheets[0]
      const timesheetID = ts.timesheetID
      const weekdays = getWeekdaysInRange(ts.startDate, ts.endDate)

      if (!weekdays.length) {
        skipped.push({ employee: emp.name, reason: 'No weekdays in timesheet period' })
        continue
      }

      const overtimeRate = emp.hourlyRate > 0 ? Math.round(emp.hourlyRate * ot.multiplier * 100) / 100 : 0
      const overtimeAmount = Math.round(overtimeRate * ot.hours * 100) / 100

      // Spread hours across weekdays, max 8hrs per line per day
      let remaining = ot.hours
      let dayIndex = 0
      let linesPosted = 0
      let lastError = ''

      while (remaining > 0 && dayIndex < weekdays.length) {
        const units = Math.min(remaining, 8)
        const lineBody = {
          date: weekdays[dayIndex],
          earningsRateID: effectiveOtRateId,
          numberOfUnits: units,
        }

        const lineRes = await fetch(
          `${XERO_PAYROLL_V2}/Timesheets/${timesheetID}/Lines`,
          { method: 'POST', headers: xeroHeaders, body: JSON.stringify(lineBody) }
        )

        if (lineRes.ok) {
          linesPosted++
        } else {
          const errText = await lineRes.text()
          lastError = sanitise(errText)
        }

        remaining -= units
        dayIndex++
      }

      if (linesPosted > 0) {
        timesheetResults.push({
          employee: emp.name,
          status: 'pushed',
          hours: ot.hours,
          multiplier: ot.multiplier,
          rate: emp.hourlyRate,
          amount: overtimeAmount,
          earningsRateId: effectiveOtRateId,
          lines_posted: linesPosted,
        })
      } else {
        timesheetResults.push({
          employee: emp.name,
          status: 'failed',
          hours: ot.hours,
          multiplier: ot.multiplier,
          rate: emp.hourlyRate,
          amount: overtimeAmount,
          error: lastError || 'All line posts failed',
        })
      }
    }

    // Build manual items for unpaid leave
    for (const ul of (unpaid_leave || [])) {
      const emp = empMap[ul.employee_id]
      if (!emp) continue
      const dailyRate = emp.annualSalary > 0 ? Math.round(emp.annualSalary / 260 * 100) / 100 : 0
      const amount = Math.round(dailyRate * ul.days * 100) / 100
      manualItems.push({
        employee: emp.name,
        type: 'unpaid_leave',
        description: `${ul.days} day${ul.days !== 1 ? 's' : ''} unpaid leave`,
        amount,
        days: ul.days,
      })
    }

    // Build manual items for benefit changes
    for (const bc of (benefit_changes || [])) {
      const emp = empMap[bc.employee_id]
      if (!emp) continue
      manualItems.push({
        employee: emp.name,
        type: bc.monthly_cost >= 0 ? 'benefit_addition' : 'benefit_deduction',
        description: bc.benefit,
        amount: Math.abs(bc.monthly_cost),
      })
    }

    const pushedCount = timesheetResults.filter(r => r.status === 'pushed').length
    const failedCount = timesheetResults.filter(r => r.status === 'failed').length

    // GDPR audit log
    const auditDetail = `Xero payroll push — Pay run: ${pay_run_id}, Period: ${period_start} to ${period_end}. ` +
      `Overtime timesheets pushed: ${pushedCount}, Failed: ${failedCount}, Skipped: ${skipped.length}. ` +
      `Manual items flagged: ${manualItems.length} (unpaid leave: ${(unpaid_leave || []).length}, benefit changes: ${(benefit_changes || []).length}). ` +
      `Data sent to Xero: employee IDs, overtime hours, earning rate IDs.`
    await sb.from('payroll_audit_log').insert({
      company_id,
      user_id: user.id,
      action: 'Xero Payroll Push',
      detail: auditDetail,
      status: failedCount > 0 && pushedCount === 0 ? 'error' : 'success',
    })

    return json({
      pushed: pushedCount,
      failed: failedCount,
      skipped: skipped.length,
      timesheet_results: timesheetResults,
      manual_items: manualItems,
      skipped_details: skipped,
    })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
})
