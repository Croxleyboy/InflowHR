import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ENGINE_URL = Deno.env.get('INFLOWONBOARDER_API_URL') || 'http://localhost:3001'
const ENCRYPTION_KEY_HEX = Deno.env.get('INFLOWONBOARDER_ENCRYPTION_KEY') || ''

const TERMINAL_STATUSES = ['completed', 'cancelled', 'failed', 'missed', 'declined']
const MAX_ATTEMPTS = 5
const BATCH_SIZE = 50

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// ── AES-256-GCM decryption (same as inflowonboarder-mover) ─────────────────

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

// ── Supabase client (service role — called by pg_cron) ──────────────────────

function getSupabase() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
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

// ── Get API key for a company ───────────────────────────────────────────────

async function getApiKeyForCompany(
  sb: ReturnType<typeof getSupabase>,
  companyId: string,
): Promise<string | null> {
  const { data: config } = await sb
    .from('inflowonboarder_integrations')
    .select('api_key_encrypted, api_key_iv, status')
    .eq('company_id', companyId)
    .maybeSingle()

  if (!config || config.status === 'not_connected') return null
  if (config.status !== 'connected_ready' && config.status !== 'connected_not_ready') return null

  try {
    return await decryptApiKey(config.api_key_encrypted, config.api_key_iv)
  } catch {
    return null
  }
}

// ── Exponential backoff ─────────────────────────────────────────────────────

function getNextRetryAt(attempts: number): string {
  const delayMinutes = Math.pow(2, attempts) * 5
  const next = new Date(Date.now() + delayMinutes * 60 * 1000)
  return next.toISOString()
}

// ── Process a single sync record ────────────────────────────────────────────

async function processSyncRecord(
  sb: ReturnType<typeof getSupabase>,
  record: any,
  apiKeyCache: Map<string, string | null>,
): Promise<{ status: string; error?: string }> {
  // Get API key (with caching per company)
  let apiKey = apiKeyCache.get(record.company_id)
  if (apiKey === undefined) {
    apiKey = await getApiKeyForCompany(sb, record.company_id)
    apiKeyCache.set(record.company_id, apiKey)
  }
  if (!apiKey) {
    return { status: 'failed', error: 'No valid API key for company' }
  }

  let scheduleId = record.schedule_id

  // If we don't have a schedule_id, try to look it up by externalRef
  if (!scheduleId && record.external_ref) {
    const lookup = await engineFetch(apiKey, 'GET', `/v1/schedules?externalRef=${encodeURIComponent(record.external_ref)}`)
    if (lookup.ok) {
      const schedules = (lookup.data as any)?.data || (lookup.data as any)?.schedules || []
      if (Array.isArray(schedules) && schedules.length > 0) {
        const active = schedules.find((s: any) => !TERMINAL_STATUSES.includes(s.status))
        if (active) {
          scheduleId = active.id
          // Store the found schedule_id for future attempts
          await sb.from('engine_schedule_sync').update({ schedule_id: scheduleId }).eq('id', record.id)
        } else {
          // All schedules are already terminal — nothing to do
          return { status: 'completed' }
        }
      } else {
        // No schedules found for this externalRef — nothing to cancel
        return { status: 'completed' }
      }
    }
  }

  if (!scheduleId) {
    return { status: 'completed' }
  }

  const idempotencyKey = `sync-${record.id}-${record.action}-${record.attempts}`

  if (record.action === 'cancel') {
    const res = await engineFetch(apiKey, 'POST', `/v1/schedules/${scheduleId}/cancel`, {
      reason: 'Cancelled from InflowHR — record deleted',
    }, idempotencyKey)

    if (res.ok) {
      return { status: 'completed' }
    }

    // 409 Conflict or schedule already in terminal state — treat as success
    if (res.status === 409) {
      return { status: 'completed' }
    }

    const responseData = res.data as any
    if (responseData?.status && TERMINAL_STATUSES.includes(responseData.status)) {
      return { status: 'completed' }
    }

    return { status: 'failed', error: `Engine API ${res.status}: ${JSON.stringify(res.data)}` }
  }

  if (record.action === 'change') {
    if (!record.change_payload) {
      return { status: 'failed', error: 'No change_payload provided' }
    }

    const res = await engineFetch(apiKey, 'PATCH', `/v1/schedules/${scheduleId}`, record.change_payload, idempotencyKey)

    if (res.ok) {
      return { status: 'completed' }
    }

    return { status: 'failed', error: `Engine API ${res.status}: ${JSON.stringify(res.data)}` }
  }

  return { status: 'failed', error: `Unknown action: ${record.action}` }
}

