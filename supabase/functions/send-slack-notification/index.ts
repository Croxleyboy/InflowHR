import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

    const body = await req.json()
    const { company_id, message, channel } = body

    if (!company_id || !message) {
      return json({ error: 'company_id and message are required' }, 400)
    }

    const { data: cu } = await sb
      .from('company_users')
      .select('id')
      .eq('auth_user_id', user.id)
      .eq('company_id', company_id)
      .maybeSingle()
    if (!cu) return json({ error: 'Not a member of this company' }, 403)

    const { data: config } = await sb
      .from('slack_integrations')
      .select('is_enabled, webhook_url, default_channel')
      .eq('company_id', company_id)
      .maybeSingle()

    if (!config?.is_enabled || !config?.webhook_url) {
      return json({ error: 'Slack is not configured for this company' }, 403)
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
      return json({ error: `Slack returned ${slackRes.status}: ${errText}` }, 502)
    }

    return json({ success: true })
  } catch (err) {
    return json({ error: (err as Error).message || 'Internal error' }, 500)
  }
})
