import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token'
const XERO_PAYROLL_V2 = 'https://api.xero.com/payroll.xro/2.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://app.inflowhr.com',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function getSupabase() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
}

function getXeroEnv() {
  const clientId = Deno.env.get('XERO_CLIENT_ID')
  const clientSecret = Deno.env.get('XERO_CLIENT_SECRET')
  const redirectUri = Deno.env.get('XERO_REDIRECT_URI')
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Missing XERO_CLIENT_ID, XERO_CLIENT_SECRET, or XERO_REDIRECT_URI env vars')
  }
  return { clientId, clientSecret, redirectUri }
}

async function getValidXeroToken(companyId: string): Promise<{
  accessToken: string
  tenantId: string
} | null> {
  const sb = getSupabase()
  const { data: row } = await sb
    .from('xero_integrations')
    .select('access_token, refresh_token, expires_at, tenant_id')
    .eq('company_id', companyId)
    .single()

  if (!row?.access_token || !row?.tenant_id) return null

  if (row.expires_at && new Date(row.expires_at) > new Date(Date.now() + 60_000)) {
    return { accessToken: row.access_token, tenantId: row.tenant_id }
  }

  if (!row.refresh_token) return null
  const { clientId, clientSecret } = getXeroEnv()

  const res = await fetch(XERO_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + btoa(`${clientId}:${clientSecret}`),
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: row.refresh_token,
    }),
  })

  if (!res.ok) {
    await sb.from('xero_integrations').update({
      sync_status: 'error',
      sync_error: 'Token refresh failed — reconnect to Xero',
      updated_at: new Date().toISOString(),
    }).eq('company_id', companyId)
    return null
  }

  const tokens = await res.json()
  const expiresAt = new Date(Date.now() + (tokens.expires_in || 1800) * 1000).toISOString()

  await sb.from('xero_integrations').update({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || row.refresh_token,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  }).eq('company_id', companyId)

  return { accessToken: tokens.access_token, tenantId: row.tenant_id }
}

function extractDate(val: string | undefined | null): string {
  if (!val) return ''
  return val.split('T')[0]
}

function getPayRunField(r: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    if (r[k]) return String(r[k])
  }
  return ''
}

function getPayRunPeriodStart(r: Record<string, unknown>): string {
  return extractDate(getPayRunField(r, 'periodStartDate', 'PayRunPeriodStartDate', 'payRunPeriodStartDate'))
}

function getPayRunPeriodEnd(r: Record<string, unknown>): string {
  return extractDate(getPayRunField(r, 'periodEndDate', 'PayRunPeriodEndDate', 'payRunPeriodEndDate'))
}

function getPayRunStatus(r: Record<string, unknown>): string {
  return getPayRunField(r, 'payRunStatus', 'PayRunStatus').toUpperCase()
}

