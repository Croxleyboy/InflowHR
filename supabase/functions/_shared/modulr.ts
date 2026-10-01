import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

export function getSupabase() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
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

const MODULR_BASE_URL = Deno.env.get('MODULR_API_URL') || 'https://api.modulrfinance.com/api-sandbox-token'

export function getModulrBaseUrl(): string {
  return MODULR_BASE_URL
}

// AES-256-GCM encryption for credential storage
const ENCRYPTION_KEY_HEX = Deno.env.get('MODULR_ENCRYPTION_KEY') || ''

async function getEncryptionKey(): Promise<CryptoKey> {
  const keyBytes = new Uint8Array(ENCRYPTION_KEY_HEX.match(/.{1,2}/g)!.map(b => parseInt(b, 16)))
  return crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function encryptCredential(plaintext: string): Promise<{ encrypted: string; iv: string }> {
  const key = await getEncryptionKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(plaintext)
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded)
  return {
    encrypted: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
    iv: btoa(String.fromCharCode(...iv)),
  }
}

export async function decryptCredential(encrypted: string, ivB64: string): Promise<string> {
  const key = await getEncryptionKey()
  const iv = Uint8Array.from(atob(ivB64), c => c.charCodeAt(0))
  const ciphertext = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0))
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
  return new TextDecoder().decode(plaintext)
}

// Modulr HMAC-SHA512 signature generation
export async function buildModulrAuthHeader(
  apiKey: string,
  hmacSecret: string,
  method: string,
  path: string,
): Promise<Record<string, string>> {
  const now = new Date().toUTCString()
  const nonce = crypto.randomUUID()
  const signatureString = `date: ${now}\nx-mod-nonce: ${nonce}\n${method.toLowerCase()} ${path}`

  const keyBytes = new TextEncoder().encode(hmacSecret)
  const msgBytes = new TextEncoder().encode(signatureString)
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-512' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, msgBytes)
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))

  return {
    'Authorization': `Signature keyId="${apiKey}",algorithm="hmac-sha512",headers="date x-mod-nonce (request-target)",signature="${sigB64}"`,
    'Date': now,
    'x-mod-nonce': nonce,
    'Content-Type': 'application/json',
  }
}

// Execute an authenticated Modulr API request
export async function modulrRequest(
  apiKey: string,
  hmacSecret: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const headers = await buildModulrAuthHeader(apiKey, hmacSecret, method, path)
  const url = `${getModulrBaseUrl()}${path}`

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })

  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

// Verify the caller is an admin/hr of the specified company
export async function verifyAdmin(
  sb: ReturnType<typeof getSupabase>,
  authHeader: string | null,
  companyId: string,
): Promise<{ userId: string } | Response> {
  if (!authHeader) return json({ error: 'Unauthorized' }, 401)
  const { data: { user }, error } = await sb.auth.getUser(authHeader.replace('Bearer ', ''))
  if (error || !user) return json({ error: 'Unauthorized' }, 401)

  const { data: cu } = await sb
    .from('company_users')
    .select('role')
    .eq('auth_user_id', user.id)
    .eq('company_id', companyId)
    .eq('is_active', true)
    .maybeSingle()

  if (!cu || (cu.role !== 'admin' && cu.role !== 'hr')) {
    return json({ error: 'Admin access required' }, 403)
  }
  return { userId: user.id }
}
