import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY')!
const SENDER_EMAIL = Deno.env.get('TITAN_EMAIL') || 'notifications@inflowhr.com'
const SENDER_NAME = 'InflowHR'
const APP_URL = Deno.env.get('APP_URL') || 'https://app.inflowhr.com'
const ALLOWED_ORIGIN = 'https://app.inflowhr.com'

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildEmailHtml(firstName: string, title: string, message: string, _link: string | null): string {
  const safeName = escapeHtml(firstName)
  const safeTitle = escapeHtml(title)
  const safeMessage = escapeHtml(message)
  const linkHtml = `<p style="margin:24px 0 0"><a href="${escapeHtml(APP_URL)}" style="display:inline-block;padding:10px 24px;background:#7c3aed;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">Log in to InflowHR</a></p>
      <p style="margin:8px 0 0;color:#9ca3af;font-size:12px">Sign in and navigate to your Leave page to view details.</p>`
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background:#f4f4f5">
  <div style="max-width:520px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)">
    <div style="background:linear-gradient(135deg,#7c3aed,#6d28d9);padding:24px 32px">
      <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700">InflowHR</h1>
    </div>
    <div style="padding:32px">
      <p style="margin:0 0 8px;color:#374151;font-size:15px">Hi ${safeName},</p>
      <h2 style="margin:16px 0 8px;color:#111827;font-size:18px">${safeTitle}</h2>
      <p style="margin:0;color:#4b5563;font-size:14px;line-height:1.6">${safeMessage}</p>
      ${linkHtml}
    </div>
    <div style="padding:16px 32px;background:#f9fafb;border-top:1px solid #e5e7eb">
      <p style="margin:0;color:#9ca3af;font-size:12px">This is an automated notification from InflowHR. Do not reply to this email.</p>
    </div>
  </div>
</body>
</html>`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // SEC-C02: Validate the caller is authenticated
    const authHeader = req.headers.get('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), { status: 401, headers: corsHeaders })
    }

    const token = authHeader.replace('Bearer ', '')
    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token)
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid or expired token' }), { status: 401, headers: corsHeaders })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const payload = await req.json()
    const notificationId = payload?.record?.id ?? payload?.notification_id
    if (!notificationId) {
      return new Response(JSON.stringify({ error: 'notification_id required' }), { status: 400, headers: corsHeaders })
    }

    const { data: record } = await supabase
      .from('notifications')
      .select('id, title, message, link, employee_id, company_id, send_email, email_sent')
      .eq('id', notificationId)
      .single()

    const { data: caller } = await supabase
      .from('company_users')
      .select('company_id')
      .eq('auth_user_id', user.id)
      .eq('is_active', true)
      .maybeSingle()

    if (!record || !caller || record.company_id !== caller.company_id) {
      return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: corsHeaders })
    }

    if (!record.send_email || record.email_sent) {
      return new Response(JSON.stringify({ skipped: true }), { status: 200, headers: corsHeaders })
    }

    const { data: emp } = await supabase
      .from('employees')
      .select('email, first_name')
      .eq('id', record.employee_id)
      .eq('company_id', record.company_id)
      .single()

    if (!emp?.email) {
      return new Response(JSON.stringify({ error: 'No employee email' }), { status: 200, headers: corsHeaders })
    }

    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'api-key': BREVO_API_KEY,
      },
      body: JSON.stringify({
        sender: { name: SENDER_NAME, email: SENDER_EMAIL },
        to: [{ email: emp.email, name: emp.first_name || '' }],
        subject: `InflowHR: ${record.title}`,
        htmlContent: buildEmailHtml(
          emp.first_name || 'there',
          record.title,
          record.message || '',
          record.link || null,
        ),
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      return new Response(JSON.stringify({ error: `Brevo API error: ${res.status} ${err}` }), { status: 500, headers: corsHeaders })
    }

    if (record.id) {
      await supabase
        .from('notifications')
        .update({ email_sent: true, email_sent_at: new Date().toISOString() })
        .eq('id', record.id)
    }

    return new Response(JSON.stringify({ sent: true }), { status: 200, headers: corsHeaders })
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: corsHeaders })
  }
})
