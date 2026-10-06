import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token'
const XERO_PAYROLL_V2 = 'https://api.xero.com/payroll.xro/2.0'

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
  if (!clientId || !clientSecret) {
    throw new Error('Missing XERO_CLIENT_ID or XERO_CLIENT_SECRET env vars')
  }
  return { clientId, clientSecret }
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

async function verifySuperAdmin(req: Request) {
  const sb = getSupabase()
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return { error: 'Unauthorized', status: 401 }

  const { data: { user }, error: authErr } = await sb.auth.getUser(
    authHeader.replace('Bearer ', '')
  )
  if (authErr || !user) return { error: 'Unauthorized', status: 401 }

  const { data: sa } = await sb
    .from('super_admins')
    .select('id')
    .eq('email', user.email)
    .maybeSingle()
  if (!sa) return { error: 'Super admin access required', status: 403 }

  return { user }
}

function getWeekdaysInRange(startDate: string, endDate: string): string[] {
  const days: string[] = []
  const start = new Date(startDate.split('T')[0])
  const end = new Date(endDate.split('T')[0])
  const current = new Date(start)
  while (current < end) {
    const dow = current.getDay()
    if (dow >= 1 && dow <= 5) {
      days.push(current.toISOString().split('T')[0])
    }
    current.setDate(current.getDate() + 1)
  }
  return days
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const auth = await verifySuperAdmin(req)
    if ('error' in auth) return json({ error: auth.error }, auth.status)

    const body = await req.json()
    const { action, company_id, pay_run_id, payslip_id, payload } = body

    if (!company_id) return json({ error: 'company_id required' }, 400)
    if (!action) return json({ error: 'action required' }, 400)

    const creds = await getValidXeroToken(company_id)
    if (!creds) return json({ error: 'Xero not connected — please connect first' }, 400)

    const xeroHeaders: Record<string, string> = {
      Authorization: `Bearer ${creds.accessToken}`,
      'xero-tenant-id': creds.tenantId,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }

    // ── Fetch pay items (earnings rates, deduction types, etc.) ──
    if (action === 'fetch_payitems') {
      const endpoints = [
        { key: 'earningsRates', path: 'EarningsRates' },
        { key: 'deductionTypes', path: 'DeductionTypes' },
        { key: 'benefitTypes', path: 'BenefitTypes' },
        { key: 'reimbursementTypes', path: 'ReimbursementTypes' },
        { key: 'leaveTypes', path: 'LeaveTypes' },
      ]
      const payItems: Record<string, any> = {}
      const errors: Record<string, number> = {}

      for (const ep of endpoints) {
        try {
          const res = await fetch(`${XERO_PAYROLL_V2}/${ep.path}`, { headers: xeroHeaders })
          if (res.ok) {
            const d = await res.json()
            payItems[ep.key] = d[ep.key] || d[ep.path] || d
          } else {
            errors[ep.key] = res.status
          }
        } catch { errors[ep.key] = 0 }
      }

      return json({
        action: 'fetch_payitems',
        status: 200,
        urls: endpoints.map(e => `${XERO_PAYROLL_V2}/${e.path}`),
        data: { payItems },
        errors: Object.keys(errors).length ? errors : undefined,
      })
    }

    // ── Fetch all pay runs with payslip IDs ──
    if (action === 'fetch_payruns') {
      const url = `${XERO_PAYROLL_V2}/PayRuns`
      const res = await fetch(url, { headers: xeroHeaders })
      const text = await res.text()
      let data: any
      try { data = JSON.parse(text) } catch { data = text }

      if (res.ok && data?.payRuns?.length) {
        for (const pr of data.payRuns) {
          try {
            const detailRes = await fetch(`${XERO_PAYROLL_V2}/PayRuns/${pr.payRunID}`, { headers: xeroHeaders })
            if (detailRes.ok) {
              const detail = await detailRes.json()
              pr.paySlips = detail?.payRun?.paySlips || []
            }
          } catch { /* skip detail fetch errors */ }
        }
      }

      return json({
        action: 'fetch_payruns',
        status: res.status,
        url,
        data,
      })
    }

    // ── Get a specific payslip ──
    if (action === 'get_payslip') {
      if (!payslip_id) return json({ error: 'payslip_id required for get_payslip' }, 400)

      const url = `${XERO_PAYROLL_V2}/Payslips/${payslip_id}`
      const res = await fetch(url, { headers: xeroHeaders })
      const text = await res.text()
      let data
      try { data = JSON.parse(text) } catch { data = text }
      return json({
        action: 'get_payslip',
        status: res.status,
        url,
        data,
      })
    }

    // ── Update payslip via Timesheets/Lines (confirmed working endpoint) ──
    if (action === 'update_payslip') {
      if (!payslip_id) return json({ error: 'payslip_id required for update_payslip' }, 400)
      if (!payload) return json({ error: 'payload required for update_payslip' }, 400)

      const inner = payload.PaySlip || payload
      const earningsLines = inner.EarningsLines || inner.earningsLines || []
      const employeeID = inner.EmployeeID || inner.employeeID || '2424fa8a-c41f-4f22-b655-46c6e1262945'

      // Step 1: Find the employee's timesheets
      const tsListRes = await fetch(`${XERO_PAYROLL_V2}/Timesheets`, { headers: xeroHeaders })
      let tsListData: any = null
      if (tsListRes.ok) {
        tsListData = await tsListRes.json()
      }

      const employeeTimesheets = (tsListData?.timesheets || []).filter(
        (ts: any) => ts.employeeID === employeeID
      )

      if (!employeeTimesheets.length) {
        return json({
          action: 'update_payslip',
          error: 'No timesheets found for this employee',
          allTimesheets: tsListData?.timesheets,
        })
      }

      // Use the first (current period) timesheet
      const ts = employeeTimesheets[0]
      const timesheetID = ts.timesheetID
      const weekdays = getWeekdaysInRange(ts.startDate, ts.endDate)

      // Step 2: GET the timesheet detail to see existing lines
      const detailRes = await fetch(`${XERO_PAYROLL_V2}/Timesheets/${timesheetID}`, { headers: xeroHeaders })
      let timesheetDetail: any = null
      if (detailRes.ok) {
        timesheetDetail = await detailRes.json()
      }

      // Step 3: POST each earnings line to /Timesheets/{id}/Lines
      // Spread hours across weekdays (max 24hrs per day)
      const lineResults: any[] = []
      let dayIndex = 0

      for (const line of earningsLines) {
        const earningsRateID = line.EarningsRateID || line.earningsRateID
        const totalUnits = line.NumberOfUnits ?? line.numberOfUnits ?? 0
        if (!earningsRateID || totalUnits <= 0) continue

        // Spread hours across weekdays, max 8hrs per day per line
        let remaining = totalUnits
        while (remaining > 0 && dayIndex < weekdays.length) {
          const units = Math.min(remaining, 8)
          const lineBody = {
            date: weekdays[dayIndex],
            earningsRateID,
            numberOfUnits: units,
          }

          const res = await fetch(
            `${XERO_PAYROLL_V2}/Timesheets/${timesheetID}/Lines`,
            {
              method: 'POST',
              headers: xeroHeaders,
              body: JSON.stringify(lineBody),
            }
          )
          const text = await res.text()
          let data
          try { data = JSON.parse(text) } catch { data = text }
          lineResults.push({
            earningsRateID,
            date: weekdays[dayIndex],
            numberOfUnits: units,
            status: res.status,
            success: res.ok,
            data,
          })

          remaining -= units
          if (remaining > 0) dayIndex++
        }
        dayIndex++
      }

      const successes = lineResults.filter(r => r.success)
      const failures = lineResults.filter(r => !r.success)

      return json({
        action: 'update_payslip',
        timesheetID,
        timesheetPeriod: `${ts.startDate} to ${ts.endDate}`,
        weekdaysAvailable: weekdays.length,
        totalLinesPosted: lineResults.length,
        successes: successes.length,
        failures: failures.length,
        note: failures.length === 0
          ? `All ${successes.length} timesheet lines added successfully via POST /Timesheets/{id}/Lines`
          : `${successes.length} succeeded, ${failures.length} failed`,
        lineResults,
        timesheetDetail,
      })
    }

    return json({ error: `Unknown action: ${action}` }, 400)
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})
