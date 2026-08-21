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
