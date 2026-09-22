import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SAGE_TOKEN_URL = 'https://oauth.accounting.sage.com/token'

export function getSupabase() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
}

export function getSageRedirectUri(): string {
  const redirectUri = Deno.env.get('SAGE_REDIRECT_URI')
  if (!redirectUri) throw new Error('Missing SAGE_REDIRECT_URI env var')
  return redirectUri
}

export async function getSageCredentials(companyId: string): Promise<{
  clientId: string
  clientSecret: string
  redirectUri: string
}> {
  const sb = getSupabase()
  const { data: row } = await sb
    .from('sage_integrations')
    .select('client_id, client_secret_encrypted')
    .eq('company_id', companyId)
    .single()

  if (!row?.client_id || !row?.client_secret_encrypted) {
    throw new Error('Sage credentials not configured — enter Client ID and Secret in Integrations')
  }

  return {
    clientId: row.client_id,
    clientSecret: row.client_secret_encrypted,
    redirectUri: getSageRedirectUri(),
  }
}

export const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://app.inflowhr.com',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export function redirect(url: string) {
  return new Response(null, { status: 302, headers: { Location: url } })
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder()
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export async function signState(payload: string, secret: string): Promise<string> {
  const key = await hmacKey(secret)
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
  return `${payload}.${sigB64}`
}

export async function verifyState(signed: string, secret: string): Promise<string | null> {
  const dotIdx = signed.lastIndexOf('.')
  if (dotIdx < 0) return null
  const payload = signed.slice(0, dotIdx)
  const sigB64 = signed.slice(dotIdx + 1)
  const key = await hmacKey(secret)
  const sigBytes = Uint8Array.from(atob(sigB64), c => c.charCodeAt(0))
  const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(payload))
  return valid ? payload : null
}

export async function getValidSageToken(companyId: string): Promise<{
  accessToken: string
  resourceOwnerId: string
} | null> {
  const sb = getSupabase()
  const { data: row } = await sb
    .from('sage_integrations')
    .select('*')
    .eq('company_id', companyId)
    .single()

  if (!row?.access_token || !row?.resource_owner_id) return null

  if (row.expires_at && new Date(row.expires_at) > new Date(Date.now() + 60_000)) {
    return { accessToken: row.access_token, resourceOwnerId: row.resource_owner_id }
  }

  if (!row.refresh_token || !row.client_id || !row.client_secret_encrypted) return null

  const res = await fetch(SAGE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: row.refresh_token,
      client_id: row.client_id,
      client_secret: row.client_secret_encrypted,
    }),
  })

  if (!res.ok) {
    await sb.from('sage_integrations').update({
      sync_status: 'error',
      sync_error: 'Token refresh failed — reconnect to Sage',
      updated_at: new Date().toISOString(),
    }).eq('company_id', companyId)
    return null
  }

  const tokens = await res.json()
  const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString()

  await sb.from('sage_integrations').update({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || row.refresh_token,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  }).eq('company_id', companyId)

  await sb.rpc('log_gdpr_action', {
    p_action: 'GRANT_ACCESS',
    p_entity_type: 'sage_integration',
    p_entity_id: companyId,
    p_details: JSON.stringify({ event: 'token_refreshed' }),
  })

  return { accessToken: tokens.access_token, resourceOwnerId: row.resource_owner_id }
}
