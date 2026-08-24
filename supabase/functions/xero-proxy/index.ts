import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token'
const XERO_PAYROLL_BASE = 'https://api.xero.com/payroll.xro/2.0'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Missing auth' }, 401)

    const { data: { user }, error: authErr } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

    const body = await req.json()
    const { action, company_id } = body

    // Verify user has access to company
    const { data: cu } = await supabase
      .from('company_users')
      .select('role')
      .eq('auth_user_id', user.id)
      .eq('company_id', company_id)
      .eq('is_active', true)
      .maybeSingle()

    if (!cu || (cu.role !== 'admin' && cu.role !== 'hr')) {
      // Check super admin
      const { data: sa } = await supabase.rpc('is_super_admin_check', { p_user_id: user.id })
      if (!sa) return json({ error: 'Access denied' }, 403)
    }

    // Load xero config for company
    const { data: config } = await supabase
      .from('company_xero_config')
      .select('*')
      .eq('company_id', company_id)
      .single()

    if (!config) return json({ error: 'Xero not configured for this company' }, 400)

    switch (action) {
      case 'get_auth_url': {
        const scopes = 'openid profile email payroll.employees payroll.payruns payroll.payslip payroll.settings offline_access'
        const state = crypto.randomUUID()
        const url = `https://login.xero.com/identity/connect/authorize?response_type=code&client_id=${encodeURIComponent(config.client_id)}&redirect_uri=${encodeURIComponent(config.redirect_uri)}&scope=${encodeURIComponent(scopes)}&state=${state}`
        return json({ url, state })
      }

      case 'exchange_code': {
        const { code } = body
        if (!code) return json({ error: 'Missing authorization code' }, 400)

        const tokenRes = await fetch(XERO_TOKEN_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + btoa(`${config.client_id}:${config.client_secret}`),
          },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: config.redirect_uri,
          }),
        })

        const tokens = await tokenRes.json()
        if (!tokenRes.ok) return json({ error: tokens.error || 'Token exchange failed' }, 400)

        const expiresAt = new Date(Date.now() + (tokens.expires_in || 1800) * 1000).toISOString()

        await supabase.from('company_xero_config').update({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          token_expires_at: expiresAt,
          sync_status: 'connected',
          sync_error: null,
          updated_at: new Date().toISOString(),
        }).eq('company_id', company_id)

        return json({ success: true, status: 'connected' })
      }

      case 'sync_payslips': {
        let accessToken = config.access_token
        if (!accessToken) return json({ error: 'Not connected to Xero' }, 400)

        // Refresh token if expired
        if (config.token_expires_at && new Date(config.token_expires_at) <= new Date()) {
          const refreshRes = await fetch(XERO_TOKEN_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Authorization': 'Basic ' + btoa(`${config.client_id}:${config.client_secret}`),
            },
            body: new URLSearchParams({
              grant_type: 'refresh_token',
              refresh_token: config.refresh_token || '',
            }),
          })

          const tokens = await refreshRes.json()
          if (!refreshRes.ok) {
            await supabase.from('company_xero_config').update({
              sync_status: 'error',
              sync_error: 'Token refresh failed — please reconnect',
              updated_at: new Date().toISOString(),
            }).eq('company_id', company_id)
            return json({ error: 'Token refresh failed' }, 401)
          }

          accessToken = tokens.access_token
          await supabase.from('company_xero_config').update({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token || config.refresh_token,
            token_expires_at: new Date(Date.now() + (tokens.expires_in || 1800) * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          }).eq('company_id', company_id)
        }

        await supabase.from('company_xero_config').update({
          sync_status: 'syncing',
          updated_at: new Date().toISOString(),
        }).eq('company_id', company_id)

        const xeroHeaders = {
          'Authorization': `Bearer ${accessToken}`,
          'xero-tenant-id': config.tenant_id,
          'Accept': 'application/json',
        }

        // Fetch pay runs
        const payRunsRes = await fetch(`${XERO_PAYROLL_BASE}/PayRuns`, { headers: xeroHeaders })
        if (!payRunsRes.ok) {
          const errBody = await payRunsRes.text()
          await supabase.from('company_xero_config').update({
            sync_status: 'error',
            sync_error: `Xero API error: ${payRunsRes.status}`,
            updated_at: new Date().toISOString(),
          }).eq('company_id', company_id)
          return json({ error: `Xero API error: ${payRunsRes.status}`, detail: errBody }, 502)
        }

        const payRunsData = await payRunsRes.json()
        const payRuns = payRunsData.PayRuns || []

        // Fetch employees for mapping
        const empRes = await fetch(`${XERO_PAYROLL_BASE}/Employees`, { headers: xeroHeaders })
        const empData = empRes.ok ? await empRes.json() : { Employees: [] }
        const xeroEmployees = empData.Employees || []

        // Map Xero employees to InflowHR employees by email
        const { data: localEmployees } = await supabase
          .from('employees')
          .select('id, email, first_name, last_name')
          .eq('company_id', company_id)
          .eq('is_active', true)

        const emailToEmployee: Record<string, { id: string; name: string }> = {}
        for (const emp of localEmployees || []) {
          emailToEmployee[emp.email.toLowerCase()] = {
            id: emp.id,
            name: `${emp.first_name} ${emp.last_name}`,
          }
        }

        const xeroIdToLocal: Record<string, { id: string; name: string }> = {}
        for (const xe of xeroEmployees) {
          const email = (xe.Email || '').toLowerCase()
          if (email && emailToEmployee[email]) {
            xeroIdToLocal[xe.EmployeeID] = emailToEmployee[email]
          }
        }

        let synced = 0
        let skipped = 0

        // Process recent pay runs (last 12)
        const recentRuns = payRuns
          .sort((a: any, b: any) => new Date(b.PaymentDate).getTime() - new Date(a.PaymentDate).getTime())
          .slice(0, 12)

        for (const run of recentRuns) {
          // Fetch payslips for this pay run
          const slipsRes = await fetch(
            `${XERO_PAYROLL_BASE}/Payslips?PayRunID=${run.PayRunID}`,
            { headers: xeroHeaders }
          )
          if (!slipsRes.ok) continue

          const slipsData = await slipsRes.json()
          const payslips = slipsData.Payslips || []

          for (const slip of payslips) {
            const localEmp = xeroIdToLocal[slip.EmployeeID]
            if (!localEmp) { skipped++; continue }

            // Check if already synced
            const { data: existing } = await supabase
              .from('payslips')
              .select('id')
              .eq('xero_payslip_id', slip.PayslipID)
              .maybeSingle()

            if (existing) { skipped++; continue }

            const grossEarnings = Number(slip.GrossEarnings || slip.Wages || 0)
            const tax = Number(slip.Tax || slip.TaxDeducted || 0)
            const ni = Number(slip.EmployeeNI || slip.EmployeesNIC || 0)
            const pension = Number(slip.EmployeePensionContribution || slip.EmployeePension || 0)
            const otherDed = Number(slip.TotalDeductions || 0) - tax - ni - pension
            const netPay = Number(slip.NetPay || 0)

            await supabase.from('payslips').insert({
              employee_id: localEmp.id,
              company_id: company_id,
              reference_number: `XERO-${run.PayRunID.slice(0, 8)}-${slip.PayslipID.slice(0, 4)}`,
              pay_period_start: run.PayPeriodStartDate?.split('T')[0] || run.PeriodStartDate?.split('T')[0],
              pay_period_end: run.PayPeriodEndDate?.split('T')[0] || run.PeriodEndDate?.split('T')[0],
              gross_pay: grossEarnings,
              tax: Math.abs(tax),
              national_insurance: Math.abs(ni),
              pension: Math.abs(pension),
              other_deductions: Math.max(0, Math.abs(otherDed)),
              net_pay: netPay,
              payment_date: run.PaymentDate?.split('T')[0],
              status: run.PayRunStatus === 'POSTED' ? 'paid' : 'processed',
              tax_code: slip.TaxCode || '',
              annual_salary: Number(slip.AnnualSalary || 0),
              payroll_id: slip.EmployeeID,
              overtime: 0,
              adjustments: 0,
              xero_payslip_id: slip.PayslipID,
              source: 'xero',
            })
            synced++
          }
        }

        await supabase.from('company_xero_config').update({
          sync_status: 'connected',
          last_sync_at: new Date().toISOString(),
          sync_error: null,
          updated_at: new Date().toISOString(),
        }).eq('company_id', company_id)

        return json({ success: true, synced, skipped, payRuns: recentRuns.length })
      }

      case 'disconnect': {
        await supabase.from('company_xero_config').update({
          access_token: null,
          refresh_token: null,
          token_expires_at: null,
          sync_status: 'not_connected',
          sync_error: null,
          updated_at: new Date().toISOString(),
        }).eq('company_id', company_id)
        return json({ success: true })
      }

      default:
        return json({ error: `Unknown action: ${action}` }, 400)
    }
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
})

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
