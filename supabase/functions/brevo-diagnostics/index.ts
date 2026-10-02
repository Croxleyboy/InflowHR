import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY') || ''
const SENDER_EMAIL = Deno.env.get('TITAN_EMAIL') || 'notifications@inflowhr.com'
const ALLOWED_ORIGIN = 'https://app.inflowhr.com'

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Unauthorized' }, 401)

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const { data: { user }, error: authErr } = await sb.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

    const adminSb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const { data: sa } = await adminSb.from('super_admins')
      .select('id').eq('email', user.email).maybeSingle()
    if (!sa) return json({ error: 'Super admin access required' }, 403)

    const results: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      configured_sender: SENDER_EMAIL,
      api_key_set: !!BREVO_API_KEY,
      api_key_prefix: BREVO_API_KEY ? BREVO_API_KEY.substring(0, 12) + '...' : '(not set)',
    }

    if (!BREVO_API_KEY) {
      results.error = 'BREVO_API_KEY environment variable is not set'
      return json(results)
    }

    const brevoHeaders = {
      'accept': 'application/json',
      'api-key': BREVO_API_KEY,
    }

    // 1. Account info
    try {
      const res = await fetch('https://api.brevo.com/v3/account', { headers: brevoHeaders })
      if (res.ok) {
        const data = await res.json()
        results.account = {
          status: 'ok',
          company_name: data.companyName || null,
          email: data.email || null,
          plan: data.plan?.[0]?.type || null,
          credits_remaining: data.plan?.[0]?.credits ?? null,
          credits_type: data.plan?.[0]?.creditsType || null,
        }
      } else {
        const err = await res.text()
        results.account = { status: 'error', code: res.status, message: err }
      }
    } catch (err) {
      results.account = { status: 'error', message: (err as Error).message }
    }

    // 2. Senders list — check if our sender is verified
    try {
      const res = await fetch('https://api.brevo.com/v3/senders', { headers: brevoHeaders })
      if (res.ok) {
        const data = await res.json()
        const senders = (data.senders || []) as { email: string; active: boolean; name: string }[]
        const ourSender = senders.find(
          (s: { email: string }) => s.email.toLowerCase() === SENDER_EMAIL.toLowerCase()
        )
        results.sender = {
          status: ourSender ? 'ok' : 'warning',
          configured_email: SENDER_EMAIL,
          found_in_brevo: !!ourSender,
          active: ourSender?.active ?? false,
          sender_name: ourSender?.name || null,
          total_senders: senders.length,
          all_senders: senders.map((s: { email: string; active: boolean; name: string }) => ({
            email: s.email, active: s.active, name: s.name,
          })),
        }
      } else {
        const err = await res.text()
        results.sender = { status: 'error', code: res.status, message: err }
      }
    } catch (err) {
      results.sender = { status: 'error', message: (err as Error).message }
    }

    // 3. Domain verification
    try {
      const senderDomain = SENDER_EMAIL.split('@')[1] || ''
      const res = await fetch('https://api.brevo.com/v3/senders/domains', { headers: brevoHeaders })
      if (res.ok) {
        const data = await res.json()
        const domains = (data.domains || []) as { domain: string; authenticated: boolean; dns_records?: unknown }[]
        const ourDomain = senderDomain
          ? domains.find((d) => d.domain && d.domain.toLowerCase() === senderDomain.toLowerCase())
          : null
        results.domain = {
          status: ourDomain?.authenticated ? 'ok' : 'warning',
          sender_domain: senderDomain || '(unknown)',
          found_in_brevo: !!ourDomain,
          authenticated: ourDomain?.authenticated ?? false,
          total_domains: domains.length,
          all_domains: domains.filter((d) => d.domain).map((d) => ({
            domain: d.domain, authenticated: d.authenticated,
          })),
        }
      } else {
        const err = await res.text()
        results.domain = { status: 'error', code: res.status, message: err }
      }
    } catch (err) {
      results.domain = { status: 'error', message: (err as Error).message }
    }

    // 4. SMTP activity — recent email events
    try {
      const res = await fetch('https://api.brevo.com/v3/smtp/statistics/aggregatedReport', {
        headers: brevoHeaders,
      })
      if (res.ok) {
        const data = await res.json()
        results.smtp_stats = {
          status: 'ok',
          requests: data.requests ?? 0,
          delivered: data.delivered ?? 0,
          bounces: (data.hardBounces ?? 0) + (data.softBounces ?? 0),
          hard_bounces: data.hardBounces ?? 0,
          soft_bounces: data.softBounces ?? 0,
          opens: data.uniqueOpens ?? 0,
          clicks: data.uniqueClicks ?? 0,
          spam_reports: data.spamReports ?? 0,
          blocked: data.blocked ?? 0,
          invalid: data.invalid ?? 0,
        }
      } else {
        const err = await res.text()
        results.smtp_stats = { status: 'error', code: res.status, message: err }
      }
    } catch (err) {
      results.smtp_stats = { status: 'error', message: (err as Error).message }
    }

    // 5. Recent transactional events (last 10)
    try {
      const res = await fetch('https://api.brevo.com/v3/smtp/statistics/events?limit=10&sort=desc', {
        headers: brevoHeaders,
      })
      if (res.ok) {
        const data = await res.json()
        results.recent_events = {
          status: 'ok',
          events: (data.events || []).map((e: Record<string, unknown>) => ({
            email: e.email,
            event: e.event,
            date: e.date,
            subject: e.subject,
            message_id: e.messageId,
          })),
        }
      } else {
        const err = await res.text()
        results.recent_events = { status: 'error', code: res.status, message: err }
      }
    } catch (err) {
      results.recent_events = { status: 'error', message: (err as Error).message }
    }

    return json(results)
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
})
