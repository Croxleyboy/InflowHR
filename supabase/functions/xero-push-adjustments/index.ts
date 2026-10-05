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

    if (!payrollCalendarId) {
      const calRes = await fetch(`${baseUrl}/PayrollCalendars`, {
        headers: { Authorization: xeroHeaders.Authorization, 'xero-tenant-id': xeroHeaders['xero-tenant-id'], Accept: 'application/json' },
      })
      if (calRes.ok) {
        const calBody = await calRes.json()
        const calendars = calBody.PayrollCalendars || calBody.payrollCalendars
          || calBody.PayCalendars || calBody.payCalendars || []
        if (calendars.length) {
          payrollCalendarId = calendars[0].PayrollCalendarID || calendars[0].payrollCalendarID
            || calendars[0].PayCalendarID || calendars[0].payCalendarID
          await sb.from('xero_integrations').update({ payroll_calendar_id: payrollCalendarId }).eq('company_id', company_id)
        }
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
          const tsStart = String(ts.StartDate || ts.startDate || '').slice(0, 10)
          const tsEnd = String(ts.EndDate || ts.endDate || '').slice(0, 10)
          if (tsStart === periodStart || tsEnd === periodEnd) {
            existingTimesheetId = ts.TimesheetID || ts.timesheetID
            break
          }
        }
      }

      const empCalForDebug = isAU ? (empCalendarCache[emp.xeroId!] || payrollCalendarId || 'none') : (payrollCalendarId || 'none')
      const debugInfo = `API: ${isAU ? 'AU-v2' : 'UK-v1'}, Calendar: ${empCalForDebug}, EarningsRate: ${defaultEarningsRateId}, Period: ${periodStart} to ${periodEnd}, Hours: ${ot.hours}, ExistingTS: ${existingTimesheetId || 'none'}`

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
          timesheetPayload = {
            payrollCalendarID: empCalId || payrollCalendarId,
            employeeID: emp.xeroId,
            startDate: periodStart,
            endDate: periodEnd,
            timesheetLines: [{
              date: periodStart,
              earningsRateID: defaultEarningsRateId,
              numberOfUnits: ot.hours,
            }],
          }
        } else {
          timesheetPayload = {
            PayrollCalendarID: payrollCalendarId,
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
          const ukPayload = {
            PayrollCalendarID: payrollCalendarId,
            EmployeeID: emp.xeroId,
            StartDate: periodStart,
            EndDate: periodEnd,
            TimesheetLines: [{
              Date: periodStart,
              EarningsRateID: defaultEarningsRateId,
              NumberOfUnits: ot.hours,
            }],
          }
          tsRes = await fetch(`${XERO_PAYROLL_UK}/Timesheets`, {
            method: 'POST',
            headers: xeroHeaders,
            body: JSON.stringify(ukPayload),
          })
        }
      }

      if (!tsRes.ok) {
        const errText = await tsRes.text()
        timesheetResults.push({
          employee: emp.name,
          status: 'failed',
          hours: ot.hours,
          multiplier: ot.multiplier,
          rate: emp.hourlyRate,
          amount: overtimeAmount,
          error: `${sanitise(errText)} [${debugInfo}]`,
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

    return json({
      api: isAU ? 'AU' : 'UK',
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
