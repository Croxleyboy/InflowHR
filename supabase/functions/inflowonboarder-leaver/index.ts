import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALLOWED_ORIGIN = 'https://app.inflowhr.com'
const ENGINE_URL = Deno.env.get('INFLOWONBOARDER_API_URL') || 'http://localhost:3001'
const MOCK_MODE = Deno.env.get('INFLOWONBOARDER_MOCK') === 'true'
const MOCK_ACCOUNT_BLOCKED = Deno.env.get('INFLOWONBOARDER_MOCK_ACCOUNT_BLOCKED') === 'true'
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

// ── Mock leaver state machine ──────────────────────────────────────────────

function mockStartLeaverRun(offboardingId: number): { id: string; status: string; message?: string; error?: unknown } {
  const id = `mock-leaver-run-${offboardingId}`
  if (MOCK_ACCOUNT_BLOCKED) {
    return {
      id,
      status: 'account_blocked',
      message: 'This account is protected (emergency admin). It cannot be offboarded automatically.',
      error: { code: 'account_protected', message: 'Protected account' },
    }
  }
  return {
    id,
    status: 'ready_for_approval',
    message: 'Microsoft 365 Business Premium licence available. Block sign-in and sign out everywhere, remove 3 groups, remove 1 licence.',
  }
}

async function mockCheckLeaverRun(sb: ReturnType<typeof getSupabase>, runId: string, offboardingId: number): Promise<unknown> {
  const { data: row } = await sb.from('offboarding_m365_actions').select('run_status, run_error, run_result, employee_upn').eq('offboarding_id', offboardingId).maybeSingle()
  if (!row) return { id: runId, status: 'failed', error: { code: 'not_found', message: 'Run not found' } }
  return { id: runId, status: row.run_status, error: row.run_error, result: row.run_result, message: row.run_status === 'ready_for_approval' ? 'Block sign-in and sign out everywhere, remove 3 groups, remove 1 licence.' : undefined }
}

function mockRecheckLeaverRun(currentStatus: string): unknown {
  if (currentStatus === 'account_blocked') {
    return { status: 'ready_for_approval', message: 'Block sign-in and sign out everywhere, remove 3 groups, remove 1 licence.', error: null }
  }
  return { status: currentStatus }
}

function mockProceedLeaverRun(runId: string, offboardingId: number, currentStatus: string): unknown {
  if (currentStatus === 'ready_for_approval') {
    return {
      status: 'completed',
      message: 'Sign-in blocked, signed out everywhere, 3 groups removed, 1 licence removed.',
      result: {
        userId: 'mock-aad-user-id-leaver',
        userPrincipalName: 'leaver@mockdomain.com',
        removedGroups: ['Sales Team', 'UK Office', 'Project Alpha'],
        keptGroups: [
          { name: 'All Company', reason: 'Dynamic membership rule' },
        ],
        removedLicences: ['Microsoft 365 Business Premium'],
        groupLicences: [],
        devices: [
          { deviceName: 'DESKTOP-ABC123', operatingSystem: 'Windows 11', ownership: 'corporate', serialNumber: 'SN-001-2024', lastSyncDateTime: '2026-10-15T09:30:00Z' },
          { deviceName: 'iPhone 15 Pro', operatingSystem: 'iOS 17', ownership: 'personal', serialNumber: 'SN-002-2024', lastSyncDateTime: '2026-10-17T14:22:00Z' },
        ],
      },
      error: null,
    }
  }
  return { status: currentStatus }
}

// ── Audit helper ────────────────────────────────────────────────────────────

async function audit(sb: ReturnType<typeof getSupabase>, companyId: string, userId: string, action: string, details: Record<string, unknown>) {
  try {
    await sb.from('gdpr_audit_logs').insert({
      company_id: companyId,
      performed_by: userId,
      actor_role: 'admin',
      table_name: 'offboarding_m365_actions',
      action,
      metadata: details,
    })
  } catch (e) { console.error('[IFO-LEAVER] audit write failed:', e) }
}

// ── Error code mapping ──────────────────────────────────────────────────────

