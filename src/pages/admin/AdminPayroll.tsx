import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { useFeatures } from '../../context/FeatureContext'
import { formatDate } from '../../lib/formatters'
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
  hourly_rate: number | null
  pay_frequency: string | null
  overtime_rate_multiplier: number | null
  tax_code: string | null
  payroll_id: string | null
  employment_category: string | null
  contract_type: string | null
  bank_sort_code: string | null
  bank_account_number: string | null
  bank_account_name: string | null
}

interface PeriodReview {
  id: string
  company_id: string
  employee_id: string
  period_start: string
  period_end: string
  total_hours: number
  adjusted_hours: number | null
  overtime_hours: number
  hourly_rate: number
  gross_pay: number
  status: string
  approved_by: string | null
  approved_at: string | null
  notes: string | null
}

interface ModulrIntegration {
  id: string
  company_id: string
  source_account_id: string
  status: string
  status_error: string | null
  connected_at: string | null
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
  const { features } = useFeatures()
  const [payslips, setPayslips] = useState<Payslip[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'payslips' | 'schedule' | 'employees' | 'period_review' | 'time_breakdown' | 'analytics' | 'xero_pay' | 'sage_pay' | 'bacs_export' | 'modulr_payout' | 'logs'>('payslips')
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
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(new Set())
  const [bulkUpdating, setBulkUpdating] = useState(false)

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
    skipped?: { employee_name: string; employee_number: string; month: string; existing_source: string }[]
    total_parsed: number
  } | null>(null)
  const [sageScanStatus, setSageScanStatus] = useState<string | null>(null)

  // Modulr integration state
  const [modulrIntegration, setModulrIntegration] = useState<ModulrIntegration | null>(null)
  const [modulrBalance, setModulrBalance] = useState<number | null>(null)
  const [modulrBalanceLoading, setModulrBalanceLoading] = useState(false)
  const [modulrSubmitting, setModulrSubmitting] = useState(false)
  const [showModulrConfirmModal, setShowModulrConfirmModal] = useState(false)

  // BACS export state
  const [bacsEdits, setBacsEdits] = useState<Record<string, { sort_code?: string; account_number?: string }>>({})
  const [bacsOriginatorSortCode, setBacsOriginatorSortCode] = useState('')
  const [bacsOriginatorAccountNo, setBacsOriginatorAccountNo] = useState('')
  const [bacsOriginatorName, setBacsOriginatorName] = useState('')

  // Employee Pay tab month navigation
  const [empPayMonthIdx, setEmpPayMonthIdx] = useState(0)
  const [empPayPage, setEmpPayPage] = useState(1)
  const [empPayShiftPage, setEmpPayShiftPage] = useState(1)
  const [empPayZeroPage, setEmpPayZeroPage] = useState(1)
  const [empPaySubTab, setEmpPaySubTab] = useState<'employed' | 'shift' | 'zero_hours'>('employed')

  // Sub-tabs for employment type split
  const [payslipSubTab, setPayslipSubTab] = useState<'employed' | 'shift'>('employed')
  const [tbSubTab, setTbSubTab] = useState<'employed' | 'shift' | 'zero_hours'>('employed')

  // Shift payroll schedule settings
  const [shiftPayDayMode, setShiftPayDayMode] = useState<'end' | 'start' | 'custom'>('end')
  const [shiftCustomPayDay, setShiftCustomPayDay] = useState(28)
  const [shiftSubmitLeadDays, setShiftSubmitLeadDays] = useState(5)
  const [zeroHrsFrequency, setZeroHrsFrequency] = useState<'weekly' | 'fortnightly' | 'monthly'>('monthly')
  const [zeroHrsPayDayMode, setZeroHrsPayDayMode] = useState<'end' | 'start' | 'custom'>('end')
  const [zeroHrsCustomPayDay, setZeroHrsCustomPayDay] = useState(28)
  const [zeroHrsSubmitLeadDays, setZeroHrsSubmitLeadDays] = useState(5)

  // Schedule sub-tabs and pagination
  const [schedSubTab, setSchedSubTab] = useState<'employed' | 'shift' | 'zero_hours' | 'settings'>('employed')
  const [schedEmpPage, setSchedEmpPage] = useState(1)
  const [schedShiftPage, setSchedShiftPage] = useState(1)
  const [schedZeroPage, setSchedZeroPage] = useState(1)

  // Period Review state
  const [prReviews, setPrReviews] = useState<PeriodReview[]>([])
  const [prLoading, setPrLoading] = useState(false)
  const [prSubTab, setPrSubTab] = useState<'shift' | 'zero_hours'>('shift')
  const [prPeriodStart, setPrPeriodStart] = useState(() => {
    const d = new Date(); const day = d.getDay(); const diff = d.getDate() - day + (day === 0 ? -6 : 1)
    const mon = new Date(d.setDate(diff)); mon.setHours(0, 0, 0, 0); return localDateStr(mon)
  })
  const [prPeriodEnd, setPrPeriodEnd] = useState(() => {
    const d = new Date(); const day = d.getDay(); const diff = d.getDate() - day + (day === 0 ? 0 : 7)
    const sun = new Date(d.setDate(diff)); sun.setHours(0, 0, 0, 0); return localDateStr(sun)
  })
  const [prAdjustments, setPrAdjustments] = useState<Record<string, { hours?: number; overtime?: number; notes?: string }>>({})
  const [prPage, setPrPage] = useState(1)

