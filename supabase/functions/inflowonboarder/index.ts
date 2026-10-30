import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALLOWED_ORIGIN = 'https://app.inflowhr.com'
const ENGINE_URL = Deno.env.get('INFLOWONBOARDER_API_URL') || 'http://localhost:3001'
const MOCK_MODE = Deno.env.get('INFLOWONBOARDER_MOCK') === 'true'
const MOCK_NO_LICENCE = Deno.env.get('INFLOWONBOARDER_MOCK_NO_LICENCE') === 'true'
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

// ── AES-256-GCM encryption ─────────────────────────────────────────────────

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
): Promise<{ userId: string; userEmail: string } | Response> {
  if (!authHeader) return json({ error: 'Unauthorized' }, 401)
  const { data: { user }, error } = await sb.auth.getUser(authHeader.replace('Bearer ', ''))
  if (error || !user) return json({ error: 'Unauthorized' }, 401)
  const { data: sa } = await sb.from('super_admins').select('id').eq('email', user.email).maybeSingle()
  if (sa) return { userId: user.id, userEmail: user.email! }
  const { data: cu } = await sb.from('company_users').select('role').eq('auth_user_id', user.id).eq('company_id', companyId).eq('is_active', true).maybeSingle()
  if (!cu || (cu.role !== 'admin' && cu.role !== 'hr')) return json({ error: 'Admin access required' }, 403)
  return { userId: user.id, userEmail: user.email! }
}

// ── Auth helper: admin, HR, or the starter's line manager ──────────────────

async function verifyAdminOrManager(
  sb: ReturnType<typeof getSupabase>,
  authHeader: string | null,
  companyId: string,
  onboardingId: number,
): Promise<{ userId: string; userEmail: string } | Response> {
  if (!authHeader) return json({ error: 'Unauthorized' }, 401)
  const { data: { user }, error } = await sb.auth.getUser(authHeader.replace('Bearer ', ''))
  if (error || !user) return json({ error: 'Unauthorized' }, 401)
  const { data: sa } = await sb.from('super_admins').select('id').eq('email', user.email).maybeSingle()
  if (sa) return { userId: user.id, userEmail: user.email! }
  const { data: cu } = await sb.from('company_users').select('role, employee_id').eq('auth_user_id', user.id).eq('company_id', companyId).eq('is_active', true).maybeSingle()
  if (!cu) return json({ error: 'Access denied' }, 403)
  if (cu.role === 'admin' || cu.role === 'hr') return { userId: user.id, userEmail: user.email! }
  if (cu.employee_id) {
    const { data: onb } = await sb.from('onboardings')
      .select('employee_id, employees!inner(manager_id)')
      .eq('id', onboardingId)
      .maybeSingle()
    if (onb && (onb as any).employees?.manager_id === cu.employee_id) {
      return { userId: user.id, userEmail: user.email! }
    }
  }
  return json({ error: 'Only the line manager, HR, or an admin can view passes' }, 403)
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

// ── Mock engine (joiner) ───────────────────────────────────────────────────

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
  if (action === 'm365.license.list') {
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
  }
  return { jobId }
}

function mockJobStatus(jobId: string) {
  return mockJobs[jobId] || { id: jobId, action: 'unknown', status: 'failed', result: null, error: { code: 'not_found', message: 'Job not found' } }
}

// ── Mock workflow run state machine (joiner, DB-backed) ────────────────────

function mockStartRun(onboardingId: number): { id: string; status: string; error?: unknown } {
  const id = `mock-run-${onboardingId}`
  const status = MOCK_NO_LICENCE ? 'licence_unavailable' : 'ready_for_approval'
  return {
    id,
    status,
    ...(MOCK_NO_LICENCE ? { error: { code: 'no_free_licences', message: 'No free seats for ENTERPRISEPACK' } } : {}),
  }
}

async function mockCheckRun(sb: ReturnType<typeof getSupabase>, runId: string, onboardingId: number): Promise<unknown> {
  const { data: row } = await sb.from('onboarding_m365_actions').select('run_status, run_error, run_result, m365_upn, m365_user_id').eq('onboarding_id', onboardingId).maybeSingle()
  if (!row) return { id: runId, status: 'failed', error: { code: 'not_found', message: 'Run not found' } }
  return { id: runId, status: row.run_status, error: row.run_error, result: row.run_result }
}

function mockRecheckRun(currentStatus: string): unknown {
  if (currentStatus === 'licence_unavailable') {
    return { status: 'ready_for_approval', error: null }
  }
  return { status: currentStatus }
}

function mockProceedRun(runId: string, onboardingId: number, currentStatus: string): unknown {
  if (currentStatus === 'ready_for_approval' || currentStatus === 'awaiting_approval') {
    return {
      status: 'completed',
      result: {
        userId: `mock-user-${onboardingId}`,
        userPrincipalName: `newstarter${onboardingId}@contoso.com`,
        temporaryPassword: `Tmp${Math.random().toString(36).slice(2, 8)}!${Math.floor(Math.random() * 90 + 10)}`,
      },
      error: null,
    }
  }
  return { status: currentStatus }
}

function mockPassesStatus() {
  return { enabled: true, ready: true, passes: { total: 10, active: 2 } }
}

