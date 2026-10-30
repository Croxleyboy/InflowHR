import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, webhook-id, webhook-timestamp, webhook-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function getSupabase() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
}

// ── Standard Webhooks HMAC-SHA256 verification ────────────────────────────

async function verifySignature(
  secret: string,
  webhookId: string,
  timestamp: string,
  body: string,
  signatureHeader: string,
): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000)
  const ts = parseInt(timestamp, 10)
  if (isNaN(ts) || Math.abs(now - ts) > 300) return false

  const secretBytes = Uint8Array.from(atob(secret.replace('whsec_', '')), c => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const toSign = new TextEncoder().encode(`${webhookId}.${timestamp}.${body}`)
  const sig = await crypto.subtle.sign('HMAC', key, toSign)
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)))

  const signatures = signatureHeader.split(' ')
  for (const s of signatures) {
    const parts = s.split(',')
    const sigValue = parts.length === 2 ? parts[1] : parts[0]
    if (sigValue === expected) return true
  }
  return false
}

// ── Event processing ──────────────────────────────────────────────────────

interface ScheduleEvent {
  type: string
  data: {
    scheduleId: string
    templateId: string
    externalRef: string
    status: string
    message?: string
    stages?: Array<{
      name: string
      status: string
      scheduledAt: string
      completedAt?: string
      result?: unknown
      error?: unknown
    }>
    nextDueAt?: string
    updatedAt: string
    result?: unknown
    error?: unknown
  }
}

async function processEvent(sb: ReturnType<typeof getSupabase>, event: ScheduleEvent) {
  const { type, data } = event
  const { scheduleId, templateId, externalRef, status, message, stages, nextDueAt, updatedAt } = data

  const isJoiner = templateId === 'hr.joiner'
  const isLeaver = templateId === 'hr.leaver'
  const isMover = templateId === 'hr.mover'
  if (!isJoiner && !isLeaver && !isMover) {
    console.warn(`[IFO-WEBHOOK] Unknown template: ${templateId}`)
    return
  }

  const table = isMover ? 'mover_m365_actions' : isJoiner ? 'onboarding_m365_actions' : 'offboarding_m365_actions'
  const idColumn = isMover ? 'role_change_id' : isJoiner ? 'onboarding_id' : 'offboarding_id'

  const refPrefix = isMover ? 'move-' : isJoiner ? 'starter-' : 'leaver-'
  const recordId = externalRef.startsWith(refPrefix)
    ? parseInt(externalRef.slice(refPrefix.length), 10)
    : parseInt(externalRef, 10)

  if (isNaN(recordId)) {
    console.error(`[IFO-WEBHOOK] Invalid externalRef: ${externalRef}`)
    return
  }

  const selectCols = isJoiner
    ? 'schedule_id, schedule_updated_at, company_id, schedule_options, pass_status'
    : 'schedule_id, schedule_updated_at, company_id'
  const { data: existing } = await sb.from(table)
    .select(selectCols)
    .eq(idColumn, recordId)
    .maybeSingle()

  if (!existing) {
    console.warn(`[IFO-WEBHOOK] No record found for ${idColumn}=${recordId}`)
    return
  }

  if (existing.schedule_id && existing.schedule_id !== scheduleId) {
    console.warn(`[IFO-WEBHOOK] schedule_id mismatch: expected ${existing.schedule_id}, got ${scheduleId}`)
    return
  }

  if (existing.schedule_updated_at && new Date(updatedAt) <= new Date(existing.schedule_updated_at)) {
    console.log(`[IFO-WEBHOOK] Stale event for ${idColumn}=${recordId}, skipping`)
    return
  }

  const updates: Record<string, unknown> = {
    schedule_status: status,
    schedule_message: message || null,
    schedule_stages: stages || null,
    schedule_next_due_at: nextDueAt || null,
    schedule_updated_at: updatedAt,
    updated_at: new Date().toISOString(),
  }

  if (!existing.schedule_id) {
    updates.schedule_id = scheduleId
  }

  if (type === 'schedule.completed' && data.result) {
    updates.run_result = data.result
    updates.run_status = 'completed'
    if (isJoiner && (data.result as any)?.userId) {
      updates.m365_user_id = (data.result as any).userId
      updates.m365_upn = (data.result as any).userPrincipalName
    }
    if (isMover) {
      await sb.from('role_changes').update({
        status: 'completed',
        completed_at: new Date().toISOString(),
      }).eq('id', recordId)
    }
  }

  if (type === 'schedule.failed') {
    updates.run_error = data.error || { code: 'schedule_failed', message: message || 'Schedule failed' }
  }

  if (type === 'schedule.cancelled') {
    updates.schedule_status = 'cancelled'
  }

  await sb.from(table).update(updates).eq(idColumn, recordId)

  if (type === 'schedule.stage_completed' && isJoiner) {
    const completedStage = stages?.find(s => s.name === 'enable_sign_in' && s.status === 'completed')
    const stageResult = completedStage?.result as any
    if (completedStage) {
      if (stageResult?.passId) {
        await sb.from('onboarding_m365_actions').update({
          pass_id: stageResult.passId,
          pass_expires_at: stageResult.expiresAt,
          pass_status: 'ready',
          pass_error_detail: null,
          updated_at: new Date().toISOString(),
        }).eq('onboarding_id', recordId)
        await createTapReadyNotification(sb, existing.company_id, recordId, stageResult.expiresAt)
      } else if ((existing as any).schedule_options?.issuePass) {
        await sb.from('onboarding_m365_actions').update({
          pass_status: 'skipped',
          pass_error_detail: null,
          updated_at: new Date().toISOString(),
        }).eq('onboarding_id', recordId)
      }
    }
  }

  if (type === 'schedule.blocked' && isJoiner) {
    const errCode = (data.error as any)?.code
    const passBlockCodes = ['passes_off', 'passes_not_connected', 'passes_setup_incomplete']
    const schedAskedForPass = !!(existing as any).schedule_options?.issuePass
    if (schedAskedForPass && (passBlockCodes.includes(errCode) || (errCode === 'function_suspended' && (data.error as any)?.function === 'passes'))) {
      await sb.from('onboarding_m365_actions').update({
        pass_status: 'blocked',
        pass_error_detail: data.error || null,
        updated_at: new Date().toISOString(),
      }).eq('onboarding_id', recordId)
    }
  }

  if (type === 'schedule.stage_upcoming' && isLeaver) {
    const upcomingStage = stages?.find(s => s.status === 'upcoming')
    if (upcomingStage?.name === 'remove_access') {
      await createLeaverReminder(sb, existing.company_id, recordId)
    }
  }
}