  // Audit log state
  interface AuditLogEntry { id: string; action: string; detail: string | null; employee_id: string | null; performed_by: string; performer_name: string | null; status: string; created_at: string }
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([])
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditFilterEmp, setAuditFilterEmp] = useState('')
  const [auditDateFrom, setAuditDateFrom] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 1); return localDateStr(d)
  })
  const [auditDateTo, setAuditDateTo] = useState(() => localDateStr(new Date()))
  const [auditPage, setAuditPage] = useState(1)

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
  const [tbPage, setTbPage] = useState(1)

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
    const [pRes, eRes, xRes, sRes, mRes, compRes] = await Promise.all([
      supabase.from('payslips').select('*, employee:employees!payslips_employee_id_fkey(id, first_name, last_name)').eq('company_id', selectedCompanyId).gte('pay_period_start', fyStart).lte('pay_period_start', fyEnd).order('payment_date', { ascending: false }),
      supabase.from('employees').select('id, first_name, last_name, job_title, department, annual_salary, hourly_rate, pay_frequency, overtime_rate_multiplier, tax_code, payroll_id, employment_category, contract_type, bank_sort_code, bank_account_number, bank_account_name').eq('company_id', selectedCompanyId).eq('is_active', true).order('last_name'),
      supabase.from('xero_integrations').select('id, company_id, sync_status, sync_error, last_sync_at, payslip_source, cached_pay_run, cached_payslips').eq('company_id', selectedCompanyId).maybeSingle(),
      supabase.from('sage_integrations').select('id, company_id, sync_status, last_sync_at, payslip_source, last_upload_at, last_upload_filename').eq('company_id', selectedCompanyId).maybeSingle(),
      supabase.from('modulr_integrations').select('id, company_id, source_account_id, status, status_error, connected_at').eq('company_id', selectedCompanyId).maybeSingle(),
      supabase.from('companies').select('bacs_originator_sort_code, bacs_originator_account_no, bacs_originator_name').eq('id', selectedCompanyId).single(),
    ])
    setPayslips((pRes.data as Payslip[]) || [])
    setEmployees((eRes.data as Employee[]) || [])
    const xero = xRes.data as (XeroIntegration & { cached_pay_run?: XeroPayRun; cached_payslips?: XeroPayslipRow[] }) | null
    setXeroIntegration(xero)
    if (xero?.cached_pay_run) setXeroPayRun(xero.cached_pay_run)
    if (xero?.cached_payslips?.length) setXeroLivePayslips(xero.cached_payslips)
    setSageIntegration(sRes.data as SageIntegration | null)
    setModulrIntegration(mRes.data as ModulrIntegration | null)
    if (compRes.data) {
      setBacsOriginatorSortCode(compRes.data.bacs_originator_sort_code || '')
      setBacsOriginatorAccountNo(compRes.data.bacs_originator_account_no || '')
      setBacsOriginatorName(compRes.data.bacs_originator_name || '')
    }
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
    if (error) { showError('Failed to save payslip: ' + error.message); logPayrollAction('Payslip Edit', `Failed to save payslip #${id}: ${error.message}`, payslip?.employee?.id, 'error'); return }

    // If editing a paid payslip, mark the month's schedule as needing re-download
    if (wasPaid && payslip) {
      await markMonthEdited(payslip.pay_period_start)
    }

    logPayrollAction('Payslip Edit', `Edited payslip for ${payslip?.employee?.first_name} ${payslip?.employee?.last_name} — Gross: £${gross.toFixed(2)}, Net: £${net.toFixed(2)}, Status: ${editForm.status}`, payslip?.employee?.id)
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
    const p = payslips.find(ps => ps.id === id)
    if (p && p.status !== 'draft') { showError('Only draft payslips can be deleted'); return }
    if (!confirm('Delete this draft payslip?')) return
    const { error } = await supabase.from('payslips').delete().eq('id', id)
    if (error) { showError('Failed to delete payslip: ' + error.message); logPayrollAction('Payslip Delete', `Failed to delete payslip #${id}: ${error.message}`, p?.employee?.id, 'error'); return }
    logPayrollAction('Payslip Delete', `Deleted draft payslip for ${p?.employee?.first_name} ${p?.employee?.last_name} — Period: ${p?.pay_period_start}`, p?.employee?.id)
    setPayslips(prev => prev.filter(ps => ps.id !== id))
    showSuccess('Draft payslip deleted')
  }

  async function deleteDraftMonth(monthKey: string, monthPayslips: Payslip[]) {
    const drafts = monthPayslips.filter(p => p.status === 'draft')
    if (drafts.length === 0) { showError('No draft payslips to delete'); return }
    if (!confirm(`Delete ${drafts.length} draft payslip(s) for this month?`)) return
    const ids = drafts.map(p => p.id)
    const { error } = await supabase.from('payslips').delete().in('id', ids)
    if (error) { showError('Failed to delete drafts: ' + error.message); return }
    logPayrollAction('Bulk Delete Drafts', `Deleted ${drafts.length} draft payslip(s) — Month: ${monthKey}`)
    setPayslips(prev => prev.filter(ps => !ids.includes(ps.id)))
    showSuccess(`${drafts.length} draft payslip(s) deleted`)
  }

  async function updatePayslipStatus(id: number, newStatus: string) {
    const p = payslips.find(ps => ps.id === id)
    if (!p) return
    const { error } = await supabase.from('payslips').update({ status: newStatus }).eq('id', id)
    if (error) { showError('Failed to update status: ' + error.message); return }
    logPayrollAction('Status Change', `Changed status for ${p.employee?.first_name} ${p.employee?.last_name} from ${p.status} to ${newStatus}`, p.employee?.id)
    setPayslips(prev => prev.map(ps => ps.id === id ? { ...ps, status: newStatus } : ps))
    showSuccess('Status updated')
  }

  async function bulkUpdateMonthStatus(monthPayslips: Payslip[], newStatus: string, monthKey: string) {
    const eligible = monthPayslips.filter(p => p.status !== newStatus)
    if (eligible.length === 0) return
    if (!confirm(`Set ${eligible.length} payslip(s) to "${newStatus}" for this month?`)) return
    setBulkUpdating(true)
    const ids = eligible.map(p => p.id)
    const { error } = await supabase.from('payslips').update({ status: newStatus }).in('id', ids)
    setBulkUpdating(false)
    if (error) { showError('Bulk update failed: ' + error.message); return }
    logPayrollAction('Bulk Status Change', `Set ${eligible.length} payslip(s) to ${newStatus} — Month: ${monthKey}`)
    setPayslips(prev => prev.map(ps => ids.includes(ps.id) ? { ...ps, status: newStatus } : ps))
    showSuccess(`${eligible.length} payslip(s) set to ${newStatus}`)
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
        if (cpr.shift_pay_day_mode) setShiftPayDayMode(cpr.shift_pay_day_mode)
        if (cpr.shift_custom_pay_day) setShiftCustomPayDay(cpr.shift_custom_pay_day)
        if (cpr.shift_submit_lead_days !== undefined) setShiftSubmitLeadDays(cpr.shift_submit_lead_days)
        if (cpr.zero_hrs_frequency) setZeroHrsFrequency(cpr.zero_hrs_frequency)
        if (cpr.zero_hrs_pay_day_mode) setZeroHrsPayDayMode(cpr.zero_hrs_pay_day_mode)
        if (cpr.zero_hrs_custom_pay_day) setZeroHrsCustomPayDay(cpr.zero_hrs_custom_pay_day)
        if (cpr.zero_hrs_submit_lead_days !== undefined) setZeroHrsSubmitLeadDays(cpr.zero_hrs_submit_lead_days)
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
    await savePayRunData({
      pay_day_mode: payDayMode, custom_pay_day: customPayDay, submit_lead_days: submitLeadDays,
      shift_pay_day_mode: shiftPayDayMode, shift_custom_pay_day: shiftCustomPayDay, shift_submit_lead_days: shiftSubmitLeadDays,
      zero_hrs_frequency: zeroHrsFrequency, zero_hrs_pay_day_mode: zeroHrsPayDayMode, zero_hrs_custom_pay_day: zeroHrsCustomPayDay, zero_hrs_submit_lead_days: zeroHrsSubmitLeadDays,
    })
    setPaySettingsSaving(false)
    showSuccess('Payroll settings saved')
  }

  // ── Audit log helpers ─────────────────────────────────────────────────────

  async function logPayrollAction(action: string, detail: string, employeeId?: string | null, status: 'success' | 'error' | 'warning' = 'success') {
    if (!selectedCompanyId || !session?.user?.id) return
    const userName = session.user.user_metadata?.full_name || session.user.email || 'Unknown'
    await supabase.from('payroll_audit_log').insert({
      company_id: selectedCompanyId,
      action,
      detail,
      employee_id: employeeId || null,
      performed_by: session.user.id,
      performer_name: userName,
      status,
    })
  }

  const loadAuditLogs = useCallback(async () => {
    if (!selectedCompanyId) return
    setAuditLoading(true)
    let query = supabase.from('payroll_audit_log')
      .select('*')
      .eq('company_id', selectedCompanyId)
      .gte('created_at', auditDateFrom + 'T00:00:00')
      .lte('created_at', auditDateTo + 'T23:59:59')
      .order('created_at', { ascending: false })
      .limit(500)
    if (auditFilterEmp) query = query.eq('employee_id', auditFilterEmp)
    const { data } = await query
    setAuditLogs((data as AuditLogEntry[]) || [])
    setAuditLoading(false)
  }, [selectedCompanyId, auditDateFrom, auditDateTo, auditFilterEmp])

  useEffect(() => { if (tab === 'logs') loadAuditLogs() }, [tab, loadAuditLogs])

  // ── Period Review helpers ──────────────────────────────────────────────────

  const loadPeriodReviews = useCallback(async () => {
    if (!selectedCompanyId) return
    setPrLoading(true)
    const { data } = await supabase.from('pay_period_reviews')
      .select('*')
      .eq('company_id', selectedCompanyId)
      .gte('period_start', prPeriodStart)
      .lte('period_end', prPeriodEnd)
      .order('period_start')
    setPrReviews((data as PeriodReview[]) || [])
    setPrLoading(false)
  }, [selectedCompanyId, prPeriodStart, prPeriodEnd])

  useEffect(() => { if (tab === 'period_review' && employees.length > 0) loadPeriodReviews() }, [tab, loadPeriodReviews, employees.length])

  async function generatePeriodReviews() {
    if (!selectedCompanyId || !session) return
    setPrLoading(true)
    const targetEmps = prSubTab === 'shift' ? shiftEmployees : zeroHoursEmployees

    const { data: checkins } = await supabase.from('checkin_records')
      .select('employee_id, check_in_at, check_out_at, status, shift_assignment_id')
      .eq('company_id', selectedCompanyId)
      .eq('source', 'shifts')
      .in('status', ['checked_out', 'auto_closed'])
      .gte('check_in_at', prPeriodStart + 'T00:00:00')
      .lte('check_in_at', prPeriodEnd + 'T23:59:59')

    const assignmentIds = [...new Set((checkins || []).filter((c: any) => c.shift_assignment_id).map((c: any) => c.shift_assignment_id))]
    const { data: unresolvedCorrections } = assignmentIds.length > 0
      ? await supabase.from('shift_corrections')
          .select('shift_assignment_id')
          .eq('company_id', selectedCompanyId)
          .in('shift_assignment_id', assignmentIds)
          .in('status', ['pending', 'submitted', 'declined'])
      : { data: [] }
    const blockedAssignments = new Set((unresolvedCorrections || []).map((sc: any) => sc.shift_assignment_id))

    const approvedCheckins = (checkins || []).filter((c: any) => !c.shift_assignment_id || !blockedAssignments.has(c.shift_assignment_id))

    const { data: breaks } = await supabase.from('break_records')
      .select('checkin_record_id, start_at, end_at')
      .in('checkin_record_id', approvedCheckins.map(c => (c as any).id))

    const breaksByCheckin = new Map<string, number>()
    for (const b of (breaks || []) as any[]) {
      if (!b.start_at || !b.end_at) continue
      const mins = (new Date(b.end_at).getTime() - new Date(b.start_at).getTime()) / 3600000
      breaksByCheckin.set(b.checkin_record_id, (breaksByCheckin.get(b.checkin_record_id) || 0) + mins)
    }

    const hoursByEmp = new Map<string, number>()
    for (const c of approvedCheckins as any[]) {
      if (!c.check_out_at) continue
      const hrs = (new Date(c.check_out_at).getTime() - new Date(c.check_in_at).getTime()) / 3600000
      const breakHrs = breaksByCheckin.get(c.id) || 0
      const net = Math.max(0, hrs - breakHrs)
      hoursByEmp.set(c.employee_id, (hoursByEmp.get(c.employee_id) || 0) + net)
    }

    let created = 0
    for (const emp of targetEmps) {
      const totalHrs = Math.round((hoursByEmp.get(emp.id) || 0) * 100) / 100
      const rate = emp.hourly_rate || 0
      const existing = prReviews.find(r => r.employee_id === emp.id)
      if (existing) continue

      const { error } = await supabase.from('pay_period_reviews').insert({
        company_id: selectedCompanyId,
        employee_id: emp.id,
        period_start: prPeriodStart,
        period_end: prPeriodEnd,
        total_hours: totalHrs,
        adjusted_hours: totalHrs,
        overtime_hours: 0,
        hourly_rate: rate,
        gross_pay: Math.round(totalHrs * rate * 100) / 100,
        status: 'draft',
      })
      if (!error) created++
    }

    if (created > 0) {
      showSuccess(`Generated ${created} period review(s)`)
      logPayrollAction('Generate Period Reviews', `Generated ${created} review(s) for ${prSubTab} workers — Period: ${prPeriodStart} to ${prPeriodEnd}`)
    } else {
      showError('No new reviews to generate — all employees already have reviews for this period')
    }
    await loadPeriodReviews()
  }

  async function approvePeriodReview(reviewId: string) {
    const adj = prAdjustments[reviewId] || {}
    const review = prReviews.find(r => r.id === reviewId)
    if (!review) return

    const adjustedHrs = adj.hours ?? review.adjusted_hours ?? review.total_hours
    const overtimeHrs = adj.overtime ?? review.overtime_hours
    const rate = review.hourly_rate
    const multiplier = employees.find(e => e.id === review.employee_id)?.overtime_rate_multiplier || 1.5
    const gross = Math.round(((adjustedHrs * rate) + (overtimeHrs * rate * multiplier)) * 100) / 100

    const { error } = await supabase.from('pay_period_reviews').update({
      adjusted_hours: adjustedHrs,
      overtime_hours: overtimeHrs,
      gross_pay: gross,
      status: 'approved',
      approved_by: session?.user?.id,
      approved_at: new Date().toISOString(),
      notes: adj.notes || review.notes,
      updated_at: new Date().toISOString(),
    }).eq('id', reviewId)
    if (error) {
      showError('Failed to approve: ' + error.message)
      logPayrollAction('Approve Period Review', `Failed to approve review for employee ${review.employee_id}: ${error.message}`, review.employee_id, 'error')
    } else {
      const emp = employees.find(e => e.id === review.employee_id)
      showSuccess('Period approved')
      logPayrollAction('Approve Period Review', `Approved period review for ${emp?.first_name ?? ''} ${emp?.last_name ?? ''} — Hours: ${adjustedHrs}, Overtime: ${overtimeHrs}, Gross: £${gross.toFixed(2)}`, review.employee_id)
      loadPeriodReviews()
    }
  }

  async function approveAllPeriodReviews() {
    const drafts = prReviews.filter(r => r.status === 'draft')
    if (drafts.length === 0) { showError('No draft reviews to approve'); return }
    let approved = 0
    for (const review of drafts) {
      const adj = prAdjustments[review.id] || {}
      const adjustedHrs = adj.hours ?? review.adjusted_hours ?? review.total_hours
      const overtimeHrs = adj.overtime ?? review.overtime_hours
      const rate = review.hourly_rate
      const multiplier = employees.find(e => e.id === review.employee_id)?.overtime_rate_multiplier || 1.5
      const gross = Math.round(((adjustedHrs * rate) + (overtimeHrs * rate * multiplier)) * 100) / 100
      const { error } = await supabase.from('pay_period_reviews').update({
        adjusted_hours: adjustedHrs, overtime_hours: overtimeHrs, gross_pay: gross,
        status: 'approved', approved_by: session?.user?.id, approved_at: new Date().toISOString(),
        notes: adj.notes || review.notes, updated_at: new Date().toISOString(),
      }).eq('id', review.id)
      if (!error) approved++
    }
    showSuccess(`Approved ${approved} period review(s)`)
    logPayrollAction('Approve All Period Reviews', `Bulk approved ${approved} of ${drafts.length} draft review(s) — Period: ${prPeriodStart} to ${prPeriodEnd}`)
    loadPeriodReviews()
  }

  async function savePeriodAdjustment(reviewId: string) {
    const adj = prAdjustments[reviewId]
    if (!adj) { showError('No changes to save'); return }
    const review = prReviews.find(r => r.id === reviewId)
    if (!review || review.status !== 'draft') return

    const adjustedHrs = adj.hours ?? review.adjusted_hours ?? review.total_hours
    const overtimeHrs = adj.overtime ?? review.overtime_hours
    const rate = review.hourly_rate
    const multiplier = employees.find(e => e.id === review.employee_id)?.overtime_rate_multiplier || 1.5
    const gross = Math.round(((adjustedHrs * rate) + (overtimeHrs * rate * multiplier)) * 100) / 100

    const { error } = await supabase.from('pay_period_reviews').update({
      adjusted_hours: adjustedHrs,
      overtime_hours: overtimeHrs,
      gross_pay: gross,
      notes: adj.notes || review.notes,
      updated_at: new Date().toISOString(),
    }).eq('id', reviewId)

    if (error) {
      showError('Failed to save: ' + error.message)
      logPayrollAction('Save Period Adjustment', `Failed to save adjustment for review ${reviewId}: ${error.message}`, review.employee_id, 'error')
    } else {
      const emp = employees.find(e => e.id === review.employee_id)
      showSuccess(`Hours saved for ${emp?.first_name ?? ''} ${emp?.last_name ?? ''}`)
      logPayrollAction('Save Period Adjustment', `Saved hours adjustment for ${emp?.first_name ?? ''} ${emp?.last_name ?? ''} — Adjusted: ${adjustedHrs}h, Overtime: ${overtimeHrs}h, Gross: £${gross.toFixed(2)}`, review.employee_id)
      setPrAdjustments(prev => { const next = { ...prev }; delete next[reviewId]; return next })
      loadPeriodReviews()
    }
  }

  function downloadPeriodExportCsv() {
    const approved = prReviews.filter(r => r.status === 'approved' || r.status === 'exported')
    if (approved.length === 0) { showError('No approved reviews to export'); return }
    const headers = ['Employee Name', 'Payroll ID', 'Period Start', 'Period End', 'Total Hours', 'Adjusted Hours', 'Overtime Hours', 'Hourly Rate', 'Overtime Rate', 'Gross Pay']
    const rows = approved.map(r => {
      const emp = employees.find(e => e.id === r.employee_id)
      const multiplier = emp?.overtime_rate_multiplier || 1.5
      return [
        sanitiseCsvCell(`${emp?.first_name ?? ''} ${emp?.last_name ?? ''}`.trim()),
        sanitiseCsvCell(emp?.payroll_id || ''),
        sanitiseCsvCell(formatDate(r.period_start)),
        sanitiseCsvCell(formatDate(r.period_end)),
        r.total_hours.toFixed(2),
        (r.adjusted_hours ?? r.total_hours).toFixed(2),
        r.overtime_hours.toFixed(2),
        r.hourly_rate.toFixed(2),
        (r.hourly_rate * multiplier).toFixed(2),
        r.gross_pay.toFixed(2),
      ]
    })
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `gross-pay-export-${prPeriodStart}-to-${prPeriodEnd}.csv`
    a.click()
    URL.revokeObjectURL(url)

    const totalGross = approved.reduce((s, r) => s + r.gross_pay, 0)
    supabase.from('payroll_exports').insert({
      company_id: selectedCompanyId,
      period_start: prPeriodStart,
      period_end: prPeriodEnd,
      export_target: 'csv',
      employee_count: approved.length,
      total_gross: totalGross,
      exported_by: session?.user?.id,
    })

    for (const r of approved.filter(r => r.status === 'approved')) {
      supabase.from('pay_period_reviews').update({ status: 'exported', updated_at: new Date().toISOString() }).eq('id', r.id)
    }

    showSuccess(`Exported ${approved.length} employees — import this CSV into Sage or Xero`)
    logPayrollAction('Export Gross Pay CSV', `Exported ${approved.length} employee(s) — Total gross: £${totalGross.toFixed(2)}, Period: ${prPeriodStart} to ${prPeriodEnd}`)
    loadPeriodReviews()
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

    // Check next month doesn't already have payslips from any source
    const existingNext = sourcePayslips.filter(p => p.pay_period_start.startsWith(nextKey))
    if (existingNext.length > 0) {
      const existingSources = [...new Set(existingNext.map(p => p.source === 'sage' ? 'Sage' : p.source === 'xero' ? 'Xero' : 'InflowHR'))]
      showError(`Payslips for ${MONTH_NAMES[nextMonth]} ${nextYear} already exist (via ${existingSources.join(', ')})`)
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
      logPayrollAction('Generate Payroll', `Failed to generate payroll for ${MONTH_NAMES[nextMonth]} ${nextYear}: ${errors.length} error(s)`, null, 'error')
    } else if (flaggedCount > 0) {
      showSuccess(`Payroll generated for ${MONTH_NAMES[nextMonth]} ${nextYear} — ${flaggedCount} payslip(s) flagged for review (missing pay details)`)
      logPayrollAction('Generate Payroll', `Generated payroll for ${MONTH_NAMES[nextMonth]} ${nextYear} — ${employees.length} employee(s), ${flaggedCount} flagged`)
    } else {
      showSuccess(`Payroll generated for ${MONTH_NAMES[nextMonth]} ${nextYear}`)
      logPayrollAction('Generate Payroll', `Generated payroll for ${MONTH_NAMES[nextMonth]} ${nextYear} — ${employees.length} employee(s)`)
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
    if (error) {
      showError('Failed to add payslip: ' + error.message)
      logPayrollAction('Add Payslip', `Failed to add payslip for ${emp.first_name} ${emp.last_name}: ${error.message}`, emp.id, 'error')
      setSaving(false)
      return
    }
    showSuccess(isFlagged
      ? `Payslip added for ${emp.first_name} ${emp.last_name} — FLAGGED: missing ${missing.join(', ')}`
      : `Payslip added for ${emp.first_name} ${emp.last_name} — ${MONTH_NAMES[m - 1]} ${y}`)
    logPayrollAction('Add Payslip', `Added payslip for ${emp.first_name} ${emp.last_name} — ${MONTH_NAMES[m - 1]} ${y}, Gross: £${gross.toFixed(2)}, Net: £${(adjustedGross - tax - ni - pension).toFixed(2)}${isFlagged ? ' (FLAGGED)' : ''}`, emp.id)
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
  const modulrConnected = modulrIntegration?.status === 'connected'
  const sourcePayslips = useMemo(() => payslips, [payslips])

  const sanitiseCsvCell = (val: string): string => {
    const s = String(val ?? '')
    if (/^[=+\-@\t\r]/.test(s)) return `'${s}`
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
  }

  const downloadScheduleCsv = (monthPayslips: Payslip[], monthLabel: string, category: string) => {
    if (monthPayslips.length === 0) { showError('No payslip data for this month'); return }
    const headers = ['Employee Name', 'Payroll ID', 'Tax Code', 'Annual Salary', 'Gross Pay', 'Tax', 'National Insurance', 'Pension', 'Other Deductions', 'Net Pay', 'Period Start', 'Period End', 'Payment Date', 'Status']
    const rows = monthPayslips.map(p => [
      sanitiseCsvCell(`${p.employee?.first_name ?? ''} ${p.employee?.last_name ?? ''}`.trim()),
      sanitiseCsvCell(p.payroll_id),
      sanitiseCsvCell(p.tax_code),
      p.annual_salary?.toFixed(2) ?? '0.00',
      p.gross_pay?.toFixed(2) ?? '0.00',
      p.tax?.toFixed(2) ?? '0.00',
      p.national_insurance?.toFixed(2) ?? '0.00',
      p.pension?.toFixed(2) ?? '0.00',
      p.other_deductions?.toFixed(2) ?? '0.00',
      p.net_pay?.toFixed(2) ?? '0.00',
      sanitiseCsvCell(formatDate(p.pay_period_start)),
      sanitiseCsvCell(formatDate(p.pay_period_end)),
      sanitiseCsvCell(formatDate(p.payment_date)),
      sanitiseCsvCell(p.status),
    ])
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `payroll-${category}-${monthLabel}.csv`
    a.click()
    URL.revokeObjectURL(url)
    logPayrollAction('Download Schedule CSV', `Downloaded payroll CSV — ${category}, ${monthLabel}, ${monthPayslips.length} record(s)`)
  }

  const employedEmployees = useMemo(() => employees.filter(e => e.employment_category !== 'shift_worker'), [employees])
  const shiftEmployees = useMemo(() => employees.filter(e => e.employment_category === 'shift_worker' && e.contract_type !== 'Zero hours shift worker'), [employees])
  const zeroHoursEmployees = useMemo(() => employees.filter(e => e.employment_category === 'shift_worker' && e.contract_type === 'Zero hours shift worker'), [employees])

  const empCategoryById = useMemo(() => {
    const map: Record<string, string> = {}
    employees.forEach(e => { map[e.id] = e.employment_category || 'not_assigned' })
    return map
  }, [employees])

  const filtered = useMemo(() => {
    const base = sourcePayslips.filter(p => {
      if (filterStatus && p.status !== filterStatus) return false
      if (filterEmployee && p.employee && `${p.employee.first_name} ${p.employee.last_name}` !== filterEmployee) return false
      if (p.employee?.id) {
        const cat = empCategoryById[p.employee.id] || 'not_assigned'
        if (payslipSubTab === 'shift' && cat !== 'shift_worker') return false
        if (payslipSubTab === 'employed' && cat === 'shift_worker') return false
      }
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
  }, [filterStatus, filterEmployee, sourcePayslips, search, payslipSubTab, empCategoryById])

  const groupedByMonth = useMemo(() => {
    const groups: { key: string; label: string; payslips: Payslip[] }[] = []
    const map = new Map<string, Payslip[]>()
    filtered.forEach(p => {
      const d = new Date(p.pay_period_start + 'T00:00:00')
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(p)
    })
    const sortedKeys = Array.from(map.keys()).sort((a, b) => b.localeCompare(a))
    sortedKeys.forEach(key => {
      const [yr, mo] = key.split('-').map(Number)
      const label = `${MONTH_NAMES[mo - 1]} ${yr}`
      groups.push({ key, label, payslips: map.get(key)! })
    })
    return groups
  }, [filtered])

  useEffect(() => {
    if (groupedByMonth.length > 0) {
      const latestKey = groupedByMonth[0].key
      const olderKeys = groupedByMonth.slice(1).map(g => g.key)
      setCollapsedMonths(new Set(olderKeys.filter(k => k !== latestKey)))
    }
  }, [groupedByMonth.length])

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
        const [assignRes, ciRes] = await Promise.all([
          supabase.from('shift_assignments')
            .select('id, employee_id, date, shift_templates(name, start_time, end_time, break_minutes), rotas(status)')
            .eq('company_id', selectedCompanyId)
            .gte('date', tbPeriodStart).lte('date', tbPeriodEnd),
          supabase.from('checkin_records')
            .select('id, employee_id, shift_assignment_id, check_in_at, check_out_at, status')
            .eq('company_id', selectedCompanyId).eq('source', 'shifts')
            .gte('check_in_at', tbPeriodStart + 'T00:00:00').lte('check_in_at', tbPeriodEnd + 'T23:59:59'),
        ])
        const ciByAssignment: Record<string, any[]> = {}
        if (ciRes.data) {
          for (const ci of ciRes.data as any[]) {
            if (ci.shift_assignment_id) {
              if (!ciByAssignment[ci.shift_assignment_id]) ciByAssignment[ci.shift_assignment_id] = []
              ciByAssignment[ci.shift_assignment_id].push(ci)
            }
          }
        }
        if (assignRes.data) {
          for (const row of assignRes.data as any[]) {
            if (!result[row.employee_id]) continue
            const rota = row.rotas as any
            if (rota?.status === 'draft') continue
            const tmpl = row.shift_templates as any
            if (!tmpl) continue
            const startMins = parseInt(tmpl.start_time?.split(':')[0]) * 60 + parseInt(tmpl.start_time?.split(':')[1] || '0')
            const endMins = parseInt(tmpl.end_time?.split(':')[0]) * 60 + parseInt(tmpl.end_time?.split(':')[1] || '0')
            const scheduledHrs = Math.max(0, (endMins - startMins - (tmpl.break_minutes || 0)) / 60)
            const checkins = ciByAssignment[row.id] || []
            const firstIn = checkins.length > 0 ? checkins.reduce((earliest: any, c: any) => c.check_in_at < earliest.check_in_at ? c : earliest).check_in_at : null
            const lastOut = checkins.filter((c: any) => c.check_out_at).length > 0 ? checkins.filter((c: any) => c.check_out_at).reduce((latest: any, c: any) => c.check_out_at > latest.check_out_at ? c : latest).check_out_at : null
            const actualMins = checkins.reduce((sum: number, c: any) => {
              if (!c.check_out_at) return sum
              return sum + (new Date(c.check_out_at).getTime() - new Date(c.check_in_at).getTime()) / 60000
            }, 0)
            const actualHrs = actualMins / 60
            const noCheckin = checkins.length === 0
            const forgotCheckout = checkins.some((c: any) => c.status === 'auto_closed')
            result[row.employee_id].shiftHrs += scheduledHrs
            result[row.employee_id].shiftEntries.push({
              ...row, shiftName: tmpl.name, start_time: tmpl.start_time, end_time: tmpl.end_time,
              breakMins: tmpl.break_minutes, hrs: scheduledHrs, firstIn, lastOut, actualHrs, noCheckin, forgotCheckout,
            })
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
    logPayrollAction('Export Legal Timesheets CSV', `Exported ${rows.length} legal timesheet entries — Period: ${anPeriodStart} to ${anPeriodEnd}`)
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
    logPayrollAction('Export Shifts CSV', `Exported ${rows.length} shift entries — Period: ${anPeriodStart} to ${anPeriodEnd}`)
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
    logPayrollAction('Export Adjustments CSV', `Exported ${rows.length} adjustment entries — Period: ${anPeriodStart} to ${anPeriodEnd}`)
  }

  // ── Payslip source toggle ──

  async function togglePayslipSource(source: 'inflowhr' | 'xero' | 'sage') {
    if (!selectedCompanyId) return

    if (source === 'inflowhr' && (activeSource === 'xero' || activeSource === 'sage')) {
      setShowXeroDisconnectModal(true)
      return
    }

    const now = new Date()
    const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const { count } = await supabase.from('payslips').select('id', { count: 'exact', head: true })
      .eq('company_id', selectedCompanyId).like('pay_period', `${monthStr}%`)
    if ((count ?? 0) > 0 && !confirm(`Payslips already exist for this month. Switching provider mid-period may cause duplicate or inconsistent data. Continue?`)) return

    if (source === 'xero' && xeroIntegration) {
      const { error } = await supabase.from('xero_integrations').update({ payslip_source: source, updated_at: new Date().toISOString() }).eq('company_id', selectedCompanyId)
      if (error) { showError('Failed to update: ' + error.message); return }
    } else if (source === 'sage' && sageIntegration) {
      const { error } = await supabase.from('sage_integrations').update({ payslip_source: source, updated_at: new Date().toISOString() }).eq('company_id', selectedCompanyId)
      if (error) { showError('Failed to update: ' + error.message); return }
    }
    const label = source === 'xero' ? 'Xero' : source === 'sage' ? 'Sage' : 'InflowHR'
    showSuccess(`Switched to ${label} Payslips`)
    logPayrollAction('Switch Payslip Source', `Switched payslip source to ${label}`)
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
      logPayrollAction('Submit Payroll', `Downloaded & paid ${monthName} ${yearStr} — ${payableSlips.length} paid, ${flaggedSlips.length} flagged (excluded)`)
    } else {
      showSuccess(`${monthName} ${yearStr} payroll downloaded and marked as paid`)
      logPayrollAction('Submit Payroll', `Downloaded & paid ${monthName} ${yearStr} — ${monthPayslips.length} payslip(s) marked as paid`)
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
      logPayrollAction('Xero Sync', `Synced ${(result.payslips || []).length} payslip(s) from Xero`)
      loadAll()
    } else {
      logPayrollAction('Xero Sync', 'Failed to sync payslips from Xero', null, 'error')
    }
  }

  async function handleSagePdfUpload(file: File) {
    setSageUploading(true)
    setSageUploadResult(null)
    setSageScanStatus(null)
    try {
      const token = session?.access_token
      if (!token) { showError('Not authenticated'); setSageUploading(false); return }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const storagePath = `${selectedCompanyId}/${timestamp}_${file.name}`
      const { error: uploadErr } = await supabase.storage
        .from('sage-payslips')
        .upload(storagePath, file, { upsert: false })
      if (uploadErr) { showError(`Upload failed: ${uploadErr.message}`); setSageUploading(false); return }

      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sage-upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ company_id: selectedCompanyId, file_path: storagePath, filename: file.name }),
      })

      const data = await resp.json()
      if (!resp.ok) { showError(data.error || 'Upload failed'); setSageUploading(false); return }

      setSageUploadResult(data)
      showSuccess(`${data.matched.length} payslip(s) imported successfully`)
      logPayrollAction('Sage Import', `Imported ${data.matched.length} payslip(s) from Sage PDF: ${file.name}`)
      loadAll()

      setSageScanStatus('scanning')
      fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/scan-document`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          storagePath,
          documentId: storagePath,
          bucket: 'sage-payslips',
          tableName: 'sage-payslips',
        }),
      }).then(r => r.json()).then(result => {
        setSageScanStatus(result.status || 'error')
      }).catch(() => { setSageScanStatus('error') })
    } catch (err: any) {
      showError('Failed to process file: ' + (err.message || 'Unknown error'))
      logPayrollAction('Sage Import', `Failed to import Sage PDF: ${file.name} — ${(err as Error).message || 'Unknown error'}`, null, 'error')
    }
    setSageUploading(false)
  }

  // ── BACS Export helpers ────────────────────────────────────────────────

  function getBacsPayslipData() {
    const latestByEmp = new Map<string, Payslip>()
    for (const p of payslips) {
      if (p.status !== 'processed') continue
      const empId = p.employee?.id
      if (!empId) continue
      const existing = latestByEmp.get(empId)
      if (!existing || p.pay_period_start > existing.pay_period_start) {
        latestByEmp.set(empId, p)
      }
    }
    return employees.map(emp => {
      const p = latestByEmp.get(emp.id)
      const edits = bacsEdits[emp.id] || {}
      const sortCode = (edits.sort_code ?? emp.bank_sort_code ?? '').replace(/[-\s]/g, '')
      const accountNo = (edits.account_number ?? emp.bank_account_number ?? '').replace(/\s/g, '')
      const monthLabel = p ? MONTH_NAMES[new Date(p.pay_period_start).getMonth()] : ''
      return {
        employee: emp,
        payslip: p,
        net_pay: p?.net_pay ?? 0,
        sort_code: sortCode,
        account_number: accountNo,
        reference: `SALARY ${monthLabel}`.substring(0, 18),
        valid: /^\d{6}$/.test(sortCode) && /^\d{8}$/.test(accountNo) && (p?.net_pay ?? 0) > 0,
      }
    }).filter(r => r.payslip)
  }

  function downloadBacsFile() {
    const rows = getBacsPayslipData()
    if (!rows.length) { showError('No processed payslips found'); return }
    if (!bacsOriginatorSortCode || !bacsOriginatorAccountNo) {
      showError('Please set your company originating sort code and account number')
      return
    }
    const invalid = rows.filter(r => !r.valid)
    if (invalid.length > 0) {
      showError(`${invalid.length} employee(s) have missing or invalid bank details`)
      return
    }
    const origSc = bacsOriginatorSortCode.replace(/[-\s]/g, '').padEnd(6, '0')
    const origAn = bacsOriginatorAccountNo.replace(/\s/g, '').padStart(8, '0')
    const lines = rows.map(r => {
      const amountPence = Math.round(r.net_pay * 100).toString().padStart(11, '0')
      const beneficiary = (r.employee.bank_account_name || `${r.employee.first_name} ${r.employee.last_name}`).substring(0, 18).padEnd(18, ' ')
      const ref = r.reference.padEnd(18, ' ')
      return `${r.sort_code},${r.account_number},00,99,${origSc},${origAn},${amountPence},${beneficiary},${ref}`
    })
    const csv = lines.join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `BACS_PayRun_${localDateStr(new Date())}.csv`
    a.click()
    URL.revokeObjectURL(url)
    const totalPay = rows.reduce((s, r) => s + r.net_pay, 0)
    showSuccess(`BACS file downloaded with ${rows.length} payments`)
    logPayrollAction('Download BACS File', `Downloaded BACS file — ${rows.length} payment(s), Total: £${totalPay.toFixed(2)}`)
  }

  async function saveBacsOriginator() {
    const { error } = await supabase.from('companies').update({
      bacs_originator_sort_code: bacsOriginatorSortCode.replace(/[-\s]/g, ''),
      bacs_originator_account_no: bacsOriginatorAccountNo.replace(/\s/g, ''),
      bacs_originator_name: bacsOriginatorName,
    }).eq('id', selectedCompanyId)
    if (error) showError('Failed to save: ' + error.message)
    else showSuccess('Originator details saved')
  }

  // ── Modulr Payout helpers ────────────────────────────────────────────────

  async function fetchModulrBalance() {
    if (!session) return
    setModulrBalanceLoading(true)
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
      const res = await fetch(`${supabaseUrl}/functions/v1/modulr-balance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ company_id: selectedCompanyId }),
      })
      const data = await res.json()
      if (res.ok) setModulrBalance(data.balance)
      else showError(data.error || 'Failed to fetch balance')
    } catch { showError('Network error fetching Modulr balance') }
    setModulrBalanceLoading(false)
  }

  function getModulrPayoutData() {
    const latestByEmp = new Map<string, Payslip>()
    for (const p of payslips) {
      if (p.status !== 'processed') continue
      const empId = p.employee?.id
      if (!empId) continue
      const existing = latestByEmp.get(empId)
      if (!existing || p.pay_period_start > existing.pay_period_start) {
        latestByEmp.set(empId, p)
      }
    }
    return employees.map(emp => {
      const p = latestByEmp.get(emp.id)
      const sortCode = (emp.bank_sort_code ?? '').replace(/[-\s]/g, '')
      const accountNo = (emp.bank_account_number ?? '').replace(/\s/g, '')
      const monthLabel = p ? MONTH_NAMES[new Date(p.pay_period_start).getMonth()] : ''
      const validBank = /^\d{6}$/.test(sortCode) && /^\d{8}$/.test(accountNo)
      return {
        employee: emp,
        payslip: p,
        net_pay: p?.net_pay ?? 0,
        sort_code: sortCode,
        account_number: accountNo,
        reference: `SALARY ${monthLabel}`.substring(0, 18),
        status: !p ? 'no_payslip' as const : !validBank ? 'error' as const : 'ready' as const,
      }
    }).filter(r => r.payslip)
  }

  async function submitModulrPayout() {
    if (!session) return
    setModulrSubmitting(true)
    const rows = getModulrPayoutData().filter(r => r.status === 'ready')
    const payrunRef = `PAY_${localDateStr(new Date())}_${selectedCompanyId.substring(0, 8)}`

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
      const res = await fetch(`${supabaseUrl}/functions/v1/modulr-payout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({
          company_id: selectedCompanyId,
          payrun_ref: payrunRef,
          payments: rows.map(r => ({
            employee_id: r.employee.id,
            employee_name: `${r.employee.first_name} ${r.employee.last_name}`,
            amount: r.net_pay,
            sort_code: r.sort_code,
            account_number: r.account_number,
            reference: r.reference,
          })),
        }),
      })
      const data = await res.json()
      if (res.ok) {
        showSuccess(`Batch payout submitted: ${data.employee_count} payments, £${data.total_amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`)
        logPayrollAction('Modulr Payout', `Submitted batch payout — ${data.employee_count} payment(s), Total: £${data.total_amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`)
        setShowModulrConfirmModal(false)
        fetchModulrBalance()
      } else {
        showError(data.error || 'Payout submission failed')
        logPayrollAction('Modulr Payout', `Failed to submit payout: ${data.error || 'Unknown error'}`, null, 'error')
      }
    } catch { showError('Network error submitting payout'); logPayrollAction('Modulr Payout', 'Network error submitting Modulr payout', null, 'error') }
    setModulrSubmitting(false)
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
              This will switch the admin payslip view to InflowHR. Employees will still see all existing payslips from every source. The {activeSource === 'xero' ? 'Xero' : 'Sage'} integration remains connected — you can switch back at any time.
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
        {(enabledFeatures.shifts) && (
          <button className={`admin-tab ${tab === 'period_review' ? 'admin-tab-active' : ''}`} onClick={() => setTab('period_review')}>Period Review</button>
        )}
        {features.modulr_integration && (
          <button className={`admin-tab ${tab === 'bacs_export' ? 'admin-tab-active' : ''}`} onClick={() => setTab('bacs_export')}>BACS Export</button>
        )}
        {features.modulr_integration && (
          <button className={`admin-tab ${tab === 'modulr_payout' ? 'admin-tab-active' : ''}`} onClick={() => { setTab('modulr_payout'); if (modulrConnected && modulrBalance === null) fetchModulrBalance() }}>Modulr Payouts</button>
        )}
        <button className={`admin-tab ${tab === 'schedule' ? 'admin-tab-active' : ''}`} onClick={() => setTab('schedule')}>Payroll Schedule</button>
        {(enabledFeatures.timesheets || enabledFeatures.shifts || enabledFeatures.legal_timesheets) && (
          <>
            <button className={`admin-tab ${tab === 'time_breakdown' ? 'admin-tab-active' : ''}`} onClick={() => setTab('time_breakdown')}>Time Breakdown</button>
            <button className={`admin-tab ${tab === 'analytics' ? 'admin-tab-active' : ''}`} onClick={() => setTab('analytics')}>Analytics</button>
          </>
        )}
        <button className={`admin-tab ${tab === 'logs' ? 'admin-tab-active' : ''}`} onClick={() => setTab('logs')}>Logs</button>
      </div>

      {tab === 'payslips' && (
        <>
          {/* Employed / Shift sub-tabs */}
          <div style={{ display: 'flex', gap: 0, marginBottom: 12 }}>
            <button
              onClick={() => { setPayslipSubTab('employed'); setPage(1) }}
              style={{
                padding: '8px 20px', fontSize: 13, fontWeight: 600, border: '1px solid var(--border, #e5e7eb)',
                borderRadius: '8px 0 0 8px', cursor: 'pointer',
                background: payslipSubTab === 'employed' ? 'var(--primary, #5c6bc0)' : 'var(--bg-card, #fff)',
                color: payslipSubTab === 'employed' ? '#fff' : 'var(--text, #1a1a2e)',
              }}
            >
              Employed Payslips
            </button>
            <button
              onClick={() => { setPayslipSubTab('shift'); setPage(1) }}
              style={{
                padding: '8px 20px', fontSize: 13, fontWeight: 600, border: '1px solid var(--border, #e5e7eb)',
                borderLeft: 'none', borderRadius: '0 8px 8px 0', cursor: 'pointer',
                background: payslipSubTab === 'shift' ? '#7e57c2' : 'var(--bg-card, #fff)',
                color: payslipSubTab === 'shift' ? '#fff' : 'var(--text, #1a1a2e)',
              }}
            >
              Shift Payslips
            </button>
          </div>

          {(xeroConnected || sageConnected) && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', marginBottom: 12,
              background: 'var(--bg-card, #fff)', borderRadius: 8, border: '1px solid var(--border, #e5e7eb)',
            }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted, #6b7280)' }}>Payroll Provider:</span>
              <select
                className="admin-select"
                value={activeSource}
                onChange={e => togglePayslipSource(e.target.value as 'inflowhr' | 'xero' | 'sage')}
                style={{ fontSize: 13, padding: '4px 8px', minWidth: 120 }}
              >
                <option value="inflowhr">InflowHR</option>
                {xeroConnected && <option value="xero">Xero</option>}
                {sageConnected && <option value="sage">Sage</option>}
              </select>
              <span style={{
                fontSize: 11, fontWeight: 600, padding: '2px 10px', borderRadius: 10, marginLeft: 4,
                background: activeSource === 'sage' ? '#e0f2e9' : activeSource === 'xero' ? '#dbeafe' : '#f3f0ff',
                color: activeSource === 'sage' ? '#166534' : activeSource === 'xero' ? '#1e40af' : '#5b21b6',
              }}>
                {activeSource === 'xero' ? 'Xero' : activeSource === 'sage' ? 'Sage' : 'InflowHR'} Active
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-muted, #6b7280)', marginLeft: 'auto' }}>
                Controls which tools appear for new payslips
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
            <>
              {filtered.length === 0 && <div className="admin-empty">No payslips found</div>}
              {groupedByMonth.map((group, groupIdx) => {
                const isCollapsed = collapsedMonths.has(group.key)
                const gPaid = group.payslips.filter(p => p.status === 'paid').length
                const gDraft = group.payslips.filter(p => p.status === 'draft').length
                const gProcessed = group.payslips.filter(p => p.status === 'processed').length
                const gFlagged = group.payslips.filter(p => p.status === 'flagged').length
                const gGross = group.payslips.reduce((s, p) => s + Number(p.gross_pay), 0)
                const gNet = group.payslips.reduce((s, p) => s + Number(p.net_pay), 0)
                const isLatest = groupIdx === 0

                return (
                  <div key={group.key} style={{ marginBottom: 16, border: '1px solid var(--border, #e5e7eb)', borderRadius: 10, overflow: 'hidden' }}>
                    {/* Month header */}
                    <div
                      onClick={() => setCollapsedMonths(prev => {
                        const next = new Set(prev)
                        if (next.has(group.key)) next.delete(group.key)
                        else next.add(group.key)
                        return next
                      })}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: 'pointer',
                        background: isLatest ? 'var(--primary, #5c6bc0)' : 'var(--bg-secondary, #f5f6fa)',
                        color: isLatest ? '#fff' : 'var(--text, #1a1a2e)',
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, transition: 'transform 0.2s', transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>
                        <polyline points="6 9 12 15 18 9"/>
                      </svg>
                      <span style={{ fontWeight: 700, fontSize: 15 }}>{group.label}</span>
                      {isLatest && <span style={{ fontSize: 11, fontWeight: 600, background: 'rgba(255,255,255,0.2)', padding: '2px 8px', borderRadius: 8 }}>Current</span>}
                      <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', flexWrap: 'wrap', alignItems: 'center' }}>
                        <span style={{ fontSize: 12 }}>{group.payslips.length} payslip{group.payslips.length !== 1 ? 's' : ''}</span>
                        {gPaid > 0 && <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: isLatest ? 'rgba(255,255,255,0.2)' : '#dcfce7', color: isLatest ? '#fff' : '#166534' }}>{gPaid} paid</span>}
                        {gProcessed > 0 && <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: isLatest ? 'rgba(255,255,255,0.2)' : '#dbeafe', color: isLatest ? '#fff' : '#1e40af' }}>{gProcessed} processed</span>}
                        {gDraft > 0 && <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: isLatest ? 'rgba(255,255,255,0.2)' : '#fef3c7', color: isLatest ? '#fff' : '#92400e' }}>{gDraft} draft</span>}
                        {gFlagged > 0 && <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: isLatest ? 'rgba(255,255,255,0.15)' : '#fef2f2', color: isLatest ? '#fca5a5' : '#dc2626' }}>{gFlagged} flagged</span>}
                        <span style={{ fontSize: 12, opacity: 0.8 }}>Gross: £{gGross.toLocaleString('en-GB', { minimumFractionDigits: 2 })}</span>
                        <span style={{ fontSize: 12, fontWeight: 600 }}>Net: £{gNet.toLocaleString('en-GB', { minimumFractionDigits: 2 })}</span>
                      </div>
                    </div>

                    {/* Expanded content */}
                    {!isCollapsed && (
                      <div style={{ padding: '0' }}>
                        {/* Bulk actions bar */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', background: 'var(--bg-card, #fff)', borderBottom: '1px solid var(--border, #e5e7eb)', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted, #6b7280)' }}>Bulk Actions:</span>
                          <button className="admin-btn-sm" disabled={bulkUpdating} onClick={() => bulkUpdateMonthStatus(group.payslips, 'draft', group.key)} style={{ fontSize: 11 }}>All → Draft</button>
                          <button className="admin-btn-sm" disabled={bulkUpdating} onClick={() => bulkUpdateMonthStatus(group.payslips, 'processed', group.key)} style={{ fontSize: 11 }}>All → Processed</button>
                          <button className="admin-btn-sm" disabled={bulkUpdating} onClick={() => bulkUpdateMonthStatus(group.payslips, 'paid', group.key)} style={{ fontSize: 11 }}>All → Paid</button>
                          {gDraft > 0 && (
                            <button className="admin-btn-sm admin-btn-danger" disabled={bulkUpdating} onClick={() => deleteDraftMonth(group.key, group.payslips)} style={{ fontSize: 11, marginLeft: 'auto' }}>
                              Delete {gDraft} Draft{gDraft !== 1 ? 's' : ''}
                            </button>
                          )}
                        </div>

                        <div className="admin-table-wrap">
                          <table className="admin-table">
                            <thead><tr><th>Ref</th><th>Employee</th><th>Source</th><th>Gross</th><th>Tax</th><th>NI</th><th>Pension</th><th>Net</th><th>Status</th><th>Actions</th></tr></thead>
                            <tbody>
                              {group.payslips.map(p => {
                                const isPaid = p.status === 'paid'
                                const isDraft = p.status === 'draft'
                                return (
                                  <React.Fragment key={p.id}>
                                    <tr className={`${expandedId === p.id ? 'admin-row-active' : ''} ${p.status === 'flagged' ? 'admin-row-flagged' : ''}`}>
                                      <td className="admin-td-mono">{p.reference_number}</td>
                                      <td>{p.employee ? `${p.employee.first_name} ${p.employee.last_name}` : '—'}</td>
                                      <td><span style={{
                                        fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
                                        background: p.source === 'sage' ? '#e0f2e9' : p.source === 'xero' ? '#dbeafe' : '#f3f0ff',
                                        color: p.source === 'sage' ? '#166534' : p.source === 'xero' ? '#1e40af' : '#5b21b6',
                                      }}>{p.source === 'sage' ? 'Sage' : p.source === 'xero' ? 'Xero' : 'InflowHR'}</span></td>
                                      <td>£{Number(p.gross_pay).toFixed(2)}</td>
                                      <td>£{Number(p.tax).toFixed(2)}</td>
                                      <td>£{Number(p.national_insurance).toFixed(2)}</td>
                                      <td>£{Number(p.pension).toFixed(2)}</td>
                                      <td><strong>£{Number(p.net_pay).toFixed(2)}</strong></td>
                                      <td>
                                        <select
                                          className="admin-inline-select"
                                          value={p.status}
                                          onChange={e => updatePayslipStatus(p.id, e.target.value)}
                                          style={{ fontSize: 11, padding: '2px 6px', minWidth: 90, borderRadius: 6, fontWeight: 600 }}
                                        >
                                          <option value="flagged">Flagged</option>
                                          <option value="draft">Draft</option>
                                          <option value="processed">Processed</option>
                                          <option value="paid">Paid</option>
                                        </select>
                                      </td>
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
                                            {!isPaid && (
                                              <button className="admin-btn-icon" onClick={() => startEdit(p)}>
                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                              </button>
                                            )}
                                            {isDraft && (
                                              <button className="admin-btn-icon admin-btn-danger" onClick={() => deletePayslip(p.id)}>
                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                                              </button>
                                            )}
                                          </>
                                        )}
                                      </td>
                                    </tr>
                                    {expandedId === p.id && (
                                      <tr className="admin-expanded-row">
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
                                  </React.Fragment>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </>
          )}
        </>
      )}

      {/* ── BACS Export Tab ── */}
      {tab === 'bacs_export' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text, #1a1a2e)' }}>Standard 18 BACS Export</h3>
            <button className="admin-btn admin-btn-primary" onClick={downloadBacsFile} style={{ fontSize: 13 }}>
              Download Standard 18 BACS File (.csv)
            </button>
          </div>

          <div style={{ border: '1px solid var(--border, #e0e0e0)', borderRadius: 8, padding: 16, marginBottom: 16, background: 'rgba(248,249,255,.5)' }}>
            <p style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 600, color: 'var(--text, #333)' }}>Company Originator Details</p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, color: 'var(--text-muted, #666)' }}>Sort Code</label>
                <input
                  type="text" value={bacsOriginatorSortCode}
                  onChange={e => setBacsOriginatorSortCode(e.target.value.replace(/[^\d-]/g, '').substring(0, 8))}
                  placeholder="123456" maxLength={8}
                  style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border, #ddd)', fontSize: 13, fontFamily: 'monospace', width: 100 }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, color: 'var(--text-muted, #666)' }}>Account No</label>
                <input
                  type="text" value={bacsOriginatorAccountNo}
                  onChange={e => setBacsOriginatorAccountNo(e.target.value.replace(/\D/g, '').substring(0, 8))}
                  placeholder="12345678" maxLength={8}
                  style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border, #ddd)', fontSize: 13, fontFamily: 'monospace', width: 100 }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, color: 'var(--text-muted, #666)' }}>Company Name</label>
                <input
                  type="text" value={bacsOriginatorName}
                  onChange={e => setBacsOriginatorName(e.target.value.substring(0, 18))}
                  placeholder="Company Name" maxLength={18}
                  style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border, #ddd)', fontSize: 13, width: 160 }}
                />
              </div>
              <button className="admin-btn" onClick={saveBacsOriginator} style={{ fontSize: 12 }}>Save</button>
            </div>
          </div>

          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Sort Code</th>
                  <th>Account No</th>
                  <th>Net Pay</th>
                  <th>Reference</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {getBacsPayslipData().map(row => {
                  const scValid = /^\d{6}$/.test(row.sort_code)
                  const anValid = /^\d{8}$/.test(row.account_number)
                  return (
                    <tr key={row.employee.id}>
                      <td><strong>{row.employee.first_name} {row.employee.last_name}</strong></td>
                      <td>
                        <input
                          type="text"
                          value={bacsEdits[row.employee.id]?.sort_code ?? row.employee.bank_sort_code ?? ''}
                          onChange={e => setBacsEdits(prev => ({ ...prev, [row.employee.id]: { ...prev[row.employee.id], sort_code: e.target.value.replace(/[^\d-]/g, '').substring(0, 8) } }))}
                          maxLength={8}
                          style={{
                            padding: '4px 8px', borderRadius: 4, fontSize: 13, fontFamily: 'monospace', width: 80,
                            border: `1px solid ${scValid ? 'var(--border, #ddd)' : '#ef4444'}`,
                            background: scValid ? 'var(--bg, #fff)' : 'rgba(239,68,68,0.05)',
                          }}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={bacsEdits[row.employee.id]?.account_number ?? row.employee.bank_account_number ?? ''}
                          onChange={e => setBacsEdits(prev => ({ ...prev, [row.employee.id]: { ...prev[row.employee.id], account_number: e.target.value.replace(/\D/g, '').substring(0, 8) } }))}
                          maxLength={8}
                          style={{
                            padding: '4px 8px', borderRadius: 4, fontSize: 13, fontFamily: 'monospace', width: 90,
                            border: `1px solid ${anValid ? 'var(--border, #ddd)' : '#ef4444'}`,
                            background: anValid ? 'var(--bg, #fff)' : 'rgba(239,68,68,0.05)',
                          }}
                        />
                      </td>
                      <td style={{ fontWeight: 600 }}>£{row.net_pay.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted, #666)' }}>{row.reference}</td>
                      <td>
                        {row.valid
                          ? <span className="admin-badge admin-badge-approved">Ready</span>
                          : <span className="admin-badge admin-badge-rejected">Missing Details</span>}
                      </td>
                    </tr>
                  )
                })}
                {getBacsPayslipData().length === 0 && (
                  <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted, #888)' }}>No processed payslips found for the current period</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Modulr Payouts Tab ── */}
      {tab === 'modulr_payout' && (
        <div>
          {!modulrConnected ? (
            <div style={{ border: '1px solid var(--border, #e0e0e0)', borderRadius: 12, padding: 32, textAlign: 'center', background: 'rgba(248,249,255,.5)' }}>
              <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700, color: 'var(--text, #1a1a2e)' }}>Enable 1-Click Instant Faster Payments</h3>
              <p style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--text-muted, #666)' }}>
                Connect your Modulr account to submit batch payouts directly from InflowHR.
              </p>
              <button className="admin-btn admin-btn-primary" onClick={() => window.location.hash = ''} style={{ fontSize: 14, padding: '10px 24px' }}>
                <a href="/admin/integrations" style={{ color: 'inherit', textDecoration: 'none' }}>Connect Modulr Account</a>
              </button>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text, #1a1a2e)' }}>Modulr Direct Payouts</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    padding: '8px 16px', borderRadius: 8, fontSize: 14, fontWeight: 700,
                    background: modulrBalance !== null && modulrBalance >= 0 ? 'rgba(232,245,233,.5)' : 'rgba(255,235,238,.5)',
                    color: modulrBalance !== null && modulrBalance >= 0 ? '#2e7d32' : '#c62828',
                    border: `1px solid ${modulrBalance !== null && modulrBalance >= 0 ? '#a5d6a7' : '#ef9a9a'}`,
                  }}>
                    {modulrBalanceLoading ? 'Loading...' : modulrBalance !== null
                      ? `Available Balance: £${modulrBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                      : 'Balance unavailable'}
                  </div>
                  <button className="admin-btn" onClick={fetchModulrBalance} disabled={modulrBalanceLoading} style={{ fontSize: 12 }}>Refresh</button>
                </div>
              </div>

              {(() => {
                const payoutData = getModulrPayoutData()
                const readyRows = payoutData.filter(r => r.status === 'ready')
                const totalNet = readyRows.reduce((s, r) => s + r.net_pay, 0)
                const insufficientFunds = modulrBalance !== null && totalNet > modulrBalance

                return (
                  <>
                    <div className="admin-table-wrap">
                      <table className="admin-table">
                        <thead>
                          <tr>
                            <th>Employee</th>
                            <th>Bank Details</th>
                            <th>Net Amount</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {payoutData.map(row => (
                            <tr key={row.employee.id} style={row.status === 'error' ? { background: 'rgba(239,68,68,0.04)' } : undefined}>
                              <td><strong>{row.employee.first_name} {row.employee.last_name}</strong></td>
                              <td style={{ fontFamily: 'monospace', fontSize: 13 }}>
                                {row.sort_code && row.account_number
                                  ? `${row.sort_code.substring(0, 2)}-${row.sort_code.substring(2, 4)}-${row.sort_code.substring(4)} / ${row.account_number}`
                                  : <span style={{ color: '#dc2626' }}>Missing</span>}
                              </td>
                              <td style={{ fontWeight: 600 }}>£{row.net_pay.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                              <td>
                                {row.status === 'ready' && <span className="admin-badge admin-badge-approved">Ready</span>}
                                {row.status === 'error' && <span className="admin-badge admin-badge-rejected">Error</span>}
                                {row.status === 'no_payslip' && <span className="admin-badge admin-badge-pending">No Payslip</span>}
                              </td>
                            </tr>
                          ))}
                          {payoutData.length === 0 && (
                            <tr><td colSpan={4} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted, #888)' }}>No processed payslips found</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    {readyRows.length > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, padding: 16, borderRadius: 8, background: insufficientFunds ? 'rgba(255,235,238,.5)' : 'rgba(232,245,233,.5)', border: `1px solid ${insufficientFunds ? '#ef9a9a' : '#a5d6a7'}` }}>
                        <div>
                          <strong style={{ fontSize: 14 }}>{readyRows.length} payments</strong>
                          <span style={{ fontSize: 14, marginLeft: 8 }}>totalling <strong>£{totalNet.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong></span>
                          {insufficientFunds && <p style={{ margin: '4px 0 0', fontSize: 12, color: '#dc2626', fontWeight: 600 }}>Insufficient Modulr balance</p>}
                        </div>
                        <button
                          className="admin-btn admin-btn-primary"
                          onClick={() => setShowModulrConfirmModal(true)}
                          disabled={insufficientFunds || modulrSubmitting}
                          style={{ fontSize: 14, padding: '10px 20px' }}
                        >
                          Submit Batch Payout via Modulr
                        </button>
                      </div>
                    )}
                  </>
                )
              })()}
            </>
          )}
        </div>
      )}

      {/* Modulr Confirmation Modal */}
      {showModulrConfirmModal && (() => {
        const readyRows = getModulrPayoutData().filter(r => r.status === 'ready')
        const totalNet = readyRows.reduce((s, r) => s + r.net_pay, 0)
        return (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
            <div style={{ background: 'var(--bg-card, #fff)', borderRadius: 12, padding: 24, maxWidth: 480, width: '90%' }}>
              <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700, color: 'var(--text, #1a1a2e)' }}>Confirm Batch Payout</h3>
              <p style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--text, #444)', lineHeight: 1.5 }}>
                You are about to initiate <strong>{readyRows.length}</strong> Faster Payments totalling <strong>£{totalNet.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong> from your Modulr account.
              </p>
              <p style={{ margin: '0 0 16px', fontSize: 13, color: '#dc2626', fontWeight: 600 }}>
                This action cannot be undone. Payments will be submitted immediately.
              </p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="admin-btn" onClick={() => setShowModulrConfirmModal(false)}>Cancel</button>
                <button className="admin-btn admin-btn-primary" onClick={submitModulrPayout} disabled={modulrSubmitting} style={{ background: '#dc2626', borderColor: '#dc2626' }}>
                  {modulrSubmitting ? 'Submitting...' : 'Confirm & Submit'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {tab === 'employees' && (() => {
        const zeroHrsIds = new Set(zeroHoursEmployees.map(e => e.id))
        const shiftIds = new Set(shiftEmployees.map(e => e.id))
        const employedIds = new Set(employedEmployees.map(e => e.id))
        const activeList = empPaySubTab === 'employed' ? employedEmployees : empPaySubTab === 'shift' ? shiftEmployees : zeroHoursEmployees
        const activeSlips = empPayPayslips.filter(p => {
          if (!p.employee?.id) return false
          if (empPaySubTab === 'employed') return employedIds.has(p.employee.id)
          if (empPaySubTab === 'shift') return shiftIds.has(p.employee.id)
          return zeroHrsIds.has(p.employee.id)
        })
        const activePage = empPaySubTab === 'employed' ? empPayPage : empPaySubTab === 'shift' ? empPayShiftPage : empPayZeroPage
        const setActivePage = empPaySubTab === 'employed' ? setEmpPayPage : empPaySubTab === 'shift' ? setEmpPayShiftPage : setEmpPayZeroPage
        const activeTotalPages = Math.max(1, Math.ceil(activeList.length / PAGE_SIZE))
        const paginatedList = activeList.slice((activePage - 1) * PAGE_SIZE, activePage * PAGE_SIZE)
        const emptyLabel = empPaySubTab === 'employed' ? 'No employed staff found' : empPaySubTab === 'shift' ? 'No shift workers found' : 'No zero hours workers found'
        return (
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

          {/* Sub-tabs */}
          <div style={{ display: 'flex', gap: 0, marginBottom: 12 }}>
            <button
              onClick={() => { setEmpPaySubTab('employed'); setEmpPayPage(1) }}
              style={{
                padding: '8px 20px', fontSize: 13, fontWeight: 600, border: '1px solid var(--border, #e5e7eb)',
                borderRadius: '8px 0 0 8px', cursor: 'pointer',
                background: empPaySubTab === 'employed' ? 'var(--primary, #5c6bc0)' : 'var(--bg-card, #fff)',
                color: empPaySubTab === 'employed' ? '#fff' : 'var(--text, #1a1a2e)',
              }}
            >
              Employed ({employedEmployees.length})
            </button>
            <button
              onClick={() => { setEmpPaySubTab('shift'); setEmpPayShiftPage(1) }}
              style={{
                padding: '8px 20px', fontSize: 13, fontWeight: 600, border: '1px solid var(--border, #e5e7eb)',
                borderLeft: 'none', cursor: 'pointer',
                background: empPaySubTab === 'shift' ? '#7e57c2' : 'var(--bg-card, #fff)',
                color: empPaySubTab === 'shift' ? '#fff' : 'var(--text, #1a1a2e)',
              }}
            >
              Shift Workers ({shiftEmployees.length})
            </button>
            <button
              onClick={() => { setEmpPaySubTab('zero_hours'); setEmpPayZeroPage(1) }}
              style={{
                padding: '8px 20px', fontSize: 13, fontWeight: 600, border: '1px solid var(--border, #e5e7eb)',
                borderLeft: 'none', borderRadius: '0 8px 8px 0', cursor: 'pointer',
                background: empPaySubTab === 'zero_hours' ? '#ef6c00' : 'var(--bg-card, #fff)',
                color: empPaySubTab === 'zero_hours' ? '#fff' : 'var(--text, #1a1a2e)',
              }}
            >
              Zero Hours ({zeroHoursEmployees.length})
            </button>
          </div>

          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr>
                <th>Employee</th><th>Department</th>
                {empPaySubTab !== 'employed' && <th>Hourly Rate</th>}
                {empPaySubTab !== 'employed' && <th>Pay Frequency</th>}
                {empPaySubTab !== 'employed' && <th>OT Multiplier</th>}
                <th>Gross Pay</th><th>Tax</th><th>NI</th><th>Pension</th><th>Net Pay</th><th>Status</th>
                {empPaySubTab !== 'employed' && <th></th>}
              </tr></thead>
              <tbody>
                {paginatedList.map(emp => {
                  const ps = empPayPayslips.find(p => p.employee?.id === emp.id)
                  const isHourly = empPaySubTab !== 'employed'
                  return (
                    <tr key={emp.id}>
                      <td><strong>{emp.first_name} {emp.last_name}</strong><br /><span style={{ fontSize: 11, color: 'var(--text-muted, #888)' }}>{emp.job_title || ''}</span></td>
                      <td>{emp.department || '—'}</td>
                      {isHourly && (
                        <td>
                          <input type="number" className="admin-inline-input" step="0.01" style={{ width: 80 }}
                            value={emp.hourly_rate ?? ''}
                            placeholder="0.00"
                            onChange={async e => {
                              const val = parseFloat(e.target.value) || null
                              await supabase.from('employees').update({ hourly_rate: val }).eq('id', emp.id)
                              setEmployees(prev => prev.map(ee => ee.id === emp.id ? { ...ee, hourly_rate: val } : ee))
                            }} />
                        </td>
                      )}
                      {isHourly && (
                        <td>
                          <select className="admin-inline-select" style={{ width: 110, fontSize: 12 }}
                            value={emp.pay_frequency || 'monthly'}
                            onChange={async e => {
                              await supabase.from('employees').update({ pay_frequency: e.target.value }).eq('id', emp.id)
                              setEmployees(prev => prev.map(ee => ee.id === emp.id ? { ...ee, pay_frequency: e.target.value } : ee))
                            }}>
                            <option value="weekly">Weekly</option>
                            <option value="fortnightly">Fortnightly</option>
                            <option value="four_weekly">4-Weekly</option>
                            <option value="monthly">Monthly</option>
                          </select>
                        </td>
                      )}
                      {isHourly && (
                        <td>
                          <input type="number" className="admin-inline-input" step="0.1" style={{ width: 60 }}
                            value={emp.overtime_rate_multiplier ?? 1.5}
                            onChange={async e => {
                              const val = parseFloat(e.target.value) || 1.5
                              await supabase.from('employees').update({ overtime_rate_multiplier: val }).eq('id', emp.id)
                              setEmployees(prev => prev.map(ee => ee.id === emp.id ? { ...ee, overtime_rate_multiplier: val } : ee))
                            }} />
                        </td>
                      )}
                      <td>{ps ? `£${Number(ps.gross_pay).toFixed(2)}` : '—'}</td>
                      <td>{ps ? `£${Number(ps.tax).toFixed(2)}` : '—'}</td>
                      <td>{ps ? `£${Number(ps.national_insurance).toFixed(2)}` : '—'}</td>
                      <td>{ps ? `£${Number(ps.pension).toFixed(2)}` : '—'}</td>
                      <td>{ps ? <strong>£{Number(ps.net_pay).toFixed(2)}</strong> : '—'}</td>
                      <td>{ps ? <span className={`admin-badge admin-badge-${ps.status}`}>{ps.status}</span> : <span className="admin-badge admin-badge-pending">No payslip</span>}</td>
                      {isHourly && <td></td>}
                    </tr>
                  )
                })}
              </tbody>
              {activeSlips.length > 0 && (
                <tfoot>
                  <tr style={{ fontWeight: 700 }}>
                    <td>Totals ({activeSlips.length})</td>
                    <td></td>
                    {empPaySubTab !== 'employed' && <td></td>}
                    {empPaySubTab !== 'employed' && <td></td>}
                    {empPaySubTab !== 'employed' && <td></td>}
                    <td>£{activeSlips.reduce((s, p) => s + Number(p.gross_pay), 0).toFixed(2)}</td>
                    <td>£{activeSlips.reduce((s, p) => s + Number(p.tax), 0).toFixed(2)}</td>
                    <td>£{activeSlips.reduce((s, p) => s + Number(p.national_insurance), 0).toFixed(2)}</td>
                    <td>£{activeSlips.reduce((s, p) => s + Number(p.pension), 0).toFixed(2)}</td>
                    <td>£{activeSlips.reduce((s, p) => s + Number(p.net_pay), 0).toFixed(2)}</td>
                    <td></td>
                    {empPaySubTab !== 'employed' && <td></td>}
                  </tr>
                </tfoot>
              )}
            </table>
            {paginatedList.length === 0 && <div className="admin-empty">{emptyLabel}</div>}
            {activeTotalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 12 }}>
                <button className="admin-action-btn" disabled={activePage <= 1} onClick={() => setActivePage(p => p - 1)}>Prev</button>
                <span style={{ fontSize: 13 }}>Page {activePage} of {activeTotalPages}</span>
                <button className="admin-action-btn" disabled={activePage >= activeTotalPages} onClick={() => setActivePage(p => p + 1)}>Next</button>
              </div>
            )}
          </div>
        </>
        )
      })()}

      {tab === 'period_review' && (() => {
        const targetEmps = prSubTab === 'shift' ? shiftEmployees : zeroHoursEmployees
        const reviewsByEmp = new Map(prReviews.map(r => [r.employee_id, r]))
        const prRows = targetEmps.map(emp => {
          const review = reviewsByEmp.get(emp.id)
          return { emp, review }
        })
        const totalPages = Math.max(1, Math.ceil(prRows.length / PAGE_SIZE))
        const pagedRows = prRows.slice((prPage - 1) * PAGE_SIZE, prPage * PAGE_SIZE)
        const approvedReviews = prReviews.filter(r => r.status === 'approved' || r.status === 'exported')
        const totalGross = approvedReviews.reduce((s, r) => s + r.gross_pay, 0)
        const draftCount = prReviews.filter(r => r.status === 'draft').length

        return (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0 }}>Period Review</h3>
            <span style={{ fontSize: 13, color: 'var(--text-muted, #888)' }}>
              Aggregate check-in hours, review, and approve gross pay for export to Sage/Xero
            </span>
          </div>

          {/* Period selector */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 13, fontWeight: 600 }}>Period:</label>
            <input type="date" className="admin-inline-input" value={prPeriodStart} onChange={e => setPrPeriodStart(e.target.value)} style={{ width: 150 }} />
            <span style={{ fontSize: 13 }}>to</span>
            <input type="date" className="admin-inline-input" value={prPeriodEnd} onChange={e => setPrPeriodEnd(e.target.value)} style={{ width: 150 }} />
            <button className="admin-btn admin-btn-primary" onClick={generatePeriodReviews} disabled={prLoading} style={{ fontSize: 13 }}>
              {prLoading ? 'Loading...' : 'Generate Reviews'}
            </button>
          </div>

          {/* Sub-tabs */}
          <div style={{ display: 'flex', gap: 0, marginBottom: 16 }}>
            <button onClick={() => { setPrSubTab('shift'); setPrPage(1) }} style={{
              padding: '8px 20px', fontSize: 13, fontWeight: 600, border: '1px solid var(--border, #e5e7eb)',
              borderRadius: '8px 0 0 8px', cursor: 'pointer',
              background: prSubTab === 'shift' ? '#7e57c2' : 'var(--bg-card, #fff)',
              color: prSubTab === 'shift' ? '#fff' : 'var(--text, #1a1a2e)',
            }}>Shift Workers ({shiftEmployees.length})</button>
            <button onClick={() => { setPrSubTab('zero_hours'); setPrPage(1) }} style={{
              padding: '8px 20px', fontSize: 13, fontWeight: 600, border: '1px solid var(--border, #e5e7eb)',
              borderLeft: 'none', borderRadius: '0 8px 8px 0', cursor: 'pointer',
              background: prSubTab === 'zero_hours' ? '#ef6c00' : 'var(--bg-card, #fff)',
              color: prSubTab === 'zero_hours' ? '#fff' : 'var(--text, #1a1a2e)',
            }}>Zero Hours ({zeroHoursEmployees.length})</button>
          </div>

          {/* Summary strip */}
          {prReviews.length > 0 && (
            <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
              <div className="admin-mini-stat"><span className="admin-mini-value">{prReviews.length}</span><span>Reviews</span></div>
              <div className="admin-mini-stat"><span className="admin-mini-value" style={{ color: '#ff9800' }}>{draftCount}</span><span>Draft</span></div>
              <div className="admin-mini-stat"><span className="admin-mini-value" style={{ color: '#43a047' }}>{approvedReviews.length}</span><span>Approved</span></div>
              <div className="admin-mini-stat"><span className="admin-mini-value">£{totalGross.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span><span>Total Gross</span></div>
            </div>
          )}

          {/* Actions bar */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {draftCount > 0 && (
              <button className="admin-btn admin-btn-primary" onClick={approveAllPeriodReviews} style={{ fontSize: 13 }}>
                Approve All ({draftCount})
              </button>
            )}
            {approvedReviews.length > 0 && (
              <button className="admin-btn" onClick={downloadPeriodExportCsv} style={{ fontSize: 13 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ verticalAlign: -2, marginRight: 4 }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Export Gross Pay CSV ({approvedReviews.length})
              </button>
            )}
          </div>

          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Total Hours</th>
                  <th>Adjusted Hours</th>
                  <th>Overtime Hours</th>
                  <th>Hourly Rate</th>
                  <th>Gross Pay</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pagedRows.map(({ emp, review }) => {
                  const adj = prAdjustments[review?.id || ''] || {}
                  const effectiveHrs = review ? (adj.hours ?? review.adjusted_hours ?? review.total_hours) : 0
                  const effectiveOt = review ? (adj.overtime ?? review.overtime_hours) : 0
                  const rate = review?.hourly_rate || emp.hourly_rate || 0
                  const multiplier = emp.overtime_rate_multiplier || 1.5
                  const liveGross = review ? Math.round(((effectiveHrs * rate) + (effectiveOt * rate * multiplier)) * 100) / 100 : 0
                  return (
                    <tr key={emp.id}>
                      <td>
                        <strong>{emp.first_name} {emp.last_name}</strong>
                        <br /><span style={{ fontSize: 11, color: 'var(--text-muted, #888)' }}>{emp.job_title || ''}</span>
                      </td>
                      <td>{review ? review.total_hours.toFixed(2) : '—'}</td>
                      <td>
                        {review && review.status === 'draft' ? (
                          <input type="number" className="admin-inline-input" step="0.25" style={{ width: 80 }}
                            value={adj.hours ?? review.adjusted_hours ?? review.total_hours}
                            onChange={e => setPrAdjustments(prev => ({ ...prev, [review.id]: { ...prev[review.id], hours: parseFloat(e.target.value) || 0 } }))} />
                        ) : review ? (review.adjusted_hours ?? review.total_hours).toFixed(2) : '—'}
                      </td>
                      <td>
                        {review && review.status === 'draft' ? (
                          <input type="number" className="admin-inline-input" step="0.25" style={{ width: 80 }}
                            value={adj.overtime ?? review.overtime_hours}
                            onChange={e => setPrAdjustments(prev => ({ ...prev, [review.id]: { ...prev[review.id], overtime: parseFloat(e.target.value) || 0 } }))} />
                        ) : review ? review.overtime_hours.toFixed(2) : '—'}
                      </td>
                      <td>{rate > 0 ? `£${rate.toFixed(2)}` : <span style={{ color: '#dc2626', fontSize: 12 }}>Not set</span>}</td>
                      <td><strong>{review ? `£${liveGross.toFixed(2)}` : '—'}</strong></td>
                      <td>
                        {review ? (
                          <span className={`admin-badge ${review.status === 'approved' || review.status === 'exported' ? 'admin-badge-paid' : review.status === 'paid' ? 'admin-badge-paid' : 'admin-badge-pending'}`}>
                            {review.status}
                          </span>
                        ) : <span className="admin-badge admin-badge-draft">No review</span>}
                      </td>
                      <td style={{ display: 'flex', gap: 4 }}>
                        {review && review.status === 'draft' && prAdjustments[review.id] && (
                          <button className="admin-btn-sm" onClick={() => savePeriodAdjustment(review.id)} style={{ whiteSpace: 'nowrap', background: '#2563eb', color: '#fff', border: 'none' }}>
                            Save
                          </button>
                        )}
                        {review && review.status === 'draft' && (
                          <button className="admin-btn-sm" onClick={() => approvePeriodReview(review.id)} style={{ whiteSpace: 'nowrap' }}>
                            Approve
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              {approvedReviews.length > 0 && (
                <tfoot>
                  <tr style={{ fontWeight: 700 }}>
                    <td>Approved Totals</td>
                    <td>{approvedReviews.reduce((s, r) => s + r.total_hours, 0).toFixed(2)}</td>
                    <td>{approvedReviews.reduce((s, r) => s + (r.adjusted_hours ?? r.total_hours), 0).toFixed(2)}</td>
                    <td>{approvedReviews.reduce((s, r) => s + r.overtime_hours, 0).toFixed(2)}</td>
                    <td></td>
                    <td>£{totalGross.toFixed(2)}</td>
                    <td></td>
                    <td></td>
                  </tr>
                </tfoot>
              )}
            </table>
            {pagedRows.length === 0 && <div className="admin-empty">No {prSubTab === 'shift' ? 'shift' : 'zero hours'} workers found</div>}
            {totalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 12 }}>
                <button className="admin-btn-sm" disabled={prPage <= 1} onClick={() => setPrPage(p => p - 1)}>Previous</button>
                <span style={{ fontSize: 13, lineHeight: '32px' }}>Page {prPage} of {totalPages}</span>
                <button className="admin-btn-sm" disabled={prPage >= totalPages} onClick={() => setPrPage(p => p + 1)}>Next</button>
              </div>
            )}
          </div>

          {/* How it works guide */}
          <div style={{ marginTop: 24, padding: 16, background: 'var(--bg-muted, #f8f9fa)', borderRadius: 10, fontSize: 13, lineHeight: 1.6 }}>
            <strong>How Period Review Works</strong>
            <ol style={{ margin: '8px 0 0', paddingLeft: 20 }}>
              <li>Set the pay period dates above (e.g. this week for weekly pay, this month for monthly)</li>
              <li>Click <strong>Generate Reviews</strong> — aggregates check-in hours from shifts automatically</li>
              <li>Adjust hours or overtime if needed, then <strong>Approve</strong> each row or use <strong>Approve All</strong></li>
              <li>Click <strong>Export Gross Pay CSV</strong> — download and import into your Sage or Xero payroll</li>
              <li>Sage/Xero calculates PAYE, NI, pension and submits RTI to HMRC</li>
              <li>Sync net pay back to InflowHR via the Sage/Xero Payslips tab</li>
              <li>Pay employees via BACS file upload to your bank, or Modulr (Pro Integrations)</li>
            </ol>
          </div>
        </>
        )
      })()}

      {tab === 'schedule' && (() => {
        const SCHED_PAGE_SIZE = PAGE_SIZE
        const schedEmployedRows = fyMonths.map(({ year, month }) => {
          const start = new Date(year, month, 1)
          const end = new Date(year, month + 1, 0)
          const payDate = getPayDay(year, month, payDayMode, customPayDay)
          const submitOpens = new Date(payDate)
          submitOpens.setDate(submitOpens.getDate() - submitLeadDays)
          const today = new Date(); today.setHours(0, 0, 0, 0)
          const withinSubmitWindow = today >= submitOpens
          const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`
          const employedIds = new Set(employedEmployees.map(e => e.id))
          const monthPayslips = sourcePayslips.filter(p => p.pay_period_start.startsWith(monthKey) && p.employee?.id && employedIds.has(p.employee.id))
          const isPast = end < new Date()
          const schedStatus = payrollScheduleStatuses[monthKey]
          const hasPayslips = monthPayslips.length > 0
          const allPaid = hasPayslips && monthPayslips.every(p => p.status === 'paid')
          let statusLabel: string; let statusClass: string; let isClickable = false
          if (schedStatus === 'completed' && allPaid) { statusLabel = 'Completed'; statusClass = 'admin-badge-paid' }
          else if (schedStatus === 'edited') { statusLabel = 'Edited — Download'; statusClass = 'admin-badge-rejected'; isClickable = withinSubmitWindow }
          else if (hasPayslips && !allPaid && withinSubmitWindow) { statusLabel = 'Submit Payroll'; statusClass = 'admin-badge-pending'; isClickable = true }
          else if (hasPayslips && !allPaid && !withinSubmitWindow) { statusLabel = `Opens ${submitOpens.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`; statusClass = 'admin-badge-draft' }
          else if (!hasPayslips && isPast) { statusLabel = 'No Payslips'; statusClass = 'admin-badge-pending' }
          else if (!hasPayslips) { statusLabel = 'Upcoming'; statusClass = 'admin-badge-pending' }
          else { statusLabel = 'Completed'; statusClass = 'admin-badge-paid' }
          return { year, month, start, end, payDate, submitOpens, monthKey, monthPayslips, isPast, statusLabel, statusClass, isClickable }
        })
        const schedShiftRows = fyMonths.map(({ year, month }) => {
          const start = new Date(year, month, 1)
          const end = new Date(year, month + 1, 0)
          const payDate = getPayDay(year, month, shiftPayDayMode, shiftCustomPayDay)
          const submitOpens = new Date(payDate)
          submitOpens.setDate(submitOpens.getDate() - shiftSubmitLeadDays)
          const today = new Date(); today.setHours(0, 0, 0, 0)
          const withinSubmitWindow = today >= submitOpens
          const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`
          const shiftIds = new Set(shiftEmployees.map(e => e.id))
          const monthPayslips = sourcePayslips.filter(p => p.pay_period_start.startsWith(monthKey) && p.employee?.id && shiftIds.has(p.employee.id))
          const isPast = end < new Date()
          const hasPayslips = monthPayslips.length > 0
          const allPaid = hasPayslips && monthPayslips.every(p => p.status === 'paid')
          const schedStatus = payrollScheduleStatuses[`shift-${monthKey}`]
          let statusLabel: string; let statusClass: string; let isClickable = false
          if (schedStatus === 'completed' && allPaid) { statusLabel = 'Completed'; statusClass = 'admin-badge-paid' }
          else if (hasPayslips && !allPaid && withinSubmitWindow) { statusLabel = 'Submit Payroll'; statusClass = 'admin-badge-pending'; isClickable = true }
          else if (hasPayslips && !allPaid && !withinSubmitWindow) { statusLabel = `Opens ${submitOpens.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`; statusClass = 'admin-badge-draft' }
          else if (!hasPayslips && isPast) { statusLabel = 'No Payslips'; statusClass = 'admin-badge-pending' }
          else if (!hasPayslips) { statusLabel = 'Upcoming'; statusClass = 'admin-badge-pending' }
          else { statusLabel = 'Completed'; statusClass = 'admin-badge-paid' }
          return { year, month, start, end, payDate, submitOpens, monthKey, monthPayslips, isPast, statusLabel, statusClass, isClickable }
        })
        const schedZeroRows = fyMonths.map(({ year, month }) => {
          const start = new Date(year, month, 1)
          const end = new Date(year, month + 1, 0)
          const payDate = getPayDay(year, month, zeroHrsPayDayMode, zeroHrsCustomPayDay)
          const zeroPayDates: Date[] = []
          if (zeroHrsFrequency === 'monthly') { zeroPayDates.push(end) } else {
            const fri = new Date(year, month, 1)
            while (fri.getDay() !== 5) fri.setDate(fri.getDate() + 1)
            const step = zeroHrsFrequency === 'fortnightly' ? 14 : 7
            while (fri.getMonth() === month) { zeroPayDates.push(new Date(fri)); fri.setDate(fri.getDate() + step) }
          }
          const zeroFreqLabel = zeroPayDates.map(d => d.toLocaleDateString('en-GB')).join(', ')
          const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`
          const zeroIds = new Set(zeroHoursEmployees.map(e => e.id))
          const monthPayslips = sourcePayslips.filter(p => p.pay_period_start.startsWith(monthKey) && p.employee?.id && zeroIds.has(p.employee.id))
          const isPast = end < new Date()
          const hasPayslips = monthPayslips.length > 0
          const allPaid = hasPayslips && monthPayslips.every(p => p.status === 'paid')
          let statusLabel: string; let statusClass: string
          if (allPaid && hasPayslips) { statusLabel = 'Completed'; statusClass = 'admin-badge-paid' }
          else if (hasPayslips && !allPaid) { statusLabel = 'In Progress'; statusClass = 'admin-badge-pending' }
          else if (!hasPayslips && isPast) { statusLabel = 'No Payslips'; statusClass = 'admin-badge-pending' }
          else { statusLabel = 'Upcoming'; statusClass = 'admin-badge-pending' }
          return { year, month, start, end, payDate, zeroFreqLabel, monthKey, monthPayslips, isPast, statusLabel, statusClass }
        })
        const empTotalPages = Math.ceil(schedEmployedRows.length / SCHED_PAGE_SIZE)
        const shiftTotalPages = Math.ceil(schedShiftRows.length / SCHED_PAGE_SIZE)
        const zeroTotalPages = Math.ceil(schedZeroRows.length / SCHED_PAGE_SIZE)
        const pagedEmpRows = schedEmployedRows.slice((schedEmpPage - 1) * SCHED_PAGE_SIZE, schedEmpPage * SCHED_PAGE_SIZE)
        const pagedShiftRows = schedShiftRows.slice((schedShiftPage - 1) * SCHED_PAGE_SIZE, schedShiftPage * SCHED_PAGE_SIZE)
        const pagedZeroRows = schedZeroRows.slice((schedZeroPage - 1) * SCHED_PAGE_SIZE, schedZeroPage * SCHED_PAGE_SIZE)

        return (
        <div className="admin-schedule">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <h3 style={{ margin: 0 }}>Payroll Calendar — {fyLabel}</h3>
            <span className="admin-info-tooltip" style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5c6bc0" strokeWidth="2" style={{ cursor: 'help' }}>
                <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
              </svg>
              <span className="admin-info-tooltip-text">
                <strong>Payroll Process</strong><br/>
                1. Configure pay day and submission windows in Settings<br/>
                2. Generate payslips from the Payslips tab<br/>
                3. Review and resolve any flagged payslips<br/>
                4. Once within the submission window, click &ldquo;Submit Payroll&rdquo; to download the CSV and mark payslips as paid<br/>
                5. Payslips become visible to employees on the chosen pay day
              </span>
            </span>
          </div>

          {/* Sub-tabs */}
          <div style={{ display: 'flex', gap: 0, marginBottom: 16 }}>
            <button onClick={() => { setSchedSubTab('employed'); setSchedEmpPage(1) }} style={{
              padding: '8px 20px', fontSize: 13, fontWeight: 600, border: '1px solid var(--border, #e5e7eb)',
              borderRadius: '8px 0 0 8px', cursor: 'pointer',
              background: schedSubTab === 'employed' ? 'var(--primary, #5c6bc0)' : 'var(--bg-card, #fff)',
              color: schedSubTab === 'employed' ? '#fff' : 'var(--text, #1a1a2e)',
            }}>Employed Staff ({employedEmployees.length})</button>
            <button onClick={() => { setSchedSubTab('shift'); setSchedShiftPage(1) }} style={{
              padding: '8px 20px', fontSize: 13, fontWeight: 600, border: '1px solid var(--border, #e5e7eb)',
              borderLeft: 'none', cursor: 'pointer',
              background: schedSubTab === 'shift' ? '#7e57c2' : 'var(--bg-card, #fff)',
              color: schedSubTab === 'shift' ? '#fff' : 'var(--text, #1a1a2e)',
            }}>Shift Workers ({shiftEmployees.length})</button>
            <button onClick={() => { setSchedSubTab('zero_hours'); setSchedZeroPage(1) }} style={{
              padding: '8px 20px', fontSize: 13, fontWeight: 600, border: '1px solid var(--border, #e5e7eb)',
              borderLeft: 'none', cursor: 'pointer',
              background: schedSubTab === 'zero_hours' ? '#ef6c00' : 'var(--bg-card, #fff)',
              color: schedSubTab === 'zero_hours' ? '#fff' : 'var(--text, #1a1a2e)',
            }}>Zero Hours ({zeroHoursEmployees.length})</button>
            <button onClick={() => setSchedSubTab('settings')} style={{
              padding: '8px 20px', fontSize: 13, fontWeight: 600, border: '1px solid var(--border, #e5e7eb)',
              borderLeft: 'none', borderRadius: '0 8px 8px 0', cursor: 'pointer',
              background: schedSubTab === 'settings' ? '#455a64' : 'var(--bg-card, #fff)',
              color: schedSubTab === 'settings' ? '#fff' : 'var(--text, #1a1a2e)',
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ verticalAlign: -2, marginRight: 4 }}>
                <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
              Settings
            </button>
          </div>

          {/* Employed Staff Schedule */}
          {schedSubTab === 'employed' && (
            <>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead><tr><th>Month</th><th>Period Start</th><th>Period End</th><th>Pay Day</th><th>Submit Opens</th><th>Payslips</th><th>Status</th><th></th></tr></thead>
                  <tbody>
                    {pagedEmpRows.map(r => (
                      <tr key={r.monthKey} className={r.isPast && !r.isClickable ? 'admin-row-muted' : ''}>
                        <td><strong>{MONTH_NAMES[r.month]}</strong></td>
                        <td>{r.start.toLocaleDateString('en-GB')}</td>
                        <td>{r.end.toLocaleDateString('en-GB')}</td>
                        <td>{r.payDate.toLocaleDateString('en-GB')}</td>
                        <td>{r.submitOpens.toLocaleDateString('en-GB')}</td>
                        <td>{r.monthPayslips.length}</td>
                        <td>
                          {r.isClickable ? (
                            <button className={`admin-badge ${r.statusClass}`} style={{ cursor: 'pointer', border: 'none', fontWeight: 600 }} onClick={() => submitPayroll(r.monthKey)}>{r.statusLabel}</button>
                          ) : (
                            <span className={`admin-badge ${r.statusClass}`}>{r.statusLabel}</span>
                          )}
                        </td>
                        <td>
                          {r.monthPayslips.length > 0 && (
                            <button className="admin-btn-sm" title="Download CSV" onClick={() => downloadScheduleCsv(r.monthPayslips, r.monthKey, 'employed')} style={{ whiteSpace: 'nowrap' }}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ verticalAlign: -2, marginRight: 4 }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                              CSV
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {empTotalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 12 }}>
                  <button className="admin-btn-sm" disabled={schedEmpPage <= 1} onClick={() => setSchedEmpPage(p => p - 1)}>Previous</button>
                  <span style={{ fontSize: 13, lineHeight: '32px' }}>Page {schedEmpPage} of {empTotalPages}</span>
                  <button className="admin-btn-sm" disabled={schedEmpPage >= empTotalPages} onClick={() => setSchedEmpPage(p => p + 1)}>Next</button>
                </div>
              )}
            </>
          )}

          {/* Shift Workers Schedule */}
          {schedSubTab === 'shift' && (
            <>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead><tr><th>Month</th><th>Period Start</th><th>Period End</th><th>Pay Day</th><th>Submit Opens</th><th>Payslips</th><th>Status</th><th></th></tr></thead>
                  <tbody>
                    {pagedShiftRows.map(r => (
                      <tr key={r.monthKey} className={r.isPast && !r.isClickable ? 'admin-row-muted' : ''}>
                        <td><strong>{MONTH_NAMES[r.month]}</strong></td>
                        <td>{r.start.toLocaleDateString('en-GB')}</td>
                        <td>{r.end.toLocaleDateString('en-GB')}</td>
                        <td>{r.payDate.toLocaleDateString('en-GB')}</td>
                        <td>{r.submitOpens.toLocaleDateString('en-GB')}</td>
                        <td>{r.monthPayslips.length}</td>
                        <td>
                          {r.isClickable ? (
                            <button className={`admin-badge ${r.statusClass}`} style={{ cursor: 'pointer', border: 'none', fontWeight: 600 }} onClick={() => submitPayroll(r.monthKey)}>{r.statusLabel}</button>
                          ) : (
                            <span className={`admin-badge ${r.statusClass}`}>{r.statusLabel}</span>
                          )}
                        </td>
                        <td>
                          {r.monthPayslips.length > 0 && (
                            <button className="admin-btn-sm" title="Download CSV" onClick={() => downloadScheduleCsv(r.monthPayslips, r.monthKey, 'shift')} style={{ whiteSpace: 'nowrap' }}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ verticalAlign: -2, marginRight: 4 }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                              CSV
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {shiftTotalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 12 }}>
                  <button className="admin-btn-sm" disabled={schedShiftPage <= 1} onClick={() => setSchedShiftPage(p => p - 1)}>Previous</button>
                  <span style={{ fontSize: 13, lineHeight: '32px' }}>Page {schedShiftPage} of {shiftTotalPages}</span>
                  <button className="admin-btn-sm" disabled={schedShiftPage >= shiftTotalPages} onClick={() => setSchedShiftPage(p => p + 1)}>Next</button>
                </div>
              )}
            </>
          )}

          {/* Zero Hours Schedule */}
          {schedSubTab === 'zero_hours' && (
            <>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead><tr><th>Month</th><th>Period Start</th><th>Period End</th><th>Pay Day</th><th>Pay Dates</th><th>Payslips</th><th>Status</th><th></th></tr></thead>
                  <tbody>
                    {pagedZeroRows.map(r => (
                      <tr key={r.monthKey} className={r.isPast ? 'admin-row-muted' : ''}>
                        <td><strong>{MONTH_NAMES[r.month]}</strong></td>
                        <td>{r.start.toLocaleDateString('en-GB')}</td>
                        <td>{r.end.toLocaleDateString('en-GB')}</td>
                        <td>{r.payDate.toLocaleDateString('en-GB')}</td>
                        <td>{r.zeroFreqLabel}</td>
                        <td>{r.monthPayslips.length}</td>
                        <td><span className={`admin-badge ${r.statusClass}`}>{r.statusLabel}</span></td>
                        <td>
                          {r.monthPayslips.length > 0 && (
                            <button className="admin-btn-sm" title="Download CSV" onClick={() => downloadScheduleCsv(r.monthPayslips, r.monthKey, 'zero-hours')} style={{ whiteSpace: 'nowrap' }}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ verticalAlign: -2, marginRight: 4 }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                              CSV
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {zeroTotalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 12 }}>
                  <button className="admin-btn-sm" disabled={schedZeroPage <= 1} onClick={() => setSchedZeroPage(p => p - 1)}>Previous</button>
                  <span style={{ fontSize: 13, lineHeight: '32px' }}>Page {schedZeroPage} of {zeroTotalPages}</span>
                  <button className="admin-btn-sm" disabled={schedZeroPage >= zeroTotalPages} onClick={() => setSchedZeroPage(p => p + 1)}>Next</button>
                </div>
              )}
            </>
          )}

          {/* Settings Tab */}
          {schedSubTab === 'settings' && (
            <>
              <h4 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600 }}>Employed Staff Payroll</h4>
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
              </div>

              <h4 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600, color: '#7e57c2' }}>Shift Workers Payroll</h4>
              <div style={{ background: '#f5f0ff', borderRadius: 10, padding: '16px 20px', marginBottom: 20, display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end', borderLeft: '4px solid #7e57c2' }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Pay Day</label>
                  <select className="admin-select" value={shiftPayDayMode} onChange={e => setShiftPayDayMode(e.target.value as any)} style={{ minWidth: 160 }}>
                    <option value="end">End of Month</option>
                    <option value="start">Beginning of Month</option>
                    <option value="custom">Custom Day</option>
                  </select>
                </div>
                {shiftPayDayMode === 'custom' && (
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Day of Month</label>
                    <select className="admin-select" value={shiftCustomPayDay} onChange={e => setShiftCustomPayDay(Number(e.target.value))} style={{ minWidth: 80 }}>
                      {Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
                        <option key={d} value={d}>{d}{d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th'}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Submit Window (days before pay day)</label>
                  <select className="admin-select" value={shiftSubmitLeadDays} onChange={e => setShiftSubmitLeadDays(Number(e.target.value))} style={{ minWidth: 80 }}>
                    {[1, 2, 3, 4, 5, 7, 10, 14].map(d => (
                      <option key={d} value={d}>{d} day{d > 1 ? 's' : ''}</option>
                    ))}
                  </select>
                </div>
              </div>

              <h4 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600, color: '#ef6c00' }}>Zero Hours Payroll</h4>
              <div style={{ background: '#fff3e0', borderRadius: 10, padding: '16px 20px', marginBottom: 20, display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end', borderLeft: '4px solid #ef6c00' }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Pay Frequency</label>
                  <select className="admin-select" value={zeroHrsFrequency} onChange={e => setZeroHrsFrequency(e.target.value as any)} style={{ minWidth: 180 }}>
                    <option value="weekly">Every 1 Week</option>
                    <option value="fortnightly">Every 2 Weeks</option>
                    <option value="monthly">End of Month</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Pay Day</label>
                  <select className="admin-select" value={zeroHrsPayDayMode} onChange={e => setZeroHrsPayDayMode(e.target.value as any)} style={{ minWidth: 160 }}>
                    <option value="end">End of Month</option>
                    <option value="start">Beginning of Month</option>
                    <option value="custom">Custom Day</option>
                  </select>
                </div>
                {zeroHrsPayDayMode === 'custom' && (
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Day of Month</label>
                    <select className="admin-select" value={zeroHrsCustomPayDay} onChange={e => setZeroHrsCustomPayDay(Number(e.target.value))} style={{ minWidth: 80 }}>
                      {Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
                        <option key={d} value={d}>{d}{d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th'}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Submit Window (days before pay day)</label>
                  <select className="admin-select" value={zeroHrsSubmitLeadDays} onChange={e => setZeroHrsSubmitLeadDays(Number(e.target.value))} style={{ minWidth: 80 }}>
                    {[1, 2, 3, 4, 5, 7, 10, 14].map(d => (
                      <option key={d} value={d}>{d} day{d > 1 ? 's' : ''}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button className="admin-btn admin-btn-primary" onClick={savePaySettings} disabled={paySettingsSaving} style={{ height: 36 }}>
                  {paySettingsSaving ? 'Saving...' : 'Save All Settings'}
                </button>
              </div>
            </>
          )}
        </div>
        )
      })()}

      {tab === 'time_breakdown' && (
        <>
          {/* Employed / Shift / Zero Hours sub-tabs */}
          <div style={{ display: 'flex', gap: 0, marginBottom: 12 }}>
            <button
              onClick={() => { setTbSubTab('employed'); setTbPage(1); setTbFilterEmp('') }}
              style={{
                padding: '8px 20px', fontSize: 13, fontWeight: 600, border: '1px solid var(--border, #e5e7eb)',
                borderRadius: '8px 0 0 8px', cursor: 'pointer',
                background: tbSubTab === 'employed' ? 'var(--primary, #5c6bc0)' : 'var(--bg-card, #fff)',
                color: tbSubTab === 'employed' ? '#fff' : 'var(--text, #1a1a2e)',
              }}
            >
              Employed
            </button>
            <button
              onClick={() => { setTbSubTab('shift'); setTbPage(1); setTbFilterEmp('') }}
              style={{
                padding: '8px 20px', fontSize: 13, fontWeight: 600, border: '1px solid var(--border, #e5e7eb)',
                borderLeft: 'none', cursor: 'pointer',
                background: tbSubTab === 'shift' ? '#7e57c2' : 'var(--bg-card, #fff)',
                color: tbSubTab === 'shift' ? '#fff' : 'var(--text, #1a1a2e)',
              }}
            >
              Shift Workers
            </button>
            <button
              onClick={() => { setTbSubTab('zero_hours'); setTbPage(1); setTbFilterEmp('') }}
              style={{
                padding: '8px 20px', fontSize: 13, fontWeight: 600, border: '1px solid var(--border, #e5e7eb)',
                borderLeft: 'none', borderRadius: '0 8px 8px 0', cursor: 'pointer',
                background: tbSubTab === 'zero_hours' ? '#ef6c00' : 'var(--bg-card, #fff)',
                color: tbSubTab === 'zero_hours' ? '#fff' : 'var(--text, #1a1a2e)',
              }}
            >
              Zero Hours
            </button>
          </div>

          <div className="admin-filters">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ fontSize: 13, fontWeight: 600 }}>Period:</label>
              <input type="date" className="admin-select" value={tbPeriodStart} onChange={e => setTbPeriodStart(e.target.value)} />
              <span>to</span>
              <input type="date" className="admin-select" value={tbPeriodEnd} onChange={e => setTbPeriodEnd(e.target.value)} />
            </div>
            <select className="admin-select" value={tbFilterEmp} onChange={e => setTbFilterEmp(e.target.value)}>
              <option value="">All Employees</option>
              {(tbSubTab === 'employed' ? employedEmployees : tbSubTab === 'shift' ? shiftEmployees : zeroHoursEmployees).map(e => <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>)}
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
                    {tbSubTab === 'employed' && enabledFeatures.timesheets && <th>Timesheet Hours</th>}
                    {tbSubTab === 'shift' && <th>Hours Assigned</th>}
                    {tbSubTab === 'zero_hours' && <th>Zero Hours Assigned</th>}
                    {tbSubTab === 'employed' && enabledFeatures.legal_timesheets && <th>Legal Hours</th>}
                    <th>Total Hours</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {(tbSubTab === 'employed' ? employedEmployees : tbSubTab === 'shift' ? shiftEmployees : zeroHoursEmployees).filter(e => !tbFilterEmp || e.id === tbFilterEmp).slice((tbPage - 1) * PAGE_SIZE, tbPage * PAGE_SIZE).map(emp => {
                    const data = tbData[emp.id]
                    if (!data) return null
                    const total = tbSubTab === 'employed' ? data.tsHrs + data.legalHrs : data.shiftHrs
                    if (total === 0 && !tbFilterEmp) return null
                    const isExpanded = tbExpandedEmp === emp.id
                    return (
                      <>
                        <tr key={emp.id} className={isExpanded ? 'admin-row-active' : ''}>
                          <td><strong>{emp.first_name} {emp.last_name}</strong><br /><span style={{ fontSize: 12, color: '#888' }}>{emp.department} · {emp.job_title}</span></td>
                          {tbSubTab === 'employed' && enabledFeatures.timesheets && <td>{data.tsHrs.toFixed(1)}h <span style={{ fontSize: 12, color: '#888' }}>({data.tsEntries.length} entries)</span></td>}
                          {tbSubTab === 'shift' && <td>{data.shiftHrs.toFixed(1)}h <span style={{ fontSize: 12, color: '#888' }}>({data.shiftEntries.length} shifts)</span></td>}
                          {tbSubTab === 'zero_hours' && <td>{data.shiftHrs.toFixed(1)}h <span style={{ fontSize: 12, color: '#888' }}>({data.shiftEntries.length} shifts)</span></td>}
                          {tbSubTab === 'employed' && enabledFeatures.legal_timesheets && <td>{data.legalHrs.toFixed(1)}h <span style={{ fontSize: 12, color: '#888' }}>({data.legalEntries.length} entries)</span></td>}
                          <td><strong>{total.toFixed(1)}h</strong></td>
                          <td>
                            <button className="admin-btn-icon" onClick={() => setTbExpandedEmp(isExpanded ? null : emp.id)}>
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points={isExpanded ? '18 15 12 9 6 15' : '6 9 12 15 18 9'} /></svg>
                            </button>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr key={`tb-exp-${emp.id}`} className="admin-expanded-row">
                            <td colSpan={2 + 1 + (tbSubTab === 'employed' && enabledFeatures.legal_timesheets ? 1 : 0)}>
                              <div className="admin-tb-detail">
                                {(tbSubTab === 'shift' || tbSubTab === 'zero_hours') && data.shiftEntries.length > 0 && (
                                  <div className="admin-tb-section">
                                    <h4 className="admin-tb-section-title">Shifts ({data.shiftHrs.toFixed(1)}h scheduled)</h4>
                                    <table className="admin-table admin-table-nested">
                                      <thead><tr><th>Date</th><th>Shift</th><th>Scheduled</th><th>Check-In</th><th>Check-Out</th><th>Actual</th><th>Status</th></tr></thead>
                                      <tbody>
                                        {data.shiftEntries.sort((a: any, b: any) => a.date.localeCompare(b.date)).map((s: any, i: number) => (
                                          <tr key={i} style={s.noCheckin ? { background: 'rgba(229,57,53,0.06)' } : s.forgotCheckout ? { background: 'rgba(245,158,11,0.06)' } : undefined}>
                                            <td>{formatDate(s.date)}</td>
                                            <td>{s.shiftName}</td>
                                            <td>{s.start_time?.slice(0, 5)} – {s.end_time?.slice(0, 5)} <span style={{ fontSize: 11, color: '#888' }}>({s.hrs.toFixed(1)}h)</span></td>
                                            <td>{s.firstIn ? new Date(s.firstIn).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                                            <td>{s.lastOut ? new Date(s.lastOut).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                                            <td>{s.noCheckin ? '—' : `${s.actualHrs.toFixed(1)}h`}</td>
                                            <td>
                                              {s.noCheckin
                                                ? <span className="admin-badge admin-badge-cancelled">No Check-In</span>
                                                : s.forgotCheckout
                                                  ? <span className="admin-badge" style={{ background: '#fef3c7', color: '#92400e' }}>Forgot Checkout</span>
                                                  : <span className="admin-badge admin-badge-complete">OK</span>}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}

                                {tbSubTab === 'employed' && data.tsEntries.length > 0 && (
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
              {(() => {
                const tbEmployeeList = tbSubTab === 'employed' ? employedEmployees : tbSubTab === 'shift' ? shiftEmployees : zeroHoursEmployees
                const tbFiltered = tbEmployeeList.filter(e => !tbFilterEmp || e.id === tbFilterEmp)
                const tbTotalPages = Math.max(1, Math.ceil(tbFiltered.length / PAGE_SIZE))
                const allEmpty = tbFiltered.every(e => { const d = tbData[e.id]; return !d || (d.shiftHrs + d.tsHrs + d.legalHrs === 0) })
                const label = tbSubTab === 'employed' ? 'employed staff' : tbSubTab === 'shift' ? 'shift workers' : 'zero hours workers'
                return (
                  <>
                    {allEmpty && !tbFilterEmp && <div className="admin-empty">No time entries found for {label} in this period</div>}
                    {tbTotalPages > 1 && (
                      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 12 }}>
                        <button className="admin-action-btn" disabled={tbPage <= 1} onClick={() => setTbPage(p => p - 1)}>Prev</button>
                        <span style={{ fontSize: 13 }}>Page {tbPage} of {tbTotalPages}</span>
                        <button className="admin-action-btn" disabled={tbPage >= tbTotalPages} onClick={() => setTbPage(p => p + 1)}>Next</button>
                      </div>
                    )}
                  </>
                )
              })()}
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

          {anLoading ? <div className="admin-loading">Loading analytics...</div> : (() => {
            const employedIds = new Set(employedEmployees.map(e => e.id))
            const shiftIds = new Set(shiftEmployees.map(e => e.id))
            const employedMetrics = anData.empMetrics.filter(e => employedIds.has(e.id))
            const shiftMetrics = anData.empMetrics.filter(e => shiftIds.has(e.id))

            function renderUtilStats(metrics: typeof anData.empMetrics, label: string) {
              const totalHrs = metrics.reduce((s, e) => s + e.totalHrs, 0)
              const contracted = metrics.reduce((s, e) => s + e.contractedPeriodHrs, 0)
              const pct = contracted > 0 ? (totalHrs / contracted * 100) : 0
              return (
                <div className="admin-mini-stats">
                  <div className="admin-mini-stat">
                    <span className="admin-mini-value">{metrics.length}</span><span>{label}</span>
                  </div>
                  <div className="admin-mini-stat">
                    <span className="admin-mini-value">{totalHrs.toFixed(0)}h</span><span>Total Hours</span>
                  </div>
                  <div className="admin-mini-stat">
                    <span className="admin-mini-value" style={{ color: pct >= 80 ? '#43a047' : pct >= 50 ? '#ff9800' : '#e53935' }}>
                      {contracted > 0 ? pct.toFixed(0) + '%' : '—'}
                    </span><span>Avg Utilisation</span>
                  </div>
                </div>
              )
            }

            function renderUtilTable(metrics: typeof anData.empMetrics) {
              return (
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
                      {metrics.map(e => {
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
                  {metrics.length === 0 && <div className="admin-empty">No utilisation data for this period</div>}
                </div>
              )
            }

            return (
            <>
              {/* Employed Staff Utilisation */}
              <h3 style={{ margin: '20px 0 8px', fontSize: 15, fontWeight: 600 }}>Employed Staff Utilisation</h3>
              {renderUtilStats(employedMetrics, 'Employed Staff')}
              {renderUtilTable(employedMetrics)}

              {/* Shift Workers Utilisation */}
              <h3 style={{ margin: '24px 0 8px', fontSize: 15, fontWeight: 600, color: '#7e57c2' }}>Shift Workers Utilisation</h3>
              {renderUtilStats(shiftMetrics, 'Shift Workers')}
              {renderUtilTable(shiftMetrics)}

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
            )
          })()}
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

                {sageScanStatus && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 6, marginBottom: 12,
                    background: sageScanStatus === 'clean' ? '#e8f5e9' : sageScanStatus === 'infected' ? '#ffebee' : sageScanStatus === 'scanning' ? '#e3f2fd' : sageScanStatus === 'skipped' ? '#f5f5f5' : '#fff3e0',
                    color: sageScanStatus === 'clean' ? '#2e7d32' : sageScanStatus === 'infected' ? '#c62828' : sageScanStatus === 'scanning' ? '#1565c0' : sageScanStatus === 'skipped' ? '#666' : '#e65100',
                    fontSize: 12, fontWeight: 600,
                  }}>
                    <span style={{ fontSize: 14 }}>
                      {sageScanStatus === 'clean' ? '✓' : sageScanStatus === 'infected' ? '⚠' : sageScanStatus === 'scanning' ? '⏳' : 'ℹ'}
                    </span>
                    {sageScanStatus === 'clean' ? 'Virus scan: file is clean' : sageScanStatus === 'infected' ? 'Virus scan: malware detected — file removed from storage' : sageScanStatus === 'scanning' ? 'Virus scan in progress…' : sageScanStatus === 'skipped' ? 'Virus scan skipped (not configured)' : `Virus scan: ${sageScanStatus}`}
                  </div>
                )}

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

                {sageUploadResult.skipped && sageUploadResult.skipped.length > 0 && (
                  <>
                    <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: '#b45309' }}>
                      Skipped — Already Paid ({sageUploadResult.skipped.length})
                    </p>
                    <div className="admin-table-wrap" style={{ marginBottom: 16 }}>
                      <table className="admin-table">
                        <thead>
                          <tr><th>Employee</th><th>Employee ID</th><th>Month</th><th>Existing Source</th></tr>
                        </thead>
                        <tbody>
                          {sageUploadResult.skipped.map((s, i) => (
                            <tr key={i}>
                              <td>{s.employee_name}</td>
                              <td>{s.employee_number}</td>
                              <td>{s.month}</td>
                              <td style={{ textTransform: 'capitalize' }}>{s.existing_source}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p style={{ margin: '0 0 12px', fontSize: 12, color: '#b45309' }}>
                      These payslips were not imported because the employee already has a payslip for that month from another source.
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

      {tab === 'logs' && (
        <div className="admin-card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end', marginBottom: 16 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Person</label>
              <select className="admin-inline-input" style={{ minWidth: 180 }} value={auditFilterEmp} onChange={e => { setAuditFilterEmp(e.target.value); setAuditPage(1) }}>
                <option value="">All</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>From</label>
              <input type="date" className="admin-inline-input" value={auditDateFrom} onChange={e => { setAuditDateFrom(e.target.value); setAuditPage(1) }} />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>To</label>
              <input type="date" className="admin-inline-input" value={auditDateTo} onChange={e => { setAuditDateTo(e.target.value); setAuditPage(1) }} />
            </div>
            <button className="admin-btn" onClick={loadAuditLogs} style={{ fontSize: 13 }}>Refresh</button>
          </div>

          {auditLoading ? <div className="admin-loading">Loading audit logs...</div> : auditLogs.length === 0 ? (
            <div className="admin-empty">No payroll audit log entries found for this period</div>
          ) : (
            <>
              <div style={{ overflowX: 'auto' }}>
                <table className="admin-table" style={{ fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Action</th>
                      <th>Detail</th>
                      <th>Performed By</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.slice((auditPage - 1) * 20, auditPage * 20).map(log => (
                      <tr key={log.id}>
                        <td style={{ whiteSpace: 'nowrap' }}>{new Date(log.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })} {new Date(log.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</td>
                        <td><strong>{log.action}</strong></td>
                        <td style={{ maxWidth: 400, wordBreak: 'break-word' }}>{log.detail || '—'}</td>
                        <td>{log.performer_name || '—'}</td>
                        <td>
                          <span className={`admin-badge ${log.status === 'success' ? 'admin-badge-paid' : log.status === 'error' ? 'admin-badge-overdue' : 'admin-badge-pending'}`}>
                            {log.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {auditLogs.length > 20 && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 12 }}>
                  <button className="admin-btn-sm" disabled={auditPage <= 1} onClick={() => setAuditPage(p => p - 1)}>Previous</button>
                  <span style={{ fontSize: 13, lineHeight: '32px' }}>Page {auditPage} of {Math.ceil(auditLogs.length / 20)}</span>
                  <button className="admin-btn-sm" disabled={auditPage >= Math.ceil(auditLogs.length / 20)} onClick={() => setAuditPage(p => p + 1)}>Next</button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
