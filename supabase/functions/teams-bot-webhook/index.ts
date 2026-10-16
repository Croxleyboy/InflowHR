import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://app.inflowhr.com',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

const ALLOWED_SERVICE_URL_PATTERNS = [
  /^https:\/\/smba\.trafficmanager\.net\//,
  /^https:\/\/[a-z]+\.ng\.msg\.teams\.microsoft\.com\//,
]

const BOT_FRAMEWORK_OPENID_URL =
  'https://login.botframework.com/v1/.well-known/openidconfiguration'

let cachedJwks: { keys: JsonWebKey[]; fetchedAt: number } | null = null
const JWKS_CACHE_MS = 60 * 60 * 1000

async function getJwks(): Promise<JsonWebKey[]> {
  if (cachedJwks && Date.now() - cachedJwks.fetchedAt < JWKS_CACHE_MS) {
    return cachedJwks.keys
  }
  const openIdRes = await fetch(BOT_FRAMEWORK_OPENID_URL)
  if (!openIdRes.ok) throw new Error('Failed to fetch Bot Framework OpenID config')
  const openIdConfig = await openIdRes.json()
  const jwksRes = await fetch(openIdConfig.jwks_uri)
  if (!jwksRes.ok) throw new Error('Failed to fetch Bot Framework JWKS')
  const jwks = await jwksRes.json()
  cachedJwks = { keys: jwks.keys, fetchedAt: Date.now() }
  return jwks.keys
}

function base64UrlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') +
    '='.repeat((4 - (str.length % 4)) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, c => c.charCodeAt(0))
}

async function verifyBotToken(authHeader: string, expectedAudience: string): Promise<boolean> {
  if (!authHeader.startsWith('Bearer ')) return false
  const token = authHeader.slice(7)
  const parts = token.split('.')
  if (parts.length !== 3) return false

  const headerJson = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0])))
  const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1])))

  const allowedIssuers = [
    'https://api.botframework.com',
    'https://sts.windows.net/d6d49420-f39b-4df7-a1dc-d59a935871db/',
    'https://login.microsoftonline.com/d6d49420-f39b-4df7-a1dc-d59a935871db/v2.0',
  ]
  if (!allowedIssuers.includes(payload.iss)) return false

  if (payload.aud !== expectedAudience) return false

  const now = Math.floor(Date.now() / 1000)
  if (payload.exp && payload.exp < now) return false
  if (payload.nbf && payload.nbf > now + 300) return false

  const jwks = await getJwks()
  const kid = headerJson.kid
  const jwk = jwks.find((k: Record<string, unknown>) => k.kid === kid)
  if (!jwk) return false

  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    )
    const signedContent = new TextEncoder().encode(parts[0] + '.' + parts[1])
    const signature = base64UrlDecode(parts[2])
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, signedContent)
  } catch {
    return false
  }
}

function isAllowedServiceUrl(url: string): boolean {
  return ALLOWED_SERVICE_URL_PATTERNS.some(pattern => pattern.test(url))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
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

    if (!isAllowedServiceUrl(serviceUrl)) {
      return json({ error: 'Untrusted service URL' }, 403)
    }

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

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

    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader) {
      return json({ error: 'Missing Authorization header' }, 401)
    }

    const isValid = await verifyBotToken(authHeader, config.bot_app_id)
    if (!isValid) {
      return json({ error: 'Invalid Bot Framework token' }, 401)
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
      return json({ error: 'Failed to store conversation' }, 500)
    }

    return json({ ok: true, user_email: userEmail })
  } catch {
    return json({ error: 'Internal error' }, 500)
  }
})
