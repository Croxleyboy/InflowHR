import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
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

    const activity = await req.json()

    if (activity.type !== 'conversationUpdate' || !activity.membersAdded?.length) {
      return json({ ok: true })
    }

    const botId = activity.recipient?.id
    if (!botId) return json({ ok: true })

    const isBotAdded = activity.membersAdded.some(
      (m: { id: string }) => m.id === botId,
    )
    if (!isBotAdded) {
      return json({ ok: true })
    }

    const conversationId = activity.conversation?.id
    const serviceUrl = activity.serviceUrl
    const tenantId = activity.conversation?.tenantId || activity.channelData?.tenant?.id
    const userAadId = activity.from?.aadObjectId || activity.from?.id
    const userName = activity.from?.name

    if (!conversationId || !serviceUrl || !tenantId || !userAadId) {
      return json({ error: 'Missing conversation data' }, 400)
    }

    const { data: configs } = await sb
      .from('company_teams_config')
      .select('company_id, bot_app_id, bot_app_secret_encrypted, azure_tenant_id')
      .eq('bot_configured', true)

    if (!configs || configs.length === 0) {
      return json({ error: 'No configured companies' }, 404)
    }

    const config = configs.find(
      (c: { azure_tenant_id: string | null }) => c.azure_tenant_id === tenantId,
    )
    if (!config) {
      return json({ error: 'No matching company for tenant' }, 404)
    }

    const tokenRes = await fetch(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: config.bot_app_id,
          client_secret: config.bot_app_secret_encrypted,
          scope: 'https://graph.microsoft.com/.default',
        }),
      },
    )
    if (!tokenRes.ok) {
      return json({ error: 'Could not authenticate with Azure AD' }, 500)
    }
    const { access_token } = await tokenRes.json()

    const graphRes = await fetch(
      `https://graph.microsoft.com/v1.0/users/${userAadId}`,
      { headers: { Authorization: `Bearer ${access_token}` } },
    )
    let userEmail = ''
    if (graphRes.ok) {
      const graphUser = await graphRes.json()
      userEmail = (graphUser.mail || graphUser.userPrincipalName || '').toLowerCase()
    }

    if (!userEmail) {
      userEmail = (userName || userAadId).toLowerCase()
    }

    const { error: upsertErr } = await sb
      .from('company_teams_bot_conversations')
      .upsert(
        {
          company_id: config.company_id,
          user_email: userEmail,
          conversation_id: conversationId,
          service_url: serviceUrl.replace(/\/+$/, ''),
          bot_user_id: userAadId,
          tenant_id: tenantId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'company_id,user_email' },
      )

    if (upsertErr) {
      return json({ error: 'Failed to store conversation: ' + upsertErr.message }, 500)
    }

    return json({ ok: true, user_email: userEmail })
  } catch (err) {
    return json({ error: (err as Error).message || 'Internal error' }, 500)
  }
})
