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

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

async function getBotToken(appId: string, appSecret: string): Promise<string | null> {
  const res = await fetch(
    'https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: appId,
        client_secret: appSecret,
        scope: 'https://api.botframework.com/.default',
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

    const body = await req.json()
    const { company_id, manager_email, employee_name, message } = body

    if (!company_id || !manager_email || !message) {
      return json({ error: 'company_id, manager_email and message are required' }, 400)
    }

    const { data: cu } = await sb
      .from('company_users')
      .select('id')
      .eq('user_id', user.id)
      .eq('company_id', company_id)
      .maybeSingle()
    if (!cu) return json({ error: 'Not a member of this company' }, 403)

    const { data: config } = await sb
      .from('company_teams_config')
      .select('is_enabled, bot_configured, bot_app_id, bot_app_secret_encrypted')
      .eq('company_id', company_id)
      .maybeSingle()

    if (!config?.is_enabled || !config?.bot_configured) {
      return json({ error: 'Teams bot not configured for this company' }, 403)
    }

    const { data: conv } = await sb
      .from('company_teams_bot_conversations')
      .select('conversation_id, service_url')
      .eq('company_id', company_id)
      .eq('user_email', manager_email.toLowerCase())
      .maybeSingle()

    if (!conv) {
      return json({ error: 'Manager does not have the InflowHR bot installed in Teams' }, 404)
    }

    const botToken = await getBotToken(config.bot_app_id, config.bot_app_secret_encrypted)
    if (!botToken) {
      return json({ error: 'Failed to authenticate bot with Microsoft' }, 500)
    }

    const safeName = escapeHtml(employee_name || 'An employee')
    const safeMessage = escapeHtml(message)

    const activityRes = await fetch(
      `${conv.service_url}/v3/conversations/${conv.conversation_id}/activities`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'message',
          textFormat: 'html',
          text: `<strong>InflowHR</strong> — ${safeName}: ${safeMessage}`,
        }),
      },
    )

    if (!activityRes.ok) {
      const err = await activityRes.json().catch(() => ({}))
      return json({
        error: `Failed to send message: ${err?.message || activityRes.status}`,
      }, 500)
    }

    return json({ success: true })
  } catch (err) {
    return json({ error: (err as Error).message || 'Internal error' }, 500)
  }
})
