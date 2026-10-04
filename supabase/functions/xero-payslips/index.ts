import { getSupabase, getValidXeroToken, corsHeaders, json } from '../_shared/xero.ts'

const XERO_PAYROLL_UK = 'https://api.xero.com/payroll.xro/1.0'
const XERO_PAYROLL_AU = 'https://api.xero.com/payroll.xro/2.0'

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

    // Try UK Payroll API first, fall back to AU if tenant is AU
    let baseUrl = XERO_PAYROLL_UK
    let payRunsRes = await fetch(`${baseUrl}/PayRuns`, { headers })
    if (!payRunsRes.ok) {
      const errText = await payRunsRes.text()
      if (errText.includes('AU Customer') || errText.includes('ValidationException')) {
        baseUrl = XERO_PAYROLL_AU
        payRunsRes = await fetch(`${baseUrl}/PayRuns`, { headers })
        if (!payRunsRes.ok) {
          const auErrText = await payRunsRes.text()
          return json({ error: 'Failed to fetch pay runs from Xero', detail: auErrText }, 502)
        }
      } else {
        return json({ error: 'Failed to fetch pay runs from Xero', detail: errText }, 502)
      }
    }

    const payRunsBody = await payRunsRes.json()
    const payRuns = payRunsBody.PayRuns || payRunsBody.payRuns || []
    if (!payRuns.length) return json({ payRun: null, payslips: [] })

    payRuns.sort((a: Record<string, string>, b: Record<string, string>) => {
      const aDate = a.PayRunPeriodEndDate || a.periodEndDate || a.payRunPeriodEndDate || ''
      const bDate = b.PayRunPeriodEndDate || b.periodEndDate || b.payRunPeriodEndDate || ''
      return bDate.localeCompare(aDate)
    })

    const completedRun = payRuns.find((r: Record<string, string>) => {
      const status = (r.PayRunStatus || r.payRunStatus || '').toUpperCase()
      return status === 'POSTED'
    }) || payRuns[0]

    const payRunId = completedRun.PayRunID || completedRun.payRunID
    if (!payRunId) return json({ error: 'No valid pay run found' }, 404)

    // Fetch payslips for this pay run (endpoint casing differs: UK=Payslips, AU=PaySlips)
    const payslipListUrl = baseUrl === XERO_PAYROLL_UK
      ? `${baseUrl}/Payslips?PayRunID=${payRunId}`
      : `${baseUrl}/PaySlips?PayRunID=${payRunId}`
    const payslipsRes = await fetch(payslipListUrl, { headers })
    if (!payslipsRes.ok) {
      const errText = await payslipsRes.text()
      return json({ error: 'Failed to fetch payslips from Xero', detail: errText }, 502)
    }
    const payslipsBody = await payslipsRes.json()
    const rawSlips = payslipsBody.Payslips || payslipsBody.paySlips || []

    // Fetch each payslip individually for full breakdown
    const detailedSlips = []
    for (const slip of rawSlips) {
      const slipId = slip.PayslipID || slip.paySlipID || slip.payslipID
      if (!slipId) continue
      const slipDetailUrl = baseUrl === XERO_PAYROLL_UK
        ? `${baseUrl}/Payslips/${slipId}`
        : `${baseUrl}/PaySlips/${slipId}`
      const detailRes = await fetch(slipDetailUrl, { headers })
      if (detailRes.ok) {
        const detailBody = await detailRes.json()
        const detail = detailBody.Payslip || detailBody.paySlip || (detailBody.Payslips && detailBody.Payslips[0]) || slip
        detailedSlips.push(detail)
      } else {
        detailedSlips.push(slip)
      }
    }

    // Fetch Xero employees to get email addresses for matching
    const xeroEmployees: Record<string, string> = {}
    let empPage = 1
    while (true) {
      const empRes = await fetch(`${baseUrl}/Employees?page=${empPage}`, { headers })
      if (!empRes.ok) break
      const empData = await empRes.json()
      const employees = empData.Employees || empData.employees || []
      if (!employees.length) break
      for (const e of employees) {
        const eId = e.EmployeeID || e.employeeID
        const eEmail = e.Email || e.email
        if (eId && eEmail) {
          xeroEmployees[eId] = eEmail.toLowerCase()
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

    // Parse payslips — handle both UK PascalCase and AU camelCase field names
    const payslips = detailedSlips.map((s: Record<string, unknown>) => {
      const earningsLines = (s.EarningsLines || s.earningsLines || []) as { EarningsType?: string; earningsType?: string; Amount?: number; amount?: number }[]
      const deductionLines = (s.DeductionLines || s.deductionLines || []) as { DeductionType?: string; deductionType?: string; DisplayName?: string; displayName?: string; Amount?: number; amount?: number }[]
      const taxLines = (s.TaxLines || s.taxLines || s.employeeTaxLines || []) as { Description?: string; description?: string; TaxType?: string; taxType?: string; Amount?: number; amount?: number; Percentage?: number }[]
      const reimbursementLines = (s.ReimbursementLines || s.reimbursementLines || []) as { Description?: string; description?: string; DisplayName?: string; displayName?: string; Amount?: number; amount?: number }[]

      const paye = taxLines
        .filter(t => {
          const desc = (t.Description || t.description || t.TaxType || t.taxType || '').toUpperCase()
          return desc.includes('PAYE') || desc.includes('TAX')
        })
        .reduce((sum, t) => sum + (t.Amount ?? t.amount ?? 0), 0)

      const employeeNI = taxLines
        .filter(t => {
          const desc = (t.Description || t.description || t.TaxType || t.taxType || '').toUpperCase()
          return desc.includes('EMPLOYEE') && desc.includes('NATIONAL INSURANCE') || desc.includes('EMPLOYEE NI')
        })
        .reduce((sum, t) => sum + (t.Amount ?? t.amount ?? 0), 0)

      const studentLoan = taxLines
        .filter(t => {
          const desc = (t.Description || t.description || t.TaxType || t.taxType || '').toUpperCase()
          return desc.includes('STUDENT LOAN')
        })
        .reduce((sum, t) => sum + (t.Amount ?? t.amount ?? 0), 0)

      const totalDeductions = deductionLines.reduce((sum, d) => sum + (d.Amount ?? d.amount ?? 0), 0)

      const totalReimbursements = (s.TotalReimbursements ?? s.totalReimbursements ??
        reimbursementLines.reduce((sum, r) => sum + (r.Amount ?? r.amount ?? 0), 0)) as number

      const xeroEmpId = (s.EmployeeID || s.employeeID) as string
      const xeroEmail = xeroEmployees[xeroEmpId] || null
      const inflowEmployeeId = xeroIdToInflowId[xeroEmpId]
        || (xeroEmail ? emailToInflowId[xeroEmail] : null)

      return {
        payslip_id: (s.PayslipID || s.paySlipID || s.payslipID) as string,
        xero_employee_id: xeroEmpId,
        inflow_employee_id: inflowEmployeeId,
        first_name: (s.FirstName || s.firstName) as string,
        last_name: (s.LastName || s.lastName) as string,
        email: xeroEmail,
        total_earnings: (s.TotalEarnings ?? s.totalEarnings ?? 0) as number,
        gross_earnings: (s.GrossEarnings ?? s.grossEarnings ?? 0) as number,
        net_pay: (s.NetPay ?? s.totalPay ?? s.netPay ?? 0) as number,
        tax: paye,
        employee_ni: employeeNI,
        employer_ni: 0,
        student_loan: studentLoan,
        deductions: deductionLines.map(d => ({ name: d.DisplayName || d.displayName || d.DeductionType || d.deductionType || '', amount: d.Amount ?? d.amount ?? 0 })),
        reimbursements: reimbursementLines.map(r => ({ name: r.DisplayName || r.displayName || r.Description || r.description || '', amount: r.Amount ?? r.amount ?? 0 })),
        total_reimbursements: totalReimbursements,
        employer_pension: totalDeductions,
        employer_pension_lines: deductionLines.map(d => ({ name: d.DisplayName || d.displayName || d.DeductionType || d.deductionType || '', amount: d.Amount ?? d.amount ?? 0 })),
        payment_method: (s.PaymentMethod || s.paymentMethod || '') as string,
      }
    })

    // Upsert matched payslips into the payslips table so employees see them
    const periodStart = (completedRun.PayRunPeriodStartDate || completedRun.periodStartDate || completedRun.payRunPeriodStartDate || '')?.split('T')[0]
    const periodEnd = (completedRun.PayRunPeriodEndDate || completedRun.periodEndDate || completedRun.payRunPeriodEndDate || '')?.split('T')[0]
    const paymentDate = (completedRun.PaymentDate || completedRun.paymentDate || '')?.split('T')[0]

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
        pension: ps.employer_pension,
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
      id: payRunId,
      period_start: completedRun.PayRunPeriodStartDate || completedRun.periodStartDate || completedRun.payRunPeriodStartDate,
      period_end: completedRun.PayRunPeriodEndDate || completedRun.periodEndDate || completedRun.payRunPeriodEndDate,
      payment_date: completedRun.PaymentDate || completedRun.paymentDate,
      status: completedRun.PayRunStatus || completedRun.payRunStatus,
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
    return json({ error: (err as Error).message }, 500)
  }
})
