import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { SmtpClient } from 'https://deno.land/x/smtp@v0.7.0/mod.ts'

const TITAN_EMAIL = Deno.env.get('TITAN_EMAIL')!
const TITAN_PASSWORD = Deno.env.get('TITAN_PASSWORD')!
const APP_URL = Deno.env.get('APP_URL') || 'https://app.inflowhr.com'

function buildEmailHtml(firstName: string, title: string, message: string, link: string | null): string {
  const linkHtml = link
    ? `<p style="margin:24px 0 0"><a href="${APP_URL}${link}" style="display:inline-block;padding:10px 24px;background:#7c3aed;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">View in InflowHR</a></p>`
    : ''
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background:#f4f4f5">
  <div style="max-width:520px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)">
    <div style="background:linear-gradient(135deg,#7c3aed,#6d28d9);padding:24px 32px">
      <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700">InflowHR</h1>
    </div>
    <div style="padding:32px">
      <p style="margin:0 0 8px;color:#374151;font-size:15px">Hi ${firstName},</p>
      <h2 style="margin:16px 0 8px;color:#111827;font-size:18px">${title}</h2>
      <p style="margin:0;color:#4b5563;font-size:14px;line-height:1.6">${message}</p>
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
  try {
    const payload = await req.json()
    const record = payload.record

    if (!record || !record.send_email || record.email_sent) {
      return new Response(JSON.stringify({ skipped: true }), { status: 200 })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: emp } = await supabase
      .from('employees')
      .select('email, first_name')
      .eq('id', record.employee_id)
      .single()

    if (!emp?.email) {
      return new Response(JSON.stringify({ error: 'No employee email' }), { status: 200 })
    }

    const client = new SmtpClient()
    await client.connectTLS({
      hostname: 'smtp.titan.email',
      port: 465,
      username: TITAN_EMAIL,
      password: TITAN_PASSWORD,
    })

    await client.send({
      from: TITAN_EMAIL,
      to: emp.email,
      subject: `InflowHR: ${record.title}`,
      content: '',
      html: buildEmailHtml(
        emp.first_name || 'there',
        record.title,
        record.message || '',
        record.link || null,
      ),
    })

    await client.close()

    await supabase
      .from('notifications')
      .update({ email_sent: true, email_sent_at: new Date().toISOString() })
      .eq('id', record.id)

    return new Response(JSON.stringify({ sent: true, to: emp.email }), { status: 200 })
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 })
  }
})
