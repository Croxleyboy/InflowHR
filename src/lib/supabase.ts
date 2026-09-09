import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export async function callRpcDirect(
  fnName: string,
  params: Record<string, unknown>,
): Promise<{ data: unknown; error: string | null }> {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token || supabaseAnonKey
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${fnName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseAnonKey,
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(params),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    return { data: null, error: body?.message || body?.error || `HTTP ${res.status}` }
  }
  return { data: body, error: null }
}

export async function sendNotificationEmail(notificationRecord: Record<string, unknown>): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token || supabaseAnonKey
    const res = await fetch(`${supabaseUrl}/functions/v1/send-notification-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ record: notificationRecord }),
    })
    const body = await res.text().catch(() => '')
    if (!res.ok) {
      console.warn('Notification email failed:', res.status, body)
    }
  } catch (err) {
    console.warn('Notification email error:', err)
  }
}

export async function signInDirect(
  email: string,
  password: string,
): Promise<{ session: { access_token: string; refresh_token: string } | null; error: string | null }> {
  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseAnonKey,
    },
    body: JSON.stringify({ email, password }),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    return { session: null, error: body?.error_description || body?.msg || body?.message || `HTTP ${res.status}` }
  }
  await supabase.auth.setSession({
    access_token: body.access_token,
    refresh_token: body.refresh_token,
  })
  return { session: { access_token: body.access_token, refresh_token: body.refresh_token }, error: null }
}