const ERROR_MESSAGES: Record<string, string> = {
  forbidden_scope: 'Your API key is missing the m365.leaver permission. Check the key scopes in InflowOnboarder.',
  rate_limited: 'Too many requests. Please try again shortly.',
  unauthenticated: 'Your InflowOnboarder API key is invalid or has been revoked.',
  run_exists: 'A workflow run already exists for this leaver.',
  approval_evidence_required: 'Complete the approval in InflowHR first before proceeding.',
  account_protected: 'This account is protected and cannot be offboarded automatically. See InflowOnboarder Settings to manage protected accounts.',
  account_has_admin_role: 'This account has an admin role assigned. Remove the role in Microsoft 365 first.',
  account_synced_from_ad: 'This account is synced from Active Directory and cannot be offboarded here.',
  account_not_found: 'No Microsoft 365 account was found for this email address.',
  connection_failed: 'InflowOnboarder cannot reach your Microsoft 365 tenant. Check the connection in InflowOnboarder.',
  microsoft_error: 'Microsoft 365 returned an error. See the message below and retry if needed.',
  connection_not_ready: 'Microsoft 365 is not fully connected in InflowOnboarder. Finish the setup there first.',
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

    const authResult = await verifyAdmin(sb, authHeader, company_id)
    if (authResult instanceof Response) return authResult
    const { userId, userEmail } = authResult

    // ── start-leaver-run ───────────────────────────────────────────────────
    if (action === 'start-leaver-run') {
      const { offboarding_id, user_principal_name, attempt } = body
      if (!offboarding_id) return json({ error: 'Missing offboarding_id' }, 400)

      const upnRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!user_principal_name || !upnRe.test(user_principal_name)) {
        return json({ error: 'Invalid or missing userPrincipalName — must be user@domain.tld' }, 400)
      }

      const idempotencyKey = `leaver-${offboarding_id}-start-run-${attempt || 0}`
      let runId: string
      let runStatus: string
      let runError: unknown = null
      let runMessage: string | undefined

      if (MOCK_MODE) {
        const mock = mockStartLeaverRun(offboarding_id)
        runId = mock.id
        runStatus = mock.status
        runMessage = mock.message
        if (mock.error) runError = mock.error
      } else {
        const keyResult = await getApiKey(sb, company_id)
        if (keyResult instanceof Response) return keyResult

        const engineBody = {
          externalRef: String(offboarding_id),
          userPrincipalName: user_principal_name,
        }
        const res = await engineFetch(keyResult.apiKey, 'POST', '/v1/workflows/m365.leaver/runs', engineBody, idempotencyKey)

        if (res.status === 409) {
          const errData = res.data as any
          const existingRunId = errData?.error?.runId
          if (existingRunId) {
            const checkRes = await engineFetch(keyResult.apiKey, 'GET', `/v1/workflows/runs/${existingRunId}`)
            const existingStatus = checkRes.ok ? (checkRes.data as any).status || 'account_blocked' : 'failed'
            const existingError = checkRes.ok ? (checkRes.data as any).error || null : null
            const existingResult = checkRes.ok ? (checkRes.data as any).result || null : null
            await sb.from('offboarding_m365_actions').upsert({
              offboarding_id,
              company_id,
              run_id: existingRunId,
              run_status: existingStatus,
              run_error: existingError,
              run_result: existingResult,
              employee_upn: user_principal_name,
              attempt_count_run: (attempt || 0) + 1,
              updated_at: new Date().toISOString(),
            }, { onConflict: 'offboarding_id' })
            return json({ run_id: existingRunId, status: existingStatus, message: 'A run already exists for this leaver.' })
          }
        }

        const errResp = handleEngineError(sb, company_id, res)
        if (errResp) return errResp

        const resData = res.data as any
        runId = resData.id || resData.runId
        runStatus = resData.status || 'account_blocked'
        runMessage = resData.message
        if (resData.error) runError = resData.error
      }

      await sb.from('offboarding_m365_actions').upsert({
        offboarding_id,
        company_id,
        run_id: runId,
        run_status: runStatus,
        run_error: runError || null,
        run_result: null,
        approval_status: null,
        employee_upn: user_principal_name,
        attempt_count_run: (attempt || 0) + 1,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'offboarding_id' })

      await audit(sb, company_id, userId, 'inflowonboarder_start_leaver_run', { offboarding_id, runId, runStatus })
      return json({ run_id: runId, status: runStatus, message: runMessage })
    }

    // ── check-leaver-run ───────────────────────────────────────────────────
    if (action === 'check-leaver-run') {
      const { run_id, offboarding_id } = body
      if (!run_id) return json({ error: 'Missing run_id' }, 400)
      if (!/^[a-zA-Z0-9_-]+$/.test(run_id)) return json({ error: 'Invalid run_id format' }, 400)

      let runData: any

      if (MOCK_MODE) {
        runData = await mockCheckLeaverRun(sb, run_id, offboarding_id)
      } else {
        const keyResult = await getApiKey(sb, company_id)
        if (keyResult instanceof Response) return keyResult
        const res = await engineFetch(keyResult.apiKey, 'GET', `/v1/workflows/runs/${run_id}`)
        const errResp = handleEngineError(sb, company_id, res)
        if (errResp) return errResp
        runData = res.data
      }

      if (offboarding_id && runData.status) {
        const updates: Record<string, unknown> = {
          run_status: runData.status,
          updated_at: new Date().toISOString(),
        }
        if (runData.status === 'completed' && runData.result) {
          updates.run_result = runData.result
        }
        if ((runData.status === 'failed' || runData.status === 'account_blocked') && runData.error) {
          updates.run_error = runData.error
        }
        await sb.from('offboarding_m365_actions').update(updates).eq('offboarding_id', offboarding_id)
      }

      const friendlyErrorMsg = runData.error ? friendlyError(runData.error.code, runData.error.message) : null
      return json({ ...runData, friendlyError: friendlyErrorMsg })
    }

    // ── recheck-leaver-run ─────────────────────────────────────────────────
    if (action === 'recheck-leaver-run') {
      const { run_id, offboarding_id, attempt } = body
      if (!run_id) return json({ error: 'Missing run_id' }, 400)
      if (!/^[a-zA-Z0-9_-]+$/.test(run_id)) return json({ error: 'Invalid run_id format' }, 400)

      const idempotencyKey = `leaver-${offboarding_id}-recheck-${attempt || 0}`
      let runData: any

      if (MOCK_MODE) {
        const { data: row } = await sb.from('offboarding_m365_actions').select('run_status').eq('offboarding_id', offboarding_id).maybeSingle()
        runData = mockRecheckLeaverRun(row?.run_status || 'account_blocked')
      } else {
        const keyResult = await getApiKey(sb, company_id)
        if (keyResult instanceof Response) return keyResult
        const res = await engineFetch(keyResult.apiKey, 'POST', `/v1/workflows/runs/${run_id}/recheck`, {}, idempotencyKey)
        const errResp = handleEngineError(sb, company_id, res)
        if (errResp) return errResp
        runData = res.data
      }

      if (offboarding_id && runData.status) {
        await sb.from('offboarding_m365_actions').update({
          run_status: runData.status,
          run_error: runData.error || null,
          updated_at: new Date().toISOString(),
        }).eq('offboarding_id', offboarding_id)
      }

      await audit(sb, company_id, userId, 'inflowonboarder_recheck_leaver_run', { offboarding_id, run_id, newStatus: runData.status })
      const friendlyErrorMsg = runData.error ? friendlyError(runData.error.code, runData.error.message) : null
      return json({ ...runData, friendlyError: friendlyErrorMsg })
    }

    // ── proceed-leaver-run ─────────────────────────────────────────────────
    if (action === 'proceed-leaver-run') {
      const { run_id, offboarding_id, attempt, approver_name, approver_email, approved_at } = body
      if (!run_id) return json({ error: 'Missing run_id' }, 400)
      if (!/^[a-zA-Z0-9_-]+$/.test(run_id)) return json({ error: 'Invalid run_id format' }, 400)

      const idempotencyKey = `leaver-${offboarding_id}-proceed-${attempt || 0}`
      let runData: any

      if (MOCK_MODE) {
        const { data: row } = await sb.from('offboarding_m365_actions').select('run_status').eq('offboarding_id', offboarding_id).maybeSingle()
        runData = mockProceedLeaverRun(run_id, offboarding_id, row?.run_status || 'ready_for_approval')
      } else {
        const keyResult = await getApiKey(sb, company_id)
        if (keyResult instanceof Response) return keyResult
        const approvalBody = {
          approval: {
            approvedBy: { name: approver_name || 'InflowHR Approver', email: approver_email || userEmail },
            approvedAt: approved_at || new Date().toISOString(),
            reference: `inflowhr-leaver-approval-${offboarding_id}`,
          },
        }
        const res = await engineFetch(keyResult.apiKey, 'POST', `/v1/workflows/runs/${run_id}/proceed`, approvalBody, idempotencyKey)

        const errResp = handleEngineError(sb, company_id, res)
        if (errResp) return errResp
        runData = res.data
      }

      if (offboarding_id && runData.status) {
        const updates: Record<string, unknown> = {
          run_status: runData.status,
          run_error: runData.error || null,
          updated_at: new Date().toISOString(),
        }
        if (runData.status === 'completed' && runData.result) {
          updates.run_result = runData.result
        }
        await sb.from('offboarding_m365_actions').update(updates).eq('offboarding_id', offboarding_id)
      }

      await audit(sb, company_id, userId, 'inflowonboarder_proceed_leaver_run', { offboarding_id, run_id, newStatus: runData.status })
      const friendlyErrorMsg = runData.error ? friendlyError(runData.error.code, runData.error.message) : null
      return json({ ...runData, friendlyError: friendlyErrorMsg })
    }

    // ── mark-leaver-complete-manual ────────────────────────────────────────
    if (action === 'mark-leaver-complete-manual') {
      const { offboarding_id, notes } = body
      if (!offboarding_id) return json({ error: 'Missing offboarding_id' }, 400)

      await sb.from('offboarding_m365_actions').update({
        run_status: 'completed',
        run_result: { manual: true, notes: notes || 'Marked complete manually', completedBy: userEmail },
        run_error: null,
        updated_at: new Date().toISOString(),
      }).eq('offboarding_id', offboarding_id)

      await audit(sb, company_id, userId, 'inflowonboarder_mark_leaver_complete_manual', { offboarding_id, notes })
      return json({ status: 'completed', manual: true })
    }

    return json({ error: `Unknown action: ${action}` }, 400)

  } catch (err) {
    if (err instanceof TypeError) {
      return json({ error: 'InflowOnboarder is unavailable. Please try again shortly.' }, 503)
    }
    console.error('[IFO-LEAVER] unhandled error:', err)
    return json({ error: 'Internal server error' }, 500)
  }
})
