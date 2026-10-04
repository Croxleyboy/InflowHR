import { getSupabase, getValidXeroToken, corsHeaders, json } from '../_shared/xero.ts'

const XERO_PAYROLL_UK = 'https://api.xero.com/payroll.xro/1.0'
const XERO_PAYROLL_AU = 'https://api.xero.com/payroll.xro/2.0'
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function sanitiseXeroError(raw: string): string {
  return raw.slice(0, 500).replace(/[<>"'&]/g, '')
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

    const { company_id, period_start, period_end } = await req.json()
    if (!company_id) return json({ error: 'company_id required' }, 400)
    if (!period_start || !period_end) return json({ error: 'period_start and period_end required' }, 400)

    if (!DATE_RE.test(period_start) || !DATE_RE.test(period_end)) {
      return json({ error: 'period_start and period_end must be YYYY-MM-DD' }, 400)
    }
    if (isNaN(Date.parse(period_start)) || isNaN(Date.parse(period_end))) {
      return json({ error: 'Invalid date values' }, 400)
    }

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

    // Detect UK vs AU API
    let baseUrl = XERO_PAYROLL_UK
    const testRes = await fetch(`${baseUrl}/PayRuns`, {
      headers: { Authorization: xeroHeaders.Authorization, 'xero-tenant-id': xeroHeaders['xero-tenant-id'], Accept: 'application/json' },
    })
    if (!testRes.ok) {
      const errText = await testRes.text()
      if (errText.includes('AU Customer') || errText.includes('ValidationException')) {
        baseUrl = XERO_PAYROLL_AU
      } else {
        return json({ error: 'Failed to connect to Xero Payroll API', detail: sanitiseXeroError(errText) }, 502)
      }
    }

    // Fetch approved period reviews for this period
    const { data: reviews, error: revErr } = await sb
      .from('pay_period_reviews')
      .select('id, employee_id, total_hours, adjusted_hours, overtime_hours, hourly_rate, gross_pay, status, xero_timesheet_id')
      .eq('company_id', company_id)
      .eq('period_start', period_start)
      .eq('period_end', period_end)
      .in('status', ['approved', 'exported'])

    if (revErr) return json({ error: 'Failed to load period reviews', detail: revErr.message }, 500)
    if (!reviews?.length) return json({ error: 'No approved period reviews found for this period' }, 404)

    // Load employees with xero_employee_id
    const employeeIds = reviews.map(r => r.employee_id)
    const { data: employees } = await sb
      .from('employees')
      .select('id, first_name, last_name, xero_employee_id, hourly_rate')
      .in('id', employeeIds)

    const empMap: Record<string, { xeroId: string | null; name: string; rate: number }> = {}
    for (const e of (employees || [])) {
      empMap[e.id] = {
        xeroId: e.xero_employee_id,
        name: `${e.first_name} ${e.last_name}`,
        rate: e.hourly_rate || 0,
      }
    }

    // Get or fetch payroll calendar ID
    const { data: xeroIntegration } = await sb
      .from('xero_integrations')
      .select('payroll_calendar_id')
      .eq('company_id', company_id)
      .single()

    let payrollCalendarId = xeroIntegration?.payroll_calendar_id

    if (!payrollCalendarId) {
      const calUrl = `${baseUrl}/PayrollCalendars`
      const calRes = await fetch(calUrl, {
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
      if (!payrollCalendarId && baseUrl === XERO_PAYROLL_UK) {
        return json({ error: 'No payroll calendar found in Xero. Please set one up in Xero first.' }, 400)
      }
    }

    // Get or auto-detect earning rate mapping
    const { data: rateMappings } = await sb
      .from('xero_earning_rate_mappings')
      .select('inflow_rate_name, xero_earnings_rate_id')
      .eq('company_id', company_id)

    let defaultEarningsRateId = rateMappings?.find(m => m.inflow_rate_name === 'default')?.xero_earnings_rate_id

    if (!defaultEarningsRateId) {
      // Try /EarningsRates first (works for both UK v1 and AU v2), fall back to /PayItems (AU v1)
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

        // Prefer "Ordinary Time" or "Regular" earnings rate
        const ordinaryRate = rates.find(r => {
          const name = (r.Name || r.name || '').toUpperCase()
          const etype = (r.EarningsType || r.earningsType || '').toUpperCase()
          return name.includes('ORDINARY') || name.includes('REGULAR') || name.includes('STANDARD')
            || etype === 'ORDINARYTIMEEARNINGS' || etype === 'REGULAREARNINGS'
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
      if (!defaultEarningsRateId) {
        return json({ error: 'No earning rates found in Xero. Please set up at least one earning rate.' }, 400)
      }
    }

    // Push timesheets to Xero
    const results: { employee: string; status: string; xeroTimesheetId?: string; error?: string }[] = []
    const skipped: { employee: string; reason: string }[] = []

    for (const review of reviews) {
      const emp = empMap[review.employee_id]
      if (!emp) {
        skipped.push({ employee: review.employee_id, reason: 'Employee not found' })
        continue
      }
      if (!emp.xeroId) {
        skipped.push({ employee: emp.name, reason: 'No Xero employee mapping — run Fetch Payslips first to link employees' })
        continue
      }

      const hours = Number(review.adjusted_hours ?? review.total_hours ?? 0)
      if (hours <= 0) {
        skipped.push({ employee: emp.name, reason: 'No hours to push' })
        continue
      }

      // Build timesheet lines — one line per day, spread hours evenly across working days
      // For simplicity, create a single line with total hours on the period start date
      let timesheetPayload: Record<string, unknown>
      if (baseUrl === XERO_PAYROLL_UK) {
        timesheetPayload = {
          PayrollCalendarID: payrollCalendarId,
          EmployeeID: emp.xeroId,
          StartDate: period_start,
          EndDate: period_end,
          TimesheetLines: [{
            Date: period_start,
            EarningsRateID: defaultEarningsRateId,
            NumberOfUnits: hours,
          }],
        }
      } else {
        // AU v2: dates as ISO strings, numberOfUnits as daily array
        const start = new Date(period_start)
        const end = new Date(period_end)
        const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1)
        const dailyHours = new Array(days).fill(0)
        let weekdays = 0
        for (let i = 0; i < days; i++) {
          const d = new Date(start)
          d.setDate(d.getDate() + i)
          const dow = d.getDay()
          if (dow !== 0 && dow !== 6) weekdays++
        }
        const hoursPerDay = weekdays > 0 ? Math.round((hours / weekdays) * 100) / 100 : hours
        for (let i = 0; i < days; i++) {
          const d = new Date(start)
          d.setDate(d.getDate() + i)
          const dow = d.getDay()
          if (dow !== 0 && dow !== 6) dailyHours[i] = hoursPerDay
        }

        timesheetPayload = {
          payrollCalendarID: payrollCalendarId || undefined,
          employeeID: emp.xeroId,
          startDate: period_start,
          endDate: period_end,
          timesheetLines: [{
            earningsRateID: defaultEarningsRateId,
            numberOfUnits: dailyHours,
          }],
        }
      }

      // If already pushed, try to update
      if (review.xero_timesheet_id) {
        // Revert to draft first, then update
        const revertUrl = baseUrl === XERO_PAYROLL_UK
          ? `${baseUrl}/Timesheets/${review.xero_timesheet_id}/RevertToDraft`
          : null

        if (revertUrl) {
          await fetch(revertUrl, { method: 'POST', headers: xeroHeaders })
        }

        const updateUrl = `${baseUrl}/Timesheets/${review.xero_timesheet_id}`
        const updateRes = await fetch(updateUrl, {
          method: 'PUT',
          headers: xeroHeaders,
          body: JSON.stringify(timesheetPayload),
        })

        if (updateRes.ok) {
          results.push({ employee: emp.name, status: 'updated', xeroTimesheetId: review.xero_timesheet_id })
        } else {
          const errText = await updateRes.text()
          results.push({ employee: emp.name, status: 'update_failed', error: sanitiseXeroError(errText) })
        }
        continue
      }

      // Create new timesheet — AU v2 may expect array wrapper
      const tsUrl = `${baseUrl}/Timesheets`
      // Try single object first (works for UK v1 and some AU v2)
      let tsRes = await fetch(tsUrl, {
        method: 'POST',
        headers: xeroHeaders,
        body: JSON.stringify(timesheetPayload),
      })

      // If single object fails on AU, try array wrapper
      if (!tsRes.ok && baseUrl === XERO_PAYROLL_AU) {
        tsRes = await fetch(tsUrl, {
          method: 'POST',
          headers: xeroHeaders,
          body: JSON.stringify([timesheetPayload]),
        })
      }

      if (!tsRes.ok) {
        const errText = await tsRes.text()
        const debugInfo = `API: ${baseUrl}, Calendar: ${payrollCalendarId || 'none'}, EarningsRate: ${defaultEarningsRateId}, Period: ${period_start} to ${period_end}, Hours: ${hours}`
        results.push({ employee: emp.name, status: 'failed', error: `${sanitiseXeroError(errText)} [${debugInfo}]` })
        continue
      }

      const tsBody = await tsRes.json()
      const createdTs = tsBody.Timesheet || tsBody.timesheet ||
        (tsBody.Timesheets && tsBody.Timesheets[0]) ||
        (tsBody.timesheets && tsBody.timesheets[0])
      const xeroTimesheetId = createdTs?.TimesheetID || createdTs?.timesheetID

      if (xeroTimesheetId) {
        // Store the Xero timesheet ID and mark as exported
        await sb.from('pay_period_reviews').update({
          xero_timesheet_id: xeroTimesheetId,
          xero_pushed_at: new Date().toISOString(),
          status: 'exported',
        }).eq('id', review.id)

        results.push({ employee: emp.name, status: 'created', xeroTimesheetId })
      } else {
        results.push({ employee: emp.name, status: 'created_no_id' })
      }
    }

    // Record the export
    const successCount = results.filter(r => r.status === 'created' || r.status === 'updated').length
    const failedCount = results.filter(r => r.status === 'failed' || r.status === 'update_failed').length
    if (successCount > 0) {
      const totalGross = reviews
        .filter(r => empMap[r.employee_id]?.xeroId)
        .reduce((sum, r) => sum + Number(r.gross_pay || 0), 0)

      await sb.from('payroll_exports').insert({
        company_id,
        period_start,
        period_end,
        export_target: 'xero',
        employee_count: successCount,
        total_gross: totalGross,
        status: 'exported',
        exported_by: user.id,
        notes: `Pushed ${successCount} timesheet(s) to Xero`,
      })
    }

    // GDPR audit log — record third-party data transfer
    const auditDetail = `Xero timesheet push — Period: ${period_start} to ${period_end}. ` +
      `Pushed: ${successCount}, Failed: ${failedCount}, Skipped: ${skipped.length}. ` +
      `Data sent to Xero: employee IDs, worked hours, earning rate IDs.`
    await sb.from('payroll_audit_log').insert({
      company_id,
      user_id: user.id,
      action: 'Xero Timesheet Push',
      detail: auditDetail,
      status: failedCount > 0 && successCount === 0 ? 'error' : 'success',
    })

    return json({
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
