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

// ── Mock mover state machine ──────────────────────────────────────────────

function mockStartMoverRun(roleChangeId: number): { id: string; status: string; message?: string; error?: unknown } {
  return {
    id: `mock-mover-run-${roleChangeId}`,
    status: 'ready_for_approval',
    message: 'Update department from Support to Engineering, change job title, update extensionAttribute1 to Persona-StrictSecure, swap licence, update 2 groups.',
  }
}

async function mockCheckMoverRun(sb: ReturnType<typeof getSupabase>, runId: string, roleChangeId: number): Promise<unknown> {
  const { data: row } = await sb.from('mover_m365_actions').select('run_status, run_error, run_result, employee_upn').eq('role_change_id', roleChangeId).maybeSingle()
  if (!row) return { id: runId, status: 'failed', error: { code: 'not_found', message: 'Run not found' } }
  return { id: runId, status: row.run_status, error: row.run_error, result: row.run_result, message: row.run_status === 'ready_for_approval' ? 'Update department, change job title, swap licence, update 2 groups.' : undefined }
}

function mockRecheckMoverRun(currentStatus: string): unknown {
  if (currentStatus === 'account_blocked') {
    return { status: 'ready_for_approval', message: 'Update department, change job title, swap licence, update 2 groups.', error: null }
  }
  return { status: currentStatus }
}

function mockProceedMoverRun(runId: string, roleChangeId: number, currentStatus: string): unknown {
  if (currentStatus === 'ready_for_approval') {
    return {
      status: 'completed',
      message: 'Department updated, job title changed, licence swapped, 2 groups updated, extensionAttribute1 set.',
      result: {
        userId: 'mock-aad-user-id-mover',
        userPrincipalName: 'mover@mockdomain.com',
        changed: {
          profile: { jobTitle: 'Senior Engineer', department: 'Engineering' },
          extensionAttributes: { extensionAttribute1: 'Persona-StrictSecure' },
          groups: { added: ['SG-Engineering'], removed: ['SG-Support'] },
          licence: { added: 'Microsoft 365 E5', removed: 'Microsoft 365 Business Premium' },
        },
        skipped: [],
        accessToReview: ['SharePoint site: Support Team', 'Teams channel: Support Escalations'],
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
      table_name: 'mover_m365_actions',
      action,
      metadata: details,
    })
  } catch (e) { console.error('[IFO-MOVER] audit write failed:', e) }
}

// ── Error code mapping ──────────────────────────────────────────────────────

const ERROR_MESSAGES: Record<string, string> = {
  forbidden_scope: 'Your API key is missing the m365.mover permission. Check the key scopes in InflowOnboarder.',
  rate_limited: 'Too many requests. Please try again shortly.',
  unauthenticated: 'Your InflowOnboarder API key is invalid or has been revoked.',
  run_exists: 'A workflow run already exists for this role change.',
  approval_evidence_required: 'Complete the approval in InflowHR first before proceeding.',
  schedule_exists: 'A schedule already exists for this role change.',
  stage_in_past: 'One or more schedule stages would fall in the past. Use "Run now" instead.',
  schedule_busy: 'The schedule is currently running and cannot be changed.',
  account_protected: 'This account is protected and cannot be modified automatically. See InflowOnboarder Settings to manage protected accounts.',
  account_has_admin_role: 'This account has an admin role assigned. Remove the role in Microsoft 365 first.',
  account_synced_from_ad: 'This account is synced from Active Directory and cannot be modified here.',
  account_not_found: 'No Microsoft 365 account was found for this email address.',
  connection_failed: 'InflowOnboarder cannot reach your Microsoft 365 tenant. Check the connection in InflowOnboarder.',
  microsoft_error: 'Microsoft 365 returned an error. See the message below and retry if needed.',
  connection_not_ready: 'Microsoft 365 is not fully connected in InflowOnboarder. Finish the setup there first.',
}

function friendlyError(code: string, fallbackMessage?: string): string {
  return ERROR_MESSAGES[code] || fallbackMessage || `An unexpected error occurred (${code}).`
}

