import { supabase } from './supabase'

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
    .select('is_enabled, consent_granted')
    .eq('company_id', companyId)
    .maybeSingle()

  if (!config?.is_enabled || !config?.consent_granted) return

  const { data: { session } } = await supabase.auth.getSession()
  const providerToken = session?.provider_token
  if (!providerToken) return

  await supabase.functions.invoke('send-teams-notification', {
    body: {
      company_id: companyId,
      manager_email: managerEmail,
      employee_name: employeeName,
      message,
      provider_token: providerToken,
    },
  })
}