async function createTapReadyNotification(
  sb: ReturnType<typeof getSupabase>,
  companyId: string,
  onboardingId: number,
  expiresAt: string,
) {
  try {
    const { data: onboarding } = await sb.from('onboardings')
      .select('employee_id, employees!inner(first_name, last_name, manager_id)')
      .eq('id', onboardingId)
      .maybeSingle()

    if (!onboarding) return

    const emp = (onboarding as any).employees
    const empName = `${emp.first_name} ${emp.last_name}`
    const managerId = emp.manager_id

    if (!managerId) return

    const { data: manager } = await sb.from('employees')
      .select('id')
      .eq('id', managerId)
      .maybeSingle()
    if (!manager) return

    const expiry = new Date(expiresAt)
    const expiryStr = `${expiry.getDate().toString().padStart(2, '0')}/${(expiry.getMonth() + 1).toString().padStart(2, '0')}/${expiry.getFullYear()} at ${expiry.getHours().toString().padStart(2, '0')}:${expiry.getMinutes().toString().padStart(2, '0')}`

    await sb.from('notifications').insert({
      company_id: companyId,
      employee_id: managerId,
      type: 'tap_ready',
      title: 'First-day sign-in pass ready',
      message: `${empName}'s first-day sign-in pass is ready. View it once in InflowHR before ${expiryStr}.`,
      is_read: false,
      metadata: { onboarding_id: onboardingId },
    })
  } catch (e) {
    console.error('[IFO-WEBHOOK] Failed to create TAP notification:', e)
  }
}

