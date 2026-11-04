import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALLOWED_ORIGINS = [
  'https://app.inflowhr.com',
  'http://localhost:3003',
  'http://localhost:5173',
]

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') || ''
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }
}

function json(data: unknown, status: number, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Unauthorized' }, 401, corsHeaders)

    const jwt = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authErr } = await sb.auth.getUser(jwt)
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401, corsHeaders)

    const body = await req.json()
    const { company_id, message, channel } = body

    if (!company_id || !message) {
      return json({ error: 'company_id and message are required' }, 400, corsHeaders)
    }

    const { data: cu } = await sb
      .from('company_users')
      .select('id')
      .eq('auth_user_id', user.id)
      .eq('company_id', company_id)
      .maybeSingle()

    if (!cu) {
      const { data: sa } = await sb
        .from('super_admins')
        .select('id')
        .eq('auth_user_id', user.id)
        .maybeSingle()
      if (!sa) return json({ error: 'Not a member of this company' }, 403, corsHeaders)
    }

    const { data: config } = await sb
      .from('slack_integrations')
      .select('is_enabled, webhook_url, default_channel')
      .eq('company_id', company_id)
      .maybeSingle()

    if (!config?.is_enabled || !config?.webhook_url) {
      return json({ error: 'Slack is not configured for this company' }, 403, corsHeaders)
    }

    const payload: Record<string, string> = { text: message }
    const targetChannel = channel || config.default_channel
    if (targetChannel) payload.channel = targetChannel

    const slackRes = await fetch(config.webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!slackRes.ok) {
      const errText = await slackRes.text().catch(() => '')
      return json({ error: `Slack returned ${slackRes.status}: ${errText}` }, 502, corsHeaders)
    }

    return json({ success: true }, 200, corsHeaders)
  } catch (err) {
    return json({ error: (err as Error).message || 'Internal error' }, 500, corsHeaders)
  }
})