// ── Helper: get decrypted API key ─────────────────────────────────────────

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

// ── Persona transition: build changes from persona mappings ────────────────

async function buildPersonaChanges(
  sb: ReturnType<typeof getSupabase>,
  companyId: string,
  oldPersona: string | null,
  newPersona: string | null,
): Promise<{
  extensionAttribute1?: string;
  groupsAdd: string[];
  groupsRemove: string[];
  licenceAdd?: string;
  licenceRemove?: string;
  revokeSessions: boolean;
} | null> {
  if (!oldPersona || !newPersona || oldPersona === newPersona) return null

  const { data: mappings } = await sb.from('inflowonboarder_persona_mappings')
    .select('*')
    .eq('company_id', companyId)
    .in('persona', [oldPersona, newPersona])

  if (!mappings || mappings.length === 0) return null

  const oldMapping = mappings.find((m: any) => m.persona === oldPersona)
  const newMapping = mappings.find((m: any) => m.persona === newPersona)

  const result: {
    extensionAttribute1?: string;
    groupsAdd: string[];
    groupsRemove: string[];
    licenceAdd?: string;
    licenceRemove?: string;
    revokeSessions: boolean;
  } = {
    groupsAdd: [],
    groupsRemove: [],
    revokeSessions: oldPersona === 'strict_secure' || newPersona === 'strict_secure',
  }

  if (newMapping?.extension_attribute_value) {
    result.extensionAttribute1 = newMapping.extension_attribute_value
  }

  if (newMapping?.m365_groups) {
    const oldGroups = new Set(oldMapping?.m365_groups || [])
    result.groupsAdd = newMapping.m365_groups.filter((g: string) => !oldGroups.has(g))
  }
  if (oldMapping?.m365_groups) {
    const newGroups = new Set(newMapping?.m365_groups || [])
    result.groupsRemove = oldMapping.m365_groups.filter((g: string) => !newGroups.has(g))
  }

  if (newMapping?.m365_licence_sku_id && oldMapping?.m365_licence_sku_id &&
      newMapping.m365_licence_sku_id !== oldMapping.m365_licence_sku_id) {
    result.licenceAdd = newMapping.m365_licence_sku_id
    result.licenceRemove = oldMapping.m365_licence_sku_id
  }

  return result
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

    // ── start-mover-run ───────────────────────────────────────────────────
    if (action === 'start-mover-run') {
      const { role_change_id, user_principal_name, changes, licence_contact, attempt } = body
      if (!role_change_id) return json({ error: 'Missing role_change_id' }, 400)

      const upnRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!user_principal_name || !upnRe.test(user_principal_name)) {
        return json({ error: 'Invalid or missing userPrincipalName — must be user@domain.tld' }, 400)
      }

      const idempotencyKey = `mover-${role_change_id}-start-run-${attempt || 0}`

      // Build engine changes object
      const engineChanges: Record<string, unknown> = {}

      // Profile changes (jobTitle, department, officeLocation, etc.)
      if (changes?.profile) {
        engineChanges.profile = { ...changes.profile }
      }

      // Manager change
      if (changes?.manager) {
        engineChanges.manager = changes.manager
      }

      // Persona transition: resolve mappings → extensionAttribute1, groups, licence
      if (changes?.persona) {
        const personaChanges = await buildPersonaChanges(sb, company_id, changes.persona.old, changes.persona.new)
        if (personaChanges) {
          if (personaChanges.extensionAttribute1) {
            engineChanges.extensionAttributes = { extensionAttribute1: personaChanges.extensionAttribute1 }
          }
          // Merge persona groups with explicit group changes
          const existingGroupsAdd = changes?.groups?.add || []
          const existingGroupsRemove = changes?.groups?.remove || []
          engineChanges.groups = {
            add: [...new Set([...existingGroupsAdd, ...personaChanges.groupsAdd])],
            remove: [...new Set([...existingGroupsRemove, ...personaChanges.groupsRemove])],
          }
          if (personaChanges.licenceAdd && !changes?.licence?.add) {
            engineChanges.licence = { add: personaChanges.licenceAdd, remove: personaChanges.licenceRemove }
          }
          engineChanges.revokeSessions = personaChanges.revokeSessions
        }
      }

      // Explicit group/licence changes (override persona if set directly)
      if (changes?.groups && !engineChanges.groups) {
        engineChanges.groups = changes.groups
      }
      if (changes?.licence && !engineChanges.licence) {
        engineChanges.licence = changes.licence
      }
      if (changes?.revokeSessions !== undefined && engineChanges.revokeSessions === undefined) {
        engineChanges.revokeSessions = changes.revokeSessions
      }

      let runId: string
      let runStatus: string
      let runError: unknown = null
      let runMessage: string | undefined

      if (MOCK_MODE) {
        const mock = mockStartMoverRun(role_change_id)
        runId = mock.id
        runStatus = mock.status
        runMessage = mock.message
        if (mock.error) runError = mock.error
      } else {
        const keyResult = await getApiKey(sb, company_id)
        if (keyResult instanceof Response) return keyResult

        const engineBody: Record<string, unknown> = {
          externalRef: `move-${role_change_id}`,
          userPrincipalName: user_principal_name,
          changes: engineChanges,
        }
        if (licence_contact) engineBody.licenceContact = licence_contact

        const res = await engineFetch(keyResult.apiKey, 'POST', '/v1/workflows/m365.mover/runs', engineBody, idempotencyKey)

        if (res.status === 409) {
          const errData = res.data as any
          const existingRunId = errData?.error?.runId
          if (existingRunId) {
            const checkRes = await engineFetch(keyResult.apiKey, 'GET', `/v1/workflows/runs/${existingRunId}`)
            const existingStatus = checkRes.ok ? (checkRes.data as any).status || 'account_blocked' : 'failed'
            const existingError = checkRes.ok ? (checkRes.data as any).error || null : null
            const existingResult = checkRes.ok ? (checkRes.data as any).result || null : null
            await sb.from('mover_m365_actions').upsert({
              role_change_id,
              company_id,
              run_id: existingRunId,
              run_status: existingStatus,
              run_error: existingError,
              run_result: existingResult,
              employee_upn: user_principal_name,
              attempt_count_run: (attempt || 0) + 1,
              updated_at: new Date().toISOString(),
            }, { onConflict: 'role_change_id' })
            return json({ run_id: existingRunId, status: existingStatus, message: 'A run already exists for this role change.' })
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

      await sb.from('mover_m365_actions').upsert({
        role_change_id,
        company_id,
        run_id: runId,
        run_status: runStatus,
        run_error: runError || null,
        run_result: null,
        approval_status: null,
        employee_upn: user_principal_name,
        attempt_count_run: (attempt || 0) + 1,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'role_change_id' })

      await audit(sb, company_id, userId, 'inflowonboarder_start_mover_run', { role_change_id, runId, runStatus })
      return json({ run_id: runId, status: runStatus, message: runMessage })
    }

    // ── check-mover-run ───────────────────────────────────────────────────
    if (action === 'check-mover-run') {
      const { run_id, role_change_id } = body
      if (!run_id) return json({ error: 'Missing run_id' }, 400)
      if (!/^[a-zA-Z0-9_-]+$/.test(run_id)) return json({ error: 'Invalid run_id format' }, 400)

      let runData: any

      if (MOCK_MODE) {
        runData = await mockCheckMoverRun(sb, run_id, role_change_id)
      } else {
        const keyResult = await getApiKey(sb, company_id)
        if (keyResult instanceof Response) return keyResult
        const res = await engineFetch(keyResult.apiKey, 'GET', `/v1/workflows/runs/${run_id}`)
        const errResp = handleEngineError(sb, company_id, res)
        if (errResp) return errResp
        runData = res.data
      }

      if (role_change_id && runData.status) {
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
        await sb.from('mover_m365_actions').update(updates).eq('role_change_id', role_change_id)
      }

      const friendlyErrorMsg = runData.error ? friendlyError(runData.error.code, runData.error.message) : null
      return json({ ...runData, friendlyError: friendlyErrorMsg })
    }

    // ── recheck-mover-run ─────────────────────────────────────────────────
    if (action === 'recheck-mover-run') {
      const { run_id, role_change_id, attempt } = body
      if (!run_id) return json({ error: 'Missing run_id' }, 400)
      if (!/^[a-zA-Z0-9_-]+$/.test(run_id)) return json({ error: 'Invalid run_id format' }, 400)

      const idempotencyKey = `mover-${role_change_id}-recheck-${attempt || 0}`
      let runData: any

      if (MOCK_MODE) {
        const { data: row } = await sb.from('mover_m365_actions').select('run_status').eq('role_change_id', role_change_id).maybeSingle()
        runData = mockRecheckMoverRun(row?.run_status || 'account_blocked')
      } else {
        const keyResult = await getApiKey(sb, company_id)
        if (keyResult instanceof Response) return keyResult
        const res = await engineFetch(keyResult.apiKey, 'POST', `/v1/workflows/runs/${run_id}/recheck`, {}, idempotencyKey)
        const errResp = handleEngineError(sb, company_id, res)
        if (errResp) return errResp
        runData = res.data
      }

      if (role_change_id && runData.status) {
        await sb.from('mover_m365_actions').update({
          run_status: runData.status,
          run_error: runData.error || null,
          updated_at: new Date().toISOString(),
        }).eq('role_change_id', role_change_id)
      }

      await audit(sb, company_id, userId, 'inflowonboarder_recheck_mover_run', { role_change_id, run_id, newStatus: runData.status })
      const friendlyErrorMsg = runData.error ? friendlyError(runData.error.code, runData.error.message) : null
      return json({ ...runData, friendlyError: friendlyErrorMsg })
    }

    // ── proceed-mover-run ─────────────────────────────────────────────────
    if (action === 'proceed-mover-run') {
      const { run_id, role_change_id, attempt, approver_name, approver_email, approved_at } = body
      if (!run_id) return json({ error: 'Missing run_id' }, 400)
      if (!/^[a-zA-Z0-9_-]+$/.test(run_id)) return json({ error: 'Invalid run_id format' }, 400)

      const idempotencyKey = `mover-${role_change_id}-proceed-${attempt || 0}`
      let runData: any

      if (MOCK_MODE) {
        const { data: row } = await sb.from('mover_m365_actions').select('run_status').eq('role_change_id', role_change_id).maybeSingle()
        runData = mockProceedMoverRun(run_id, role_change_id, row?.run_status || 'ready_for_approval')
      } else {
        const keyResult = await getApiKey(sb, company_id)
        if (keyResult instanceof Response) return keyResult
        const approvalBody = {
          approval: {
            approvedBy: { name: approver_name || 'InflowHR Approver', email: approver_email || userEmail },
            approvedAt: approved_at || new Date().toISOString(),
            reference: `inflowhr-mover-approval-${role_change_id}`,
          },
        }
        const res = await engineFetch(keyResult.apiKey, 'POST', `/v1/workflows/runs/${run_id}/proceed`, approvalBody, idempotencyKey)

        const errResp = handleEngineError(sb, company_id, res)
        if (errResp) return errResp
        runData = res.data
      }

      if (role_change_id && runData.status) {
        const updates: Record<string, unknown> = {
          run_status: runData.status,
          run_error: runData.error || null,
          updated_at: new Date().toISOString(),
        }
        if (runData.status === 'completed' && runData.result) {
          updates.run_result = runData.result
        }
        await sb.from('mover_m365_actions').update(updates).eq('role_change_id', role_change_id)
      }

      await audit(sb, company_id, userId, 'inflowonboarder_proceed_mover_run', { role_change_id, run_id, newStatus: runData.status })
      const friendlyErrorMsg = runData.error ? friendlyError(runData.error.code, runData.error.message) : null
      return json({ ...runData, friendlyError: friendlyErrorMsg })
    }

    // ── mark-mover-complete-manual ────────────────────────────────────────
    if (action === 'mark-mover-complete-manual') {
      const { role_change_id, notes } = body
      if (!role_change_id) return json({ error: 'Missing role_change_id' }, 400)

      await sb.from('mover_m365_actions').update({
        run_status: 'completed',
        run_result: { manual: true, notes: notes || 'Marked complete manually', completedBy: userEmail },
        run_error: null,
        updated_at: new Date().toISOString(),
      }).eq('role_change_id', role_change_id)

      await audit(sb, company_id, userId, 'inflowonboarder_mark_mover_complete_manual', { role_change_id, notes })
      return json({ status: 'completed', manual: true })
    }

    // ── create-mover-schedule ──────────────────────────────────────────
    if (action === 'create-mover-schedule') {
      const { role_change_id, user_principal_name, display_name, effective_date, changes, options, approver_name, approver_email, approved_at, attempt } = body
      if (!role_change_id) return json({ error: 'Missing role_change_id' }, 400)
      if (!user_principal_name || !effective_date) return json({ error: 'Missing user_principal_name or effective_date' }, 400)

      const keyResult = await getApiKey(sb, company_id)
      if (keyResult instanceof Response) return keyResult

      const idempotencyKey = `inflowhr-mover-${role_change_id}-schedule-${attempt || 0}`

      // Build engine changes for schedule (same persona resolution as run)
      const engineChanges: Record<string, unknown> = {}
      if (changes?.profile) engineChanges.profile = { ...changes.profile }
      if (changes?.manager) engineChanges.manager = changes.manager
      if (changes?.groups) engineChanges.groups = changes.groups
      if (changes?.licence) engineChanges.licence = changes.licence

      if (changes?.persona) {
        const personaChanges = await buildPersonaChanges(sb, company_id, changes.persona.old, changes.persona.new)
        if (personaChanges) {
          if (personaChanges.extensionAttribute1) {
            engineChanges.extensionAttributes = { extensionAttribute1: personaChanges.extensionAttribute1 }
          }
          const existingGroupsAdd = (engineChanges.groups as any)?.add || []
          const existingGroupsRemove = (engineChanges.groups as any)?.remove || []
          engineChanges.groups = {
            add: [...new Set([...existingGroupsAdd, ...personaChanges.groupsAdd])],
            remove: [...new Set([...existingGroupsRemove, ...personaChanges.groupsRemove])],
          }
          if (personaChanges.licenceAdd && !engineChanges.licence) {
            engineChanges.licence = { add: personaChanges.licenceAdd, remove: personaChanges.licenceRemove }
          }
          if (personaChanges.revokeSessions) engineChanges.revokeSessions = true
        }
      }

      const engineBody: Record<string, unknown> = {
        templateId: 'hr.mover',
        externalRef: `move-${role_change_id}`,
        parameters: {
          userPrincipalName: user_principal_name,
          displayName: display_name || user_principal_name,
          effectiveDate: effective_date,
          changes: engineChanges,
        },
        options: options || {},
        timeZone: 'Europe/London',
        approval: {
          approvedBy: { name: approver_name || 'InflowHR Approver', email: approver_email || userEmail },
          approvedAt: approved_at || new Date().toISOString(),
          reference: `inflowhr-mover-schedule-approval-${role_change_id}`,
        },
      }

      if (MOCK_MODE) {
        const mockSchedule = {
          id: `mock-schedule-mover-${role_change_id}`,
          status: 'scheduled',
          message: 'Mover schedule created successfully',
          stages: [
            { name: 'apply_changes', status: 'pending', scheduledAt: effective_date + 'T09:00:00Z' },
          ],
          nextDueAt: effective_date + 'T09:00:00Z',
        }
        await sb.from('mover_m365_actions').upsert({
          role_change_id, company_id,
          schedule_id: mockSchedule.id,
          schedule_status: 'scheduled',
          schedule_message: mockSchedule.message,
          schedule_stages: mockSchedule.stages,
          schedule_next_due_at: mockSchedule.nextDueAt,
          schedule_updated_at: new Date().toISOString(),
          schedule_options: options || {},
          employee_upn: user_principal_name,
          run_status: 'scheduled',
          updated_at: new Date().toISOString(),
        }, { onConflict: 'role_change_id' })
        return json(mockSchedule)
      }

      const res = await engineFetch(keyResult.apiKey, 'POST', '/v1/schedules', engineBody, idempotencyKey)

      if (res.status === 409) {
        const errData = res.data as any
        const existingId = errData?.error?.scheduleId
        if (existingId) {
          const checkRes = await engineFetch(keyResult.apiKey, 'GET', `/v1/schedules/${existingId}`)
          if (checkRes.ok) {
            const sched = checkRes.data as any
            await sb.from('mover_m365_actions').upsert({
              role_change_id, company_id,
              schedule_id: existingId,
              schedule_status: sched.status,
              schedule_message: sched.message,
              schedule_stages: sched.stages,
              schedule_next_due_at: sched.nextDueAt,
              schedule_updated_at: sched.updatedAt,
              employee_upn: user_principal_name,
              run_status: 'scheduled',
              updated_at: new Date().toISOString(),
            }, { onConflict: 'role_change_id' })
            return json({ ...sched, message: 'A schedule already exists for this role change.' })
          }
        }
        return json({ error: friendlyError('schedule_exists') }, 409)
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
      await sb.from('mover_m365_actions').upsert({
        role_change_id, company_id,
        schedule_id: sched.id,
        schedule_status: sched.status || 'scheduled',
        schedule_message: sched.message,
        schedule_stages: sched.stages,
        schedule_next_due_at: sched.nextDueAt,
        schedule_updated_at: sched.updatedAt || new Date().toISOString(),
        schedule_options: options || {},
        employee_upn: user_principal_name,
        run_status: 'scheduled',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'role_change_id' })

      await audit(sb, company_id, userId, 'inflowonboarder_create_mover_schedule', { role_change_id, scheduleId: sched.id })
      return json(sched)
    }

    // ── get-mover-schedule ───────────────────────────────────────────────
    if (action === 'get-mover-schedule') {
      const { schedule_id, role_change_id } = body
      if (!schedule_id) return json({ error: 'Missing schedule_id' }, 400)

      if (MOCK_MODE) {
        const { data: row } = await sb.from('mover_m365_actions')
          .select('schedule_status, schedule_message, schedule_stages, schedule_next_due_at')
          .eq('role_change_id', role_change_id).maybeSingle()
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
      if (role_change_id) {
        await sb.from('mover_m365_actions').update({
          schedule_status: sched.status,
          schedule_message: sched.message,
          schedule_stages: sched.stages,
          schedule_next_due_at: sched.nextDueAt,
          schedule_updated_at: sched.updatedAt,
          updated_at: new Date().toISOString(),
        }).eq('role_change_id', role_change_id)
      }
      return json(sched)
    }

    // ── update-mover-schedule ────────────────────────────────────────────
    if (action === 'update-mover-schedule') {
      const { schedule_id, role_change_id, effective_date, attempt } = body
      if (!schedule_id) return json({ error: 'Missing schedule_id' }, 400)
      if (!effective_date) return json({ error: 'Missing effective_date' }, 400)

      const keyResult = await getApiKey(sb, company_id)
      if (keyResult instanceof Response) return keyResult

      const idempotencyKey = `inflowhr-mover-${role_change_id}-update-${attempt || 0}`

      if (MOCK_MODE) {
        await sb.from('mover_m365_actions').update({
          schedule_message: `Effective date updated to ${effective_date}`,
          schedule_updated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('role_change_id', role_change_id)
        return json({ status: 'scheduled', message: `Effective date updated to ${effective_date}` })
      }

      const res = await engineFetch(keyResult.apiKey, 'PATCH', `/v1/schedules/${schedule_id}`, {
        parameters: { effectiveDate: effective_date },
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
      if (role_change_id) {
        await sb.from('mover_m365_actions').update({
          schedule_status: sched.status,
          schedule_message: sched.message,
          schedule_stages: sched.stages,
          schedule_next_due_at: sched.nextDueAt,
          schedule_updated_at: sched.updatedAt,
          updated_at: new Date().toISOString(),
        }).eq('role_change_id', role_change_id)
      }

      await audit(sb, company_id, userId, 'inflowonboarder_update_mover_schedule', { role_change_id, schedule_id, effective_date })
      return json(sched)
    }

    // ── cancel-mover-schedule ────────────────────────────────────────────
    if (action === 'cancel-mover-schedule') {
      const { schedule_id, role_change_id, reason, attempt } = body
      if (!schedule_id) return json({ error: 'Missing schedule_id' }, 400)

      const keyResult = await getApiKey(sb, company_id)
      if (keyResult instanceof Response) return keyResult

      const idempotencyKey = `inflowhr-mover-${role_change_id}-cancel-${attempt || 0}`

      if (MOCK_MODE) {
        await sb.from('mover_m365_actions').update({
          schedule_status: 'cancelled',
          schedule_message: reason || 'Schedule cancelled',
          schedule_updated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('role_change_id', role_change_id)
        return json({ status: 'cancelled', message: reason || 'Schedule cancelled' })
      }

      const res = await engineFetch(keyResult.apiKey, 'POST', `/v1/schedules/${schedule_id}/cancel`, {
        reason: reason || 'Cancelled from InflowHR',
      }, idempotencyKey)

      const errResp = handleEngineError(sb, company_id, res)
      if (errResp) return errResp

      const sched = res.data as any
      if (role_change_id) {
        await sb.from('mover_m365_actions').update({
          schedule_status: 'cancelled',
          schedule_message: sched.message || reason,
          schedule_updated_at: sched.updatedAt || new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('role_change_id', role_change_id)
      }

      await audit(sb, company_id, userId, 'inflowonboarder_cancel_mover_schedule', { role_change_id, schedule_id, reason })
      return json(sched)
    }

    // ── recheck-mover-schedule ───────────────────────────────────────────
    if (action === 'recheck-mover-schedule') {
      const { schedule_id, role_change_id, attempt } = body
      if (!schedule_id) return json({ error: 'Missing schedule_id' }, 400)

      const keyResult = await getApiKey(sb, company_id)
      if (keyResult instanceof Response) return keyResult

      const idempotencyKey = `inflowhr-mover-${role_change_id}-recheck-schedule-${attempt || 0}`

      if (MOCK_MODE) {
        await sb.from('mover_m365_actions').update({
          schedule_status: 'scheduled',
          schedule_message: 'Recheck successful',
          schedule_updated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('role_change_id', role_change_id)
        return json({ status: 'scheduled', message: 'Recheck successful' })
      }

      const res = await engineFetch(keyResult.apiKey, 'POST', `/v1/schedules/${schedule_id}/recheck`, {}, idempotencyKey)
      const errResp = handleEngineError(sb, company_id, res)
      if (errResp) return errResp

      const sched = res.data as any
      if (role_change_id) {
        await sb.from('mover_m365_actions').update({
          schedule_status: sched.status,
          schedule_message: sched.message,
          schedule_stages: sched.stages,
          schedule_next_due_at: sched.nextDueAt,
          schedule_updated_at: sched.updatedAt,
          updated_at: new Date().toISOString(),
        }).eq('role_change_id', role_change_id)
      }

      await audit(sb, company_id, userId, 'inflowonboarder_recheck_mover_schedule', { role_change_id, schedule_id })
      return json(sched)
    }

    return json({ error: `Unknown action: ${action}` }, 400)

  } catch (err) {
    if (err instanceof TypeError) {
      return json({ error: 'InflowOnboarder is unavailable. Please try again shortly.' }, 503)
    }
    console.error('[IFO-MOVER] unhandled error:', err)
    return json({ error: 'Internal server error' }, 500)
  }
})
