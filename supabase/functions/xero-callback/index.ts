// GET /functions/v1/xero-callback?code=…&state=…
// Xero redirects here after the user authorises.
// Exchanges the code for tokens, fetches tenant ID, saves to DB,
// then redirects the browser back to the app.

import { getSupabase, getXeroEnv, corsHeaders, redirect } from '../_shared/xero.ts'

const TOKEN_URL = 'https://identity.xero.com/connect/token'
const CONNECTIONS_URL = 'https://api.xero.com/connections'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const url = new URL(req.url)
    const code = url.searchParams.get('code')
    const stateRaw = url.searchParams.get('state')

    if (!code || !stateRaw) {
      return redirect(getFrontendUrl() + '?xero=error&reason=missing_params')
    }

    let companyId: string
    try {
      const parsed = JSON.parse(atob(stateRaw))
      companyId = parsed.company_id
      if (!companyId) throw new Error('no company_id')
    } catch {
      return redirect(getFrontendUrl() + '?xero=error&reason=bad_state')
    }

    const { clientId, clientSecret, redirectUri } = getXeroEnv()

    // Exchange authorisation code for tokens
    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + btoa(`${clientId}:${clientSecret}`),
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    })

    if (!tokenRes.ok) {
      const err = await tokenRes.text()
      console.error('Token exchange failed:', err)
      return redirect(getFrontendUrl() + '?xero=error&reason=token_exchange')
    }

    const tokens = await tokenRes.json()
    const expiresAt = new Date(Date.now() + (tokens.expires_in || 1800) * 1000).toISOString()

    // Fetch tenant ID from Xero connections
    const connRes = await fetch(CONNECTIONS_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    if (!connRes.ok) {
      console.error('Connections fetch failed:', await connRes.text())
      return redirect(getFrontendUrl() + '?xero=error&reason=connections')
    }

    const connections = await connRes.json()
    if (!connections.length) {
      return redirect(getFrontendUrl() + '?xero=error&reason=no_tenant')
    }
    const tenantId = connections[0].tenantId

    // Upsert into xero_integrations (service role bypasses RLS)
    const sb = getSupabase()
    const { error: dbErr } = await sb
      .from('xero_integrations')
      .upsert({
        company_id: companyId,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        tenant_id: tenantId,
        expires_at: expiresAt,
        sync_status: 'connected',
        sync_error: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'company_id' })

    if (dbErr) {
      console.error('DB upsert failed:', dbErr)
      return redirect(getFrontendUrl() + '?xero=error&reason=db')
    }

    return redirect(getFrontendUrl() + '?xero=connected')
  } catch (err) {
    console.error('xero-callback error:', err)
    return redirect(getFrontendUrl() + '?xero=error&reason=unknown')
  }
})

function getFrontendUrl(): string {
  return Deno.env.get('FRONTEND_URL') || 'https://inflowhr.co.uk/admin/payroll'
}
