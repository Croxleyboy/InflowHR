// POST /functions/v1/xero-connect  { company_id }
// Returns { url } — the Xero OAuth authorisation URL.
// The frontend opens this URL; Xero redirects to xero-callback.

import { getSupabase, getXeroEnv, corsHeaders, json, signState } from '../_shared/xero.ts'

const SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'payroll.payruns.read',
  'payroll.employees.read',
  'payroll.payslip.read',
  'payroll.settings.read',
].join(' ')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const sb = getSupabase()
    const { clientId, redirectUri } = getXeroEnv()

    // Authenticate caller
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Unauthorized' }, 401)
    const { data: { user }, error: authErr } = await sb.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

    const { company_id } = await req.json()
    if (!company_id) return json({ error: 'company_id required' }, 400)

    // Verify caller is admin of this company
    const { data: cu } = await sb
      .from('company_users')
      .select('role')
      .eq('auth_user_id', user.id)
      .eq('company_id', company_id)
      .eq('is_active', true)
      .maybeSingle()
    if (!cu || (cu.role !== 'admin' && cu.role !== 'hr')) {
      return json({ error: 'Only company admins can connect Xero' }, 403)
    }

    // Encode company_id into state with HMAC signature to prevent forgery
    const { clientSecret } = getXeroEnv()
    const statePayload = btoa(JSON.stringify({ company_id }))
    const state = await signState(statePayload, clientSecret)

    const url = 'https://login.xero.com/identity/connect/authorize?' +
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
