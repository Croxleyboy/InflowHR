import { supabase } from './supabase'

export type SlackNotifyKey = 'notify_leave_requests' | 'notify_expense_claims' | 'notify_onboarding'

interface SendSlackNotificationParams {
  companyId: string
  notifyKey: SlackNotifyKey
  message: string
  channel?: string
}

export async function sendSlackNotification(params: SendSlackNotificationParams): Promise<void> {
  const { companyId, notifyKey, message, channel } = params

  const { data: config } = await supabase
    .from('slack_integrations')
    .select('is_enabled, webhook_url, notify_leave_requests, notify_expense_claims, notify_onboarding')
    .eq('company_id', companyId)
    .maybeSingle()

  if (!config?.is_enabled || !config?.webhook_url) return
  if (!(config as Record<string, unknown>)[notifyKey]) return

  const { data: feature } = await supabase
    .from('company_features')
    .select('is_enabled')
    .eq('company_id', companyId)
    .eq('feature_key', 'slack_integration')
    .maybeSingle()

  if (!feature?.is_enabled) return

  await supabase.functions.invoke('send-slack-notification', {
    body: { company_id: companyId, message, ...(channel ? { channel } : {}) },
  })
}
