// POST /functions/v1/sage-connect  { company_id }
// Returns { url } — the Sage OAuth authorisation URL.
// The frontend opens this URL; Sage redirects to sage-callback.
// Client ID and Secret are read from the sage_integrations row for this company
// (entered by the admin in the Integrations page wizard).

import { getSupabase, getSageCredentials, corsHeaders, json, signState } from '../_shared/sage.ts'

const SCOPES = 'full_access'

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

    const { company_id } = await req.json()
    if (!company_id) return json({ error: 'company_id required' }, 400)

    const { data: cu } = await sb
      .from('company_users')
      .select('role')
      .eq('auth_user_id', user.id)
      .eq('company_id', company_id)
      .eq('is_active', true)
      .maybeSingle()
    if (!cu || (cu.role !== 'admin' && cu.role !== 'hr')) {
      return json({ error: 'Only company admins can connect Sage' }, 403)
    }

    const { clientId, clientSecret, redirectUri } = await getSageCredentials(company_id)
    const statePayload = btoa(JSON.stringify({ company_id }))
    const state = await signState(statePayload, clientSecret)

    const url = 'https://www.sageone.com/oauth2/auth/central?' +
      new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: SCOPES,
        state,
      }).toString()

    return json({ url })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
})
