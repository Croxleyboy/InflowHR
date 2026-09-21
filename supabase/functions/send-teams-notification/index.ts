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

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
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

    const userEmail = user.email
    if (!userEmail) return json({ error: 'No email on user record' }, 400)

    const body = await req.json()
    const { company_id, manager_email, employee_name, message, provider_token } = body

    if (!company_id || !manager_email || !message || !provider_token) {
      return json({ error: 'company_id, manager_email, message and provider_token are required' }, 400)
    }

    // Verify user belongs to this company
    const { data: cu } = await sb
      .from('company_users')
      .select('id')
      .eq('user_id', user.id)
      .eq('company_id', company_id)
      .maybeSingle()
    if (!cu) return json({ error: 'Not a member of this company' }, 403)

    // Check Teams integration is enabled and consented for this company
    const { data: config } = await sb
      .from('company_teams_config')
      .select('is_enabled, consent_granted')
      .eq('company_id', company_id)
      .maybeSingle()
    if (!config?.is_enabled || !config?.consent_granted) {
      return json({ error: 'Teams integration not enabled for this company' }, 403)
    }

    // Resolve manager Azure AD user ID
    const managerRes = await fetch(`${GRAPH_BASE}/users/${encodeURIComponent(manager_email)}`, {
      headers: { 'Authorization': `Bearer ${provider_token}`, 'Content-Type': 'application/json' },
    })
    if (!managerRes.ok) {
      const err = await managerRes.json().catch(() => ({}))
      return json({ error: `Could not resolve manager: ${err?.error?.message || managerRes.status}` }, 400)
    }
    const managerUser = await managerRes.json()
    const managerId = managerUser.id

    // Resolve sender Azure AD user ID
    const senderRes = await fetch(`${GRAPH_BASE}/me`, {
      headers: { 'Authorization': `Bearer ${provider_token}`, 'Content-Type': 'application/json' },
    })
    if (!senderRes.ok) return json({ error: 'Could not resolve sender identity' }, 400)
    const senderUser = await senderRes.json()
    const senderId = senderUser.id

    // Find or create a 1:1 chat
    let chatId: string | null = null

    const chatsRes = await fetch(`${GRAPH_BASE}/users/${senderId}/chats?$filter=chatType eq 'oneOnOne'&$expand=members&$top=50`, {
      headers: { 'Authorization': `Bearer ${provider_token}`, 'Content-Type': 'application/json' },
    })
    if (chatsRes.ok) {
      const chats = await chatsRes.json()
      const found = chats.value?.find((c: any) =>
        c.members?.some((m: any) => m.userId === managerId && m.userId !== senderId)
      )
      if (found) chatId = found.id
    }

    if (!chatId) {
      const createRes = await fetch(`${GRAPH_BASE}/chats`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${provider_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatType: 'oneOnOne',
          members: [
            { '@odata.type': '#microsoft.graph.aadUserConversationMember', roles: ['owner'], 'user@odata.bind': `https://graph.microsoft.com/v1.0/users('${senderId}')` },
            { '@odata.type': '#microsoft.graph.aadUserConversationMember', roles: ['owner'], 'user@odata.bind': `https://graph.microsoft.com/v1.0/users('${managerId}')` },
          ],
        }),
      })
      if (!createRes.ok) {
        const err = await createRes.json().catch(() => ({}))
        return json({ error: `Could not create chat: ${err?.error?.message || createRes.status}` }, 500)
      }
      const chat = await createRes.json()
      chatId = chat.id
    }

    // Send the message
    const safeName = escapeHtml(employee_name || 'An employee')
    const safeMessage = escapeHtml(message)

    const msgRes = await fetch(`${GRAPH_BASE}/chats/${chatId}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${provider_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        body: {
          contentType: 'html',
          content: `<strong>InflowHR</strong> — ${safeName}: ${safeMessage}`,
        },
      }),
    })

    if (!msgRes.ok) {
      const err = await msgRes.json().catch(() => ({}))
      return json({ error: `Failed to send message: ${err?.error?.message || msgRes.status}` }, 500)
    }

    return json({ success: true })
  } catch (err) {
    return json({ error: (err as Error).message || 'Internal error' }, 500)
  }
})
