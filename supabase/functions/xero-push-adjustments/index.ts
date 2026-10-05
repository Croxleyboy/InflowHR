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

const XERO_PAYROLL_UK = 'https://api.xero.com/payroll.xro/1.0'
const XERO_PAYROLL_AU = 'https://api.xero.com/payroll.xro/2.0'

function sanitise(raw: string): string {
  return raw.slice(0, 500).replace(/[<>"'&]/g, '')
}

function parseXeroDate(val: unknown): string | null {
  if (!val) return null
  const s = String(val)
  const msMatch = s.match(/\/Date\((\d+)/)
  if (msMatch) {
    return new Date(parseInt(msMatch[1], 10)).toISOString().slice(0, 10)
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  return null
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

    let baseUrl = XERO_PAYROLL_UK
    let isAU = false
    const testRes = await fetch(`${baseUrl}/PayRuns`, {
      headers: { Authorization: xeroHeaders.Authorization, 'xero-tenant-id': xeroHeaders['xero-tenant-id'], Accept: 'application/json' },
    })
    if (!testRes.ok) {
      const errText = await testRes.text()
      if (errText.includes('AU Customer') || errText.includes('ValidationException')) {
        baseUrl = XERO_PAYROLL_AU
        isAU = true
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

    const periodStart = String(payRun.period_start).slice(0, 10)
    const periodEnd = String(payRun.period_end).slice(0, 10)

    const { data: xeroIntegration } = await sb
      .from('xero_integrations')
      .select('payroll_calendar_id')
      .eq('company_id', company_id)
      .single()

    let payrollCalendarId = xeroIntegration?.payroll_calendar_id
    let calendarType = 'UNKNOWN'
    let calendarStartDate: string | null = null
    let calendarName = ''

    let calendarDebugRaw = ''

    function extractCalendarFields(cal: Record<string, unknown>): void {
      const ct = String(cal.CalendarType || cal.calendarType || cal.Type || cal.type || '')
      if (ct) calendarType = ct.toUpperCase()
      calendarStartDate = parseXeroDate(cal.StartDate || cal.startDate || cal.ReferenceDate || cal.referenceDate || cal.PaymentDate || cal.paymentDate)
      calendarName = String(cal.Name || cal.name || '')
    }

    async function fetchCalendarDetails(): Promise<void> {
      const authHdrs = { Authorization: xeroHeaders.Authorization, 'xero-tenant-id': xeroHeaders['xero-tenant-id'], Accept: 'application/json' }

      if (payrollCalendarId) {
        for (const base of [baseUrl, XERO_PAYROLL_AU, XERO_PAYROLL_UK]) {
          const res = await fetch(`${base}/PayrollCalendars/${payrollCalendarId}`, { headers: authHdrs })
          if (!res.ok) { calendarDebugRaw += `GET ${base}/PayrollCalendars/${payrollCalendarId} => ${res.status}; `; continue }
          const body = await res.json()
          calendarDebugRaw += `GET ${base}/PayrollCalendars/${payrollCalendarId} => ${JSON.stringify(body).slice(0, 300)}; `
          const cal = body.PayrollCalendar || body.payrollCalendar
            || (body.PayrollCalendars && body.PayrollCalendars[0])
            || (body.payrollCalendars && body.payrollCalendars[0])
            || body
          if (cal) { extractCalendarFields(cal as Record<string, unknown>); if (calendarType !== 'UNKNOWN') return }
        }
      }

      for (const base of [baseUrl, XERO_PAYROLL_AU, XERO_PAYROLL_UK]) {
        const res = await fetch(`${base}/PayrollCalendars`, { headers: authHdrs })
        if (!res.ok) { calendarDebugRaw += `GET ${base}/PayrollCalendars => ${res.status}; `; continue }
        const body = await res.json()
        calendarDebugRaw += `GET ${base}/PayrollCalendars => keys:${Object.keys(body).join(',')}, ${JSON.stringify(body).slice(0, 300)}; `
        const calendars = body.PayrollCalendars || body.payrollCalendars
          || body.PayCalendars || body.payCalendars || []
        if (!Array.isArray(calendars) || !calendars.length) continue

        const cal = payrollCalendarId
          ? calendars.find((c: Record<string, unknown>) =>
              String(c.PayrollCalendarID || c.payrollCalendarID || c.PayCalendarID || c.payCalendarID) === payrollCalendarId)
            || calendars[0]
          : calendars[0]

        if (!payrollCalendarId) {
          payrollCalendarId = (cal as Record<string, unknown>).PayrollCalendarID as string
            || (cal as Record<string, unknown>).payrollCalendarID as string
            || (cal as Record<string, unknown>).PayCalendarID as string
            || (cal as Record<string, unknown>).payCalendarID as string
          if (payrollCalendarId) {
            await sb.from('xero_integrations').update({ payroll_calendar_id: payrollCalendarId }).eq('company_id', company_id)
          }
        }
        extractCalendarFields(cal as Record<string, unknown>)
        if (calendarType !== 'UNKNOWN') return
      }
    }
    await fetchCalendarDetails()

    function getCalendarPeriodDays(calType: string): number {
      switch (calType) {
        case 'WEEKLY': return 7
        case 'FORTNIGHTLY': return 14
        case 'FOURWEEKLY': return 28
        default: return 0
      }
    }

    function getAlignedTimesheetPeriod(payRunStart: string, payRunEnd: string, calType: string, calStart: string | null): {
      start: string; end: string; days: number; aligned: boolean; guidance?: string
    } {
      const calPeriodDays = getCalendarPeriodDays(calType)
      if (calPeriodDays === 0) {
        const s = new Date(payRunStart)
        const e = new Date(payRunEnd)
        const days = Math.max(1, Math.round((e.getTime() - s.getTime()) / 86400000) + 1)
        return { start: payRunStart, end: payRunEnd, days, aligned: true }
      }

      if (calStart) {
        const ref = new Date(calStart)
        const target = new Date(payRunStart)
        const diffMs = target.getTime() - ref.getTime()
        const diffDays = Math.floor(diffMs / 86400000)
        const offset = ((diffDays % calPeriodDays) + calPeriodDays) % calPeriodDays
        const alignedStart = new Date(target)
        alignedStart.setDate(alignedStart.getDate() - offset)
        const alignedEnd = new Date(alignedStart)
        alignedEnd.setDate(alignedEnd.getDate() + calPeriodDays - 1)
        return {
          start: alignedStart.toISOString().slice(0, 10),
          end: alignedEnd.toISOString().slice(0, 10),
          days: calPeriodDays,
          aligned: true,
        }
      }

      const target = new Date(payRunStart)
      const dow = target.getDay()
      const mondayOffset = dow === 0 ? -6 : 1 - dow
      const monday = new Date(target)
      monday.setDate(monday.getDate() + mondayOffset)
      const end = new Date(monday)
      end.setDate(end.getDate() + calPeriodDays - 1)
      return {
        start: monday.toISOString().slice(0, 10),
        end: end.toISOString().slice(0, 10),
        days: calPeriodDays,
        aligned: true,
        guidance: `No calendar reference date found — used Monday-aligned ${calType.toLowerCase()} period`,
      }
    }

    const { data: rateMappings } = await sb
      .from('xero_earning_rate_mappings')
      .select('inflow_rate_name, xero_earnings_rate_id')
      .eq('company_id', company_id)

    let defaultEarningsRateId = rateMappings?.find(m => m.inflow_rate_name === 'default')?.xero_earnings_rate_id

    if (!defaultEarningsRateId) {
      let rates: { EarningsRateID?: string; earningsRateID?: string; Name?: string; name?: string; EarningsType?: string; earningsType?: string }[] = []

      const rateRes = await fetch(`${baseUrl}/EarningsRates`, {
        headers: { Authorization: xeroHeaders.Authorization, 'xero-tenant-id': xeroHeaders['xero-tenant-id'], Accept: 'application/json' },
      })
      if (rateRes.ok) {
        const rateBody = await rateRes.json()
        rates = rateBody.EarningsRates || rateBody.earningsRates || []
      }

      if (!rates.length) {
        const piRes = await fetch(`${baseUrl}/PayItems`, {
          headers: { Authorization: xeroHeaders.Authorization, 'xero-tenant-id': xeroHeaders['xero-tenant-id'], Accept: 'application/json' },
        })
        if (piRes.ok) {
          const piBody = await piRes.json()
          const payItems = piBody.PayItems || piBody.payItems || {}
          rates = payItems.EarningsRates || payItems.earningsRates || []
        }
      }

      if (rates.length) {
        const ordinaryRate = rates.find(r => {
          const n = (r.Name || r.name || '').toUpperCase()
          const et = (r.EarningsType || r.earningsType || '').toUpperCase()
          return n.includes('ORDINARY') || n.includes('REGULAR') || n.includes('STANDARD')
            || et === 'ORDINARYTIMEEARNINGS' || et === 'REGULAREARNINGS'
        }) || rates[0]

        if (ordinaryRate) {
          defaultEarningsRateId = ordinaryRate.EarningsRateID || ordinaryRate.earningsRateID
          await sb.from('xero_earning_rate_mappings').upsert({
            company_id,
            inflow_rate_name: 'default',
            xero_earnings_rate_id: defaultEarningsRateId!,
          }, { onConflict: 'company_id,inflow_rate_name' })
        }
      }
    }

    const empCalendarCache: Record<string, string | null> = {}
    async function getEmployeeCalendarId(xeroEmployeeId: string): Promise<string | null> {
      if (empCalendarCache[xeroEmployeeId] !== undefined) return empCalendarCache[xeroEmployeeId]
      if (payrollCalendarId) { empCalendarCache[xeroEmployeeId] = payrollCalendarId; return payrollCalendarId }
      const empRes = await fetch(`${baseUrl}/Employees/${xeroEmployeeId}`, {
        headers: { Authorization: xeroHeaders.Authorization, 'xero-tenant-id': xeroHeaders['xero-tenant-id'], Accept: 'application/json' },
      })
      if (empRes.ok) {
        const empBody = await empRes.json()
        const employee = empBody.Employee || empBody.employee || (empBody.Employees && empBody.Employees[0]) || (empBody.employees && empBody.employees[0])
        const calId = employee?.PayrollCalendarID || employee?.payrollCalendarID || employee?.payCalendarID || null
        if (calId) {
          empCalendarCache[xeroEmployeeId] = calId
          if (!payrollCalendarId) {
            payrollCalendarId = calId
            await sb.from('xero_integrations').update({ payroll_calendar_id: calId }).eq('company_id', company_id)
          }
          return calId
        }
      }
      if (!payrollCalendarId) {
        const allEmpRes = await fetch(`${baseUrl}/Employees`, {
          headers: { Authorization: xeroHeaders.Authorization, 'xero-tenant-id': xeroHeaders['xero-tenant-id'], Accept: 'application/json' },
        })
        if (allEmpRes.ok) {
          const allEmpBody = await allEmpRes.json()
          const allEmps = allEmpBody.Employees || allEmpBody.employees || []
          for (const e of allEmps) {
            const cal = e.PayrollCalendarID || e.payrollCalendarID || e.payCalendarID
            if (cal) {
              payrollCalendarId = cal
              await sb.from('xero_integrations').update({ payroll_calendar_id: cal }).eq('company_id', company_id)
              break
            }
          }
        }
      }
      empCalendarCache[xeroEmployeeId] = payrollCalendarId || null
      return payrollCalendarId || null
    }

    const timesheetResults: {
      employee: string
      status: string
      hours: number
      multiplier: number
      rate: number
      amount: number
      xeroTimesheetId?: string
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

    for (const ot of adjustments.overtime) {
      const emp = empMap[ot.employee_id]
      if (!emp) { skipped.push({ employee: ot.employee_id, reason: 'Employee not found' }); continue }
      if (!emp.xeroId) { skipped.push({ employee: emp.name, reason: 'No Xero employee mapping — sync employees first' }); continue }

      if (ot.hours <= 0) {
        skipped.push({ employee: emp.name, reason: 'No overtime hours to push' })
        continue
      }

      if (!defaultEarningsRateId) {
        skipped.push({ employee: emp.name, reason: 'No earnings rate found in Xero — set up at least one earning rate' })
        continue
      }

      const overtimeRate = emp.hourlyRate > 0 ? Math.round(emp.hourlyRate * ot.multiplier * 100) / 100 : 0
      const overtimeAmount = Math.round(overtimeRate * ot.hours * 100) / 100

      const existingTsRes = await fetch(`${baseUrl}/Timesheets?where=EmployeeID=guid("${emp.xeroId}")`, {
        headers: { Authorization: xeroHeaders.Authorization, 'xero-tenant-id': xeroHeaders['xero-tenant-id'], Accept: 'application/json' },
      })
      let existingTimesheetId: string | null = null
      if (existingTsRes.ok) {
        const existingBody = await existingTsRes.json()
        const timesheets = existingBody.Timesheets || existingBody.timesheets || []
        for (const ts of timesheets) {
          const tsStart = parseXeroDate(ts.StartDate || ts.startDate) || ''
          const tsEnd = parseXeroDate(ts.EndDate || ts.endDate) || ''
          if (tsStart === periodStart || tsEnd === periodEnd) {
            existingTimesheetId = ts.TimesheetID || ts.timesheetID
            break
          }
        }
      }

      let tsRes: Response

      if (existingTimesheetId) {
        const revertUrl = `${baseUrl}/Timesheets/${existingTimesheetId}/RevertToDraft`
        await fetch(revertUrl, { method: 'POST', headers: xeroHeaders })

        const linePayload = isAU
          ? { date: periodStart, earningsRateID: defaultEarningsRateId, numberOfUnits: ot.hours }
          : { Date: periodStart, EarningsRateID: defaultEarningsRateId, NumberOfUnits: ot.hours }

        tsRes = await fetch(`${baseUrl}/Timesheets/${existingTimesheetId}/lines`, {
          method: 'POST',
          headers: xeroHeaders,
          body: JSON.stringify(linePayload),
        })
      } else {
        let timesheetPayload: Record<string, unknown>
        if (isAU) {
          const empCalId = await getEmployeeCalendarId(emp.xeroId)
          const tsPeriod = getAlignedTimesheetPeriod(periodStart, periodEnd, calendarType, calendarStartDate)
          const start = new Date(tsPeriod.start)
          const days = tsPeriod.days
          const dailyHours = new Array(days).fill(0)
          let weekdays = 0
          for (let i = 0; i < days; i++) {
            const d = new Date(start)
            d.setDate(d.getDate() + i)
            if (d.getDay() !== 0 && d.getDay() !== 6) weekdays++
          }
          const hoursPerDay = weekdays > 0 ? Math.round((ot.hours / weekdays) * 100) / 100 : ot.hours
          for (let i = 0; i < days; i++) {
            const d = new Date(start)
            d.setDate(d.getDate() + i)
            if (d.getDay() !== 0 && d.getDay() !== 6) dailyHours[i] = hoursPerDay
          }
          timesheetPayload = {
            payrollCalendarID: empCalId || undefined,
            employeeID: emp.xeroId,
            startDate: tsPeriod.start,
            endDate: tsPeriod.end,
            timesheetLines: [{
              earningsRateID: defaultEarningsRateId,
              numberOfUnits: dailyHours,
            }],
          }
        } else {
          timesheetPayload = {
            EmployeeID: emp.xeroId,
            StartDate: periodStart,
            EndDate: periodEnd,
            TimesheetLines: [{
              Date: periodStart,
              EarningsRateID: defaultEarningsRateId,
              NumberOfUnits: ot.hours,
            }],
          }
        }

        const tsUrl = `${baseUrl}/Timesheets`

        tsRes = await fetch(tsUrl, {
          method: 'POST',
          headers: xeroHeaders,
          body: JSON.stringify(timesheetPayload),
        })

        if (!tsRes.ok && isAU) {
          tsRes = await fetch(tsUrl, {
            method: 'POST',
            headers: xeroHeaders,
            body: JSON.stringify([timesheetPayload]),
          })
        }
      }

      const empCalForDebug = empCalendarCache[emp.xeroId!] || payrollCalendarId || 'none'
      const tsPeriodForDebug = isAU ? getAlignedTimesheetPeriod(periodStart, periodEnd, calendarType, calendarStartDate) : { start: periodStart, end: periodEnd }
      const debugInfo = `API: ${isAU ? 'AU-v2' : 'UK-v1'}, Calendar: ${empCalForDebug}, CalType: ${calendarType}, CalName: ${calendarName || 'unknown'}, CalStart: ${calendarStartDate || 'unknown'}, EarningsRate: ${defaultEarningsRateId}, PayRunPeriod: ${periodStart} to ${periodEnd}, TsPeriod: ${tsPeriodForDebug.start} to ${tsPeriodForDebug.end}, Hours: ${ot.hours}, ExistingTS: ${existingTimesheetId || 'none'}, CalendarAPI: ${calendarDebugRaw.slice(0, 500)}`

      if (!tsRes.ok) {
        const errText = await tsRes.text()
        let guidance = ''
        if (isAU && calendarType !== 'UNKNOWN') {
          const payRunDays = Math.round((new Date(periodEnd).getTime() - new Date(periodStart).getTime()) / 86400000) + 1
          const calDays = getCalendarPeriodDays(calendarType)
          if (calDays > 0 && payRunDays !== calDays) {
            guidance = ` | MISMATCH: Your InflowHR pay run is ${payRunDays} days (${periodStart} to ${periodEnd}) but your Xero payroll calendar "${calendarName}" is ${calendarType} (${calDays}-day periods). To fix this, choose one option: OPTION A — Change Xero to Monthly: (1) Log in to Xero. (2) Go to Settings > Payroll Settings > Payroll Calendars. (3) Edit "${calendarName}" and change type to Monthly. (4) Save and retry. OR OPTION B — Match InflowHR to ${calendarType}: (1) In InflowHR Admin > Employees > Payroll Settings, change the pay frequency to ${calendarType.toLowerCase()}. (2) Create a new ${calendarType.toLowerCase()} pay run. (3) Retry the push.`
          }
        }
        if (!guidance && isAU && calendarType === 'UNKNOWN') {
          guidance = ' | Could not read your Xero payroll calendar settings. Please check: (1) Open Xero > Settings > Payroll Settings > Payroll Calendars and ensure a calendar exists. (2) Open Xero > Payroll > Employees > select the employee > Pay Template and ensure a payroll calendar is assigned. (3) If using a WEEKLY calendar, your InflowHR pay run period must also be weekly — go to InflowHR Admin > Employees > Payroll Settings to match.'
        } else if (!guidance && isAU) {
          guidance = ' | Xero rejected the timesheet. Please check: (1) The employee has a payroll calendar assigned in Xero > Payroll > Employees > Pay Template. (2) The timesheet period aligns with the calendar — a WEEKLY calendar requires 7-day periods. (3) No draft or approved timesheet already exists for this employee in this period.'
        }
        timesheetResults.push({
          employee: emp.name,
          status: 'failed',
          hours: ot.hours,
          multiplier: ot.multiplier,
          rate: emp.hourlyRate,
          amount: overtimeAmount,
          error: `${sanitise(errText)}${guidance} [${debugInfo}]`,
        })
        continue
      }

      const tsBody = await tsRes.json()
      const createdTs = tsBody.Timesheet || tsBody.timesheet ||
        (tsBody.Timesheets && tsBody.Timesheets[0]) ||
        (tsBody.timesheets && tsBody.timesheets[0])
      const xeroTimesheetId = createdTs?.TimesheetID || createdTs?.timesheetID

      timesheetResults.push({
        employee: emp.name,
        status: 'pushed',
        hours: ot.hours,
        multiplier: ot.multiplier,
        rate: emp.hourlyRate,
        amount: overtimeAmount,
        xeroTimesheetId: xeroTimesheetId || undefined,
      })
    }

    for (const ul of adjustments.unpaid_leave) {
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

    for (const bc of adjustments.benefit_changes) {
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

    const auditDetail = `Xero adjustment push (${isAU ? 'AU' : 'UK'}) — Pay run: ${pay_run_id}. ` +
      `Overtime timesheets pushed: ${pushedCount}, Failed: ${failedCount}, Skipped: ${skipped.length}. ` +
      `Manual items flagged: ${manualItems.length} (unpaid leave: ${adjustments.unpaid_leave.length}, benefit changes: ${adjustments.benefit_changes.length}). ` +
      `Data sent to Xero: employee IDs, overtime hours, earning rate IDs.`
    await sb.from('payroll_audit_log').insert({
      company_id,
      user_id: user.id,
      action: 'Xero Adjustment Push',
      detail: auditDetail,
      status: failedCount > 0 && pushedCount === 0 ? 'error' : 'success',
    })

    const xeroConfig = {
      api: isAU ? 'AU' : 'UK',
      calendarId: payrollCalendarId || null,
      calendarType: calendarType,
      calendarName: calendarName || null,
      calendarStartDate: calendarStartDate || null,
      payRunPeriod: { start: periodStart, end: periodEnd },
    }

    let configGuidance: string | null = null
    if (isAU && calendarType !== 'UNKNOWN' && calendarType !== 'MONTHLY') {
      const payRunDays = Math.round((new Date(periodEnd).getTime() - new Date(periodStart).getTime()) / 86400000) + 1
      const calDays = getCalendarPeriodDays(calendarType)
      if (calDays > 0 && payRunDays !== calDays) {
        configGuidance = `Your Xero payroll calendar "${calendarName}" is set to ${calendarType} (${calDays}-day periods) but your InflowHR pay run covers ${payRunDays} days. The timesheet period was auto-aligned to match the calendar. If adjustments fail, either change the Xero payroll calendar to MONTHLY in Xero > Settings > Payroll Settings > Payroll Calendars, or configure ${calendarType.toLowerCase()} pay runs in InflowHR Admin > Employees > Payroll Settings.`
      }
    }
    if (!payrollCalendarId) {
      configGuidance = 'No payroll calendar found in Xero. To set one up: (1) Log in to Xero. (2) Go to Settings > Payroll Settings > Payroll Calendars. (3) Click Add Calendar, choose a name and calendar type (e.g. Monthly). (4) Set the period end date and payment date. (5) Click Save. (6) Go to Payroll > Employees, select each employee, click Pay Template, and assign the calendar. (7) Return to InflowHR and retry the push.'
    } else if (calendarType === 'UNKNOWN') {
      configGuidance = 'Could not read your Xero payroll calendar details. To fix: (1) Log in to Xero. (2) Go to Settings > Payroll Settings > Payroll Calendars. (3) Ensure at least one calendar exists and note its type (Weekly/Monthly). (4) Go to Payroll > Employees, select each employee, click Pay Template, and ensure a calendar is assigned. (5) If the calendar is Weekly but your InflowHR pay runs are Monthly, either change the Xero calendar to Monthly or set up weekly pay runs in InflowHR. (6) Return to InflowHR and retry.'
    }

    return json({
      api: isAU ? 'AU' : 'UK',
      pushed: pushedCount,
      failed: failedCount,
      skipped: skipped.length,
      timesheet_results: timesheetResults,
      manual_items: manualItems,
      skipped_details: skipped,
      xero_config: xeroConfig,
      config_guidance: configGuidance,
    })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
})