async function createLeaverReminder(
  sb: ReturnType<typeof getSupabase>,
  companyId: string,
  offboardingId: number,
) {
  try {
    const { data: offboarding } = await sb.from('offboardings')
      .select('employee_id, employees!inner(first_name, last_name)')
      .eq('id', offboardingId)
      .maybeSingle()

    if (!offboarding) return

    const emp = (offboarding as any).employees
    const empName = `${emp.first_name} ${emp.last_name}`

    const { data: admins } = await sb.from('company_users')
      .select('employee_id')
      .eq('company_id', companyId)
      .in('role', ['admin', 'hr'])
      .eq('is_active', true)

    if (!admins?.length) return

    for (const admin of admins) {
      await sb.from('notifications').insert({
        company_id: companyId,
        employee_id: admin.employee_id,
        type: 'reminder',
        title: 'M365 Licence Removal Upcoming',
        message: `${empName}'s Microsoft 365 groups and licence will be removed soon. Please ensure mailbox and file handover is complete.`,
        is_read: false,
      })
    }
  } catch (e) {
    console.error('[IFO-WEBHOOK] Failed to create leaver reminder:', e)
  }
}

// ── Handle workflow.run.updated — passId from immediate runs (Item 2) ────

async function processRunEvent(sb: ReturnType<typeof getSupabase>, event: any) {
  const { data } = event
  const { runId, externalRef, status, result, error: runError } = data || {}
  if (!runId || !externalRef) return

  const onboardingId = externalRef.startsWith('starter-')
    ? parseInt(externalRef.slice('starter-'.length), 10)
    : parseInt(externalRef, 10)
  if (isNaN(onboardingId)) return

  const { data: existing } = await sb.from('onboarding_m365_actions')
    .select('run_id, company_id')
    .eq('onboarding_id', onboardingId)
    .maybeSingle()
  if (!existing) return

  const updates: Record<string, unknown> = {
    run_status: status,
    updated_at: new Date().toISOString(),
  }
  if (status === 'completed' && result) {
    updates.run_result = result
    if (result.userId) updates.m365_user_id = result.userId
    if (result.userPrincipalName) updates.m365_upn = result.userPrincipalName
    if (result.passId) {
      updates.pass_id = result.passId
      updates.pass_expires_at = result.expiresAt || result.passExpiresAt
      updates.pass_status = 'ready'
    }
  }
  if (status === 'failed' && runError) {
    updates.run_error = runError
    const steps = result?.steps || data?.steps
    const issuePassStep = steps?.find((s: any) => s.name === 'issue_pass')
    if (issuePassStep?.status === 'failed' && !steps?.some((s: any) => s.name !== 'issue_pass' && s.status === 'failed')) {
      updates.run_status = 'completed'
      updates.pass_status = 'skipped'
      updates.pass_error_detail = issuePassStep.error || issuePassStep.result?.error || null
    }
  }

  await sb.from('onboarding_m365_actions').update(updates).eq('onboarding_id', onboardingId)

  if (result?.passId && existing.company_id) {
    await createTapReadyNotification(sb, existing.company_id, onboardingId, result.expiresAt || result.passExpiresAt)
  }
}

// ── Main handler ──────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const webhookId = req.headers.get('webhook-id')
    const webhookTimestamp = req.headers.get('webhook-timestamp')
    const webhookSignature = req.headers.get('webhook-signature')

    if (!webhookId || !webhookTimestamp || !webhookSignature) {
      return json({ error: 'Missing webhook headers' }, 400)
    }

    const bodyText = await req.text()
    const sb = getSupabase()

    const { data: integrations } = await sb.from('inflowonboarder_integrations')
      .select('company_id, webhook_secret')
      .not('webhook_secret', 'is', null)

    if (!integrations?.length) {
      return json({ error: 'No webhook configurations found' }, 404)
    }

    let verified = false
    for (const integration of integrations) {
      if (integration.webhook_secret) {
        const valid = await verifySignature(
          integration.webhook_secret,
          webhookId,
          webhookTimestamp,
          bodyText,
          webhookSignature,
        )
        if (valid) {
          verified = true
          break
        }
      }
    }

    if (!verified) {
      return json({ error: 'Invalid signature' }, 401)
    }

    const event: ScheduleEvent = JSON.parse(bodyText)

    if (event.type === 'workflow.run.updated') {
      await processRunEvent(sb, event)
      return json({ received: true })
    }

    if (!event.type || !event.data?.scheduleId || !event.data?.externalRef) {
      return json({ error: 'Invalid event payload' }, 400)
    }

    await processEvent(sb, event)
    return json({ received: true })

  } catch (err) {
    console.error('[IFO-WEBHOOK] unhandled error:', err)
    return json({ error: 'Internal server error' }, 500)
  }
})
