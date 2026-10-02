import { getSupabase, getValidXeroToken, corsHeaders, json } from '../_shared/xero.ts'

const XERO_PAYROLL = 'https://api.xero.com/payroll.xro/2.0'

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

    const creds = await getValidXeroToken(company_id)
    if (!creds) return json({ error: 'Xero not connected — please connect first' }, 400)

    const headers = {
      Authorization: `Bearer ${creds.accessToken}`,
      'xero-tenant-id': creds.tenantId,
      Accept: 'application/json',
    }

    // Fetch pay runs
    const payRunsRes = await fetch(`${XERO_PAYROLL}/PayRuns?page=1`, { headers })
    if (!payRunsRes.ok) {
      console.error('PayRuns fetch failed:', await payRunsRes.text())
      return json({ error: 'Failed to fetch pay runs from Xero' }, 502)
    }
    const payRuns = (await payRunsRes.json()).payRuns || []
    if (!payRuns.length) return json({ payRun: null, payslips: [] })

    payRuns.sort((a: Record<string, string>, b: Record<string, string>) =>
      (b.periodEndDate || '').localeCompare(a.periodEndDate || '')
    )
    const completedRun = payRuns.find((r: Record<string, string>) => r.payRunStatus === 'Posted') || payRuns[0]

    // Fetch payslips for this pay run
    const payslipsRes = await fetch(`${XERO_PAYROLL}/PaySlips?PayRunID=${completedRun.payRunID}`, { headers })
    if (!payslipsRes.ok) {
      console.error('Payslips fetch failed:', await payslipsRes.text())
      return json({ error: 'Failed to fetch payslips from Xero' }, 502)
    }
    const rawSlips = (await payslipsRes.json()).paySlips || []

    // Fetch Xero employees to get email addresses for matching
    const xeroEmployees: Record<string, string> = {}
    let empPage = 1
    while (true) {
      const empRes = await fetch(`${XERO_PAYROLL}/Employees?page=${empPage}`, { headers })
      if (!empRes.ok) break
      const empData = await empRes.json()
      const employees = empData.employees || []
      if (!employees.length) break
      for (const e of employees) {
        if (e.employeeID && e.email) {
          xeroEmployees[e.employeeID] = e.email.toLowerCase()
        }
      }
      if (employees.length < 100) break
      empPage++
    }

    // Load InflowHR employees for this company to match by xero_employee_id or email
    const { data: inflowEmployees } = await sb
      .from('employees')
      .select('id, email, xero_employee_id')
      .eq('company_id', company_id)
    const xeroIdToInflowId: Record<string, string> = {}
    const emailToInflowId: Record<string, string> = {}
    for (const e of (inflowEmployees || [])) {
      if (e.xero_employee_id) xeroIdToInflowId[e.xero_employee_id] = e.id
      if (e.email) emailToInflowId[e.email.toLowerCase()] = e.id
    }

    // Parse payslips with full breakdown
    const payslips = rawSlips.map((s: Record<string, unknown>) => {
      const empTaxLines = (s.employeeTaxLines || []) as { description: string; amount: number }[]
      const errTaxLines = (s.employerTaxLines || []) as { description: string; amount: number }[]
      const deductionLines = (s.deductionLines || []) as { displayName: string; amount: number }[]
      const benefitLines = (s.benefitLines || []) as { displayName: string; amount: number }[]
      const reimbursementLines = (s.reimbursementLines || []) as { displayName: string; amount: number }[]

      const paye = empTaxLines.find(t => t.description === 'PAYE')?.amount ?? 0
      const employeeNI = empTaxLines.find(t => t.description?.includes('Employee National Insurance'))?.amount ?? 0
      const employerNI = errTaxLines.find(t => t.description?.includes('Employer National Insurance'))?.amount ?? 0
      const studentLoan = empTaxLines.find(t => t.description?.includes('Student Loan'))?.amount ?? 0
      const totalReimbursements = (s.totalReimbursements as number) ?? 0

      const xeroEmpId = s.employeeID as string
      const xeroEmail = xeroEmployees[xeroEmpId] || null
      const inflowEmployeeId = xeroIdToInflowId[xeroEmpId]
        || (xeroEmail ? emailToInflowId[xeroEmail] : null)

      return {
        payslip_id: s.paySlipID as string,
        xero_employee_id: s.employeeID as string,
        inflow_employee_id: inflowEmployeeId,
        first_name: s.firstName as string,
        last_name: s.lastName as string,
        email: xeroEmail,
        total_earnings: (s.totalEarnings as number) ?? 0,
        gross_earnings: (s.grossEarnings as number) ?? 0,
        net_pay: (s.totalPay as number) ?? 0,
        tax: paye,
        employee_ni: employeeNI,
        employer_ni: employerNI,
        student_loan: studentLoan,
        deductions: deductionLines.map(d => ({ name: d.displayName, amount: d.amount })),
        reimbursements: reimbursementLines.map(r => ({ name: r.displayName, amount: r.amount })),
        total_reimbursements: totalReimbursements,
        employer_pension: benefitLines.reduce((sum, b) => sum + (b.amount || 0), 0),
        employer_pension_lines: benefitLines.map(b => ({ name: b.displayName, amount: b.amount })),
        payment_method: (s.paymentMethod as string) ?? '',
      }
    })

    // Upsert matched payslips into the payslips table so employees see them
    const periodStart = completedRun.periodStartDate?.split('T')[0]
    const periodEnd = completedRun.periodEndDate?.split('T')[0]
    const paymentDate = completedRun.paymentDate?.split('T')[0]

    // Store xero_employee_id on InflowHR employees matched by email (one-time mapping)
    const mappingsToStore: { inflowId: string; xeroId: string }[] = []
    for (const ps of payslips) {
      if (!ps.inflow_employee_id || !ps.xero_employee_id) continue
      if (!xeroIdToInflowId[ps.xero_employee_id]) {
        mappingsToStore.push({ inflowId: ps.inflow_employee_id, xeroId: ps.xero_employee_id })
        xeroIdToInflowId[ps.xero_employee_id] = ps.inflow_employee_id
      }
    }
    for (const m of mappingsToStore) {
      await sb.from('employees').update({ xero_employee_id: m.xeroId }).eq('id', m.inflowId)
    }

    for (const ps of payslips) {
      if (!ps.inflow_employee_id) continue

      const totalDeductions = ps.deductions.reduce((s: number, d: { amount: number }) => s + d.amount, 0)
      const ref = `XERO-${ps.payslip_id}`

      await sb.from('payslips').upsert({
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
        source: 'xero',
        xero_payslip_id: ps.payslip_id,
      }, { onConflict: 'reference_number,company_id' })
    }

    const payRunData = {
      id: completedRun.payRunID,
      period_start: completedRun.periodStartDate,
      period_end: completedRun.periodEndDate,
      payment_date: completedRun.paymentDate,
      status: completedRun.payRunStatus,
    }

    // Cache the response and update sync timestamp
    await sb.from('xero_integrations').update({
      last_sync_at: new Date().toISOString(),
      sync_status: 'connected',
      sync_error: null,
      cached_pay_run: payRunData,
      cached_payslips: payslips,
      updated_at: new Date().toISOString(),
    }).eq('company_id', company_id)

    return json({ payRun: payRunData, payslips })
  } catch (err) {
    console.error('xero-payslips error:', err)
    return json({ error: (err as Error).message }, 500)
  }
})
