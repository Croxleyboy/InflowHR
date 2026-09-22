import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { formatDate } from '../../lib/formatters'
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

const PAGE_SIZE = 30

// UK 2024/25 tax & NI brackets applied to monthly taxable pay (annual salary after sacrifice)
function calcMonthlyTax(annualTaxable: number): number {
  const personalAllowance = annualTaxable > 125140 ? 0 : Math.max(0, 12570 - Math.max(0, (annualTaxable - 100000) / 2))
  const taxable = Math.max(0, annualTaxable - personalAllowance)
  let tax = 0
  if (taxable > 0) tax += Math.min(taxable, 37700) * 0.2
  if (taxable > 37700) tax += Math.min(taxable - 37700, 87440) * 0.4
  if (taxable > 125140) tax += (taxable - 125140) * 0.45
  return Math.round((tax / 12) * 100) / 100
}

function calcMonthlyNI(annualGross: number): number {
  const monthlyGross = annualGross / 12
  const primaryThreshold = 1048 // £12,570/yr monthly
  const upperEarningsLimit = 4189 // £50,270/yr monthly
  let ni = 0
  if (monthlyGross > primaryThreshold) {
    ni += Math.min(monthlyGross - primaryThreshold, upperEarningsLimit - primaryThreshold) * 0.08
  }
  if (monthlyGross > upperEarningsLimit) {
    ni += (monthlyGross - upperEarningsLimit) * 0.02
  }
  return Math.round(ni * 100) / 100
}

interface Payslip {
  id: number
  reference_number: string
  pay_period_start: string
  pay_period_end: string
  gross_pay: number
  tax: number
  national_insurance: number
  pension: number
  other_deductions: number
  net_pay: number
  payment_date: string
  status: string
  tax_code: string
  annual_salary: number
  payroll_id: string
  overtime: number
  adjustments: number
  monthly_deductions: number
  bank_account: string
  payroll_office: string
  source: string
  xero_payslip_id: string | null
  employee: { id: string; first_name: string; last_name: string } | null
}

interface XeroIntegration {
  id: string
  company_id: string
  sync_status: string
  sync_error: string | null
  last_sync_at: string | null
  payslip_source: 'inflowhr' | 'xero'
}

interface SageIntegration {
  id: string
  company_id: string
  sync_status: string
  last_sync_at: string | null
  payslip_source: 'inflowhr' | 'sage'
  last_upload_at: string | null
  last_upload_filename: string | null
}

interface XeroPayslipRow {
  payslip_id: string
  xero_employee_id: string
  inflow_employee_id: string | null
  first_name: string
  last_name: string
  email: string | null
  total_earnings: number
  gross_earnings: number
  net_pay: number
  tax: number
  employee_ni: number
  employer_ni: number
  student_loan: number
  deductions: { name: string; amount: number }[]
  reimbursements: { name: string; amount: number }[]
  total_reimbursements: number
  employer_pension: number
  employer_pension_lines: { name: string; amount: number }[]
  payment_method: string
}

interface XeroPayRun {
  id: string
  period_start: string
  period_end: string
  payment_date: string
  status: string
}

