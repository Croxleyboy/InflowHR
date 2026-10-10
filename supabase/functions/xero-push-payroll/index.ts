import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token'
const XERO_PAYROLL_UK = 'https://api.xero.com/payroll.xro/1.0'
const XERO_PAYROLL_AU = 'https://api.xero.com/payroll.xro/2.0'
const XERO_PAYROLL_UK_V2 = 'https://api.xero.com/payroll.xro/2.0'

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

interface OvertimeEntry {
  employee_id: string
  hours: number
  multiplier: number
  hourly_rate_override?: number
}

interface RegularHoursEntry {
  employee_id: string
  hours: number
  hourly_rate: number
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
    const { company_id, pay_run_id, period_start, period_end, overtime, regular_hours, unpaid_leave, benefit_changes } = body as {
      company_id: string
      pay_run_id: string
      period_start: string
      period_end: string
      overtime: OvertimeEntry[]
      regular_hours: RegularHoursEntry[]
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

    // Detect UK vs AU API — try UK v1 first, fall back to AU
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

    // Collect all employee IDs from all entry types
    const allEmpIds = new Set<string>()
    for (const o of (overtime || [])) allEmpIds.add(o.employee_id)
    for (const r of (regular_hours || [])) allEmpIds.add(r.employee_id)
    for (const u of (unpaid_leave || [])) allEmpIds.add(u.employee_id)
    for (const b of (benefit_changes || [])) allEmpIds.add(b.employee_id)

    const { data: employees } = await sb
      .from('employees')
      .select('id, first_name, last_name, xero_employee_id, hourly_rate, annual_salary, employment_category, contract_type')
      .in('id', [...allEmpIds])

    const empMap: Record<string, {
      xeroId: string | null
      name: string
      hourlyRate: number
      annualSalary: number
      isZeroHours: boolean
    }> = {}
    for (const e of (employees || [])) {
      empMap[e.id] = {
        xeroId: e.xero_employee_id,
        name: `${e.first_name} ${e.last_name}`,
        hourlyRate: e.hourly_rate || 0,
        annualSalary: e.annual_salary || 0,
        isZeroHours: e.employment_category === 'shift_worker' && e.contract_type === 'Zero hours shift worker',
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
      let rates: any[] = []
      const rateRes = await fetch(`${XERO_PAYROLL_UK_V2}/EarningsRates`, { headers: xeroHeaders })
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

      if (!rates.length && isUK) {
        const v1RateRes = await fetch(`${XERO_PAYROLL_UK}/EarningsRates`, { headers: xeroHeaders })
        if (v1RateRes.ok) {
          const v1Body = await v1RateRes.json()
          rates = v1Body.EarningsRates || v1Body.earningsRates || []
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

    // Get payroll calendar ID
    const { data: xeroIntegration } = await sb
      .from('xero_integrations')
      .select('payroll_calendar_id')
      .eq('company_id', company_id)
      .single()

    let companyCalendarId = xeroIntegration?.payroll_calendar_id

    if (!companyCalendarId) {
      const calRes = await fetch(`${XERO_PAYROLL_UK_V2}/PayrollCalendars`, { headers: xeroHeaders })
      if (calRes.ok) {
        const calBody = await calRes.json()
        const calendars = calBody.PayrollCalendars || calBody.payrollCalendars
          || calBody.PayCalendars || calBody.payCalendars || []
        if (calendars.length) {
          companyCalendarId = calendars[0].PayrollCalendarID || calendars[0].payrollCalendarID
            || calendars[0].PayCalendarID || calendars[0].payCalendarID
            || calendars[0].calendarID || calendars[0].CalendarID
          await sb.from('xero_integrations').update({ payroll_calendar_id: companyCalendarId }).eq('company_id', company_id)
        }
      }
    }

    // Cache for per-employee payroll calendar lookups
    const empCalendarCache: Record<string, string | null> = {}
    async function getEmployeeCalendarId(xeroEmployeeId: string): Promise<string | null> {
      if (empCalendarCache[xeroEmployeeId] !== undefined) return empCalendarCache[xeroEmployeeId]
      if (companyCalendarId) { empCalendarCache[xeroEmployeeId] = companyCalendarId; return companyCalendarId }
      const empRes = await fetch(`${XERO_PAYROLL_UK_V2}/Employees/${xeroEmployeeId}`, { headers: xeroHeaders })
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
      regular_hours?: number
      regular_amount?: number
      method?: string
      earningsRateId?: string
      lines_posted?: number
      payTemplateEarningID?: string
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

    // Build a map of regular hours per employee (for zero hours workers)
    const regularHoursMap: Record<string, RegularHoursEntry> = {}
    for (const rh of (regular_hours || [])) {
      regularHoursMap[rh.employee_id] = rh
    }

    // Build a map of overtime per employee
    const overtimeMap: Record<string, OvertimeEntry> = {}
    for (const ot of (overtime || [])) {
      overtimeMap[ot.employee_id] = ot
    }

    // Collect all unique employee IDs that need processing (regular + overtime)
    const processEmpIds = new Set<string>()
    for (const ot of (overtime || [])) processEmpIds.add(ot.employee_id)
    for (const rh of (regular_hours || [])) processEmpIds.add(rh.employee_id)

    for (const empId of processEmpIds) {
      const emp = empMap[empId]
      if (!emp) { skipped.push({ employee: empId, reason: 'Employee not found' }); continue }
      if (!emp.xeroId) { skipped.push({ employee: emp.name, reason: 'No Xero employee mapping — sync employees first' }); continue }

      const ot = overtimeMap[empId]
      const rh = regularHoursMap[empId]

      const otHours = ot?.hours || 0
      const rhHours = rh?.hours || 0

      if (otHours <= 0 && rhHours <= 0) {
        skipped.push({ employee: emp.name, reason: 'No hours to push' })
        continue
      }

      const baseRate = ot?.hourly_rate_override && ot.hourly_rate_override > 0
        ? ot.hourly_rate_override
        : rh?.hourly_rate && rh.hourly_rate > 0
          ? rh.hourly_rate
          : emp.hourlyRate > 0
            ? emp.hourlyRate
            : emp.annualSalary > 0
              ? Math.round(emp.annualSalary / (52 * 37.5) * 100) / 100
              : 0

      const overtimeMultiplier = ot?.multiplier || 1.5
      const overtimeRate = Math.round(baseRate * overtimeMultiplier * 100) / 100
      const overtimeAmount = Math.round(overtimeRate * otHours * 100) / 100
      const regularAmount = Math.round(baseRate * rhHours * 100) / 100

      // ── ZERO HOURS WORKERS: Push combined timesheet (regular + overtime) ──
      if (emp.isZeroHours) {
        const calId = companyCalendarId || await getEmployeeCalendarId(emp.xeroId!)
        if (!calId) {
          skipped.push({ employee: emp.name, reason: 'No payroll calendar assigned in Xero — assign one before pushing timesheets' })
          continue
        }

        const start = new Date(period_start)
        const end = new Date(period_end)
        const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1)

        let weekdays = 0
        for (let i = 0; i < days; i++) {
          const d = new Date(start)
          d.setDate(d.getDate() + i)
          const dow = d.getDay()
          if (dow !== 0 && dow !== 6) weekdays++
        }

        // v2 (camelCase): one line PER DAY per earnings rate, each with date + numberOfUnits (single number)
        function buildPerDayLines(totalHours: number, earningsRateId: string): Record<string, unknown>[] {
          const lines: Record<string, unknown>[] = []
          if (totalHours <= 0 || weekdays <= 0) return lines
          const perDay = Math.round((totalHours / weekdays) * 100) / 100
          for (let i = 0; i < days; i++) {
            const d = new Date(start)
            d.setDate(d.getDate() + i)
            const dow = d.getDay()
            if (dow !== 0 && dow !== 6) {
              const yyyy = d.getFullYear()
              const mm = String(d.getMonth() + 1).padStart(2, '0')
              const dd = String(d.getDate()).padStart(2, '0')
              lines.push({ date: `${yyyy}-${mm}-${dd}`, earningsRateID: earningsRateId, numberOfUnits: perDay })
            }
          }
          return lines
        }

        // v1 UK: one line per earnings rate, Date field, NumberOfUnits as single number (matches xero-push-timesheets)
        const v1Lines: Record<string, unknown>[] = []
        if (rhHours > 0) v1Lines.push({ Date: period_start, EarningsRateID: regularRateId!, NumberOfUnits: rhHours })
        if (otHours > 0) v1Lines.push({ Date: period_start, EarningsRateID: effectiveOtRateId, NumberOfUnits: otHours })

        const v2Lines: Record<string, unknown>[] = [
          ...buildPerDayLines(rhHours, regularRateId!),
          ...buildPerDayLines(otHours, effectiveOtRateId),
        ]

        const v1Payload = {
          PayrollCalendarID: calId,
          EmployeeID: emp.xeroId,
          StartDate: period_start,
          EndDate: period_end,
          TimesheetLines: v1Lines,
        }
        const v2Payload = {
          payrollCalendarID: calId,
          employeeID: emp.xeroId,
          startDate: period_start,
          endDate: period_end,
          timesheetLines: v2Lines,
        }

        // Try v1 (UK PascalCase) first
        let tsRes = await fetch(`${XERO_PAYROLL_UK}/Timesheets`, {
          method: 'POST',
          headers: xeroHeaders,
          body: JSON.stringify(v1Payload),
        })
        let v1Error = ''
        if (!tsRes.ok) {
          v1Error = await tsRes.text()
        }

        // Try v2 (camelCase, per-day lines)
        if (!tsRes.ok) {
          tsRes = await fetch(`${XERO_PAYROLL_UK_V2}/Timesheets`, {
            method: 'POST',
            headers: xeroHeaders,
            body: JSON.stringify(v2Payload),
          })
        }

        if (tsRes.ok) {
          const tsBody = await tsRes.json()
          const createdTs = tsBody.timesheet || tsBody.Timesheet
            || (tsBody.timesheets && tsBody.timesheets[0])
            || (tsBody.Timesheets && tsBody.Timesheets[0])
          const xeroTimesheetId = createdTs?.timesheetID || createdTs?.TimesheetID

          // Store the Xero timesheet ID on the period review
          if (xeroTimesheetId) {
            await sb.from('pay_period_reviews').update({
              xero_timesheet_id: xeroTimesheetId,
              xero_pushed_at: new Date().toISOString(),
              status: 'exported',
            }).eq('company_id', company_id)
              .eq('employee_id', empId)
              .eq('period_start', period_start)
              .eq('period_end', period_end)
          }

          timesheetResults.push({
            employee: emp.name,
            status: 'pushed',
            hours: otHours,
            multiplier: overtimeMultiplier,
            rate: baseRate,
            amount: overtimeAmount,
            regular_hours: rhHours,
            regular_amount: regularAmount,
            method: 'timesheet',
            earningsRateId: regularRateId!,
            lines_posted: v1Lines.length + v2Lines.length,
          })
        } else {
          const errText = await tsRes.text()
          const v2Error = await tsRes.text()
          const debugInfo = `v1(${XERO_PAYROLL_UK}/Timesheets): ${sanitise(v1Error).slice(0, 200)} | v2(${XERO_PAYROLL_UK_V2}/Timesheets): ${sanitise(v2Error).slice(0, 200)} | Calendar: ${calId}, EarningsRate: ${regularRateId}, Period: ${period_start} to ${period_end}, RegHrs: ${rhHours}, OtHrs: ${otHours}, v2Lines: ${v2Lines.length}`
          timesheetResults.push({
            employee: emp.name,
            status: 'failed',
            hours: otHours,
            multiplier: overtimeMultiplier,
            rate: baseRate,
            amount: overtimeAmount,
            regular_hours: rhHours,
            regular_amount: regularAmount,
            method: 'timesheet',
            error: `Timesheet push failed [${debugInfo}]`,
          })
        }

        continue
      }

      // ── SALARIED / EMPLOYED SHIFT WORKERS: Use Pay Template Earnings for overtime only ──
      if (otHours <= 0) {
        skipped.push({ employee: emp.name, reason: 'No overtime hours' })
        continue
      }

      const payTemplateBaseUrl = isUK ? XERO_PAYROLL_UK_V2 : baseUrl

      let existingOtLineId: string | null = null
      const ptRes = await fetch(
        `${payTemplateBaseUrl}/Employees/${emp.xeroId}/PayTemplates`,
        { headers: xeroHeaders }
      )
      if (ptRes.ok) {
        const ptBody = await ptRes.json()
        const payTemplate = ptBody.payTemplate || ptBody.PayTemplate || {}
        const earningsLines = payTemplate.earningTemplates || payTemplate.EarningTemplates
          || payTemplate.earningsLines || payTemplate.EarningsLines || []
        const existingOtLine = earningsLines.find((line: any) => {
          const lineRateId = line.earningsRateID || line.EarningsRateID
          return lineRateId === effectiveOtRateId
        })
        if (existingOtLine) {
          existingOtLineId = existingOtLine.payTemplateEarningID || existingOtLine.PayTemplateEarningID
        }
      }

      const earningsTemplateBody = {
        earningsRateID: effectiveOtRateId,
        numberOfUnits: otHours,
      }

      let ptPushRes: Response

      if (existingOtLineId) {
        ptPushRes = await fetch(
          `${payTemplateBaseUrl}/Employees/${emp.xeroId}/PayTemplates/earnings/${existingOtLineId}`,
          {
            method: 'PUT',
            headers: xeroHeaders,
            body: JSON.stringify(earningsTemplateBody),
          }
        )
      } else {
        ptPushRes = await fetch(
          `${payTemplateBaseUrl}/Employees/${emp.xeroId}/PayTemplates/earnings`,
          {
            method: 'POST',
            headers: xeroHeaders,
            body: JSON.stringify(earningsTemplateBody),
          }
        )
      }

      if (ptPushRes.ok) {
        const ptResult = await ptPushRes.json()
        const createdLine = ptResult.earningTemplate || ptResult.EarningTemplate
          || ptResult.earningsLine || ptResult.EarningsLine || {}
        const newLineId = createdLine.payTemplateEarningID || createdLine.PayTemplateEarningID || existingOtLineId

        timesheetResults.push({
          employee: emp.name,
          status: 'pushed',
          hours: otHours,
          multiplier: overtimeMultiplier,
          rate: baseRate,
          amount: overtimeAmount,
          method: 'pay_template',
          earningsRateId: effectiveOtRateId,
          payTemplateEarningID: newLineId || undefined,
        })
      } else {
        const errText = await ptPushRes.text()
        timesheetResults.push({
          employee: emp.name,
          status: 'failed',
          hours: otHours,
          multiplier: overtimeMultiplier,
          rate: baseRate,
          amount: overtimeAmount,
          method: 'pay_template',
          error: sanitise(errText) || 'Pay template push failed',
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
    const templatePushed = timesheetResults.filter(r => r.status === 'pushed' && r.method === 'pay_template').length
    const timesheetPushed = timesheetResults.filter(r => r.status === 'pushed' && r.method === 'timesheet').length
    const auditDetail = `Xero payroll push (${isUK ? 'UK' : 'AU'}) — Pay run: ${pay_run_id}, Period: ${period_start} to ${period_end}. ` +
      `Salaried overtime via pay template: ${templatePushed}, Zero hours via timesheet (regular + overtime): ${timesheetPushed}, ` +
      `Failed: ${failedCount}, Skipped: ${skipped.length}. ` +
      `Manual items flagged: ${manualItems.length} (unpaid leave: ${(unpaid_leave || []).length}, benefit changes: ${(benefit_changes || []).length}). ` +
      `Data sent to Xero: employee IDs, worked hours, earning rate IDs.`
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