function getPayRunId(r: Record<string, unknown>): string {
  return getPayRunField(r, 'payRunID', 'PayRunID')
}

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

    const { company_id, worker_types, period_start, period_end } = await req.json()
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

    // Fetch pay runs from Xero UK Payroll v2
    const payRunsRes = await fetch(`${XERO_PAYROLL_V2}/PayRuns`, { headers })
    if (!payRunsRes.ok) {
      const errText = await payRunsRes.text()
      return json({ error: 'Failed to fetch pay runs from Xero', detail: errText }, 502)
    }

    const payRunsBody = await payRunsRes.json()
    const payRuns = payRunsBody.payRuns || payRunsBody.PayRuns || []
    if (!payRuns.length) return json({ payRun: null, payslips: [] })

    // Sort by period end date descending to find the most recent
    payRuns.sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
      return getPayRunPeriodEnd(b).localeCompare(getPayRunPeriodEnd(a))
    })

    // Build a summary of available pay runs for error messages
    function availablePayRunsSummary(): string {
      return payRuns.slice(0, 5).map((r: Record<string, unknown>) =>
        `${getPayRunPeriodStart(r)} to ${getPayRunPeriodEnd(r)} (${getPayRunStatus(r)})`
      ).join('; ')
    }

    let selectedRun: Record<string, unknown> | null = null

    if (period_start && period_end) {
      const reqStart = extractDate(period_start)
      const reqEnd = extractDate(period_end)

      // Exact match on period dates first
      selectedRun = payRuns.find((r: Record<string, unknown>) => {
        return getPayRunPeriodStart(r) === reqStart && getPayRunPeriodEnd(r) === reqEnd
      }) || null

      // Overlapping periods fallback (Xero period contains or overlaps our period)
      if (!selectedRun) {
        selectedRun = payRuns.find((r: Record<string, unknown>) => {
          const rStart = getPayRunPeriodStart(r)
          const rEnd = getPayRunPeriodEnd(r)
          if (!rStart || !rEnd) return false
          return rStart <= reqEnd && rEnd >= reqStart
        }) || null
      }

      if (!selectedRun) {
        return json({
          error: `No Xero pay run found for period ${reqStart} to ${reqEnd}. Available pay runs: ${availablePayRunsSummary()}. Create a pay run in Xero for this period first.`,
        }, 404)
      }

      const status = getPayRunStatus(selectedRun)
      if (status !== 'POSTED' && status !== 'DRAFT') {
        return json({
          error: `Xero pay run for ${reqStart} to ${reqEnd} has status "${status}". The pay run must be Posted or Draft to sync payslips. Process and post the pay run in Xero first.`,
        }, 400)
      }
    } else {
      // Legacy fallback: no period dates provided — grab most recent POSTED, then DRAFT
      selectedRun = payRuns.find((r: Record<string, unknown>) => getPayRunStatus(r) === 'POSTED') || null
      if (!selectedRun) {
        selectedRun = payRuns.find((r: Record<string, unknown>) => getPayRunStatus(r) === 'DRAFT') || null
      }
      if (!selectedRun) {
        return json({
          error: `No Posted or Draft pay run found in Xero. Available pay runs: ${availablePayRunsSummary()}. Post or finalise a pay run in Xero first.`,
        }, 404)
      }
    }

    const payRunId = getPayRunId(selectedRun)
    if (!payRunId) return json({ error: 'No valid pay run ID found' }, 404)

    // Fetch pay run detail to get payslip IDs
    const payRunDetailRes = await fetch(`${XERO_PAYROLL_V2}/PayRuns/${payRunId}`, { headers })
    if (!payRunDetailRes.ok) {
      const errText = await payRunDetailRes.text()
      return json({ error: 'Failed to fetch pay run detail from Xero', detail: errText }, 502)
    }
    const payRunDetail = await payRunDetailRes.json()
    const payRunData = payRunDetail.payRun || payRunDetail.PayRun || selectedRun
    const paySlipRefs = payRunData.paySlips || payRunData.PaySlips || []

    // Fetch each payslip individually for full breakdown
    const detailedSlips = []
    for (const ref of paySlipRefs) {
      const slipId = ref.paySlipID || ref.payslipID || ref.PayslipID || ref.PaySlipID
      if (!slipId) continue
      const detailRes = await fetch(`${XERO_PAYROLL_V2}/Payslips/${slipId}`, { headers })
      if (detailRes.ok) {
        const detailBody = await detailRes.json()
        const detail = detailBody.paySlip || detailBody.Payslip
          || (detailBody.paySlips && detailBody.paySlips[0])
          || (detailBody.Payslips && detailBody.Payslips[0])
          || ref
        detailedSlips.push(detail)
      } else {
        detailedSlips.push(ref)
      }
    }

    // Fetch Xero employees to get email addresses for matching
    const xeroEmployees: Record<string, string> = {}
    let empPage = 1
    while (true) {
      const empRes = await fetch(`${XERO_PAYROLL_V2}/Employees?page=${empPage}`, { headers })
      if (!empRes.ok) break
      const empData = await empRes.json()
      const employees = empData.employees || empData.Employees || []
      if (!employees.length) break
      for (const e of employees) {
        const eId = e.employeeID || e.EmployeeID
        const eEmail = e.email || e.Email
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
      .select('id, email, xero_employee_id, employment_category, contract_type')
      .eq('company_id', company_id)
    const xeroIdToInflowId: Record<string, string> = {}
    const emailToInflowId: Record<string, string> = {}
    const inflowEmployeeMap: Record<string, { employment_category: string | null; contract_type: string | null }> = {}
    for (const e of (inflowEmployees || [])) {
      if (e.xero_employee_id) xeroIdToInflowId[e.xero_employee_id] = e.id
      if (e.email) emailToInflowId[e.email.toLowerCase()] = e.id
      inflowEmployeeMap[e.id] = { employment_category: e.employment_category, contract_type: e.contract_type }
    }

    // Parse payslips — handle both camelCase (v2) and PascalCase field names
    const payslips = detailedSlips.map((s: Record<string, unknown>) => {
      const earningsLines = (s.earningsLines || s.EarningsLines || []) as { earningsType?: string; EarningsType?: string; amount?: number; Amount?: number }[]
      const deductionLines = (s.deductionLines || s.DeductionLines || []) as { deductionType?: string; DeductionType?: string; displayName?: string; DisplayName?: string; amount?: number; Amount?: number }[]
      const taxLines = (s.taxLines || s.TaxLines || s.employeeTaxLines || []) as { description?: string; Description?: string; taxType?: string; TaxType?: string; amount?: number; Amount?: number; percentage?: number; Percentage?: number }[]
      const reimbursementLines = (s.reimbursementLines || s.ReimbursementLines || []) as { description?: string; Description?: string; displayName?: string; DisplayName?: string; amount?: number; Amount?: number }[]

      const paye = taxLines
        .filter(t => {
          const desc = (t.description || t.Description || t.taxType || t.TaxType || '').toUpperCase()
          return desc.includes('PAYE') || desc.includes('TAX')
        })
        .reduce((sum, t) => sum + (t.amount ?? t.Amount ?? 0), 0)

      const employeeNI = taxLines
        .filter(t => {
          const desc = (t.description || t.Description || t.taxType || t.TaxType || '').toUpperCase()
          return (desc.includes('EMPLOYEE') && desc.includes('NATIONAL INSURANCE')) || desc.includes('EMPLOYEE NI')
        })
        .reduce((sum, t) => sum + (t.amount ?? t.Amount ?? 0), 0)

      const studentLoan = taxLines
        .filter(t => {
          const desc = (t.description || t.Description || t.taxType || t.TaxType || '').toUpperCase()
          return desc.includes('STUDENT LOAN')
        })
        .reduce((sum, t) => sum + (t.amount ?? t.Amount ?? 0), 0)

      const totalDeductions = deductionLines.reduce((sum, d) => sum + (d.amount ?? d.Amount ?? 0), 0)

      const totalReimbursements = (s.totalReimbursements ?? s.TotalReimbursements ??
        reimbursementLines.reduce((sum, r) => sum + (r.amount ?? r.Amount ?? 0), 0)) as number

      const xeroEmpId = (s.employeeID || s.EmployeeID) as string
      const xeroEmail = xeroEmployees[xeroEmpId] || null
      const inflowEmployeeId = xeroIdToInflowId[xeroEmpId]
        || (xeroEmail ? emailToInflowId[xeroEmail] : null)

      return {
        payslip_id: (s.paySlipID || s.payslipID || s.PayslipID || s.PaySlipID) as string,
        xero_employee_id: xeroEmpId,
        inflow_employee_id: inflowEmployeeId,
        first_name: (s.firstName || s.FirstName) as string,
        last_name: (s.lastName || s.LastName) as string,
        email: xeroEmail,
        total_earnings: (s.totalEarnings ?? s.TotalEarnings ?? 0) as number,
        gross_earnings: (s.grossEarnings ?? s.GrossEarnings ?? 0) as number,
        net_pay: (s.netPay ?? s.totalPay ?? s.NetPay ?? 0) as number,
        tax: paye,
        employee_ni: employeeNI,
        employer_ni: 0,
        student_loan: studentLoan,
        deductions: deductionLines.map(d => ({ name: d.displayName || d.DisplayName || d.deductionType || d.DeductionType || '', amount: d.amount ?? d.Amount ?? 0 })),
        reimbursements: reimbursementLines.map(r => ({ name: r.displayName || r.DisplayName || r.description || r.Description || '', amount: r.amount ?? r.Amount ?? 0 })),
        total_reimbursements: totalReimbursements,
        employer_pension: totalDeductions,
        employer_pension_lines: deductionLines.map(d => ({ name: d.displayName || d.DisplayName || d.deductionType || d.DeductionType || '', amount: d.amount ?? d.Amount ?? 0 })),
        payment_method: (s.paymentMethod || s.PaymentMethod || '') as string,
      }
    })

    // Extract period dates from the pay run
    const periodStart = getPayRunPeriodStart(payRunData)
    const periodEnd = getPayRunPeriodEnd(payRunData)
    const paymentDate = extractDate(getPayRunField(payRunData, 'paymentDate', 'PaymentDate'))

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

    // Filter payslips to only employees matching the requested worker types
    const workerTypeFilter = Array.isArray(worker_types) && worker_types.length > 0 ? worker_types as string[] : null
    function matchesWorkerType(employeeId: string): boolean {
      if (!workerTypeFilter) return true
      const emp = inflowEmployeeMap[employeeId]
      if (!emp) return true
      for (const wt of workerTypeFilter) {
        if (wt === 'employed' && emp.employment_category !== 'shift_worker') return true
        if (wt === 'shift_worker' && emp.employment_category === 'shift_worker' && emp.contract_type !== 'Zero hours shift worker') return true
        if (wt === 'zero_hours' && emp.employment_category === 'shift_worker' && emp.contract_type === 'Zero hours shift worker') return true
      }
      return false
    }

    // Upsert matched payslips into the payslips table so employees see them
    let upsertedCount = 0
    let unmatchedCount = 0
    let filteredCount = 0
    for (const ps of payslips) {
      if (!ps.inflow_employee_id) {
        unmatchedCount++
        continue
      }
      if (!matchesWorkerType(ps.inflow_employee_id)) {
        filteredCount++
        continue
      }

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
      upsertedCount++
    }

    const payRunResult = {
      id: payRunId,
      period_start: periodStart,
      period_end: periodEnd,
      payment_date: paymentDate,
      status: payRunData.payRunStatus || payRunData.PayRunStatus,
    }

    // GDPR audit log
    await sb.from('payroll_audit_log').insert({
      company_id,
      user_id: user.id,
      action: 'Xero Payslip Sync',
      detail: `Synced ${upsertedCount} payslips from Xero pay run ${payRunId}. Period: ${periodStart} to ${periodEnd}. Unmatched: ${unmatchedCount}. Filtered out (other worker types): ${filteredCount}. Worker types: ${workerTypeFilter ? workerTypeFilter.join(', ') : 'all'}. Data pulled: gross, tax, NI, deductions, net pay.`,
      status: 'success',
    })

    // Cache the response and update sync timestamp
    await sb.from('xero_integrations').update({
      last_sync_at: new Date().toISOString(),
      sync_status: 'connected',
      sync_error: null,
      cached_pay_run: payRunResult,
      cached_payslips: payslips,
      updated_at: new Date().toISOString(),
    }).eq('company_id', company_id)

    return json({
      payRun: payRunResult,
      payslips,
      upserted: upsertedCount,
      unmatched: unmatchedCount,
      filtered: filteredCount,
    })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
})
