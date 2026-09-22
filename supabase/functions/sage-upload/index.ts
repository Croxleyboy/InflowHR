// POST /functions/v1/sage-upload
// Receives a Sage payslip PDF (as text extracted client-side), matches employees
// by employee_number within the company, and upserts payslip records.

import { getSupabase, parseSagePayslipText, corsHeaders, json } from '../_shared/sage.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const sb = getSupabase()

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Unauthorized' }, 401)
    const { data: { user }, error: authErr } = await sb.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

    const { company_id, pdf_text, filename } = await req.json()
    if (!company_id) return json({ error: 'company_id required' }, 400)
    if (!pdf_text) return json({ error: 'pdf_text required' }, 400)

    const { data: cu } = await sb
      .from('company_users')
      .select('role')
      .eq('auth_user_id', user.id)
      .eq('company_id', company_id)
      .eq('is_active', true)
      .maybeSingle()
    if (!cu || (cu.role !== 'admin' && cu.role !== 'hr')) {
      return json({ error: 'Only admins/HR can upload Sage payslips' }, 403)
    }

    const parsed = parseSagePayslipText(pdf_text)
    if (parsed.length === 0) {
      return json({ error: 'No payslip data found in the uploaded file. Ensure it is a Sage payslip export.' }, 400)
    }

    const { data: employees } = await sb
      .from('employees')
      .select('id, employee_number, first_name, last_name')
      .eq('company_id', company_id)
      .eq('is_active', true)

    const empByNumber: Record<string, { id: string; name: string }> = {}
    for (const e of (employees || [])) {
      if (e.employee_number) {
        empByNumber[e.employee_number.toUpperCase()] = {
          id: e.id,
          name: `${e.first_name} ${e.last_name}`,
        }
      }
    }

    const matched: { employee_name: string; employee_number: string; net_pay: number; period: string }[] = []
    const unmatched: { employee_name: string; employee_number: string }[] = []

    for (const ps of parsed) {
      const emp = empByNumber[ps.employee_number.toUpperCase()]
      if (!emp) {
        unmatched.push({ employee_name: ps.employee_name, employee_number: ps.employee_number })
        continue
      }

      const ref = `SAGE-${ps.employee_number}-${ps.pay_period_start}`

      const { data: existing } = await sb
        .from('payslips')
        .select('id')
        .eq('reference_number', ref)
        .eq('company_id', company_id)
        .maybeSingle()

      const row = {
        employee_id: emp.id,
        company_id,
        reference_number: ref,
        pay_period_start: ps.pay_period_start,
        pay_period_end: ps.pay_period_end,
        gross_pay: ps.gross_pay,
        tax: ps.tax,
        national_insurance: ps.national_insurance,
        pension: ps.pension,
        other_deductions: ps.other_deductions,
        net_pay: ps.net_pay,
        payment_date: ps.payment_date,
        status: 'paid',
        source: 'sage',
        tax_code: ps.tax_code,
      }

      if (existing) {
        await sb.from('payslips').update(row).eq('id', existing.id)
      } else {
        await sb.from('payslips').insert(row)
      }

      matched.push({
        employee_name: emp.name,
        employee_number: ps.employee_number,
        net_pay: ps.net_pay,
        period: `${ps.pay_period_start} — ${ps.pay_period_end}`,
      })
    }

    await sb.from('sage_integrations').upsert({
      company_id,
      sync_status: 'connected',
      sync_error: null,
      payslip_source: 'sage',
      last_upload_at: new Date().toISOString(),
      last_upload_filename: filename || 'sage-payslips.pdf',
      last_sync_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'company_id' })

    await sb.rpc('log_gdpr_action', {
      p_action: 'CREATE',
      p_entity_type: 'sage_payslip_upload',
      p_entity_id: company_id,
      p_details: JSON.stringify({
        filename: filename || 'sage-payslips.pdf',
        matched_count: matched.length,
        unmatched_count: unmatched.length,
        uploaded_by: user.id,
      }),
    })

    return json({ matched, unmatched, total_parsed: parsed.length })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
})
