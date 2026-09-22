// GET /functions/v1/sage-callback?code=…&state=…
// Sage redirects here after the user authorises.
// Exchanges the code for tokens, fetches resource owner, saves to DB,
// then redirects the browser back to the app.
// Client ID and Secret are read from the sage_integrations row for this company.

import { getSupabase, getSageCredentials, getSageRedirectUri, corsHeaders, redirect, verifyState } from '../_shared/sage.ts'

const TOKEN_URL = 'https://oauth.accounting.sage.com/token'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const url = new URL(req.url)
    const code = url.searchParams.get('code')
    const stateRaw = url.searchParams.get('state')

    if (!code || !stateRaw) {
      return redirect(getFrontendUrl() + '?sage=error&reason=missing_params')
    }

    // Extract company_id from state first — we need it to look up credentials
    // The state was signed with the company's own client secret, so we need
    // to read it to verify. Parse the payload portion (before the HMAC dot)
    // to get company_id, then verify the signature with that company's secret.
    let companyId: string
    try {
      const dotIdx = stateRaw.lastIndexOf('.')
      if (dotIdx < 0) throw new Error('no signature')
      const payloadB64 = stateRaw.slice(0, dotIdx)
      const parsed = JSON.parse(atob(payloadB64))
      companyId = parsed.company_id
      if (!companyId) throw new Error('no company_id')
    } catch {
      return redirect(getFrontendUrl() + '?sage=error&reason=bad_state')
    }

    const { clientId, clientSecret, redirectUri } = await getSageCredentials(companyId)

    // Now verify the HMAC signature with the company's secret
    const verified = await verifyState(stateRaw, clientSecret)
    if (!verified) {
      return redirect(getFrontendUrl() + '?sage=error&reason=invalid_state_signature')
    }

    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    })

    if (!tokenRes.ok) {
      return redirect(getFrontendUrl() + '?sage=error&reason=token_exchange')
    }

    const tokens = await tokenRes.json()
    const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString()

    const userRes = await fetch('https://api.accounting.sage.com/v3.1/user', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    let resourceOwnerId = ''
    if (userRes.ok) {
      const userData = await userRes.json()
      resourceOwnerId = userData?.id || ''
    }

    const sb = getSupabase()
    const { error: dbErr } = await sb
      .from('sage_integrations')
      .upsert({
        company_id: companyId,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        resource_owner_id: resourceOwnerId,
        expires_at: expiresAt,
        sync_status: 'connected',
        sync_error: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'company_id' })

    if (dbErr) {
      return redirect(getFrontendUrl() + '?sage=error&reason=db')
    }

    await sb.rpc('log_gdpr_action', {
      p_action: 'GRANT_ACCESS',
      p_entity_type: 'sage_integration',
      p_entity_id: companyId,
      p_details: JSON.stringify({ event: 'oauth_connected', resource_owner_id: resourceOwnerId }),
    })

    return redirect(getFrontendUrl() + '?sage=connected')
  } catch {
    return redirect(getFrontendUrl() + '?sage=error&reason=unknown')
  }
})

function getFrontendUrl(): string {
  return Deno.env.get('FRONTEND_URL') || 'https://inflowhr.co.uk/admin/payroll'
}
