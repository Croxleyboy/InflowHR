import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token'
const XERO_PAYROLL_UK = 'https://api.xero.com/payroll.xro/1.0'
const XERO_PAYROLL_AU = 'https://api.xero.com/payroll.xro/2.0'

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

function sanitise(raw: string): string {
  return raw.slice(0, 500).replace(/[<>"'&]/g, '')
}

// Build UK v1 timesheet lines — each line has Date, EarningsRateID, NumberOfUnits (PascalCase)
function buildUkTimesheetLines(
  startDate: string,
  endDate: string,
  overtimeHours: number,
  earningsRateID: string,
): { Date: string; EarningsRateID: string; NumberOfUnits: number }[] {
  const lines: { Date: string; EarningsRateID: string; NumberOfUnits: number }[] = []
  const start = new Date(startDate.split('T')[0])
  const end = new Date(endDate.split('T')[0])
  const current = new Date(start)
  let remaining = overtimeHours
  while (current <= end) {
    const dow = current.getDay()
    if (dow >= 1 && dow <= 5 && remaining > 0) {
      const hrs = Math.min(remaining, 8)
      lines.push({
        Date: current.toISOString().split('T')[0],
        EarningsRateID: earningsRateID,
        NumberOfUnits: hrs,
      })
      remaining -= hrs
    }
    current.setDate(current.getDate() + 1)
  }
  return lines
}

// Build AU v2 timesheet lines — each line has date, earningsRateID, numberOfUnits (camelCase)
function buildAuTimesheetLines(
  startDate: string,
  endDate: string,
  overtimeHours: number,
  earningsRateID: string,
): { date: string; earningsRateID: string; numberOfUnits: number }[] {
  const lines: { date: string; earningsRateID: string; numberOfUnits: number }[] = []
  const start = new Date(startDate.split('T')[0])
  const end = new Date(endDate.split('T')[0])
  const current = new Date(start)
  let remaining = overtimeHours
  while (current <= end) {
    const dow = current.getDay()
    if (dow >= 1 && dow <= 5 && remaining > 0) {
      const hrs = Math.min(remaining, 8)
      lines.push({
        date: current.toISOString().split('T')[0],
        earningsRateID,
        numberOfUnits: hrs,
      })
      remaining -= hrs
    }
    current.setDate(current.getDate() + 1)
  }
  return lines
}

interface OvertimeEntry {
  employee_id: string
  hours: number
  multiplier: number
  hourly_rate_override?: number
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

    // Detect UK vs AU API — try UK first, fall back to AU
    let baseUrl = XERO_PAYROLL_UK
    let isUK = true
    const testRes = await fetch(`${baseUrl}/PayRuns`, {
      headers: { Authorization: xeroHeaders.Authorization, 'xero-tenant-id': xeroHeaders['xero-tenant-id'], Accept: 'application/json' },
    })
    if (!testRes.ok) {
      const errText = await testRes.text()
      if (errText.includes('AU Customer') || errText.includes('ValidationException')) {
        baseUrl = XERO_PAYROLL_AU
        isUK = false
      } else {
        return json({ error: 'Failed to connect to Xero Payroll API', detail: sanitise(errText) }, 502)
      }
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
      // Try /EarningsRates first, fall back to /PayItems for AU
      let rates: any[] = []
      const rateRes = await fetch(`${baseUrl}/EarningsRates`, { headers: xeroHeaders })
      if (rateRes.ok) {
        const rateBody = await rateRes.json()
        rates = rateBody.earningsRates || rateBody.EarningsRates || []
      }

      if (!rates.length) {
        const piRes = await fetch(`${baseUrl}/PayItems`, { headers: xeroHeaders })
        if (piRes.ok) {
          const piBody = await piRes.json()
          const payItems = piBody.PayItems || piBody.payItems || {}
          rates = payItems.EarningsRates || payItems.earningsRates || []
        }
      }

      if (rates.length) {
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

    const effectiveOtRateId = overtimeRateId || regularRateId!

    // Get or fetch payroll calendar ID (needed for timesheet creation)
    const { data: xeroIntegration } = await sb
      .from('xero_integrations')
      .select('payroll_calendar_id')
      .eq('company_id', company_id)
      .single()

    let companyCalendarId = xeroIntegration?.payroll_calendar_id

    if (!companyCalendarId) {
      const calRes = await fetch(`${baseUrl}/PayrollCalendars`, { headers: xeroHeaders })
      if (calRes.ok) {
        const calBody = await calRes.json()
        const calendars = calBody.PayrollCalendars || calBody.payrollCalendars
          || calBody.PayCalendars || calBody.payCalendars || []
        if (calendars.length) {
          companyCalendarId = calendars[0].PayrollCalendarID || calendars[0].payrollCalendarID
            || calendars[0].PayCalendarID || calendars[0].payCalendarID
          await sb.from('xero_integrations').update({ payroll_calendar_id: companyCalendarId }).eq('company_id', company_id)
        }
      }
    }

    // Fetch all timesheets for the period to find existing employee timesheets
    const tsListRes = await fetch(`${baseUrl}/Timesheets`, { headers: xeroHeaders })
    let allTimesheets: any[] = []
    if (tsListRes.ok) {
      const tsBody = await tsListRes.json()
      allTimesheets = tsBody.timesheets || tsBody.Timesheets || []
    }

    // Cache for per-employee payroll calendar lookups (AU)
    const empCalendarCache: Record<string, string | null> = {}
    async function getEmployeeCalendarId(xeroEmployeeId: string): Promise<string | null> {
      if (empCalendarCache[xeroEmployeeId] !== undefined) return empCalendarCache[xeroEmployeeId]
      if (companyCalendarId) { empCalendarCache[xeroEmployeeId] = companyCalendarId; return companyCalendarId }
      const empRes = await fetch(`${baseUrl}/Employees/${xeroEmployeeId}`, { headers: xeroHeaders })
      if (empRes.ok) {
        const empBody = await empRes.json()
        const employee = empBody.Employee || empBody.employee
          || (empBody.Employees && empBody.Employees[0])
          || (empBody.employees && empBody.employees[0])
        const calId = employee?.PayrollCalendarID || employee?.payrollCalendarID
          || employee?.payrollCalendar?.calendarID || employee?.PayrollCalendar?.CalendarID
          || null
        empCalendarCache[xeroEmployeeId] = calId
        return calId
      }
      empCalendarCache[xeroEmployeeId] = null
      return null
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

    // Push overtime via Timesheets
    for (const ot of (overtime || [])) {
      const emp = empMap[ot.employee_id]
      if (!emp) { skipped.push({ employee: ot.employee_id, reason: 'Employee not found' }); continue }
      if (!emp.xeroId) { skipped.push({ employee: emp.name, reason: 'No Xero employee mapping — sync employees first' }); continue }
      if (ot.hours <= 0) { skipped.push({ employee: emp.name, reason: 'No overtime hours' }); continue }

      const baseRate = ot.hourly_rate_override && ot.hourly_rate_override > 0
        ? ot.hourly_rate_override
        : emp.hourlyRate > 0
          ? emp.hourlyRate
          : emp.annualSalary > 0
            ? Math.round(emp.annualSalary / (52 * 37.5) * 100) / 100
            : 0
      const overtimeRate = Math.round(baseRate * ot.multiplier * 100) / 100
      const overtimeAmount = Math.round(overtimeRate * ot.hours * 100) / 100

      // Check for existing timesheet
      const empTimesheets = allTimesheets.filter((ts: any) =>
        (ts.employeeID || ts.EmployeeID) === emp.xeroId
      )

      let timesheetPayload: Record<string, unknown>
      let linesCount: number

      if (isUK) {
        // UK v1: PascalCase fields, each line has Date + EarningsRateID + NumberOfUnits
        const calId = companyCalendarId || await getEmployeeCalendarId(emp.xeroId!)
        if (!calId) {
          skipped.push({ employee: emp.name, reason: 'No payroll calendar assigned in Xero — assign one before pushing timesheets' })
          continue
        }
        const tsLines = buildUkTimesheetLines(period_start, period_end, ot.hours, effectiveOtRateId)
        linesCount = tsLines.length

        if (empTimesheets.length) {
          const ts = empTimesheets[0]
          timesheetPayload = {
            TimesheetID: ts.TimesheetID || ts.timesheetID,
            EmployeeID: emp.xeroId,
            StartDate: ts.StartDate || ts.startDate || period_start,
            EndDate: ts.EndDate || ts.endDate || period_end,
            TimesheetLines: tsLines,
          }
        } else {
          timesheetPayload = {
            PayrollCalendarID: calId,
            EmployeeID: emp.xeroId,
            StartDate: period_start,
            EndDate: period_end,
            TimesheetLines: tsLines,
          }
        }
      } else {
        // AU v2: camelCase fields, each line has date + earningsRateID + numberOfUnits
        const calId = await getEmployeeCalendarId(emp.xeroId!)
        if (!calId) {
          skipped.push({ employee: emp.name, reason: 'No payroll calendar assigned in Xero — assign one before pushing timesheets' })
          continue
        }
        const startDate = empTimesheets.length ? (empTimesheets[0].startDate || period_start) : period_start
        const endDate = empTimesheets.length ? (empTimesheets[0].endDate || period_end) : period_end
        const tsLines = buildAuTimesheetLines(startDate, endDate, ot.hours, effectiveOtRateId)
        linesCount = tsLines.length

        if (empTimesheets.length) {
          const ts = empTimesheets[0]
          timesheetPayload = {
            timesheetID: ts.timesheetID,
            employeeID: emp.xeroId,
            startDate,
            endDate,
            timesheetLines: tsLines,
          }
        } else {
          timesheetPayload = {
            payrollCalendarID: calId,
            employeeID: emp.xeroId,
            startDate: period_start,
            endDate: period_end,
            timesheetLines: tsLines,
          }
        }
      }

      // POST to Timesheets — try single object first, then array wrapper
      const tsUrl = `${baseUrl}/Timesheets`
      let tsRes = await fetch(tsUrl, {
        method: 'POST',
        headers: xeroHeaders,
        body: JSON.stringify(timesheetPayload),
      })

      if (!tsRes.ok) {
        tsRes = await fetch(tsUrl, {
          method: 'POST',
          headers: xeroHeaders,
          body: JSON.stringify([timesheetPayload]),
        })
      }

      if (tsRes.ok) {
        timesheetResults.push({
          employee: emp.name,
          status: 'pushed',
          hours: ot.hours,
          multiplier: ot.multiplier,
          rate: baseRate,
          amount: overtimeAmount,
          earningsRateId: effectiveOtRateId,
          lines_posted: linesCount,
        })
      } else {
        const errText = await tsRes.text()
        timesheetResults.push({
          employee: emp.name,
          status: 'failed',
          hours: ot.hours,
          multiplier: ot.multiplier,
          rate: baseRate,
          amount: overtimeAmount,
          error: sanitise(errText) || 'Timesheet push failed',
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
    const auditDetail = `Xero payroll push (${isUK ? 'UK' : 'AU'}) — Pay run: ${pay_run_id}, Period: ${period_start} to ${period_end}. ` +
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
