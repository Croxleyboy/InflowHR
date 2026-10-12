// POST /functions/v1/modulr-payout  { company_id, payrun_ref, payments: [{ employee_id, amount, sort_code, account_number, reference, employee_name }] }
// Submits a batch Faster Payment via Modulr and records audit trail.
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

// AES-256-GCM decryption
const ENCRYPTION_KEY_HEX = Deno.env.get('MODULR_ENCRYPTION_KEY') || ''

async function getEncryptionKey(): Promise<CryptoKey> {
  const keyBytes = new Uint8Array(ENCRYPTION_KEY_HEX.match(/.{1,2}/g)!.map(b => parseInt(b, 16)))
  return crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

async function decryptCredential(encrypted: string, ivB64: string): Promise<string> {
  const key = await getEncryptionKey()
  const iv = Uint8Array.from(atob(ivB64), c => c.charCodeAt(0))
  const ciphertext = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0))
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
  return new TextDecoder().decode(plaintext)
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
    const { company_id, payrun_ref, payments } = await req.json()

    if (!company_id || !payrun_ref || !payments?.length) {
      return json({ error: 'company_id, payrun_ref, and payments array required' }, 400)
    }

    const authResult = await verifyAdmin(sb, authHeader, company_id)
    if (authResult instanceof Response) return authResult

    // Load integration
    const { data: integration } = await sb
      .from('modulr_integrations')
      .select('api_key_encrypted, hmac_secret_encrypted, source_account_id, encryption_iv, status')
      .eq('company_id', company_id)
      .single()

    if (!integration || integration.status !== 'connected') {
      return json({ error: 'Modulr not connected' }, 400)
    }

    // Validate all payments have bank details
    const invalid = payments.filter((p: { sort_code?: string; account_number?: string }) =>
      !p.sort_code || !p.account_number || !/^\d{6}$/.test(p.sort_code) || !/^\d{8}$/.test(p.account_number)
    )
    if (invalid.length > 0) {
      return json({ error: `${invalid.length} payment(s) have missing or invalid bank details` }, 400)
    }

    const totalAmount = payments.reduce((sum: number, p: { amount: number }) => sum + p.amount, 0)

    // Create audit record
    const { data: paymentRecord, error: insertErr } = await sb
      .from('modulr_payments')
      .insert({
        company_id,
        payrun_ref,
        total_amount: totalAmount,
        employee_count: payments.length,
        status: 'pending',
        submitted_by: authResult.userId,
      })
      .select('id')
      .single()

    if (insertErr || !paymentRecord) {
      return json({ error: 'Failed to create payment record' }, 500)
    }

    // Insert line items
    const items = payments.map((p: { employee_id: string; amount: number; sort_code: string; account_number: string; reference: string }) => ({
      payment_id: paymentRecord.id,
      employee_id: p.employee_id,
      amount: p.amount,
      sort_code: p.sort_code,
      account_number: p.account_number,
      reference: p.reference,
      status: 'pending',
    }))
    await sb.from('modulr_payment_items').insert(items)

    // Decrypt credentials
    const ivs = JSON.parse(integration.encryption_iv)
    const apiKey = await decryptCredential(integration.api_key_encrypted, ivs.apiKey)
    const hmacSecret = await decryptCredential(integration.hmac_secret_encrypted, ivs.hmac)

    // Build Modulr batch payment request
    const modulrPayments = payments.map((p: { sort_code: string; account_number: string; amount: number; reference: string; employee_name: string }) => ({
      sourceAccountId: integration.source_account_id,
      destination: {
        type: 'SCAN',
        sortCode: p.sort_code,
        accountNumber: p.account_number,
        name: (p.employee_name || 'Employee').substring(0, 18),
      },
      currency: 'GBP',
      amount: p.amount,
      reference: (p.reference || 'SALARY').substring(0, 18),
      externalReference: `${payrun_ref}_${p.employee_id}`,
      type: 'FASTER_PAYMENT',
    }))

    const result = await modulrRequest(apiKey, hmacSecret, 'POST', '/batchpayments', {
      externalReference: payrun_ref,
      payments: modulrPayments,
    })

    if (result.ok) {
      const batchData = result.data as Record<string, unknown>
      const batchStatus = batchData.status === 'APPROVAL_REQUIRED' ? 'submitted' : 'submitted'

      await sb.from('modulr_payments').update({
        modulr_batch_id: batchData.id as string,
        status: batchStatus,
        status_detail: batchData.status as string,
      }).eq('id', paymentRecord.id)

      await sb.from('modulr_payment_items').update({ status: 'submitted' }).eq('payment_id', paymentRecord.id)

      // Audit log
      try {
        await sb.rpc('log_gdpr_action', {
          p_company_id: company_id,
          p_user_id: authResult.userId,
          p_action: 'modulr_batch_payout',
          p_entity_type: 'modulr_payments',
          p_entity_id: paymentRecord.id,
          p_details: {
            payrun_ref,
            total_amount: totalAmount,
            employee_count: payments.length,
            modulr_batch_id: batchData.id,
            modulr_status: batchData.status,
          },
        })
      } catch (_) {}

      return json({
        payment_id: paymentRecord.id,
        modulr_batch_id: batchData.id,
        modulr_status: batchData.status,
        total_amount: totalAmount,
        employee_count: payments.length,
      })
    } else {
      await sb.from('modulr_payments').update({
        status: 'failed',
        status_detail: JSON.stringify(result.data),
      }).eq('id', paymentRecord.id)

      await sb.from('modulr_payment_items').update({ status: 'failed' }).eq('payment_id', paymentRecord.id)

      if (result.status === 403) {
        return json({ error: 'IP Whitelist Error. Please ensure our static IP is added to your Modulr portal.' }, 403)
      }
      return json({ error: 'Modulr payment submission failed', detail: result.data }, result.status)
    }
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
})
