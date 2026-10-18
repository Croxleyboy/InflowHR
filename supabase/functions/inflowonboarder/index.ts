import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALLOWED_ORIGIN = 'https://app.inflowhr.com'
const ENGINE_URL = Deno.env.get('INFLOWONBOARDER_API_URL') || 'http://localhost:3001'
const MOCK_MODE = Deno.env.get('INFLOWONBOARDER_MOCK') === 'true'
const ENCRYPTION_KEY_HEX = Deno.env.get('INFLOWONBOARDER_ENCRYPTION_KEY') || ''

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// ── AES-256-GCM encryption (same pattern as modulr shared) ──────────────────

async function getEncryptionKey(): Promise<CryptoKey> {
  const keyBytes = new Uint8Array(ENCRYPTION_KEY_HEX.match(/.{1,2}/g)!.map(b => parseInt(b, 16)))
  return crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

async function encryptApiKey(plaintext: string): Promise<{ encrypted: string; iv: string }> {
  const key = await getEncryptionKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(plaintext)
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded)
  return {
    encrypted: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
    iv: btoa(String.fromCharCode(...iv)),
  }
}

async function decryptApiKey(encrypted: string, ivB64: string): Promise<string> {
  const key = await getEncryptionKey()
  const iv = Uint8Array.from(atob(ivB64), c => c.charCodeAt(0))
  const ciphertext = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0))
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
  return new TextDecoder().decode(plaintext)
}

// ── Auth helper ─────────────────────────────────────────────────────────────

function getSupabase() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
}

async function verifyAdmin(
  sb: ReturnType<typeof getSupabase>,
  authHeader: string | null,
  companyId: string,
): Promise<{ userId: string } | Response> {
  if (!authHeader) return json({ error: 'Unauthorized' }, 401)
  const { data: { user }, error } = await sb.auth.getUser(authHeader.replace('Bearer ', ''))
  if (error || !user) return json({ error: 'Unauthorized' }, 401)
  const { data: sa } = await sb.from('super_admins').select('id').eq('email', user.email).maybeSingle()
  if (sa) return { userId: user.id }
  const { data: cu } = await sb.from('company_users').select('role').eq('auth_user_id', user.id).eq('company_id', companyId).eq('is_active', true).maybeSingle()
  if (!cu || (cu.role !== 'admin' && cu.role !== 'hr')) return json({ error: 'Admin access required' }, 403)
  return { userId: user.id }
}

// ── Engine HTTP calls ───────────────────────────────────────────────────────