// ── Action: process-queue ───────────────────────────────────────────────────

async function processQueue(sb: ReturnType<typeof getSupabase>): Promise<{ processed: number; completed: number; failed: number; needs_review: number }> {
  const { data: records, error } = await sb
    .from('engine_schedule_sync')
    .select('*')
    .in('status', ['pending', 'failed'])
    .lte('next_retry_at', new Date().toISOString())
    .is('deleted_at', null)
    .order('next_retry_at', { ascending: true })
    .limit(BATCH_SIZE)

  if (error || !records || records.length === 0) {
    return { processed: 0, completed: 0, failed: 0, needs_review: 0 }
  }

  const apiKeyCache = new Map<string, string | null>()
  let completed = 0
  let failed = 0
  let needsReview = 0

  for (const record of records) {
    // Mark as in_progress
    await sb.from('engine_schedule_sync').update({
      status: 'in_progress',
      last_attempt_at: new Date().toISOString(),
    }).eq('id', record.id)

    try {
      const result = await processSyncRecord(sb, record, apiKeyCache)

      if (result.status === 'completed') {
        await sb.from('engine_schedule_sync').update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          attempts: record.attempts + 1,
        }).eq('id', record.id)
        completed++
      } else {
        const newAttempts = record.attempts + 1
        if (newAttempts >= MAX_ATTEMPTS) {
          await sb.from('engine_schedule_sync').update({
            status: 'needs_review',
            attempts: newAttempts,
            last_error: result.error || 'Max attempts reached',
          }).eq('id', record.id)
          needsReview++
        } else {
          await sb.from('engine_schedule_sync').update({
            status: 'failed',
            attempts: newAttempts,
            last_error: result.error,
            next_retry_at: getNextRetryAt(newAttempts),
          }).eq('id', record.id)
          failed++
        }
      }
    } catch (err: any) {
      const newAttempts = record.attempts + 1
      const update: any = {
        attempts: newAttempts,
        last_error: err.message || 'Unexpected error',
      }
      if (newAttempts >= MAX_ATTEMPTS) {
        update.status = 'needs_review'
        needsReview++
      } else {
        update.status = 'failed'
        update.next_retry_at = getNextRetryAt(newAttempts)
        failed++
      }
      await sb.from('engine_schedule_sync').update(update).eq('id', record.id)
    }
  }

  return { processed: records.length, completed, failed, needs_review: needsReview }
}

// ── Action: reconcile ───────────────────────────────────────────────────────