function mockRevealPass(passId: string) {
  return {
    passId,
    temporaryAccessPass: `MOCK${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
    expiresAt: new Date(Date.now() + 8 * 3600000).toISOString(),
    isUsableOnce: true,
    notice: 'This is a one-time use pass. Go to https://aka.ms/mysecurityinfo, sign in with your work email, choose "Use a Temporary Access Pass", enter it, then set up the Microsoft Authenticator app.',
  }
}

let mockPassJobCounter = 0
function mockRequestNewPass(onboardingId: number) {
  mockPassJobCounter++
  const jobId = `mock-pass-job-${mockPassJobCounter}`
  mockJobs[jobId] = {
    id: jobId, action: 'passes.create', status: 'succeeded', idempotencyKey: `pass-${onboardingId}`,
    result: {
      passId: `mock-pass-${onboardingId}-${mockPassJobCounter}`,
      expiresAt: new Date(Date.now() + 8 * 3600000).toISOString(),
    },
    error: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }
  return { jobId }
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
  } catch (e) { console.error('[IFO] audit write failed:', e) }
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

const WEBHOOK_URL = Deno.env.get('INFLOWONBOARDER_WEBHOOK_URL') || ''
const WEBHOOK_EVENTS = [
  'schedule.created', 'schedule.approved', 'schedule.updated',
  'schedule.blocked', 'schedule.unblocked', 'schedule.stage_upcoming',
  'schedule.stage_completed', 'schedule.completed', 'schedule.cancelled',
  'schedule.missed', 'schedule.failed', 'workflow.run.updated',
]

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
  run_exists: 'A workflow run already exists for this starter.',
  group_not_allowed: 'That group does not exist or is not allowed in your tenant.',
  approval_evidence_required: 'Complete the approval in InflowHR first before proceeding.',
  schedule_exists: 'A schedule already exists for this starter.',
  stage_in_past: 'One or more schedule stages would fall in the past. Use "Run now" instead.',
  schedule_busy: 'The schedule is currently running and cannot be changed.',
  passes_off: 'First-day passes are switched off in InflowOnboarder.',
  passes_not_connected: 'First-day passes are being set up in InflowOnboarder.',
  passes_setup_incomplete: 'First-day passes are being set up in InflowOnboarder.',
  function_suspended: 'First-day passes are temporarily suspended by the InflowOnboarder service.',
  pass_gone: 'This pass is no longer available.',
  plan_required: 'This feature needs the JML Management plan in InflowOnboarder.',
  not_engine_managed: 'This account was not created by InflowOnboarder.',
  account_has_admin_role: 'Passes are not allowed for this account.',
  account_protected: 'Passes are not allowed for this account.',
  pass_not_allowed: "The company's Microsoft policy does not allow passes.",
  pass_policy: "The pass lifetime does not fit the company's Microsoft policy.",
}

function jsonNoStore(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

function friendlyError(code: string, fallbackMessage?: string): string {
  return ERROR_MESSAGES[code] || fallbackMessage || `An unexpected error occurred (${code}).`
}

// ── Helper: get decrypted API key for a company ─────────────────────────────

async function getApiKey(sb: ReturnType<typeof getSupabase>, companyId: string): Promise<{ apiKey: string; config: any } | Response> {
  const { data: config } = await sb.from('inflowonboarder_integrations').select('*').eq('company_id', companyId).maybeSingle()
  if (!config || config.status === 'not_connected') return json({ error: 'InflowOnboarder is not connected' }, 400)
  if (config.status !== 'connected_ready' && config.status !== 'connected_not_ready') {
    return json({ error: 'InflowOnboarder connection needs attention. Re-check the connection on the Integrations page.' }, 400)
  }
  const apiKey = await decryptApiKey(config.api_key_encrypted, config.api_key_iv)
  return { apiKey, config }
}

// ── Helper: handle engine error responses ───────────────────────────────────

function handleEngineError(
  sb: ReturnType<typeof getSupabase>,
  companyId: string,
  res: { ok: boolean; status: number; data: unknown },
): Response | null {
  if (res.ok) return null
  const errData = res.data as any
  const code = errData?.error?.code || 'unknown'

  if (res.status === 401) {
    sb.from('inflowonboarder_integrations').update({ status: 'needs_attention', updated_at: new Date().toISOString() }).eq('company_id', companyId)
    return json({ error: friendlyError('unauthenticated') }, 401)
  }
  if (res.status === 403) return json({ error: friendlyError(code || 'forbidden_scope') }, 403)
  if (res.status === 429) return json({ error: friendlyError('rate_limited') }, 429)
  if (res.status >= 500) return json({ error: 'InflowOnboarder is temporarily unavailable. Please try again shortly.' }, 503)

  if (res.status === 409 && code === 'plan_required') {
    const engineMsg = errData?.error?.message || ERROR_MESSAGES.plan_required
    return json({ error: `${engineMsg} You can add the plan in InflowOnboarder › Account and subscription.` }, 409)
  }

  if (res.status === 409 && code === 'run_exists') {
    return json({ error: friendlyError('run_exists'), run_id: errData?.error?.runId }, 409)
  }

  if (res.status === 400) {
    if (errData?.error?.issues) {
      const issueDetails = errData.error.issues.map((i: any) => `${i.path?.join('.')}: ${i.message}`).join('; ')
      return json({ error: `Validation failed: ${issueDetails}` }, 400)
    }
    return json({ error: friendlyError(code, errData?.error?.message) }, 400)
  }

  return json({ error: friendlyError(code, errData?.error?.message) }, res.status)
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

    const passActions = ['reveal-pass', 'request-new-pass']
    let authResult: { userId: string; userEmail: string } | Response
    if (passActions.includes(action) && body.onboarding_id) {
      authResult = await verifyAdminOrManager(sb, authHeader, company_id, body.onboarding_id)
    } else {
      authResult = await verifyAdmin(sb, authHeader, company_id)
    }
    if (authResult instanceof Response) return authResult
    const { userId, userEmail } = authResult

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

      // Register or update webhook
      let webhookId: string | null = null
      let webhookSecret: string | null = null
      if (WEBHOOK_URL && !MOCK_MODE) {
        const { data: existingConfig } = await sb.from('inflowonboarder_integrations').select('webhook_id').eq('company_id', company_id).maybeSingle()
        if (existingConfig?.webhook_id) {
          await engineFetch(api_key, 'PATCH', `/v1/webhooks/${existingConfig.webhook_id}`, {
            url: WEBHOOK_URL,
            events: WEBHOOK_EVENTS,
          })
          webhookId = existingConfig.webhook_id
        } else {
          const whRes = await engineFetch(api_key, 'POST', '/v1/webhooks', {
            url: WEBHOOK_URL,
            events: WEBHOOK_EVENTS,
          })
          if (whRes.ok) {
            const whData = whRes.data as any
            webhookId = whData.id
            webhookSecret = whData.secret
          }
        }
      }

      // Fetch schedule templates on connect
      let scheduleTemplatesCache: unknown = null
      if (!MOCK_MODE) {
        const tplRes = await engineFetch(api_key, 'GET', '/v1/schedule-templates')
        if (tplRes.ok) scheduleTemplatesCache = (tplRes.data as any).templates || tplRes.data
      }

      const upsertData: Record<string, unknown> = {
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
      }
      if (webhookId) upsertData.webhook_id = webhookId
      if (webhookSecret) upsertData.webhook_secret = webhookSecret
      if (scheduleTemplatesCache) {
        upsertData.schedule_templates_cache = scheduleTemplatesCache
        upsertData.schedule_templates_cached_at = new Date().toISOString()
      }

      const { error: upsertErr } = await sb.from('inflowonboarder_integrations').upsert(upsertData, { onConflict: 'company_id' })

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

      // Refresh schedule templates if stale (>1 hour) or missing
      let scheduleTemplates = config.schedule_templates_cache
      let templatesCachedAt = config.schedule_templates_cached_at
      const cacheAge = templatesCachedAt ? Date.now() - new Date(templatesCachedAt).getTime() : Infinity
      if (!MOCK_MODE && status === 'connected_ready' && cacheAge > 3600000) {
        const apiKey = await decryptApiKey(config.api_key_encrypted, config.api_key_iv)
        const tplRes = await engineFetch(apiKey, 'GET', '/v1/schedule-templates')
        if (tplRes.ok) {
          scheduleTemplates = (tplRes.data as any).templates || tplRes.data
          templatesCachedAt = new Date().toISOString()
        }
      }

      // Check passes readiness from engine
      let passesEnabled = config.passes_enabled || false
      let passesReady = config.passes_ready || false
      let passesStatusDetail = config.passes_status_detail || null
      let passesAvailable = config.passes_available !== false
      let functionsCacheOut: Record<string, unknown> | null = config.functions_cache || null
      if (status === 'connected_ready') {
        if (MOCK_MODE) {
          const mockPasses = mockPassesStatus()
          passesEnabled = mockPasses.enabled
          passesReady = mockPasses.ready
          passesStatusDetail = null
        } else {
          const apiKey = await decryptApiKey(config.api_key_encrypted, config.api_key_iv)
          const passesRes = await engineFetch(apiKey, 'GET', '/v1/passes')
          if (passesRes.ok) {
            const pd = passesRes.data as any
            passesEnabled = pd.enabled === true
            passesReady = pd.ready === true
            passesStatusDetail = pd.statusDetail || null
          } else if (passesRes.status === 403) {
            passesEnabled = false
            passesReady = false
            passesStatusDetail = 'API key missing passes scope'
          }

          // Check /v1/functions for all function gating state (Item 3 + Item 5)
          const funcsRes = await engineFetch(apiKey, 'GET', '/v1/functions')
          if (funcsRes.ok) {
            const funcs = Array.isArray(funcsRes.data) ? funcsRes.data : (funcsRes.data as any)?.functions || []
            const knownIds = ['joiners', 'movers', 'leavers', 'personas', 'reports', 'passes']
            const functionsCache: Record<string, { enabled: boolean; suspended: boolean; suspendedReason?: string; inPlan: boolean; available?: boolean }> = {}
            for (const f of funcs) {
              if (!knownIds.includes(f.id)) continue
              functionsCache[f.id] = {
                enabled: f.enabled === true,
                suspended: f.suspended === true,
                ...(f.suspendedReason ? { suspendedReason: f.suspendedReason } : {}),
                inPlan: f.inPlan === true,
                ...(f.available !== undefined ? { available: f.available } : {}),
              }
            }
            functionsCacheOut = functionsCache

            const passesFunc = functionsCache.passes
            if (passesFunc) {
              if (passesFunc.suspended) {
                passesEnabled = false
                passesReady = false
                passesStatusDetail = passesFunc.suspendedReason
                  ? `Suspended: ${passesFunc.suspendedReason}`
                  : 'Temporarily suspended by InflowOnboarder'
              } else if (!passesFunc.enabled) {
                passesEnabled = false
                passesReady = false
                passesStatusDetail = null
              } else if (!passesFunc.inPlan) {
                passesEnabled = false
                passesReady = false
                passesStatusDetail = 'Requires the JML Management plan'
              }
              if (passesFunc.available === false) {
                passesAvailable = false
              }
            }
          }
        }
      }

      const updateData: Record<string, unknown> = {
        status,
        status_detail: statusDetail,
        status_checked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        passes_enabled: passesEnabled,
        passes_ready: passesReady,
        passes_status_detail: passesStatusDetail,
        passes_available: passesAvailable,
        functions_cache: functionsCacheOut,
        functions_cached_at: functionsCacheOut ? new Date().toISOString() : config.functions_cached_at,
      }
      if (scheduleTemplates !== config.schedule_templates_cache) {
        updateData.schedule_templates_cache = scheduleTemplates
        updateData.schedule_templates_cached_at = templatesCachedAt
      }

      await sb.from('inflowonboarder_integrations').update(updateData).eq('company_id', company_id)

      const templates = Array.isArray(scheduleTemplates) ? scheduleTemplates : []
      const hasJoinerTemplate = templates.some((t: any) => t.id === 'hr.joiner' || t.templateId === 'hr.joiner')
      const hasLeaverTemplate = templates.some((t: any) => t.id === 'hr.leaver' || t.templateId === 'hr.leaver')

      return json({
        status,
        status_detail: statusDetail,
        api_key_hint: config.api_key_hint,
        approver_mode: config.approver_mode,
        approver_name: config.approver_name,
        approver_email: config.approver_email,
        licence_manager_name: config.licence_manager_name,
        licence_manager_email: config.licence_manager_email,
        licence_sku_id: config.licence_sku_id,
        licence_sku_name: config.licence_sku_name,
        group_name: config.group_name,
        account_domain: config.account_domain,
        settings_updated_at: config.settings_updated_at,
        offboard_approver_mode: config.offboard_approver_mode,
        offboard_approver_name: config.offboard_approver_name,
        offboard_approver_email: config.offboard_approver_email,
        schedule_templates_available: hasJoinerTemplate || hasLeaverTemplate,
        schedule_templates: templates,
        has_joiner_template: hasJoinerTemplate,
        has_leaver_template: hasLeaverTemplate,
        passes_enabled: passesEnabled,
        passes_ready: passesReady,
        passes_status_detail: passesStatusDetail,
        passes_available: passesAvailable,
        functions_cache: functionsCacheOut,
      })
    }

    // ── disconnect ──────────────────────────────────────────────────────────
    if (action === 'disconnect') {
      await sb.from('inflowonboarder_integrations').delete().eq('company_id', company_id)
      await audit(sb, company_id, userId, 'inflowonboarder_disconnect', {})
      return json({ status: 'not_connected' })
    }

    // ── save-settings ───────────────────────────────────────────────────────
    if (action === 'save-settings') {
      const { approver_mode, approver_name, approver_email, licence_manager_name, licence_manager_email, licence_sku_id, licence_sku_name, group_name, account_domain, offboard_approver_mode, offboard_approver_name, offboard_approver_email, mover_approver_mode, mover_approver_name, mover_approver_email } = body

      if (approver_mode && !['nominated', 'manager'].includes(approver_mode)) {
        return json({ error: 'approver_mode must be "nominated" or "manager"' }, 400)
      }
      if (approver_mode === 'nominated' && (!approver_name || !approver_email)) {
        return json({ error: 'Nominated approver requires a name and email' }, 400)
      }
      if (offboard_approver_mode && !['same_as_joiner', 'nominated', 'manager'].includes(offboard_approver_mode)) {
        return json({ error: 'offboard_approver_mode must be "same_as_joiner", "nominated" or "manager"' }, 400)
      }
      if (offboard_approver_mode === 'nominated' && (!offboard_approver_name || !offboard_approver_email)) {
        return json({ error: 'Nominated offboarding approver requires a name and email' }, 400)
      }
      if (mover_approver_mode && !['same_as_joiner', 'nominated', 'manager'].includes(mover_approver_mode)) {
        return json({ error: 'mover_approver_mode must be "same_as_joiner", "nominated" or "manager"' }, 400)
      }
      if (mover_approver_mode === 'nominated' && (!mover_approver_name || !mover_approver_email)) {
        return json({ error: 'Nominated mover approver requires a name and email' }, 400)
      }
      const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (approver_email && !emailRe.test(approver_email)) {
        return json({ error: 'Invalid approver email address' }, 400)
      }
      if (licence_manager_email && !emailRe.test(licence_manager_email)) {
        return json({ error: 'Invalid licence manager email address' }, 400)
      }
      if (offboard_approver_email && !emailRe.test(offboard_approver_email)) {
        return json({ error: 'Invalid offboarding approver email address' }, 400)
      }
      if (mover_approver_email && !emailRe.test(mover_approver_email)) {
        return json({ error: 'Invalid mover approver email address' }, 400)
      }

      const updates: Record<string, unknown> = {
        settings_updated_at: new Date().toISOString(),
        settings_updated_by: userId,
        updated_at: new Date().toISOString(),
      }
      if (approver_mode !== undefined) updates.approver_mode = approver_mode
      if (approver_name !== undefined) updates.approver_name = approver_name
      if (approver_email !== undefined) updates.approver_email = approver_email
      if (licence_manager_name !== undefined) updates.licence_manager_name = licence_manager_name
      if (licence_manager_email !== undefined) updates.licence_manager_email = licence_manager_email
      if (licence_sku_id !== undefined) updates.licence_sku_id = licence_sku_id
      if (licence_sku_name !== undefined) updates.licence_sku_name = licence_sku_name
      if (group_name !== undefined) updates.group_name = group_name
      if (account_domain !== undefined) updates.account_domain = account_domain
      if (offboard_approver_mode !== undefined) updates.offboard_approver_mode = offboard_approver_mode
      if (offboard_approver_name !== undefined) updates.offboard_approver_name = offboard_approver_name
      if (offboard_approver_email !== undefined) updates.offboard_approver_email = offboard_approver_email
      if (mover_approver_mode !== undefined) updates.mover_approver_mode = mover_approver_mode
      if (mover_approver_name !== undefined) updates.mover_approver_name = mover_approver_name
      if (mover_approver_email !== undefined) updates.mover_approver_email = mover_approver_email

      const { error: updateErr } = await sb.from('inflowonboarder_integrations').update(updates).eq('company_id', company_id)
      if (updateErr) return json({ error: 'Failed to save settings: ' + updateErr.message }, 500)

      await audit(sb, company_id, userId, 'inflowonboarder_save_settings', {
        approver_mode, licence_sku_id, licence_sku_name, group_name, account_domain, offboard_approver_mode, mover_approver_mode,
      })

      return json({ saved: true })
    }

    // ── load-settings ───────────────────────────────────────────────────────
    if (action === 'load-settings') {
      const { data: config } = await sb.from('inflowonboarder_integrations').select('*').eq('company_id', company_id).maybeSingle()
      if (!config) return json({ error: 'Integration not configured' }, 400)

      return json({
        approver_mode: config.approver_mode,
        approver_name: config.approver_name,
        approver_email: config.approver_email,
        licence_manager_name: config.licence_manager_name,
        licence_manager_email: config.licence_manager_email,
        licence_sku_id: config.licence_sku_id,
        licence_sku_name: config.licence_sku_name,
        group_name: config.group_name,
        account_domain: config.account_domain,
        settings_updated_at: config.settings_updated_at,
        offboard_approver_mode: config.offboard_approver_mode,
        offboard_approver_name: config.offboard_approver_name,
        offboard_approver_email: config.offboard_approver_email,
      })
    }

    // ── list-licences ───────────────────────────────────────────────────────
    if (action === 'list-licences') {
      const { data: config } = await sb.from('inflowonboarder_integrations').select('*').eq('company_id', company_id).maybeSingle()
      if (!config || config.status !== 'connected_ready') return json({ error: 'InflowOnboarder is not connected or M365 is not ready' }, 400)

      const idempotencyKey = `company-${company_id}-list-licences-${Date.now()}`

      if (MOCK_MODE) {
        const mock = mockAction('m365.license.list', {}, idempotencyKey)
        const jobData = mockJobStatus(mock.jobId)
        return json(jobData)
      }

      const apiKey = await decryptApiKey(config.api_key_encrypted, config.api_key_iv)
      const res = await engineFetch(apiKey, 'POST', '/v1/actions/m365.license.list', { input: {} }, idempotencyKey)
      if (!res.ok) {
        const code = (res.data as any)?.error?.code
        return json({ error: friendlyError(code || 'unknown') }, res.status)
      }
      const jobId = (res.data as any).jobId
      if (!jobId) return json({ error: 'No jobId returned from engine' }, 502)

      const maxAttempts = 15
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise(r => setTimeout(r, 1000))
        const pollRes = await engineFetch(apiKey, 'GET', `/v1/jobs/${jobId}`)
        if (!pollRes.ok) continue
        const job = pollRes.data as any
        if (job.status === 'succeeded') {
          return json({ result: job.result || job, status: 'succeeded' })
        }
        if (job.status === 'failed') {
          return json({ error: job.error?.message || 'Licence fetch failed', status: 'failed' }, 500)
        }
      }
      return json({ jobId, status: 'running' })
    }

    // ── start-run (joiner) ─────────────────────────────────────────────────
    if (action === 'start-run') {
      const { onboarding_id, input, attempt, issuePass } = body
      if (!onboarding_id) return json({ error: 'Missing onboarding_id' }, 400)
      if (!input?.displayName || !input?.userPrincipalName || !input?.usageLocation) {
        return json({ error: 'Missing required fields: displayName, userPrincipalName, usageLocation' }, 400)
      }

      const keyResult = await getApiKey(sb, company_id)
      if (keyResult instanceof Response) return keyResult
      const { config } = keyResult

      const upnRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!upnRe.test(input.userPrincipalName)) {
        return json({ error: 'Invalid userPrincipalName format — must be user@domain.tld' }, 400)
      }

      const idempotencyKey = `starter-${onboarding_id}-start-run-${Date.now()}`
      let runId: string
      let runStatus: string
      let passWarning: string | null = null

      let runError: unknown = null
      if (MOCK_MODE) {
        const mock = mockStartRun(onboarding_id)
        runId = mock.id
        runStatus = mock.status
        if (mock.error) runError = mock.error
      } else {
        const apiKey = keyResult.apiKey
        const person: Record<string, string> = {
          givenName: input.givenName,
          surname: input.surname,
          displayName: input.displayName,
          userPrincipalName: input.userPrincipalName,
          usageLocation: input.usageLocation,
        }
        if (input.jobTitle) person.jobTitle = input.jobTitle
        if (input.department) person.department = input.department
        if (input.employeeId) person.employeeId = input.employeeId
        if (input.officeLocation) person.officeLocation = input.officeLocation
        if (input.employeeHireDate) person.employeeHireDate = input.employeeHireDate
        const engineBody: Record<string, unknown> = {
          externalRef: String(onboarding_id),
          person,
        }
        if (config.licence_sku_id) engineBody.licenceSkuId = config.licence_sku_id
        if (config.group_name) engineBody.groupName = config.group_name
        if (config.licence_manager_name && config.licence_manager_email) {
          engineBody.licenceContact = { name: config.licence_manager_name, email: config.licence_manager_email }
        }
        if (issuePass && config.passes_ready) engineBody.issuePass = true
        const res = await engineFetch(apiKey, 'POST', '/v1/workflows/m365.joiner/runs', engineBody, idempotencyKey)

        if (res.status === 409) {
          const errData = res.data as any
          const errCode = errData?.error?.code
          if (['passes_off', 'passes_not_connected', 'passes_setup_incomplete', 'function_suspended'].includes(errCode) && engineBody.issuePass) {
            delete engineBody.issuePass
            passWarning = friendlyError(errCode)
            const retryRes = await engineFetch(apiKey, 'POST', '/v1/workflows/m365.joiner/runs', engineBody, `${idempotencyKey}-nopass`)
            if (retryRes.ok) {
              const retryData = retryRes.data as any
              runId = retryData.id || retryData.runId
              runStatus = retryData.status || 'checking_licence'
              await sb.from('onboarding_m365_actions').upsert({
                onboarding_id, company_id, run_id: runId, run_status: runStatus,
                run_error: null, run_result: null, approval_status: null,
                attempt_count_run: (attempt || 0) + 1, is_v1_legacy: false,
                updated_at: new Date().toISOString(),
              }, { onConflict: 'onboarding_id' })
              await audit(sb, company_id, userId, 'inflowonboarder_start_run', { onboarding_id, runId, runStatus, passWarning })
              return json({ run_id: runId, status: runStatus, pass_warning: passWarning })
            }
            const retryErr = handleEngineError(sb, company_id, retryRes)
            if (retryErr) return retryErr
          }

          const existingRunId = errData?.error?.runId
          if (existingRunId) {
            const checkRes = await engineFetch(apiKey, 'GET', `/v1/workflows/runs/${existingRunId}`)
            const existingStatus = checkRes.ok ? (checkRes.data as any).status || 'checking_licence' : 'checking_licence'
            const existingError = checkRes.ok ? (checkRes.data as any).error || null : null
            const existingResult = checkRes.ok ? (checkRes.data as any).result || null : null
            const updates: Record<string, unknown> = {
              onboarding_id,
              company_id,
              run_id: existingRunId,
              run_status: existingStatus,
              run_error: existingError,
              attempt_count_run: (attempt || 0) + 1,
              updated_at: new Date().toISOString(),
            }
            if (existingStatus === 'completed' && existingResult) {
              updates.run_result = existingResult
              updates.m365_user_id = existingResult.userId
              updates.m365_upn = existingResult.userPrincipalName
            }
            await sb.from('onboarding_m365_actions').upsert(updates, { onConflict: 'onboarding_id' })
            return json({ run_id: existingRunId, status: existingStatus, message: 'A run already exists for this starter.' })
          }
        }

        const errResp = handleEngineError(sb, company_id, res)
        if (errResp) return errResp

        const resData = res.data as any
        runId = resData.id || resData.runId
        runStatus = resData.status || 'checking_licence'
      }

      await sb.from('onboarding_m365_actions').upsert({
        onboarding_id,
        company_id,
        run_id: runId,
        run_status: runStatus,
        run_error: runError || null,
        run_result: null,
        approval_status: null,
        attempt_count_run: (attempt || 0) + 1,
        is_v1_legacy: false,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'onboarding_id' })

      await audit(sb, company_id, userId, 'inflowonboarder_start_run', { onboarding_id, runId, runStatus, passWarning })
      return json({ run_id: runId, status: runStatus, ...(passWarning ? { pass_warning: passWarning } : {}) })
    }

    // ── check-run (joiner) ─────────────────────────────────────────────────
    if (action === 'check-run') {
      const { run_id, onboarding_id } = body
      if (!run_id) return json({ error: 'Missing run_id' }, 400)
      if (!/^[a-zA-Z0-9_-]+$/.test(run_id)) return json({ error: 'Invalid run_id format' }, 400)

      let runData: any

      if (MOCK_MODE) {
        runData = await mockCheckRun(sb, run_id, onboarding_id)
      } else {
        const keyResult = await getApiKey(sb, company_id)
        if (keyResult instanceof Response) return keyResult
        const res = await engineFetch(keyResult.apiKey, 'GET', `/v1/workflows/runs/${run_id}`)
        const errResp = handleEngineError(sb, company_id, res)
        if (errResp) return errResp
        runData = res.data
      }

      if (onboarding_id && runData.status) {
        const updates: Record<string, unknown> = {
          run_status: runData.status,
          updated_at: new Date().toISOString(),
        }
        if (runData.status === 'completed' && runData.result) {
          updates.run_result = runData.result
          updates.m365_user_id = runData.result.userId
          updates.m365_upn = runData.result.userPrincipalName
          if (runData.result.passId) {
            updates.pass_id = runData.result.passId
            updates.pass_expires_at = runData.result.expiresAt || runData.result.passExpiresAt
            updates.pass_status = 'ready'
          }
        }
        if (runData.status === 'failed' && runData.error) {
          updates.run_error = runData.error
        }
        if (runData.status === 'licence_unavailable' && runData.error) {
          updates.run_error = runData.error
        }
        await sb.from('onboarding_m365_actions').update(updates).eq('onboarding_id', onboarding_id)
      }

      const friendlyErrorMsg = runData.error ? friendlyError(runData.error.code, runData.error.message) : null
      return json({ ...runData, friendlyError: friendlyErrorMsg })
    }

    // ── recheck-run (joiner) ───────────────────────────────────────────────
    if (action === 'recheck-run') {
      const { run_id, onboarding_id, attempt } = body
      if (!run_id) return json({ error: 'Missing run_id' }, 400)
      if (!/^[a-zA-Z0-9_-]+$/.test(run_id)) return json({ error: 'Invalid run_id format' }, 400)

      const idempotencyKey = `starter-${onboarding_id}-recheck-${Date.now()}`
      let runData: any

      if (MOCK_MODE) {
        const { data: row } = await sb.from('onboarding_m365_actions').select('run_status').eq('onboarding_id', onboarding_id).maybeSingle()
        runData = mockRecheckRun(row?.run_status || 'licence_unavailable')
      } else {
        const keyResult = await getApiKey(sb, company_id)
        if (keyResult instanceof Response) return keyResult
        const res = await engineFetch(keyResult.apiKey, 'POST', `/v1/workflows/runs/${run_id}/recheck`, {}, idempotencyKey)
        const errResp = handleEngineError(sb, company_id, res)
        if (errResp) return errResp
        runData = res.data
      }

      if (onboarding_id && runData.status) {
        await sb.from('onboarding_m365_actions').update({
          run_status: runData.status,
          run_error: runData.error || null,
          updated_at: new Date().toISOString(),
        }).eq('onboarding_id', onboarding_id)
      }

      await audit(sb, company_id, userId, 'inflowonboarder_recheck_run', { onboarding_id, run_id, newStatus: runData.status })
      const friendlyErrorMsg = runData.error ? friendlyError(runData.error.code, runData.error.message) : null
      return json({ ...runData, friendlyError: friendlyErrorMsg })
    }

    // ── proceed-run (joiner) ───────────────────────────────────────────────
    if (action === 'proceed-run') {
      const { run_id, onboarding_id, attempt, approver_name, approver_email, approved_at } = body
      if (!run_id) return json({ error: 'Missing run_id' }, 400)
      if (!/^[a-zA-Z0-9_-]+$/.test(run_id)) return json({ error: 'Invalid run_id format' }, 400)

      const idempotencyKey = `starter-${onboarding_id}-proceed-${Date.now()}`
      let runData: any

      if (MOCK_MODE) {
        const { data: row } = await sb.from('onboarding_m365_actions').select('run_status').eq('onboarding_id', onboarding_id).maybeSingle()
        runData = mockProceedRun(run_id, onboarding_id, row?.run_status || 'ready_for_approval')
      } else {
        const keyResult = await getApiKey(sb, company_id)
        if (keyResult instanceof Response) return keyResult
        const approvalBody = {
          approval: {
            approvedBy: { name: approver_name || 'InflowHR Approver', email: approver_email || userEmail },
            approvedAt: approved_at || new Date().toISOString(),
            reference: `inflowhr-approval-${onboarding_id}`,
          },
        }
        const res = await engineFetch(keyResult.apiKey, 'POST', `/v1/workflows/runs/${run_id}/proceed`, approvalBody, idempotencyKey)

        const errResp = handleEngineError(sb, company_id, res)
        if (errResp) return errResp
        runData = res.data
      }

      if (onboarding_id && runData.status) {
        const updates: Record<string, unknown> = {
          run_status: runData.status,
          run_error: runData.error || null,
          updated_at: new Date().toISOString(),
        }
        if (runData.status === 'completed' && runData.result) {
          updates.run_result = runData.result
          updates.m365_user_id = runData.result.userId
          updates.m365_upn = runData.result.userPrincipalName
        }
        await sb.from('onboarding_m365_actions').update(updates).eq('onboarding_id', onboarding_id)
      }

      await audit(sb, company_id, userId, 'inflowonboarder_proceed_run', { onboarding_id, run_id, newStatus: runData.status })
      const friendlyErrorMsg = runData.error ? friendlyError(runData.error.code, runData.error.message) : null
      return json({ ...runData, friendlyError: friendlyErrorMsg })
    }

    // ── mark-complete-manual (joiner) ──────────────────────────────────────
    if (action === 'mark-complete-manual') {
      const { onboarding_id, notes } = body
      if (!onboarding_id) return json({ error: 'Missing onboarding_id' }, 400)

      await sb.from('onboarding_m365_actions').update({
        run_status: 'completed',
        run_result: { manual: true, notes: notes || 'Marked complete manually', completedBy: userEmail },
        run_error: null,
        updated_at: new Date().toISOString(),
      }).eq('onboarding_id', onboarding_id)

      await audit(sb, company_id, userId, 'inflowonboarder_mark_complete_manual', { onboarding_id, notes })
      return json({ status: 'completed', manual: true })
    }

    // ── list-templates ──────────────────────────────────────────────────────
    if (action === 'list-templates') {
      const keyResult = await getApiKey(sb, company_id)
      if (keyResult instanceof Response) return keyResult

      if (MOCK_MODE) {
        const templates = [
          { id: 'hr.joiner', name: 'Schedule new joiners', stages: ['prepare', 'enable_sign_in'] },
          { id: 'hr.leaver', name: 'Schedule leavers', stages: ['block_access', 'remove_access'] },
        ]
        await sb.from('inflowonboarder_integrations').update({
          schedule_templates_cache: templates,
          schedule_templates_cached_at: new Date().toISOString(),
        }).eq('company_id', company_id)
        return json({ templates })
      }

      const res = await engineFetch(keyResult.apiKey, 'GET', '/v1/schedule-templates')
      const errResp = handleEngineError(sb, company_id, res)
      if (errResp) return errResp

      const templates = (res.data as any).templates || res.data
      await sb.from('inflowonboarder_integrations').update({
        schedule_templates_cache: templates,
        schedule_templates_cached_at: new Date().toISOString(),
      }).eq('company_id', company_id)

      return json({ templates })
    }

    // ── create-schedule (joiner) ──────────────────────────────────────────
    if (action === 'create-schedule') {
      const { onboarding_id, input, options, approver_name, approver_email, approved_at, attempt } = body
      if (!onboarding_id) return json({ error: 'Missing onboarding_id' }, 400)
      if (!input?.displayName || !input?.userPrincipalName || !input?.startDate) {
        return json({ error: 'Missing required fields: displayName, userPrincipalName, startDate' }, 400)
      }

      const keyResult = await getApiKey(sb, company_id)
      if (keyResult instanceof Response) return keyResult
      const { config } = keyResult

      const idempotencyKey = `inflowhr-joiner-${onboarding_id}-schedule-${Date.now()}`

      const person: Record<string, string> = {
        givenName: input.givenName,
        surname: input.surname,
        displayName: input.displayName,
        userPrincipalName: input.userPrincipalName,
        usageLocation: input.usageLocation || 'GB',
      }
      if (input.jobTitle) person.jobTitle = input.jobTitle
      if (input.department) person.department = input.department
      if (input.employeeId) person.employeeId = input.employeeId
      if (input.officeLocation) person.officeLocation = input.officeLocation
      if (input.employeeHireDate) person.employeeHireDate = input.employeeHireDate

      const scheduleOptions: Record<string, unknown> = { prepareDaysBefore: options?.prepareDaysBefore || 3 }
      if (body.issuePass && config.passes_ready) {
        scheduleOptions.issuePass = true
      }

      const engineBody: Record<string, unknown> = {
        templateId: 'hr.joiner',
        externalRef: `starter-${onboarding_id}`,
        parameters: {
          person,
          startDate: input.startDate,
          ...(config.licence_sku_id ? { licenceSkuId: config.licence_sku_id } : {}),
          ...(config.group_name ? { groupName: config.group_name } : {}),
          ...(config.licence_manager_name && config.licence_manager_email ? {
            licenceContact: { name: config.licence_manager_name, email: config.licence_manager_email },
          } : {}),
        },
        options: scheduleOptions,
        timeZone: 'Europe/London',
        approval: {
          approvedBy: { name: approver_name || 'InflowHR Approver', email: approver_email || userEmail },
          approvedAt: approved_at || new Date().toISOString(),
          reference: `inflowhr-schedule-approval-${onboarding_id}`,
        },
      }

      if (MOCK_MODE) {
        const mockSchedule = {
          id: `mock-schedule-joiner-${onboarding_id}`,
          status: 'scheduled',
          message: 'Schedule created successfully',
          stages: [
            { name: 'prepare', status: 'pending', scheduledAt: new Date(Date.now() + 86400000 * (options?.prepareDaysBefore || 3)).toISOString() },
            { name: 'enable_sign_in', status: 'pending', scheduledAt: input.startDate + 'T08:00:00Z' },
          ],
          nextDueAt: new Date(Date.now() + 86400000).toISOString(),
        }
        const upsertRow: Record<string, unknown> = {
          onboarding_id,
          company_id,
          schedule_id: mockSchedule.id,
          schedule_status: 'scheduled',
          schedule_message: mockSchedule.message,
          schedule_stages: mockSchedule.stages,
          schedule_next_due_at: mockSchedule.nextDueAt,
          schedule_updated_at: new Date().toISOString(),
          schedule_options: scheduleOptions,
          external_ref: `starter-${onboarding_id}`,
          run_status: 'completed',
          updated_at: new Date().toISOString(),
        }
        if (body.issuePass) upsertRow.pass_status = 'pending'
        await sb.from('onboarding_m365_actions').upsert(upsertRow, { onConflict: 'onboarding_id' })
        return json(mockSchedule)
      }

      let res = await engineFetch(keyResult.apiKey, 'POST', '/v1/schedules', engineBody, idempotencyKey)

      let schedPassWarning: string | null = null
      const errCode409 = res.status === 409 ? (res.data as any)?.error?.code : null
      if (['passes_off', 'passes_not_connected', 'passes_setup_incomplete', 'function_suspended'].includes(errCode409) && scheduleOptions.issuePass) {
        schedPassWarning = friendlyError(errCode409!)
        delete scheduleOptions.issuePass
        engineBody.options = scheduleOptions
        res = await engineFetch(keyResult.apiKey, 'POST', '/v1/schedules', engineBody, `${idempotencyKey}-nop`)
      }

      if (res.status === 409) {
        const errData = res.data as any
        let existingId = errData?.error?.scheduleId || errData?.scheduleId || errData?.error?.id || errData?.id
        if (!existingId) {
          const lookupRes = await engineFetch(keyResult.apiKey, 'GET', `/v1/schedules?externalRef=${encodeURIComponent(`starter-${onboarding_id}`)}`)
          if (lookupRes.ok) {
            const ld = lookupRes.data as any
            const schedules = ld?.data || ld?.schedules || ld?.items || ld?.results || (Array.isArray(ld) ? ld : [])
            if (Array.isArray(schedules) && schedules.length > 0) existingId = schedules[0].id
          }
        }
        if (existingId) {
          const checkRes = await engineFetch(keyResult.apiKey, 'GET', `/v1/schedules/${existingId}`)
          if (checkRes.ok) {
            const sched = checkRes.data as any
            await sb.from('onboarding_m365_actions').upsert({
              onboarding_id, company_id,
              schedule_id: existingId,
              schedule_status: sched.status,
              schedule_message: sched.message,
              schedule_stages: sched.stages,
              schedule_next_due_at: sched.nextDueAt,
              schedule_updated_at: sched.updatedAt,
              external_ref: `starter-${onboarding_id}`,
              run_status: 'completed',
              updated_at: new Date().toISOString(),
            }, { onConflict: 'onboarding_id' })
            return json({ id: existingId, ...sched, recovered: true, message: 'A schedule already exists for this starter.' })
          }
        }
        return json({ error: 'A schedule already exists in the engine but could not be recovered automatically. Check the engine dashboard for the schedule ID and use Refresh to sync it.', schedule_conflict: true }, 409)
      }

      if (res.status === 422) {
        const code = (res.data as any)?.error?.code
        if (code === 'stage_in_past') {
          return json({ error: friendlyError('stage_in_past'), use_run_now: true }, 422)
        }
      }

      const errResp = handleEngineError(sb, company_id, res)
      if (errResp) return errResp

      const sched = res.data as any
      const schedUpsert: Record<string, unknown> = {
        onboarding_id, company_id,
        schedule_id: sched.id,
        schedule_status: sched.status || 'scheduled',
        schedule_message: sched.message,
        schedule_stages: sched.stages,
        schedule_next_due_at: sched.nextDueAt,
        schedule_updated_at: sched.updatedAt || new Date().toISOString(),
        schedule_options: scheduleOptions,
        external_ref: `starter-${onboarding_id}`,
        run_status: 'completed',
        updated_at: new Date().toISOString(),
      }
      if (scheduleOptions.issuePass) schedUpsert.pass_status = 'pending'
      await sb.from('onboarding_m365_actions').upsert(schedUpsert, { onConflict: 'onboarding_id' })

      await audit(sb, company_id, userId, 'inflowonboarder_create_schedule', { onboarding_id, scheduleId: sched.id, issuePass: !!scheduleOptions.issuePass, ...(schedPassWarning ? { passWarning: schedPassWarning } : {}) })
      return json({ ...sched, ...(schedPassWarning ? { pass_warning: schedPassWarning } : {}) })
    }

    // ── get-schedule (joiner) ─────────────────────────────────────────────
    if (action === 'get-schedule') {
      const { schedule_id, onboarding_id } = body
      if (!schedule_id) return json({ error: 'Missing schedule_id' }, 400)

      if (MOCK_MODE) {
        const { data: row } = await sb.from('onboarding_m365_actions')
          .select('schedule_status, schedule_message, schedule_stages, schedule_next_due_at')
          .eq('onboarding_id', onboarding_id).maybeSingle()
        return json({
          id: schedule_id,
          status: row?.schedule_status || 'scheduled',
          message: row?.schedule_message,
          stages: row?.schedule_stages,
          nextDueAt: row?.schedule_next_due_at,
        })
      }

      const keyResult = await getApiKey(sb, company_id)
      if (keyResult instanceof Response) return keyResult
      const res = await engineFetch(keyResult.apiKey, 'GET', `/v1/schedules/${schedule_id}`)
      const errResp = handleEngineError(sb, company_id, res)
      if (errResp) return errResp

      const sched = res.data as any
      if (onboarding_id) {
        await sb.from('onboarding_m365_actions').update({
          schedule_status: sched.status,
          schedule_message: sched.message,
          schedule_stages: sched.stages,
          schedule_next_due_at: sched.nextDueAt,
          schedule_updated_at: sched.updatedAt,
          updated_at: new Date().toISOString(),
        }).eq('onboarding_id', onboarding_id)
      }
      return json(sched)
    }

    // ── update-schedule (joiner date change) ──────────────────────────────
    if (action === 'update-schedule') {
      const { schedule_id, onboarding_id, start_date, attempt } = body
      if (!schedule_id) return json({ error: 'Missing schedule_id' }, 400)
      if (!start_date) return json({ error: 'Missing start_date' }, 400)

      const keyResult = await getApiKey(sb, company_id)
      if (keyResult instanceof Response) return keyResult

      const idempotencyKey = `inflowhr-joiner-${onboarding_id}-update-${Date.now()}`

      if (MOCK_MODE) {
        await sb.from('onboarding_m365_actions').update({
          schedule_message: `Start date updated to ${start_date}`,
          schedule_updated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('onboarding_id', onboarding_id)
        return json({ status: 'scheduled', message: `Start date updated to ${start_date}` })
      }

      const res = await engineFetch(keyResult.apiKey, 'PATCH', `/v1/schedules/${schedule_id}`, {
        parameters: { startDate: start_date },
      }, idempotencyKey)

      if (res.status === 400) {
        const code = (res.data as any)?.error?.code
        if (code === 'approval_evidence_required') {
          return json({ error: friendlyError('approval_evidence_required'), needs_reapproval: true }, 400)
        }
      }
      if (res.status === 409) {
        const code = (res.data as any)?.error?.code
        if (code === 'schedule_busy') {
          return json({ error: friendlyError('schedule_busy') }, 409)
        }
      }

      const errResp = handleEngineError(sb, company_id, res)
      if (errResp) return errResp

      const sched = res.data as any
      if (onboarding_id) {
        await sb.from('onboarding_m365_actions').update({
          schedule_status: sched.status,
          schedule_message: sched.message,
          schedule_stages: sched.stages,
          schedule_next_due_at: sched.nextDueAt,
          schedule_updated_at: sched.updatedAt,
          updated_at: new Date().toISOString(),
        }).eq('onboarding_id', onboarding_id)
      }

      await audit(sb, company_id, userId, 'inflowonboarder_update_schedule', { onboarding_id, schedule_id, start_date })
      return json(sched)
    }

    // ── cancel-schedule (joiner) ──────────────────────────────────────────
    if (action === 'cancel-schedule') {
      const { schedule_id, onboarding_id, reason, attempt } = body
      if (!schedule_id) return json({ error: 'Missing schedule_id' }, 400)

      const keyResult = await getApiKey(sb, company_id)
      if (keyResult instanceof Response) return keyResult

      const idempotencyKey = `inflowhr-joiner-${onboarding_id}-cancel-${Date.now()}`

      if (MOCK_MODE) {
        await sb.from('onboarding_m365_actions').update({
          schedule_status: 'cancelled',
          schedule_message: reason || 'Schedule cancelled',
          schedule_updated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('onboarding_id', onboarding_id)
        return json({ status: 'cancelled', message: reason || 'Schedule cancelled' })
      }

      const res = await engineFetch(keyResult.apiKey, 'POST', `/v1/schedules/${schedule_id}/cancel`, {
        reason: reason || 'Cancelled from InflowHR',
      }, idempotencyKey)

      const errResp = handleEngineError(sb, company_id, res)
      if (errResp) return errResp

      const sched = res.data as any
      if (onboarding_id) {
        await sb.from('onboarding_m365_actions').update({
          schedule_status: 'cancelled',
          schedule_message: sched.message || reason,
          schedule_updated_at: sched.updatedAt || new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('onboarding_id', onboarding_id)
      }

      await audit(sb, company_id, userId, 'inflowonboarder_cancel_schedule', { onboarding_id, schedule_id, reason })
      return json(sched)
    }

    // ── recheck-schedule (joiner, retry after blocked) ────────────────────
    if (action === 'recheck-schedule') {
      const { schedule_id, onboarding_id, attempt } = body
      if (!schedule_id) return json({ error: 'Missing schedule_id' }, 400)

      const keyResult = await getApiKey(sb, company_id)
      if (keyResult instanceof Response) return keyResult

      const idempotencyKey = `inflowhr-joiner-${onboarding_id}-recheck-schedule-${Date.now()}`

      if (MOCK_MODE) {
        await sb.from('onboarding_m365_actions').update({
          schedule_status: 'scheduled',
          schedule_message: 'Recheck successful',
          schedule_updated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('onboarding_id', onboarding_id)
        return json({ status: 'scheduled', message: 'Recheck successful' })
      }

      const res = await engineFetch(keyResult.apiKey, 'POST', `/v1/schedules/${schedule_id}/recheck`, {}, idempotencyKey)
      const errResp = handleEngineError(sb, company_id, res)
      if (errResp) return errResp

      const sched = res.data as any
      if (onboarding_id) {
        await sb.from('onboarding_m365_actions').update({
          schedule_status: sched.status,
          schedule_message: sched.message,
          schedule_stages: sched.stages,
          schedule_next_due_at: sched.nextDueAt,
          schedule_updated_at: sched.updatedAt,
          updated_at: new Date().toISOString(),
        }).eq('onboarding_id', onboarding_id)
      }

      await audit(sb, company_id, userId, 'inflowonboarder_recheck_schedule', { onboarding_id, schedule_id })
      return json(sched)
    }

    // ── v1 legacy: check-job (kept for in-flight v1 starters) ───────────────
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
          }
        } else if (job_type === 'licence') {
          updates.licence_status = jobData.status
          if (jobData.status === 'failed' && jobData.error) {
            updates.licence_error = jobData.error
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

    // ── reveal-pass (TAP — view once) ─────────────────────────────────────
    if (action === 'reveal-pass') {
      const { onboarding_id, pass_id } = body
      if (!onboarding_id || !pass_id) return json({ error: 'Missing onboarding_id or pass_id' }, 400)

      const { data: m365Row } = await sb.from('onboarding_m365_actions')
        .select('pass_id, pass_status, company_id')
        .eq('onboarding_id', onboarding_id)
        .maybeSingle()
      if (!m365Row) return json({ error: 'Onboarding record not found' }, 404)
      if (m365Row.pass_id !== pass_id) return json({ error: 'Pass ID mismatch' }, 400)
      if (m365Row.pass_status === 'viewed') return json({ error: 'This pass has already been viewed.' }, 410)
      if (m365Row.pass_status === 'gone') return json({ error: friendlyError('pass_gone') }, 410)
      if (m365Row.pass_status === 'expired') return json({ error: 'This pass has expired.' }, 410)

      if (MOCK_MODE) {
        const mockResult = mockRevealPass(pass_id)
        await sb.from('onboarding_m365_actions').update({
          pass_status: 'viewed',
          pass_viewed_at: new Date().toISOString(),
          pass_viewed_by: userId,
          updated_at: new Date().toISOString(),
        }).eq('onboarding_id', onboarding_id)
        await audit(sb, company_id, userId, 'inflowonboarder_pass_viewed', { onboarding_id, pass_id })
        return jsonNoStore(mockResult)
      }

      const keyResult = await getApiKey(sb, company_id)
      if (keyResult instanceof Response) return keyResult
      const res = await engineFetch(keyResult.apiKey, 'POST', `/v1/passes/${encodeURIComponent(pass_id)}/reveal`)

      if (res.status === 404 || (res.data as any)?.error?.code === 'pass_gone') {
        await sb.from('onboarding_m365_actions').update({
          pass_status: 'gone', updated_at: new Date().toISOString(),
        }).eq('onboarding_id', onboarding_id)
        return json({ error: friendlyError('pass_gone') }, 410)
      }

      const errResp = handleEngineError(sb, company_id, res)
      if (errResp) return errResp

      await sb.from('onboarding_m365_actions').update({
        pass_status: 'viewed',
        pass_viewed_at: new Date().toISOString(),
        pass_viewed_by: userId,
        updated_at: new Date().toISOString(),
      }).eq('onboarding_id', onboarding_id)

      await audit(sb, company_id, userId, 'inflowonboarder_pass_viewed', { onboarding_id, pass_id })
      return jsonNoStore(res.data)
    }

    // ── request-new-pass (TAP — expired/gone, request another) ──────────
    if (action === 'request-new-pass') {
      const { onboarding_id } = body
      if (!onboarding_id) return json({ error: 'Missing onboarding_id' }, 400)

      const { data: m365Row } = await sb.from('onboarding_m365_actions')
        .select('m365_upn, company_id')
        .eq('onboarding_id', onboarding_id)
        .maybeSingle()
      if (!m365Row || !m365Row.m365_upn) return json({ error: 'No M365 account found for this starter' }, 400)

      const { data: onb } = await sb.from('onboardings')
        .select('employee_id, employees!inner(first_name, last_name)')
        .eq('id', onboarding_id)
        .maybeSingle()
      const empName = onb ? `${(onb as any).employees.first_name} ${(onb as any).employees.last_name}` : 'New starter'

      const idempotencyKey = `inflowhr-pass-${onboarding_id}-${Date.now()}`

      if (MOCK_MODE) {
        const mock = mockRequestNewPass(onboarding_id)
        await sb.from('onboarding_m365_actions').update({
          pass_status: 'pending',
          pass_id: null,
          pass_expires_at: null,
          pass_viewed_at: null,
          pass_viewed_by: null,
          updated_at: new Date().toISOString(),
        }).eq('onboarding_id', onboarding_id)
        return json(mock)
      }

      const keyResult = await getApiKey(sb, company_id)
      if (keyResult instanceof Response) return keyResult
      const res = await engineFetch(keyResult.apiKey, 'POST', '/v1/passes', {
        userPrincipalName: m365Row.m365_upn,
        displayName: empName,
      }, idempotencyKey)

      const errResp = handleEngineError(sb, company_id, res)
      if (errResp) return errResp

      const resData = res.data as any

      await sb.from('onboarding_m365_actions').update({
        pass_status: 'pending',
        pass_id: null,
        pass_expires_at: null,
        pass_viewed_at: null,
        pass_viewed_by: null,
        updated_at: new Date().toISOString(),
      }).eq('onboarding_id', onboarding_id)

      await audit(sb, company_id, userId, 'inflowonboarder_request_new_pass', { onboarding_id })
      return json({ jobId: resData.jobId || resData.id })
    }

    // ── check-pass-job (TAP — poll new-pass creation job) ───────────────
    if (action === 'check-pass-job') {
      const { job_id, onboarding_id } = body
      if (!job_id) return json({ error: 'Missing job_id' }, 400)

      let jobData: any

      if (MOCK_MODE) {
        jobData = mockJobStatus(job_id)
      } else {
        const keyResult = await getApiKey(sb, company_id)
        if (keyResult instanceof Response) return keyResult
        const res = await engineFetch(keyResult.apiKey, 'GET', `/v1/jobs/${job_id}`)
        const errResp = handleEngineError(sb, company_id, res)
        if (errResp) return errResp
        jobData = res.data
      }

      if (onboarding_id && jobData.status === 'succeeded' && jobData.result) {
        await sb.from('onboarding_m365_actions').update({
          pass_id: jobData.result.passId,
          pass_expires_at: jobData.result.expiresAt,
          pass_status: 'ready',
          updated_at: new Date().toISOString(),
        }).eq('onboarding_id', onboarding_id)
      }
      if (onboarding_id && jobData.status === 'failed') {
        await sb.from('onboarding_m365_actions').update({
          pass_status: 'error',
          updated_at: new Date().toISOString(),
        }).eq('onboarding_id', onboarding_id)
      }

      return json(jobData)
    }

    return json({ error: `Unknown action: ${action}` }, 400)

  } catch (err) {
    if (err instanceof TypeError) {
      return json({ error: 'InflowOnboarder is unavailable. Please try again shortly.' }, 503)
    }
    console.error('[IFO] unhandled error:', err)
    return json({ error: 'Internal server error' }, 500)
  }
})
