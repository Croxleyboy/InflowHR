// POST /functions/v1/xero-payslips  { company_id }
// Fetches the most recent completed pay run and its payslips from Xero Payroll UK.
// Returns { payRun, payslips } with normalised fields.

import { getSupabase, getValidXeroToken, corsHeaders, json } from '../_shared/xero.ts'

const XERO_PAYROLL = 'https://api.xero.com/payroll.xro/2.0'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const sb = getSupabase()

    // Authenticate caller
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Unauthorized' }, 401)
    const { data: { user }, error: authErr } = await sb.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

    const { company_id } = await req.json()
    if (!company_id) return json({ error: 'company_id required' }, 400)

    // Verify caller has access to this company
    const { data: cu } = await sb
      .from('company_users')
      .select('role')
      .eq('auth_user_id', user.id)
      .eq('company_id', company_id)
      .eq('is_active', true)
      .maybeSingle()
    if (!cu) return json({ error: 'Access denied' }, 403)

    // Get valid token (auto-refreshes if expired)
    const creds = await getValidXeroToken(company_id)
    if (!creds) return json({ error: 'Xero not connected — please connect first' }, 400)

    const headers = {
      Authorization: `Bearer ${creds.accessToken}`,
      'xero-tenant-id': creds.tenantId,
      Accept: 'application/json',
    }

    // Fetch pay runs — UK Payroll API v2 returns camelCase fields
    const payRunsRes = await fetch(`${XERO_PAYROLL}/PayRuns?page=1`, { headers })
    if (!payRunsRes.ok) {
      const errText = await payRunsRes.text()
      console.error('PayRuns fetch failed:', errText)
      return json({ error: 'Failed to fetch pay runs from Xero' }, 502)
    }

    const payRunsData = await payRunsRes.json()
    const payRuns = payRunsData.payRuns || []

    if (!payRuns.length) {
      return json({ payRun: null, payslips: [] })
    }

    // Use the most recent posted pay run, or fall back to the first one
    // Sort by periodEndDate descending to get the most recent
    payRuns.sort((a: Record<string, string>, b: Record<string, string>) =>
      (b.periodEndDate || '').localeCompare(a.periodEndDate || '')
    )
    const completedRun = payRuns.find((r: Record<string, string>) => r.payRunStatus === 'Posted') || payRuns[0]

    // Fetch payslips for this pay run
    const payslipsRes = await fetch(`${XERO_PAYROLL}/PaySlips?PayRunID=${completedRun.payRunID}`, { headers })
    if (!payslipsRes.ok) {
      const errText = await payslipsRes.text()
      console.error('Payslips fetch failed:', errText)
      return json({ error: 'Failed to fetch payslips from Xero' }, 502)
    }

    const payslipsData = await payslipsRes.json()
    const rawSlips = payslipsData.paySlips || payslipsData.payslips || []

    // Normalise to a clean shape for the frontend (UK API uses camelCase)
    const payslips = rawSlips.map((s: Record<string, unknown>) => ({
      payslip_id: s.paySlipID || s.payslipID,
      employee_id: s.employeeID,
      first_name: s.firstName,
      last_name: s.lastName,
      gross_earnings: s.grossEarnings ?? s.totalEarnings ?? 0,
      net_pay: s.netPay ?? 0,
      tax: s.tax ?? s.totalTax ?? 0,
      employee_ni: s.employeesNationalInsurance ?? s.employeeNI ?? 0,
      employer_ni: s.employersNationalInsurance ?? s.employerNI ?? 0,
      student_loan: s.studentLoanDeductions ?? 0,
    }))

    // Update last_sync_at
    await sb.from('xero_integrations').update({
      last_sync_at: new Date().toISOString(),
      sync_status: 'connected',
      sync_error: null,
      updated_at: new Date().toISOString(),
    }).eq('company_id', company_id)

    return json({
      payRun: {
        id: completedRun.payRunID,
        period_start: completedRun.periodStartDate,
        period_end: completedRun.periodEndDate,
        payment_date: completedRun.paymentDate,
        status: completedRun.payRunStatus,
      },
      payslips,
    })
  } catch (err) {
    console.error('xero-payslips error:', err)
    return json({ error: (err as Error).message }, 500)
  }
})
