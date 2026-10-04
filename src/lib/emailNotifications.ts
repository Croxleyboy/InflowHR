import { supabase, sendNotificationEmail } from './supabase'

export type EmailFeatureKey =
  | 'leave_enabled'
  | 'expenses_enabled'
  | 'shifts_enabled'
  | 'kudos_enabled'
  | 'space_booking_enabled'
  | 'performance_reminders_enabled'
  | 'elearning_reminders_enabled'

interface SendEmailNotificationParams {
  companyId: string
  employeeId: string
  featureKey: EmailFeatureKey
  title: string
  message: string
  type?: 'info' | 'action' | 'alert'
  link?: string
}

export async function sendFeatureEmail(params: SendEmailNotificationParams): Promise<void> {
  const { companyId, employeeId, featureKey, title, message, type = 'info', link } = params

  const { data: featureRow } = await supabase
    .from('company_features')
    .select('is_enabled')
    .eq('company_id', companyId)
    .eq('feature_key', 'email_notifications')
    .single()

  if (!featureRow?.is_enabled) return

  const { data: settings } = await supabase
    .from('email_notification_settings')
    .select('*')
    .eq('company_id', companyId)
    .single()

  if (!settings || !(settings as Record<string, unknown>)[featureKey]) return

  const notifPayload: Record<string, unknown> = {
    employee_id: employeeId,
    title,
    message,
    type,
    link: link || '/',
    is_read: false,
    company_id: companyId,
    send_email: true,
  }

  const { data: notifRow } = await supabase
    .from('notifications')
    .insert(notifPayload)
    .select('id')
    .single()

  sendNotificationEmail({ ...notifPayload, id: notifRow?.id, email_sent: false })
}