async function reconcile(sb: ReturnType<typeof getSupabase>): Promise<{ orphans_found: number; stale_reset: number }> {
  let orphansFound = 0

  // Get companies with active integrations
  const { data: companies } = await sb
    .from('inflowonboarder_integrations')
    .select('company_id')
    .in('status', ['connected_ready', 'connected_not_ready'])

  if (companies && companies.length > 0) {
    for (const company of companies) {
      const cid = company.company_id

      // Joiner orphans: onboarding_m365_actions with active schedule but no parent onboarding record
      const { data: joinerOrphans } = await sb
        .from('onboarding_m365_actions')
        .select('onboarding_id, schedule_id, schedule_status, external_ref')
        .eq('company_id', cid)
        .not('schedule_id', 'is', null)
        .not('schedule_status', 'is', null)
        .not('schedule_status', 'in', `(${TERMINAL_STATUSES.join(',')})`)

      if (joinerOrphans) {
        for (const om of joinerOrphans) {
          // Check if parent onboarding record still exists
          const { data: parent } = await sb.from('onboarding').select('id').eq('id', om.onboarding_id).maybeSingle()
          if (!parent) {
            // Check if we already have a sync record for this
            const extRef = om.external_ref || `starter-${om.onboarding_id}`
            const { data: existing } = await sb
              .from('engine_schedule_sync')
              .select('id')
              .eq('external_ref', extRef)
              .is('deleted_at', null)
              .not('status', 'in', `(completed,dismissed)`)
              .maybeSingle()

            if (!existing) {
              await sb.from('engine_schedule_sync').insert({
                company_id: cid,
                kind: 'joiner',
                action: 'cancel',
                record_id: om.onboarding_id,
                schedule_id: om.schedule_id,
                external_ref: extRef,
                source: 'reconcile',
              })
              orphansFound++
            }
          }
        }
      }

      // Leaver orphans
      const { data: leaverOrphans } = await sb
        .from('offboarding_m365_actions')
        .select('offboarding_id, schedule_id, schedule_status, external_ref')
        .eq('company_id', cid)
        .not('schedule_id', 'is', null)
        .not('schedule_status', 'is', null)
        .not('schedule_status', 'in', `(${TERMINAL_STATUSES.join(',')})`)

      if (leaverOrphans) {
        for (const om of leaverOrphans) {
          const { data: parent } = await sb.from('offboarding').select('id').eq('id', om.offboarding_id).maybeSingle()
          if (!parent) {
            const extRef = om.external_ref || `leaver-${om.offboarding_id}`
            const { data: existing } = await sb
              .from('engine_schedule_sync')
              .select('id')
              .eq('external_ref', extRef)
              .is('deleted_at', null)
              .not('status', 'in', `(completed,dismissed)`)
              .maybeSingle()

            if (!existing) {
              await sb.from('engine_schedule_sync').insert({
                company_id: cid,
                kind: 'leaver',
                action: 'cancel',
                record_id: om.offboarding_id,
                schedule_id: om.schedule_id,
                external_ref: extRef,
                source: 'reconcile',
              })
              orphansFound++
            }
          }
        }
      }

      // Mover + persona orphans
      const { data: moverOrphans } = await sb
        .from('mover_m365_actions')
        .select('role_change_id, schedule_id, schedule_status, external_ref, persona_schedule_id, persona_schedule_status, persona_external_ref')
        .eq('company_id', cid)

      if (moverOrphans) {
        for (const mm of moverOrphans) {
          const { data: parent } = await sb.from('role_changes').select('id').eq('id', mm.role_change_id).maybeSingle()
          if (!parent) {
            // Mover schedule orphan
            if (mm.schedule_id && mm.schedule_status && !TERMINAL_STATUSES.includes(mm.schedule_status)) {
              const extRef = mm.external_ref || `move-${mm.role_change_id}`
              const { data: existing } = await sb
                .from('engine_schedule_sync')
                .select('id')
                .eq('external_ref', extRef)
                .is('deleted_at', null)
                .not('status', 'in', `(completed,dismissed)`)
                .maybeSingle()

              if (!existing) {
                await sb.from('engine_schedule_sync').insert({
                  company_id: cid,
                  kind: 'mover',
                  action: 'cancel',
                  record_id: mm.role_change_id,
                  schedule_id: mm.schedule_id,
                  external_ref: extRef,
                  source: 'reconcile',
                })
                orphansFound++
              }
            }

            // Persona schedule orphan
            if (mm.persona_schedule_id && mm.persona_schedule_status && !TERMINAL_STATUSES.includes(mm.persona_schedule_status)) {
              const extRef = mm.persona_external_ref || `move-persona-${mm.role_change_id}`
              const { data: existing } = await sb
                .from('engine_schedule_sync')
                .select('id')
                .eq('external_ref', extRef)
                .is('deleted_at', null)
                .not('status', 'in', `(completed,dismissed)`)
                .maybeSingle()

              if (!existing) {
                await sb.from('engine_schedule_sync').insert({
                  company_id: cid,
                  kind: 'persona',
                  action: 'cancel',
                  record_id: mm.role_change_id,
                  schedule_id: mm.persona_schedule_id,
                  external_ref: extRef,
                  source: 'reconcile',
                })
                orphansFound++
              }
            }
          }
        }
      }
    }
  }

  // Reset stuck in_progress records (> 1 hour old)
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { data: staleRecords } = await sb
    .from('engine_schedule_sync')
    .select('id')
    .eq('status', 'in_progress')
    .lt('last_attempt_at', oneHourAgo)
    .is('deleted_at', null)

  let staleReset = 0
  if (staleRecords) {
    for (const rec of staleRecords) {
      await sb.from('engine_schedule_sync').update({
        status: 'failed',
        last_error: 'Stuck in in_progress for over 1 hour — reset',
      }).eq('id', rec.id)
      staleReset++
    }
  }

  return { orphans_found: orphansFound, stale_reset: staleReset }
}

