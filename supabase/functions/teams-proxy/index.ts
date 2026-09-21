import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'

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

const ALLOWED_ENDPOINTS = [
  '/me',
  '/users/',
  '/chats',
]

function isAllowedEndpoint(endpoint: string): boolean {
  return ALLOWED_ENDPOINTS.some(p => endpoint === p || endpoint.startsWith(p))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Unauthorized' }, 401)

    const jwt = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authErr } = await sb.auth.getUser(jwt)
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

    // Only super admins can use the Teams proxy
    const { data: sa } = await sb
      .from('super_admins')
      .select('id')
      .eq('auth_user_id', user.id)
      .maybeSingle()
    if (!sa) return json({ error: 'Super admin access required' }, 403)

    // Get the provider token from the user's session identity
    const azureIdentity = user.identities?.find(i => i.provider === 'azure')
    if (!azureIdentity) return json({ error: 'No Azure identity found' }, 400)

    // We need the provider_token from the session, which the client must send
    const body = await req.json()
    const { endpoint, method, body: graphBody, provider_token } = body

    if (!endpoint) return json({ error: 'endpoint required' }, 400)
    if (!provider_token) return json({ error: 'provider_token required' }, 400)
    if (!isAllowedEndpoint(endpoint)) return json({ error: 'Endpoint not allowed' }, 403)

    const graphRes = await fetch(`${GRAPH_BASE}${endpoint}`, {
      method: method || 'GET',
      headers: {
        'Authorization': `Bearer ${provider_token}`,
        'Content-Type': 'application/json',
      },
      ...(graphBody ? { body: JSON.stringify(graphBody) } : {}),
    })

    const responseData = await graphRes.json().catch(() => ({}))

    if (!graphRes.ok) {
      return json({
        error: responseData?.error?.message || `Graph API ${graphRes.status}`,
        status: graphRes.status,
      }, graphRes.status >= 500 ? 502 : graphRes.status)
    }

    return json(responseData)
  } catch (err) {
    return json({ error: (err as Error).message || 'Internal error' }, 500)
  }
})