async function engineFetch(
  apiKey: string,
  method: string,
  path: string,
  body?: unknown,
  idempotencyKey?: string,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey

  const res = await fetch(`${ENGINE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })

  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

// ── Mock engine responses ───────────────────────────────────────────────────

function mockConnections() {
  return {
    connections: [
      { connectorId: 'microsoft365', tier: 'read', status: 'healthy' },
      { connectorId: 'microsoft365', tier: 'write', status: 'healthy' },
    ],
  }
}

let mockJobCounter = 0
const mockJobs: Record<string, unknown> = {}

function mockAction(action: string, input: Record<string, unknown>, idempotencyKey: string) {
  const existing = Object.entries(mockJobs).find(([_, j]) => (j as any).idempotencyKey === idempotencyKey)
  if (existing) return { jobId: existing[0] }

  mockJobCounter++
  const jobId = `mock-job-${mockJobCounter}`
  if (action === 'm365.user.create') {
    mockJobs[jobId] = {
      id: jobId, action, status: 'succeeded', idempotencyKey,
      result: { userId: `mock-user-${mockJobCounter}`, userPrincipalName: input.userPrincipalName },
      error: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }
  } else if (action === 'm365.license.list') {
    mockJobs[jobId] = {
      id: jobId, action, status: 'succeeded', idempotencyKey,
      result: {
        licences: [
          { skuId: 'mock-sku-e3', skuPartNumber: 'ENTERPRISEPACK', name: 'Microsoft 365 E3', total: 50, assigned: 42, available: 8 },
          { skuId: 'mock-sku-e1', skuPartNumber: 'STANDARDPACK', name: 'Microsoft 365 E1', total: 20, assigned: 20, available: 0 },
        ],
      },
      error: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }
  } else if (action === 'm365.license.assign') {
    mockJobs[jobId] = {
      id: jobId, action, status: 'succeeded', idempotencyKey,
      result: { assigned: true, skuId: input.skuId },
      error: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }
  }
  return { jobId }
}

function mockJobStatus(jobId: string) {
  return mockJobs[jobId] || { id: jobId, action: 'unknown', status: 'failed', result: null, error: { code: 'not_found', message: 'Job not found' } }
}

// ── Audit helper ────────────────────────────────────────────────────────────

async function audit(sb: ReturnType<typeof getSupabase>, companyId: string, userId: string, action: string, details: Record<string, unknown>) {
  try {
    await sb.from('gdpr_audit_logs').insert({
      company_id: companyId,
      performed_by: userId,
      actor_role: 'admin',
      table_name: 'inflowonboarder_integrations',
      action,
      metadata: details,
    })
  } catch (_) {}
}

// ── Status calculation ──────────────────────────────────────────────────────

function calcStatus(connections: { connectorId: string; tier: string; status: string }[]): { status: string; detail: unknown } {
  const m365 = connections.filter(c => c.connectorId === 'microsoft365')
  const readConn = m365.find(c => c.tier === 'read')
  const writeConn = m365.find(c => c.tier === 'write')

  if (readConn?.status === 'healthy' && writeConn?.status === 'healthy') {
    return { status: 'connected_ready', detail: { connections: m365 } }
  }

  const missing: string[] = []
  if (!readConn || readConn.status !== 'healthy') missing.push('microsoft365 read')
  if (!writeConn || writeConn.status !== 'healthy') missing.push('microsoft365 write')
  return { status: 'connected_not_ready', detail: { connections: m365, missing } }
}

// ── Error code mapping ──────────────────────────────────────────────────────

const ERROR_MESSAGES: Record<string, string> = {
  upn_taken: 'An account with that email address already exists in Microsoft 365.',
  domain_not_allowed: 'That email domain is not allowed or not verified in your tenant.',
  no_free_licences: 'No free seats available for that licence. Purchase more seats, then click Re-check.',
  licence_not_found: 'That licence does not exist in your organisation.',
  usage_location_missing: 'The account has no country set. Update the usage location and retry.',
  user_not_managed: 'This account was not created through InflowOnboarder and cannot be licensed here.',
  user_not_found: 'The Microsoft 365 account no longer exists.',
  connection_failed: 'InflowOnboarder cannot reach your Microsoft 365 tenant. Check the connection in InflowOnboarder.',
  microsoft_error: 'Microsoft 365 returned an error. See the message below and retry if needed.',
  forbidden_scope: 'Your API key is missing a required permission. Check the key scopes in InflowOnboarder.',
  connection_not_ready: 'Microsoft 365 is not fully connected in InflowOnboarder. Finish the setup there first.',
  rate_limited: 'Too many requests. Please try again shortly.',
  unauthenticated: 'Your InflowOnboarder API key is invalid or has been revoked.',
}

function friendlyError(code: string, fallbackMessage?: string): string {
  return ERROR_MESSAGES[code] || fallbackMessage || `An unexpected error occurred (${code}).`
}

// ── Main handler ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const sb = getSupabase()
    const authHeader = req.headers.get('Authorization')
    const body = await req.json()
    const { company_id, action } = body

    if (!company_id || !action) return json({ error: 'Missing company_id or action' }, 400)

    const authResult = await verifyAdmin(sb, authHeader, company_id)
    if (authResult instanceof Response) return authResult
    const { userId } = authResult

    // ── connect ─────────────────────────────────────────────────────────────
    if (action === 'connect') {
      const { api_key } = body
      if (!api_key || typeof api_key !== 'string') return json({ error: 'API key is required' }, 400)
      if (!api_key.startsWith('ifo_')) return json({ error: 'Invalid API key format. Keys start with ifo_' }, 400)

      const hint = api_key.slice(-4)
      const { encrypted, iv } = await encryptApiKey(api_key)

      let status = 'connected_ready'
      let statusDetail: unknown = {}

      if (MOCK_MODE) {
        const mock = mockConnections()
        const calc = calcStatus(mock.connections)
        status = calc.status
        statusDetail = calc.detail
      } else {
        const res = await engineFetch(api_key, 'GET', '/v1/connections')
        if (res.status === 401) {
          return json({ error: friendlyError('unauthenticated'), status: 'needs_attention' }, 401)
        }
        if (!res.ok) {
          return json({ error: 'Failed to connect to InflowOnboarder', status: 'needs_attention' }, 502)
        }
        const calc = calcStatus((res.data as any).connections || [])
        status = calc.status
        statusDetail = calc.detail
      }

      const { error: upsertErr } = await sb.from('inflowonboarder_integrations').upsert({
        company_id,
        api_key_encrypted: encrypted,
        api_key_iv: iv,
        api_key_hint: hint,
        status,
        status_detail: statusDetail,
        status_checked_at: new Date().toISOString(),
        connected_at: new Date().toISOString(),
        connected_by: userId,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'company_id' })

      if (upsertErr) return json({ error: 'Failed to save integration: ' + upsertErr.message }, 500)
      await audit(sb, company_id, userId, 'inflowonboarder_connect', { status })
      return json({ status, status_detail: statusDetail, api_key_hint: hint })
    }

    // ── check-status ────────────────────────────────────────────────────────
    if (action === 'check-status') {
      const { data: config } = await sb.from('inflowonboarder_integrations').select('*').eq('company_id', company_id).maybeSingle()
      if (!config) return json({ status: 'not_connected' })

      let status: string
      let statusDetail: unknown = {}

      if (MOCK_MODE) {
        const mock = mockConnections()
        const calc = calcStatus(mock.connections)
        status = calc.status
        statusDetail = calc.detail
      } else {
        const apiKey = await decryptApiKey(config.api_key_encrypted, config.api_key_iv)
        const res = await engineFetch(apiKey, 'GET', '/v1/connections')
        if (res.status === 401) {
          status = 'needs_attention'
          statusDetail = { error: 'API key revoked or invalid' }
        } else if (!res.ok) {
          return json({ status: config.status, status_detail: config.status_detail, api_key_hint: config.api_key_hint, unavailable: true })
        } else {
          const calc = calcStatus((res.data as any).connections || [])
          status = calc.status
          statusDetail = calc.detail
        }
      }

      await sb.from('inflowonboarder_integrations').update({
        status,
        status_detail: statusDetail,
        status_checked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('company_id', company_id)

      return json({ status, status_detail: statusDetail, api_key_hint: config.api_key_hint })
    }

    // ── disconnect ──────────────────────────────────────────────────────────
    if (action === 'disconnect') {
      await sb.from('inflowonboarder_integrations').delete().eq('company_id', company_id)
      await audit(sb, company_id, userId, 'inflowonboarder_disconnect', {})
      return json({ status: 'not_connected' })
    }

    // ── create-account ──────────────────────────────────────────────────────
    if (action === 'create-account') {
      const { onboarding_id, input, attempt } = body
      if (!onboarding_id || !input) return json({ error: 'Missing onboarding_id or input' }, 400)

      const required = ['givenName', 'surname', 'displayName', 'userPrincipalName', 'usageLocation']
      for (const f of required) {
        if (!input[f]) return json({ error: `Missing required field: ${f}` }, 400)
      }

      const { data: config } = await sb.from('inflowonboarder_integrations').select('*').eq('company_id', company_id).maybeSingle()
      if (!config || config.status !== 'connected_ready') return json({ error: 'InflowOnboarder is not connected or M365 is not ready' }, 400)

      const idempotencyKey = `starter-${onboarding_id}-create-account-${attempt || 0}`
      let jobId: string

      if (MOCK_MODE) {
        const mock = mockAction('m365.user.create', input, idempotencyKey)
        jobId = mock.jobId
      } else {
        const apiKey = await decryptApiKey(config.api_key_encrypted, config.api_key_iv)
        const res = await engineFetch(apiKey, 'POST', '/v1/actions/m365.user.create', { input }, idempotencyKey)

        if (res.status === 401) {
          await sb.from('inflowonboarder_integrations').update({ status: 'needs_attention', updated_at: new Date().toISOString() }).eq('company_id', company_id)
          return json({ error: friendlyError('unauthenticated') }, 401)
        }
        if (res.status === 403) return json({ error: friendlyError((res.data as any)?.error?.code || 'forbidden_scope') }, 403)
        if (res.status === 409) return json({ error: friendlyError((res.data as any)?.error?.code || 'connection_not_ready') }, 409)
        if (res.status === 429) return json({ error: friendlyError('rate_limited') }, 429)
        if (!res.ok) return json({ error: friendlyError((res.data as any)?.error?.code, (res.data as any)?.error?.message) }, res.status)
        jobId = (res.data as any).jobId
      }

      await sb.from('onboarding_m365_actions').upsert({
        onboarding_id,
        company_id,
        create_account_job_id: jobId,
        create_account_status: 'queued',
        create_account_error: null,
        attempt_count_create: (attempt || 0) + 1,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'onboarding_id' })

      await audit(sb, company_id, userId, 'inflowonboarder_create_account', { onboarding_id, jobId })
      return json({ jobId })
    }

    // ── check-job ───────────────────────────────────────────────────────────
    if (action === 'check-job') {
      const { job_id, onboarding_id, job_type } = body
      if (!job_id) return json({ error: 'Missing job_id' }, 400)

      let jobData: any

      if (MOCK_MODE) {
        jobData = mockJobStatus(job_id)
      } else {
        const { data: config } = await sb.from('inflowonboarder_integrations').select('*').eq('company_id', company_id).maybeSingle()
        if (!config) return json({ error: 'Integration not configured' }, 400)
        const apiKey = await decryptApiKey(config.api_key_encrypted, config.api_key_iv)
        const res = await engineFetch(apiKey, 'GET', `/v1/jobs/${job_id}`)
        if (!res.ok) return json({ error: 'Failed to check job status' }, 502)
        jobData = res.data
      }

      if (onboarding_id && jobData.status) {
        const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

        if (job_type === 'create-account') {
          updates.create_account_status = jobData.status
          if (jobData.status === 'succeeded' && jobData.result) {
            updates.m365_user_id = jobData.result.userId
            updates.m365_upn = jobData.result.userPrincipalName
          }
          if (jobData.status === 'failed' && jobData.error) {
            updates.create_account_error = jobData.error
            if (jobData.error.code === 'connection_failed') {
              await sb.from('inflowonboarder_integrations').update({ status: 'needs_attention', updated_at: new Date().toISOString() }).eq('company_id', company_id)
            }
          }
        } else if (job_type === 'licence') {
          updates.licence_status = jobData.status
          if (jobData.status === 'failed' && jobData.error) {
            updates.licence_error = jobData.error
            if (jobData.error.code === 'no_free_licences') {
              updates.licence_flag = 'licence_needed'
            }
          }
          if (jobData.status === 'succeeded') {
            updates.licence_flag = null
          }
        }

        await sb.from('onboarding_m365_actions').update(updates).eq('onboarding_id', onboarding_id)
      }

      const friendlyErrorMsg = jobData.error ? friendlyError(jobData.error.code, jobData.error.message) : null
      return json({ ...jobData, friendlyError: friendlyErrorMsg })
    }

    // ── list-licences ───────────────────────────────────────────────────────
    if (action === 'list-licences') {
      const { onboarding_id } = body

      const { data: config } = await sb.from('inflowonboarder_integrations').select('*').eq('company_id', company_id).maybeSingle()
      if (!config || config.status !== 'connected_ready') return json({ error: 'InflowOnboarder is not connected or M365 is not ready' }, 400)

      const idempotencyKey = `starter-${onboarding_id}-list-licences-${Date.now()}`
      let jobId: string

      if (MOCK_MODE) {
        const mock = mockAction('m365.license.list', {}, idempotencyKey)
        jobId = mock.jobId
      } else {
        const apiKey = await decryptApiKey(config.api_key_encrypted, config.api_key_iv)
        const res = await engineFetch(apiKey, 'POST', '/v1/actions/m365.license.list', { input: {} }, idempotencyKey)
        if (!res.ok) {
          const code = (res.data as any)?.error?.code
          return json({ error: friendlyError(code || 'unknown') }, res.status)
        }
        jobId = (res.data as any).jobId
      }

      if (MOCK_MODE) {
        const jobData = mockJobStatus(jobId)
        return json(jobData)
      }

      // Poll for result (up to 30s in edge function, client will poll for longer jobs)
      const apiKey = await decryptApiKey(config.api_key_encrypted, config.api_key_iv)
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 3000))
        const res = await engineFetch(apiKey, 'GET', `/v1/jobs/${jobId}`)
        if (res.ok) {
          const jd = res.data as any
          if (jd.status === 'succeeded' || jd.status === 'failed') return json(jd)
        }
      }
      return json({ jobId, status: 'running', message: 'Still loading licences. Poll with check-job.' })
    }

    // ── assign-licence ──────────────────────────────────────────────────────
    if (action === 'assign-licence') {
      const { onboarding_id, user_id: m365UserId, sku_id, attempt } = body
      if (!onboarding_id || !m365UserId || !sku_id) return json({ error: 'Missing onboarding_id, user_id, or sku_id' }, 400)

      const { data: config } = await sb.from('inflowonboarder_integrations').select('*').eq('company_id', company_id).maybeSingle()
      if (!config || config.status !== 'connected_ready') return json({ error: 'InflowOnboarder is not connected or M365 is not ready' }, 400)

      const idempotencyKey = `starter-${onboarding_id}-assign-licence-${attempt || 0}`
      let jobId: string

      if (MOCK_MODE) {
        const mock = mockAction('m365.license.assign', { userId: m365UserId, skuId: sku_id }, idempotencyKey)
        jobId = mock.jobId
      } else {
        const apiKey = await decryptApiKey(config.api_key_encrypted, config.api_key_iv)
        const res = await engineFetch(apiKey, 'POST', '/v1/actions/m365.license.assign', { input: { userId: m365UserId, skuId: sku_id } }, idempotencyKey)
        if (res.status === 401) {
          await sb.from('inflowonboarder_integrations').update({ status: 'needs_attention', updated_at: new Date().toISOString() }).eq('company_id', company_id)
          return json({ error: friendlyError('unauthenticated') }, 401)
        }
        if (!res.ok) {
          const code = (res.data as any)?.error?.code
          return json({ error: friendlyError(code || 'unknown', (res.data as any)?.error?.message) }, res.status)
        }
        jobId = (res.data as any).jobId
      }

      await sb.from('onboarding_m365_actions').update({
        licence_job_id: jobId,
        licence_status: 'queued',
        licence_error: null,
        licence_sku_id: sku_id,
        licence_flag: null,
        attempt_count_licence: (attempt || 0) + 1,
        updated_at: new Date().toISOString(),
      }).eq('onboarding_id', onboarding_id)

      await audit(sb, company_id, userId, 'inflowonboarder_assign_licence', { onboarding_id, jobId, sku_id })
      return json({ jobId })
    }

    return json({ error: `Unknown action: ${action}` }, 400)

  } catch (err) {
    if ((err as any)?.message?.includes('InflowOnboarder')) {
      return json({ error: 'InflowOnboarder is unavailable. Actions are hidden until it comes back online.' }, 503)
    }
    return json({ error: 'Internal server error' }, 500)
  }
})