// ── Action: mark-reviewed ───────────────────────────────────────────────────

async function markReviewed(
  sb: ReturnType<typeof getSupabase>,
  syncId: number,
  reviewAction: 'dismiss' | 'retry',
  reviewedBy: string,
  note?: string,
): Promise<Response> {
  const { data: record } = await sb
    .from('engine_schedule_sync')
    .select('*')
    .eq('id', syncId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!record) return json({ error: 'Sync record not found' }, 404)

  if (reviewAction === 'dismiss') {
    await sb.from('engine_schedule_sync').update({
      status: 'dismissed',
      reviewed_by: reviewedBy,
      review_note: note || null,
    }).eq('id', syncId)
    return json({ status: 'dismissed' })
  }

  if (reviewAction === 'retry') {
    await sb.from('engine_schedule_sync').update({
      status: 'pending',
      attempts: 0,
      next_retry_at: new Date().toISOString(),
      last_error: null,
      reviewed_by: reviewedBy,
      review_note: note || 'Manual retry',
    }).eq('id', syncId)
    return json({ status: 'pending' })
  }

  return json({ error: 'Invalid review action' }, 400)
}

// ── Main handler ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200 })
  }

  try {
    const sb = getSupabase()
    const body = await req.json().catch(() => ({}))
    const action = body.action as string

    // For mark-reviewed, verify the caller is an authenticated admin
    if (action === 'mark-reviewed') {
      const authHeader = req.headers.get('authorization')
      if (!authHeader) return json({ error: 'Unauthorized' }, 401)
      const { data: { user }, error: authError } = await sb.auth.getUser(authHeader.replace('Bearer ', ''))
      if (authError || !user) return json({ error: 'Unauthorized' }, 401)

      return await markReviewed(sb, body.sync_id, body.review_action, user.email!, body.note)
    }

    // For process/reconcile actions, verify service role key (called by pg_cron)
    const authHeader = req.headers.get('authorization')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!authHeader || !serviceKey || !authHeader.includes(serviceKey)) {
      // Also allow authenticated admin users to trigger manually
      if (authHeader) {
        const { data: { user }, error: authError } = await sb.auth.getUser(authHeader.replace('Bearer ', ''))
        if (authError || !user) return json({ error: 'Unauthorized' }, 401)
        const { data: sa } = await sb.from('super_admins').select('id').eq('email', user.email).maybeSingle()
        if (!sa) return json({ error: 'Super admin access required' }, 403)
      } else {
        return json({ error: 'Unauthorized' }, 401)
      }
    }

    if (action === 'process-queue') {
      const result = await processQueue(sb)
      return json(result)
    }

    if (action === 'reconcile') {
      const result = await reconcile(sb)
      return json(result)
    }

    if (action === 'process-and-reconcile') {
      const reconcileResult = await reconcile(sb)
      const processResult = await processQueue(sb)
      return json({
        reconcile: reconcileResult,
        process: processResult,
      })
    }

    return json({ error: `Unknown action: ${action}` }, 400)
  } catch (err: any) {
    return json({ error: err.message || 'Internal error' }, 500)
  }
})
