import { supabase } from './supabase'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

interface SendTeamsNotificationParams {
  companyId: string
  managerEmail: string
  employeeName: string
  message: string
}

export async function sendTeamsNotification(params: SendTeamsNotificationParams): Promise<void> {
  const { companyId, managerEmail, employeeName, message } = params

  const { data: config } = await supabase
    .from('company_teams_config')
    .select('is_enabled, bot_configured')
    .eq('company_id', companyId)
    .maybeSingle()

  if (!config?.is_enabled || !config?.bot_configured) return

  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) return

  await fetch(`${supabaseUrl}/functions/v1/send-teams-notification`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseAnonKey,
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      company_id: companyId,
      manager_email: managerEmail,
      employee_name: employeeName,
      message,
    }),
  })
}
