// POST /functions/v1/modulr-connect  { company_id, api_key, hmac_secret, source_account_id }
// Encrypts credentials, stores them, and tests the Modulr connection.
// SELF-CONTAINED: all shared code inlined for Supabase dashboard deployment.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ── Shared utilities (inlined) ──────────────────────────────────────────────

function getSupabase() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
}

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

const MODULR_BASE_URL = Deno.env.get('MODULR_API_URL') || 'https://api-sandbox.modulrfinance.com/api-sandbox-token'

function isSandboxTokenMode(): boolean {
  return MODULR_BASE_URL.includes('api-sandbox-token')
}

// AES-256-GCM encryption
const ENCRYPTION_KEY_HEX = Deno.env.get('MODULR_ENCRYPTION_KEY') || ''

async function getEncryptionKey(): Promise<CryptoKey> {
  const keyBytes = new Uint8Array(ENCRYPTION_KEY_HEX.match(/.{1,2}/g)!.map(b => parseInt(b, 16)))
  return crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

async function encryptCredential(plaintext: string): Promise<{ encrypted: string; iv: string }> {
  const key = await getEncryptionKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(plaintext)
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded)
  return {
    encrypted: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
    iv: btoa(String.fromCharCode(...iv)),
  }
}

// Modulr HMAC-SHA1 signature
async function buildModulrAuthHeader(
  apiKey: string,
  hmacSecret: string,
): Promise<Record<string, string>> {
  const now = new Date().toUTCString()
  const nonce = crypto.randomUUID()
  const signatureString = `date: ${now}\nx-mod-nonce: ${nonce}`

  const keyBytes = new TextEncoder().encode(hmacSecret)
  const msgBytes = new TextEncoder().encode(signatureString)
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, msgBytes)
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
  const sigEncoded = encodeURIComponent(sigB64).replace(/%([0-9a-f]{2})/gi, (_, hex: string) => `%${hex.toUpperCase()}`)

  return {
    'Authorization': `Signature keyId="${apiKey}",algorithm="hmac-sha1",headers="date x-mod-nonce",signature="${sigEncoded}"`,
    'Date': now,
    'x-mod-nonce': nonce,
    'Content-Type': 'application/json',
  }
}

async function buildAuthHeaders(
  apiKey: string,
  hmacSecret: string,
): Promise<Record<string, string>> {
  if (isSandboxTokenMode()) {
    return {
      'Authorization': apiKey,
      'Content-Type': 'application/json',
    }
  }
  return buildModulrAuthHeader(apiKey, hmacSecret)
}

async function modulrRequest(
  apiKey: string,
  hmacSecret: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const headers = await buildAuthHeaders(apiKey, hmacSecret)
  const url = `${MODULR_BASE_URL}${path}`

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })

  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

async function verifyAdmin(
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

// ── Main handler ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const sb = getSupabase()
    const authHeader = req.headers.get('Authorization')
    const { company_id, api_key, hmac_secret, source_account_id } = await req.json()

    if (!company_id || !api_key || !hmac_secret || !source_account_id) {
      return json({ error: 'All fields are required: api_key, hmac_secret, source_account_id' }, 400)
    }

    const authResult = await verifyAdmin(sb, authHeader, company_id)
    if (authResult instanceof Response) return authResult

    // Test the connection by fetching the source account
    const testResult = await modulrRequest(api_key, hmac_secret, 'GET', `/accounts/${source_account_id}`)

    let status: string
    let statusError: string | null = null

    if (testResult.ok) {
      status = 'connected'
    } else if (testResult.status === 403) {
      status = 'ip_whitelist_pending'
      statusError = 'IP Whitelist Error. Please ensure our static IP is added to your Modulr portal.'
    } else if (testResult.status === 401) {
      status = 'error'
      statusError = 'Invalid API Key or HMAC Secret.'
    } else {
      status = 'error'
      statusError = `Modulr API returned HTTP ${testResult.status}`
    }

    // Encrypt credentials before storage
    const { encrypted: apiKeyEnc, iv: apiKeyIv } = await encryptCredential(api_key)
    const { encrypted: hmacEnc, iv: hmacIv } = await encryptCredential(hmac_secret)
    const combinedIv = JSON.stringify({ apiKey: apiKeyIv, hmac: hmacIv })

    const { error: upsertErr } = await sb
      .from('modulr_integrations')
      .upsert({
        company_id,
        api_key_encrypted: apiKeyEnc,
        hmac_secret_encrypted: hmacEnc,
        source_account_id,
        encryption_iv: combinedIv,
        status,
        status_error: statusError,
        connected_at: status === 'connected' ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'company_id' })

    if (upsertErr) return json({ error: 'Failed to save integration: ' + upsertErr.message }, 500)

    // Audit log
    try {
      await sb.rpc('log_gdpr_action', {
        p_company_id: company_id,
        p_user_id: authResult.userId,
        p_action: 'modulr_connect',
        p_entity_type: 'modulr_integrations',
        p_details: { status, source_account_id },
      })
    } catch (_) {}

    return json({ status, error: statusError })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
})
