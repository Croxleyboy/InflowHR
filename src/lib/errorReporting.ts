import { supabase } from './supabase'

const MAX_PER_MINUTE = 5
const DEDUP_WINDOW_MS = 10_000

let reportCount = 0
let windowStart = Date.now()
const recentMessages = new Map<string, number>()

export async function reportError(error: Error, extra?: { componentStack?: string }) {
  try {
    const now = Date.now()

    if (now - windowStart > 60_000) {
      reportCount = 0
      windowStart = now
    }
    if (reportCount >= MAX_PER_MINUTE) return

    const msg = error.message || String(error)
    const lastSeen = recentMessages.get(msg)
    if (lastSeen && now - lastSeen < DEDUP_WINDOW_MS) return
    recentMessages.set(msg, now)

    for (const [k, ts] of recentMessages) {
      if (now - ts > DEDUP_WINDOW_MS) recentMessages.delete(k)
    }

    reportCount++

    let companyId: string | null = null
    let userEmail: string | null = null
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) {
        userEmail = session.user.email ?? null
        const { data: cu } = await supabase
          .from('company_users')
          .select('company_id')
          .eq('auth_user_id', session.user.id)
          .limit(1)
          .maybeSingle()
        companyId = cu?.company_id ?? null
      }
    } catch {
      // auth lookup failed — continue without user context
    }

    await supabase.from('frontend_errors').insert({
      company_id: companyId,
      user_email: userEmail,
      error_message: msg.slice(0, 2000),
      error_stack: error.stack?.slice(0, 4000) ?? null,
      component_stack: extra?.componentStack?.slice(0, 4000) ?? null,
      url: window.location.href,
      user_agent: navigator.userAgent,
    })
  } catch {
    // error reporting must never throw
  }
}
