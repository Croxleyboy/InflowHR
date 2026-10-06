import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token'
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

// ── Super-admin auth check ──────────────────────────────────────────────────
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

    // ── Action 1: Fetch all pay runs with payslip IDs ───────────────────
    if (action === 'fetch_payruns') {
      const url = `${XERO_PAYROLL_AU}/PayRuns`
      const res = await fetch(url, { headers: xeroHeaders })
      const text = await res.text()
      let data: any
      try { data = JSON.parse(text) } catch { data = text }

      if (res.ok && data?.payRuns?.length) {
        for (const pr of data.payRuns) {
          try {
            const detailRes = await fetch(`${XERO_PAYROLL_AU}/PayRuns/${pr.payRunID}`, { headers: xeroHeaders })
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

    // ── Action 2: Get a specific payslip ──────────────────────────────────
    if (action === 'get_payslip') {
      if (!pay_run_id) return json({ error: 'pay_run_id required for get_payslip' }, 400)
      if (!payslip_id) return json({ error: 'payslip_id required for get_payslip' }, 400)

      const url = `${XERO_PAYROLL_AU}/PayRuns/${pay_run_id}/Payslips/${payslip_id}`
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

    // ── Action 3: Update/post a payslip ───────────────────────────────────
    if (action === 'update_payslip') {
      if (!payslip_id) return json({ error: 'payslip_id required for update_payslip' }, 400)
      if (!payload) return json({ error: 'payload required for update_payslip' }, 400)

      const url = `${XERO_PAYROLL_AU}/Payslip/${payslip_id}`
      const res = await fetch(url, {
        method: 'POST',
        headers: xeroHeaders,
        body: JSON.stringify(payload),
      })
      const text = await res.text()
      let data
      try { data = JSON.parse(text) } catch { data = text }
      return json({
        action: 'update_payslip',
        status: res.status,
        url,
        data,
      })
    }

    return json({ error: `Unknown action: ${action}` }, 400)
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})
