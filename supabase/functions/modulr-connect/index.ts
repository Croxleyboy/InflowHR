// POST /functions/v1/modulr-connect  { company_id, api_key, hmac_secret, source_account_id }
// Encrypts credentials, stores them, and tests the Modulr connection.

import {
  getSupabase, corsHeaders, json, verifyAdmin,
  encryptCredential, modulrRequest,
} from '../_shared/modulr.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const sb = getSupabase()
    const authHeader = req.headers.get('Authorization')
    const { company_id, api_key, hmac_secret, source_account_id } = await req.json()

    if (!company_id || !api_key || !hmac_secret || !source_account_id) {
      return json({ error: 'All fields are required: api_key, hmac_secret, source_account_id' }, 400)
    }

    const authResult = await verifyAdmin(sb, authHeader, company_id)
    if (authResult instanceof Response) return authResult

    // Test the connection by fetching the source account
    const testResult = await modulrRequest(api_key, hmac_secret, 'GET', `/accounts/${source_account_id}`)

    let status: string
    let statusError: string | null = null

    if (testResult.ok) {
      status = 'connected'
    } else if (testResult.status === 403) {
      status = 'ip_whitelist_pending'
      statusError = 'IP Whitelist Error. Please ensure our static IP is added to your Modulr portal.'
    } else if (testResult.status === 401) {
      status = 'error'
      statusError = 'Invalid API Key or HMAC Secret.'
    } else {
      status = 'error'
      statusError = `Modulr API returned HTTP ${testResult.status}`
    }

    // Encrypt credentials before storage
    const { encrypted: apiKeyEnc, iv: apiKeyIv } = await encryptCredential(api_key)
    const { encrypted: hmacEnc, iv: hmacIv } = await encryptCredential(hmac_secret)
    const combinedIv = JSON.stringify({ apiKey: apiKeyIv, hmac: hmacIv })

    const { error: upsertErr } = await sb
      .from('modulr_integrations')
      .upsert({
        company_id,
        api_key_encrypted: apiKeyEnc,
        hmac_secret_encrypted: hmacEnc,
        source_account_id,
        encryption_iv: combinedIv,
        status,
        status_error: statusError,
        connected_at: status === 'connected' ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'company_id' })

    if (upsertErr) return json({ error: 'Failed to save integration: ' + upsertErr.message }, 500)

    // Audit log
    await sb.rpc('log_gdpr_action', {
      p_company_id: company_id,
      p_user_id: authResult.userId,
      p_action: 'modulr_connect',
      p_entity_type: 'modulr_integrations',
      p_details: { status, source_account_id },
    }).catch(() => {})

    return json({ status, error: statusError })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
})
