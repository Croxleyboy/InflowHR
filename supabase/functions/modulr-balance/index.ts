// POST /functions/v1/modulr-balance  { company_id }
// Returns the live balance from the company's Modulr source account.

import {
  getSupabase, corsHeaders, json, verifyAdmin,
  decryptCredential, modulrRequest,
} from '../_shared/modulr.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const sb = getSupabase()
    const authHeader = req.headers.get('Authorization')
    const { company_id } = await req.json()

    if (!company_id) return json({ error: 'company_id required' }, 400)

    const authResult = await verifyAdmin(sb, authHeader, company_id)
    if (authResult instanceof Response) return authResult

    // Load integration
    const { data: integration } = await sb
      .from('modulr_integrations')
      .select('api_key_encrypted, hmac_secret_encrypted, source_account_id, encryption_iv, status')
      .eq('company_id', company_id)
      .single()

    if (!integration || integration.status !== 'connected') {
      return json({ error: 'Modulr not connected' }, 400)
    }

    const ivs = JSON.parse(integration.encryption_iv)
    const apiKey = await decryptCredential(integration.api_key_encrypted, ivs.apiKey)
    const hmacSecret = await decryptCredential(integration.hmac_secret_encrypted, ivs.hmac)

    const result = await modulrRequest(apiKey, hmacSecret, 'GET', `/accounts/${integration.source_account_id}`)

    if (!result.ok) {
      return json({ error: 'Failed to fetch balance from Modulr', detail: result.data }, result.status)
    }

    const account = result.data as Record<string, unknown>
    return json({
      balance: account.balance,
      currency: account.currency || 'GBP',
      account_name: account.name,
    })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
})
