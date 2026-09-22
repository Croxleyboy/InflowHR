// POST /functions/v1/sage-payslips  { company_id }
// Fetches pay runs and payslips from Sage Business Cloud Payroll,
// matches employees by email, upserts into the payslips table with source='sage'.

import { getSupabase, getValidSageToken, corsHeaders, json } from '../_shared/sage.ts'

const SAGE_PAYROLL = 'https://api.accounting.sage.com/v3.1'

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

    const { company_id } = await req.json()
    if (!company_id) return json({ error: 'company_id required' }, 400)

    const { data: cu } = await sb
      .from('company_users')
      .select('role')
      .eq('auth_user_id', user.id)
      .eq('company_id', company_id)
      .eq('is_active', true)
      .maybeSingle()
    if (!cu || (cu.role !== 'admin' && cu.role !== 'hr')) return json({ error: 'Access denied' }, 403)

    const creds = await getValidSageToken(company_id)
    if (!creds) return json({ error: 'Sage not connected — please connect first' }, 400)

    const headers = {
      Authorization: `Bearer ${creds.accessToken}`,
      Accept: 'application/json',
    }

    // Fetch pay runs from Sage
    const payRunsRes = await fetch(`${SAGE_PAYROLL}/payslip_groups?items_per_page=50`, { headers })
    if (!payRunsRes.ok) {
      return json({ error: 'Failed to fetch pay runs from Sage' }, 502)
    }
    const payRunsData = await payRunsRes.json()
    const payRuns = payRunsData?.$items || []
    if (!payRuns.length) return json({ payRun: null, payslips: [] })

    // Sort by period end date descending, pick latest
    payRuns.sort((a: Record<string, string>, b: Record<string, string>) =>
      (b.period_end || '').localeCompare(a.period_end || '')
    )
    const latestRun = payRuns[0]

    // Fetch payslips for this pay run group
    const payslipsRes = await fetch(
      `${SAGE_PAYROLL}/payslips?payslip_group_id=${latestRun.id}&items_per_page=200`,
      { headers },
    )
    if (!payslipsRes.ok) {
      return json({ error: 'Failed to fetch payslips from Sage' }, 502)
    }
    const payslipsData = await payslipsRes.json()
    const rawSlips = payslipsData?.$items || []

    // Load InflowHR employees for this company to match by email
    const { data: inflowEmployees } = await sb
      .from('employees')
      .select('id, email')
      .eq('company_id', company_id)
    const emailToInflowId: Record<string, string> = {}
    for (const e of (inflowEmployees || [])) {
      if (e.email) emailToInflowId[e.email.toLowerCase()] = e.id
    }

    // Parse payslips with full breakdown
    const payslips = rawSlips.map((s: Record<string, unknown>) => {
      const employee = s.employee as Record<string, unknown> || {}
      const employeeEmail = ((employee.email as string) || '').toLowerCase()
      const inflowEmployeeId = employeeEmail ? emailToInflowId[employeeEmail] : null

      const grossPay = Number(s.gross_pay || 0)
      const taxDeducted = Number(s.tax_deducted || 0)
      const employeeNi = Number(s.employee_ni || 0)
      const employerNi = Number(s.employer_ni || 0)
      const studentLoan = Number(s.student_loan || 0)
      const netPay = Number(s.net_pay || 0)
      const employerPension = Number(s.employer_pension || 0)
      const totalReimbursements = Number(s.additions || 0)

      const deductionItems = (s.deduction_lines as { description: string; amount: number }[] || [])
      const deductions = deductionItems.map((d: { description: string; amount: number }) => ({
        name: d.description || 'Deduction',
        amount: Number(d.amount || 0),
      }))

      return {
        payslip_id: s.id as string,
        sage_employee_id: employee.id as string || '',
        inflow_employee_id: inflowEmployeeId,
        first_name: (employee.first_name as string) || '',
        last_name: (employee.last_name as string) || '',
        email: employeeEmail || null,
        total_earnings: grossPay,
        gross_earnings: grossPay,
        net_pay: netPay,
        tax: taxDeducted,
        employee_ni: employeeNi,
        employer_ni: employerNi,
        student_loan: studentLoan,
        deductions,
        total_reimbursements: totalReimbursements,
        employer_pension: employerPension,
        payment_method: '',
      }
    })

    // Upsert matched payslips into the payslips table so employees see them
    const periodStart = latestRun.period_start?.split('T')[0]
    const periodEnd = latestRun.period_end?.split('T')[0]
    const paymentDate = latestRun.payment_date?.split('T')[0]

    for (const ps of payslips) {
      if (!ps.inflow_employee_id) continue

      const totalDeductions = ps.deductions.reduce((sum: number, d: { amount: number }) => sum + d.amount, 0)
      const ref = `SAGE-${ps.payslip_id}`

      const { data: existing } = await sb
        .from('payslips')
        .select('id')
        .eq('reference_number', ref)
        .eq('company_id', company_id)
        .maybeSingle()

      const row = {
        employee_id: ps.inflow_employee_id,
        company_id: company_id,
        reference_number: ref,
        pay_period_start: periodStart,
        pay_period_end: periodEnd,
        gross_pay: ps.total_earnings,
        tax: ps.tax,
        national_insurance: ps.employee_ni,
        pension: totalDeductions,
        other_deductions: 0,
        adjustments: ps.total_reimbursements,
        net_pay: ps.net_pay,
        payment_date: paymentDate,
        status: 'paid',
        source: 'sage',
        xero_payslip_id: ps.payslip_id,
      }

      if (existing) {
        await sb.from('payslips').update(row).eq('id', existing.id)
      } else {
        await sb.from('payslips').insert(row)
      }
    }

    const payRunData = {
      id: latestRun.id,
      period_start: latestRun.period_start,
      period_end: latestRun.period_end,
      payment_date: latestRun.payment_date,
      status: latestRun.status || 'completed',
    }

    // Cache the response and update sync timestamp
    await sb.from('sage_integrations').update({
      last_sync_at: new Date().toISOString(),
      sync_status: 'connected',
      sync_error: null,
      cached_pay_run: payRunData,
      cached_payslips: payslips,
      updated_at: new Date().toISOString(),
    }).eq('company_id', company_id)

    return json({ payRun: payRunData, payslips })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
})