interface Employee {
  id: string
  first_name: string
  last_name: string
  job_title: string
  department: string
  annual_salary: number | null
  tax_code: string | null
  payroll_id: string | null
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getPayDay(year: number, month: number, mode: 'end' | 'start' | 'custom', customDay: number): Date {
  if (mode === 'start') return new Date(year, month, 1)
  if (mode === 'custom') {
    const lastDay = new Date(year, month + 1, 0).getDate()
    return new Date(year, month, Math.min(customDay, lastDay))
  }
  return new Date(year, month + 1, 0)
}

function getFYRange(fyStartMonth: number) {
  const now = new Date()
  const currentMonth = now.getMonth() + 1
  const startYear = currentMonth >= fyStartMonth ? now.getFullYear() : now.getFullYear() - 1
  const startDate = new Date(startYear, fyStartMonth - 1, 1)
  const endDate = new Date(startYear + 1, fyStartMonth - 1, 0)
  return { startDate, endDate, startYear }
}

function getFYMonths(fyStartMonth: number): { year: number; month: number; label: string }[] {
  const { startYear } = getFYRange(fyStartMonth)
  const months: { year: number; month: number; label: string }[] = []
  for (let i = 0; i < 12; i++) {
    const m = (fyStartMonth - 1 + i) % 12
    const y = startYear + (fyStartMonth - 1 + i >= 12 ? 1 : 0)
    months.push({ year: y, month: m, label: `${MONTH_NAMES[m]} ${y}` })
  }
  return months
}

export default function AdminPayroll() {
  const { selectedCompanyId, selectedCompany } = useAdminCompany()
  const { showError, showSuccess } = useToast()
  const { session } = useAuth()
  const [payslips, setPayslips] = useState<Payslip[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'payslips' | 'schedule' | 'employees' | 'time_breakdown' | 'analytics' | 'xero_pay' | 'sage_pay'>('payslips')
  const [filterEmployee, setFilterEmployee] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<Record<string, any>>({})
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [generating, setGenerating] = useState(false)
  const [empBenefits, setEmpBenefits] = useState<Record<string, { title: string; enrolled_at: string; monthly_cost: number }[]>>({})
  const [showAddSingle, setShowAddSingle] = useState(false)
  const [singleEmpId, setSingleEmpId] = useState('')
  const [singleMonth, setSingleMonth] = useState('')

  // Xero integration state
  const [xeroIntegration, setXeroIntegration] = useState<XeroIntegration | null>(null)
  const [xeroSyncing, setXeroSyncing] = useState(false)
  const [xeroLivePayslips, setXeroLivePayslips] = useState<XeroPayslipRow[]>([])
  const [xeroPayRun, setXeroPayRun] = useState<XeroPayRun | null>(null)
  const [showXeroDisconnectModal, setShowXeroDisconnectModal] = useState(false)

  // Sage integration state
  const [sageIntegration, setSageIntegration] = useState<SageIntegration | null>(null)
  const [sageUploading, setSageUploading] = useState(false)
  const [sageUploadResult, setSageUploadResult] = useState<{
    matched: { employee_name: string; employee_number: string; net_pay: number; period: string }[]
    unmatched: { employee_name: string; employee_number: string }[]
    total_parsed: number
  } | null>(null)

  // Employee Pay tab month navigation
  const [empPayMonthIdx, setEmpPayMonthIdx] = useState(0)

  const [enabledFeatures, setEnabledFeatures] = useState({ timesheets: false, shifts: false, legal_timesheets: false })
  const [tbPeriodStart, setTbPeriodStart] = useState(() => {
    const d = new Date(); d.setDate(1); return localDateStr(d)
  })
  const [tbPeriodEnd, setTbPeriodEnd] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() + 1, 0); return localDateStr(d)
  })
  const [tbData, setTbData] = useState<Record<string, { shiftHrs: number; shiftEntries: any[]; tsHrs: number; tsEntries: any[]; legalHrs: number; legalEntries: any[] }>>({})
  const [tbLoading, setTbLoading] = useState(false)
  const [tbExpandedEmp, setTbExpandedEmp] = useState<string | null>(null)
  const [tbFilterEmp, setTbFilterEmp] = useState('')

  const [anPeriodStart, setAnPeriodStart] = useState(() => {
    const d = new Date(); d.setDate(1); return localDateStr(d)
  })
  const [anPeriodEnd, setAnPeriodEnd] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() + 1, 0); return localDateStr(d)
  })
  const [anLoading, setAnLoading] = useState(false)
  const [anData, setAnData] = useState<{
    empMetrics: { id: string; name: string; dept: string; weeklyHrs: number; tsHrs: number; shiftHrs: number; legalHrs: number; totalHrs: number; contractedPeriodHrs: number }[]
    projectBreakdown: { project: string; customer: string; hours: number }[]
    legalClientBreakdown: { client: string; matter: string; hours: number }[]
    weeklySubmissions: { week: string; count: number; hours: number }[]
  }>({ empMetrics: [], projectBreakdown: [], legalClientBreakdown: [], weeklySubmissions: [] })

  const fyStartMonth = selectedCompany?.fy_start_month || 4
  const fyMonths = useMemo(() => getFYMonths(fyStartMonth), [fyStartMonth])
  const fyRange = useMemo(() => getFYRange(fyStartMonth), [fyStartMonth])

  // Set empPayMonthIdx to current month on load
  useEffect(() => {
    const now = new Date()
    const idx = fyMonths.findIndex(m => m.year === now.getFullYear() && m.month === now.getMonth())
    if (idx >= 0) setEmpPayMonthIdx(idx)
  }, [fyMonths])

  useEffect(() => { if (selectedCompanyId) loadAll() }, [selectedCompanyId])

  useEffect(() => {
    if (!selectedCompanyId) return
    supabase.from('company_features').select('feature_key, is_enabled').eq('company_id', selectedCompanyId)
      .in('feature_key', ['timesheets', 'shifts', 'legal_timesheets']).then(({ data }) => {
        const map: Record<string, boolean> = { timesheets: false, shifts: false, legal_timesheets: false }
        data?.forEach(r => { if (r.feature_key in map) map[r.feature_key] = r.is_enabled })
        setEnabledFeatures(map as any)
      })
  }, [selectedCompanyId])

  async function loadAll() {
    setLoading(true)
    const fyStart = localDateStr(fyRange.startDate)
    const fyEnd = localDateStr(fyRange.endDate)
    const [pRes, eRes, xRes, sRes] = await Promise.all([
      supabase.from('payslips').select('*, employee:employees!payslips_employee_id_fkey(id, first_name, last_name)').eq('company_id', selectedCompanyId).gte('pay_period_start', fyStart).lte('pay_period_start', fyEnd).order('payment_date', { ascending: false }),
      supabase.from('employees').select('id, first_name, last_name, job_title, department, annual_salary, tax_code, payroll_id').eq('company_id', selectedCompanyId).eq('is_active', true).order('last_name'),
      supabase.from('xero_integrations').select('id, company_id, sync_status, sync_error, last_sync_at, payslip_source, cached_pay_run, cached_payslips').eq('company_id', selectedCompanyId).maybeSingle(),
      supabase.from('sage_integrations').select('id, company_id, sync_status, last_sync_at, payslip_source, last_upload_at, last_upload_filename').eq('company_id', selectedCompanyId).maybeSingle(),
    ])
    setPayslips((pRes.data as Payslip[]) || [])
    setEmployees((eRes.data as Employee[]) || [])
    const xero = xRes.data as (XeroIntegration & { cached_pay_run?: XeroPayRun; cached_payslips?: XeroPayslipRow[] }) | null
    setXeroIntegration(xero)
    if (xero?.cached_pay_run) setXeroPayRun(xero.cached_pay_run)
    if (xero?.cached_payslips?.length) setXeroLivePayslips(xero.cached_payslips)
    setSageIntegration(sRes.data as SageIntegration | null)
    setLoading(false)
  }

  function startEdit(p: Payslip) {
    setEditingId(p.id)
    setEditForm({
      gross_pay: p.gross_pay, tax: p.tax, national_insurance: p.national_insurance,
      pension: p.pension, other_deductions: p.other_deductions, net_pay: p.net_pay,
      status: p.status, tax_code: p.tax_code, overtime: p.overtime,
      adjustments: p.adjustments, annual_salary: p.annual_salary,
      monthly_deductions: p.monthly_deductions || 0,
      payroll_id: p.payroll_id || '', bank_account: p.bank_account || '',
      payroll_office: p.payroll_office || '',
    })
  }

  async function saveEdit(id: number) {
    const gross = Number(editForm.gross_pay)
    const ot = Number(editForm.overtime) || 0
    const adj = Number(editForm.adjustments) || 0
    const tax = Number(editForm.tax)
    const ni = Number(editForm.national_insurance)
    const pen = Number(editForm.pension)
    const other = Number(editForm.other_deductions)
    const benefitSacrifice = Number(editForm.monthly_deductions) || 0
    const net = (gross - benefitSacrifice) + ot + adj - tax - ni - pen - other

    const payslip = payslips.find(p => p.id === id)
    const wasPaid = payslip?.status === 'paid'

    const { error } = await supabase.from('payslips').update({ ...editForm, net_pay: net }).eq('id', id)
    if (error) { showError('Failed to save payslip: ' + error.message); return }

    // If editing a paid payslip, mark the month's schedule as needing re-download
    if (wasPaid && payslip) {
      await markMonthEdited(payslip.pay_period_start)
    }

    setEditingId(null)
    loadAll()
    showSuccess('Payslip saved')
  }

  async function markMonthEdited(payPeriodStart: string) {
    const d = new Date(payPeriodStart + 'T00:00:00')
    const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const existing = payrollScheduleStatuses[monthKey]
    if (existing === 'completed') {
      const updated = { ...payrollScheduleStatuses, [monthKey]: 'edited' }
      setPayrollScheduleStatuses(updated)
      await supabase.from('xero_integrations').update({
        cached_pay_run: { ...( xeroIntegration as any)?.cached_pay_run, schedule_statuses: updated },
      }).eq('company_id', selectedCompanyId)
    }
  }

  async function deletePayslip(id: number) {
    if (!confirm('Delete this payslip?')) return
    const { error } = await supabase.from('payslips').delete().eq('id', id)
    if (error) { showError('Failed to delete payslip: ' + error.message); return }
    setPayslips(prev => prev.filter(p => p.id !== id))
    showSuccess('Payslip deleted')
  }

  // Payroll schedule statuses stored in xero_integrations.cached_pay_run.schedule_statuses
  const [payrollScheduleStatuses, setPayrollScheduleStatuses] = useState<Record<string, string>>({})
  const [payDayMode, setPayDayMode] = useState<'end' | 'start' | 'custom'>('end')
  const [customPayDay, setCustomPayDay] = useState(28)
  const [submitLeadDays, setSubmitLeadDays] = useState(5)
  const [paySettingsSaving, setPaySettingsSaving] = useState(false)

  useEffect(() => {
    if (!selectedCompanyId) return
    supabase.from('xero_integrations').select('cached_pay_run').eq('company_id', selectedCompanyId).maybeSingle()
      .then(({ data }) => {
        const cpr = (data?.cached_pay_run as any) || {}
        setPayrollScheduleStatuses(cpr.schedule_statuses || {})
        if (cpr.pay_day_mode) setPayDayMode(cpr.pay_day_mode)
        if (cpr.custom_pay_day) setCustomPayDay(cpr.custom_pay_day)
        if (cpr.submit_lead_days !== undefined) setSubmitLeadDays(cpr.submit_lead_days)
      })
  }, [selectedCompanyId])

  async function savePayRunData(patch: Record<string, any>) {
    const { data: existing } = await supabase.from('xero_integrations')
      .select('id, cached_pay_run').eq('company_id', selectedCompanyId).maybeSingle()
    const merged = { ...(existing?.cached_pay_run as any || {}), ...patch }
    if (existing) {
      await supabase.from('xero_integrations').update({ cached_pay_run: merged }).eq('id', existing.id)
    } else {
      await supabase.from('xero_integrations').insert({
        company_id: selectedCompanyId,
        cached_pay_run: merged,
        sync_status: 'not_connected',
      })
    }
  }

  async function saveScheduleStatuses(statuses: Record<string, string>) {
    setPayrollScheduleStatuses(statuses)
    await savePayRunData({ schedule_statuses: statuses })
  }

  async function savePaySettings() {
    setPaySettingsSaving(true)
    await savePayRunData({ pay_day_mode: payDayMode, custom_pay_day: customPayDay, submit_lead_days: submitLeadDays })
    setPaySettingsSaving(false)
    showSuccess('Payroll settings saved')
  }

  async function generateNextPayroll() {
    setGenerating(true)

    const now = new Date()
    const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const currentPayslips = sourcePayslips.filter(p => p.pay_period_start.startsWith(currentKey))

    if (currentPayslips.length === 0) {
      showError(`${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()} must have payslips before generating next month. Use "Add Payslip" to create them.`)
      setGenerating(false)
      return
    }

    // Target is exactly 1 month ahead of the current calendar month
    const nextDate = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    const nextYear = nextDate.getFullYear()
    const nextMonth = nextDate.getMonth()
    const nextKey = `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}`

    // Check we're within the FY
    if (nextDate > fyRange.endDate) {
      showError(`${MONTH_NAMES[nextMonth]} ${nextYear} is outside the current financial year`)
      setGenerating(false)
      return
    }

    // Check next month doesn't already have payslips
    const existingNext = sourcePayslips.filter(p => p.pay_period_start.startsWith(nextKey))
    if (existingNext.length > 0) {
      showError(`Payslips for ${MONTH_NAMES[nextMonth]} ${nextYear} already exist`)
      setGenerating(false)
      return
    }

    const startDate = new Date(nextYear, nextMonth, 1)
    const endOfMonth = new Date(nextYear, nextMonth + 1, 0)
    const paymentDate = new Date(endOfMonth)
    paymentDate.setDate(paymentDate.getDate() - 3)
    const batch = Date.now().toString(36).slice(-4)

    // Fetch active benefit enrollments for all employees
    const { data: allEnrollments } = await supabase
      .from('benefit_enrollments')
      .select('employee_id, enrolled_at, benefit_type:benefit_types(monthly_cost, is_enabled)')
      .eq('company_id', selectedCompanyId)
      .is('option_id', null)
    const benefitCostMap: Record<string, number> = {}
    if (allEnrollments) {
      for (const row of allEnrollments as any[]) {
        const bt = row.benefit_type
        if (!bt?.is_enabled || !bt.monthly_cost) continue
        const enrolledAt = new Date(row.enrolled_at)
        if (enrolledAt > endOfMonth) continue
        benefitCostMap[row.employee_id] = (benefitCostMap[row.employee_id] || 0) + (bt.monthly_cost || 0)
      }
    }

    // Auto-generate payroll IDs for employees missing one
    let nextPayrollSeq = 0
    const { data: existingIds } = await supabase.from('employees').select('payroll_id').eq('company_id', selectedCompanyId).not('payroll_id', 'is', null)
    if (existingIds) {
      for (const r of existingIds) {
        const m = (r.payroll_id || '').match(/^PAY-(\d+)$/)
        if (m) nextPayrollSeq = Math.max(nextPayrollSeq, parseInt(m[1], 10))
      }
    }

    const errors: string[] = []
    let flaggedCount = 0
    for (let idx = 0; idx < employees.length; idx++) {
      const emp = employees[idx]
      const existing = sourcePayslips.find(p => p.employee?.id === emp.id && p.pay_period_start.startsWith(nextKey))
      if (existing) continue

      if (!emp.payroll_id) {
        nextPayrollSeq++
        emp.payroll_id = `PAY-${String(nextPayrollSeq).padStart(4, '0')}`
        await supabase.from('employees').update({ payroll_id: emp.payroll_id }).eq('id', emp.id)
      }

      const latest = sourcePayslips.find(p => p.employee?.id === emp.id)
      const salary = emp.annual_salary || latest?.annual_salary || 42000
      const gross = Math.round((salary / 12) * 100) / 100
      const benefitDeductions = Math.round((benefitCostMap[emp.id] || 0) * 100) / 100
      const adjustedGross = gross - benefitDeductions
      const annualAfterSacrifice = salary - (benefitDeductions * 12)
      const tax = latest ? Number(latest.tax) : calcMonthlyTax(annualAfterSacrifice)
      const ni = latest ? Number(latest.national_insurance) : calcMonthlyNI(annualAfterSacrifice)
      const pension = latest ? Number(latest.pension) : Math.round(gross * 0.05 * 100) / 100

      const missing: string[] = []
      if (!emp.annual_salary && !latest?.annual_salary) missing.push('Annual salary')
      if (!emp.tax_code && !latest?.tax_code) missing.push('Tax code')
      const isFlagged = missing.length > 0

      const { error } = await supabase.from('payslips').insert({
        employee_id: emp.id,
        company_id: selectedCompanyId,
        reference_number: `PAY-${nextKey}-${batch}-${String(idx + 1).padStart(3, '0')}`,
        pay_period_start: localDateStr(startDate),
        pay_period_end: localDateStr(endOfMonth),
        gross_pay: gross, tax, national_insurance: ni, pension,
        other_deductions: 0,
        monthly_deductions: benefitDeductions,
        net_pay: adjustedGross - tax - ni - pension,
        payment_date: localDateStr(paymentDate),
        status: isFlagged ? 'flagged' : 'draft',
        tax_code: emp.tax_code || latest?.tax_code || '1257L',
        annual_salary: salary,
        payroll_id: emp.payroll_id,
        payroll_office: isFlagged ? `Missing: ${missing.join(', ')}` : '',
      })
      if (error) errors.push(`${emp.first_name} ${emp.last_name}: ${error.message}`)
      if (isFlagged) flaggedCount++
    }
    setGenerating(false)
    if (errors.length > 0) {
      showError(`Failed to generate ${errors.length} payslip(s): ${errors[0]}`)
    } else if (flaggedCount > 0) {
      showSuccess(`Payroll generated for ${MONTH_NAMES[nextMonth]} ${nextYear} — ${flaggedCount} payslip(s) flagged for review (missing pay details)`)
    } else {
      showSuccess(`Payroll generated for ${MONTH_NAMES[nextMonth]} ${nextYear}`)
    }
    loadAll()
  }

  async function addSinglePayslip() {
    if (!singleEmpId || !singleMonth || !selectedCompanyId) return
    setSaving(true)

    const [y, m] = singleMonth.split('-').map(Number)
    const monthKey = `${y}-${String(m).padStart(2, '0')}`

    const existing = sourcePayslips.find(p =>
      p.employee?.id === singleEmpId && p.pay_period_start.startsWith(monthKey)
    )
    if (existing) {
      showError('A payslip already exists for this employee in this month')
      setSaving(false)
      return
    }

    const emp = employees.find(e => e.id === singleEmpId)
    if (!emp) { showError('Employee not found'); setSaving(false); return }

    // Auto-generate payroll ID if missing
    if (!emp.payroll_id) {
      let maxSeq = 0
      const { data: existingIds } = await supabase.from('employees').select('payroll_id').eq('company_id', selectedCompanyId).not('payroll_id', 'is', null)
      if (existingIds) {
        for (const r of existingIds) {
          const match = (r.payroll_id || '').match(/^PAY-(\d+)$/)
          if (match) maxSeq = Math.max(maxSeq, parseInt(match[1], 10))
        }
      }
      emp.payroll_id = `PAY-${String(maxSeq + 1).padStart(4, '0')}`
      await supabase.from('employees').update({ payroll_id: emp.payroll_id }).eq('id', emp.id)
    }

    const startDate = new Date(y, m - 1, 1)
    const endOfMonth = new Date(y, m, 0)
    const paymentDate = new Date(endOfMonth)
    paymentDate.setDate(paymentDate.getDate() - 3)

    const latest = sourcePayslips.find(p => p.employee?.id === emp.id)
    const salary = emp.annual_salary || latest?.annual_salary || 42000
    const gross = Math.round((salary / 12) * 100) / 100

    // Fetch active benefit enrollments for this employee
    let benefitDeductions = 0
    const { data: empEnrollments } = await supabase
      .from('benefit_enrollments')
      .select('enrolled_at, benefit_type:benefit_types(monthly_cost, is_enabled)')
      .eq('company_id', selectedCompanyId)
      .eq('employee_id', emp.id)
      .is('option_id', null)
    if (empEnrollments) {
      for (const row of empEnrollments as any[]) {
        const bt = row.benefit_type
        if (!bt?.is_enabled || !bt.monthly_cost) continue
        const enrolledAt = new Date(row.enrolled_at)
        if (enrolledAt > endOfMonth) continue
        benefitDeductions += bt.monthly_cost || 0
      }
    }
    benefitDeductions = Math.round(benefitDeductions * 100) / 100
    const adjustedGross = gross - benefitDeductions
    const annualAfterSacrifice = salary - (benefitDeductions * 12)
    const tax = latest ? Number(latest.tax) : calcMonthlyTax(annualAfterSacrifice)
    const ni = latest ? Number(latest.national_insurance) : calcMonthlyNI(annualAfterSacrifice)
    const pension = latest ? Number(latest.pension) : Math.round(gross * 0.05 * 100) / 100

    const missing: string[] = []
    if (!emp.annual_salary && !latest?.annual_salary) missing.push('Annual salary')
    if (!emp.tax_code && !latest?.tax_code) missing.push('Tax code')
    const isFlagged = missing.length > 0

    const existingCount = sourcePayslips.filter(p => p.pay_period_start.startsWith(monthKey)).length
    const batch = Date.now().toString(36).slice(-4)

    const { error } = await supabase.from('payslips').insert({
      employee_id: emp.id,
      company_id: selectedCompanyId,
      reference_number: `PAY-${monthKey}-${batch}-${String(existingCount + 1).padStart(3, '0')}`,
      pay_period_start: localDateStr(startDate),
      pay_period_end: localDateStr(endOfMonth),
      gross_pay: gross, tax, national_insurance: ni, pension,
      other_deductions: 0,
      monthly_deductions: benefitDeductions,
      net_pay: adjustedGross - tax - ni - pension,
      payment_date: localDateStr(paymentDate),
      status: isFlagged ? 'flagged' : 'draft',
      tax_code: emp.tax_code || latest?.tax_code || '1257L',
      annual_salary: salary,
      payroll_id: emp.payroll_id,
      payroll_office: isFlagged ? `Missing: ${missing.join(', ')}` : '',
    })
    if (error) { showError('Failed to add payslip: ' + error.message); setSaving(false); return }
    showSuccess(isFlagged
      ? `Payslip added for ${emp.first_name} ${emp.last_name} — FLAGGED: missing ${missing.join(', ')}`
      : `Payslip added for ${emp.first_name} ${emp.last_name} — ${MONTH_NAMES[m - 1]} ${y}`)
    setShowAddSingle(false)
    setSingleEmpId('')
    setSingleMonth('')
    setSaving(false)
    loadAll()
  }

  const [saving, setSaving] = useState(false)

  const activeSource: 'inflowhr' | 'xero' | 'sage' =
    xeroIntegration?.payslip_source === 'xero' ? 'xero'
    : sageIntegration?.payslip_source === 'sage' ? 'sage'
    : 'inflowhr'

  const xeroConnected = xeroIntegration?.sync_status === 'connected'
  const sageConnected = sageIntegration?.sync_status === 'connected'
  const sourcePayslips = useMemo(() => {
    if (activeSource === 'xero') return payslips.filter(p => p.source === 'xero')
    if (activeSource === 'sage') return payslips.filter(p => p.source === 'sage')
    return payslips.filter(p => p.source !== 'xero' && p.source !== 'sage')
  }, [payslips, activeSource])

  const filtered = useMemo(() => {
    const base = sourcePayslips.filter(p => {
      if (filterStatus && p.status !== filterStatus) return false
      if (filterEmployee && p.employee && `${p.employee.first_name} ${p.employee.last_name}` !== filterEmployee) return false
      return true
    })
    return search.trim()
      ? base.filter(p => {
          const q = search.toLowerCase()
          const empName = p.employee ? `${p.employee.first_name} ${p.employee.last_name}` : ''
          return (
            empName.toLowerCase().includes(q) ||
            (p.status || '').toLowerCase().includes(q) ||
            (p.reference_number || '').toLowerCase().includes(q) ||
            (p.payroll_id || '').toLowerCase().includes(q) ||
            (p.tax_code || '').toLowerCase().includes(q)
          )
        })
      : base
  }, [filterStatus, filterEmployee, sourcePayslips, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  useEffect(() => { setPage(1) }, [search])

  const empNames = useMemo(() => {
    const names = new Set<string>()
    payslips.forEach(p => { if (p.employee) names.add(`${p.employee.first_name} ${p.employee.last_name}`) })
    return Array.from(names).sort()
  }, [payslips])

  const stats = useMemo(() => {
    const monthsWithPayslips = new Set<string>()
    sourcePayslips.forEach(p => {
      const d = new Date(p.pay_period_start + 'T00:00:00')
      monthsWithPayslips.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    })
    return {
      total: sourcePayslips.length,
      flagged: sourcePayslips.filter(p => p.status === 'flagged').length,
      draft: sourcePayslips.filter(p => p.status === 'draft').length,
      processed: sourcePayslips.filter(p => p.status === 'processed').length,
      paid: sourcePayslips.filter(p => p.status === 'paid').length,
      totalGross: sourcePayslips.reduce((s, p) => s + Number(p.gross_pay), 0),
      totalNet: sourcePayslips.reduce((s, p) => s + Number(p.net_pay), 0),
      totalTax: sourcePayslips.reduce((s, p) => s + Number(p.tax), 0),
      totalNI: sourcePayslips.reduce((s, p) => s + Number(p.national_insurance), 0),
      totalPension: sourcePayslips.reduce((s, p) => s + Number(p.pension), 0),
      activeEmployees: employees.length,
      monthsProcessed: monthsWithPayslips.size,
      avgGrossPerEmp: employees.length > 0 ? sourcePayslips.reduce((s, p) => s + Number(p.gross_pay), 0) / Math.max(1, sourcePayslips.length) : 0,
    }
  }, [sourcePayslips, employees])

  // Employee Pay tab: payslips for selected month
  const empPayMonth = fyMonths[empPayMonthIdx]
  const empPayPayslips = useMemo(() => {
    if (!empPayMonth) return []
    const key = `${empPayMonth.year}-${String(empPayMonth.month + 1).padStart(2, '0')}`
    return sourcePayslips.filter(p => p.pay_period_start.startsWith(key))
  }, [sourcePayslips, empPayMonth])

  const loadTimeBreakdown = useCallback(async () => {
    if (!selectedCompanyId) return
    setTbLoading(true)
    const result: Record<string, { shiftHrs: number; shiftEntries: any[]; tsHrs: number; tsEntries: any[]; legalHrs: number; legalEntries: any[] }> = {}
    for (const emp of employees) {
      result[emp.id] = { shiftHrs: 0, shiftEntries: [], tsHrs: 0, tsEntries: [], legalHrs: 0, legalEntries: [] }
    }

    const queries: Promise<void>[] = []

    if (enabledFeatures.timesheets) {
      queries.push((async () => {
        const { data } = await supabase.from('timesheets')
          .select('employee_id, date, end_date, start_time, end_time, location, role, status, hours')
          .eq('company_id', selectedCompanyId).neq('status', 'rejected')
          .gte('date', tbPeriodStart).lte('date', tbPeriodEnd)
        if (data) {
          for (const row of data) {
            if (!result[row.employee_id]) continue
            const hrs = Number(row.hours) || 0
            result[row.employee_id].tsHrs += hrs
            result[row.employee_id].tsEntries.push(row)
          }
        }
      })())
    }

    if (enabledFeatures.shifts) {
      queries.push((async () => {
        const { data } = await supabase.from('shift_assignments')
          .select('employee_id, date, shift_templates(name, start_time, end_time, break_minutes), rotas(status)')
          .eq('company_id', selectedCompanyId)
          .gte('date', tbPeriodStart).lte('date', tbPeriodEnd)
        if (data) {
          for (const row of data as any[]) {
            if (!result[row.employee_id]) continue
            const rota = row.rotas as any
            if (rota?.status === 'draft') continue
            const tmpl = row.shift_templates as any
            if (!tmpl) continue
            const startMins = parseInt(tmpl.start_time?.split(':')[0]) * 60 + parseInt(tmpl.start_time?.split(':')[1] || '0')
            const endMins = parseInt(tmpl.end_time?.split(':')[0]) * 60 + parseInt(tmpl.end_time?.split(':')[1] || '0')
            const hrs = Math.max(0, (endMins - startMins - (tmpl.break_minutes || 0)) / 60)
            result[row.employee_id].shiftHrs += hrs
            result[row.employee_id].shiftEntries.push({ ...row, shiftName: tmpl.name, start_time: tmpl.start_time, end_time: tmpl.end_time, breakMins: tmpl.break_minutes, hrs })
          }
        }
      })())
    }

    if (enabledFeatures.legal_timesheets) {
      queries.push((async () => {
        const { data } = await supabase.from('legal_timesheet_entries')
          .select('employee_id, date, duration_hrs, task_code, status, client_id, matter_id')
          .eq('company_id', selectedCompanyId).neq('status', 'rejected')
          .gte('date', tbPeriodStart).lte('date', tbPeriodEnd)
        if (data) {
          for (const row of data) {
            if (!result[row.employee_id]) continue
            const hrs = Number(row.duration_hrs) || 0
            result[row.employee_id].legalHrs += hrs
            result[row.employee_id].legalEntries.push(row)
          }
        }
      })())
    }

    await Promise.all(queries)
    setTbData(result)
    setTbLoading(false)
  }, [selectedCompanyId, tbPeriodStart, tbPeriodEnd, employees, enabledFeatures])

  useEffect(() => { if (tab === 'time_breakdown' && employees.length > 0) loadTimeBreakdown() }, [tab, loadTimeBreakdown])
  useEffect(() => { if (tab === 'analytics' && employees.length > 0) loadAnalytics() }, [tab, anPeriodStart, anPeriodEnd, employees, enabledFeatures])

  const loadAnalytics = useCallback(async () => {
    if (!selectedCompanyId) return
    setAnLoading(true)

    const empMap: Record<string, { name: string; dept: string; weeklyHrs: number; tsHrs: number; shiftHrs: number; legalHrs: number }> = {}
    for (const emp of employees) {
      empMap[emp.id] = { name: `${emp.first_name} ${emp.last_name}`, dept: emp.department || '—', weeklyHrs: 0, tsHrs: 0, shiftHrs: 0, legalHrs: 0 }
    }

    const { data: empHrsData } = await supabase.from('employees').select('id, weekly_hours').eq('company_id', selectedCompanyId).eq('is_active', true)
    if (empHrsData) empHrsData.forEach((e: any) => {
      if (empMap[e.id]) empMap[e.id].weeklyHrs = Number(e.weekly_hours) || 37.5
    })

    const projectMap: Record<string, { customer: string; hours: number }> = {}
    const legalMap: Record<string, { matter: string; hours: number }> = {}
    const weekMap: Record<string, { count: number; hours: number }> = {}

    if (enabledFeatures.timesheets) {
      const { data } = await supabase.from('timesheets')
        .select('employee_id, date, hours, project:projects(name, customer:customers(name))')
        .eq('company_id', selectedCompanyId).neq('status', 'rejected')
        .gte('date', anPeriodStart).lte('date', anPeriodEnd)
      if (data) for (const r of data as any[]) {
        if (empMap[r.employee_id]) empMap[r.employee_id].tsHrs += Number(r.hours) || 0
        const pName = r.project?.name || 'No Project'
        const cName = r.project?.customer?.name || 'No Customer'
        const pk = `${cName}|||${pName}`
        if (!projectMap[pk]) projectMap[pk] = { customer: cName, hours: 0 }
        projectMap[pk].hours += Number(r.hours) || 0
        const weekStart = new Date(r.date + 'T00:00:00')
        weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1)
        const wk = localDateStr(weekStart)
        if (!weekMap[wk]) weekMap[wk] = { count: 0, hours: 0 }
        weekMap[wk].count++
        weekMap[wk].hours += Number(r.hours) || 0
      }
    }

    if (enabledFeatures.shifts) {
      const { data } = await supabase.from('shift_assignments')
        .select('employee_id, date, shift_templates(start_time, end_time, break_minutes), rotas(status)')
        .eq('company_id', selectedCompanyId)
        .gte('date', anPeriodStart).lte('date', anPeriodEnd)
      if (data) for (const r of data as any[]) {
        if (r.rotas?.status === 'draft') continue
        const tmpl = r.shift_templates as any
        if (!tmpl || !empMap[r.employee_id]) continue
        const startMins = parseInt(tmpl.start_time?.split(':')[0]) * 60 + parseInt(tmpl.start_time?.split(':')[1] || '0')
        const endMins = parseInt(tmpl.end_time?.split(':')[0]) * 60 + parseInt(tmpl.end_time?.split(':')[1] || '0')
        empMap[r.employee_id].shiftHrs += Math.max(0, (endMins - startMins - (tmpl.break_minutes || 0)) / 60)
      }
    }

    if (enabledFeatures.legal_timesheets) {
      const { data } = await supabase.from('legal_timesheet_entries')
        .select('employee_id, date, duration_hrs, client:legal_clients!legal_timesheet_entries_client_id_fkey(name), matter:legal_matters!legal_timesheet_entries_matter_id_fkey(name)')
        .eq('company_id', selectedCompanyId).neq('status', 'rejected')
        .gte('date', anPeriodStart).lte('date', anPeriodEnd)
      if (data) for (const r of data as any[]) {
        if (empMap[r.employee_id]) empMap[r.employee_id].legalHrs += Number(r.duration_hrs) || 0
        const cn = r.client?.name || 'No Client'
        const mn = r.matter?.name || 'No Matter'
        const lk = `${cn}|||${mn}`
        if (!legalMap[lk]) legalMap[lk] = { matter: mn, hours: 0 }
        legalMap[lk].hours += Number(r.duration_hrs) || 0
      }
    }

    const startD = new Date(anPeriodStart + 'T00:00:00')
    const endD = new Date(anPeriodEnd + 'T00:00:00')
    const weeks = Math.max(1, (endD.getTime() - startD.getTime()) / (7 * 86400000))

    setAnData({
      empMetrics: Object.entries(empMap).map(([id, e]) => ({
        id, name: e.name, dept: e.dept, weeklyHrs: e.weeklyHrs,
        tsHrs: e.tsHrs, shiftHrs: e.shiftHrs, legalHrs: e.legalHrs,
        totalHrs: e.tsHrs + e.shiftHrs + e.legalHrs,
        contractedPeriodHrs: e.weeklyHrs * weeks,
      })),
      projectBreakdown: Object.entries(projectMap).map(([k, v]) => ({ project: k.split('|||')[1], customer: v.customer, hours: v.hours })).sort((a, b) => b.hours - a.hours),
      legalClientBreakdown: Object.entries(legalMap).map(([k, v]) => ({ client: k.split('|||')[0], matter: v.matter, hours: v.hours })).sort((a, b) => b.hours - a.hours),
      weeklySubmissions: Object.entries(weekMap).map(([w, v]) => ({ week: w, ...v })).sort((a, b) => a.week.localeCompare(b.week)),
    })
    setAnLoading(false)
  }, [selectedCompanyId, anPeriodStart, anPeriodEnd, employees, enabledFeatures])

  function downloadCsv(filename: string, headers: string[], rows: string[][]) {
    const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${(c || '').replace(/"/g, '""')}"`).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
  }

  async function exportLegalCsv() {
    if (!confirm('This export contains employee names and timesheet data.\n\nThis action will be logged. Proceed?')) return
    const { data } = await supabase.from('legal_timesheet_entries')
      .select('employee_id, date, duration_hrs, task_code, narrative, status, client:legal_clients!legal_timesheet_entries_client_id_fkey(name), matter:legal_matters!legal_timesheet_entries_matter_id_fkey(name)')
      .eq('company_id', selectedCompanyId).neq('status', 'rejected')
      .gte('date', anPeriodStart).lte('date', anPeriodEnd)
      .order('date')
    if (!data || data.length === 0) { showError('No legal timesheet data for this period'); return }
    const empLookup: Record<string, string> = {}
    employees.forEach(e => { empLookup[e.id] = `${e.first_name} ${e.last_name}` })
    const rows = (data as any[]).map(r => [
      empLookup[r.employee_id] || r.employee_id,
      formatDate(r.date),
      r.client?.name || '', r.matter?.name || '',
      r.task_code || '', String(Number(r.duration_hrs).toFixed(2)),
      r.narrative || '', r.status,
    ])
    downloadCsv(`legal-timesheets-${anPeriodStart}-to-${anPeriodEnd}.csv`,
      ['Employee', 'Date', 'Client', 'Matter', 'Task Code', 'Hours', 'Narrative', 'Status'], rows)
    showSuccess('Legal timesheets CSV downloaded')
  }

  async function exportShiftsCsv() {
    if (!confirm('This export contains employee names and shift data.\n\nThis action will be logged. Proceed?')) return
    const { data } = await supabase.from('shift_assignments')
      .select('employee_id, date, shift_templates(name, start_time, end_time, break_minutes), rotas(status)')
      .eq('company_id', selectedCompanyId)
      .gte('date', anPeriodStart).lte('date', anPeriodEnd)
    if (!data || data.length === 0) { showError('No shift data for this period'); return }
    const empLookup: Record<string, string> = {}
    employees.forEach(e => { empLookup[e.id] = `${e.first_name} ${e.last_name}` })
    const rows = (data as any[]).filter(r => r.rotas?.status !== 'draft').map(r => {
      const tmpl = r.shift_templates as any
      const startMins = parseInt(tmpl?.start_time?.split(':')[0] || '0') * 60 + parseInt(tmpl?.start_time?.split(':')[1] || '0')
      const endMins = parseInt(tmpl?.end_time?.split(':')[0] || '0') * 60 + parseInt(tmpl?.end_time?.split(':')[1] || '0')
      const hrs = Math.max(0, (endMins - startMins - (tmpl?.break_minutes || 0)) / 60)
      return [
        empLookup[r.employee_id] || r.employee_id,
        formatDate(r.date),
        tmpl?.name || '', tmpl?.start_time?.slice(0, 5) || '', tmpl?.end_time?.slice(0, 5) || '',
        String(tmpl?.break_minutes || 0), String(hrs.toFixed(2)),
      ]
    })
    downloadCsv(`shifts-${anPeriodStart}-to-${anPeriodEnd}.csv`,
      ['Employee', 'Date', 'Shift', 'Start', 'End', 'Break (mins)', 'Hours'], rows)
    showSuccess('Shifts CSV downloaded')
  }

  async function exportAdjustmentsCsv() {
    if (!confirm('This export contains employee payroll adjustment data.\n\nThis action will be logged. Proceed?')) return
    const empLookup: Record<string, string> = {}
    employees.forEach(e => { empLookup[e.id] = `${e.first_name} ${e.last_name}` })
    const rows: string[][] = []

    if (enabledFeatures.shifts) {
      const { data } = await supabase.from('shift_assignments')
        .select('employee_id, date, shift_templates(name, start_time, end_time, break_minutes), rotas(status)')
        .eq('company_id', selectedCompanyId)
        .gte('date', anPeriodStart).lte('date', anPeriodEnd)
      if (data) {
        for (const r of data as any[]) {
          if (r.rotas?.status === 'draft') continue
          const tmpl = r.shift_templates as any
          if (!tmpl) continue
          const startMins = parseInt(tmpl.start_time?.split(':')[0]) * 60 + parseInt(tmpl.start_time?.split(':')[1] || '0')
          const endMins = parseInt(tmpl.end_time?.split(':')[0]) * 60 + parseInt(tmpl.end_time?.split(':')[1] || '0')
          const hrs = Math.max(0, (endMins - startMins - (tmpl.break_minutes || 0)) / 60)
          rows.push([
            empLookup[r.employee_id] || r.employee_id,
            formatDate(r.date), '', 'Shift', tmpl.name,
            '', String(hrs.toFixed(2)), '',
          ])
        }
      }
    }

    const payslipRes = await supabase.from('payslips')
      .select('employee_id, pay_period_start, overtime, adjustments, employee:employees!payslips_employee_id_fkey(first_name, last_name)')
      .eq('company_id', selectedCompanyId)
      .gte('pay_period_start', anPeriodStart).lte('pay_period_start', anPeriodEnd)

    if (payslipRes.data) {
      for (const r of payslipRes.data as any[]) {
        const ot = Number(r.overtime) || 0
        const adj = Number(r.adjustments) || 0
        if (ot === 0 && adj === 0) continue
        const empName = r.employee ? `${r.employee.first_name} ${r.employee.last_name}` : (empLookup[r.employee_id] || r.employee_id)
        const period = new Date(r.pay_period_start + 'T00:00:00').toLocaleDateString('en-GB')
        if (ot !== 0) rows.push([empName, period, '', 'Overtime', '', '', String(ot.toFixed(2)), ''])
        if (adj !== 0) rows.push([empName, period, '', 'Adjustment', '', '', String(adj.toFixed(2)), ''])
      }
    }

    if (rows.length === 0) { showError('No adjustments found for this period'); return }
    downloadCsv(`payroll-adjustments-${anPeriodStart}-to-${anPeriodEnd}.csv`,
      ['Employee', 'Start Date', 'End Date', 'Type', 'Detail', 'Days', 'Amount (£)', 'Notes'], rows)
    showSuccess('Adjustments CSV downloaded')
  }

  // ── Payslip source toggle ──

  async function togglePayslipSource(source: 'inflowhr' | 'xero' | 'sage') {
    if (!selectedCompanyId) return

    if (source === 'inflowhr' && (activeSource === 'xero' || activeSource === 'sage')) {
      setShowXeroDisconnectModal(true)
      return
    }

    if (source === 'xero' && xeroIntegration) {
      const { error } = await supabase.from('xero_integrations').update({ payslip_source: source, updated_at: new Date().toISOString() }).eq('company_id', selectedCompanyId)
      if (error) { showError('Failed to update: ' + error.message); return }
    } else if (source === 'sage' && sageIntegration) {
      const { error } = await supabase.from('sage_integrations').update({ payslip_source: source, updated_at: new Date().toISOString() }).eq('company_id', selectedCompanyId)
      if (error) { showError('Failed to update: ' + error.message); return }
    }
    const label = source === 'xero' ? 'Xero' : source === 'sage' ? 'Sage' : 'InflowHR'
    showSuccess(`Switched to ${label} Payslips`)
    loadAll()
  }

  async function confirmSwitchToInflowHR() {
    if (!selectedCompanyId) return
    setShowXeroDisconnectModal(false)

    if (activeSource === 'xero') {
      await supabase.from('xero_integrations').update({ payslip_source: 'inflowhr', updated_at: new Date().toISOString() }).eq('company_id', selectedCompanyId)
    } else if (activeSource === 'sage') {
      await supabase.from('sage_integrations').update({ payslip_source: 'inflowhr', updated_at: new Date().toISOString() }).eq('company_id', selectedCompanyId)
    }
    showSuccess('Switched to InflowHR Payslips')
    loadAll()
  }

  // ── Payroll Schedule: Submit / Download ──

  async function submitPayroll(monthKey: string) {
    const monthPayslips = sourcePayslips.filter(p => p.pay_period_start.startsWith(monthKey))
    if (monthPayslips.length === 0) {
      showError('No payslips found for this month')
      return
    }

    const [yearStr, monthStr] = monthKey.split('-')
    const monthName = MONTH_NAMES[parseInt(monthStr) - 1]

    // Build CSV rows with all payslip data
    const headers = ['Employee', 'Payroll ID', 'Tax Code', 'Annual Salary', 'Gross Pay', 'Tax', 'National Insurance', 'Pension', 'Other Deductions', 'Monthly Deductions', 'Overtime', 'Adjustments', 'Net Pay', 'Pay Period Start', 'Pay Period End', 'Payment Date', 'Status']
    const rows = monthPayslips.map(p => [
      p.employee ? `${p.employee.first_name} ${p.employee.last_name}` : '—',
      p.payroll_id || '', p.tax_code || '',
      String(Number(p.annual_salary || 0).toFixed(2)),
      String(Number(p.gross_pay).toFixed(2)),
      String(Number(p.tax).toFixed(2)),
      String(Number(p.national_insurance).toFixed(2)),
      String(Number(p.pension).toFixed(2)),
      String(Number(p.other_deductions).toFixed(2)),
      String(Number(p.monthly_deductions || 0).toFixed(2)),
      String(Number(p.overtime || 0).toFixed(2)),
      String(Number(p.adjustments || 0).toFixed(2)),
      String(Number(p.net_pay).toFixed(2)),
      new Date(p.pay_period_start + 'T00:00:00').toLocaleDateString('en-GB'),
      new Date(p.pay_period_end + 'T00:00:00').toLocaleDateString('en-GB'),
      new Date(p.payment_date + 'T00:00:00').toLocaleDateString('en-GB'),
      p.status,
    ])

    downloadCsv(`payroll-${monthKey}-${monthName}.csv`, headers, rows)

    // Mark non-flagged payslips in this month as paid
    const payableSlips = monthPayslips.filter(p => p.status !== 'flagged')
    const flaggedSlips = monthPayslips.filter(p => p.status === 'flagged')
    if (payableSlips.length > 0) {
      await supabase.from('payslips').update({ status: 'paid' }).in('id', payableSlips.map(p => p.id)).eq('company_id', selectedCompanyId)
    }

    // Update schedule status to completed only if no flagged remain
    if (flaggedSlips.length === 0) {
      const updated = { ...payrollScheduleStatuses, [monthKey]: 'completed' }
      await saveScheduleStatuses(updated)
    }

    if (flaggedSlips.length > 0) {
      showSuccess(`${monthName} ${yearStr} payroll downloaded — ${payableSlips.length} marked as paid, ${flaggedSlips.length} flagged payslip(s) excluded (review required)`)
    } else {
      showSuccess(`${monthName} ${yearStr} payroll downloaded and marked as paid`)
    }
    loadAll()
  }

  // ── Xero helpers ──

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const xeroParam = params.get('xero')
    if (xeroParam === 'connected') {
      showSuccess('Connected to Xero successfully')
      window.history.replaceState({}, '', window.location.pathname)
      if (selectedCompanyId) loadAll()
    } else if (xeroParam === 'error') {
      showError(`Xero connection failed: ${params.get('reason') || 'unknown'}`)
      window.history.replaceState({}, '', window.location.pathname)
    }
    const sageParam = params.get('sage')
    if (sageParam === 'connected') {
      showSuccess('Connected to Sage successfully')
      window.history.replaceState({}, '', window.location.pathname)
      if (selectedCompanyId) loadAll()
    } else if (sageParam === 'error') {
      showError(`Sage connection failed: ${params.get('reason') || 'unknown'}`)
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  async function callXeroFunction(fnName: string, body: Record<string, unknown> = {}) {
    if (!session) { showError('Not authenticated'); return null }
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    const res = await fetch(`${supabaseUrl}/functions/v1/${fnName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ company_id: selectedCompanyId, ...body }),
    })
    const data = await res.json()
    if (!res.ok) { showError(data.error || 'Xero request failed'); return null }
    return data
  }

  async function fetchXeroPayslips() {
    setXeroSyncing(true)
    const result = await callXeroFunction('xero-payslips')
    setXeroSyncing(false)
    if (result) {
      setXeroPayRun(result.payRun)
      setXeroLivePayslips(result.payslips || [])
      loadAll()
    }
  }

  async function handleSagePdfUpload(file: File) {
    setSageUploading(true)
    setSageUploadResult(null)
    try {
      let pdfText = ''
      if (file.name.endsWith('.txt')) {
        pdfText = await file.text()
      } else {
        const arrayBuf = await file.arrayBuffer()
        const pdfjsLib = await import('pdfjs-dist')
        pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl
        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuf) }).promise
        const pages: string[] = []
        for (let i = 1; i <= pdf.numPages; i++) {
          const pg = await pdf.getPage(i)
          const tc = await pg.getTextContent()
          let lastY = -1
          const parts: string[] = []
          for (const item of tc.items as any[]) {
            if (!('str' in item)) continue
            const y = Math.round(item.transform?.[5] ?? 0)
            if (lastY >= 0 && Math.abs(y - lastY) > 2) parts.push('\n')
            else if (parts.length > 0) parts.push(' ')
            parts.push(item.str)
            lastY = y
          }
          pages.push(parts.join(''))
        }
        pdfText = pages.join('\n==========================================================\n')
      }

      const token = session?.access_token
      if (!token) { showError('Not authenticated'); setSageUploading(false); return }

      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sage-upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ company_id: selectedCompanyId, pdf_text: pdfText, filename: file.name }),
      })

      const data = await resp.json()
      if (!resp.ok) { showError(data.error || 'Upload failed'); setSageUploading(false); return }

      setSageUploadResult(data)
      showSuccess(`${data.matched.length} payslip(s) imported successfully`)
      loadAll()
    } catch (err: any) {
      showError('Failed to process file: ' + (err.message || 'Unknown error'))
    }
    setSageUploading(false)
  }

  const fyLabel = `FY ${fyRange.startYear}/${fyRange.startYear + 1}`

  return (
    <div className="admin-section">
      {/* Payslip source switch confirmation modal */}
      {showXeroDisconnectModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: 'var(--bg-card, #fff)', borderRadius: 12, padding: 24, maxWidth: 480, width: '90%',
            boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700, color: '#dc2626' }}>Switch to InflowHR Payslips?</h3>
            <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--text, #1a1a2e)', lineHeight: 1.5 }}>
              This will switch employees to see InflowHR payslips only. The {activeSource === 'xero' ? 'Xero' : 'Sage'} integration remains connected — you can switch back at any time.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="admin-btn" onClick={() => setShowXeroDisconnectModal(false)}>Cancel</button>
              <button className="admin-btn admin-btn-danger" onClick={confirmSwitchToInflowHR} style={{ background: '#dc2626', color: '#fff', border: 'none' }}>
                Switch to InflowHR
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="admin-page-header">
        <h2>Payroll Management</h2>
        <p>{stats.activeEmployees} active employees · {stats.total} payslips · {stats.monthsProcessed} months · {fyLabel}</p>
      </div>

      <div className="admin-mini-stats">
        <div className="admin-mini-stat"><span className="admin-mini-value">{stats.activeEmployees}</span><span>Active Employees</span></div>
        <div className="admin-mini-stat"><span className="admin-mini-value">{stats.total}</span><span>Payslips</span></div>
        {stats.flagged > 0 && <div className="admin-mini-stat"><span className="admin-mini-value" style={{color:'#dc2626'}}>{stats.flagged}</span><span>Flagged</span></div>}
        <div className="admin-mini-stat"><span className="admin-mini-value" style={{color:'#ff9800'}}>{stats.draft}</span><span>Draft</span></div>
        <div className="admin-mini-stat"><span className="admin-mini-value" style={{color:'#5b9bd5'}}>{stats.processed}</span><span>Processed</span></div>
        <div className="admin-mini-stat"><span className="admin-mini-value" style={{color:'#43a047'}}>{stats.paid}</span><span>Paid</span></div>
        <div className="admin-mini-stat"><span className="admin-mini-value">£{stats.totalGross.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span><span>Total Gross</span></div>
        <div className="admin-mini-stat"><span className="admin-mini-value">£{stats.totalNet.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span><span>Total Net</span></div>
        <div className="admin-mini-stat"><span className="admin-mini-value">£{stats.totalTax.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span><span>Total Tax</span></div>
      </div>

      <div className="admin-tabs">
        <button className={`admin-tab ${tab === 'payslips' ? 'admin-tab-active' : ''}`} onClick={() => setTab('payslips')}>Payslips</button>
        {xeroConnected && (
          <button className={`admin-tab ${tab === 'xero_pay' ? 'admin-tab-active' : ''}`} onClick={() => setTab('xero_pay')}>Xero Payslips</button>
        )}
        {sageConnected && (
          <button className={`admin-tab ${tab === 'sage_pay' ? 'admin-tab-active' : ''}`} onClick={() => setTab('sage_pay')}>Sage Payslips</button>
        )}
        <button className={`admin-tab ${tab === 'employees' ? 'admin-tab-active' : ''}`} onClick={() => setTab('employees')}>Employee Pay</button>
        <button className={`admin-tab ${tab === 'schedule' ? 'admin-tab-active' : ''}`} onClick={() => setTab('schedule')}>Payroll Schedule</button>
        {(enabledFeatures.timesheets || enabledFeatures.shifts || enabledFeatures.legal_timesheets) && (
          <>
            <button className={`admin-tab ${tab === 'time_breakdown' ? 'admin-tab-active' : ''}`} onClick={() => setTab('time_breakdown')}>Time Breakdown</button>
            <button className={`admin-tab ${tab === 'analytics' ? 'admin-tab-active' : ''}`} onClick={() => setTab('analytics')}>Analytics</button>
          </>
        )}
      </div>

      {tab === 'payslips' && (
        <>
          {(xeroConnected || sageConnected) && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', marginBottom: 12,
              background: 'var(--bg-card, #fff)', borderRadius: 8, border: '1px solid var(--border, #e5e7eb)', flexWrap: 'wrap',
            }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text, #1a1a2e)' }}>Payslip Source:</span>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text, #1a1a2e)' }}>
                <input type="radio" name="payslipSource" checked={activeSource === 'inflowhr'} onChange={() => togglePayslipSource('inflowhr')} />
                <span>InflowHR</span>
              </label>
              {xeroConnected && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text, #1a1a2e)' }}>
                  <input type="radio" name="payslipSource" checked={activeSource === 'xero'} onChange={() => togglePayslipSource('xero')} />
                  <span>Xero</span>
                </label>
              )}
              {sageConnected && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text, #1a1a2e)' }}>
                  <input type="radio" name="payslipSource" checked={activeSource === 'sage'} onChange={() => togglePayslipSource('sage')} />
                  <span>Sage</span>
                </label>
              )}
              <span className="admin-badge admin-badge-approved" style={{ marginLeft: 'auto' }}>
                {activeSource === 'xero' ? 'Xero Active' : activeSource === 'sage' ? 'Sage Active' : 'InflowHR Active'}
              </span>
            </div>
          )}

          <div className="admin-filters" style={{ flexWrap: 'wrap' }}>
            <select value={filterEmployee} onChange={e => setFilterEmployee(e.target.value)} className="admin-select">
              <option value="">All Employees</option>
              {empNames.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="admin-select">
              <option value="">All Statuses</option>
              <option value="flagged">Flagged</option><option value="draft">Draft</option><option value="processed">Processed</option><option value="paid">Paid</option>
            </select>
            {activeSource === 'inflowhr' && (
              <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
                <button className="admin-btn" onClick={() => setShowAddSingle(true)}>
                  + Add Payslip
                </button>
                <button className="admin-btn admin-btn-primary" onClick={generateNextPayroll} disabled={generating}>
                  {generating ? 'Generating...' : '+ Generate Next Month'}
                </button>
              </div>
            )}
          </div>

          {showAddSingle && (
            <div style={{
              padding: 16, marginBottom: 12, background: 'var(--bg-card, #fff)',
              borderRadius: 8, border: '1px solid var(--border, #e5e7eb)',
            }}>
              <h4 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Add Single Payslip</h4>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Employee</label>
                  <select className="admin-select" value={singleEmpId} onChange={e => setSingleEmpId(e.target.value)} style={{ width: '100%' }}>
                    <option value="">Select employee...</option>
                    {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.first_name} {emp.last_name}</option>)}
                  </select>
                </div>
                <div style={{ minWidth: 160 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Month</label>
                  <select className="admin-select" value={singleMonth} onChange={e => setSingleMonth(e.target.value)} style={{ width: '100%' }}>
                    <option value="">Select month...</option>
                    {fyMonths.map(m => {
                      const key = `${m.year}-${String(m.month + 1).padStart(2, '0')}`
                      return <option key={key} value={key}>{m.label}</option>
                    })}
                  </select>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="admin-btn admin-btn-primary" onClick={addSinglePayslip} disabled={!singleEmpId || !singleMonth || saving}>
                    {saving ? 'Adding...' : 'Add Payslip'}
                  </button>
                  <button className="admin-btn" onClick={() => { setShowAddSingle(false); setSingleEmpId(''); setSingleMonth('') }}>Cancel</button>
                </div>
              </div>
              {singleEmpId && singleMonth && (() => {
                const emp = employees.find(e => e.id === singleEmpId)
                const existing = sourcePayslips.find(p => p.employee?.id === singleEmpId && p.pay_period_start.startsWith(singleMonth))
                if (existing) return <p style={{ margin: '8px 0 0', fontSize: 12, color: '#dc2626' }}>A payslip already exists for this employee in this month.</p>
                if (emp) {
                  const salary = emp.annual_salary || 42000
                  return <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-muted, #888)' }}>Will create draft payslip based on annual salary of £{salary.toLocaleString()} (£{(salary / 12).toFixed(2)}/month gross)</p>
                }
                return null
              })()}
            </div>
          )}

          <input
            className="admin-input"
            placeholder="Search payroll..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ maxWidth: 320, marginBottom: 12 }}
          />

          {loading ? <div className="admin-loading">Loading...</div> : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>Ref</th><th>Employee</th><th>Period</th><th>Gross</th><th>Tax</th><th>NI</th><th>Pension</th><th>Net</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {paginated.map(p => (
                    <>
                      <tr key={p.id} className={`${expandedId === p.id ? 'admin-row-active' : ''} ${p.status === 'flagged' ? 'admin-row-flagged' : ''}`}>
                        <td className="admin-td-mono">{p.reference_number}</td>
                        <td>{p.employee ? `${p.employee.first_name} ${p.employee.last_name}` : '—'}</td>
                        <td>{new Date(p.pay_period_start + 'T00:00:00').toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}</td>
                        <td>£{Number(p.gross_pay).toFixed(2)}</td>
                        <td>£{Number(p.tax).toFixed(2)}</td>
                        <td>£{Number(p.national_insurance).toFixed(2)}</td>
                        <td>£{Number(p.pension).toFixed(2)}</td>
                        <td><strong>£{Number(p.net_pay).toFixed(2)}</strong></td>
                        <td><span className={`admin-badge admin-badge-${p.status}`}>{p.status}</span></td>
                        <td className="admin-actions">
                          {editingId === p.id ? (
                            <>
                              <button className="admin-btn-sm admin-btn-save" onClick={() => saveEdit(p.id)}>Save</button>
                              <button className="admin-btn-sm admin-btn-cancel" onClick={() => setEditingId(null)}>Cancel</button>
                            </>
                          ) : (
                            <>
                              <button className="admin-btn-icon" onClick={() => { const next = expandedId === p.id ? null : p.id; setExpandedId(next); if (next && p.employee?.id && !empBenefits[p.employee.id]) { supabase.from('benefit_enrollments').select('enrolled_at, benefit_type:benefit_types(title, monthly_cost)').eq('company_id', selectedCompanyId).eq('employee_id', p.employee.id).is('option_id', null).then(({ data }) => { setEmpBenefits(prev => ({ ...prev, [p.employee!.id]: (data || []).map((r: any) => ({ title: r.benefit_type?.title || '', enrolled_at: r.enrolled_at, monthly_cost: r.benefit_type?.monthly_cost || 0 })) })) }) } }}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points={expandedId === p.id ? "18 15 12 9 6 15" : "6 9 12 15 18 9"}/></svg>
                              </button>
                              <button className="admin-btn-icon" onClick={() => startEdit(p)}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                              </button>
                              <button className="admin-btn-icon admin-btn-danger" onClick={() => deletePayslip(p.id)}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                      {expandedId === p.id && (
                        <tr key={`exp-${p.id}`} className="admin-expanded-row">
                          <td colSpan={10}>
                            {editingId === p.id ? (
                              <div className="admin-detail-grid admin-detail-grid-4">
                                <div><label style={{ fontSize: 12, fontWeight: 600 }}>Gross Pay</label><input type="number" className="admin-inline-input" value={editForm.gross_pay} onChange={e => setEditForm(f => ({...f, gross_pay: +e.target.value}))} /></div>
                                <div><label style={{ fontSize: 12, fontWeight: 600 }}>Tax</label><input type="number" className="admin-inline-input" value={editForm.tax} onChange={e => setEditForm(f => ({...f, tax: +e.target.value}))} /></div>
                                <div><label style={{ fontSize: 12, fontWeight: 600 }}>National Insurance</label><input type="number" className="admin-inline-input" value={editForm.national_insurance} onChange={e => setEditForm(f => ({...f, national_insurance: +e.target.value}))} /></div>
                                <div><label style={{ fontSize: 12, fontWeight: 600 }}>Pension</label><input type="number" className="admin-inline-input" value={editForm.pension} onChange={e => setEditForm(f => ({...f, pension: +e.target.value}))} /></div>
                                <div><label style={{ fontSize: 12, fontWeight: 600 }}>Other Deductions</label><input type="number" className="admin-inline-input" value={editForm.other_deductions} onChange={e => setEditForm(f => ({...f, other_deductions: +e.target.value}))} /></div>
                                <div><label style={{ fontSize: 12, fontWeight: 600 }}>Salary Sacrifice</label><input type="number" className="admin-inline-input" value={editForm.monthly_deductions} onChange={e => setEditForm(f => ({...f, monthly_deductions: +e.target.value}))} /></div>
                                <div><label style={{ fontSize: 12, fontWeight: 600 }}>Overtime</label><input type="number" className="admin-inline-input" value={editForm.overtime} onChange={e => setEditForm(f => ({...f, overtime: +e.target.value}))} /></div>
                                <div><label style={{ fontSize: 12, fontWeight: 600 }}>Adjustments</label><input type="number" className="admin-inline-input" value={editForm.adjustments} onChange={e => setEditForm(f => ({...f, adjustments: +e.target.value}))} /></div>
                                <div><label style={{ fontSize: 12, fontWeight: 600 }}>Tax Code</label><input className="admin-inline-input" value={editForm.tax_code} onChange={e => setEditForm(f => ({...f, tax_code: e.target.value}))} /></div>
                                <div><label style={{ fontSize: 12, fontWeight: 600 }}>Annual Salary</label><input type="number" className="admin-inline-input" value={editForm.annual_salary} onChange={e => setEditForm(f => ({...f, annual_salary: +e.target.value}))} /></div>
                                <div><label style={{ fontSize: 12, fontWeight: 600 }}>Payroll ID</label><input className="admin-inline-input" value={editForm.payroll_id} readOnly style={{ opacity: 0.6, cursor: 'not-allowed' }} /></div>
                                <div><label style={{ fontSize: 12, fontWeight: 600 }}>Status</label>
                                  <select className="admin-inline-select" value={editForm.status} onChange={e => setEditForm(f => ({...f, status: e.target.value}))}>
                                    <option value="draft">Draft</option><option value="processed">Processed</option><option value="paid">Paid</option>
                                  </select>
                                </div>
                                <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
                                  <span style={{ fontSize: 13, fontWeight: 600, marginRight: 'auto', color: 'var(--text, #1a1a2e)' }}>
                                    Calculated Net: £{((Number(editForm.gross_pay) - Number(editForm.monthly_deductions || 0)) + Number(editForm.overtime || 0) + Number(editForm.adjustments || 0) - Number(editForm.tax) - Number(editForm.national_insurance) - Number(editForm.pension) - Number(editForm.other_deductions)).toFixed(2)}
                                  </span>
                                  <button className="admin-btn-sm admin-btn-save" onClick={() => saveEdit(p.id)}>Save</button>
                                  <button className="admin-btn-sm admin-btn-cancel" onClick={() => setEditingId(null)}>Cancel</button>
                                </div>
                              </div>
                            ) : (
                              <>
                                {p.status === 'flagged' && p.payroll_office && (
                                  <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '10px 14px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                                    <span style={{ color: '#dc2626', fontWeight: 600, fontSize: 13 }}>{p.payroll_office}</span>
                                    <span style={{ color: '#991b1b', fontSize: 12 }}>— Update the employee record and edit this payslip to correct values before processing.</span>
                                  </div>
                                )}
                                <div className="admin-detail-grid admin-detail-grid-4">
                                  <div><strong>Tax Code:</strong> {p.tax_code}</div>
                                  <div><strong>Annual Salary:</strong> £{Number(p.annual_salary || 0).toLocaleString()}</div>
                                  <div><strong>Tax:</strong> £{Number(p.tax).toFixed(2)}</div>
                                  <div><strong>NI:</strong> £{Number(p.national_insurance).toFixed(2)}</div>
                                  <div><strong>Pension:</strong> £{Number(p.pension).toFixed(2)}</div>
                                  <div><strong>Overtime:</strong> £{Number(p.overtime || 0).toFixed(2)}</div>
                                  <div><strong>Adjustments:</strong> £{Number(p.adjustments || 0).toFixed(2)}</div>
                                  <div><strong>Other Deductions:</strong> £{Number(p.other_deductions || 0).toFixed(2)}</div>
                                  <div><strong>Salary Sacrifice:</strong> £{Number(p.monthly_deductions || 0).toFixed(2)}</div>
                                  {Number(p.monthly_deductions || 0) > 0 && (() => {
                                    const sacrifice = Number(p.monthly_deductions || 0)
                                    const gross = Number(p.gross_pay || 0)
                                    const adjustedGross = gross - sacrifice
                                    const taxRate = adjustedGross > 0 ? Number(p.tax) / adjustedGross : 0.2
                                    const niRate = adjustedGross > 0 ? Number(p.national_insurance) / adjustedGross : 0.12
                                    const taxSaving = Math.round(sacrifice * taxRate * 100) / 100
                                    const niSaving = Math.round(sacrifice * niRate * 100) / 100
                                    const totalSaving = Math.round((taxSaving + niSaving) * 100) / 100
                                    return (
                                      <div><strong>Benefit Tax Saving:</strong> <span style={{ color: '#16a34a', fontWeight: 600 }}>£{totalSaving.toFixed(2)}</span> <span style={{ fontSize: 11, color: 'var(--text-muted, #8b8fa3)' }}>(£{taxSaving.toFixed(2)} tax + £{niSaving.toFixed(2)} NI)</span></div>
                                    )
                                  })()}
                                  <div><strong>Payment Date:</strong> {new Date(p.payment_date + 'T00:00:00').toLocaleDateString('en-GB')}</div>
                                  <div><strong>Payroll ID:</strong> {p.payroll_id || '—'}</div>
                                  <div><strong>Bank Account:</strong> {p.bank_account || '—'}</div>
                                </div>
                                {p.employee?.id && (empBenefits[p.employee.id] || []).length > 0 && (
                                  <div style={{ marginTop: '12px' }}>
                                    <strong style={{ fontSize: '13px' }}>Benefit Subscriptions:</strong>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '6px' }}>
                                      {empBenefits[p.employee.id].map((b, i) => (
                                        <span key={i} style={{ background: 'var(--bg-secondary, #f5f5f5)', padding: '4px 10px', borderRadius: '6px', fontSize: '12px' }}>
                                          {b.title} — £{b.monthly_cost.toFixed(2)}/mo (since {new Date(b.enrolled_at).toLocaleDateString('en-GB')})
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && <div className="admin-empty">No payslips found</div>}
              {totalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 12 }}>
                  <button className="admin-action-btn" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</button>
                  <span style={{ fontSize: 13 }}>Page {page} of {totalPages}</span>
                  <button className="admin-action-btn" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</button>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {tab === 'employees' && (
        <>
          {/* Month navigation */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, padding: '12px 0', marginBottom: 12,
          }}>
            <button className="admin-btn-icon" disabled={empPayMonthIdx <= 0} onClick={() => setEmpPayMonthIdx(i => i - 1)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text, #1a1a2e)', minWidth: 160, textAlign: 'center' }}>
              {empPayMonth?.label || ''}
            </span>
            <button className="admin-btn-icon" disabled={empPayMonthIdx >= fyMonths.length - 1} onClick={() => setEmpPayMonthIdx(i => i + 1)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M9 6l6 6-6 6"/></svg>
            </button>
          </div>

          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Employee</th><th>Department</th><th>Gross Pay</th><th>Tax</th><th>NI</th><th>Pension</th><th>Net Pay</th><th>Status</th></tr></thead>
              <tbody>
                {employees.map(emp => {
                  const ps = empPayPayslips.find(p => p.employee?.id === emp.id)
                  return (
                    <tr key={emp.id}>
                      <td><strong>{emp.first_name} {emp.last_name}</strong><br /><span style={{ fontSize: 11, color: 'var(--text-muted, #888)' }}>{emp.job_title || ''}</span></td>
                      <td>{emp.department || '—'}</td>
                      <td>{ps ? `£${Number(ps.gross_pay).toFixed(2)}` : '—'}</td>
                      <td>{ps ? `£${Number(ps.tax).toFixed(2)}` : '—'}</td>
                      <td>{ps ? `£${Number(ps.national_insurance).toFixed(2)}` : '—'}</td>
                      <td>{ps ? `£${Number(ps.pension).toFixed(2)}` : '—'}</td>
                      <td>{ps ? <strong>£{Number(ps.net_pay).toFixed(2)}</strong> : '—'}</td>
                      <td>{ps ? <span className={`admin-badge admin-badge-${ps.status}`}>{ps.status}</span> : <span className="admin-badge admin-badge-pending">No payslip</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
              {empPayPayslips.length > 0 && (
                <tfoot>
                  <tr style={{ fontWeight: 700 }}>
                    <td>Totals ({empPayPayslips.length})</td>
                    <td></td>
                    <td>£{empPayPayslips.reduce((s, p) => s + Number(p.gross_pay), 0).toFixed(2)}</td>
                    <td>£{empPayPayslips.reduce((s, p) => s + Number(p.tax), 0).toFixed(2)}</td>
                    <td>£{empPayPayslips.reduce((s, p) => s + Number(p.national_insurance), 0).toFixed(2)}</td>
                    <td>£{empPayPayslips.reduce((s, p) => s + Number(p.pension), 0).toFixed(2)}</td>
                    <td>£{empPayPayslips.reduce((s, p) => s + Number(p.net_pay), 0).toFixed(2)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              )}
            </table>
            {empPayPayslips.length === 0 && <div className="admin-empty">No payslips for {empPayMonth?.label}</div>}
          </div>
        </>
      )}

      {tab === 'schedule' && (
        <div className="admin-schedule">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <h3 style={{ margin: 0 }}>Payroll Calendar — {fyLabel}</h3>
            <span className="admin-info-tooltip" style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5c6bc0" strokeWidth="2" style={{ cursor: 'help' }}>
                <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
              </svg>
              <span className="admin-info-tooltip-text">
                <strong>Payroll Process</strong><br/>
                1. Set your pay day and submission window below<br/>
                2. Generate payslips from the Payslips tab<br/>
                3. Review and resolve any flagged payslips<br/>
                4. Once within the submission window, click "Submit Payroll" to download the CSV and mark payslips as paid<br/>
                5. Payslips become visible to employees on the chosen pay day
              </span>
            </span>
          </div>

          <div style={{ background: 'var(--bg-secondary, #f8f9fa)', borderRadius: 10, padding: '16px 20px', marginBottom: 20, display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end' }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Pay Day</label>
              <select className="admin-select" value={payDayMode} onChange={e => setPayDayMode(e.target.value as any)} style={{ minWidth: 160 }}>
                <option value="end">End of Month</option>
                <option value="start">Beginning of Month</option>
                <option value="custom">Custom Day</option>
              </select>
            </div>
            {payDayMode === 'custom' && (
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Day of Month</label>
                <select className="admin-select" value={customPayDay} onChange={e => setCustomPayDay(Number(e.target.value))} style={{ minWidth: 80 }}>
                  {Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
                    <option key={d} value={d}>{d}{d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th'}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Submit Window (days before pay day)</label>
              <select className="admin-select" value={submitLeadDays} onChange={e => setSubmitLeadDays(Number(e.target.value))} style={{ minWidth: 80 }}>
                {[1, 2, 3, 4, 5, 7, 10, 14].map(d => (
                  <option key={d} value={d}>{d} day{d > 1 ? 's' : ''}</option>
                ))}
              </select>
            </div>
            <button className="admin-btn admin-btn-primary" onClick={savePaySettings} disabled={paySettingsSaving} style={{ height: 36 }}>
              {paySettingsSaving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>

          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Month</th><th>Period Start</th><th>Period End</th><th>Pay Day</th><th>Submit Opens</th><th>Payslips</th><th>Status</th></tr></thead>
              <tbody>
                {fyMonths.map(({ year, month }) => {
                  const start = new Date(year, month, 1)
                  const end = new Date(year, month + 1, 0)
                  const payDate = getPayDay(year, month, payDayMode, customPayDay)
                  const submitOpens = new Date(payDate)
                  submitOpens.setDate(submitOpens.getDate() - submitLeadDays)
                  const today = new Date()
                  today.setHours(0, 0, 0, 0)
                  const withinSubmitWindow = today >= submitOpens
                  const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`
                  const monthPayslips = sourcePayslips.filter(p => p.pay_period_start.startsWith(monthKey))
                  const isPast = end < new Date()
                  const schedStatus = payrollScheduleStatuses[monthKey]
                  const hasPayslips = monthPayslips.length > 0
                  const allPaid = hasPayslips && monthPayslips.every(p => p.status === 'paid')

                  let statusLabel: string
                  let statusClass: string
                  let isClickable = false

                  if (schedStatus === 'completed' && allPaid) {
                    statusLabel = 'Completed'
                    statusClass = 'admin-badge-paid'
                  } else if (schedStatus === 'edited') {
                    statusLabel = 'Edited — Download'
                    statusClass = 'admin-badge-rejected'
                    isClickable = withinSubmitWindow
                  } else if (hasPayslips && !allPaid && withinSubmitWindow) {
                    statusLabel = 'Submit Payroll'
                    statusClass = 'admin-badge-pending'
                    isClickable = true
                  } else if (hasPayslips && !allPaid && !withinSubmitWindow) {
                    statusLabel = `Opens ${submitOpens.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
                    statusClass = 'admin-badge-draft'
                  } else if (!hasPayslips && isPast) {
                    statusLabel = 'No Payslips'
                    statusClass = 'admin-badge-pending'
                  } else if (!hasPayslips) {
                    statusLabel = 'Upcoming'
                    statusClass = 'admin-badge-pending'
                  } else {
                    statusLabel = 'Completed'
                    statusClass = 'admin-badge-paid'
                  }

                  return (
                    <tr key={monthKey} className={isPast && !isClickable ? 'admin-row-muted' : ''}>
                      <td><strong>{MONTH_NAMES[month]}</strong></td>
                      <td>{start.toLocaleDateString('en-GB')}</td>
                      <td>{end.toLocaleDateString('en-GB')}</td>
                      <td>{payDate.toLocaleDateString('en-GB')}</td>
                      <td>{submitOpens.toLocaleDateString('en-GB')}</td>
                      <td>{monthPayslips.length}</td>
                      <td>
                        {isClickable ? (
                          <button
                            className={`admin-badge ${statusClass}`}
                            style={{ cursor: 'pointer', border: 'none', fontWeight: 600 }}
                            onClick={() => submitPayroll(monthKey)}
                          >
                            {statusLabel}
                          </button>
                        ) : (
                          <span className={`admin-badge ${statusClass}`}>{statusLabel}</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'time_breakdown' && (
        <>
          <div className="admin-filters">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ fontSize: 13, fontWeight: 600 }}>Period:</label>
              <input type="date" className="admin-select" value={tbPeriodStart} onChange={e => setTbPeriodStart(e.target.value)} />
              <span>to</span>
              <input type="date" className="admin-select" value={tbPeriodEnd} onChange={e => setTbPeriodEnd(e.target.value)} />
            </div>
            <select className="admin-select" value={tbFilterEmp} onChange={e => setTbFilterEmp(e.target.value)}>
              <option value="">All Employees</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>)}
            </select>
            <button className="admin-btn admin-btn-primary" onClick={loadTimeBreakdown} disabled={tbLoading}>
              {tbLoading ? 'Loading...' : 'Refresh'}
            </button>
          </div>

          {tbLoading ? <div className="admin-loading">Loading time data...</div> : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    {enabledFeatures.shifts && <th>Shift Hours</th>}
                    {enabledFeatures.timesheets && <th>Timesheet Hours</th>}
                    {enabledFeatures.legal_timesheets && <th>Legal Hours</th>}
                    <th>Total Hours</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {employees.filter(e => !tbFilterEmp || e.id === tbFilterEmp).map(emp => {
                    const data = tbData[emp.id]
                    if (!data) return null
                    const total = data.shiftHrs + data.tsHrs + data.legalHrs
                    if (total === 0 && !tbFilterEmp) return null
                    const isExpanded = tbExpandedEmp === emp.id
                    return (
                      <>
                        <tr key={emp.id} className={isExpanded ? 'admin-row-active' : ''}>
                          <td><strong>{emp.first_name} {emp.last_name}</strong><br /><span style={{ fontSize: 12, color: '#888' }}>{emp.department} · {emp.job_title}</span></td>
                          {enabledFeatures.shifts && <td>{data.shiftHrs.toFixed(1)}h <span style={{ fontSize: 12, color: '#888' }}>({data.shiftEntries.length} shifts)</span></td>}
                          {enabledFeatures.timesheets && <td>{data.tsHrs.toFixed(1)}h <span style={{ fontSize: 12, color: '#888' }}>({data.tsEntries.length} entries)</span></td>}
                          {enabledFeatures.legal_timesheets && <td>{data.legalHrs.toFixed(1)}h <span style={{ fontSize: 12, color: '#888' }}>({data.legalEntries.length} entries)</span></td>}
                          <td><strong>{total.toFixed(1)}h</strong></td>
                          <td>
                            <button className="admin-btn-icon" onClick={() => setTbExpandedEmp(isExpanded ? null : emp.id)}>
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points={isExpanded ? '18 15 12 9 6 15' : '6 9 12 15 18 9'} /></svg>
                            </button>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr key={`tb-exp-${emp.id}`} className="admin-expanded-row">
                            <td colSpan={2 + (enabledFeatures.shifts ? 1 : 0) + (enabledFeatures.timesheets ? 1 : 0) + (enabledFeatures.legal_timesheets ? 1 : 0)}>
                              <div className="admin-tb-detail">
                                {enabledFeatures.shifts && data.shiftEntries.length > 0 && (
                                  <div className="admin-tb-section">
                                    <h4 className="admin-tb-section-title">Shifts ({data.shiftHrs.toFixed(1)}h)</h4>
                                    <table className="admin-table admin-table-nested">
                                      <thead><tr><th>Date</th><th>Shift</th><th>Time</th><th>Break</th><th>Hours</th></tr></thead>
                                      <tbody>
                                        {data.shiftEntries.sort((a: any, b: any) => a.date.localeCompare(b.date)).map((s: any, i: number) => (
                                          <tr key={i}>
                                            <td>{formatDate(s.date)}</td>
                                            <td>{s.shiftName}</td>
                                            <td>{s.start_time?.slice(0, 5)} - {s.end_time?.slice(0, 5)}</td>
                                            <td>{s.breakMins || 0} mins</td>
                                            <td>{s.hrs.toFixed(1)}h</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}

                                {enabledFeatures.timesheets && data.tsEntries.length > 0 && (
                                  <div className="admin-tb-section">
                                    <h4 className="admin-tb-section-title">Timesheets ({data.tsHrs.toFixed(1)}h)</h4>
                                    <table className="admin-table admin-table-nested">
                                      <thead><tr><th>Date</th><th>Location</th><th>Role</th><th>Time</th><th>Hours</th><th>Status</th></tr></thead>
                                      <tbody>
                                        {data.tsEntries.sort((a: any, b: any) => a.date.localeCompare(b.date)).map((ts: any, i: number) => (
                                          <tr key={i}>
                                            <td>{ts.end_date && ts.end_date !== ts.date ? `${formatDate(ts.date)} – ${formatDate(ts.end_date)}` : formatDate(ts.date)}</td>
                                            <td>{ts.location}</td>
                                            <td>{ts.role}</td>
                                            <td>{ts.start_time?.slice(0, 5)} - {ts.end_time?.slice(0, 5)}</td>
                                            <td>{Number(ts.hours).toFixed(1)}h</td>
                                            <td><span className={`admin-badge admin-badge-${ts.status}`}>{ts.status}</span></td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}

                                {enabledFeatures.legal_timesheets && data.legalEntries.length > 0 && (
                                  <div className="admin-tb-section">
                                    <h4 className="admin-tb-section-title">Legal Timesheets ({data.legalHrs.toFixed(1)}h)</h4>
                                    <table className="admin-table admin-table-nested">
                                      <thead><tr><th>Date</th><th>Task Code</th><th>Hours</th><th>Status</th></tr></thead>
                                      <tbody>
                                        {data.legalEntries.sort((a: any, b: any) => a.date.localeCompare(b.date)).map((lt: any, i: number) => (
                                          <tr key={i}>
                                            <td>{formatDate(lt.date)}</td>
                                            <td>{lt.task_code}</td>
                                            <td>{Number(lt.duration_hrs).toFixed(1)}h</td>
                                            <td><span className={`admin-badge admin-badge-${lt.status}`}>{lt.status}</span></td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}

                                {data.shiftEntries.length === 0 && data.tsEntries.length === 0 && data.legalEntries.length === 0 && (
                                  <p style={{ color: '#888', fontStyle: 'italic' }}>No time entries for this period</p>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    )
                  })}
                </tbody>
              </table>
              {Object.values(tbData).every(d => d.shiftHrs + d.tsHrs + d.legalHrs === 0) && !tbFilterEmp && (
                <div className="admin-empty">No time entries found for this period</div>
              )}
            </div>
          )}
        </>
      )}

      {tab === 'analytics' && (
        <>
          <div className="admin-filters" style={{ flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ fontSize: 13, fontWeight: 600 }}>Period:</label>
              <input type="date" className="admin-select" value={anPeriodStart} onChange={e => setAnPeriodStart(e.target.value)} />
              <span>to</span>
              <input type="date" className="admin-select" value={anPeriodEnd} onChange={e => setAnPeriodEnd(e.target.value)} />
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {enabledFeatures.legal_timesheets && (
                <button className="admin-btn admin-btn-primary" onClick={exportLegalCsv} disabled={anLoading}>Export Legal Timesheets CSV</button>
              )}
              {enabledFeatures.shifts && (
                <button className="admin-btn admin-btn-primary" onClick={exportShiftsCsv} disabled={anLoading}>Export Shifts &amp; Rotas CSV</button>
              )}
              <button className="admin-btn admin-btn-primary" onClick={exportAdjustmentsCsv} disabled={anLoading}>Export Adjustments CSV</button>
            </div>
          </div>

          {anLoading ? <div className="admin-loading">Loading analytics...</div> : (
            <>
              <div className="admin-mini-stats">
                <div className="admin-mini-stat">
                  <span className="admin-mini-value">{anData.empMetrics.length}</span><span>Active Employees</span>
                </div>
                <div className="admin-mini-stat">
                  <span className="admin-mini-value">{anData.empMetrics.reduce((s, e) => s + e.totalHrs, 0).toFixed(0)}h</span><span>Total Hours</span>
                </div>
                <div className="admin-mini-stat">
                  <span className="admin-mini-value" style={{ color: (() => {
                    const total = anData.empMetrics.reduce((s, e) => s + e.totalHrs, 0)
                    const contracted = anData.empMetrics.reduce((s, e) => s + e.contractedPeriodHrs, 0)
                    const pct = contracted > 0 ? (total / contracted * 100) : 0
                    return pct >= 80 ? '#43a047' : pct >= 50 ? '#ff9800' : '#e53935'
                  })() }}>
                    {(() => {
                      const total = anData.empMetrics.reduce((s, e) => s + e.totalHrs, 0)
                      const contracted = anData.empMetrics.reduce((s, e) => s + e.contractedPeriodHrs, 0)
                      return contracted > 0 ? (total / contracted * 100).toFixed(0) + '%' : '—'
                    })()}
                  </span><span>Avg Utilisation</span>
                </div>
                <div className="admin-mini-stat">
                  <span className="admin-mini-value">{anData.projectBreakdown.length}</span><span>Projects</span>
                </div>
              </div>

              <h3 style={{ margin: '20px 0 8px', fontSize: 15, fontWeight: 600 }}>Employee Utilisation</h3>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Department</th>
                      {enabledFeatures.timesheets && <th>Timesheet Hrs</th>}
                      {enabledFeatures.shifts && <th>Shift Hrs</th>}
                      {enabledFeatures.legal_timesheets && <th>Legal Hrs</th>}
                      <th>Total Hrs</th>
                      <th>Contracted</th>
                      <th>Utilisation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {anData.empMetrics.map(e => {
                      const pct = e.contractedPeriodHrs > 0 ? (e.totalHrs / e.contractedPeriodHrs * 100) : 0
                      return (
                        <tr key={e.id}>
                          <td><strong>{e.name}</strong></td>
                          <td>{e.dept}</td>
                          {enabledFeatures.timesheets && <td>{e.tsHrs.toFixed(1)}h</td>}
                          {enabledFeatures.shifts && <td>{e.shiftHrs.toFixed(1)}h</td>}
                          {enabledFeatures.legal_timesheets && <td>{e.legalHrs.toFixed(1)}h</td>}
                          <td><strong>{e.totalHrs.toFixed(1)}h</strong></td>
                          <td>{e.contractedPeriodHrs.toFixed(0)}h</td>
                          <td>
                            <span className={`admin-badge ${pct >= 80 ? 'admin-badge-approved' : pct >= 50 ? 'admin-badge-pending' : 'admin-badge-rejected'}`}>
                              {pct.toFixed(0)}%
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {anData.empMetrics.length === 0 && <div className="admin-empty">No utilisation data for this period</div>}
              </div>

              {enabledFeatures.timesheets && anData.projectBreakdown.length > 0 && (
                <>
                  <h3 style={{ margin: '20px 0 8px', fontSize: 15, fontWeight: 600 }}>Customer &amp; Project Breakdown</h3>
                  <div className="admin-table-wrap">
                    <table className="admin-table">
                      <thead><tr><th>Customer</th><th>Project</th><th>Hours</th><th>% of Total</th></tr></thead>
                      <tbody>
                        {anData.projectBreakdown.map((p, i) => {
                          const totalProjHrs = anData.projectBreakdown.reduce((s, x) => s + x.hours, 0)
                          return (
                            <tr key={i}>
                              <td>{p.customer}</td>
                              <td>{p.project}</td>
                              <td>{p.hours.toFixed(1)}h</td>
                              <td>{totalProjHrs > 0 ? (p.hours / totalProjHrs * 100).toFixed(0) : 0}%</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {enabledFeatures.legal_timesheets && anData.legalClientBreakdown.length > 0 && (
                <>
                  <h3 style={{ margin: '20px 0 8px', fontSize: 15, fontWeight: 600 }}>Legal Client &amp; Matter Breakdown</h3>
                  <div className="admin-table-wrap">
                    <table className="admin-table">
                      <thead><tr><th>Client</th><th>Matter</th><th>Hours</th><th>% of Total</th></tr></thead>
                      <tbody>
                        {anData.legalClientBreakdown.map((l, i) => {
                          const totalLegalHrs = anData.legalClientBreakdown.reduce((s, x) => s + x.hours, 0)
                          return (
                            <tr key={i}>
                              <td>{l.client}</td>
                              <td>{l.matter}</td>
                              <td>{l.hours.toFixed(1)}h</td>
                              <td>{totalLegalHrs > 0 ? (l.hours / totalLegalHrs * 100).toFixed(0) : 0}%</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {anData.weeklySubmissions.length > 0 && (
                <>
                  <h3 style={{ margin: '20px 0 8px', fontSize: 15, fontWeight: 600 }}>Weekly Timesheet Submissions</h3>
                  <div className="admin-table-wrap">
                    <table className="admin-table">
                      <thead><tr><th>Week Starting</th><th>Submissions</th><th>Total Hours</th></tr></thead>
                      <tbody>
                        {anData.weeklySubmissions.map((w, i) => (
                          <tr key={i}>
                            <td>{new Date(w.week + 'T00:00:00').toLocaleDateString('en-GB')}</td>
                            <td>{w.count}</td>
                            <td>{w.hours.toFixed(1)}h</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}

      {tab === 'xero_pay' && xeroConnected && (
        <>
          <div style={{
            padding: '10px 14px', marginBottom: 12, background: 'var(--bg-card, #fff)',
            borderRadius: 8, border: '1px solid var(--border, #e5e7eb)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12,
          }}>
            <div>
              <strong style={{ fontSize: 13, color: '#2e7d32' }}>Connected to Xero</strong>
              {xeroIntegration?.last_sync_at && (
                <p style={{ margin: '2px 0 0', fontSize: 12, color: '#4caf50' }}>
                  Last synced: {new Date(xeroIntegration.last_sync_at).toLocaleString('en-GB')}
                </p>
              )}
            </div>
            <button className="admin-btn admin-btn-primary" onClick={fetchXeroPayslips} disabled={xeroSyncing}>
              {xeroSyncing ? 'Fetching...' : 'Fetch Payslips'}
            </button>
          </div>

          {xeroPayRun && (
            <div style={{
              padding: '10px 14px', marginBottom: 12, background: 'var(--bg-card, #fff)',
              borderRadius: 8, border: '1px solid var(--border, #e5e7eb)',
              display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', fontSize: 13, color: 'var(--text, #1a1a2e)',
            }}>
              <span><strong>Pay Run:</strong> {xeroPayRun.status}</span>
              <span><strong>Period:</strong> {new Date(xeroPayRun.period_start).toLocaleDateString('en-GB')} — {new Date(xeroPayRun.period_end).toLocaleDateString('en-GB')}</span>
              {xeroPayRun.payment_date && (
                <span><strong>Payment:</strong> {new Date(xeroPayRun.payment_date).toLocaleDateString('en-GB')}</span>
              )}
            </div>
          )}

          {xeroLivePayslips.length > 0 && (
            <>
              <h3 style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 600, color: 'var(--text, #1a1a2e)' }}>
                Xero Payslips ({xeroLivePayslips.length})
              </h3>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Matched</th>
                      <th>Total Earnings</th>
                      <th>Tax (PAYE)</th>
                      <th>Employee NI</th>
                      <th>Deductions</th>
                      <th>Employer NI</th>
                      <th>Employer Pension</th>
                      <th>Reimbursements</th>
                      <th>Student Loan</th>
                      <th>Net Pay</th>
                    </tr>
                  </thead>
                  <tbody>
                    {xeroLivePayslips.map(s => (
                      <tr key={s.payslip_id}>
                        <td><strong>{s.first_name} {s.last_name}</strong></td>
                        <td>{s.inflow_employee_id ? <span style={{ color: '#16a34a' }}>Yes</span> : <span style={{ color: '#dc2626' }}>No</span>}</td>
                        <td>£{Number(s.total_earnings).toFixed(2)}</td>
                        <td>£{Number(s.tax).toFixed(2)}</td>
                        <td>£{Number(s.employee_ni).toFixed(2)}</td>
                        <td title={(s.deductions || []).map(d => `${d.name}: £${d.amount.toFixed(2)}`).join('\n')}>
                          £{(s.deductions || []).reduce((sum, d) => sum + d.amount, 0).toFixed(2)}
                        </td>
                        <td>£{Number(s.employer_ni).toFixed(2)}</td>
                        <td title={(s.employer_pension_lines || []).map(b => `${b.name}: £${b.amount.toFixed(2)}`).join('\n')}>
                          £{Number(s.employer_pension).toFixed(2)}
                        </td>
                        <td title={(s.reimbursements || []).map(r => `${r.name}: £${r.amount.toFixed(2)}`).join('\n')}>
                          £{Number(s.total_reimbursements || 0).toFixed(2)}
                        </td>
                        <td>£{Number(s.student_loan).toFixed(2)}</td>
                        <td><strong>£{Number(s.net_pay).toFixed(2)}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ fontWeight: 700 }}>
                      <td>Totals</td>
                      <td></td>
                      <td>£{xeroLivePayslips.reduce((s, p) => s + Number(p.total_earnings), 0).toFixed(2)}</td>
                      <td>£{xeroLivePayslips.reduce((s, p) => s + Number(p.tax), 0).toFixed(2)}</td>
                      <td>£{xeroLivePayslips.reduce((s, p) => s + Number(p.employee_ni), 0).toFixed(2)}</td>
                      <td>£{xeroLivePayslips.reduce((s, p) => s + (p.deductions || []).reduce((sum, d) => sum + d.amount, 0), 0).toFixed(2)}</td>
                      <td>£{xeroLivePayslips.reduce((s, p) => s + Number(p.employer_ni), 0).toFixed(2)}</td>
                      <td>£{xeroLivePayslips.reduce((s, p) => s + Number(p.employer_pension), 0).toFixed(2)}</td>
                      <td>£{xeroLivePayslips.reduce((s, p) => s + Number(p.total_reimbursements || 0), 0).toFixed(2)}</td>
                      <td>£{xeroLivePayslips.reduce((s, p) => s + Number(p.student_loan), 0).toFixed(2)}</td>
                      <td>£{xeroLivePayslips.reduce((s, p) => s + Number(p.net_pay), 0).toFixed(2)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}

          {xeroLivePayslips.length === 0 && !xeroSyncing && (
            <div className="admin-empty" style={{ marginTop: 16 }}>
              No payslips fetched yet. Click &ldquo;Fetch Payslips&rdquo; to pull the latest pay run from Xero.
            </div>
          )}
        </>
      )}

      {tab === 'sage_pay' && sageConnected && (
        <>
          <div style={{
            padding: '10px 14px', marginBottom: 12, background: 'var(--bg-card, #fff)',
            borderRadius: 8, border: '1px solid var(--border, #e5e7eb)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12,
          }}>
            <div>
              <strong style={{ fontSize: 13, color: '#2e7d32' }}>Sage Payroll Enabled</strong>
              {sageIntegration?.last_upload_at && (
                <p style={{ margin: '2px 0 0', fontSize: 12, color: '#4caf50' }}>
                  Last upload: {new Date(sageIntegration.last_upload_at).toLocaleString('en-GB')}
                  {sageIntegration.last_upload_filename && ` — ${sageIntegration.last_upload_filename}`}
                </p>
              )}
            </div>
          </div>

          <div
            style={{
              border: '2px dashed var(--border, #d1d5db)', borderRadius: 12, padding: 32,
              textAlign: 'center', background: 'var(--bg-card, #fff)', marginBottom: 16,
              cursor: sageUploading ? 'not-allowed' : 'pointer', opacity: sageUploading ? 0.6 : 1,
            }}
            onDragOver={e => { e.preventDefault(); e.stopPropagation() }}
            onDrop={e => {
              e.preventDefault(); e.stopPropagation()
              const f = e.dataTransfer.files[0]
              if (f && (f.name.endsWith('.pdf') || f.name.endsWith('.txt'))) handleSagePdfUpload(f)
              else showError('Please upload a .pdf or .txt file')
            }}
            onClick={() => {
              if (sageUploading) return
              const input = document.createElement('input')
              input.type = 'file'
              input.accept = '.pdf,.txt'
              input.onchange = () => {
                const f = input.files?.[0]
                if (f) handleSagePdfUpload(f)
              }
              input.click()
            }}
          >
            <div style={{ fontSize: 32, marginBottom: 8 }}>&#128196;</div>
            <p style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 600, color: 'var(--text, #1a1a2e)' }}>
              {sageUploading ? 'Processing...' : 'Upload Sage Payslip PDF'}
            </p>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted, #6b7280)' }}>
              Drag and drop or click to select a .pdf or .txt file exported from Sage Payroll
            </p>
          </div>

          {sageUploadResult && (
            <div style={{
              position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999,
              background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <div style={{
                background: 'var(--bg-card, #fff)', borderRadius: 12, padding: 24, maxWidth: 560, width: '90%',
                boxShadow: '0 20px 60px rgba(0,0,0,0.3)', maxHeight: '80vh', overflowY: 'auto',
              }}>
                <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 700, color: '#2e7d32' }}>
                  Sage Payslip Import Complete
                </h3>

                {sageUploadResult.matched.length > 0 && (
                  <>
                    <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: 'var(--text, #1a1a2e)' }}>
                      Matched ({sageUploadResult.matched.length})
                    </p>
                    <div className="admin-table-wrap" style={{ marginBottom: 16 }}>
                      <table className="admin-table">
                        <thead>
                          <tr><th>Employee</th><th>Employee ID</th><th>Net Pay</th><th>Period</th></tr>
                        </thead>
                        <tbody>
                          {sageUploadResult.matched.map((m, i) => (
                            <tr key={i}>
                              <td><strong>{m.employee_name}</strong></td>
                              <td>{m.employee_number}</td>
                              <td>£{m.net_pay.toFixed(2)}</td>
                              <td>{m.period}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}

                {sageUploadResult.unmatched.length > 0 && (
                  <>
                    <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: '#dc2626' }}>
                      Unmatched ({sageUploadResult.unmatched.length})
                    </p>
                    <div className="admin-table-wrap" style={{ marginBottom: 16 }}>
                      <table className="admin-table">
                        <thead>
                          <tr><th>Employee Name</th><th>Employee ID</th></tr>
                        </thead>
                        <tbody>
                          {sageUploadResult.unmatched.map((u, i) => (
                            <tr key={i}>
                              <td>{u.employee_name}</td>
                              <td>{u.employee_number}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p style={{ margin: '0 0 12px', fontSize: 12, color: '#dc2626' }}>
                      These employees could not be matched. Check their Employee ID in Admin &gt; Employees &gt; Employment Management.
                    </p>
                  </>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                  <button className="admin-btn admin-btn-primary" onClick={() => setSageUploadResult(null)}>Close</button>
                </div>
              </div>
            </div>
          )}

          {sourcePayslips.length > 0 && (
            <>
              <h3 style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 600, color: 'var(--text, #1a1a2e)' }}>
                Imported Sage Payslips ({sourcePayslips.length})
              </h3>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Employee</th><th>Period</th><th>Gross</th><th>Tax</th>
                      <th>NI</th><th>Pension</th><th>Net Pay</th><th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sourcePayslips.map(p => (
                      <tr key={p.id}>
                        <td><strong>{p.employee ? `${p.employee.first_name} ${p.employee.last_name}` : '—'}</strong></td>
                        <td>{formatDate(p.pay_period_start)} — {formatDate(p.pay_period_end)}</td>
                        <td>£{Number(p.gross_pay).toFixed(2)}</td>
                        <td>£{Number(p.tax).toFixed(2)}</td>
                        <td>£{Number(p.national_insurance).toFixed(2)}</td>
                        <td>£{Number(p.pension).toFixed(2)}</td>
                        <td><strong>£{Number(p.net_pay).toFixed(2)}</strong></td>
                        <td><span style={{ color: p.status === 'paid' ? '#16a34a' : '#f59e0b', fontWeight: 600 }}>{p.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {sourcePayslips.length === 0 && !sageUploading && (
            <div className="admin-empty" style={{ marginTop: 16 }}>
              No Sage payslips imported yet. Upload a payslip PDF to get started.
            </div>
          )}
        </>
      )}
    </div>
  )
}
