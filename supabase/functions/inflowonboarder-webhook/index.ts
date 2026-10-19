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
  if (!isJoiner && !isLeaver) {
    console.warn(`[IFO-WEBHOOK] Unknown template: ${templateId}`)
    return
  }

  const table = isJoiner ? 'onboarding_m365_actions' : 'offboarding_m365_actions'
  const idColumn = isJoiner ? 'onboarding_id' : 'offboarding_id'

  const refPrefix = isJoiner ? 'starter-' : 'leaver-'
  const recordId = externalRef.startsWith(refPrefix)
    ? parseInt(externalRef.slice(refPrefix.length), 10)
    : parseInt(externalRef, 10)

  if (isNaN(recordId)) {
    console.error(`[IFO-WEBHOOK] Invalid externalRef: ${externalRef}`)
    return
  }

  const { data: existing } = await sb.from(table)
    .select('schedule_id, schedule_updated_at, company_id')
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
  }

  if (type === 'schedule.failed') {
    updates.run_error = data.error || { code: 'schedule_failed', message: message || 'Schedule failed' }
  }

  if (type === 'schedule.cancelled') {
    updates.schedule_status = 'cancelled'
  }

  await sb.from(table).update(updates).eq(idColumn, recordId)

  if (type === 'schedule.stage_upcoming' && isLeaver) {
    const upcomingStage = stages?.find(s => s.status === 'upcoming')
    if (upcomingStage?.name === 'remove_access') {
      await createLeaverReminder(sb, existing.company_id, recordId)
    }
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
