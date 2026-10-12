// POST /functions/v1/modulr-payout  { company_id, payrun_ref, payments: [{ employee_id, amount, sort_code, account_number, reference }] }
// Submits a batch Faster Payment via Modulr and records audit trail.

import {
  getSupabase, corsHeaders, json, verifyAdmin,
  decryptCredential, modulrRequest,
} from '../_shared/modulr.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const sb = getSupabase()
    const authHeader = req.headers.get('Authorization')
    const { company_id, payrun_ref, payments } = await req.json()

    if (!company_id || !payrun_ref || !payments?.length) {
      return json({ error: 'company_id, payrun_ref, and payments array required' }, 400)
    }

    const authResult = await verifyAdmin(sb, authHeader, company_id)
    if (authResult instanceof Response) return authResult

    // Load integration
    const { data: integration } = await sb
      .from('modulr_integrations')
      .select('api_key_encrypted, hmac_secret_encrypted, source_account_id, encryption_iv, status')
      .eq('company_id', company_id)
      .single()

    if (!integration || integration.status !== 'connected') {
      return json({ error: 'Modulr not connected' }, 400)
    }

    // Validate all payments have bank details
    const invalid = payments.filter((p: { sort_code?: string; account_number?: string }) =>
      !p.sort_code || !p.account_number || !/^\d{6}$/.test(p.sort_code) || !/^\d{8}$/.test(p.account_number)
    )
    if (invalid.length > 0) {
      return json({ error: `${invalid.length} payment(s) have missing or invalid bank details` }, 400)
    }

    const totalAmount = payments.reduce((sum: number, p: { amount: number }) => sum + p.amount, 0)

    // Create audit record
    const { data: paymentRecord, error: insertErr } = await sb
      .from('modulr_payments')
      .insert({
        company_id,
        payrun_ref,
        total_amount: totalAmount,
        employee_count: payments.length,
        status: 'pending',
        submitted_by: authResult.userId,
      })
      .select('id')
      .single()

    if (insertErr || !paymentRecord) {
      return json({ error: 'Failed to create payment record' }, 500)
    }

    // Insert line items
    const items = payments.map((p: { employee_id: string; payslip_id?: number; amount: number; sort_code: string; account_number: string; reference: string }) => ({
      payment_id: paymentRecord.id,
      employee_id: p.employee_id,
      payslip_id: p.payslip_id || null,
      amount: p.amount,
      sort_code: '**' + p.sort_code.slice(-4),
      account_number: '****' + p.account_number.slice(-4),
      reference: p.reference,
      status: 'pending',
    }))
    await sb.from('modulr_payment_items').insert(items)

    // Decrypt credentials
    const ivs = JSON.parse(integration.encryption_iv)
    const apiKey = await decryptCredential(integration.api_key_encrypted, ivs.apiKey)
    const hmacSecret = await decryptCredential(integration.hmac_secret_encrypted, ivs.hmac)

    // Build Modulr batch payment request
    const modulrPayments = payments.map((p: { sort_code: string; account_number: string; amount: number; reference: string; employee_name: string }) => ({
      sourceAccountId: integration.source_account_id,
      destination: {
        type: 'SCAN',
        sortCode: p.sort_code,
        accountNumber: p.account_number,
        name: (p.employee_name || 'Employee').substring(0, 18),
      },
      currency: 'GBP',
      amount: p.amount,
      reference: (p.reference || 'SALARY').substring(0, 18),
      externalReference: `${payrun_ref}_${p.employee_id}`.substring(0, 50),
      type: 'FASTER_PAYMENT',
    }))

    const result = await modulrRequest(apiKey, hmacSecret, 'POST', '/batchpayments', {
      externalReference: payrun_ref,
      payments: modulrPayments,
    })

    if (result.ok) {
      const batchData = result.data as Record<string, unknown>
      const batchStatus = batchData.status === 'APPROVAL_REQUIRED' ? 'submitted' : 'submitted'

      await sb.from('modulr_payments').update({
        modulr_batch_id: batchData.id as string,
        status: batchStatus,
        status_detail: batchData.status as string,
      }).eq('id', paymentRecord.id)

      await sb.from('modulr_payment_items').update({ status: 'submitted' }).eq('payment_id', paymentRecord.id)

      // Audit log
      try {
        await sb.rpc('log_gdpr_action', {
          p_company_id: company_id,
          p_user_id: authResult.userId,
          p_action: 'modulr_batch_payout',
          p_entity_type: 'modulr_payments',
          p_entity_id: paymentRecord.id,
          p_details: {
            payrun_ref,
            total_amount: totalAmount,
            employee_count: payments.length,
            modulr_batch_id: batchData.id,
            modulr_status: batchData.status,
          },
        })
      } catch (_) {}

      return json({
        payment_id: paymentRecord.id,
        modulr_batch_id: batchData.id,
        modulr_status: batchData.status,
        total_amount: totalAmount,
        employee_count: payments.length,
      })
    } else {
      await sb.from('modulr_payments').update({
        status: 'failed',
        status_detail: JSON.stringify(result.data),
      }).eq('id', paymentRecord.id)

      await sb.from('modulr_payment_items').update({ status: 'failed' }).eq('payment_id', paymentRecord.id)

      if (result.status === 403) {
        return json({ error: 'IP Whitelist Error. Please ensure our static IP is added to your Modulr portal.' }, 403)
      }
      return json({ error: 'Modulr payment submission failed', detail: result.data }, result.status)
    }
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
})
