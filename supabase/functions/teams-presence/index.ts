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

async function getGraphToken(tenantId: string, clientId: string, clientSecret: string): Promise<string | null> {
  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'https://graph.microsoft.com/.default',
      }),
    },
  )
  if (!res.ok) return null
  const data = await res.json()
  return data.access_token || null
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

    const { data: cu } = await sb
      .from('company_users')
      .select('company_id')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle()
    if (!cu) return json({ error: 'No company membership' }, 403)

    const { data: config } = await sb
      .from('company_teams_config')
      .select('azure_tenant_id, bot_app_id, bot_app_secret_encrypted, is_enabled, bot_configured')
      .eq('company_id', cu.company_id)
      .maybeSingle()

    if (!config?.is_enabled || !config?.bot_configured) {
      return json({ error: 'Teams integration not configured' }, 403)
    }

    const token = await getGraphToken(
      config.azure_tenant_id,
      config.bot_app_id,
      config.bot_app_secret_encrypted,
    )
    if (!token) return json({ error: 'Failed to authenticate with Microsoft' }, 500)

    const body = await req.json()
    const { emails } = body
    if (!Array.isArray(emails) || emails.length === 0) {
      return json({ error: 'emails array required' }, 400)
    }

    const capped = emails.slice(0, 100)

    const idToEmail: Record<string, string> = {}
    for (const email of capped) {
      const res = await fetch(`${GRAPH_BASE}/users/${encodeURIComponent(email)}?$select=id,mail`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const u = await res.json()
        if (u.id) idToEmail[u.id] = email
      }
    }

    const userIds = Object.keys(idToEmail)
    if (userIds.length === 0) return json({ presence: {} })

    const presRes = await fetch(`${GRAPH_BASE}/communications/getPresencesByUserId`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ids: userIds }),
    })

    if (!presRes.ok) {
      return json({ error: 'Presence API call failed' }, 502)
    }

    const presData = await presRes.json()
    const presence: Record<string, string> = {}
    for (const p of presData.value || []) {
      const email = idToEmail[p.id]
      if (email) presence[email] = p.availability || 'PresenceUnknown'
    }

    return json({ presence })
  } catch (err) {
    return json({ error: (err as Error).message || 'Internal error' }, 500)
  }
})
