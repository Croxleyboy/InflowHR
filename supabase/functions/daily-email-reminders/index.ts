import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY') || ''
const TITAN_EMAIL = Deno.env.get('TITAN_EMAIL') || 'notifications@inflowhr.com'
const SENDER_NAME = Deno.env.get('SENDER_NAME') || 'InflowHR'
const APP_URL = Deno.env.get('APP_URL') || 'https://app.inflowhr.com'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildEmailHtml(firstName: string, title: string, message: string, link?: string): string {
  const safeName = escapeHtml(firstName)
  const safeTitle = escapeHtml(title)
  const safeMessage = escapeHtml(message)
  return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f8f9fa;border-radius:8px;overflow:hidden">
    <div style="background:linear-gradient(135deg,#6C4FBF 0%,#8B5CF6 100%);padding:24px;text-align:center">
      <h1 style="color:#fff;margin:0;font-size:22px">${escapeHtml(SENDER_NAME)}</h1>
    </div>
    <div style="padding:24px">
      <p style="color:#333;font-size:16px">Hi ${safeName},</p>
      <h2 style="color:#333;font-size:18px;margin:16px 0 8px">${safeTitle}</h2>
      <p style="color:#555;font-size:14px;line-height:1.6">${safeMessage}</p>
      ${link ? `<div style="text-align:center;margin:24px 0"><a href="${escapeHtml(APP_URL)}${escapeHtml(link)}" style="background:#6C4FBF;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:14px">Log in to InflowHR</a></div>` : ''}
    </div>
    <div style="padding:16px;text-align:center;color:#999;font-size:11px;border-top:1px solid #eee">
      This is an automated reminder from InflowHR.
    </div>
  </div>`
}

async function sendEmail(to: string, firstName: string, title: string, message: string, link?: string) {
  await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': BREVO_API_KEY },
    body: JSON.stringify({
      sender: { email: TITAN_EMAIL, name: SENDER_NAME },
      to: [{ email: to }],
      subject: title,
      htmlContent: buildEmailHtml(firstName, title, message, link),
    }),
  })
}

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization')
  const cronSecret = Deno.env.get('CRON_SECRET')
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const supabase = createClient(supabaseUrl, supabaseKey)

  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`

  let remindersSent = 0

  // 1:1 Meeting reminders — meetings scheduled for tomorrow
  const { data: meetings } = await supabase
    .from('one_to_one_meetings')
    .select('id, employee_id, manager_id, scheduled_date, scheduled_time, company_id')
    .eq('scheduled_date', tomorrowStr)
    .eq('status', 'pending')

  if (meetings) {
    for (const meeting of meetings) {
      const { data: settings } = await supabase
        .from('email_notification_settings')
        .select('performance_reminders_enabled')
        .eq('company_id', meeting.company_id)
        .single()

      if (!settings?.performance_reminders_enabled) continue

      const { data: cfRow } = await supabase
        .from('company_features')
        .select('is_enabled')
        .eq('company_id', meeting.company_id)
        .eq('feature_key', 'email_notifications')
        .single()

      if (!cfRow?.is_enabled) continue

      const dateStr = new Date(tomorrowStr + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

      // Notify the employee
      const { data: emp } = await supabase
        .from('employees')
        .select('email, first_name, last_name')
        .eq('id', meeting.employee_id)
        .single()

      if (emp?.email) {
        await sendEmail(
          emp.email,
          emp.first_name || 'there',
          '1:1 Meeting Reminder — Tomorrow',
          `You have a 1:1 meeting scheduled for tomorrow, ${dateStr} at ${meeting.scheduled_time}. Please prepare any items you'd like to discuss.`,
          '/one-to-ones',
        )
        remindersSent++
      }

      // Notify the manager
      const { data: mgr } = await supabase
        .from('employees')
        .select('email, first_name')
        .eq('id', meeting.manager_id)
        .single()

      if (mgr?.email) {
        await sendEmail(
          mgr.email,
          mgr.first_name || 'there',
          '1:1 Meeting Reminder — Tomorrow',
          `You have a 1:1 meeting with ${emp?.first_name || ''} ${emp?.last_name || ''} scheduled for tomorrow, ${dateStr} at ${meeting.scheduled_time}.`,
          '/one-to-ones',
        )
        remindersSent++
      }
    }
  }

  // E-Learning expiry reminders — deadlines expiring tomorrow
  const { data: enrolments } = await supabase
    .from('elearning_enrolments')
    .select('id, employee_id, company_id, deadline, course:elearning_courses(title)')
    .eq('deadline', tomorrowStr)
    .neq('status', 'completed')

  if (enrolments) {
    for (const enrolment of enrolments) {
      const { data: settings } = await supabase
        .from('email_notification_settings')
        .select('elearning_reminders_enabled')
        .eq('company_id', enrolment.company_id)
        .single()

      if (!settings?.elearning_reminders_enabled) continue

      const { data: cfRow } = await supabase
        .from('company_features')
        .select('is_enabled')
        .eq('company_id', enrolment.company_id)
        .eq('feature_key', 'email_notifications')
        .single()

      if (!cfRow?.is_enabled) continue

      const { data: emp } = await supabase
        .from('employees')
        .select('email, first_name')
        .eq('id', enrolment.employee_id)
        .single()

      if (emp?.email) {
        const courseTitle = (enrolment.course as { title: string })?.title || 'a course'
        const dateStr = new Date(tomorrowStr + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

        await sendEmail(
          emp.email,
          emp.first_name || 'there',
          'E-Learning Course Deadline — Tomorrow',
          `Your deadline for "${courseTitle}" expires tomorrow (${dateStr}). Please complete the course before it expires.`,
          '/elearning',
        )
        remindersSent++
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, reminders_sent: remindersSent }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
