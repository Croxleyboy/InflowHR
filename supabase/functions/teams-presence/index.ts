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

// Resolve emails to Azure AD user IDs in batches using $filter
async function resolveUserIds(
  token: string,
  emails: string[],
): Promise<Record<string, string>> {
  const idToEmail: Record<string, string> = {}
  const BATCH_SIZE = 15 // Graph $filter 'in' supports ~15 values reliably

  for (let i = 0; i < emails.length; i += BATCH_SIZE) {
    const batch = emails.slice(i, i + BATCH_SIZE)
    const quoted = batch.map(e => `'${e.replace(/'/g, "''")}'`).join(',')
    const filter = `mail in (${quoted})`

    const res = await fetch(
      `${GRAPH_BASE}/users?$filter=${encodeURIComponent(filter)}&$select=id,mail`,
      { headers: { Authorization: `Bearer ${token}` } },
    )

    if (res.ok) {
      const data = await res.json()
      for (const u of data.value || []) {
        if (u.id && u.mail) {
          idToEmail[u.id] = u.mail.toLowerCase()
        }
      }
    }
  }

  // Fallback: try userPrincipalName for emails not matched by mail field
  const resolvedEmails = new Set(Object.values(idToEmail))
  const unresolved = emails.filter(e => !resolvedEmails.has(e.toLowerCase()))

  if (unresolved.length > 0) {
    for (let i = 0; i < unresolved.length; i += BATCH_SIZE) {
      const batch = unresolved.slice(i, i + BATCH_SIZE)
      const quoted = batch.map(e => `'${e.replace(/'/g, "''")}'`).join(',')
      const filter = `userPrincipalName in (${quoted})`

      const res = await fetch(
        `${GRAPH_BASE}/users?$filter=${encodeURIComponent(filter)}&$select=id,mail,userPrincipalName`,
        { headers: { Authorization: `Bearer ${token}` } },
      )

      if (res.ok) {
        const data = await res.json()
        for (const u of data.value || []) {
          if (u.id) {
            const email = (u.mail || u.userPrincipalName || '').toLowerCase()
            if (email) idToEmail[u.id] = email
          }
        }
      }
    }
  }

  return idToEmail
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
    const { emails, company_id: requestedCompanyId } = body
    if (!Array.isArray(emails) || emails.length === 0) {
      return json({ error: 'emails array required' }, 400)
    }

    let companyId: string
    if (requestedCompanyId) {
      const { data: cu } = await sb
        .from('company_users')
        .select('company_id')
        .eq('auth_user_id', user.id)
        .eq('company_id', requestedCompanyId)
        .maybeSingle()
      if (!cu) return json({ error: 'No company membership' }, 403)
      companyId = cu.company_id
    } else {
      const { data: cu } = await sb
        .from('company_users')
        .select('company_id')
        .eq('auth_user_id', user.id)
        .limit(1)
        .maybeSingle()
      if (!cu) return json({ error: 'No company membership' }, 403)
      companyId = cu.company_id
    }

    const { data: config } = await sb
      .from('company_teams_config')
      .select('azure_tenant_id, bot_app_id, bot_app_secret_encrypted, is_enabled, bot_configured')
      .eq('company_id', companyId)
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

    const capped = emails.slice(0, 100)
    const idToEmail = await resolveUserIds(token, capped)

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
      if (email) {
        const original = capped.find(e => e.toLowerCase() === email)
        presence[original || email] = p.availability || 'PresenceUnknown'
      }
    }

    return json({ presence })
  } catch (err) {
    return json({ error: (err as Error).message || 'Internal error' }, 500)
  }
})
