import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { useToast } from '../../context/ToastContext'
import { useFeatures } from '../../context/FeatureContext'
import { useAuth } from '../../context/AuthContext'
import { formatDate, formatCurrency, currencySymbol } from '../../lib/formatters'

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

type PayFrequency = 'weekly' | 'bi_weekly' | 'monthly'

function getPeriodsPerYear(freq: PayFrequency): number {
  if (freq === 'weekly') return 52
  if (freq === 'bi_weekly') return 26
  return 12
}

function calcTax(annualTaxable: number, freq: PayFrequency): number {
  const personalAllowance = annualTaxable > 125140 ? 0 : Math.max(0, 12570 - Math.max(0, (annualTaxable - 100000) / 2))
  const taxable = Math.max(0, annualTaxable - personalAllowance)
  let tax = 0
  if (taxable > 0) tax += Math.min(taxable, 37700) * 0.2
  if (taxable > 37700) tax += Math.min(taxable - 37700, 87440) * 0.4
  if (taxable > 125140) tax += (taxable - 125140) * 0.45
  return Math.round((tax / getPeriodsPerYear(freq)) * 100) / 100
}

function calcNI(annualGross: number, freq: PayFrequency): number {
  const periods = getPeriodsPerYear(freq)
  const periodGross = annualGross / periods
  const primaryThreshold = 12570 / periods
  const upperEarningsLimit = 50270 / periods
  let ni = 0
  if (periodGross > primaryThreshold) ni += Math.min(periodGross - primaryThreshold, upperEarningsLimit - primaryThreshold) * 0.08
  if (periodGross > upperEarningsLimit) ni += (periodGross - upperEarningsLimit) * 0.02
  return Math.round(ni * 100) / 100
}

function prorateBenefit(monthlyCost: number, freq: PayFrequency): number {
  if (freq === 'weekly') return Math.round((monthlyCost * 12 / 52) * 100) / 100
  if (freq === 'bi_weekly') return Math.round((monthlyCost * 12 / 26) * 100) / 100
  return monthlyCost
}

function snapToMonday(d: Date): Date {
  const day = d.getDay()
  const offset = day === 0 ? -6 : 1 - day
  const mon = new Date(d)
  mon.setDate(mon.getDate() + offset)
  return mon
}

function getPeriodBoundaries(year: number, month: number, freq: PayFrequency, fyStartMonth: number): { start: Date; end: Date }[] {
  if (freq === 'monthly') {
    return [{ start: new Date(year, month, 1), end: new Date(year, month + 1, 0) }]
  }
  const fyStartDate = new Date(month >= fyStartMonth - 1 ? year : year - 1, fyStartMonth - 1, 1)
  const daysPerPeriod = freq === 'weekly' ? 7 : 14
  const monthStart = new Date(year, month, 1)
  const monthEnd = new Date(year, month + 1, 0)
  const periods: { start: Date; end: Date }[] = []
  let anchor = snapToMonday(fyStartDate)
  while (anchor <= monthEnd) {
    const periodEnd = new Date(anchor)
    periodEnd.setDate(periodEnd.getDate() + daysPerPeriod - 1)
    if (periodEnd >= monthStart && anchor <= monthEnd) {
      periods.push({
        start: new Date(anchor),
        end: periodEnd,
      })
    }
    anchor = new Date(anchor)
    anchor.setDate(anchor.getDate() + daysPerPeriod)
    if (anchor > monthEnd) break
  }
  return periods.length > 0 ? periods : [{ start: monthStart, end: monthEnd }]
}

function getNextPeriodForFreq(freq: PayFrequency, fyStartMonth: number, lastRun?: { period_end: string } | null): { start: string; end: string } {
  if (freq === 'monthly') {
    if (lastRun) {
      const lastEnd = new Date(lastRun.period_end + 'T00:00:00')
      const nextStart = new Date(lastEnd)
      nextStart.setDate(nextStart.getDate() + 1)
      const end = new Date(nextStart.getFullYear(), nextStart.getMonth() + 1, 0)
      return { start: localDateStr(nextStart), end: localDateStr(end) }
    }
    const today = new Date()
    const nextDate = new Date(today.getFullYear(), today.getMonth() + 1, 1)
    const end = new Date(nextDate.getFullYear(), nextDate.getMonth() + 1, 0)
    return { start: localDateStr(nextDate), end: localDateStr(end) }
  }
  const daysPerPeriod = freq === 'weekly' ? 7 : 14
  const reference = lastRun ? new Date(lastRun.period_end + 'T00:00:00') : new Date()
  const refMonth = reference.getMonth() + 1
  const fyStartRaw = new Date(refMonth >= fyStartMonth ? reference.getFullYear() : reference.getFullYear() - 1, fyStartMonth - 1, 1)
  const fyStart = snapToMonday(fyStartRaw)
  const daysSinceFyStart = Math.floor((reference.getTime() - fyStart.getTime()) / 86400000)
  const currentPeriodIndex = Math.floor(daysSinceFyStart / daysPerPeriod)
  const nextPeriodStart = new Date(fyStart)
  nextPeriodStart.setDate(nextPeriodStart.getDate() + (currentPeriodIndex + 1) * daysPerPeriod)
  const nextPeriodEnd = new Date(nextPeriodStart)
  nextPeriodEnd.setDate(nextPeriodEnd.getDate() + daysPerPeriod - 1)
  return { start: localDateStr(nextPeriodStart), end: localDateStr(nextPeriodEnd) }
}

interface WorkerTypeSetting {
  id: number; company_id: string; worker_type: string
  pay_pattern: PayFrequency; overtime_handling: string; time_recording: string
  overtime_rate_multiplier: number
  holiday_accrual_rate: number
  holiday_pay_method: 'accrual' | 'rolled_up'
}

function getEffectiveSetting(emp: Employee, settings: WorkerTypeSetting[], field: 'pay_pattern' | 'overtime_handling' | 'time_recording'): string {
  const overrideField = `${field}_override` as 'pay_pattern_override' | 'overtime_handling_override' | 'time_recording_override'
  const override = (emp as any)[overrideField]
  if (override) return override
  const wt = emp.employment_category === 'shift_worker'
    ? (emp.contract_type === 'Zero hours shift worker' ? 'zero_hours' : 'shift_worker')
    : 'employed'
  const setting = settings.find(s => s.worker_type === wt)
  if (setting) return setting[field]
  return field === 'pay_pattern' ? 'monthly' : field === 'overtime_handling' ? 'none' : 'checkin'
}

function getDerivedHourlyRate(emp: Employee): number {
  if (emp.hourly_rate && emp.hourly_rate > 0) return emp.hourly_rate
  if (emp.annual_salary && emp.annual_salary > 0) {
    return Math.round(emp.annual_salary / (52 * (emp.weekly_hours || 37.5)) * 100) / 100
  }
  return 0
}

interface PeriodReview {
  id: string; employee_id: string; period_start: string; period_end: string
  total_hours: number; adjusted_hours: number; overtime_hours: number
  hourly_rate: number; gross_pay: number; status: string
}

function getPayDay(year: number, month: number, mode: 'end' | 'start' | 'custom', customDay: number): Date {
  if (mode === 'start') return new Date(year, month, 1)
  if (mode === 'custom') return new Date(year, month, Math.min(customDay, new Date(year, month + 1, 0).getDate()))
  return new Date(year, month + 1, 0)
}

function getFYRange(fyStartMonth: number) {
  const now = new Date()
  const currentMonth = now.getMonth() + 1
  const startYear = currentMonth >= fyStartMonth ? now.getFullYear() : now.getFullYear() - 1
  return { startDate: new Date(startYear, fyStartMonth - 1, 1), endDate: new Date(startYear + 1, fyStartMonth - 1, 0), startYear }
}

function getFYMonths(fyStartMonth: number) {
  const { startYear } = getFYRange(fyStartMonth)
  const months: { year: number; month: number; label: string }[] = []
  for (let i = 0; i < 12; i++) {
    const m = (fyStartMonth - 1 + i) % 12
    const y = startYear + (fyStartMonth - 1 + i >= 12 ? 1 : 0)
    months.push({ year: y, month: m, label: `${MONTH_NAMES[m]} ${y}` })
  }
  return months
}

interface Payslip {
  id: number; reference_number: string; pay_period_start: string; pay_period_end: string
  gross_pay: number; tax: number; national_insurance: number; pension: number
  other_deductions: number; net_pay: number; payment_date: string; status: string
  tax_code: string; annual_salary: number; payroll_id: string; overtime: number
  adjustments: number; monthly_deductions: number; bank_account: string
  payroll_office: string; source: string; xero_payslip_id: string | null
  released: boolean
  employee: { id: string; first_name: string; last_name: string } | null
}

interface Employee {
  id: string; first_name: string; last_name: string; job_title: string; department: string
  annual_salary: number | null; hourly_rate: number | null; pay_frequency: string | null
  overtime_rate_multiplier: number | null; tax_code: string | null; payroll_id: string | null
  employment_category: string | null; contract_type: string | null
  bank_sort_code: string | null; bank_account_number: string | null; bank_account_name: string | null
  pay_pattern_override: string | null; overtime_handling_override: string | null
  time_recording_override: string | null; is_payroll_exception: boolean | null
  weekly_hours: number | null
  bonus_amount: number | null; bonus_frequency: string | null
  guaranteed_hours_approved: boolean | null; guaranteed_weekly_hours: number | null
  sick_pay_status: 'normal' | 'csp_full' | 'csp_half' | 'ssp' | 'unpaid' | null
}

interface AuditLogEntry {
  id: string; action: string; detail: string | null; employee_id: string | null
  performed_by: string; performer_name: string | null; status: string; created_at: string
}

type View = 'dashboard' | 'payslips' | 'employee_pay' | 'schedule' | 'logs' | 'run_payroll' | 'settings'

export default function AdminPayrollNew() {
  const { selectedCompanyId, selectedCompany } = useAdminCompany()
  const { showError, showSuccess } = useToast()
  const { features } = useFeatures()
  const { session, company } = useAuth()
  const currency = company?.currency || 'GBP'

  const [view, setView] = useState<View>('dashboard')
  const [loading, setLoading] = useState(true)
  const [payslips, setPayslips] = useState<Payslip[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [xeroConnected, setXeroConnected] = useState(false)
  const [sageConnected, setSageConnected] = useState(false)
  const [modulrConnected, setModulrConnected] = useState(false)
  const [modulrPaidPayslips, setModulrPaidPayslips] = useState<Set<number>>(new Set())
  const [modulrHeldPayslips, setModulrHeldPayslips] = useState<Set<number>>(new Set())
  const [modulrPaying, setModulrPaying] = useState(false)
  const [modulrWarning, setModulrWarning] = useState<{ show: boolean; payslipIds: number[]; bulk: boolean }>({ show: false, payslipIds: [], bulk: false })
  const [recentLogs, setRecentLogs] = useState<AuditLogEntry[]>([])

  // Payroll schedule settings
  const [payDayMode, setPayDayMode] = useState<'end' | 'start' | 'custom'>('end')
  const [customPayDay, setCustomPayDay] = useState(28)
  const [shiftPayDayMode, setShiftPayDayMode] = useState<'end' | 'start' | 'custom'>('end')
  const [shiftCustomPayDay, setShiftCustomPayDay] = useState(28)
  const [zeroHrsPayDayMode, setZeroHrsPayDayMode] = useState<'end' | 'start' | 'custom'>('end')
  const [zeroHrsCustomPayDay, setZeroHrsCustomPayDay] = useState(28)

  // Run Payroll wizard state
  const [wizStep, setWizStep] = useState(1)
  const [wizWorkerTypes, setWizWorkerTypes] = useState<Set<'employed' | 'shift' | 'zero_hours'>>(new Set())
  const [wizGenerating, setWizGenerating] = useState(false)
  const [wizGenerated, setWizGenerated] = useState(false)
  const [wizPayMethod, setWizPayMethod] = useState<'bacs' | 'modulr' | 'sage' | 'xero' | 'external'>('external')
  const [wizComplete, setWizComplete] = useState(false)

  // Payslips browse
  const [filterEmployee, setFilterEmployee] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<Record<string, any>>({})
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(new Set())
  const [bulkUpdating, setBulkUpdating] = useState(false)
  const [payslipSubTab, setPayslipSubTab] = useState<'employed' | 'shift' | 'zero_hours'>('employed')
  const [empBenefits, setEmpBenefits] = useState<Record<string, { title: string; enrolled_at: string; monthly_cost: number }[]>>({})
  const [workerSettings, setWorkerSettings] = useState<WorkerTypeSetting[]>([])
  const [editingSettings, setEditingSettings] = useState<Record<string, WorkerTypeSetting>>({})
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [settingsChangeLog, setSettingsChangeLog] = useState<{ id: number; worker_type: string; setting_name: string; old_value: string; new_value: string; exception_count: number; created_at: string }[]>([])
  const [settingsImpactModal, setSettingsImpactModal] = useState<{
    open: boolean; workerType: string; changes: { name: string; oldVal: string; newVal: string }[]
    affectedCount: number; exceptionCount: number; effectiveDate: string; confirmText: string
  }>({ open: false, workerType: '', changes: [], affectedCount: 0, exceptionCount: 0, effectiveDate: '', confirmText: '' })

  const [wizPeriodReviews, setWizPeriodReviews] = useState<PeriodReview[]>([])
  const [wizOvertimeHours, setWizOvertimeHours] = useState<Record<string, number>>({})
  const [wizOvertimeRates, setWizOvertimeRates] = useState<Record<string, number>>({})

  const allOvertimeHours: Record<string, number> = { ...wizOvertimeHours }
  for (const r of wizPeriodReviews) {
    if (r.status === 'approved' && Number(r.overtime_hours) > 0 && !allOvertimeHours[r.employee_id]) {
      allOvertimeHours[r.employee_id] = Number(r.overtime_hours)
    }
  }
  const [wizTimesheetHoursByEmp, setWizTimesheetHoursByEmp] = useState<Record<string, number>>({})
  const [wizPayRunId, setWizPayRunId] = useState<string | null>(null)
  const [wizExporting, setWizExporting] = useState(false)
  const [wizExported, setWizExported] = useState(false)
  const [wizPayslipsFetched, setWizPayslipsFetched] = useState(false)
  const [lastXeroPayRun, setLastXeroPayRun] = useState<{ period_start: string; period_end: string } | null>(null)
  const [wizPushResult, setWizPushResult] = useState<{
    pushed: number; failed: number; skipped: number; api: string;
    timesheet_results?: { employee: string; status: string; hours: number; multiplier: number; rate: number; amount: number; xeroTimesheetId?: string; error?: string }[];
    manual_items?: { employee: string; type: string; description: string; amount: number; days?: number }[];
    skipped_details?: { employee: string; reason: string }[];
    results?: { employee: string; status: string; error?: string }[];
    failed_summary?: string;
    csv_exported?: number;
    csv_items?: { employee: string; type: string; description: string; hours?: number; rate?: number; multiplier?: number; days?: number; amount: number }[];
    provider?: string;
  } | null>(null)
  const [wizReleasing, setWizReleasing] = useState(false)
  const [wizUnpaidLeave, setWizUnpaidLeave] = useState<{ employee_id: string; days: number; employee_name: string }[]>([])
  const [wizBenefitChanges, setWizBenefitChanges] = useState<{ employee_id: string; employee_name: string; benefit: string; action: string; monthly_cost: number }[]>([])
  const [wizBonusEntries, setWizBonusEntries] = useState<{ employee_id: string; employee_name: string; amount: number; description: string; type: 'bonus' | 'deduction' }[]>([])
  const [wizSickLeave, setWizSickLeave] = useState<{ employee_id: string; employee_name: string; days: number; sick_pay_status: string; daily_rate: number; deduction: number; ssp_added: number }[]>([])
  const [wizSickPaySettings, setWizSickPaySettings] = useState<{ enabled: boolean; csp_full_pay_days: number; csp_half_pay_days: number; ssp_weekly_rate: number; ssp_max_weeks: number } | null>(null)
  const [lastPayRuns, setLastPayRuns] = useState<Record<string, { id: string; period_start: string; period_end: string; status: string; completed_at: string | null; total_gross: number }>>({})
  const [processingRuns, setProcessingRuns] = useState<{ id: string; worker_types: string[]; status: string; period_start: string; period_end: string; created_at: string }[]>([])
  const [wizPeriodByType, setWizPeriodByType] = useState<Record<string, { start: string; end: string; freq: PayFrequency; freqLabel: string; overtimeLabel: string }>>({})
  const [wizGeneratingReviews, setWizGeneratingReviews] = useState(false)
  const [wizShiftDetails, setWizShiftDetails] = useState<Record<string, { employee_id: string; check_in_at: string; check_out_at: string; hours: number; scheduled_start?: string; scheduled_end?: string; shift_name?: string; overtime_hours?: number }[]>>({})
  const [wizExpandedEmps, setWizExpandedEmps] = useState<Set<string>>(new Set())
  const [wizManualChecked, setWizManualChecked] = useState<Set<string>>(new Set())
  const [wizBenefitChecked, setWizBenefitChecked] = useState<Set<string>>(new Set())
  const [wizPriorRuns, setWizPriorRuns] = useState<{ id: string; worker_types: string[]; status: string; completed_at: string | null }[]>([])
  const [wizSageFiles, setWizSageFiles] = useState<File[]>([])
  const [wizSageUploading, setWizSageUploading] = useState(false)
  const [wizXeroCsvFile, setWizXeroCsvFile] = useState<File | null>(null)
  const [wizXeroCsvImporting, setWizXeroCsvImporting] = useState(false)
  const [wizRosterPage, setWizRosterPage] = useState(1)
  const [wizPeriodEditType, setWizPeriodEditType] = useState<string | null>(null)

  const providerConnected = xeroConnected || sageConnected
  const connectedProvider = xeroConnected ? 'xero' : sageConnected ? 'sage' : null

  const wizCancelPayRun = async () => {
    if (wizPayRunId) {
      await supabase.from('pay_runs').update({ status: 'cancelled' }).eq('id', wizPayRunId)
    }
    setWizStep(1)
    setWizWorkerTypes(new Set())
    setWizGenerated(false)
    setWizGenerating(false)
    setWizExported(false)
    setWizExporting(false)
    setWizComplete(false)
    setWizReleasing(false)
    setWizPushResult(null)
    setWizOvertimeHours({})
    setWizOvertimeRates({})
    setWizUnpaidLeave([])
    setWizBenefitChanges([])
    setWizBonusEntries([])
    setWizSickLeave([])
    setWizSickPaySettings(null)
    setWizPayRunId(null)
    setWizPayslipsFetched(false)
    setLastXeroPayRun(null)
  }

  // FY
  const fyStartMonth = selectedCompany?.fy_start_month || 4
  const fyMonths = useMemo(() => getFYMonths(fyStartMonth), [fyStartMonth])
  const fyRange = useMemo(() => getFYRange(fyStartMonth), [fyStartMonth])
  const fyLabel = `FY ${fyRange.startYear}/${fyRange.startYear + 1}`

  // Employee categorisation
  const employedEmployees = useMemo(() => employees.filter(e => e.employment_category !== 'shift_worker'), [employees])
  const shiftEmployees = useMemo(() => employees.filter(e => e.employment_category === 'shift_worker' && e.contract_type !== 'Zero hours shift worker'), [employees])
  const zeroHoursEmployees = useMemo(() => employees.filter(e => e.employment_category === 'shift_worker' && e.contract_type === 'Zero hours shift worker'), [employees])

  const ROSTER_PAGE_SIZE = 10
  const wizRunEmployees = useMemo(() => {
    const filtered = employees.filter(e => {
      if (wizWorkerTypes.has('employed') && e.employment_category !== 'shift_worker') return true
      if (wizWorkerTypes.has('shift') && e.employment_category === 'shift_worker' && e.contract_type !== 'Zero hours shift worker') return true
      if (wizWorkerTypes.has('zero_hours') && e.employment_category === 'shift_worker' && e.contract_type === 'Zero hours shift worker') return true
      return false
    })
    return filtered.sort((a, b) => (a.last_name || '').localeCompare(b.last_name || '') || (a.first_name || '').localeCompare(b.first_name || ''))
  }, [employees, wizWorkerTypes])

  // Current month
  const now = new Date()
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  // Stats
  const stats = useMemo(() => {
    const monthsSet = new Set<string>()
    payslips.forEach(p => {
      const d = new Date(p.pay_period_start + 'T00:00:00')
      monthsSet.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    })

    const empIds = new Set(employedEmployees.map(e => e.id))
    const shiftIds = new Set(shiftEmployees.map(e => e.id))
    const zeroIds = new Set(zeroHoursEmployees.map(e => e.id))

    const byType = { employed: { gross: 0, net: 0, tax: 0 }, shift: { gross: 0, net: 0, tax: 0 }, zero_hours: { gross: 0, net: 0, tax: 0 } }
    payslips.forEach(p => {
      const eid = p.employee?.id
      if (!eid) return
      const g = Number(p.gross_pay); const n = Number(p.net_pay); const t = Number(p.tax)
      if (empIds.has(eid)) { byType.employed.gross += g; byType.employed.net += n; byType.employed.tax += t }
      else if (shiftIds.has(eid)) { byType.shift.gross += g; byType.shift.net += n; byType.shift.tax += t }
      else if (zeroIds.has(eid)) { byType.zero_hours.gross += g; byType.zero_hours.net += n; byType.zero_hours.tax += t }
    })

    return {
      total: payslips.length,
      flagged: payslips.filter(p => p.status === 'flagged').length,
      draft: payslips.filter(p => p.status === 'draft').length,
      processed: payslips.filter(p => p.status === 'processed').length,
      paid: payslips.filter(p => p.status === 'paid').length,
      totalGross: payslips.reduce((s, p) => s + Number(p.gross_pay), 0),
      totalNet: payslips.reduce((s, p) => s + Number(p.net_pay), 0),
      totalTax: payslips.reduce((s, p) => s + Number(p.tax), 0),
      activeEmployees: employees.length,
      monthsProcessed: monthsSet.size,
      byType,
    }
  }, [payslips, employees, employedEmployees, shiftEmployees, zeroHoursEmployees])

  // Per-worker-type current month stats
  const workerTypeStats = useMemo(() => {
    const currentPayslips = payslips.filter(p => p.pay_period_start.startsWith(currentMonthKey))
    const types: { key: 'employed' | 'shift' | 'zero_hours'; label: string; colour: string; employees: Employee[]; payslips: Payslip[] }[] = []

    if (employedEmployees.length > 0) {
      const empIds = new Set(employedEmployees.map(e => e.id))
      types.push({
        key: 'employed', label: 'Employed Staff', colour: '#5c6bc0',
        employees: employedEmployees,
        payslips: currentPayslips.filter(p => p.employee?.id && empIds.has(p.employee.id)),
      })
    }
    if (shiftEmployees.length > 0) {
      const shiftIds = new Set(shiftEmployees.map(e => e.id))
      types.push({
        key: 'shift', label: 'Shift Workers', colour: '#7e57c2',
        employees: shiftEmployees,
        payslips: currentPayslips.filter(p => p.employee?.id && shiftIds.has(p.employee.id)),
      })
    }
    if (zeroHoursEmployees.length > 0) {
      const zeroIds = new Set(zeroHoursEmployees.map(e => e.id))
      types.push({
        key: 'zero_hours', label: 'Zero Hours Workers', colour: '#ef6c00',
        employees: zeroHoursEmployees,
        payslips: currentPayslips.filter(p => p.employee?.id && zeroIds.has(p.employee.id)),
      })
    }

    return types.map(t => {
      const allPaid = t.payslips.length > 0 && t.payslips.every(p => p.status === 'paid')
      const hasPayslips = t.payslips.length > 0
      const hasDraft = t.payslips.some(p => p.status === 'draft' || p.status === 'flagged')
      const status = allPaid ? 'paid' : hasPayslips && !hasDraft ? 'submitted' : hasPayslips ? 'in_progress' : 'not_started'
      const gross = t.payslips.reduce((s, p) => s + Number(p.gross_pay), 0)
      const net = t.payslips.reduce((s, p) => s + Number(p.net_pay), 0)

      const wtSettingKey = t.key === 'shift' ? 'shift_worker' : t.key
      const wtSetting = workerSettings.find(s => s.worker_type === wtSettingKey)
      const payFreq = wtSetting?.pay_pattern || 'monthly'
      const isShiftType = t.key === 'shift' || t.key === 'zero_hours'

      let nextPayDate: Date
      let currentPeriodStart = ''
      let currentPeriodEnd = ''
      let processingWindowStart = ''
      let processingWindowEnd = ''

      if (isShiftType && payFreq !== 'monthly') {
        const lastRun = lastPayRuns[t.key]
        const period = getNextPeriodForFreq(payFreq, fyStartMonth, lastRun || null)
        currentPeriodStart = period.start
        currentPeriodEnd = period.end

        const periodEndDate = new Date(period.end + 'T00:00:00')
        const procStart = new Date(periodEndDate)
        procStart.setDate(procStart.getDate() + 1)
        while (procStart.getDay() === 0 || procStart.getDay() === 6) procStart.setDate(procStart.getDate() + 1)
        const procEnd = new Date(procStart)
        procEnd.setDate(procEnd.getDate() + 4)
        while (procEnd.getDay() === 0 || procEnd.getDay() === 6) procEnd.setDate(procEnd.getDate() + 1)

        processingWindowStart = localDateStr(procStart)
        processingWindowEnd = localDateStr(procEnd)
        nextPayDate = procEnd
      } else {
        if (t.key === 'employed') nextPayDate = getPayDay(now.getFullYear(), now.getMonth(), payDayMode, customPayDay)
        else if (t.key === 'shift') nextPayDate = getPayDay(now.getFullYear(), now.getMonth(), shiftPayDayMode, shiftCustomPayDay)
        else nextPayDate = getPayDay(now.getFullYear(), now.getMonth(), zeroHrsPayDayMode, zeroHrsCustomPayDay)
        if (nextPayDate < now) {
          const nextMonth = now.getMonth() + 1
          const nextYear = nextMonth > 11 ? now.getFullYear() + 1 : now.getFullYear()
          if (t.key === 'employed') nextPayDate = getPayDay(nextYear, nextMonth % 12, payDayMode, customPayDay)
          else if (t.key === 'shift') nextPayDate = getPayDay(nextYear, nextMonth % 12, shiftPayDayMode, shiftCustomPayDay)
          else nextPayDate = getPayDay(nextYear, nextMonth % 12, zeroHrsPayDayMode, zeroHrsCustomPayDay)
        }
      }

      return { ...t, status, gross, net, nextPayDate, currentPeriodStart, currentPeriodEnd, processingWindowStart, processingWindowEnd, isShiftType, payFreq }
    })
  }, [payslips, employedEmployees, shiftEmployees, zeroHoursEmployees, currentMonthKey, payDayMode, customPayDay, shiftPayDayMode, shiftCustomPayDay, zeroHrsPayDayMode, zeroHrsCustomPayDay, lastPayRuns, workerSettings, fyStartMonth])

  // Data loading
  useEffect(() => { if (selectedCompanyId) loadAll() }, [selectedCompanyId])


  const loadAll = useCallback(async () => {
    setLoading(true)
    const fyStart = localDateStr(fyRange.startDate)
    const fyEnd = localDateStr(fyRange.endDate)
    const [pRes, eRes, xRes, sRes, mRes] = await Promise.all([
      supabase.from('payslips').select('*, employee:employees!payslips_employee_id_fkey(id, first_name, last_name)').eq('company_id', selectedCompanyId).gte('pay_period_start', fyStart).lte('pay_period_start', fyEnd).order('payment_date', { ascending: false }),
      supabase.from('employees').select('id, first_name, last_name, job_title, department, annual_salary, hourly_rate, pay_frequency, overtime_rate_multiplier, tax_code, payroll_id, employment_category, contract_type, bank_sort_code, bank_account_number, bank_account_name, pay_pattern_override, overtime_handling_override, time_recording_override, is_payroll_exception, weekly_hours, bonus_amount, bonus_frequency, guaranteed_hours_approved, guaranteed_weekly_hours, sick_pay_status').eq('company_id', selectedCompanyId).eq('is_active', true).order('last_name'),
      supabase.from('xero_integrations').select('id, company_id, sync_status').eq('company_id', selectedCompanyId).maybeSingle(),
      supabase.from('sage_integrations').select('id, company_id, sync_status').eq('company_id', selectedCompanyId).maybeSingle(),
      supabase.from('modulr_integrations').select('id, company_id, status').eq('company_id', selectedCompanyId).maybeSingle(),
    ])
    setPayslips((pRes.data as Payslip[]) || [])
    setEmployees((eRes.data as Employee[]) || [])
    setXeroConnected(!!(xRes.data && (xRes.data as any).sync_status !== 'not_connected'))
    setSageConnected(!!(sRes.data && (sRes.data as any).sync_status !== 'not_connected'))
    const isModulrConnected = !!(mRes.data && (mRes.data as any).status === 'connected')
    setModulrConnected(isModulrConnected)

    if (isModulrConnected) {
      const { data: mpData } = await supabase.from('modulr_payments').select('id').eq('company_id', selectedCompanyId).neq('status', 'failed')
      if (mpData?.length) {
        const { data: itemsData } = await supabase.from('modulr_payment_items').select('payslip_id, modulr_hold').in('payment_id', mpData.map(p => p.id)).neq('status', 'failed').not('payslip_id', 'is', null)
        const paid = new Set<number>()
        const held = new Set<number>()
        for (const i of (itemsData || []) as any[]) {
          if (i.modulr_hold) held.add(i.payslip_id)
          else paid.add(i.payslip_id)
        }
        setModulrPaidPayslips(paid)
        setModulrHeldPayslips(held)
      }
    }

    // Load worker type settings
    const { data: wtsData } = await supabase.from('worker_type_settings').select('*').eq('company_id', selectedCompanyId)
    const wsList = (wtsData as WorkerTypeSetting[]) || []
    setWorkerSettings(wsList)
    const esMap: Record<string, WorkerTypeSetting> = {}
    for (const wt of ['employed', 'shift_worker', 'zero_hours']) {
      const existing = wsList.find(s => s.worker_type === wt)
      esMap[wt] = existing ? { ...existing } : { id: 0, company_id: selectedCompanyId!, worker_type: wt, pay_pattern: 'monthly' as PayFrequency, overtime_handling: 'none', time_recording: 'checkin', overtime_rate_multiplier: 1.5, holiday_accrual_rate: 12.07, holiday_pay_method: 'rolled_up' }
    }
    setEditingSettings(esMap)

    const { data: changeLogData } = await supabase.from('worker_setting_change_log').select('*').eq('company_id', selectedCompanyId).order('created_at', { ascending: false }).limit(20)
    setSettingsChangeLog((changeLogData as any[]) || [])

    // Load pay settings from xero_integrations.cached_pay_run
    const settingsRes = await supabase.from('xero_integrations').select('cached_pay_run').eq('company_id', selectedCompanyId).maybeSingle()
    const cpr = ((settingsRes.data as any)?.cached_pay_run as any) || {}
    if (cpr.pay_day_mode) setPayDayMode(cpr.pay_day_mode)
    if (cpr.custom_pay_day) setCustomPayDay(cpr.custom_pay_day)
    if (cpr.shift_pay_day_mode) setShiftPayDayMode(cpr.shift_pay_day_mode)
    if (cpr.shift_custom_pay_day) setShiftCustomPayDay(cpr.shift_custom_pay_day)
    if (cpr.zero_hrs_pay_day_mode) setZeroHrsPayDayMode(cpr.zero_hrs_pay_day_mode)
    if (cpr.zero_hrs_custom_pay_day) setZeroHrsCustomPayDay(cpr.zero_hrs_custom_pay_day)
    if (cpr.period_start && cpr.period_end) setLastXeroPayRun({ period_start: cpr.period_start, period_end: cpr.period_end })

    // Load recent audit logs
    const { data: logData } = await supabase.from('payroll_audit_log').select('*').eq('company_id', selectedCompanyId).order('created_at', { ascending: false }).limit(5)
    setRecentLogs((logData as AuditLogEntry[]) || [])

    // Load last completed pay run per worker type
    const runMap: Record<string, { id: string; period_start: string; period_end: string; status: string; completed_at: string | null; total_gross: number }> = {}
    for (const wt of ['employed', 'shift_worker', 'zero_hours']) {
      const { data: runs } = await supabase.from('pay_runs')
        .select('id, period_start, period_end, status, completed_at')
        .eq('company_id', selectedCompanyId!)
        .contains('worker_types', [wt])
        .in('status', ['completed', 'released', 'synced', 'exported'])
        .order('completed_at', { ascending: false })
        .limit(1)
      if (runs && runs.length > 0) {
        const run = runs[0]
        const { data: runPayslips } = await supabase.from('payslips')
          .select('gross_pay')
          .eq('company_id', selectedCompanyId!)
          .gte('pay_period_start', run.period_start)
          .lte('pay_period_end', run.period_end)
        const totalGross = (runPayslips || []).reduce((s, p) => s + Number(p.gross_pay), 0)
        const key = wt === 'shift_worker' ? 'shift' : wt
        runMap[key] = { ...run, total_gross: totalGross }
      }
    }
    setLastPayRuns(runMap)

    const { data: procRuns } = await supabase.from('pay_runs')
      .select('id, worker_types, status, period_start, period_end, created_at')
      .eq('company_id', selectedCompanyId!)
      .in('status', ['processing', 'exported'])
      .order('created_at', { ascending: false })
      .limit(5)
    setProcessingRuns((procRuns || []) as any)

    setLoading(false)
  }, [selectedCompanyId, fyRange])

  function saveWorkerTypeSettings(workerType: string) {
    const setting = editingSettings[workerType]
    if (!setting) return
    const existing = workerSettings.find(s => s.worker_type === workerType)
    const changedFields: { name: string; oldVal: string; newVal: string }[] = []
    if (existing) {
      if (existing.pay_pattern !== setting.pay_pattern) changedFields.push({ name: 'pay_pattern', oldVal: existing.pay_pattern, newVal: setting.pay_pattern })
      if (existing.overtime_handling !== setting.overtime_handling) changedFields.push({ name: 'overtime_handling', oldVal: existing.overtime_handling, newVal: setting.overtime_handling })
      if (existing.time_recording !== setting.time_recording) changedFields.push({ name: 'time_recording', oldVal: existing.time_recording, newVal: setting.time_recording })
      if (Number(existing.overtime_rate_multiplier) !== Number(setting.overtime_rate_multiplier)) changedFields.push({ name: 'overtime_rate_multiplier', oldVal: String(existing.overtime_rate_multiplier), newVal: String(setting.overtime_rate_multiplier) })
    }
    if (changedFields.length === 0 && existing) { showSuccess('No changes to save'); return }
    const workerTypeFilter = workerType === 'zero_hours'
      ? employees.filter(e => e.employment_category === 'shift_worker' && e.contract_type === 'Zero hours shift worker')
      : workerType === 'shift_worker'
      ? employees.filter(e => e.employment_category === 'shift_worker' && e.contract_type !== 'Zero hours shift worker')
      : employees.filter(e => e.employment_category === 'employed')
    const exceptionCount = workerTypeFilter.filter(e => e.pay_pattern_override != null || e.overtime_handling_override != null || e.time_recording_override != null).length
    const nextMonth = new Date()
    nextMonth.setMonth(nextMonth.getMonth() + 1, 1)
    const defaultEffective = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-${String(nextMonth.getDate()).padStart(2, '0')}`
    setSettingsImpactModal({ open: true, workerType, changes: changedFields, affectedCount: workerTypeFilter.length - exceptionCount, exceptionCount, effectiveDate: defaultEffective, confirmText: '' })
  }

  async function confirmSaveWorkerTypeSettings() {
    const { workerType, changes, effectiveDate } = settingsImpactModal
    setSettingsSaving(true)
    const setting = editingSettings[workerType]
    if (!setting) { setSettingsSaving(false); return }
    const { error } = await supabase.from('worker_type_settings').upsert({
      company_id: selectedCompanyId, worker_type: workerType,
      pay_pattern: setting.pay_pattern, overtime_handling: setting.overtime_handling,
      time_recording: setting.time_recording, overtime_rate_multiplier: setting.overtime_rate_multiplier,
      holiday_accrual_rate: setting.holiday_accrual_rate ?? 12.07,
      holiday_pay_method: setting.holiday_pay_method ?? 'rolled_up',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'company_id,worker_type' })
    if (error) { showError('Failed to save settings: ' + error.message); setSettingsSaving(false); return }
    const workerTypeFilter = workerType === 'zero_hours'
      ? employees.filter(e => e.employment_category === 'shift_worker' && e.contract_type === 'Zero hours shift worker')
      : workerType === 'shift_worker'
      ? employees.filter(e => e.employment_category === 'shift_worker' && e.contract_type !== 'Zero hours shift worker')
      : employees.filter(e => e.employment_category === 'employed')
    const impactParts: string[] = []
    for (const change of changes) {
      const overrideField = change.name + '_override'
      const exceptionIds = workerTypeFilter.filter(e => (e as any)[overrideField] != null).map(e => e.id)
      impactParts.push(`${change.name}: ${change.oldVal} → ${change.newVal}`)
      await supabase.from('worker_setting_change_log').insert({
        company_id: selectedCompanyId, worker_type: workerType, setting_name: change.name,
        old_value: change.oldVal, new_value: change.newVal, exception_employee_ids: exceptionIds,
        exception_count: exceptionIds.length, effective_date: effectiveDate || null,
        impact_summary: `Affects ${workerTypeFilter.length - exceptionIds.length} employee(s), ${exceptionIds.length} exception(s)`,
      })
    }
    await supabase.from('payroll_audit_log').insert({
      company_id: selectedCompanyId, action: 'Worker Type Settings Changed',
      detail: `${workerType}: ${impactParts.join('; ')}. Effective: ${effectiveDate || 'Immediately'}`, status: 'success',
    })
    setSettingsImpactModal({ open: false, workerType: '', changes: [], affectedCount: 0, exceptionCount: 0, effectiveDate: '', confirmText: '' })
    showSuccess('Settings saved with audit trail')
    setSettingsSaving(false)
    loadAll()
  }

  // Payslip filtering for browse view
  const empCategoryById = useMemo(() => {
    const map: Record<string, string> = {}
    employees.forEach(e => { map[e.id] = e.employment_category || 'not_assigned' })
    return map
  }, [employees])

  const filtered = useMemo(() => {
    const base = payslips.filter(p => {
      if (filterStatus === 'released' && !p.released) return false
      if (filterStatus === 'unreleased' && p.released) return false
      if (filterStatus && filterStatus !== 'released' && filterStatus !== 'unreleased' && p.status !== filterStatus) return false
      if (filterEmployee && p.employee && `${p.employee.first_name} ${p.employee.last_name}` !== filterEmployee) return false
      if (p.employee?.id) {
        const cat = empCategoryById[p.employee.id] || 'not_assigned'
        const emp = employees.find(e => e.id === p.employee!.id)
        const isZero = cat === 'shift_worker' && emp?.contract_type === 'Zero hours shift worker'
        const isShift = cat === 'shift_worker' && !isZero
        if (payslipSubTab === 'employed' && cat === 'shift_worker') return false
        if (payslipSubTab === 'shift' && !isShift) return false
        if (payslipSubTab === 'zero_hours' && !isZero) return false
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
  }, [filterStatus, filterEmployee, payslips, search, payslipSubTab, empCategoryById, employees])

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
      const ps = map.get(key)!
      const starts = ps.map(p => p.pay_period_start).sort()
      const ends = ps.map(p => p.pay_period_end).sort().reverse()
      const periodRange = starts[0] && ends[0] ? ` (${formatDate(starts[0])} – ${formatDate(ends[0])})` : ''
      const label = `${MONTH_NAMES[mo - 1]} ${yr}${periodRange}`
      groups.push({ key, label, payslips: ps })
    })
    return groups
  }, [filtered])

  const empNames = useMemo(() => {
    const names = new Set<string>()
    payslips.forEach(p => { if (p.employee) names.add(`${p.employee.first_name} ${p.employee.last_name}`) })
    return Array.from(names).sort()
  }, [payslips])

  useEffect(() => {
    if (groupedByMonth.length > 0) {
      const latestKey = groupedByMonth[0].key
      const olderKeys = groupedByMonth.slice(1).map(g => g.key)
      setCollapsedMonths(new Set(olderKeys.filter(k => k !== latestKey)))
    }
  }, [groupedByMonth.length])

  async function loadWizPeriodReviews(periodMap?: Record<string, { start: string; end: string }>) {
    if (!selectedCompanyId) return
    const pm = periodMap || wizPeriodByType
    const uniquePeriods = new Map<string, { start: string; end: string }>()
    for (const p of Object.values(pm)) {
      uniquePeriods.set(`${p.start}_${p.end}`, p)
    }
    const allReviews: PeriodReview[] = []
    for (const p of uniquePeriods.values()) {
      const { data } = await supabase.from('pay_period_reviews')
        .select('id, employee_id, period_start, period_end, total_hours, adjusted_hours, overtime_hours, hourly_rate, gross_pay, status')
        .eq('company_id', selectedCompanyId)
        .eq('period_start', p.start)
        .eq('period_end', p.end)
      if (data) allReviews.push(...(data as PeriodReview[]))
    }
    const seen = new Set<string>()
    const deduped = allReviews.filter(r => {
      const key = `${r.employee_id}_${r.period_start}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    setWizPeriodReviews(deduped)
  }

  async function loadWizTimesheets(periodMap?: Record<string, { start: string; end: string }>) {
    if (!selectedCompanyId) return
    const pm = periodMap || wizPeriodByType
    const allStarts = Object.values(pm).map(p => p.start)
    const allEnds = Object.values(pm).map(p => p.end)
    const monthStart = allStarts.sort()[0] || localDateStr(new Date(now.getFullYear(), now.getMonth() + 1, 1))
    const monthEnd = allEnds.sort().reverse()[0] || localDateStr(new Date(now.getFullYear(), now.getMonth() + 2, 0))

    const checkinEmpIds = employedEmployees
      .filter(e => getEffectiveSetting(e, workerSettings, 'time_recording') === 'checkin')
      .map(e => e.id)
    const timesheetEmpIds = employedEmployees
      .filter(e => getEffectiveSetting(e, workerSettings, 'time_recording') !== 'checkin')
      .map(e => e.id)

    const hoursByEmp: Record<string, number> = {}

    if (timesheetEmpIds.length > 0) {
      const { data } = await supabase.from('timesheets')
        .select('employee_id, hours, date, end_date')
        .eq('company_id', selectedCompanyId)
        .eq('status', 'approved')
        .in('employee_id', timesheetEmpIds)
        .or(`and(date.gte.${monthStart},date.lte.${monthEnd}),and(end_date.gte.${monthStart},end_date.lte.${monthEnd}),and(date.lte.${monthStart},end_date.gte.${monthEnd})`)
      if (data) {
        for (const t of data as { employee_id: string; hours: number }[]) {
          hoursByEmp[t.employee_id] = (hoursByEmp[t.employee_id] || 0) + Number(t.hours)
        }
      }
    }

    if (checkinEmpIds.length > 0) {
      const { data: checkins } = await supabase.from('checkin_records')
        .select('employee_id, check_in_at, check_out_at, status, shift_assignment_id')
        .eq('company_id', selectedCompanyId)
        .in('status', ['checked_out', 'auto_closed'])
        .in('employee_id', checkinEmpIds)
        .gte('check_in_at', monthStart + 'T00:00:00')
        .lte('check_in_at', monthEnd + 'T23:59:59')
      if (checkins) {
        const allAssignIds = [...new Set((checkins as any[]).filter(c => c.shift_assignment_id).map(c => c.shift_assignment_id))]
        const schedMap = new Map<string, number>()
        const breakMap = new Map<string, number>()
        if (allAssignIds.length > 0) {
          const { data: assigns } = await supabase.from('shift_assignments')
            .select('id, shift_template:shift_templates(start_time, end_time, break_minutes)')
            .in('id', allAssignIds)
          if (assigns) {
            for (const a of assigns as any[]) {
              const tmpl = Array.isArray(a.shift_template) ? a.shift_template[0] : a.shift_template
              if (tmpl?.start_time && tmpl?.end_time) {
                const [sh, sm] = tmpl.start_time.split(':').map(Number)
                const [eh, em] = tmpl.end_time.split(':').map(Number)
                let dur = (eh * 60 + em - (sh * 60 + sm)) / 60
                if (dur <= 0) dur += 24
                schedMap.set(a.id, dur)
              }
              breakMap.set(a.id, tmpl?.break_minutes ?? 30)
            }
          }
        }
        const deductedAssignments = new Set<string>()
        for (const c of checkins as { employee_id: string; check_in_at: string; check_out_at: string | null; status: string; shift_assignment_id: string | null }[]) {
          if (!c.check_out_at) continue
          let hrs = (new Date(c.check_out_at).getTime() - new Date(c.check_in_at).getTime()) / 3600000
          if (hrs <= 0 || hrs >= 24) continue
          if (c.status === 'auto_closed' && c.shift_assignment_id) {
            const sched = schedMap.get(c.shift_assignment_id)
            if (sched && hrs > sched) hrs = sched
          }
          if (c.shift_assignment_id && !deductedAssignments.has(c.shift_assignment_id)) {
            const breakMins = breakMap.get(c.shift_assignment_id) ?? 30
            hrs = Math.max(0, hrs - breakMins / 60)
            deductedAssignments.add(c.shift_assignment_id)
          }
          hoursByEmp[c.employee_id] = (hoursByEmp[c.employee_id] || 0) + Math.round(hrs * 100) / 100
        }
      }
    }

    setWizTimesheetHoursByEmp(hoursByEmp)

    const autoOvertime: Record<string, number> = {}
    for (const emp of employees) {
      const approvedHours = hoursByEmp[emp.id] || 0
      if (approvedHours <= 0) continue
      const weeklyHours = emp.weekly_hours || 37.5
      const freq = getEffectiveSetting(emp, workerSettings, 'pay_pattern') as PayFrequency
      const weeksInPeriod = freq === 'weekly' ? 1 : freq === 'bi_weekly' ? 2 : 52 / 12
      const contractedHours = weeklyHours * weeksInPeriod
      const overtime = Math.max(0, approvedHours - contractedHours)
      if (overtime > 0) autoOvertime[emp.id] = Math.round(overtime * 100) / 100
    }
    setWizOvertimeHours(autoOvertime)
    const autoRates: Record<string, number> = {}
    for (const emp of employees) {
      autoRates[emp.id] = getDerivedHourlyRate(emp)
    }
    setWizOvertimeRates(autoRates)
  }

  async function loadWizAdjustments(periodMap?: Record<string, { start: string; end: string }>) {
    if (!selectedCompanyId) return
    const pm = periodMap || wizPeriodByType
    const allStarts = Object.values(pm).map(p => p.start)
    const allEnds = Object.values(pm).map(p => p.end)
    const monthStart = allStarts.sort()[0] || localDateStr(new Date(now.getFullYear(), now.getMonth() + 1, 1))
    const monthEnd = allEnds.sort().reverse()[0] || localDateStr(new Date(now.getFullYear(), now.getMonth() + 2, 0))

    const { data: leaveData } = await supabase.from('leave_requests')
      .select('employee_id, days_requested, employees!leave_requests_employee_id_fkey(first_name, last_name)')
      .eq('company_id', selectedCompanyId)
      .eq('status', 'approved')
      .eq('leave_type', 'Unpaid Leave')
      .gte('start_date', monthStart)
      .lte('start_date', monthEnd)
    const targetEmpIds = new Set(employees.filter(e => {
      if (wizWorkerTypes.has('employed') && e.employment_category !== 'shift_worker') return true
      if (wizWorkerTypes.has('shift') && e.employment_category === 'shift_worker' && e.contract_type !== 'Zero hours shift worker') return true
      if (wizWorkerTypes.has('zero_hours') && e.employment_category === 'shift_worker' && e.contract_type === 'Zero hours shift worker') return true
      return false
    }).map(e => e.id))

    const unpaid: { employee_id: string; days: number; employee_name: string }[] = []
    if (leaveData) {
      for (const r of leaveData as any[]) {
        if (!targetEmpIds.has(r.employee_id)) continue
        const emp = r.employees
        unpaid.push({
          employee_id: r.employee_id,
          days: Number(r.days_requested) || 1,
          employee_name: emp ? `${emp.first_name} ${emp.last_name}` : 'Unknown',
        })
      }
    }
    setWizUnpaidLeave(unpaid)

    const adjPeriodStart = new Date(monthStart)
    const recentStart = new Date(adjPeriodStart)
    recentStart.setDate(recentStart.getDate() - 30)
    const { data: enrollData } = await supabase.from('benefit_enrollments')
      .select('employee_id, enrolled_at, benefit_type:benefit_types(title, monthly_cost)')
      .eq('company_id', selectedCompanyId)
      .gte('enrolled_at', localDateStr(recentStart))
      .lte('enrolled_at', monthEnd)
    const changes: { employee_id: string; employee_name: string; benefit: string; action: string; monthly_cost: number }[] = []
    if (enrollData) {
      for (const r of enrollData as any[]) {
        if (!targetEmpIds.has(r.employee_id)) continue
        const emp = employees.find(e => e.id === r.employee_id)
        changes.push({
          employee_id: r.employee_id,
          employee_name: emp ? `${emp.first_name} ${emp.last_name}` : 'Unknown',
          benefit: r.benefit_type?.title || 'Benefit',
          action: 'New enrolment',
          monthly_cost: r.benefit_type?.monthly_cost || 0,
        })
      }
    }
    setWizBenefitChanges(changes)

    // Load sick pay settings and sick leave adjustments
    const { data: sickSettings } = await supabase.from('sick_pay_settings')
      .select('enabled, csp_full_pay_days, csp_half_pay_days, ssp_weekly_rate, ssp_max_weeks')
      .eq('company_id', selectedCompanyId)
      .maybeSingle()
    setWizSickPaySettings(sickSettings || null)

    if (sickSettings?.enabled) {
      const { data: sickLeaveData } = await supabase.from('leave_requests')
        .select('employee_id, days_requested, start_date, end_date, employees!leave_requests_employee_id_fkey(first_name, last_name, sick_pay_status, annual_salary, hourly_rate, weekly_hours, employment_category, contract_type)')
        .eq('company_id', selectedCompanyId)
        .eq('status', 'approved')
        .eq('leave_type', 'Sick Leave')
        .lte('start_date', monthEnd)
        .gte('end_date', monthStart)

      const sickItems: typeof wizSickLeave = []
      if (sickLeaveData) {
        for (const r of sickLeaveData as any[]) {
          if (!targetEmpIds.has(r.employee_id)) continue
          const empData = r.employees
          if (!empData || !empData.sick_pay_status || empData.sick_pay_status === 'normal') continue

          const sickDays = Number(r.days_requested) || 1
          const empName = `${empData.first_name} ${empData.last_name}`
          const status = empData.sick_pay_status as string

          // Calculate daily rate
          let dailyRate = 0
          const isShift = empData.employment_category === 'shift_worker'
          if (isShift && empData.hourly_rate > 0) {
            const weeklyHrs = empData.weekly_hours || 37.5
            const contractedDays = 5
            dailyRate = Math.round((empData.hourly_rate * weeklyHrs / contractedDays) * 100) / 100
          } else if (empData.annual_salary > 0) {
            dailyRate = Math.round((empData.annual_salary / 260) * 100) / 100
          }

          let deduction = 0
          let sspAdded = 0
          const sspDailyRate = sickSettings.ssp_weekly_rate / 5 // qualifying days typically 5

          if (status === 'csp_full') {
            deduction = 0 // full pay maintained
          } else if (status === 'csp_half') {
            deduction = Math.round(dailyRate * 0.5 * sickDays * 100) / 100
          } else if (status === 'ssp') {
            deduction = Math.round(dailyRate * sickDays * 100) / 100
            sspAdded = Math.round(sspDailyRate * sickDays * 100) / 100
          } else if (status === 'unpaid') {
            deduction = Math.round(dailyRate * sickDays * 100) / 100
          }

          sickItems.push({
            employee_id: r.employee_id,
            employee_name: empName,
            days: sickDays,
            sick_pay_status: status,
            daily_rate: dailyRate,
            deduction,
            ssp_added: sspAdded,
          })
        }
      }
      setWizSickLeave(sickItems)
    } else {
      setWizSickLeave([])
    }
  }

  async function logPayrollAction(action: string, detail: string, status: 'success' | 'error' = 'success') {
    if (!selectedCompanyId || !session) return
    await supabase.from('payroll_audit_log').insert({
      company_id: selectedCompanyId,
      user_id: session.user.id,
      action,
      detail,
      status,
    })
  }

  // Wizard: generate payslips for selected worker types
  async function wizGenerate() {
    setWizGenerating(true)
    const allStarts = Object.values(wizPeriodByType).map(p => p.start).sort()
    const allEnds = Object.values(wizPeriodByType).map(p => p.end).sort().reverse()
    const periodStart = allStarts[0] || localDateStr(new Date(now.getFullYear(), now.getMonth() + 1, 1))
    const periodEnd = allEnds[0] || localDateStr(new Date(now.getFullYear(), now.getMonth() + 2, 0))
    const nextKey = periodStart.slice(0, 7)

    const targetEmployees = employees.filter(e => {
      if (wizWorkerTypes.has('employed') && e.employment_category !== 'shift_worker') return true
      if (wizWorkerTypes.has('shift') && e.employment_category === 'shift_worker' && e.contract_type !== 'Zero hours shift worker') return true
      if (wizWorkerTypes.has('zero_hours') && e.employment_category === 'shift_worker' && e.contract_type === 'Zero hours shift worker') return true
      return false
    })

    const targetEmpIds = new Set(targetEmployees.map(e => e.id))
    const existingForTarget = payslips.filter(p => p.pay_period_start >= periodStart && p.pay_period_start <= periodEnd && p.employee && targetEmpIds.has(p.employee.id))
    if (existingForTarget.length > 0) {
      showError(`Payslips for ${existingForTarget.length} of these employees already exist for ${formatDate(periodStart)} – ${formatDate(periodEnd)}. Run a different worker type or navigate to a different period.`)
      setWizGenerating(false)
      return
    }

    if (targetEmployees.length === 0) {
      showError('No employees match the selected worker types')
      setWizGenerating(false)
      return
    }

    const batch = Date.now().toString(36).slice(-4)

    const workerTypeArr = [...wizWorkerTypes].map(t => t === 'shift' ? 'shift_worker' : t)
    const { data: existingRun } = await supabase.from('pay_runs')
      .select('id').eq('company_id', selectedCompanyId)
      .eq('period_start', periodStart).eq('period_end', periodEnd).maybeSingle()

    let payRunData: { id: string } | null = null
    let payRunError: any = null

    if (existingRun) {
      const res = await supabase.from('pay_runs').update({
        status: 'generating', worker_types: workerTypeArr, created_by: session?.user?.id || null,
      }).eq('id', existingRun.id).select('id').single()
      payRunData = res.data
      payRunError = res.error
    } else {
      const res = await supabase.from('pay_runs').insert({
        company_id: selectedCompanyId, frequency: 'monthly', period_start: periodStart,
        period_end: periodEnd, status: 'generating', worker_types: workerTypeArr,
        created_by: session?.user?.id || null,
      }).select('id').single()
      payRunData = res.data
      payRunError = res.error
    }

    if (payRunError) {
      showError('Failed to create pay run: ' + payRunError.message)
      setWizGenerating(false)
      return
    }
    const payRunId = payRunData!.id
    setWizPayRunId(payRunId)

    const { data: allEnrollments } = await supabase
      .from('benefit_enrollments')
      .select('employee_id, enrolled_at, benefit_type:benefit_types(monthly_cost, is_enabled)')
      .eq('company_id', selectedCompanyId)
      .is('option_id', null)
    const benefitCostMapMonthly: Record<string, number> = {}
    if (allEnrollments) {
      for (const row of allEnrollments as any[]) {
        const bt = row.benefit_type
        if (!bt?.is_enabled || !bt.monthly_cost) continue
        if (new Date(row.enrolled_at) > new Date(periodEnd)) continue
        benefitCostMapMonthly[row.employee_id] = (benefitCostMapMonthly[row.employee_id] || 0) + (bt.monthly_cost || 0)
      }
    }

    let nextPayrollSeq = 0
    const { data: existingIds } = await supabase.from('employees').select('payroll_id').eq('company_id', selectedCompanyId).not('payroll_id', 'is', null)
    if (existingIds) {
      for (const r of existingIds) {
        const m = (r.payroll_id || '').match(/^PAY-(\d+)$/)
        if (m) nextPayrollSeq = Math.max(nextPayrollSeq, parseInt(m[1], 10))
      }
    }

    const errors: string[] = []
    let payslipIdx = 0
    for (const emp of targetEmployees) {
      if (!emp.payroll_id) {
        nextPayrollSeq++
        emp.payroll_id = `PAY-${String(nextPayrollSeq).padStart(4, '0')}`
        await supabase.from('employees').update({ payroll_id: emp.payroll_id }).eq('id', emp.id)
      }

      const isShiftOrZero = emp.employment_category === 'shift_worker'
      const freq = getEffectiveSetting(emp, workerSettings, 'pay_pattern') as PayFrequency
      const overtimeHandling = getEffectiveSetting(emp, workerSettings, 'overtime_handling')
      const wtKey = isShiftOrZero ? (emp.contract_type === 'Zero hours shift worker' ? 'zero_hours' : 'shift') : 'employed'
      const wtPeriod = wizPeriodByType[wtKey]
      const pDate = wtPeriod ? new Date(wtPeriod.start) : new Date(periodStart)
      const periods = getPeriodBoundaries(pDate.getFullYear(), pDate.getMonth(), freq, fyStartMonth)

      if (isShiftOrZero) {
        const empReview = wizPeriodReviews.find(r => r.employee_id === emp.id && r.status === 'approved')
        if (!empReview) {
          errors.push(`${emp.first_name} ${emp.last_name}: No confirmed check-in hours for this period`)
          continue
        }

        const reviewGross = Number(empReview.gross_pay)
        const totalHoursWorked = Number(empReview.total_hours)
        const benefitMonthly = benefitCostMapMonthly[emp.id] || 0
        const benefitPeriod = prorateBenefit(benefitMonthly, freq)

        const isZeroHours = emp.contract_type === 'Zero hours shift worker'
        const zhSetting = workerSettings.find(s => s.worker_type === 'zero_hours')
        const accrualRate = zhSetting?.holiday_accrual_rate ?? 12.07
        const holidayMethod = zhSetting?.holiday_pay_method ?? 'rolled_up'
        let holidayPayAmount = 0
        let accruedHoursRaw = 0
        let accruedHoursRounded = 0

        if (isZeroHours) {
          if (emp.guaranteed_hours_approved && Number(emp.guaranteed_weekly_hours) > 0) {
            const guaranteedWeekly = Number(emp.guaranteed_weekly_hours)
            const weeksInPeriod = freq === 'monthly' ? 52 / 12 : freq === 'bi_weekly' ? 2 : 1
            const guaranteedHours = guaranteedWeekly * weeksInPeriod
            const excessHours = Math.max(0, totalHoursWorked - guaranteedHours)
            const { data: zhcSettings } = await supabase.from('zero_hours_compliance_settings')
              .select('guaranteed_hours_overtime_rate').eq('company_id', selectedCompanyId).maybeSingle()
            const overtimeRate = zhcSettings?.guaranteed_hours_overtime_rate ?? 12.07
            if (holidayMethod === 'rolled_up') {
              const hourlyRate = emp.hourly_rate || 0
              const excessGross = excessHours * hourlyRate
              holidayPayAmount = Math.round(excessGross * (overtimeRate / 100) * 100) / 100
            } else {
              accruedHoursRaw = excessHours * (overtimeRate / 100)
              accruedHoursRounded = Math.round(accruedHoursRaw)
            }
          } else if (holidayMethod === 'rolled_up') {
            holidayPayAmount = Math.round(reviewGross * (accrualRate / 100) * 100) / 100
          } else {
            accruedHoursRaw = totalHoursWorked * (accrualRate / 100)
            accruedHoursRounded = Math.round(accruedHoursRaw)
          }
        }

        let cancellationCompensation = 0
        if (isZeroHours && wtPeriod) {
          const { data: cancLogs } = await supabase.from('shift_cancellation_log')
            .select('id, compensation_amount')
            .eq('company_id', selectedCompanyId).eq('employee_id', emp.id)
            .eq('within_notice_window', true).eq('compensation_included_in_payrun', false)
            .gte('shift_date', wtPeriod.start).lte('shift_date', wtPeriod.end)
          if (cancLogs && cancLogs.length > 0) {
            cancellationCompensation = cancLogs.reduce((s: number, c: any) => s + Number(c.compensation_amount), 0)
            cancellationCompensation = Math.round(cancellationCompensation * 100) / 100
            const cancIds = cancLogs.map((c: any) => c.id)
            await supabase.from('shift_cancellation_log').update({ compensation_included_in_payrun: true }).in('id', cancIds)
          }
        }

        // Sick pay adjustment for shift/zero-hours workers
        const empSickAdj = wizSickLeave.find(s => s.employee_id === emp.id)
        let sickPayDeduction = 0
        let sickPayAmount = 0
        let sickPayType: string | null = null
        let sickDaysInPeriod = 0
        if (empSickAdj && empSickAdj.deduction > 0) {
          sickPayDeduction = empSickAdj.deduction
          sickPayAmount = empSickAdj.ssp_added
          sickPayType = empSickAdj.sick_pay_status
          sickDaysInPeriod = empSickAdj.days
          if (isZeroHours && empSickAdj.sick_pay_status === 'ssp') {
            errors.push(`${emp.first_name} ${emp.last_name}: Zero hours worker on SSP — may not qualify. Please verify eligibility.`)
          }
        }

        const effectiveGross = reviewGross + holidayPayAmount + cancellationCompensation - sickPayDeduction + sickPayAmount
        const annualised = effectiveGross * getPeriodsPerYear(freq)
        const annualAfterSacrifice = annualised - (benefitMonthly * 12)
        const tax = calcTax(annualAfterSacrifice, freq)
        const ni = calcNI(annualAfterSacrifice, freq)
        const pen = Math.round(effectiveGross * 0.05 * 100) / 100

        // TOIL: credit lieu_days for overtime instead of paying it
        if (overtimeHandling === 'toil' && Number(empReview.overtime_hours) > 0) {
          const dailyHours = (emp.weekly_hours || 37.5) / 5
          const toilDays = Math.round(Number(empReview.overtime_hours) / dailyHours * 100) / 100
          try {
            const { data: lb } = await supabase.from('leave_balances').select('lieu_days').eq('employee_id', emp.id).maybeSingle()
            const currentLieu = lb?.lieu_days || 0
            await supabase.from('leave_balances').update({ lieu_days: currentLieu + toilDays }).eq('employee_id', emp.id)
          } catch { /* TOIL credit failure is non-blocking */ }
        }

        for (let pi = 0; pi < periods.length; pi++) {
          payslipIdx++
          const period = periods[pi]
          const paymentDate = new Date(period.end)
          paymentDate.setDate(paymentDate.getDate() + 3)

          const { data: payslipRow, error } = await supabase.from('payslips').insert({
            employee_id: emp.id, company_id: selectedCompanyId,
            reference_number: `PAY-${nextKey}-${batch}-${String(payslipIdx).padStart(3, '0')}`,
            pay_period_start: localDateStr(period.start), pay_period_end: localDateStr(period.end),
            pay_period_type: freq,
            source_review_id: empReview.id,
            pay_run_id: payRunId,
            gross_pay: effectiveGross, tax, national_insurance: ni, pension: pen, other_deductions: 0,
            monthly_deductions: benefitPeriod,
            net_pay: (effectiveGross - benefitPeriod) - tax - ni - pen,
            payment_date: localDateStr(paymentDate),
            status: 'draft',
            tax_code: emp.tax_code || '1257L',
            annual_salary: emp.annual_salary || 0,
            payroll_id: emp.payroll_id,
            overtime: Number(empReview.overtime_hours) || 0,
            holiday_pay: holidayPayAmount,
            cancellation_compensation: cancellationCompensation,
            sick_pay: sickPayAmount > 0 ? sickPayAmount : sickPayDeduction > 0 ? -sickPayDeduction : 0,
            sick_pay_type: sickPayType,
            sick_days_in_period: sickDaysInPeriod,
          }).select('id').maybeSingle()
          if (error) errors.push(`${emp.first_name} ${emp.last_name}: ${error.message}`)

          if (isZeroHours && !error) {
            await supabase.from('holiday_accrual_log').insert({
              employee_id: emp.id, company_id: selectedCompanyId,
              pay_period_start: localDateStr(period.start), pay_period_end: localDateStr(period.end),
              hours_worked: totalHoursWorked, accrual_rate: accrualRate,
              hours_accrued_raw: Math.round(accruedHoursRaw * 100) / 100,
              hours_accrued_rounded: accruedHoursRounded,
              holiday_pay_amount: holidayPayAmount,
              method: holidayMethod,
              payslip_id: payslipRow?.id || null,
            })
            if (holidayMethod === 'accrual' && accruedHoursRounded > 0) {
              const periodYear = new Date(period.start).getFullYear()
              await supabase.rpc('accrue_holiday_hours', { p_employee_id: emp.id, p_company_id: selectedCompanyId, p_year: periodYear, p_hours: accruedHoursRounded })
            }
          }

          if (freq === 'monthly') break
        }
      } else {
        const latest = payslips.find(p => p.employee?.id === emp.id)
        const salary = emp.annual_salary || latest?.annual_salary || 42000
        const periodsPerYear = getPeriodsPerYear(freq)
        const gross = Math.round((salary / periodsPerYear) * 100) / 100
        const benefitMonthly = benefitCostMapMonthly[emp.id] || 0
        const benefitPeriod = prorateBenefit(benefitMonthly, freq)
        const annualAfterSacrifice = salary - (benefitMonthly * 12)
        const tax = latest ? Math.round((Number(latest.tax) * 12 / periodsPerYear) * 100) / 100 : calcTax(annualAfterSacrifice, freq)
        const ni = latest ? Math.round((Number(latest.national_insurance) * 12 / periodsPerYear) * 100) / 100 : calcNI(annualAfterSacrifice, freq)
        const pen = latest ? Math.round((Number(latest.pension) * 12 / periodsPerYear) * 100) / 100 : Math.round(gross * 0.05 * 100) / 100

        const empOvertimeHrs = overtimeHandling === 'overtime' ? (wizOvertimeHours[emp.id] || 0) : 0
        const multiplier = emp.overtime_rate_multiplier || 1.5
        const hourlyFromSalary = wizOvertimeRates[emp.id] || getDerivedHourlyRate(emp) || salary / (52 * (emp.weekly_hours || 37.5))
        const overtimePay = empOvertimeHrs > 0 ? Math.round(empOvertimeHrs * hourlyFromSalary * multiplier * 100) / 100 : 0

        // Sick pay adjustment for employed (salaried) workers
        const empSickAdj = wizSickLeave.find(s => s.employee_id === emp.id)
        let sickPayDeductionEmp = 0
        let sickPayAmountEmp = 0
        let sickPayTypeEmp: string | null = null
        let sickDaysInPeriodEmp = 0
        if (empSickAdj && empSickAdj.deduction > 0) {
          sickPayDeductionEmp = empSickAdj.deduction
          sickPayAmountEmp = empSickAdj.ssp_added
          sickPayTypeEmp = empSickAdj.sick_pay_status
          sickDaysInPeriodEmp = empSickAdj.days
        }

        // TOIL: credit lieu_days for employed staff overtime
        if (overtimeHandling === 'toil' && empOvertimeHrs > 0) {
          const dailyHours = (emp.weekly_hours || 37.5) / 5
          const toilDays = Math.round(empOvertimeHrs / dailyHours * 100) / 100
          try {
            const { data: lb } = await supabase.from('leave_balances').select('lieu_days').eq('employee_id', emp.id).maybeSingle()
            const currentLieu = lb?.lieu_days || 0
            await supabase.from('leave_balances').update({ lieu_days: currentLieu + toilDays }).eq('employee_id', emp.id)
          } catch { /* TOIL credit failure is non-blocking */ }
        }

        const missing: string[] = []
        if (!emp.annual_salary && !latest?.annual_salary) missing.push('Annual salary')
        if (!emp.tax_code && !latest?.tax_code) missing.push('Tax code')

        for (let pi = 0; pi < periods.length; pi++) {
          payslipIdx++
          const period = periods[pi]
          const paymentDate = new Date(period.end)
          paymentDate.setDate(paymentDate.getDate() + 3)

          const { error } = await supabase.from('payslips').insert({
            employee_id: emp.id, company_id: selectedCompanyId,
            reference_number: `PAY-${nextKey}-${batch}-${String(payslipIdx).padStart(3, '0')}`,
            pay_period_start: localDateStr(period.start), pay_period_end: localDateStr(period.end),
            pay_period_type: freq,
            pay_run_id: payRunId,
            gross_pay: gross, tax, national_insurance: ni, pension: pen, other_deductions: 0,
            monthly_deductions: benefitPeriod,
            net_pay: (gross - benefitPeriod) + overtimePay - sickPayDeductionEmp + sickPayAmountEmp - tax - ni - pen,
            payment_date: localDateStr(paymentDate),
            status: missing.length > 0 ? 'flagged' : 'draft',
            tax_code: emp.tax_code || latest?.tax_code || '1257L',
            annual_salary: salary, payroll_id: emp.payroll_id,
            payroll_office: missing.length > 0 ? `Missing: ${missing.join(', ')}` : '',
            overtime: overtimePay,
            sick_pay: sickPayAmountEmp > 0 ? sickPayAmountEmp : sickPayDeductionEmp > 0 ? -sickPayDeductionEmp : 0,
            sick_pay_type: sickPayTypeEmp,
            sick_days_in_period: sickDaysInPeriodEmp,
          })
          if (error) errors.push(`${emp.first_name} ${emp.last_name}: ${error.message}`)
          if (freq === 'monthly') break
        }
      }
    }

    // Update pay_run status
    await supabase.from('pay_runs').update({ status: 'draft' }).eq('id', payRunId)

    setWizGenerating(false)
    if (errors.length > 0) {
      showError(`Failed to generate ${errors.length} payslip(s): ${errors[0]}`)
      await logPayrollAction('Payslip Generation Failed', `${errors.length} error(s): ${errors[0]}`, 'error')
    } else {
      showSuccess(`Generated payslips for ${formatDate(periodStart)} – ${formatDate(periodEnd)}`)
      await logPayrollAction('Payslips Generated', `Period ${formatDate(periodStart)} – ${formatDate(periodEnd)}, ${targetEmployees.length} employee(s)`)
      setWizGenerated(true)
      await loadAll()
    }
  }

  function generateAdjustmentsCsv(): { csv: string; rowCount: number; items: { employee: string; type: string; description: string; hours: number; rate: number; multiplier: number; days: number; amount: number }[] } {
    const isEmpInScope = (empId: string) => {
      const emp = employees.find(e => e.id === empId)
      if (!emp) return false
      if (wizWorkerTypes.has('employed') && emp.employment_category !== 'shift_worker') return true
      if (wizWorkerTypes.has('shift') && emp.employment_category === 'shift_worker' && emp.contract_type !== 'Zero hours shift worker') return true
      if (wizWorkerTypes.has('zero_hours') && emp.employment_category === 'shift_worker' && emp.contract_type === 'Zero hours shift worker') return true
      return false
    }

    const items: { employee: string; type: string; description: string; hours: number; rate: number; multiplier: number; days: number; amount: number }[] = []

    Object.entries(wizOvertimeHours).forEach(([empId, hrs]) => {
      const emp = employees.find(e => e.id === empId)
      if (!emp || hrs <= 0 || !isEmpInScope(empId)) return
      if (getEffectiveSetting(emp, workerSettings, 'overtime_handling') === 'toil') return
      const mul = emp.overtime_rate_multiplier || 1.5
      const rate = wizOvertimeRates[empId] || getDerivedHourlyRate(emp)
      items.push({
        employee: `${emp.first_name} ${emp.last_name}`,
        type: 'Overtime',
        description: `Overtime at ${mul}x`,
        hours: hrs,
        rate,
        multiplier: mul,
        days: 0,
        amount: Math.round(rate * mul * hrs * 100) / 100,
      })
    })

    wizUnpaidLeave.filter(u => isEmpInScope(u.employee_id)).forEach(u => {
      const emp = employees.find(e => e.id === u.employee_id)
      if (!emp) return
      const dailyRate = (emp.annual_salary || 0) > 0 ? Math.round((emp.annual_salary || 0) / 260 * 100) / 100 : 0
      items.push({
        employee: `${emp.first_name} ${emp.last_name}`,
        type: 'Unpaid Leave Deduction',
        description: `${u.days} day${u.days !== 1 ? 's' : ''} unpaid leave`,
        hours: 0,
        rate: dailyRate,
        multiplier: 0,
        days: u.days,
        amount: -Math.round(dailyRate * u.days * 100) / 100,
      })
    })

    wizBenefitChanges.filter(b => isEmpInScope(b.employee_id)).forEach(b => {
      const emp = employees.find(e => e.id === b.employee_id)
      if (!emp) return
      items.push({
        employee: `${emp.first_name} ${emp.last_name}`,
        type: b.monthly_cost >= 0 ? 'Benefit Addition' : 'Benefit Deduction',
        description: b.benefit,
        hours: 0,
        rate: 0,
        multiplier: 0,
        days: 0,
        amount: b.monthly_cost,
      })
    })

    wizBonusEntries.filter(b => isEmpInScope(b.employee_id)).forEach(b => {
      items.push({
        employee: b.employee_name,
        type: b.type === 'bonus' ? 'Bonus' : 'Deduction',
        description: b.description,
        hours: 0,
        rate: 0,
        multiplier: 0,
        days: 0,
        amount: b.type === 'bonus' ? b.amount : -b.amount,
      })
    })

    wizSickLeave.filter(s => isEmpInScope(s.employee_id)).forEach(s => {
      const typeLabel = s.sick_pay_status === 'csp_full' ? 'CSP (Full Pay)' : s.sick_pay_status === 'csp_half' ? 'CSP (Half Pay)' : s.sick_pay_status === 'ssp' ? 'SSP' : 'Unpaid Sick'
      const netAmount = -s.deduction + s.ssp_added
      if (netAmount !== 0 || s.days > 0) {
        items.push({
          employee: s.employee_name,
          type: 'Sick Leave Adjustment',
          description: `${s.days} day${s.days !== 1 ? 's' : ''} sick leave — ${typeLabel}${s.ssp_added > 0 ? ` (SSP: ${s.ssp_added.toFixed(2)})` : ''}`,
          hours: 0,
          rate: s.daily_rate,
          multiplier: 0,
          days: s.days,
          amount: Math.round(netAmount * 100) / 100,
        })
      }
    })

    const sanitise = (s: string) => s.replace(/[=+\-@\t\r]/g, "'$&").replace(/"/g, '""')
    const header = 'Employee,Adjustment Type,Description,Hours,Hourly Rate,Multiplier,Days,Amount'
    const rows = items.map(i =>
      `"${sanitise(i.employee)}","${sanitise(i.type)}","${sanitise(i.description)}",${i.hours || ''},${i.rate ? i.rate.toFixed(2) : ''},${i.multiplier || ''},${i.days || ''},${i.amount.toFixed(2)}`
    )
    return { csv: [header, ...rows].join('\n'), rowCount: items.length, items }
  }

  async function wizPushAdjustments() {
    if (!selectedCompanyId || !session) return
    setWizGenerating(true)
    const pAllStarts = Object.values(wizPeriodByType).map(p => p.start).sort()
    const pAllEnds = Object.values(wizPeriodByType).map(p => p.end).sort().reverse()
    const pStart = pAllStarts[0] || localDateStr(new Date(now.getFullYear(), now.getMonth() + 1, 1))
    const pEnd = pAllEnds[0] || localDateStr(new Date(now.getFullYear(), now.getMonth() + 2, 0))

    const workerTypeArr = [...wizWorkerTypes].map(t => t === 'shift' ? 'shift_worker' : t)
    const { data: existingRun } = await supabase.from('pay_runs')
      .select('id').eq('company_id', selectedCompanyId)
      .eq('period_start', pStart).eq('period_end', pEnd).maybeSingle()

    let payRunData: { id: string } | null = null
    let payRunError: any = null

    if (existingRun) {
      const res = await supabase.from('pay_runs').update({
        status: 'generating', payment_method: connectedProvider || 'external',
        worker_types: workerTypeArr, created_by: session?.user?.id || null,
      }).eq('id', existingRun.id).select('id').single()
      payRunData = res.data
      payRunError = res.error
    } else {
      const res = await supabase.from('pay_runs').insert({
        company_id: selectedCompanyId, frequency: 'monthly', period_start: pStart,
        period_end: pEnd, status: 'generating', payment_method: connectedProvider || 'external',
        worker_types: workerTypeArr, created_by: session?.user?.id || null,
      }).select('id').single()
      payRunData = res.data
      payRunError = res.error
    }

    if (payRunError) {
      showError('Failed to create pay run: ' + payRunError.message)
      setWizGenerating(false)
      return
    }
    const payRunId = payRunData!.id
    setWizPayRunId(payRunId)

    try {
      const isEmpInScope = (empId: string) => {
        const emp = employees.find(e => e.id === empId)
        if (!emp) return false
        if (wizWorkerTypes.has('employed') && emp.employment_category !== 'shift_worker') return true
        if (wizWorkerTypes.has('shift') && emp.employment_category === 'shift_worker' && emp.contract_type !== 'Zero hours shift worker') return true
        if (wizWorkerTypes.has('zero_hours') && emp.employment_category === 'shift_worker' && emp.contract_type === 'Zero hours shift worker') return true
        return false
      }

      const toilEntries = Object.entries(wizOvertimeHours).filter(([empId, hrs]) => {
        const emp = employees.find(e => e.id === empId)
        if (!emp) return false
        return hrs > 0 && getEffectiveSetting(emp, workerSettings, 'overtime_handling') === 'toil'
      }).map(([empId, hrs]) => ({ employee_id: empId, hours: hrs }))

      // Build overtime entries (excluding TOIL) — employed staff from wizOvertimeHours
      const overtimeEntries = Object.entries(wizOvertimeHours)
        .filter(([empId, hrs]) => {
          const emp = employees.find(e => e.id === empId)
          return emp && hrs > 0 && isEmpInScope(empId) && getEffectiveSetting(emp, workerSettings, 'overtime_handling') !== 'toil'
        })
        .map(([empId, hrs]) => {
          const emp = employees.find(e => e.id === empId)!
          return { employee_id: empId, hours: hrs, multiplier: emp.overtime_rate_multiplier || 1.5, hourly_rate_override: wizOvertimeRates[empId] || getDerivedHourlyRate(emp) }
        })

      // Add shift/zero-hours overtime from approved period reviews
      const empIdsWithOT = new Set(overtimeEntries.map(e => e.employee_id))
      for (const r of wizPeriodReviews) {
        if (r.status !== 'approved' || Number(r.overtime_hours) <= 0) continue
        if (empIdsWithOT.has(r.employee_id)) continue
        if (!isEmpInScope(r.employee_id)) continue
        const emp = employees.find(e => e.id === r.employee_id)
        if (!emp) continue
        if (getEffectiveSetting(emp, workerSettings, 'overtime_handling') === 'toil') continue
        overtimeEntries.push({
          employee_id: r.employee_id,
          hours: Number(r.overtime_hours),
          multiplier: emp.overtime_rate_multiplier || 1.5,
          hourly_rate_override: r.hourly_rate || getDerivedHourlyRate(emp),
        })
      }

      const unpaidLeaveEntries = wizUnpaidLeave.filter(u => isEmpInScope(u.employee_id))
      const benefitChangeEntries = wizBenefitChanges.filter(b => isEmpInScope(b.employee_id))

      // Build regular hours entries for zero hours workers from approved period reviews
      const regularHoursEntries: { employee_id: string; hours: number; hourly_rate: number }[] = []
      if (wizWorkerTypes.has('zero_hours')) {
        for (const r of wizPeriodReviews) {
          if (r.status !== 'approved') continue
          const emp = employees.find(e => e.id === r.employee_id)
          if (!emp) continue
          if (emp.contract_type !== 'Zero hours shift worker') continue
          if (!isEmpInScope(r.employee_id)) continue
          const totalHrs = Number(r.adjusted_hours ?? r.total_hours ?? 0)
          const otHrs = Number(r.overtime_hours ?? 0)
          const regularHrs = totalHrs - otHrs
          if (regularHrs <= 0) continue
          regularHoursEntries.push({
            employee_id: r.employee_id,
            hours: regularHrs,
            hourly_rate: r.hourly_rate || emp.hourly_rate || 0,
          })
        }
      }

      const { data: holidayLogs } = await supabase.from('holiday_accrual_log')
        .select('employee_id, hours_worked, accrual_rate, hours_accrued_rounded, holiday_pay_amount, method')
        .eq('company_id', selectedCompanyId)
        .gte('pay_period_start', pStart)
        .lte('pay_period_end', pEnd)
      const holidayManualItems = (holidayLogs || [])
        .filter(h => h.holiday_pay_amount > 0 || h.hours_accrued_rounded > 0)
        .map(h => {
          const emp = employees.find(e => e.id === h.employee_id)
          const empName = emp ? `${emp.first_name} ${emp.last_name}` : 'Unknown'
          const hourlyRate = emp?.hourly_rate || 0
          if (h.method === 'rolled_up') {
            return {
              employee: empName,
              type: 'holiday_pay' as const,
              description: `Holiday Pay Uplift (${h.accrual_rate}%) — ${h.hours_worked}h worked × ${formatCurrency(hourlyRate, currency)}/hr = ${formatCurrency(h.hours_worked * hourlyRate, currency)} gross → ${formatCurrency(h.holiday_pay_amount, currency)} holiday pay. Add as an additional earnings line in ${connectedProvider === 'xero' ? 'Xero' : 'Sage'}.`,
              amount: h.holiday_pay_amount,
            }
          }
          return {
            employee: empName,
            type: 'holiday_pay' as const,
            description: `Holiday Accrual — ${h.hours_worked}h worked × ${h.accrual_rate}% = ${h.hours_accrued_rounded}h accrued. No pay item needed (hours banked for paid leave). For reference only.`,
            amount: 0,
          }
        })
        .filter(h => h.amount > 0)

      const { data: cancCompLogs } = await supabase.from('shift_cancellation_log')
        .select('employee_id, shift_date, shift_hours, compensation_amount')
        .eq('company_id', selectedCompanyId).eq('within_notice_window', true)
        .eq('compensation_included_in_payrun', true)
        .gte('shift_date', pStart).lte('shift_date', pEnd)
      const cancManualItems = (cancCompLogs || [])
        .filter(c => Number(c.compensation_amount) > 0)
        .map(c => {
          const emp = employees.find(e => e.id === c.employee_id)
          const empName = emp ? `${emp.first_name} ${emp.last_name}` : 'Unknown'
          return {
            employee: empName,
            type: 'cancellation_compensation' as const,
            description: `Shift Cancellation Compensation — ${c.shift_hours}h shift on ${new Date(c.shift_date).toLocaleDateString('en-GB')} cancelled within notice window. Add ${formatCurrency(Number(c.compensation_amount), currency)} as an additional earnings line.`,
            amount: Number(c.compensation_amount),
          }
        })

      let xeroPushData: any = null
      if (connectedProvider === 'xero') {
        // Xero: push regular hours + overtime via API, flag unpaid leave + benefits as manual
        const { data, error } = await supabase.functions.invoke('xero-push-payroll', {
          headers: { Authorization: `Bearer ${session.access_token}` },
          body: {
            company_id: selectedCompanyId,
            pay_run_id: payRunId,
            period_start: pStart,
            period_end: pEnd,
            overtime: overtimeEntries,
            regular_hours: regularHoursEntries,
            unpaid_leave: unpaidLeaveEntries.map(u => ({ employee_id: u.employee_id, days: u.days })),
            benefit_changes: benefitChangeEntries.map(b => ({ employee_id: b.employee_id, benefit: b.benefit, monthly_cost: b.monthly_cost })),
          },
        })

        if (error) throw error
        if (data?.error) throw new Error(data.error)
        xeroPushData = data

        const bonusManualItems = wizBonusEntries.filter(b => isEmpInScope(b.employee_id)).map(b => ({
          employee: b.employee_name,
          type: b.type === 'bonus' ? 'bonus' as const : 'deduction' as const,
          description: b.description,
          amount: b.amount,
        }))

        // Save bonus entries to payroll_adjustments table
        for (const b of wizBonusEntries.filter(be => isEmpInScope(be.employee_id))) {
          await supabase.from('payroll_adjustments').insert({
            company_id: selectedCompanyId,
            employee_id: b.employee_id,
            pay_run_id: payRunId,
            type: b.type,
            description: b.description,
            amount: b.amount,
            frequency: 'one_off',
            status: 'pushed',
            created_by: session?.user?.id || null,
          })
        }

        setWizPushResult({
          pushed: data.pushed || 0,
          failed: data.failed || 0,
          skipped: data.skipped || 0,
          api: 'xero',
          timesheet_results: data.timesheet_results || [],
          manual_items: [...(data.manual_items || []), ...bonusManualItems, ...holidayManualItems, ...cancManualItems],
          skipped_details: data.skipped_details || [],
          provider: 'xero',
        })
      } else {
        // Sage: CSV export (unchanged)
        const { csv, rowCount, items } = generateAdjustmentsCsv()

        if (rowCount > 0) {
          const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `Sage_Adjustments_${localDateStr(new Date())}.csv`
          a.click()
          URL.revokeObjectURL(url)
        }

        // Save bonus entries to payroll_adjustments table
        for (const b of wizBonusEntries.filter(be => isEmpInScope(be.employee_id))) {
          await supabase.from('payroll_adjustments').insert({
            company_id: selectedCompanyId,
            employee_id: b.employee_id,
            pay_run_id: payRunId,
            type: b.type,
            description: b.description,
            amount: b.amount,
            frequency: 'one_off',
            status: 'pushed',
            created_by: session?.user?.id || null,
          })
        }

        setWizPushResult({
          pushed: 0, failed: 0, skipped: 0, api: 'csv',
          csv_exported: rowCount, csv_items: items,
          provider: 'sage',
          timesheet_results: [], manual_items: [...holidayManualItems, ...cancManualItems], skipped_details: [],
        })
      }

      // Credit TOIL lieu days
      for (const toilEntry of toilEntries) {
        const emp = employees.find(e => e.id === toilEntry.employee_id)
        const dailyHours = ((emp?.weekly_hours || 37.5) / 5)
        const toilDays = Math.round(toilEntry.hours / dailyHours * 100) / 100
        try {
          const { data: lb } = await supabase.from('leave_balances').select('lieu_days').eq('employee_id', toilEntry.employee_id).maybeSingle()
          await supabase.from('leave_balances').update({ lieu_days: (lb?.lieu_days || 0) + toilDays }).eq('employee_id', toilEntry.employee_id)
        } catch { /* non-blocking */ }
      }

      await supabase.from('pay_runs').update({ status: providerConnected ? 'processing' : 'exported' }).eq('id', payRunId)
      setWizGenerated(true)
      setWizExported(true)

      if (connectedProvider === 'xero') {
        const pushed = xeroPushData?.pushed || 0
        const skippedCount = xeroPushData?.skipped || 0
        showSuccess(pushed > 0
          ? `Timesheets pushed to Xero (${pushed} employee${pushed !== 1 ? 's' : ''}).${skippedCount > 0 ? ` ${skippedCount} skipped.` : ''} Check the manual items below for anything to enter in Xero yourself.`
          : 'No hours to push — check the manual items below for anything to enter in Xero.')
      } else {
        const { rowCount } = generateAdjustmentsCsv()
        if (rowCount > 0) {
          showSuccess(`${rowCount} adjustment(s) exported to CSV — import into Sage`)
        } else if (toilEntries.length > 0) {
          showSuccess('TOIL lieu days credited — no adjustment lines to export')
        } else {
          showSuccess('No adjustments for this period')
        }
      }
      await logPayrollAction('Adjustments Pushed', `Provider: ${connectedProvider || 'sage'}, pay run ${payRunId}`)
      await loadAll()
    } catch (err: any) {
      showError('Push failed: ' + (err?.message || 'Unknown error'))
      await logPayrollAction('Adjustments Push Failed', err?.message || 'Unknown error', 'error')
      await supabase.from('pay_runs').update({ status: 'draft' }).eq('id', payRunId)
    }
    setWizGenerating(false)
  }

  // Phase 4: Export functions
  async function wizExport() {
    if (!wizPayRunId || !selectedCompanyId) return
    setWizExporting(true)

    try {
      if (wizPayMethod === 'bacs') {
        await wizExportBacs()
      } else if (wizPayMethod === 'xero') {
        await wizExportXero()
      } else if (wizPayMethod === 'sage') {
        await wizExportSageCsv()
      } else if (wizPayMethod === 'modulr') {
        await wizExportModulr()
      }

      // Update pay_run status and payment_method
      await supabase.from('pay_runs').update({
        status: 'exported',
        payment_method: wizPayMethod,
      }).eq('id', wizPayRunId)

      setWizExported(true)
      showSuccess(`Pay run exported via ${wizPayMethod.toUpperCase()}`)
      await logPayrollAction('Pay Run Exported', `Method: ${wizPayMethod.toUpperCase()}, pay run ${wizPayRunId}`)
    } catch (err: any) {
      showError('Export failed: ' + (err?.message || 'Unknown error'))
      await logPayrollAction('Pay Run Export Failed', err?.message || 'Unknown error', 'error')
    }
    setWizExporting(false)
  }

  async function wizExportBacs() {
    const nextDate = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    const nextKey = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}`
    const runPayslips = payslips.filter(p => p.pay_period_start.startsWith(nextKey) && p.status === 'draft')
    if (!runPayslips.length) throw new Error('No draft payslips found for this period')

    const { data: compData } = await supabase.from('companies')
      .select('bacs_originator_sort_code, bacs_originator_account_no, bacs_originator_name')
      .eq('id', selectedCompanyId).single()
    const origSc = (compData?.bacs_originator_sort_code || '').replace(/[-\s]/g, '').padEnd(6, '0')
    const origAn = (compData?.bacs_originator_account_no || '').replace(/\s/g, '').padStart(8, '0')
    if (!origSc || origSc === '000000') throw new Error('Company BACS originator sort code not set. Configure in Payroll Schedule.')

    const lines = runPayslips.map(p => {
      const emp = employees.find(e => e.id === p.employee?.id)
      if (!emp) return null
      const sortCode = (emp.bank_sort_code || '').replace(/[-\s]/g, '')
      const accountNo = (emp.bank_account_number || '').replace(/\s/g, '')
      if (!/^\d{6}$/.test(sortCode) || !/^\d{8}$/.test(accountNo)) return null
      const amountPence = Math.round(Number(p.net_pay) * 100).toString().padStart(11, '0')
      const beneficiary = (emp.bank_account_name || `${emp.first_name} ${emp.last_name}`).substring(0, 18).padEnd(18, ' ')
      const ref = `SALARY ${MONTH_NAMES[nextDate.getMonth()]}`.substring(0, 18).padEnd(18, ' ')
      return `${sortCode},${accountNo},00,99,${origSc},${origAn},${amountPence},${beneficiary},${ref}`
    }).filter(Boolean)

    if (!lines.length) throw new Error('No employees with valid bank details')
    const csv = lines.join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `BACS_PayRun_${localDateStr(new Date())}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function wizExportXero() {
    if (!session || !selectedCompanyId) throw new Error('Not authenticated')
    const pAllStarts = Object.values(wizPeriodByType).map(p => p.start).sort()
    const pAllEnds = Object.values(wizPeriodByType).map(p => p.end).sort().reverse()
    const pStart = pAllStarts[0] || localDateStr(new Date(now.getFullYear(), now.getMonth() + 1, 1))
    const pEnd = pAllEnds[0] || localDateStr(new Date(now.getFullYear(), now.getMonth() + 2, 0))
    const { data, error } = await supabase.functions.invoke('xero-push-timesheets', {
      headers: { Authorization: `Bearer ${session.access_token}` },
      body: { company_id: selectedCompanyId, period_start: pStart, period_end: pEnd },
    })
    if (error) throw error
    if (data?.error) throw new Error(data.error)
  }

  async function wizExportSageCsv() {
    const nextDate = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    const nextKey = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}`
    const runPayslips = payslips.filter(p => p.pay_period_start.startsWith(nextKey) && p.status === 'draft')
    if (!runPayslips.length) throw new Error('No draft payslips found')

    const header = 'Employee ID,Name,Gross Pay,Tax,NI,Pension,Net Pay,Overtime,Pay Period Start,Pay Period End'
    const rows = runPayslips.map(p => {
      const name = p.employee ? `${p.employee.first_name} ${p.employee.last_name}` : ''
      const safeName = name.replace(/[=+\-@\t\r]/g, "'$&")
      return `${p.payroll_id || ''},${safeName},${p.gross_pay},${p.tax},${p.national_insurance},${p.pension},${p.net_pay},${p.overtime},${p.pay_period_start},${p.pay_period_end}`
    })
    const csv = [header, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Sage_PayRun_${localDateStr(new Date())}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function wizExportModulr() {
    if (!session) throw new Error('Not authenticated')

    const pAllStarts = Object.values(wizPeriodByType).map(p => p.start).sort()
    const pAllEnds = Object.values(wizPeriodByType).map(p => p.end).sort().reverse()
    const pStart = pAllStarts[0]
    const pEnd = pAllEnds[0]
    if (!pStart || !pEnd) throw new Error('No pay period dates available')

    const runPayslips = payslips.filter(p =>
      p.status === 'paid' && !p.released &&
      (p.source === 'xero' || p.source === 'sage') &&
      p.pay_period_start >= pStart && p.pay_period_end <= pEnd
    )
    if (!runPayslips.length) throw new Error('No imported payslips found for this period. Fetch payslips from Xero or Sage first.')

    const periodLabel = pStart.substring(0, 7)
    const payments: { employee_id: string; amount: number; sort_code: string; account_number: string; reference: string; employee_name: string }[] = []

    for (const p of runPayslips) {
      const emp = employees.find(e => e.id === p.employee?.id)
      if (!emp) continue
      const sortCode = (emp.bank_sort_code || '').replace(/[-\s]/g, '')
      const accountNo = (emp.bank_account_number || '').replace(/\s/g, '')
      if (!/^\d{6}$/.test(sortCode) || !/^\d{8}$/.test(accountNo)) continue
      const netPay = Number(p.net_pay)
      if (netPay <= 0) continue
      payments.push({
        employee_id: emp.id,
        amount: netPay,
        sort_code: sortCode,
        account_number: accountNo,
        reference: `SALARY ${periodLabel}`,
        employee_name: `${emp.first_name} ${emp.last_name}`,
      })
    }

    if (!payments.length) throw new Error('No employees with valid bank details and positive net pay')

    const { data, error } = await supabase.functions.invoke('modulr-payout', {
      headers: { Authorization: `Bearer ${session.access_token}` },
      body: {
        company_id: selectedCompanyId,
        payrun_ref: `PR-${wizPayRunId}-${periodLabel}`,
        payments,
      },
    })
    if (error) {
      let detail = error.message
      try { const body = await (error as any).context?.json?.(); if (body?.error) detail = body.error } catch (_) {}
      throw new Error(detail)
    }
    if (data?.error) throw new Error(data.error)
  }

  // Phase 5: Sync + release
  async function wizSyncXero(): Promise<boolean> {
    if (!session || !selectedCompanyId) return false
    setWizExporting(true)
    try {
      let totalUpserted = 0
      let totalUnmatched = 0
      let totalFiltered = 0
      let totalPayslips = 0
      let lastPayRun: { period_start: string; period_end: string } | null = null
      const errors: string[] = []

      // Group worker types by their distinct period dates to minimize API calls
      const periodGroups: Record<string, { types: string[]; start: string; end: string }> = {}
      for (const wt of wizWorkerTypes) {
        const wtKey = wt === 'shift' ? 'shift' : wt
        const xeroWt = wt === 'shift' ? 'shift_worker' : wt
        const period = wizPeriodByType[wtKey]
        if (!period) continue
        const key = `${period.start}_${period.end}`
        if (!periodGroups[key]) periodGroups[key] = { types: [], start: period.start, end: period.end }
        periodGroups[key].types.push(xeroWt)
      }

      for (const group of Object.values(periodGroups)) {
        const { data, error } = await supabase.functions.invoke('xero-payslips', {
          headers: { Authorization: `Bearer ${session.access_token}` },
          body: { company_id: selectedCompanyId, worker_types: group.types, period_start: group.start, period_end: group.end },
        })
        if (error) throw error
        if (data?.error) { errors.push(data.error); continue }
        if (data?.payRun) lastPayRun = { period_start: data.payRun.period_start, period_end: data.payRun.period_end }
        totalUpserted += data?.upserted || 0
        totalUnmatched += data?.unmatched || 0
        totalFiltered += data?.filtered || 0
        totalPayslips += (data?.payslips?.length || 0)
        if (data?.filteredDetails?.length) {
          const details = data.filteredDetails.map((d: any) => `${d.name} (cat=${d.employment_category}, type=${d.contract_type})`).join('; ')
          const requested = data?.debug?.worker_types_requested?.join(', ') || 'unknown'
          const loaded = data?.debug?.inflow_employees_loaded || 0
          errors.push(`Filtered: ${details}. Requested types: [${requested}]. InflowHR employees loaded: ${loaded}.`)
        }
      }

      if (totalUpserted === 0) {
        if (errors.length > 0) {
          showError(errors[0])
        } else if (!lastPayRun) {
          showError('No pay run found in Xero for any selected period. Create pay runs in Xero first, then fetch again.')
        } else if (totalPayslips === 0) {
          showError(`Xero pay run found (${lastPayRun.period_start} to ${lastPayRun.period_end}) but it contained no payslips. Check the pay run has been processed in Xero.`)
        } else if (totalUnmatched > 0 && totalFiltered === 0) {
          showError(`Xero pay run found with ${totalUnmatched} payslip${totalUnmatched !== 1 ? 's' : ''} but no employees matched. Check employee email addresses match between InflowHR and Xero.`)
        } else if (totalFiltered > 0) {
          showError(`Xero pay run found (${lastPayRun.period_start} to ${lastPayRun.period_end}) with ${totalPayslips} payslip${totalPayslips !== 1 ? 's' : ''}, but ${totalFiltered} were filtered out as they don't match the selected worker types. ${totalUnmatched > 0 ? `${totalUnmatched} also didn't match any InflowHR employee. ` : ''}Check employment categories are set correctly in InflowHR.`)
        } else {
          showError('Xero pay run found but contained no payslips for the selected worker types.')
        }
        setWizExporting(false)
        return false
      }

      if (wizPayRunId) {
        await supabase.from('pay_runs').update({ status: 'synced' }).eq('id', wizPayRunId)
      }
      if (lastPayRun) setLastXeroPayRun(lastPayRun)
      showSuccess(`Synced ${totalUpserted} payslip${totalUpserted !== 1 ? 's' : ''} from Xero`)
      await logPayrollAction('Xero Sync', `Synced ${totalUpserted} payslip(s) from Xero`)
      await loadAll()
      setWizExporting(false)
      return true
    } catch (err: any) {
      showError('Xero sync failed: ' + (err?.message || 'Unknown error'))
      await logPayrollAction('Xero Sync Failed', err?.message || 'Unknown error', 'error')
      setWizExporting(false)
      return false
    }
  }

  async function wizImportXeroCsv(): Promise<boolean> {
    if (!wizXeroCsvFile || !session || !selectedCompanyId) return false
    setWizXeroCsvImporting(true)
    try {
      const text = await wizXeroCsvFile.text()
      const lines = text.split('\n').map(l => l.trim()).filter(l => l)
      if (lines.length < 2) { showError('CSV file is empty or has no data rows.'); setWizXeroCsvImporting(false); return false }

      const headerLine = lines[0]
      const headers = headerLine.split(',').map(h => h.replace(/^"|"$/g, '').trim().toLowerCase())

      const findCol = (...names: string[]) => headers.findIndex(h => names.some(n => h.includes(n)))
      const nameCol = findCol('employee name', 'employee', 'name', 'full name')
      const firstNameCol = findCol('first name', 'firstname')
      const lastNameCol = findCol('last name', 'lastname', 'surname')
      const emailCol = findCol('email')
      const grossCol = findCol('gross pay', 'gross earnings', 'total earnings', 'gross')
      const taxCol = findCol('paye', 'tax', 'income tax')
      const niCol = findCol('employee ni', 'employee nic', 'national insurance', 'ni')
      const netCol = findCol('net pay', 'net', 'take home')

      if (grossCol === -1 || netCol === -1) {
        showError('CSV must contain at least Gross Pay and Net Pay columns.')
        setWizXeroCsvImporting(false)
        return false
      }
      if (nameCol === -1 && firstNameCol === -1 && emailCol === -1) {
        showError('CSV must contain an Employee Name, First Name, or Email column to match employees.')
        setWizXeroCsvImporting(false)
        return false
      }

      const { data: companyEmployees } = await supabase
        .from('employees')
        .select('id, first_name, last_name, email')
        .eq('company_id', selectedCompanyId)

      const empByEmail: Record<string, string> = {}
      const empByName: Record<string, string> = {}
      for (const e of (companyEmployees || [])) {
        if (e.email) empByEmail[e.email.toLowerCase()] = e.id
        empByName[`${e.first_name} ${e.last_name}`.toLowerCase()] = e.id
        empByName[`${e.last_name} ${e.first_name}`.toLowerCase()] = e.id
      }

      function parseCsvLine(line: string): string[] {
        const values: string[] = []
        let current = ''
        let inQuotes = false
        for (const ch of line) {
          if (ch === '"') { inQuotes = !inQuotes; continue }
          if (ch === ',' && !inQuotes) { values.push(current.trim()); current = ''; continue }
          current += ch
        }
        values.push(current.trim())
        return values
      }

      const allStarts = Object.values(wizPeriodByType).map(p => p.start).sort()
      const allEnds = Object.values(wizPeriodByType).map(p => p.end).sort().reverse()
      const periodStart = allStarts[0] || new Date().toISOString().split('T')[0]
      const periodEnd = allEnds[0] || periodStart

      let imported = 0
      let unmatched = 0
      for (let i = 1; i < lines.length; i++) {
        const vals = parseCsvLine(lines[i])
        if (vals.length < 2) continue

        let empId: string | null = null
        if (emailCol !== -1 && vals[emailCol]) empId = empByEmail[vals[emailCol].toLowerCase()] || null
        if (!empId && nameCol !== -1 && vals[nameCol]) empId = empByName[vals[nameCol].toLowerCase()] || null
        if (!empId && firstNameCol !== -1 && lastNameCol !== -1) {
          const full = `${vals[firstNameCol]} ${vals[lastNameCol]}`.toLowerCase()
          empId = empByName[full] || null
        }

        if (!empId) { unmatched++; continue }

        const parseNum = (idx: number) => {
          if (idx === -1) return 0
          const v = (vals[idx] || '').replace(/[£$€,\s]/g, '')
          return parseFloat(v) || 0
        }

        const ref = `XERO-CSV-${empId}-${periodStart}`
        await supabase.from('payslips').upsert({
          employee_id: empId,
          company_id: selectedCompanyId,
          reference_number: ref,
          pay_period_start: periodStart,
          pay_period_end: periodEnd,
          gross_pay: parseNum(grossCol),
          tax: parseNum(taxCol),
          national_insurance: parseNum(niCol),
          pension: 0,
          other_deductions: 0,
          adjustments: 0,
          net_pay: parseNum(netCol),
          payment_date: periodEnd,
          status: 'paid',
          source: 'xero',
        }, { onConflict: 'reference_number,company_id' })
        imported++
      }

      if (imported === 0) {
        showError(`No employees matched from CSV.${unmatched > 0 ? ` ${unmatched} row${unmatched !== 1 ? 's' : ''} could not be matched — check names/emails match InflowHR.` : ''}`)
        setWizXeroCsvImporting(false)
        return false
      }

      if (wizPayRunId) {
        await supabase.from('pay_runs').update({ status: 'synced' }).eq('id', wizPayRunId)
      }
      showSuccess(`Imported ${imported} payslip${imported !== 1 ? 's' : ''} from CSV${unmatched > 0 ? ` (${unmatched} unmatched)` : ''}`)
      await logPayrollAction('Xero CSV Import', `Imported ${imported} payslip(s)${unmatched > 0 ? `, ${unmatched} unmatched` : ''}`)
      await loadAll()
      setWizXeroCsvImporting(false)
      setWizXeroCsvFile(null)
      return true
    } catch (err: any) {
      showError('CSV import failed: ' + (err?.message || 'Unknown error'))
      setWizXeroCsvImporting(false)
      return false
    }
  }

  async function wizCompleteRun() {
    if (!wizPayRunId) return
    setWizReleasing(true)
    await supabase.from('pay_runs').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', wizPayRunId)
    showSuccess('Pay run complete. Go to Payslips to review and release to employees.')
    await logPayrollAction('Pay Run Completed', `Pay run ${wizPayRunId} marked as completed`)
    setWizComplete(true)
    await loadAll()
    setWizReleasing(false)
  }

  async function startRunPayroll() {
    // Check for an in-progress pay run and resume from the correct step
    if (selectedCompanyId) {
      const { data: activeRun } = await supabase.from('pay_runs')
        .select('id, status, worker_types, payment_method')
        .eq('company_id', selectedCompanyId)
        .in('status', ['generating', 'exported', 'processing', 'synced'])
        .order('created_at', { ascending: false })
        .limit(1)

      if (activeRun && activeRun.length > 0) {
        const run = activeRun[0]

        setWizPayRunId(run.id)
        setWizGenerated(true)
        setWizComplete(false)
        setWizReleasing(false)

        const types = new Set<'employed' | 'shift' | 'zero_hours'>()
        if (run.worker_types?.includes('employed')) types.add('employed')
        if (run.worker_types?.includes('shift_worker')) types.add('shift')
        if (run.worker_types?.includes('zero_hours')) types.add('zero_hours')
        setWizWorkerTypes(types)

        if (run.status === 'generating') {
          setWizStep(providerConnected ? 3 : 4)
          setWizExported(false)
          setWizPayslipsFetched(false)
          setWizPayMethod(run.payment_method || 'external')
        } else if (run.status === 'processing') {
          setWizStep(4)
          setWizExported(true)
          setWizPayslipsFetched(false)
          setWizPayMethod(run.payment_method || 'external')
        } else if (run.status === 'exported') {
          setWizStep(providerConnected ? 5 : 5)
          setWizExported(true)
          setWizPayslipsFetched(false)
          setWizPayMethod(run.payment_method || 'external')
        } else if (run.status === 'synced') {
          setWizStep(providerConnected ? 6 : 5)
          setWizExported(true)
          setWizPayslipsFetched(true)
          setWizPayMethod(run.payment_method || 'external')
        }

        setWizExporting(false)
        setWizOvertimeHours({})
        setWizPeriodReviews([])
        setView('run_payroll')
        return
      }
    }

    setView('run_payroll')
    setWizStep(1)
    setWizWorkerTypes(new Set())
    setWizGenerated(false)
    setWizComplete(false)
    setWizPayMethod('external')
    setWizOvertimeHours({})
    setWizPeriodReviews([])
    setWizPayRunId(null)
    setWizExporting(false)
    setWizExported(false)
    setWizPayslipsFetched(false)
    setWizPushResult(null)
    setWizReleasing(false)
    setWizManualChecked(new Set())
    setWizSageFiles([])
    setWizSageUploading(false)
    setWizRosterPage(1)
    setWizPeriodEditType(null)
  }

  async function advanceToStep2() {
    const periodMap: Record<string, { start: string; end: string; freq: PayFrequency; freqLabel: string; overtimeLabel: string }> = {}
    for (const wt of Array.from(wizWorkerTypes)) {
      const wtSettingKey = wt === 'shift' ? 'shift_worker' : wt
      const wtSetting = workerSettings.find(s => s.worker_type === wtSettingKey)
      const freq = (wtSetting?.pay_pattern || 'monthly') as PayFrequency
      const freqLabel = freq === 'weekly' ? 'Weekly' : freq === 'bi_weekly' ? 'Bi-weekly' : 'Monthly'
      const overtimeLabel = (wtSetting?.overtime_handling || 'none') === 'overtime' ? 'Overtime' : (wtSetting?.overtime_handling || 'none') === 'toil' ? 'TOIL' : 'None'
      const lastRun = lastPayRuns[wt] || null
      const period = getNextPeriodForFreq(freq, fyStartMonth, lastRun)
      periodMap[wt] = { ...period, freq, freqLabel, overtimeLabel }
    }
    setWizPeriodByType(periodMap)

    if (selectedCompanyId) {
      const allStarts = Object.values(periodMap).map(p => p.start).sort()
      const allEnds = Object.values(periodMap).map(p => p.end).sort().reverse()
      const pStart = allStarts[0]
      const pEnd = allEnds[0]
      if (pStart && pEnd) {
        const { data: priorRuns } = await supabase.from('pay_runs')
          .select('id, worker_types, status, completed_at')
          .eq('company_id', selectedCompanyId)
          .gte('period_start', pStart)
          .lte('period_end', pEnd)
          .order('created_at', { ascending: false })
        setWizPriorRuns(priorRuns || [])
      }
    }

    if (wizWorkerTypes.has('shift') || wizWorkerTypes.has('zero_hours')) {
      loadWizPeriodReviews(periodMap)
    }
    loadWizTimesheets(periodMap)
    loadWizAdjustments(periodMap)
    loadWizBonuses()
    setWizStep(2)
  }

  function navigateWizPeriod(direction: 'prev' | 'next') {
    const updated = { ...wizPeriodByType }
    for (const wt of Object.keys(updated)) {
      const p = updated[wt]
      const freq = p.freq || 'monthly'
      const currentStart = new Date(p.start + 'T00:00:00')
      let newStart: Date, newEnd: Date
      if (freq === 'monthly') {
        if (direction === 'prev') {
          newStart = new Date(currentStart.getFullYear(), currentStart.getMonth() - 1, 1)
        } else {
          newStart = new Date(currentStart.getFullYear(), currentStart.getMonth() + 1, 1)
        }
        newEnd = new Date(newStart.getFullYear(), newStart.getMonth() + 1, 0)
      } else {
        const days = freq === 'weekly' ? 7 : 14
        newStart = new Date(currentStart)
        newStart.setDate(newStart.getDate() + (direction === 'prev' ? -days : days))
        newEnd = new Date(newStart)
        newEnd.setDate(newEnd.getDate() + days - 1)
      }
      updated[wt] = { ...p, start: localDateStr(newStart), end: localDateStr(newEnd) }
    }
    setWizPeriodByType(updated)
    if (wizWorkerTypes.has('shift') || wizWorkerTypes.has('zero_hours')) loadWizPeriodReviews(updated)
    loadWizTimesheets(updated)
    loadWizAdjustments(updated)
  }

  async function startPayrollForType(type: 'employed' | 'shift' | 'zero_hours') {
    if (selectedCompanyId) {
      const wtKey = type === 'shift' ? 'shift_worker' : type
      const { data: activeRun } = await supabase.from('pay_runs')
        .select('id, status, worker_types, payment_method')
        .eq('company_id', selectedCompanyId)
        .contains('worker_types', [wtKey])
        .in('status', ['generating', 'exported', 'processing', 'synced'])
        .order('created_at', { ascending: false })
        .limit(1)

      if (activeRun && activeRun.length > 0) {
        const run = activeRun[0]

        setWizPayRunId(run.id)
        setWizGenerated(true)
        setWizComplete(false)
        setWizReleasing(false)
        setWizWorkerTypes(new Set([type]))
        if (run.status === 'generating') { setWizStep(providerConnected ? 3 : 4); setWizExported(false); setWizPayslipsFetched(false); setWizPayMethod(run.payment_method || 'external') }
        else if (run.status === 'processing') { setWizStep(4); setWizExported(true); setWizPayslipsFetched(false); setWizPayMethod(run.payment_method || 'external') }
        else if (run.status === 'exported') { setWizStep(providerConnected ? 5 : 5); setWizExported(true); setWizPayslipsFetched(false); setWizPayMethod(run.payment_method || 'external') }
        else { setWizStep(providerConnected ? 6 : 5); setWizExported(true); setWizPayslipsFetched(true); setWizPayMethod(run.payment_method || 'external') }
        setWizExporting(false)
        setWizOvertimeHours({})
        setWizPeriodReviews([])
        setWizBonusEntries([])
        setView('run_payroll')
        return
      }
    }
    setView('run_payroll')
    setWizStep(1)
    setWizWorkerTypes(new Set([type]))
    setWizGenerated(false)
    setWizComplete(false)
    setWizPayMethod('external')
    setWizOvertimeHours({})
    setWizPeriodReviews([])
    setWizPayRunId(null)
    setWizExporting(false)
    setWizExported(false)
    setWizPayslipsFetched(false)
    setWizPushResult(null)
    setWizReleasing(false)
    setWizBonusEntries([])
    setWizManualChecked(new Set())
    setWizSageFiles([])
    setWizSageUploading(false)
    setWizRosterPage(1)
  }

  function loadWizBonuses() {
    const bonusEntries: typeof wizBonusEntries = []
    const isWeekly = (emp: Employee) => {
      const freq = getEffectiveSetting(emp, workerSettings, 'pay_pattern')
      return freq === 'weekly' || freq === 'bi_weekly'
    }
    employees.forEach(emp => {
      if (!emp.bonus_amount || emp.bonus_amount <= 0) return
      const inScope = (
        (wizWorkerTypes.has('employed') && emp.employment_category !== 'shift_worker') ||
        (wizWorkerTypes.has('shift') && emp.employment_category === 'shift_worker' && emp.contract_type !== 'Zero hours shift worker') ||
        (wizWorkerTypes.has('zero_hours') && emp.employment_category === 'shift_worker' && emp.contract_type === 'Zero hours shift worker')
      )
      if (!inScope) return
      if (emp.bonus_frequency === 'monthly' || (emp.bonus_frequency === 'weekly' && !isWeekly(emp))) {
        bonusEntries.push({
          employee_id: emp.id,
          employee_name: `${emp.first_name} ${emp.last_name}`,
          amount: emp.bonus_amount,
          description: `Recurring ${emp.bonus_frequency} bonus`,
          type: 'bonus',
        })
      }
    })
    setWizBonusEntries(bonusEntries)
  }

  async function generateHoursSummary(workerType: 'shift' | 'zero_hours') {
    if (!selectedCompanyId || !session) return
    const period = wizPeriodByType[workerType]
    if (!period) return
    setWizGeneratingReviews(true)

    const targetEmps = workerType === 'shift' ? shiftEmployees : zeroHoursEmployees
    const targetEmpIds = targetEmps.map(e => e.id)

    const [checkinRes, assignmentRes] = await Promise.all([
      supabase.from('checkin_records')
        .select('employee_id, check_in_at, check_out_at, status, shift_assignment_id')
        .eq('company_id', selectedCompanyId)
        .in('status', ['checked_out', 'auto_closed'])
        .gte('check_in_at', period.start + 'T00:00:00')
        .lte('check_in_at', period.end + 'T23:59:59')
        .in('employee_id', targetEmpIds)
        .order('check_in_at', { ascending: true }),
      supabase.from('shift_assignments')
        .select('id, employee_id, date, shift_template:shift_templates(name, start_time, end_time, break_minutes)')
        .eq('company_id', selectedCompanyId)
        .gte('date', period.start)
        .lte('date', period.end)
        .in('employee_id', targetEmpIds),
    ])

    const checkins = (checkinRes.data || []) as { employee_id: string; check_in_at: string; check_out_at: string | null; status: string; shift_assignment_id: string | null }[]
    const assignments = (assignmentRes.data || []) as unknown as { id: string; employee_id: string; date: string; shift_template: { name: string; start_time: string; end_time: string; break_minutes: number } | null }[]

    const assignmentMap = new Map<string, { name: string; start_time: string; end_time: string; break_minutes: number; date: string }>()
    for (const a of assignments) {
      if (a.shift_template) {
        assignmentMap.set(a.id, { name: a.shift_template.name, start_time: a.shift_template.start_time, end_time: a.shift_template.end_time, break_minutes: a.shift_template.break_minutes ?? 30, date: a.date })
      }
    }

    const hoursByEmp: Record<string, number> = {}
    const overtimeByEmp: Record<string, number> = {}
    const detailsByEmp: Record<string, { employee_id: string; check_in_at: string; check_out_at: string; hours: number; scheduled_start?: string; scheduled_end?: string; shift_name?: string; overtime_hours?: number }[]> = {}

    type CheckinRow = { employee_id: string; check_in_at: string; check_out_at: string; hours: number; shift_assignment_id: string | null }
    const shiftGroups = new Map<string, CheckinRow[]>()
    const ungrouped: CheckinRow[] = []

    for (const c of checkins) {
      if (!c.check_out_at) continue
      let hrs = (new Date(c.check_out_at).getTime() - new Date(c.check_in_at).getTime()) / 3600000
      if (hrs <= 0 || hrs >= 24) continue
      if (c.status === 'auto_closed' && c.shift_assignment_id) {
        const assignment = assignmentMap.get(c.shift_assignment_id)
        if (assignment) {
          const schedStart = new Date(`${assignment.date}T${assignment.start_time}`)
          const schedEnd = new Date(`${assignment.date}T${assignment.end_time}`)
          if (schedEnd <= schedStart) schedEnd.setDate(schedEnd.getDate() + 1)
          const scheduledHrs = (schedEnd.getTime() - schedStart.getTime()) / 3600000
          if (hrs > scheduledHrs) hrs = scheduledHrs
        }
      }
      const row: CheckinRow = { employee_id: c.employee_id, check_in_at: c.check_in_at, check_out_at: c.check_out_at, hours: Math.round(hrs * 100) / 100, shift_assignment_id: c.shift_assignment_id }
      if (c.shift_assignment_id) {
        const key = `${c.employee_id}_${c.shift_assignment_id}`
        if (!shiftGroups.has(key)) shiftGroups.set(key, [])
        shiftGroups.get(key)!.push(row)
      } else {
        ungrouped.push(row)
      }
    }

    for (const [, rows] of shiftGroups) {
      const firstRow = rows[0]
      const assignment = firstRow.shift_assignment_id ? assignmentMap.get(firstRow.shift_assignment_id) : undefined
      const rawHrsForShift = rows.reduce((s, r) => s + r.hours, 0)
      const breakHrs = assignment ? (assignment.break_minutes ?? 30) / 60 : 0.5
      const totalHrsForShift = Math.max(0, rawHrsForShift - breakHrs)
      let shiftOT = 0

      if (assignment) {
        const emp = targetEmps.find(e => e.id === firstRow.employee_id)
        const otHandling = emp ? getEffectiveSetting(emp, workerSettings, 'overtime_handling') : 'none'
        if (otHandling === 'overtime') {
          const schedStart = new Date(`${assignment.date}T${assignment.start_time}`)
          const schedEnd = new Date(`${assignment.date}T${assignment.end_time}`)
          if (schedEnd <= schedStart) schedEnd.setDate(schedEnd.getDate() + 1)
          const scheduledHrs = (schedEnd.getTime() - schedStart.getTime()) / 3600000
          shiftOT = Math.round(Math.max(0, totalHrsForShift - scheduledHrs) * 100) / 100
        }
      }

      hoursByEmp[firstRow.employee_id] = (hoursByEmp[firstRow.employee_id] || 0) + totalHrsForShift
      overtimeByEmp[firstRow.employee_id] = (overtimeByEmp[firstRow.employee_id] || 0) + shiftOT
      if (!detailsByEmp[firstRow.employee_id]) detailsByEmp[firstRow.employee_id] = []

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]
        detailsByEmp[firstRow.employee_id].push({
          employee_id: r.employee_id, check_in_at: r.check_in_at, check_out_at: r.check_out_at,
          hours: r.hours,
          scheduled_start: assignment?.start_time, scheduled_end: assignment?.end_time,
          shift_name: assignment?.name,
          overtime_hours: i === rows.length - 1 ? shiftOT : 0,
        })
      }
    }

    for (const r of ungrouped) {
      hoursByEmp[r.employee_id] = (hoursByEmp[r.employee_id] || 0) + r.hours
      if (!detailsByEmp[r.employee_id]) detailsByEmp[r.employee_id] = []
      detailsByEmp[r.employee_id].push({
        employee_id: r.employee_id, check_in_at: r.check_in_at, check_out_at: r.check_out_at,
        hours: r.hours, overtime_hours: 0,
      })
    }
    setWizShiftDetails(prev => ({ ...prev, ...detailsByEmp }))

    await supabase.from('pay_period_reviews')
      .delete()
      .eq('company_id', selectedCompanyId)
      .in('employee_id', targetEmpIds)
      .neq('period_start', period.start)
      .gte('period_start', period.start)
      .lte('period_end', period.end)

    const errors: string[] = []
    for (const emp of targetEmps) {
      const totalHours = hoursByEmp[emp.id] || 0
      const rate = emp.hourly_rate || 0
      const overtime = overtimeByEmp[emp.id] || 0
      const grossPay = Math.round(totalHours * rate * 100) / 100

      const { error } = await supabase.from('pay_period_reviews').upsert({
        company_id: selectedCompanyId,
        employee_id: emp.id,
        period_start: period.start,
        period_end: period.end,
        total_hours: Math.round(totalHours * 100) / 100,
        adjusted_hours: Math.round(totalHours * 100) / 100,
        overtime_hours: Math.round(overtime * 100) / 100,
        hourly_rate: rate,
        gross_pay: grossPay,
        status: 'draft',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'company_id,employee_id,period_start' })
      if (error) errors.push(`${emp.first_name} ${emp.last_name}: ${error.message}`)
    }

    if (errors.length > 0) {
      showError(`Failed for ${errors.length} employee(s): ${errors[0]}`)
    } else {
      const shiftCount = Object.values(detailsByEmp).reduce((s, arr) => s + arr.length, 0)
      const otTotal = Object.values(overtimeByEmp).reduce((s, v) => s + v, 0)
      showSuccess(`Found ${shiftCount} shift${shiftCount !== 1 ? 's' : ''} across ${targetEmps.length} ${workerType === 'shift' ? 'shift worker' : 'zero hours worker'}${targetEmps.length !== 1 ? 's' : ''}${otTotal > 0 ? ` (${otTotal.toFixed(1)}h overtime detected)` : ''}`)
    }

    await loadWizPeriodReviews()
    setWizGeneratingReviews(false)
  }

  async function approveAllReviews(workerType: 'shift' | 'zero_hours') {
    if (!selectedCompanyId || !session) return
    const targetEmps = workerType === 'shift' ? shiftEmployees : zeroHoursEmployees
    const targetIds = new Set(targetEmps.map(e => e.id))
    const toApprove = wizPeriodReviews.filter(r => r.status !== 'approved' && targetIds.has(r.employee_id))
    if (toApprove.length === 0) return

    for (const review of toApprove) {
      await supabase.from('pay_period_reviews').update({
        status: 'approved',
        approved_by: session.user?.id,
        approved_at: new Date().toISOString(),
      }).eq('id', review.id)
    }
    showSuccess(`Approved ${toApprove.length} period review${toApprove.length !== 1 ? 's' : ''}`)
    await loadWizPeriodReviews()
  }

  function countMatchedZeroHoursShifts(): number {
    let matched = 0
    const TOLERANCE_MS = 5 * 60000
    for (const emp of zeroHoursEmployees) {
      const shifts = wizShiftDetails[emp.id] || []
      for (const s of shifts) {
        if (s.scheduled_start && s.scheduled_end) {
          const checkIn = new Date(s.check_in_at)
          const checkOut = new Date(s.check_out_at)
          const dateStr = s.check_in_at.split('T')[0]
          const schedStart = new Date(`${dateStr}T${s.scheduled_start}`)
          const schedEnd = new Date(`${dateStr}T${s.scheduled_end}`)
          if (schedEnd <= schedStart) schedEnd.setDate(schedEnd.getDate() + 1)
          if (Math.abs(checkIn.getTime() - schedStart.getTime()) <= TOLERANCE_MS &&
              Math.abs(checkOut.getTime() - schedEnd.getTime()) <= TOLERANCE_MS) {
            matched++
          }
        }
      }
    }
    return matched
  }

  async function approveMatchedShifts() {
    if (!selectedCompanyId || !session) return
    const period = wizPeriodByType.zero_hours
    if (!period) return
    const TOLERANCE_MS = 5 * 60000
    const matchedEmpIds = new Set<string>()

    for (const emp of zeroHoursEmployees) {
      const shifts = wizShiftDetails[emp.id] || []
      const allMatched = shifts.length > 0 && shifts.every(s => {
        if (!s.scheduled_start || !s.scheduled_end) return false
        const checkIn = new Date(s.check_in_at)
        const checkOut = new Date(s.check_out_at)
        const dateStr = s.check_in_at.split('T')[0]
        const schedStart = new Date(`${dateStr}T${s.scheduled_start}`)
        const schedEnd = new Date(`${dateStr}T${s.scheduled_end}`)
        if (schedEnd <= schedStart) schedEnd.setDate(schedEnd.getDate() + 1)
        return Math.abs(checkIn.getTime() - schedStart.getTime()) <= TOLERANCE_MS &&
               Math.abs(checkOut.getTime() - schedEnd.getTime()) <= TOLERANCE_MS
      })
      if (allMatched) matchedEmpIds.add(emp.id)
    }

    if (matchedEmpIds.size === 0) {
      showError('No zero hours workers have all shifts matching their scheduled times (within 5 min tolerance)')
      return
    }

    const toApprove = wizPeriodReviews.filter(r => r.status !== 'approved' && matchedEmpIds.has(r.employee_id))
    for (const review of toApprove) {
      await supabase.from('pay_period_reviews').update({
        status: 'approved',
        approved_by: session.user?.id,
        approved_at: new Date().toISOString(),
      }).eq('id', review.id)
    }

    showSuccess(`Auto-approved ${toApprove.length} zero hours worker${toApprove.length !== 1 ? 's' : ''} with matching shift times`)
    await loadWizPeriodReviews()
  }

  async function updateReviewHours(reviewId: string, field: 'adjusted_hours' | 'overtime_hours', value: number) {
    const review = wizPeriodReviews.find(r => r.id === reviewId)
    if (!review) return
    const adjustedHours = field === 'adjusted_hours' ? value : Number(review.adjusted_hours)
    const grossPay = Math.round(adjustedHours * Number(review.hourly_rate) * 100) / 100
    await supabase.from('pay_period_reviews').update({
      [field]: value,
      gross_pay: grossPay,
      updated_at: new Date().toISOString(),
    }).eq('id', reviewId)
    setWizPeriodReviews(prev => prev.map(r =>
      r.id === reviewId ? { ...r, [field]: value, gross_pay: grossPay } : r
    ))
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

    const { error } = await supabase.from('payslips').update({ ...editForm, net_pay: net }).eq('id', id)
    if (error) { showError('Failed to save payslip: ' + error.message); return }
    setEditingId(null)
    loadAll()
    showSuccess('Payslip saved')
  }

  async function deletePayslip(id: number) {
    const p = payslips.find(ps => ps.id === id)
    if (p && p.status !== 'draft') { showError('Only draft payslips can be deleted'); return }
    if (!confirm('Delete this draft payslip?')) return
    const { error } = await supabase.from('payslips').delete().eq('id', id)
    if (error) { showError('Failed to delete payslip: ' + error.message); return }
    setPayslips(prev => prev.filter(ps => ps.id !== id))
    showSuccess('Draft payslip deleted')
  }

  async function deleteDraftMonth(_monthKey: string, monthPayslips: Payslip[]) {
    const drafts = monthPayslips.filter(p => p.status === 'draft')
    if (drafts.length === 0) { showError('No draft payslips to delete'); return }
    if (!confirm(`Delete ${drafts.length} draft payslip(s) for this month?`)) return
    const ids = drafts.map(p => p.id)
    const { error } = await supabase.from('payslips').delete().in('id', ids)
    if (error) { showError('Failed to delete drafts: ' + error.message); return }
    setPayslips(prev => prev.filter(ps => !ids.includes(ps.id)))
    showSuccess(`${drafts.length} draft payslip(s) deleted`)
  }

  async function updatePayslipStatus(id: number, newStatus: string) {
    const p = payslips.find(ps => ps.id === id)
    if (!p) return
    const { error } = await supabase.from('payslips').update({ status: newStatus }).eq('id', id)
    if (error) { showError('Failed to update status: ' + error.message); return }
    setPayslips(prev => prev.map(ps => ps.id === id ? { ...ps, status: newStatus } : ps))
    showSuccess('Status updated')
  }

  async function bulkUpdateMonthStatus(monthPayslips: Payslip[], newStatus: string, _monthKey: string) {
    const eligible = monthPayslips.filter(p => p.status !== newStatus)
    if (eligible.length === 0) return
    if (!confirm(`Set ${eligible.length} payslip(s) to "${newStatus}" for this month?`)) return
    setBulkUpdating(true)
    const ids = eligible.map(p => p.id)
    const { error } = await supabase.from('payslips').update({ status: newStatus }).in('id', ids)
    setBulkUpdating(false)
    if (error) { showError('Bulk update failed: ' + error.message); return }
    setPayslips(prev => prev.map(ps => ids.includes(ps.id) ? { ...ps, status: newStatus } : ps))
    showSuccess(`${eligible.length} payslip(s) set to ${newStatus}`)
  }

  async function releaseAllMonth(monthPayslips: Payslip[]) {
    const unreleased = monthPayslips.filter(p => !p.released)
    if (unreleased.length === 0) { showSuccess('All payslips already released'); return }

    if (features.modulr_integration && modulrConnected) {
      const unpushed = unreleased.filter(p => p.employee?.id && !modulrPaidPayslips.has(p.id) && (p.source === 'xero' || p.source === 'sage'))
      if (unpushed.length > 0) {
        setModulrWarning({ show: true, payslipIds: unreleased.map(p => p.id), bulk: true })
        return
      }
    }

    if (!confirm(`Release ${unreleased.length} payslip(s) to employees? They will be visible on their next login.`)) return
    setBulkUpdating(true)
    const ids = unreleased.map(p => p.id)
    const { error } = await supabase.from('payslips').update({ released: true }).in('id', ids)
    setBulkUpdating(false)
    if (error) { showError('Release failed: ' + error.message); return }
    setPayslips(prev => prev.map(ps => ids.includes(ps.id) ? { ...ps, released: true } : ps))
    showSuccess(`${unreleased.length} payslip(s) released to employees`)
  }

  async function togglePayslipRelease(id: number, released: boolean) {
    if (released && features.modulr_integration && modulrConnected) {
      const p = payslips.find(ps => ps.id === id)
      if (p && p.employee?.id && !modulrPaidPayslips.has(p.id) && (p.source === 'xero' || p.source === 'sage')) {
        setModulrWarning({ show: true, payslipIds: [id], bulk: false })
        return
      }
    }
    await doRelease([id], released)
  }

  async function doRelease(ids: number[], released: boolean) {
    const { error } = await supabase.from('payslips').update({ released }).in('id', ids)
    if (error) { showError('Failed to update release status: ' + error.message); return }
    setPayslips(prev => prev.map(ps => ids.includes(ps.id) ? { ...ps, released } : ps))
    showSuccess(released ? `${ids.length} payslip(s) released to employee${ids.length > 1 ? 's' : ''}` : 'Payslip unreleased')
  }

  async function payWithModulrMonth(monthPayslips: Payslip[]) {
    if (!session || !selectedCompanyId) return
    const eligible = monthPayslips.filter(p =>
      p.status === 'paid' && !p.released &&
      (p.source === 'xero' || p.source === 'sage') &&
      p.employee?.id && !modulrPaidPayslips.has(p.id) && !modulrHeldPayslips.has(p.id)
    )
    if (!eligible.length) { showError('No eligible payslips to push to Modulr. Payslips must be paid, unreleased, and from Xero/Sage.'); return }

    const periodLabel = eligible[0].pay_period_start.substring(0, 7)
    if (!confirm(`Push ${eligible.length} payslip(s) to Modulr for payment?\n\nPeriod: ${periodLabel}\nTotal: ${currencySymbol(currency)}${eligible.reduce((s, p) => s + Number(p.net_pay), 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })}`)) return

    await doModulrPay(eligible)
  }

  async function payWithModulrSingle(p: Payslip) {
    if (!session || !selectedCompanyId || !p.employee?.id) return
    if (!confirm(`Push payslip for ${p.employee.first_name} ${p.employee.last_name} to Modulr?\n\nNet: ${currencySymbol(currency)}${Number(p.net_pay).toLocaleString('en-GB', { minimumFractionDigits: 2 })}`)) return
    await doModulrPay([p])
  }

  async function doModulrPay(eligible: Payslip[]) {
    setModulrPaying(true)
    try {
      const payments: { employee_id: string; payslip_id: number; amount: number; sort_code: string; account_number: string; reference: string; employee_name: string }[] = []
      for (const p of eligible) {
        const emp = employees.find(e => e.id === p.employee?.id)
        if (!emp) continue
        const sortCode = (emp.bank_sort_code || '').replace(/[-\s]/g, '')
        const accountNo = (emp.bank_account_number || '').replace(/\s/g, '')
        if (!/^\d{6}$/.test(sortCode) || !/^\d{8}$/.test(accountNo)) continue
        const netPay = Number(p.net_pay)
        if (netPay <= 0) continue
        payments.push({ employee_id: emp.id, payslip_id: p.id, amount: netPay, sort_code: sortCode, account_number: accountNo, reference: `SALARY ${p.pay_period_start}`, employee_name: `${emp.first_name} ${emp.last_name}` })
      }
      if (!payments.length) { showError('No employees with valid bank details and positive net pay'); return }

      const periods = [...new Set(eligible.map(p => p.pay_period_start))].sort()
      const payrunRef = `PR-${periods[0]}_${periods[periods.length - 1]}`

      const { data, error } = await supabase.functions.invoke('modulr-payout', {
        headers: { Authorization: `Bearer ${session!.access_token}` },
        body: { company_id: selectedCompanyId, payrun_ref: payrunRef, payments },
      })
      if (error) {
        let detail = error.message
        try { const body = await (error as any).context?.json?.(); if (body?.error) detail = body.error } catch (_) {}
        throw new Error(detail)
      }
      if (data?.error) throw new Error(data.error)

      const paidIds = new Set(modulrPaidPayslips)
      for (const pm of payments) paidIds.add(pm.payslip_id)
      setModulrPaidPayslips(paidIds)
      showSuccess(`${payments.length} payment(s) submitted to Modulr (Batch: ${data?.modulr_batch_id || 'pending'})`)
    } catch (err) {
      showError('Modulr payment failed: ' + (err as Error).message)
    } finally {
      setModulrPaying(false)
    }
  }

  async function toggleModulrHold(payslipId: number, _employeeId: string, hold: boolean) {
    if (!selectedCompanyId) return
    const { data: mpData } = await supabase
      .from('modulr_payments').select('id').eq('company_id', selectedCompanyId).neq('status', 'failed')
    if (mpData?.length) {
      const { data: items } = await supabase
        .from('modulr_payment_items').select('id')
        .in('payment_id', mpData.map(p => p.id))
        .eq('payslip_id', payslipId)
        .neq('status', 'failed')
      if (items?.length) {
        await supabase.from('modulr_payment_items').update({ modulr_hold: hold }).in('id', items.map(i => i.id))
      }
    }
    const held = new Set(modulrHeldPayslips)
    if (hold) held.add(payslipId); else held.delete(payslipId)
    setModulrHeldPayslips(held)
    showSuccess(hold ? 'Payslip payment on hold' : 'Payslip payment hold removed')
  }

  if (loading) return <div className="admin-section"><p style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted, #888)' }}>Loading payroll data…</p></div>

  const statusBadge = (status: string) => {
    const map: Record<string, { label: string; cls: string }> = {
      not_started: { label: 'Not Started', cls: 'pn-badge-grey' },
      in_progress: { label: 'In Progress', cls: 'pn-badge-amber' },
      processing: { label: 'Processing', cls: 'pn-badge-amber' },
      submitted: { label: 'Submitted', cls: 'pn-badge-blue' },
      paid: { label: 'Paid', cls: 'pn-badge-green' },
    }
    const b = map[status] || { label: status, cls: 'pn-badge-grey' }
    return <span className={`pn-badge ${b.cls}`}>{b.label}</span>
  }

  // Breadcrumb nav
  const viewLabels: Record<View, string> = {
    dashboard: 'Dashboard', payslips: 'Payslips', employee_pay: 'Employee Pay',
    schedule: 'Payroll Schedule', logs: 'Audit Logs', run_payroll: 'Run Payroll', settings: 'Payroll Settings',
  }

  return (
    <div className="admin-section">
      {/* Header */}
      <div className="admin-page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0 }}>Payroll</h2>
          <span style={{ fontSize: 13, color: 'var(--text-muted, #6b7280)', fontWeight: 500 }}>{fyLabel}</span>
        </div>
        <p>{stats.activeEmployees} active employees · {stats.total} payslips this year · {stats.monthsProcessed} months processed</p>
      </div>

      {/* Breadcrumb */}
      {view !== 'dashboard' && (
        <div className="pn-breadcrumb">
          <button onClick={() => setView('dashboard')}>Dashboard</button>
          <span className="pn-breadcrumb-sep">›</span>
          <span>{viewLabels[view]}</span>
        </div>
      )}

      {/* ── DASHBOARD VIEW ─────────────────────────────────────── */}
      {view === 'dashboard' && (
        <>
          {/* Summary stats */}
          <div className="admin-stat-grid" style={{ marginBottom: 24 }}>
            <div className="admin-stat-card">
              <div className="admin-stat-icon" style={{ background: '#5c6bc0' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/></svg>
              </div>
              <div className="admin-stat-info">
                <span className="admin-stat-value">{stats.activeEmployees}</span>
                <span className="admin-stat-label">Active Employees</span>
              </div>
            </div>
            <div className="admin-stat-card" style={{ minWidth: 200 }}>
              <div className="admin-stat-icon" style={{ background: '#43a047' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/></svg>
              </div>
              <div className="admin-stat-info">
                <span className="admin-stat-value">{currencySymbol(currency)}{stats.totalGross.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                <span className="admin-stat-label">Total Gross ({fyLabel})</span>
                <div style={{ marginTop: 6, fontSize: 11, lineHeight: 1.6, color: 'var(--text-muted, #6b7280)' }}>
                  {employedEmployees.length > 0 && <div><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#5c6bc0', marginRight: 4 }} />Employed: {currencySymbol(currency)}{stats.byType.employed.gross.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>}
                  {shiftEmployees.length > 0 && <div><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#7e57c2', marginRight: 4 }} />Shift: {currencySymbol(currency)}{stats.byType.shift.gross.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>}
                  {zeroHoursEmployees.length > 0 && <div><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#ef6c00', marginRight: 4 }} />Zero Hrs: {currencySymbol(currency)}{stats.byType.zero_hours.gross.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>}
                </div>
              </div>
            </div>
            <div className="admin-stat-card" style={{ minWidth: 200 }}>
              <div className="admin-stat-icon" style={{ background: '#1e88e5' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/></svg>
              </div>
              <div className="admin-stat-info">
                <span className="admin-stat-value">{currencySymbol(currency)}{stats.totalNet.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                <span className="admin-stat-label">Total Net ({fyLabel})</span>
                <div style={{ marginTop: 6, fontSize: 11, lineHeight: 1.6, color: 'var(--text-muted, #6b7280)' }}>
                  {employedEmployees.length > 0 && <div><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#5c6bc0', marginRight: 4 }} />Employed: {currencySymbol(currency)}{stats.byType.employed.net.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>}
                  {shiftEmployees.length > 0 && <div><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#7e57c2', marginRight: 4 }} />Shift: {currencySymbol(currency)}{stats.byType.shift.net.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>}
                  {zeroHoursEmployees.length > 0 && <div><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#ef6c00', marginRight: 4 }} />Zero Hrs: {currencySymbol(currency)}{stats.byType.zero_hours.net.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>}
                </div>
              </div>
            </div>
            <div className="admin-stat-card" style={{ minWidth: 200 }}>
              <div className="admin-stat-icon" style={{ background: '#ef5350' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M12 3v18"/><path d="M6 6l6 3 6-3"/></svg>
              </div>
              <div className="admin-stat-info">
                <span className="admin-stat-value">{currencySymbol(currency)}{stats.totalTax.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                <span className="admin-stat-label">Total Tax ({fyLabel})</span>
                <div style={{ marginTop: 6, fontSize: 11, lineHeight: 1.6, color: 'var(--text-muted, #6b7280)' }}>
                  {employedEmployees.length > 0 && <div><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#5c6bc0', marginRight: 4 }} />Employed: {currencySymbol(currency)}{stats.byType.employed.tax.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>}
                  {shiftEmployees.length > 0 && <div><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#7e57c2', marginRight: 4 }} />Shift: {currencySymbol(currency)}{stats.byType.shift.tax.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>}
                  {zeroHoursEmployees.length > 0 && <div><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#ef6c00', marginRight: 4 }} />Zero Hrs: {currencySymbol(currency)}{stats.byType.zero_hours.tax.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>}
                </div>
              </div>
            </div>
          </div>

          {/* Per-Worker-Type Payroll Cards */}
          <h3 className="pn-section-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            Payroll Dashboard
          </h3>

          {workerTypeStats.length === 0 ? (
            <div className="admin-settings-group" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted, #888)' }}>
              No active employees found. Add employees in the People section to get started with payroll.
            </div>
          ) : (
            <div className="pn-worker-cards">
              {workerTypeStats.map(wt => {
                const freqLabel = wt.payFreq === 'weekly' ? 'Weekly' : wt.payFreq === 'bi_weekly' ? 'Bi-weekly' : 'Monthly'
                const lastRun = lastPayRuns[wt.key]
                const bonusCount = wt.employees.filter(e => e.bonus_amount && e.bonus_amount > 0).length

                return (
                  <div key={wt.key} className="pn-worker-card" style={{ borderTop: `4px solid ${wt.colour}` }}>
                    <div className="pn-worker-card-header">
                      <div>
                        <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{wt.label}</h4>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 2 }}>
                          <span style={{ fontSize: 12, color: 'var(--text-muted, #6b7280)' }}>{wt.employees.length} employee{wt.employees.length !== 1 ? 's' : ''}</span>
                          <span className="pn-badge" style={{ background: wt.colour + '18', color: wt.colour, fontSize: 10, padding: '1px 6px' }}>{freqLabel}</span>
                        </div>
                      </div>
                      {statusBadge(wt.status)}
                    </div>
                    <div className="pn-worker-card-body">
                      {lastRun ? (
                        <>
                          <div className="pn-worker-metric">
                            <span className="pn-worker-metric-value">{currencySymbol(currency)}{lastRun.total_gross.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                            <span className="pn-worker-metric-label">Last run total</span>
                          </div>
                          <div className="pn-worker-metric">
                            <span className="pn-worker-metric-value">{formatDate(lastRun.completed_at?.split('T')[0] || lastRun.period_end)}</span>
                            <span className="pn-worker-metric-label">Last run date</span>
                          </div>
                        </>
                      ) : (
                        <div className="pn-worker-metric">
                          <span className="pn-worker-metric-value" style={{ color: 'var(--text-muted, #888)', fontSize: 13 }}>No previous run</span>
                          <span className="pn-worker-metric-label">Last run</span>
                        </div>
                      )}
                      {wt.isShiftType && wt.payFreq !== 'monthly' && wt.currentPeriodStart ? (
                        <>
                          <div className="pn-worker-metric">
                            <span className="pn-worker-metric-value">{formatDate(wt.currentPeriodStart)} – {formatDate(wt.currentPeriodEnd)}</span>
                            <span className="pn-worker-metric-label">Current period (collecting)</span>
                          </div>
                          <div className="pn-worker-metric">
                            <span className="pn-worker-metric-value">{formatDate(wt.processingWindowStart)} – {formatDate(wt.processingWindowEnd)}</span>
                            <span className="pn-worker-metric-label">Process & pay window</span>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="pn-worker-metric">
                            <span className="pn-worker-metric-value">{formatDate(wt.nextPayDate.toISOString().split('T')[0])}</span>
                            <span className="pn-worker-metric-label">Next pay date</span>
                          </div>
                          <div className="pn-worker-metric">
                            <span className="pn-worker-metric-value">{formatDate((() => { const d = new Date(wt.nextPayDate); d.setDate(d.getDate() - 5); return d })().toISOString().split('T')[0])}</span>
                            <span className="pn-worker-metric-label">Expected run by</span>
                          </div>
                        </>
                      )}
                    </div>
                    {(bonusCount > 0 || wt.payslips.length > 0) && (
                      <div style={{ padding: '0 16px 8px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {wt.payslips.length > 0 && (
                          <span style={{ fontSize: 11, color: 'var(--text-muted, #6b7280)' }}>{wt.payslips.length} payslip{wt.payslips.length !== 1 ? 's' : ''} this period</span>
                        )}
                        {bonusCount > 0 && (
                          <span style={{ fontSize: 11, color: '#ef6c00' }}>{bonusCount} with recurring bonus</span>
                        )}
                      </div>
                    )}
                    <div className="pn-worker-card-footer">
                      {wt.status === 'not_started' && (
                        <button className="admin-btn admin-btn-primary" style={{ background: wt.colour, fontSize: 13 }} onClick={() => startPayrollForType(wt.key)}>
                          Run Pre-Payroll
                        </button>
                      )}
                      {wt.status === 'in_progress' && (
                        <>
                          <button className="admin-btn admin-btn-primary" style={{ background: wt.colour, fontSize: 13 }} onClick={() => startPayrollForType(wt.key)}>
                            Continue Pay Run
                          </button>
                          <button className="admin-btn" style={{ fontSize: 13, marginLeft: 6 }} onClick={() => { setPayslipSubTab(wt.key); setView('payslips') }}>
                            Review Payslips
                          </button>
                        </>
                      )}
                      {(wt.status === 'submitted' || wt.status === 'paid') && (
                        <>
                          <button className="admin-btn admin-btn-primary" style={{ background: wt.colour, fontSize: 13 }} onClick={() => startPayrollForType(wt.key)}>
                            Run Next Payrun
                          </button>
                          <button className="admin-btn" style={{ fontSize: 13, marginLeft: 6 }} onClick={() => { setPayslipSubTab(wt.key); setView('payslips') }}>
                            View Payslips
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Processing Pay Runs */}
          {processingRuns.length > 0 && (
            <>
              <h3 className="pn-section-title" style={{ marginTop: 28 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                Pay Runs In Progress
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
                {processingRuns.map(run => {
                  const wtLabels = (run.worker_types || []).map((wt: string) => wt === 'employed' ? 'Employed' : wt === 'shift_worker' ? 'Shift Workers' : 'Zero Hours').join(', ')
                  const statusColor = run.status === 'processing' ? '#ff9800' : '#1565c0'
                  const statusLabel = run.status === 'processing' ? 'Processing' : 'Exported'
                  return (
                    <div key={run.id} style={{
                      background: 'var(--bg-subtle, #f8f9fa)', borderRadius: 8, padding: '12px 16px',
                      border: `1px solid var(--border, #e5e7eb)`, borderLeft: `4px solid ${statusColor}`,
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10,
                    }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <strong style={{ fontSize: 14 }}>{wtLabels}</strong>
                          <span style={{ fontSize: 11, background: statusColor + '18', color: statusColor, padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>{statusLabel}</span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted, #6b7280)', marginTop: 2 }}>
                          {run.period_start && run.period_end
                            ? `${formatDate(run.period_start)} – ${formatDate(run.period_end)}`
                            : `Started ${formatDate(run.created_at.split('T')[0])}`}
                        </div>
                      </div>
                      <button className="admin-btn admin-btn-primary" style={{ fontSize: 12, background: statusColor }} onClick={() => {
                        const types = new Set<'employed' | 'shift' | 'zero_hours'>()
                        if (run.worker_types?.includes('employed')) types.add('employed')
                        if (run.worker_types?.includes('shift_worker')) types.add('shift')
                        if (run.worker_types?.includes('zero_hours')) types.add('zero_hours')
                        const firstType = [...types][0]
                        if (firstType) startPayrollForType(firstType)
                        else startRunPayroll()
                      }}>
                        Resume →
                      </button>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {/* Quick Actions */}
          <h3 className="pn-section-title" style={{ marginTop: 28 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
            Quick Actions
          </h3>
          <div className="pn-action-grid">
            <button className="pn-action-card pn-action-primary" onClick={startRunPayroll}>
              <div className="pn-action-icon" style={{ background: '#5c6bc0' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>
              </div>
              <div><strong>New Payroll Run</strong><br /><span>Step-by-step guided workflow</span></div>
            </button>
            <button className="pn-action-card" onClick={() => setView('payslips')}>
              <div className="pn-action-icon" style={{ background: '#26a69a' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/></svg>
              </div>
              <div><strong>View All Payslips</strong><br /><span>Browse and filter payslip records</span></div>
            </button>
            <button className="pn-action-card" onClick={() => setView('employee_pay')}>
              <div className="pn-action-icon" style={{ background: '#7e57c2' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/></svg>
              </div>
              <div><strong>Employee Pay</strong><br /><span>Salaries, rates, and deductions</span></div>
            </button>
            <button className="pn-action-card" onClick={() => setView('schedule')}>
              <div className="pn-action-icon" style={{ background: '#ef6c00' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              </div>
              <div><strong>Payroll Schedule</strong><br /><span>Pay dates and calendar</span></div>
            </button>
            <button className="pn-action-card" onClick={() => setView('logs')}>
              <div className="pn-action-icon" style={{ background: '#78909c' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              </div>
              <div><strong>Audit Logs</strong><br /><span>Payroll action history</span></div>
            </button>
            <button className="pn-action-card" onClick={() => setView('settings')}>
              <div className="pn-action-icon" style={{ background: '#546e7a' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              </div>
              <div><strong>Payroll Settings</strong><br /><span>Pay patterns, overtime &amp; worker types</span></div>
            </button>
          </div>

          {/* Recent Activity */}
          {recentLogs.length > 0 && (
            <>
              <h3 className="pn-section-title" style={{ marginTop: 28 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                Recent Activity
              </h3>
              <div className="admin-settings-group">
                {recentLogs.map(log => (
                  <div key={log.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border, #e5e7eb)' }}>
                    <div>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{log.action}</span>
                      {log.detail && <span style={{ fontSize: 12, color: 'var(--text-muted, #6b7280)', marginLeft: 8 }}>{log.detail.length > 80 ? log.detail.slice(0, 80) + '…' : log.detail}</span>}
                    </div>
                    <span style={{ fontSize: 12, color: 'var(--text-muted, #888)', whiteSpace: 'nowrap' }}>{formatDate(log.created_at)}</span>
                  </div>
                ))}
                <button className="admin-btn" style={{ marginTop: 10, fontSize: 12 }} onClick={() => setView('logs')}>View All Logs →</button>
              </div>
            </>
          )}

          {/* Integrations status */}
          {(xeroConnected || sageConnected || modulrConnected) && (
            <>
              <h3 className="pn-section-title" style={{ marginTop: 28 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                Connected Integrations
              </h3>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {xeroConnected && (
                  <div className="pn-integration-chip" style={{ borderLeft: '3px solid #13b5ea' }}>
                    <strong>Xero</strong> <span className="pn-badge pn-badge-green">Connected</span>
                  </div>
                )}
                {sageConnected && (
                  <div className="pn-integration-chip" style={{ borderLeft: '3px solid #00d639' }}>
                    <strong>Sage</strong> <span className="pn-badge pn-badge-green">Connected</span>
                  </div>
                )}
                {modulrConnected && (
                  <div className="pn-integration-chip" style={{ borderLeft: '3px solid #1a1a2e' }}>
                    <strong>Modulr</strong> <span className="pn-badge pn-badge-green">Active</span>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}

      {/* ── PAYSLIPS BROWSE ────────────────────────────────────── */}
      {view === 'payslips' && (
        <>
          {/* Resume pay run banner */}
          {wizPayRunId && (
            <div style={{ background: '#fff3e0', border: '1px solid #ffb74d', borderRadius: 8, padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#e65100" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#e65100' }}>A pay run is in progress. Review your payslips below, then continue the wizard to complete it.</span>
              </div>
              <button className="admin-btn admin-btn-primary" style={{ fontSize: 13, whiteSpace: 'nowrap' }} onClick={startRunPayroll}>Continue Pay Run →</button>
            </div>
          )}
          {/* Employed / Shift / Zero Hours sub-tabs */}
          <div style={{ display: 'flex', gap: 0, marginBottom: 12 }}>
            <button
              onClick={() => setPayslipSubTab('employed')}
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
              onClick={() => setPayslipSubTab('shift')}
              style={{
                padding: '8px 20px', fontSize: 13, fontWeight: 600, border: '1px solid var(--border, #e5e7eb)',
                borderLeft: 'none', cursor: 'pointer',
                background: payslipSubTab === 'shift' ? '#7e57c2' : 'var(--bg-card, #fff)',
                color: payslipSubTab === 'shift' ? '#fff' : 'var(--text, #1a1a2e)',
              }}
            >
              Shift Payslips
            </button>
            <button
              onClick={() => setPayslipSubTab('zero_hours')}
              style={{
                padding: '8px 20px', fontSize: 13, fontWeight: 600, border: '1px solid var(--border, #e5e7eb)',
                borderLeft: 'none', borderRadius: '0 8px 8px 0', cursor: 'pointer',
                background: payslipSubTab === 'zero_hours' ? '#26a69a' : 'var(--bg-card, #fff)',
                color: payslipSubTab === 'zero_hours' ? '#fff' : 'var(--text, #1a1a2e)',
              }}
            >
              Zero Hours Payslips
            </button>
          </div>

          <div className="admin-filters" style={{ flexWrap: 'wrap' }}>
            <select value={filterEmployee} onChange={e => setFilterEmployee(e.target.value)} className="admin-select">
              <option value="">All Employees</option>
              {empNames.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="admin-select">
              <option value="">All Statuses</option>
              <option value="flagged">Flagged</option><option value="draft">Draft</option><option value="processed">Processed</option><option value="paid">Paid</option>
              <option value="released">Released</option><option value="unreleased">Unreleased</option>
            </select>
          </div>

          <input
            className="admin-input"
            placeholder="Search payroll..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ maxWidth: 320, marginBottom: 12 }}
          />

          {filtered.length === 0 && <div className="admin-empty">No payslips found</div>}
          {groupedByMonth.map((group, groupIdx) => {
            const isCollapsed = collapsedMonths.has(group.key)
            const gPaid = group.payslips.filter(p => p.status === 'paid').length
            const gDraft = group.payslips.filter(p => p.status === 'draft').length
            const gProcessed = group.payslips.filter(p => p.status === 'processed').length
            const gFlagged = group.payslips.filter(p => p.status === 'flagged').length
            const gReleased = group.payslips.filter(p => p.released).length
            const gUnreleased = group.payslips.filter(p => !p.released).length
            const allReleased = gUnreleased === 0
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
                    {gReleased > 0 && <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: isLatest ? 'rgba(255,255,255,0.2)' : '#e8f5e9', color: isLatest ? '#a5d6a7' : '#2e7d32' }}>✓ {gReleased} released</span>}
                    {gUnreleased > 0 && <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: isLatest ? 'rgba(255,255,255,0.15)' : '#fff3e0', color: isLatest ? '#ffcc80' : '#e65100' }}>{gUnreleased} unreleased</span>}
                    <span style={{ fontSize: 12, opacity: 0.8 }}>Gross: {currencySymbol(currency)}{gGross.toLocaleString('en-GB', { minimumFractionDigits: 2 })}</span>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>Net: {currencySymbol(currency)}{gNet.toLocaleString('en-GB', { minimumFractionDigits: 2 })}</span>
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
                      <span style={{ borderLeft: '1px solid var(--border, #e5e7eb)', height: 16, margin: '0 4px' }} />
                      {allReleased ? (
                        <span style={{ fontSize: 11, fontWeight: 600, color: '#2e7d32', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2e7d32" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                          All Released
                        </span>
                      ) : (
                        <button className="admin-btn-sm" disabled={bulkUpdating} onClick={() => releaseAllMonth(group.payslips)} style={{ fontSize: 11, background: '#2e7d32', color: '#fff', border: '1px solid #2e7d32' }}>
                          Release All ({gUnreleased})
                        </button>
                      )}
                      {features.modulr_integration && modulrConnected && (() => {
                        const modulrEligible = group.payslips.filter(p => p.status === 'paid' && !p.released && (p.source === 'xero' || p.source === 'sage') && p.employee?.id && !modulrPaidPayslips.has(p.id) && !modulrHeldPayslips.has(p.id))
                        const allPushed = group.payslips.filter(p => p.status === 'paid' && (p.source === 'xero' || p.source === 'sage') && modulrPaidPayslips.has(p.id)).length > 0
                        return modulrEligible.length > 0 ? (
                          <button className="admin-btn-sm" disabled={modulrPaying} onClick={() => payWithModulrMonth(group.payslips)} style={{ fontSize: 11, background: '#1a237e', color: '#fff', border: '1px solid #1a237e' }}>
                            Pay with Modulr ({modulrEligible.length})
                          </button>
                        ) : allPushed ? (
                          <span style={{ fontSize: 11, fontWeight: 600, color: '#1a237e', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1a237e" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                            Modulr Paid
                          </span>
                        ) : null
                      })()}
                      {gDraft > 0 && (
                        <button className="admin-btn-sm admin-btn-danger" disabled={bulkUpdating} onClick={() => deleteDraftMonth(group.key, group.payslips)} style={{ fontSize: 11, marginLeft: 'auto' }}>
                          Delete {gDraft} Draft{gDraft !== 1 ? 's' : ''}
                        </button>
                      )}
                    </div>

                    <div className="admin-table-wrap">
                      <table className="admin-table">
                        <thead><tr><th>Ref</th><th>Employee</th><th>Period</th><th>Gross</th><th>Tax</th><th>NI</th><th>Pension</th><th>Net</th><th>Status</th><th>Released</th><th>Actions</th></tr></thead>
                        <tbody>
                          {group.payslips.map(p => {
                            const isPaid = p.status === 'paid'
                            const isDraft = p.status === 'draft'
                            const isReleased = p.released
                            return (
                              <React.Fragment key={p.id}>
                                <tr className={`${expandedId === p.id ? 'admin-row-active' : ''} ${p.status === 'flagged' ? 'admin-row-flagged' : ''}`} style={isReleased ? { background: '#f1f8e9' } : undefined}>
                                  <td className="admin-td-mono">{p.reference_number}</td>
                                  <td>{p.employee ? `${p.employee.first_name} ${p.employee.last_name}` : '—'}</td>
                                  <td style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{formatDate(p.pay_period_start)} – {formatDate(p.pay_period_end)}</td>
                                  <td>{currencySymbol(currency)}{Number(p.gross_pay).toFixed(2)}</td>
                                  <td>{currencySymbol(currency)}{Number(p.tax).toFixed(2)}</td>
                                  <td>{currencySymbol(currency)}{Number(p.national_insurance).toFixed(2)}</td>
                                  <td>{currencySymbol(currency)}{Number(p.pension).toFixed(2)}</td>
                                  <td><strong>{currencySymbol(currency)}{Number(p.net_pay).toFixed(2)}</strong></td>
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
                                  <td style={{ textAlign: 'center', display: 'flex', gap: 4, justifyContent: 'center', alignItems: 'center' }}>
                                    <button
                                      className="admin-btn-sm"
                                      onClick={() => togglePayslipRelease(p.id, !isReleased)}
                                      style={{
                                        fontSize: 12, padding: '4px 12px', borderRadius: 10, fontWeight: 600, minWidth: 85,
                                        background: isReleased ? '#e8f5e9' : '#fff3e0',
                                        color: isReleased ? '#2e7d32' : '#e65100',
                                        border: `1px solid ${isReleased ? '#a5d6a7' : '#ffcc80'}`,
                                      }}
                                    >
                                      {isReleased ? '✓ Released' : 'Unreleased'}
                                    </button>
                                    {features.modulr_integration && modulrConnected && isPaid && (p.source === 'xero' || p.source === 'sage') && p.employee?.id && (
                                      modulrPaidPayslips.has(p.id) ? (
                                        <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 8, background: '#e8eaf6', color: '#1a237e', border: '1px solid #c5cae9', whiteSpace: 'nowrap' }}>Modulr ✓</span>
                                      ) : modulrHeldPayslips.has(p.id) ? (
                                        <button className="admin-btn-sm" onClick={() => toggleModulrHold(p.id, p.employee!.id, false)} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 8, background: '#fff3e0', color: '#e65100', border: '1px solid #ffcc80', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                          On Hold
                                        </button>
                                      ) : !isReleased ? (
                                        <>
                                          <button className="admin-btn-sm" disabled={modulrPaying} onClick={() => payWithModulrSingle(p)} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 8, background: '#1a237e', color: '#fff', border: '1px solid #1a237e', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                            Modulr-Pay
                                          </button>
                                          <button className="admin-btn-sm" onClick={() => toggleModulrHold(p.id, p.employee!.id, true)} title="Hold payment" style={{ fontSize: 11, padding: '4px 10px', borderRadius: 8, background: '#fff3e0', color: '#e65100', border: '1px solid #ffcc80', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                            Hold
                                          </button>
                                        </>
                                      ) : null
                                    )}
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
                                              Calculated Net: {currencySymbol(currency)}{((Number(editForm.gross_pay) - Number(editForm.monthly_deductions || 0)) + Number(editForm.overtime || 0) + Number(editForm.adjustments || 0) - Number(editForm.tax) - Number(editForm.national_insurance) - Number(editForm.pension) - Number(editForm.other_deductions)).toFixed(2)}
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
                                            <div><strong>Annual Salary:</strong> {currencySymbol(currency)}{Number(p.annual_salary || 0).toLocaleString()}</div>
                                            <div><strong>Tax:</strong> {currencySymbol(currency)}{Number(p.tax).toFixed(2)}</div>
                                            <div><strong>NI:</strong> {currencySymbol(currency)}{Number(p.national_insurance).toFixed(2)}</div>
                                            <div><strong>Pension:</strong> {currencySymbol(currency)}{Number(p.pension).toFixed(2)}</div>
                                            <div><strong>Overtime:</strong> {currencySymbol(currency)}{Number(p.overtime || 0).toFixed(2)}</div>
                                            <div><strong>Adjustments:</strong> {currencySymbol(currency)}{Number(p.adjustments || 0).toFixed(2)}</div>
                                            <div><strong>Other Deductions:</strong> {currencySymbol(currency)}{Number(p.other_deductions || 0).toFixed(2)}</div>
                                            <div><strong>Salary Sacrifice:</strong> {currencySymbol(currency)}{Number(p.monthly_deductions || 0).toFixed(2)}</div>
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
                                                <div><strong>Benefit Tax Saving:</strong> <span style={{ color: '#16a34a', fontWeight: 600 }}>{currencySymbol(currency)}{totalSaving.toFixed(2)}</span> <span style={{ fontSize: 11, color: 'var(--text-muted, #8b8fa3)' }}>({currencySymbol(currency)}{taxSaving.toFixed(2)} tax + {currencySymbol(currency)}{niSaving.toFixed(2)} NI)</span></div>
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
                                                    {b.title} — {currencySymbol(currency)}{b.monthly_cost.toFixed(2)}/mo (since {new Date(b.enrolled_at).toLocaleDateString('en-GB')})
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

      {/* ── EMPLOYEE PAY ───────────────────────────────────────── */}
      {view === 'employee_pay' && (
        <div className="admin-settings-group">
          <h3 style={{ margin: '0 0 14px', fontSize: 16, fontWeight: 700 }}>Employee Pay Configuration</h3>
          <p style={{ fontSize: 13, color: 'var(--text-muted, #6b7280)', marginBottom: 16 }}>
            View and manage salary, hourly rates, and pay details for all active employees. Changes here affect future payslip generation.
          </p>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Department</th>
                  <th>Type</th>
                  <th>Annual Salary</th>
                  <th>Hourly Rate</th>
                  <th>Tax Code</th>
                  <th>Payroll ID</th>
                </tr>
              </thead>
              <tbody>
                {employees.map(emp => (
                  <tr key={emp.id}>
                    <td style={{ fontWeight: 600 }}>{emp.first_name} {emp.last_name}</td>
                    <td>{emp.department || '—'}</td>
                    <td>
                      {emp.employment_category === 'shift_worker'
                        ? (emp.contract_type === 'Zero hours shift worker'
                          ? <span style={{ color: '#ef6c00', fontWeight: 600, fontSize: 12 }}>Zero Hours</span>
                          : <span style={{ color: '#7e57c2', fontWeight: 600, fontSize: 12 }}>Shift Worker</span>)
                        : <span style={{ color: '#5c6bc0', fontWeight: 600, fontSize: 12 }}>Employed</span>}
                    </td>
                    <td>{emp.annual_salary ? `${currencySymbol(currency)}${Number(emp.annual_salary).toLocaleString()}` : '—'}</td>
                    <td>{emp.hourly_rate ? `${currencySymbol(currency)}${Number(emp.hourly_rate).toFixed(2)}` : '—'}</td>
                    <td>{emp.tax_code || '—'}</td>
                    <td>{emp.payroll_id || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── SCHEDULE ───────────────────────────────────────────── */}
      {view === 'schedule' && (
        <div className="admin-settings-group">
          <h3 style={{ margin: '0 0 14px', fontSize: 16, fontWeight: 700 }}>Payroll Schedule — {fyLabel}</h3>
          <p style={{ fontSize: 13, color: 'var(--text-muted, #6b7280)', marginBottom: 16 }}>
            Monthly payroll calendar showing pay dates, payslip counts, and status for each period.
          </p>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Period</th>
                  <th>Pay Date</th>
                  <th>Employed</th>
                  <th>Shift</th>
                  <th>Zero Hrs</th>
                  <th>Total Gross</th>
                  <th>Emp Status</th>
                  <th>Shift Status</th>
                  <th>Zero Hrs Status</th>
                </tr>
              </thead>
              <tbody>
                {fyMonths.map(m => {
                  const key = `${m.year}-${String(m.month + 1).padStart(2, '0')}`
                  const monthPayslips = payslips.filter(p => p.pay_period_start.startsWith(key))
                  const empIds = new Set(employedEmployees.map(e => e.id))
                  const shiftIds = new Set(shiftEmployees.map(e => e.id))
                  const zeroIds = new Set(zeroHoursEmployees.map(e => e.id))
                  const empSlips = monthPayslips.filter(p => p.employee?.id && empIds.has(p.employee.id))
                  const shiftSlips = monthPayslips.filter(p => p.employee?.id && shiftIds.has(p.employee.id))
                  const zeroSlips = monthPayslips.filter(p => p.employee?.id && zeroIds.has(p.employee.id))
                  const gross = monthPayslips.reduce((s, p) => s + Number(p.gross_pay), 0)
                  const startDate = new Date(m.year, m.month, 1)
                  const endDate = new Date(m.year, m.month + 1, 0)
                  const payDate = getPayDay(m.year, m.month, payDayMode, customPayDay)
                  const isPast = endDate < new Date()
                  const getStatus = (slips: typeof monthPayslips) => {
                    if (slips.length === 0) return isPast ? 'No Payslips' : 'Upcoming'
                    if (slips.every(p => p.status === 'paid')) return 'Paid'
                    if (slips.some(p => p.status === 'draft' || p.status === 'flagged')) return 'Draft'
                    return 'Processed'
                  }
                  const getStatusCls = (s: string) =>
                    s === 'Paid' ? 'admin-badge-paid' : s === 'Draft' ? 'admin-badge-draft' : s === 'Processed' ? 'admin-badge-approved' : 'admin-badge-pending'
                  const empStatus = getStatus(empSlips)
                  const shiftStatus = getStatus(shiftSlips)
                  const zeroStatus = getStatus(zeroSlips)
                  return (
                    <tr key={key}>
                      <td style={{ fontWeight: 600 }}>{m.label}</td>
                      <td>{formatDate(localDateStr(startDate))} – {formatDate(localDateStr(endDate))}</td>
                      <td>{formatDate(localDateStr(payDate))}</td>
                      <td style={{ textAlign: 'center' }}>{empSlips.length || '—'}</td>
                      <td style={{ textAlign: 'center' }}>{shiftSlips.length || '—'}</td>
                      <td style={{ textAlign: 'center' }}>{zeroSlips.length || '—'}</td>
                      <td>{currencySymbol(currency)}{gross.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                      <td><span className={`admin-badge ${getStatusCls(empStatus)}`}>{empStatus}</span></td>
                      <td><span className={`admin-badge ${getStatusCls(shiftStatus)}`}>{shiftStatus}</span></td>
                      <td><span className={`admin-badge ${getStatusCls(zeroStatus)}`}>{zeroStatus}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}


      {/* ── LOGS ───────────────────────────────────────────────── */}
      {view === 'logs' && (
        <div className="admin-settings-group">
          <h3 style={{ margin: '0 0 14px', fontSize: 16, fontWeight: 700 }}>Payroll Audit Logs</h3>
          <p style={{ fontSize: 13, color: 'var(--text-muted, #6b7280)', marginBottom: 16 }}>
            Full audit trail of payroll actions is available on the existing Payroll page. Showing the most recent entries.
          </p>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr><th>Date</th><th>Action</th><th>Detail</th><th>Status</th></tr>
              </thead>
              <tbody>
                {recentLogs.length === 0 ? (
                  <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted, #888)', padding: 30 }}>No audit log entries</td></tr>
                ) : recentLogs.map(log => (
                  <tr key={log.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDate(log.created_at)}</td>
                    <td style={{ fontWeight: 600 }}>{log.action}</td>
                    <td style={{ fontSize: 12 }}>{log.detail || '—'}</td>
                    <td><span className={`admin-badge ${log.status === 'success' ? 'admin-badge-paid' : log.status === 'error' ? 'admin-badge-rejected' : 'admin-badge-pending'}`}>{log.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── PAYROLL SETTINGS VIEW ────────────────────────────── */}
      {view === 'settings' && (
        <div className="admin-settings-section">
          <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
            Set company-wide defaults for how each worker type records time, gets paid, and handles overtime.
            Individual employees can be overridden in their profile — overridden employees become exceptions and won't change when you update these defaults.
          </p>

          {(['employed', 'shift_worker', 'zero_hours'] as const).map(wt => {
            const s = editingSettings[wt]
            if (!s) return null
            const label = wt === 'employed' ? 'Employed / Salaried Staff' : wt === 'shift_worker' ? 'Employed Shift Workers' : 'Zero Hours Workers'
            const colour = wt === 'employed' ? '#3b82f6' : wt === 'shift_worker' ? '#8b5cf6' : '#f59e0b'
            const empFilter = wt === 'zero_hours'
              ? employees.filter(e => e.employment_category === 'shift_worker' && e.contract_type === 'Zero hours shift worker')
              : wt === 'shift_worker'
              ? employees.filter(e => e.employment_category === 'shift_worker' && e.contract_type !== 'Zero hours shift worker')
              : employees.filter(e => e.employment_category === 'employed')
            const empCount = empFilter.length
            const exceptionCount = empFilter.filter(e => e.is_payroll_exception).length
            return (
              <div className="admin-settings-group" key={wt}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <div>
                    <h3 style={{ margin: 0 }}>{label}</h3>
                    <span style={{ fontSize: 12, color: '#6b7280' }}>
                      {empCount} employee{empCount !== 1 ? 's' : ''}
                      {exceptionCount > 0 && <span style={{ marginLeft: 8, padding: '2px 8px', borderRadius: 10, background: '#fef3c7', color: '#92400e', fontSize: 11, fontWeight: 600 }}>{exceptionCount} exception{exceptionCount !== 1 ? 's' : ''}</span>}
                    </span>
                  </div>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: colour }} />
                </div>
                <div className="admin-detail-grid admin-detail-grid-3">
                  {wt === 'shift_worker' && (
                    <div className="admin-form-field">
                      <label style={{ fontSize: 12, fontWeight: 600 }}>Time Recording</label>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
                        <button type="button" onClick={() => setEditingSettings(p => ({ ...p, [wt]: { ...p[wt], time_recording: 'checkin' } }))}
                          style={{ padding: '6px 14px', borderRadius: 6, border: s.time_recording === 'checkin' ? '2px solid #8b5cf6' : '1px solid #d1d5db', background: s.time_recording === 'checkin' ? '#ede9fe' : '#fff', color: s.time_recording === 'checkin' ? '#6d28d9' : '#6b7280', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Check-in</button>
                        <button type="button" onClick={() => setEditingSettings(p => ({ ...p, [wt]: { ...p[wt], time_recording: 'timesheet' } }))}
                          style={{ padding: '6px 14px', borderRadius: 6, border: s.time_recording === 'timesheet' ? '2px solid #8b5cf6' : '1px solid #d1d5db', background: s.time_recording === 'timesheet' ? '#ede9fe' : '#fff', color: s.time_recording === 'timesheet' ? '#6d28d9' : '#6b7280', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Timesheets</button>
                      </div>
                    </div>
                  )}
                  <div className="admin-form-field">
                    <label style={{ fontSize: 12, fontWeight: 600 }}>Pay Pattern</label>
                    <select className="admin-select" value={s.pay_pattern} onChange={e => setEditingSettings(p => ({ ...p, [wt]: { ...p[wt], pay_pattern: e.target.value as PayFrequency } }))}>
                      <option value="weekly">Weekly</option>
                      {wt !== 'employed' && <option value="bi_weekly">Bi-weekly</option>}
                      <option value="monthly">Monthly</option>
                    </select>
                  </div>
                  <div className="admin-form-field">
                    <label style={{ fontSize: 12, fontWeight: 600 }}>Overtime Handling</label>
                    <select className="admin-select" value={s.overtime_handling} onChange={e => setEditingSettings(p => ({ ...p, [wt]: { ...p[wt], overtime_handling: e.target.value } }))}>
                      <option value="none">None</option>
                      <option value="overtime">Overtime (Paid)</option>
                      <option value="toil">TOIL (Time Off in Lieu)</option>
                    </select>
                  </div>
                  {s.overtime_handling === 'overtime' && (
                    <div className="admin-form-field">
                      <label style={{ fontSize: 12, fontWeight: 600 }}>Overtime Rate Multiplier</label>
                      <input className="admin-inline-input" type="number" step="0.25" min="1" max="3" value={s.overtime_rate_multiplier} onChange={e => setEditingSettings(p => ({ ...p, [wt]: { ...p[wt], overtime_rate_multiplier: parseFloat(e.target.value) || 1.5 } }))} />
                    </div>
                  )}
                  {wt === 'zero_hours' && (
                    <>
                      <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #e5e7eb' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                          <h4 style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>Holiday Pay</h4>
                          <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: '#dbeafe', color: '#1e40af', fontWeight: 600 }}>UK Statutory</span>
                        </div>
                        <p style={{ fontSize: 11, color: '#6b7280', margin: '0 0 12px', lineHeight: 1.4 }}>
                          Under UK Working Time Regulations 1998 (amended 2024), zero hours workers accrue paid holiday based on hours worked. The statutory minimum is 5.6 weeks (12.07% of hours worked).
                        </p>
                      </div>
                      <div className="admin-form-field">
                        <label style={{ fontSize: 12, fontWeight: 600 }}>Holiday Pay Method</label>
                        <select className="admin-select" value={s.holiday_pay_method || 'rolled_up'} onChange={e => setEditingSettings(p => ({ ...p, [wt]: { ...p[wt], holiday_pay_method: e.target.value as 'accrual' | 'rolled_up' } }))}>
                          <option value="rolled_up">Rolled-up Holiday Pay (paid on each payslip)</option>
                          <option value="accrual">Accrual (workers take paid leave)</option>
                        </select>
                      </div>
                      <div className="admin-form-field">
                        <label style={{ fontSize: 12, fontWeight: 600 }}>Accrual Rate (%)</label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <input className="admin-inline-input" type="number" step="0.01" min="12.07" max="30" value={s.holiday_accrual_rate ?? 12.07} onChange={e => setEditingSettings(p => ({ ...p, [wt]: { ...p[wt], holiday_accrual_rate: parseFloat(e.target.value) || 12.07 } }))} style={{ width: 90 }} />
                          <span style={{ fontSize: 11, color: '#6b7280' }}>Statutory minimum: 12.07%</span>
                        </div>
                        <p style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
                          For enhanced contractual holiday: total holiday weeks &divide; (52 &minus; holiday weeks) &times; 100. E.g. 33 days (6.6 weeks) = 14.54%.
                        </p>
                      </div>
                    </>
                  )}
                </div>
                <div style={{ marginTop: 12, textAlign: 'right' }}>
                  <button className="admin-btn admin-btn-primary" disabled={settingsSaving} onClick={() => saveWorkerTypeSettings(wt)}>
                    {settingsSaving ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>
            )
          })}

          {settingsChangeLog.length > 0 && (
            <div className="admin-settings-group">
              <h3>Settings Change Log</h3>
              <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>
                Shows when company defaults changed and how many employees were exceptions (not updated).
              </p>
              <table className="admin-table" style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Worker Type</th>
                    <th>Setting</th>
                    <th>Changed From</th>
                    <th>Changed To</th>
                    <th>Exceptions</th>
                  </tr>
                </thead>
                <tbody>
                  {settingsChangeLog.map(log => (
                    <tr key={log.id}>
                      <td>{new Date(log.created_at).toLocaleDateString('en-GB')}</td>
                      <td style={{ textTransform: 'capitalize' }}>{log.worker_type.replace('_', ' ')}</td>
                      <td style={{ textTransform: 'capitalize' }}>{log.setting_name.replace(/_/g, ' ')}</td>
                      <td>{log.old_value?.replace('_', '-') || '—'}</td>
                      <td>{log.new_value?.replace('_', '-') || '—'}</td>
                      <td>
                        {log.exception_count > 0 ? (
                          <span style={{ padding: '2px 8px', borderRadius: 10, background: '#fef3c7', color: '#92400e', fontSize: 11, fontWeight: 600 }}>{log.exception_count}</span>
                        ) : (
                          <span style={{ color: '#9ca3af' }}>0</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {modulrWarning.show && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
              <div style={{ background: 'var(--bg, #fff)', borderRadius: 12, padding: 24, maxWidth: 480, width: '90vw' }}>
                <h3 style={{ margin: '0 0 12px', fontSize: 17, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                  Modulr Payment Not Submitted
                </h3>
                <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 8 }}>
                  {modulrWarning.bulk
                    ? 'Some payslips in this batch have not been pushed to Modulr for payment yet.'
                    : 'This payslip has not been pushed to Modulr for payment yet.'}
                </p>
                <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 20 }}>
                  Releasing without pushing to Modulr means employees will see their payslips but payment has not been initiated through Modulr.
                </p>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  <button className="admin-btn" onClick={() => setModulrWarning({ show: false, payslipIds: [], bulk: false })} style={{ fontSize: 13 }}>
                    Cancel
                  </button>
                  <button className="admin-btn admin-btn-primary" onClick={() => {
                    const ids = modulrWarning.payslipIds
                    setModulrWarning({ show: false, payslipIds: [], bulk: false })
                    doRelease(ids, true)
                  }} style={{ fontSize: 13, background: '#e65100', borderColor: '#e65100' }}>
                    Continue Without Modulr
                  </button>
                </div>
              </div>
            </div>
          )}
          {settingsImpactModal.open && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
              <div style={{ background: 'var(--bg, #fff)', borderRadius: 12, padding: 24, maxWidth: 520, width: '90vw', maxHeight: '85vh', overflowY: 'auto' }}>
                <h3 style={{ margin: '0 0 4px', fontSize: 17, fontWeight: 700 }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" style={{ verticalAlign: -3, marginRight: 6 }}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                  Payroll Settings Impact Assessment
                </h3>
                <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
                  Review the impact of your changes before applying.
                </p>
                <div style={{ padding: 12, background: '#f8fafc', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
                  <h4 style={{ margin: '0 0 8px', textTransform: 'capitalize' }}>
                    {settingsImpactModal.workerType.replace('_', ' ')} — Changes
                  </h4>
                  {settingsImpactModal.changes.map(c => (
                    <p key={c.name} style={{ margin: '4px 0' }}><strong style={{ textTransform: 'capitalize' }}>{c.name.replace(/_/g, ' ')}:</strong> {c.oldVal || '(new)'} → {c.newVal}</p>
                  ))}
                  <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 8, marginTop: 8 }}>
                    <p style={{ margin: '0 0 2px' }}><strong>{settingsImpactModal.affectedCount}</strong> employee(s) will be affected by this change</p>
                    {settingsImpactModal.exceptionCount > 0 && (
                      <p style={{ margin: 0 }}><strong>{settingsImpactModal.exceptionCount}</strong> employee(s) have individual overrides and will not be changed</p>
                    )}
                  </div>
                </div>
                <div className="admin-form-field" style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 12, fontWeight: 600 }}>Effective Date</label>
                  <input type="date" value={settingsImpactModal.effectiveDate} onChange={e => setSettingsImpactModal(prev => ({ ...prev, effectiveDate: e.target.value }))} className="admin-inline-input" />
                </div>
                <div className="admin-form-field" style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 12, fontWeight: 600 }}>Type CONFIRM to proceed</label>
                  <input type="text" value={settingsImpactModal.confirmText} onChange={e => setSettingsImpactModal(prev => ({ ...prev, confirmText: e.target.value }))} className="admin-inline-input" placeholder="CONFIRM" />
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button className="admin-btn" onClick={() => setSettingsImpactModal(prev => ({ ...prev, open: false }))}>Cancel</button>
                  <button className="admin-btn admin-btn-primary" disabled={settingsImpactModal.confirmText !== 'CONFIRM' || settingsSaving} onClick={confirmSaveWorkerTypeSettings}>
                    {settingsSaving ? 'Saving...' : 'Apply Changes'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── RUN PAYROLL WIZARD ─────────────────────────────────── */}
      {view === 'run_payroll' && (
        <div className="pn-wizard">
          {/* Period Banner */}
          {Object.keys(wizPeriodByType).length > 0 && wizStep >= 2 && (
            <div style={{ background: 'linear-gradient(135deg, #1a237e 0%, #283593 100%)', borderRadius: 10, padding: '14px 20px', marginBottom: 16, color: '#fff', display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                <strong style={{ fontSize: 14 }}>Pay Run</strong>
              </div>
              {Object.entries(wizPeriodByType).map(([wt, p]) => {
                const label = wt === 'employed' ? 'Employed' : wt === 'shift' ? 'Shift Workers' : 'Zero Hours'
                const colour = wt === 'employed' ? '#7986cb' : wt === 'shift' ? '#b39ddb' : '#ffb74d'
                const isEditing = wizPeriodEditType === wt
                return (
                  <div key={wt} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.12)', borderRadius: 6, padding: '4px 10px', flexWrap: 'wrap' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: colour, flexShrink: 0 }} />
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{label}</span>
                    {isEditing ? (
                      <>
                        <input type="date" value={p.start} onChange={e => {
                          setWizPeriodByType(prev => ({ ...prev, [wt]: { ...prev[wt], start: e.target.value } }))
                        }} style={{ fontSize: 11, padding: '2px 4px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.15)', color: '#fff' }} />
                        <span style={{ fontSize: 12 }}>–</span>
                        <input type="date" value={p.end} onChange={e => {
                          setWizPeriodByType(prev => ({ ...prev, [wt]: { ...prev[wt], end: e.target.value } }))
                        }} style={{ fontSize: 11, padding: '2px 4px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.15)', color: '#fff' }} />
                        <button onClick={() => { setWizPeriodEditType(null); if (wizWorkerTypes.has('shift') || wizWorkerTypes.has('zero_hours')) loadWizPeriodReviews(wizPeriodByType); loadWizTimesheets(wizPeriodByType); loadWizAdjustments(wizPeriodByType) }} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: 'rgba(255,255,255,0.25)', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Apply</button>
                        <button onClick={() => setWizPeriodEditType(null)} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: 'rgba(255,255,255,0.1)', color: '#fff', border: 'none', cursor: 'pointer', opacity: 0.7 }}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => navigateWizPeriod('prev')} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff', borderRadius: 4, padding: '2px 6px', cursor: 'pointer', fontSize: 12, fontWeight: 700, lineHeight: 1 }} title="Previous period">←</button>
                        <span style={{ fontSize: 12, fontWeight: 500 }}>{formatDate(p.start)} – {formatDate(p.end)}</span>
                        <button onClick={() => navigateWizPeriod('next')} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff', borderRadius: 4, padding: '2px 6px', cursor: 'pointer', fontSize: 12, fontWeight: 700, lineHeight: 1 }} title="Next period">→</button>
                        <button onClick={() => setWizPeriodEditType(wt)} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 500 }} title="Set custom date range">Custom</button>
                      </>
                    )}
                    <span style={{ fontSize: 10, opacity: 0.7, background: 'rgba(255,255,255,0.15)', padding: '1px 6px', borderRadius: 3 }}>{p.freqLabel}</span>
                    {p.overtimeLabel !== 'None' && (
                      <span style={{ fontSize: 10, opacity: 0.7, background: 'rgba(255,255,255,0.15)', padding: '1px 6px', borderRadius: 3 }}>{p.overtimeLabel}</span>
                    )}
                  </div>
                )
              })}
              {providerConnected && (
                <span style={{ fontSize: 11, opacity: 0.7, marginLeft: 'auto' }}>Connected to {connectedProvider === 'xero' ? 'Xero' : 'Sage'}</span>
              )}
            </div>
          )}

          {/* Progress steps */}
          <div className="pn-wizard-steps">
            {(providerConnected
              ? ['Select Workers', 'Review Adjustments', 'Push & Manual Actions', 'Processing', 'Sync Back', 'Release']
              : ['Select Workers', 'Review', 'Generate Estimates', 'Export', 'Sync & Release']
            ).map((label, i) => {
              const step = i + 1
              const isActive = wizStep === step
              const isDone = wizStep > step || wizComplete
              return (
                <div key={step} className={`pn-wizard-step ${isActive ? 'pn-wizard-step-active' : ''} ${isDone ? 'pn-wizard-step-done' : ''}`}>
                  <div className="pn-wizard-step-num">{isDone ? '✓' : step}</div>
                  <span className="pn-wizard-step-label">{label}</span>
                </div>
              )
            })}
          </div>

          {/* Step 1: Select Worker Types */}
          {wizStep === 1 && (
            <div className="admin-settings-group" style={{ marginTop: 20 }}>
              <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700 }}>Start a Pay Run</h3>
              <p style={{ fontSize: 13, color: 'var(--text-muted, #6b7280)', marginBottom: 16 }}>
                Each worker type is processed as its own independent pay run. Select one to begin.
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 20 }}>
                {employedEmployees.length > 0 && (() => {
                  const ws = workerSettings.find(s => s.worker_type === 'employed')
                  const f = ws?.pay_pattern || 'monthly'
                  const ot = ws?.overtime_handling || 'none'
                  const period = getNextPeriodForFreq(f as PayFrequency, fyStartMonth, lastPayRuns['employed'])
                  return (
                    <div className="pn-wiz-type-card" style={{ cursor: 'default' }}>
                      <div className="pn-wiz-type-icon" style={{ background: '#5c6bc0' }}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/></svg>
                      </div>
                      <strong>Employed Staff</strong>
                      <span style={{ fontSize: 12, color: 'var(--text-muted, #6b7280)' }}>{employedEmployees.length} employee{employedEmployees.length !== 1 ? 's' : ''}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted, #999)' }}>
                        {f === 'weekly' ? 'Weekly' : f === 'bi_weekly' ? 'Bi-weekly' : 'Monthly'} salary{ot !== 'none' ? ` · ${ot === 'toil' ? 'TOIL' : 'Overtime'}` : ''}
                      </span>
                      <span style={{ fontSize: 11, color: '#5c6bc0', fontWeight: 500 }}>{formatDate(period.start)} – {formatDate(period.end)}</span>
                      <button className="admin-btn admin-btn-primary" style={{ marginTop: 8, fontSize: 12, width: '100%' }}
                        onClick={() => { setWizWorkerTypes(new Set(['employed'])); setTimeout(advanceToStep2, 0) }}>
                        Start Pay Run →
                      </button>
                    </div>
                  )
                })()}
                {shiftEmployees.length > 0 && (() => {
                  const ws = workerSettings.find(s => s.worker_type === 'shift_worker')
                  const f = ws?.pay_pattern || 'weekly'
                  const ot = ws?.overtime_handling || 'none'
                  const period = getNextPeriodForFreq(f as PayFrequency, fyStartMonth, lastPayRuns['shift'])
                  return (
                    <div className="pn-wiz-type-card" style={{ cursor: 'default' }}>
                      <div className="pn-wiz-type-icon" style={{ background: '#7e57c2' }}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                      </div>
                      <strong>Shift Workers</strong>
                      <span style={{ fontSize: 12, color: 'var(--text-muted, #6b7280)' }}>{shiftEmployees.length} employee{shiftEmployees.length !== 1 ? 's' : ''}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted, #999)' }}>
                        {f === 'weekly' ? 'Weekly' : f === 'bi_weekly' ? 'Bi-weekly' : 'Monthly'} · hours × rate{ot !== 'none' ? ` · ${ot === 'toil' ? 'TOIL' : 'Overtime'}` : ''}
                      </span>
                      <span style={{ fontSize: 11, color: '#7e57c2', fontWeight: 500 }}>{formatDate(period.start)} – {formatDate(period.end)}</span>
                      <button className="admin-btn admin-btn-primary" style={{ marginTop: 8, fontSize: 12, width: '100%', background: '#7e57c2' }}
                        onClick={() => { setWizWorkerTypes(new Set(['shift'])); setTimeout(advanceToStep2, 0) }}>
                        Start Pay Run →
                      </button>
                    </div>
                  )
                })()}
                {zeroHoursEmployees.length > 0 && (() => {
                  const ws = workerSettings.find(s => s.worker_type === 'zero_hours')
                  const f = ws?.pay_pattern || 'weekly'
                  const ot = ws?.overtime_handling || 'none'
                  const period = getNextPeriodForFreq(f as PayFrequency, fyStartMonth, lastPayRuns['zero_hours'])
                  return (
                    <div className="pn-wiz-type-card" style={{ cursor: 'default' }}>
                      <div className="pn-wiz-type-icon" style={{ background: '#ef6c00' }}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                      </div>
                      <strong>Zero Hours</strong>
                      <span style={{ fontSize: 12, color: 'var(--text-muted, #6b7280)' }}>{zeroHoursEmployees.length} employee{zeroHoursEmployees.length !== 1 ? 's' : ''}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted, #999)' }}>
                        {f === 'weekly' ? 'Weekly' : f === 'bi_weekly' ? 'Bi-weekly' : 'Monthly'} · hours × rate{ot !== 'none' ? ` · ${ot === 'toil' ? 'TOIL' : 'Overtime'}` : ''}
                      </span>
                      <span style={{ fontSize: 11, color: '#ef6c00', fontWeight: 500 }}>{formatDate(period.start)} – {formatDate(period.end)}</span>
                      <button className="admin-btn admin-btn-primary" style={{ marginTop: 8, fontSize: 12, width: '100%', background: '#ef6c00' }}
                        onClick={() => { setWizWorkerTypes(new Set(['zero_hours'])); setTimeout(advanceToStep2, 0) }}>
                        Start Pay Run →
                      </button>
                    </div>
                  )
                })()}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button className="admin-btn" onClick={() => setView('dashboard')}>← Back to Dashboard</button>
              </div>
            </div>
          )}

          {/* Step 2: Review */}
          {wizStep === 2 && (() => {
            const shiftReviewsApproved = wizPeriodReviews.filter(r => r.status === 'approved' && shiftEmployees.some(e => e.id === r.employee_id))
            const shiftReviewsPending = wizPeriodReviews.filter(r => r.status !== 'approved' && shiftEmployees.some(e => e.id === r.employee_id))
            const zeroReviewsApproved = wizPeriodReviews.filter(r => r.status === 'approved' && zeroHoursEmployees.some(e => e.id === r.employee_id))
            const zeroReviewsPending = wizPeriodReviews.filter(r => r.status !== 'approved' && zeroHoursEmployees.some(e => e.id === r.employee_id))
            const shiftMissingReview = shiftEmployees.filter(e => !wizPeriodReviews.some(r => r.employee_id === e.id))
            const zeroMissingReview = zeroHoursEmployees.filter(e => !wizPeriodReviews.some(r => r.employee_id === e.id))
            const hasShiftBlocker = wizWorkerTypes.has('shift') && (shiftReviewsPending.length > 0 || shiftMissingReview.length > 0)
            const hasZeroBlocker = wizWorkerTypes.has('zero_hours') && (zeroReviewsPending.length > 0 || zeroMissingReview.length > 0)
            const canProceed = !hasShiftBlocker && !hasZeroBlocker

            const employedOvertimeHandling = employedEmployees.length > 0
              ? getEffectiveSetting(employedEmployees[0], workerSettings, 'overtime_handling')
              : 'none'
            const employedFreq = employedEmployees.length > 0
              ? getEffectiveSetting(employedEmployees[0], workerSettings, 'pay_pattern') as PayFrequency
              : 'monthly' as PayFrequency
            const periodsPerYear = getPeriodsPerYear(employedFreq)

            return (
            <div className="admin-settings-group" style={{ marginTop: 20 }}>
              <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700 }}>
                {providerConnected ? 'Review Adjustments' : 'Review Before Generating'}
              </h3>
              <p style={{ fontSize: 13, color: 'var(--text-muted, #6b7280)', marginBottom: 16 }}>
                {providerConnected
                  ? `Review the adjustments that will be pushed to ${connectedProvider === 'xero' ? 'Xero' : 'Sage'}. Your provider handles salary, tax, and NI calculations — InflowHR sends only the changes.`
                  : 'Review the employees and their pay details before generating payslips for the next period.'}
              </p>

              {wizPriorRuns.length > 0 && (
                <div style={{ background: '#e3f2fd', borderRadius: 8, padding: 12, marginBottom: 12, borderLeft: '4px solid #1565c0' }}>
                  <strong style={{ color: '#1565c0', fontSize: 13 }}>Previous pay runs found for this period</strong>
                  <div style={{ fontSize: 12, color: '#1565c0', marginTop: 4 }}>
                    {wizPriorRuns.map((r, i) => (
                      <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 2 }}>
                        <span style={{ fontSize: 11, background: r.status === 'completed' ? '#e8f5e9' : r.status === 'generating' ? '#fff3e0' : '#f3e5f5',
                          color: r.status === 'completed' ? '#2e7d32' : r.status === 'generating' ? '#e65100' : '#7e57c2',
                          padding: '1px 8px', borderRadius: 10, fontWeight: 600, textTransform: 'capitalize' }}>{r.status}</span>
                        <span>{(r.worker_types || []).map((wt: string) => wt === 'shift_worker' ? 'Shift Workers' : wt === 'zero_hours' ? 'Zero Hours' : 'Employed').join(', ')}</span>
                        {r.completed_at && <span style={{ color: '#90a4ae' }}>({formatDate(r.completed_at.split('T')[0])})</span>}
                      </div>
                    ))}
                  </div>
                  <p style={{ fontSize: 11, color: '#1976d2', margin: '6px 0 0' }}>
                    You can still run a pay run for different worker types in the same period.
                  </p>
                </div>
              )}

              {providerConnected && (
                <div style={{ background: '#e3f2fd', borderRadius: 8, padding: 14, marginBottom: 16, borderLeft: '4px solid #1565c0' }}>
                  <strong style={{ color: '#1565c0', fontSize: 14 }}>Connected to {connectedProvider === 'xero' ? 'Xero' : 'Sage'}</strong>
                  <p style={{ fontSize: 12, color: '#1565c0', margin: '4px 0 0' }}>
                    {connectedProvider === 'xero'
                      ? wizWorkerTypes.has('zero_hours') && !wizWorkerTypes.has('employed') && !wizWorkerTypes.has('shift')
                        ? 'All approved zero hours time (scheduled hours and overtime) will be pushed to Xero as timesheets. Unpaid leave, benefit changes, bonuses, and deductions must be entered manually in Xero — the wizard will list each item with full details for you to work through.'
                        : wizWorkerTypes.has('zero_hours')
                          ? 'Salaried overtime is pushed to Xero via pay template earnings. Zero hours time (scheduled hours and overtime) is pushed as timesheets. Unpaid leave, benefit changes, bonuses, and deductions must be entered manually in Xero — the wizard will list each item with full details for you to work through.'
                          : 'Overtime hours are pushed directly to Xero via pay template earnings. Unpaid leave, benefit changes, bonuses, and deductions must be entered manually in Xero — the wizard will list each item with full details for you to work through.'
                      : 'Adjustments (overtime, unpaid leave, benefit changes) are exported as a CSV file for Sage import. Bonuses and deductions must be entered manually.'
                    } TOIL hours are credited internally as lieu days. Your provider calculates tax, NI, pension, and net pay.
                  </p>
                  {connectedProvider === 'xero' && (wizWorkerTypes.has('shift') || wizWorkerTypes.has('zero_hours')) && (
                    <p style={{ fontSize: 12, color: '#e65100', margin: '8px 0 0', background: '#fff3e0', padding: '8px 10px', borderRadius: 4 }}>
                      <strong>Note:</strong> Xero distributes timesheet hours across weekdays (Mon–Fri) only. If your shift workers work weekends, the total hours pushed are correct but will appear spread across the weekday dates in the Xero pay period. You can adjust individual day entries in Xero after pushing, or download the data for manual entry.
                    </p>
                  )}
                </div>
              )}

              {wizWorkerTypes.has('employed') && employedEmployees.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <h4 style={{ margin: '0 0 8px', fontSize: 14, color: '#5c6bc0' }}>Employed Staff ({employedEmployees.length})</h4>
                  <div style={{ background: 'var(--bg-subtle, #f8f9fa)', borderRadius: 8, padding: 12 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8, marginBottom: 12 }}>
                      <div className="pn-worker-metric">
                        <span className="pn-worker-metric-value">{currencySymbol(currency)}{employedEmployees.reduce((s, e) => s + (e.annual_salary || 0), 0).toLocaleString()}</span>
                        <span className="pn-worker-metric-label">Total annual salary</span>
                      </div>
                      <div className="pn-worker-metric">
                        <span className="pn-worker-metric-value">{currencySymbol(currency)}{Math.round(employedEmployees.reduce((s, e) => s + ((e.annual_salary || 42000) / periodsPerYear), 0)).toLocaleString()}</span>
                        <span className="pn-worker-metric-label">Est. {employedFreq === 'weekly' ? 'weekly' : employedFreq === 'bi_weekly' ? 'bi-weekly' : 'monthly'} gross</span>
                      </div>
                      <div className="pn-worker-metric">
                        <span className="pn-worker-metric-value" style={{ textTransform: 'capitalize' }}>{employedFreq.replace('_', '-')}</span>
                        <span className="pn-worker-metric-label">Pay pattern</span>
                      </div>
                      <div className="pn-worker-metric">
                        <span className="pn-worker-metric-value">{employedEmployees.filter(e => !e.tax_code).length}</span>
                        <span className="pn-worker-metric-label">Missing tax codes</span>
                      </div>
                    </div>
                    {(() => {
                      const hasTimesheetData = employedEmployees.some(e => (wizTimesheetHoursByEmp[e.id] || 0) > 0)
                      const showOvertimeInputs = employedOvertimeHandling === 'overtime' || employedOvertimeHandling === 'toil'
                      if (!hasTimesheetData && !showOvertimeInputs) return null
                      return (
                        <div style={{ borderTop: '1px solid var(--border, #e5e7eb)', paddingTop: 10, marginTop: 4 }}>
                          <p style={{ fontSize: 12, fontWeight: 600, margin: '0 0 4px', color: '#5c6bc0' }}>
                            {showOvertimeInputs
                              ? (employedOvertimeHandling === 'toil' ? 'TOIL Hours (auto-calculated from timesheets, adjustable)' : 'Overtime Hours & Rates (auto-calculated, adjustable)')
                              : 'Approved Timesheet Hours'}
                          </p>
                          {employedOvertimeHandling === 'toil' && (
                            <p style={{ fontSize: 11, color: '#7e57c2', margin: '0 0 8px' }}>Hours will be credited as time off in lieu, not paid.</p>
                          )}
                          {employedOvertimeHandling === 'none' && hasTimesheetData && (
                            <p style={{ fontSize: 11, color: '#e65100', margin: '0 0 8px' }}>Overtime handling is set to "None" — hours exceeding contracted will not be paid or credited. Change this in People → Payroll Settings if overtime should be calculated.</p>
                          )}
                          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                            {employedEmployees.map(emp => {
                              const approved = wizTimesheetHoursByEmp[emp.id] || 0
                              const weeklyHrs = emp.weekly_hours || 37.5
                              const weeksInPeriod = employedFreq === 'weekly' ? 1 : employedFreq === 'bi_weekly' ? 2 : 52 / 12
                              const contracted = Math.round(weeklyHrs * weeksInPeriod * 10) / 10
                              const diff = Math.round((approved - contracted) * 10) / 10
                              if (!showOvertimeInputs && approved <= 0) return null
                              return (
                                <div key={emp.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                                  <span style={{ fontSize: 13, minWidth: 160 }}>{emp.first_name} {emp.last_name}</span>
                                  {approved > 0 && (
                                    <span style={{ fontSize: 11, color: diff > 0 ? '#e65100' : '#2e7d32', background: diff > 0 ? '#fff3e0' : '#e8f5e9', padding: '1px 6px', borderRadius: 3, fontWeight: 500 }}>
                                      {approved.toFixed(1)}h approved / {contracted}h contracted {diff > 0 ? `(+${diff}h)` : ''}
                                    </span>
                                  )}
                                  {showOvertimeInputs && (() => {
                                    const derivedRate = getDerivedHourlyRate(emp)
                                    const currentRate = wizOvertimeRates[emp.id] ?? derivedRate
                                    const mul = emp.overtime_rate_multiplier || 1.5
                                    const hrs = wizOvertimeHours[emp.id] || 0
                                    const amount = Math.round(currentRate * mul * hrs * 100) / 100
                                    const isOverridden = wizOvertimeRates[emp.id] !== undefined && Math.abs(wizOvertimeRates[emp.id] - derivedRate) > 0.001
                                    return (
                                      <>
                                        <input type="number" min="0" step="0.5" style={{ width: 70, padding: '3px 6px', fontSize: 13, borderRadius: 4, border: '1px solid var(--border, #d1d5db)' }}
                                          value={wizOvertimeHours[emp.id] || ''}
                                          onChange={e => setWizOvertimeHours(prev => ({ ...prev, [emp.id]: Number(e.target.value) || 0 }))}
                                          placeholder="0"
                                        />
                                        <span style={{ fontSize: 11, color: 'var(--text-muted, #999)' }}>hrs @</span>
                                        <span style={{ fontSize: 11, color: 'var(--text-muted, #999)' }}>{currencySymbol(currency)}</span>
                                        <input type="number" min="0" step="0.01" style={{ width: 65, padding: '3px 6px', fontSize: 13, borderRadius: 4, border: `1px solid ${isOverridden ? '#e65100' : 'var(--border, #d1d5db)'}`, background: isOverridden ? '#fff3e0' : undefined }}
                                          value={currentRate || ''}
                                          onChange={e => {
                                            const val = Number(e.target.value) || 0
                                            setWizOvertimeRates(prev => ({ ...prev, [emp.id]: val }))
                                          }}
                                          title={`Derived from ${emp.hourly_rate ? 'hourly rate' : 'annual salary ÷ (52 × weekly hours)'}`}
                                          placeholder="0.00"
                                        />
                                        <span style={{ fontSize: 11, color: 'var(--text-muted, #999)' }}>/hr × {mul}x</span>
                                        {hrs > 0 && amount > 0 && (
                                          <span style={{ fontSize: 12, fontWeight: 600, color: '#2e7d32' }}>= {currencySymbol(currency)}{amount.toFixed(2)}</span>
                                        )}
                                        {isOverridden && (
                                          <span style={{ fontSize: 10, background: '#fff3e0', color: '#e65100', padding: '1px 6px', borderRadius: 3, fontWeight: 600, cursor: 'pointer' }}
                                            title="Click to reset to derived rate"
                                            onClick={() => setWizOvertimeRates(prev => ({ ...prev, [emp.id]: derivedRate }))}>
                                            Override
                                          </span>
                                        )}
                                        {hrs > 0 && !isOverridden && (
                                          <span style={{ fontSize: 10, background: '#e8f5e9', color: '#2e7d32', padding: '1px 6px', borderRadius: 3, fontWeight: 600 }}>Auto</span>
                                        )}
                                      </>
                                    )
                                  })()}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                </div>
              )}

              {wizWorkerTypes.has('shift') && shiftEmployees.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <h4 style={{ margin: '0 0 8px', fontSize: 14, color: '#7e57c2', display: 'flex', alignItems: 'center', gap: 8 }}>
                    Shift Workers ({shiftEmployees.length})
                    {wizPeriodByType.shift && (
                      <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted, #6b7280)' }}>
                        {formatDate(wizPeriodByType.shift.start)} – {formatDate(wizPeriodByType.shift.end)} · {wizPeriodByType.shift.freqLabel}
                      </span>
                    )}
                  </h4>
                  <div style={{ background: 'var(--bg-subtle, #f8f9fa)', borderRadius: 8, padding: 12 }}>
                    <p style={{ fontSize: 12, color: 'var(--text-muted, #6b7280)', margin: '0 0 8px' }}>
                      Shift worker pay is calculated from check-in records (hours worked × hourly rate). Generate a summary to aggregate hours for this period, then review and approve before proceeding.
                    </p>

                    {/* Generate / Approve buttons */}
                    <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                      <button className="admin-btn admin-btn-primary" style={{ fontSize: 12, padding: '6px 14px' }}
                        disabled={wizGeneratingReviews}
                        onClick={() => generateHoursSummary('shift')}>
                        {wizGeneratingReviews ? 'Generating…' : shiftReviewsPending.length > 0 || shiftReviewsApproved.length > 0 ? '↻ Regenerate Hours' : '⚡ Generate Hours Summary'}
                      </button>
                      {shiftReviewsPending.length > 0 && (
                        <button className="admin-btn" style={{ fontSize: 12, padding: '6px 14px', background: '#e8f5e9', color: '#2e7d32', border: '1px solid #a5d6a7' }}
                          onClick={() => approveAllReviews('shift')}>
                          ✓ Approve All ({shiftReviewsPending.length})
                        </button>
                      )}
                    </div>

                    {/* Summary metrics */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8, marginBottom: 10 }}>
                      <div className="pn-worker-metric">
                        <span className="pn-worker-metric-value" style={{ color: '#2e7d32' }}>{shiftReviewsApproved.length}</span>
                        <span className="pn-worker-metric-label">Approved</span>
                      </div>
                      <div className="pn-worker-metric">
                        <span className="pn-worker-metric-value" style={{ color: shiftReviewsPending.length > 0 ? '#e65100' : undefined }}>{shiftReviewsPending.length}</span>
                        <span className="pn-worker-metric-label">Draft / Pending</span>
                      </div>
                      <div className="pn-worker-metric">
                        <span className="pn-worker-metric-value">{[...shiftReviewsApproved, ...shiftReviewsPending].reduce((s, r) => s + Number(r.adjusted_hours || 0), 0).toFixed(1)}</span>
                        <span className="pn-worker-metric-label">Total hours</span>
                      </div>
                      <div className="pn-worker-metric">
                        <span className="pn-worker-metric-value" style={{ color: [...shiftReviewsApproved, ...shiftReviewsPending].reduce((s, r) => s + Number(r.overtime_hours || 0), 0) > 0 ? '#c62828' : undefined }}>
                          {[...shiftReviewsApproved, ...shiftReviewsPending].reduce((s, r) => s + Number(r.overtime_hours || 0), 0).toFixed(1)}
                        </span>
                        <span className="pn-worker-metric-label">Overtime hrs</span>
                      </div>
                      <div className="pn-worker-metric">
                        <span className="pn-worker-metric-value">{currencySymbol(currency)}{[...shiftReviewsApproved, ...shiftReviewsPending].reduce((s, r) => s + Number(r.gross_pay || 0), 0).toFixed(2)}</span>
                        <span className="pn-worker-metric-label">Total gross</span>
                      </div>
                    </div>

                    {/* Inline review table */}
                    {(shiftReviewsApproved.length > 0 || shiftReviewsPending.length > 0) && (
                      <div style={{ overflowX: 'auto', marginBottom: 8 }}>
                        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ borderBottom: '2px solid var(--border, #e5e7eb)', textAlign: 'left' }}>
                              <th style={{ padding: '6px 8px', fontWeight: 600 }}>Employee</th>
                              <th style={{ padding: '6px 8px', fontWeight: 600, textAlign: 'right' }}>Total Hrs</th>
                              <th style={{ padding: '6px 8px', fontWeight: 600, textAlign: 'right' }}>Overtime</th>
                              <th style={{ padding: '6px 8px', fontWeight: 600, textAlign: 'right' }}>Rate</th>
                              <th style={{ padding: '6px 8px', fontWeight: 600, textAlign: 'right' }}>Gross Pay</th>
                              <th style={{ padding: '6px 8px', fontWeight: 600, textAlign: 'center' }}>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[...shiftReviewsApproved, ...shiftReviewsPending].map(r => {
                              const emp = shiftEmployees.find(e => e.id === r.employee_id)
                              const empShifts = wizShiftDetails[r.employee_id] || []
                              const isExpanded = wizExpandedEmps.has(r.employee_id)
                              return (
                                <React.Fragment key={r.id}>
                                <tr style={{ borderBottom: '1px solid var(--border, #f0f0f0)', cursor: empShifts.length > 0 ? 'pointer' : undefined }}
                                  onClick={() => {
                                    if (empShifts.length === 0) return
                                    setWizExpandedEmps(prev => {
                                      const next = new Set(prev)
                                      if (next.has(r.employee_id)) next.delete(r.employee_id); else next.add(r.employee_id)
                                      return next
                                    })
                                  }}>
                                  <td style={{ padding: '6px 8px' }}>
                                    {empShifts.length > 0 && <span style={{ display: 'inline-block', width: 14, fontSize: 10, color: '#7e57c2' }}>{isExpanded ? '▼' : '▶'}</span>}
                                    {emp ? `${emp.first_name} ${emp.last_name}` : 'Unknown'}
                                    {empShifts.length > 0 && <span style={{ fontSize: 10, color: 'var(--text-muted, #999)', marginLeft: 6 }}>{empShifts.length} shift{empShifts.length !== 1 ? 's' : ''}</span>}
                                  </td>
                                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                                    <input type="number" min="0" step="0.25" style={{ width: 60, padding: '2px 4px', fontSize: 12, borderRadius: 3, border: '1px solid var(--border, #d1d5db)', textAlign: 'right' }}
                                      value={Number(r.adjusted_hours) || 0}
                                      onChange={e => { e.stopPropagation(); updateReviewHours(r.id, 'adjusted_hours', Number(e.target.value)) }}
                                      onClick={e => e.stopPropagation()}
                                      disabled={r.status === 'approved'}
                                    />
                                  </td>
                                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                                    <input type="number" min="0" step="0.25" style={{ width: 60, padding: '2px 4px', fontSize: 12, borderRadius: 3, border: '1px solid var(--border, #d1d5db)', textAlign: 'right' }}
                                      value={Number(r.overtime_hours) || 0}
                                      onChange={e => { e.stopPropagation(); updateReviewHours(r.id, 'overtime_hours', Number(e.target.value)) }}
                                      onClick={e => e.stopPropagation()}
                                      disabled={r.status === 'approved'}
                                    />
                                  </td>
                                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{currencySymbol(currency)}{Number(r.hourly_rate).toFixed(2)}</td>
                                  <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600 }}>{currencySymbol(currency)}{Number(r.gross_pay).toFixed(2)}</td>
                                  <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                                    <span style={{
                                      fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
                                      background: r.status === 'approved' ? '#e8f5e9' : '#fff3e0',
                                      color: r.status === 'approved' ? '#2e7d32' : '#e65100'
                                    }}>
                                      {r.status === 'approved' ? 'Approved' : 'Draft'}
                                    </span>
                                  </td>
                                </tr>
                                {isExpanded && empShifts.length > 0 && (
                                  <tr>
                                    <td colSpan={6} style={{ padding: '0 8px 8px 28px', background: 'var(--bg-muted, #fafafa)' }}>
                                      <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                                        <thead>
                                          <tr style={{ color: 'var(--text-muted, #888)' }}>
                                            <th style={{ padding: '4px 6px', fontWeight: 500, textAlign: 'left' }}>Date</th>
                                            <th style={{ padding: '4px 6px', fontWeight: 500, textAlign: 'left' }}>Shift</th>
                                            <th style={{ padding: '4px 6px', fontWeight: 500, textAlign: 'left' }}>Scheduled</th>
                                            <th style={{ padding: '4px 6px', fontWeight: 500, textAlign: 'left' }}>Check In</th>
                                            <th style={{ padding: '4px 6px', fontWeight: 500, textAlign: 'left' }}>Check Out</th>
                                            <th style={{ padding: '4px 6px', fontWeight: 500, textAlign: 'right' }}>Hours</th>
                                            <th style={{ padding: '4px 6px', fontWeight: 500, textAlign: 'right' }}>OT</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {empShifts.map((s, si) => {
                                            const cin = new Date(s.check_in_at)
                                            const cout = s.check_out_at ? new Date(s.check_out_at) : null
                                            return (
                                              <tr key={si} style={{ borderTop: si > 0 ? '1px solid var(--border, #eee)' : undefined }}>
                                                <td style={{ padding: '3px 6px' }}>{cin.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                                                <td style={{ padding: '3px 6px', fontSize: 10, color: 'var(--text-muted, #888)' }}>{s.shift_name || '—'}</td>
                                                <td style={{ padding: '3px 6px', fontSize: 10 }}>{s.scheduled_start && s.scheduled_end ? `${s.scheduled_start.slice(0,5)}–${s.scheduled_end.slice(0,5)}` : '—'}</td>
                                                <td style={{ padding: '3px 6px' }}>{cin.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</td>
                                                <td style={{ padding: '3px 6px' }}>{cout ? cout.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                                                <td style={{ padding: '3px 6px', textAlign: 'right', fontWeight: 500 }}>{s.hours.toFixed(2)}</td>
                                                <td style={{ padding: '3px 6px', textAlign: 'right', fontWeight: 500, color: (s.overtime_hours || 0) > 0 ? '#c62828' : undefined }}>{(s.overtime_hours || 0) > 0 ? `+${s.overtime_hours!.toFixed(2)}` : '—'}</td>
                                              </tr>
                                            )
                                          })}
                                        </tbody>
                                      </table>
                                    </td>
                                  </tr>
                                )}
                                </React.Fragment>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Missing employees warning */}
                    {shiftMissingReview.length > 0 && (
                      <div style={{ background: '#fff3e0', borderRadius: 6, padding: 10, fontSize: 12 }}>
                        <strong style={{ color: '#e65100' }}>{shiftMissingReview.length} employee(s) with no hours</strong>
                        <p style={{ margin: '4px 0 0', color: '#bf360c' }}>
                          {shiftMissingReview.map(e => `${e.first_name} ${e.last_name}`).join(', ')} — no check-in records found for this period. Click "Generate Hours Summary" to create entries, or check their shifts are logged.
                        </p>
                      </div>
                    )}

                    {hasShiftBlocker && !shiftMissingReview.length && (
                      <div style={{ background: '#fff3e0', borderRadius: 6, padding: 10, fontSize: 12 }}>
                        <strong style={{ color: '#e65100' }}>Hours not yet approved</strong>
                        <p style={{ margin: '4px 0 0', color: '#bf360c' }}>
                          {shiftReviewsPending.length} employee(s) have draft hours. Review the table above, adjust if needed, then click "Approve All" to proceed.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {wizWorkerTypes.has('zero_hours') && zeroHoursEmployees.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <h4 style={{ margin: '0 0 8px', fontSize: 14, color: '#ef6c00', display: 'flex', alignItems: 'center', gap: 8 }}>
                    Zero Hours Workers ({zeroHoursEmployees.length})
                    {wizPeriodByType.zero_hours && (
                      <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted, #6b7280)' }}>
                        {formatDate(wizPeriodByType.zero_hours.start)} – {formatDate(wizPeriodByType.zero_hours.end)} · {wizPeriodByType.zero_hours.freqLabel}
                      </span>
                    )}
                  </h4>
                  <div style={{ background: 'var(--bg-subtle, #f8f9fa)', borderRadius: 8, padding: 12 }}>
                    <p style={{ fontSize: 12, color: 'var(--text-muted, #6b7280)', margin: '0 0 8px' }}>
                      Zero hours pay is based entirely on hours actually worked, calculated from check-in records. Generate a summary then review and approve.
                    </p>

                    {/* Generate / Approve buttons */}
                    <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                      <button className="admin-btn admin-btn-primary" style={{ fontSize: 12, padding: '6px 14px' }}
                        disabled={wizGeneratingReviews}
                        onClick={() => generateHoursSummary('zero_hours')}>
                        {wizGeneratingReviews ? 'Generating…' : zeroReviewsPending.length > 0 || zeroReviewsApproved.length > 0 ? '↻ Regenerate Hours' : '⚡ Generate Hours Summary'}
                      </button>
                      {zeroReviewsPending.length > 0 && (
                        <button className="admin-btn" style={{ fontSize: 12, padding: '6px 14px', background: '#e8f5e9', color: '#2e7d32', border: '1px solid #a5d6a7' }}
                          onClick={() => approveAllReviews('zero_hours')}>
                          ✓ Approve All ({zeroReviewsPending.length})
                        </button>
                      )}
                      {zeroReviewsPending.length > 0 && (() => {
                        const matchCount = countMatchedZeroHoursShifts()
                        return matchCount > 0 ? (
                          <button className="admin-btn" style={{ fontSize: 12, padding: '6px 14px', background: '#e3f2fd', color: '#1565c0', border: '1px solid #90caf9' }}
                            onClick={approveMatchedShifts}>
                            ✓ Approve Matched ({matchCount} shift{matchCount !== 1 ? 's' : ''})
                          </button>
                        ) : null
                      })()}
                    </div>

                    {/* Summary metrics */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8, marginBottom: 10 }}>
                      <div className="pn-worker-metric">
                        <span className="pn-worker-metric-value" style={{ color: '#2e7d32' }}>{zeroReviewsApproved.length}</span>
                        <span className="pn-worker-metric-label">Approved</span>
                      </div>
                      <div className="pn-worker-metric">
                        <span className="pn-worker-metric-value" style={{ color: zeroReviewsPending.length > 0 ? '#e65100' : undefined }}>{zeroReviewsPending.length}</span>
                        <span className="pn-worker-metric-label">Draft / Pending</span>
                      </div>
                      <div className="pn-worker-metric">
                        <span className="pn-worker-metric-value">{[...zeroReviewsApproved, ...zeroReviewsPending].reduce((s, r) => s + Number(r.adjusted_hours || 0), 0).toFixed(1)}</span>
                        <span className="pn-worker-metric-label">Total hours</span>
                      </div>
                      <div className="pn-worker-metric">
                        <span className="pn-worker-metric-value" style={{ color: [...zeroReviewsApproved, ...zeroReviewsPending].reduce((s, r) => s + Number(r.overtime_hours || 0), 0) > 0 ? '#c62828' : undefined }}>
                          {[...zeroReviewsApproved, ...zeroReviewsPending].reduce((s, r) => s + Number(r.overtime_hours || 0), 0).toFixed(1)}
                        </span>
                        <span className="pn-worker-metric-label">Overtime hrs</span>
                      </div>
                      <div className="pn-worker-metric">
                        <span className="pn-worker-metric-value">{currencySymbol(currency)}{[...zeroReviewsApproved, ...zeroReviewsPending].reduce((s, r) => s + Number(r.gross_pay || 0), 0).toFixed(2)}</span>
                        <span className="pn-worker-metric-label">Total gross</span>
                      </div>
                    </div>

                    {/* Inline review table */}
                    {(zeroReviewsApproved.length > 0 || zeroReviewsPending.length > 0) && (
                      <div style={{ overflowX: 'auto', marginBottom: 8 }}>
                        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ borderBottom: '2px solid var(--border, #e5e7eb)', textAlign: 'left' }}>
                              <th style={{ padding: '6px 8px', fontWeight: 600 }}>Employee</th>
                              <th style={{ padding: '6px 8px', fontWeight: 600, textAlign: 'right' }}>Total Hrs</th>
                              <th style={{ padding: '6px 8px', fontWeight: 600, textAlign: 'right' }}>Overtime</th>
                              <th style={{ padding: '6px 8px', fontWeight: 600, textAlign: 'right' }}>Rate</th>
                              <th style={{ padding: '6px 8px', fontWeight: 600, textAlign: 'right' }}>Gross Pay</th>
                              <th style={{ padding: '6px 8px', fontWeight: 600, textAlign: 'center' }}>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[...zeroReviewsApproved, ...zeroReviewsPending].map(r => {
                              const emp = zeroHoursEmployees.find(e => e.id === r.employee_id)
                              const empShifts = wizShiftDetails[r.employee_id] || []
                              const isExpanded = wizExpandedEmps.has(r.employee_id)
                              return (
                                <React.Fragment key={r.id}>
                                <tr style={{ borderBottom: '1px solid var(--border, #f0f0f0)', cursor: empShifts.length > 0 ? 'pointer' : undefined }}
                                  onClick={() => {
                                    if (empShifts.length === 0) return
                                    setWizExpandedEmps(prev => {
                                      const next = new Set(prev)
                                      if (next.has(r.employee_id)) next.delete(r.employee_id); else next.add(r.employee_id)
                                      return next
                                    })
                                  }}>
                                  <td style={{ padding: '6px 8px' }}>
                                    {empShifts.length > 0 && <span style={{ display: 'inline-block', width: 14, fontSize: 10, color: '#ef6c00' }}>{isExpanded ? '▼' : '▶'}</span>}
                                    {emp ? `${emp.first_name} ${emp.last_name}` : 'Unknown'}
                                    {empShifts.length > 0 && <span style={{ fontSize: 10, color: 'var(--text-muted, #999)', marginLeft: 6 }}>{empShifts.length} shift{empShifts.length !== 1 ? 's' : ''}</span>}
                                  </td>
                                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                                    <input type="number" min="0" step="0.25" style={{ width: 60, padding: '2px 4px', fontSize: 12, borderRadius: 3, border: '1px solid var(--border, #d1d5db)', textAlign: 'right' }}
                                      value={Number(r.adjusted_hours) || 0}
                                      onChange={e => { e.stopPropagation(); updateReviewHours(r.id, 'adjusted_hours', Number(e.target.value)) }}
                                      onClick={e => e.stopPropagation()}
                                      disabled={r.status === 'approved'}
                                    />
                                  </td>
                                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                                    <input type="number" min="0" step="0.25" style={{ width: 60, padding: '2px 4px', fontSize: 12, borderRadius: 3, border: '1px solid var(--border, #d1d5db)', textAlign: 'right' }}
                                      value={Number(r.overtime_hours) || 0}
                                      onChange={e => { e.stopPropagation(); updateReviewHours(r.id, 'overtime_hours', Number(e.target.value)) }}
                                      onClick={e => e.stopPropagation()}
                                      disabled={r.status === 'approved'}
                                    />
                                  </td>
                                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{currencySymbol(currency)}{Number(r.hourly_rate).toFixed(2)}</td>
                                  <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600 }}>{currencySymbol(currency)}{Number(r.gross_pay).toFixed(2)}</td>
                                  <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                                    <span style={{
                                      fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
                                      background: r.status === 'approved' ? '#e8f5e9' : '#fff3e0',
                                      color: r.status === 'approved' ? '#2e7d32' : '#e65100'
                                    }}>
                                      {r.status === 'approved' ? 'Approved' : 'Draft'}
                                    </span>
                                  </td>
                                </tr>
                                {isExpanded && empShifts.length > 0 && (
                                  <tr>
                                    <td colSpan={6} style={{ padding: '0 8px 8px 28px', background: 'var(--bg-muted, #fafafa)' }}>
                                      <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                                        <thead>
                                          <tr style={{ color: 'var(--text-muted, #888)' }}>
                                            <th style={{ padding: '4px 6px', fontWeight: 500, textAlign: 'left' }}>Date</th>
                                            <th style={{ padding: '4px 6px', fontWeight: 500, textAlign: 'left' }}>Shift</th>
                                            <th style={{ padding: '4px 6px', fontWeight: 500, textAlign: 'left' }}>Scheduled</th>
                                            <th style={{ padding: '4px 6px', fontWeight: 500, textAlign: 'left' }}>Check In</th>
                                            <th style={{ padding: '4px 6px', fontWeight: 500, textAlign: 'left' }}>Check Out</th>
                                            <th style={{ padding: '4px 6px', fontWeight: 500, textAlign: 'right' }}>Hours</th>
                                            <th style={{ padding: '4px 6px', fontWeight: 500, textAlign: 'right' }}>OT</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {empShifts.map((s, si) => {
                                            const cin = new Date(s.check_in_at)
                                            const cout = s.check_out_at ? new Date(s.check_out_at) : null
                                            return (
                                              <tr key={si} style={{ borderTop: si > 0 ? '1px solid var(--border, #eee)' : undefined }}>
                                                <td style={{ padding: '3px 6px' }}>{cin.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                                                <td style={{ padding: '3px 6px', fontSize: 10, color: 'var(--text-muted, #888)' }}>{s.shift_name || '—'}</td>
                                                <td style={{ padding: '3px 6px', fontSize: 10 }}>{s.scheduled_start && s.scheduled_end ? `${s.scheduled_start.slice(0,5)}–${s.scheduled_end.slice(0,5)}` : '—'}</td>
                                                <td style={{ padding: '3px 6px' }}>{cin.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</td>
                                                <td style={{ padding: '3px 6px' }}>{cout ? cout.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                                                <td style={{ padding: '3px 6px', textAlign: 'right', fontWeight: 500 }}>{s.hours.toFixed(2)}</td>
                                                <td style={{ padding: '3px 6px', textAlign: 'right', fontWeight: 500, color: (s.overtime_hours || 0) > 0 ? '#c62828' : undefined }}>{(s.overtime_hours || 0) > 0 ? `+${s.overtime_hours!.toFixed(2)}` : '—'}</td>
                                              </tr>
                                            )
                                          })}
                                        </tbody>
                                      </table>
                                    </td>
                                  </tr>
                                )}
                                </React.Fragment>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Missing employees warning */}
                    {zeroMissingReview.length > 0 && (
                      <div style={{ background: '#fff3e0', borderRadius: 6, padding: 10, fontSize: 12 }}>
                        <strong style={{ color: '#e65100' }}>{zeroMissingReview.length} employee(s) with no hours</strong>
                        <p style={{ margin: '4px 0 0', color: '#bf360c' }}>
                          {zeroMissingReview.map(e => `${e.first_name} ${e.last_name}`).join(', ')} — no check-in records found for this period. Click "Generate Hours Summary" to create entries, or check their shifts are logged.
                        </p>
                      </div>
                    )}

                    {hasZeroBlocker && !zeroMissingReview.length && (
                      <div style={{ background: '#fff3e0', borderRadius: 6, padding: 10, fontSize: 12 }}>
                        <strong style={{ color: '#e65100' }}>Hours not yet approved</strong>
                        <p style={{ margin: '4px 0 0', color: '#bf360c' }}>
                          {zeroReviewsPending.length} employee(s) have draft hours. Review the table above, adjust if needed, then click "Approve All" to proceed.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Bonuses & Deductions */}
              {wizBonusEntries.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <h4 style={{ margin: '0 0 8px', fontSize: 14, color: '#ef6c00' }}>
                    Bonuses &amp; Deductions ({wizBonusEntries.length})
                  </h4>
                  <div style={{ background: 'var(--bg-subtle, #f8f9fa)', borderRadius: 8, padding: 12 }}>
                    <p style={{ fontSize: 12, color: 'var(--text-muted, #6b7280)', margin: '0 0 8px' }}>
                      Recurring bonuses from employee profiles. You can adjust amounts or remove entries before proceeding.
                    </p>
                    <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                      {wizBonusEntries.map((entry, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, padding: '4px 0', borderBottom: '1px solid var(--border, #eee)' }}>
                          <span style={{ fontSize: 13, minWidth: 140, fontWeight: 500 }}>{entry.employee_name}</span>
                          <span className="pn-badge" style={{
                            background: entry.type === 'bonus' ? '#e8f5e9' : '#fbe9e7',
                            color: entry.type === 'bonus' ? '#2e7d32' : '#c62828',
                            fontSize: 10, padding: '1px 6px'
                          }}>
                            {entry.type === 'bonus' ? 'Bonus' : 'Deduction'}
                          </span>
                          <span style={{ fontSize: 12, color: 'var(--text-muted, #6b7280)', flex: 1 }}>{entry.description}</span>
                          <input type="number" step="0.01" min="0"
                            style={{ width: 80, padding: '3px 6px', fontSize: 13, borderRadius: 4, border: '1px solid var(--border, #d1d5db)', textAlign: 'right' }}
                            value={entry.amount}
                            onChange={e => {
                              const updated = [...wizBonusEntries]
                              updated[i] = { ...updated[i], amount: Number(e.target.value) || 0 }
                              setWizBonusEntries(updated)
                            }}
                          />
                          <button className="admin-btn" style={{ fontSize: 11, padding: '2px 6px', color: '#c62828' }}
                            onClick={() => setWizBonusEntries(prev => prev.filter((_, j) => j !== i))}>
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border, #e5e7eb)' }}>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>
                        Total: {currencySymbol(currency)}{wizBonusEntries.filter(e => e.type === 'bonus').reduce((s, e) => s + e.amount, 0).toFixed(2)} bonuses
                        {wizBonusEntries.some(e => e.type === 'deduction') && `, ${currencySymbol(currency)}${wizBonusEntries.filter(e => e.type === 'deduction').reduce((s, e) => s + e.amount, 0).toFixed(2)} deductions`}
                      </span>
                      <details style={{ display: 'inline' }}>
                        <summary className="admin-btn" style={{ fontSize: 12, cursor: 'pointer', display: 'inline-block' }}>+ Add One-Off</summary>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6, alignItems: 'flex-end' }}>
                          <select id="bonus-emp-select" style={{ padding: '4px 6px', fontSize: 12, borderRadius: 4, border: '1px solid var(--border, #d1d5db)' }}>
                            <option value="">Select employee…</option>
                            {employees.map(e => <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>)}
                          </select>
                          <select id="bonus-type-select" style={{ padding: '4px 6px', fontSize: 12, borderRadius: 4, border: '1px solid var(--border, #d1d5db)', width: 90 }}>
                            <option value="bonus">Bonus</option>
                            <option value="deduction">Deduction</option>
                          </select>
                          <input id="bonus-desc-input" placeholder="Description" style={{ padding: '4px 6px', fontSize: 12, borderRadius: 4, border: '1px solid var(--border, #d1d5db)', width: 140 }} />
                          <input id="bonus-amt-input" type="number" step="0.01" min="0" placeholder={`${currencySymbol(currency)} Amount`} style={{ padding: '4px 6px', fontSize: 12, borderRadius: 4, border: '1px solid var(--border, #d1d5db)', width: 80 }} />
                          <button className="admin-btn admin-btn-primary" style={{ fontSize: 11, padding: '4px 10px' }}
                            onClick={() => {
                              const sel = document.getElementById('bonus-emp-select') as HTMLSelectElement
                              const empId = sel?.value
                              const emp = employees.find(e => e.id === empId)
                              if (!emp) return
                              const desc = (document.getElementById('bonus-desc-input') as HTMLInputElement)?.value
                              const amt = Number((document.getElementById('bonus-amt-input') as HTMLInputElement)?.value)
                              const bonusType = (document.getElementById('bonus-type-select') as HTMLSelectElement)?.value as 'bonus' | 'deduction'
                              if (!desc || !amt || amt <= 0) return
                              setWizBonusEntries(prev => [...prev, {
                                employee_id: emp.id,
                                employee_name: `${emp.first_name} ${emp.last_name}`,
                                amount: amt,
                                description: desc,
                                type: bonusType,
                              }])
                              if (sel) sel.value = ''
                              const descInput = document.getElementById('bonus-desc-input') as HTMLInputElement
                              const amtInput = document.getElementById('bonus-amt-input') as HTMLInputElement
                              if (descInput) descInput.value = ''
                              if (amtInput) amtInput.value = ''
                            }}>
                            Add
                          </button>
                        </div>
                      </details>
                    </div>
                  </div>
                </div>
              )}

              {providerConnected && (
                <div style={{ marginBottom: 16 }}>
                  <h4 style={{ margin: '0 0 8px', fontSize: 14, color: '#1565c0' }}>Adjustments Summary</h4>
                  <div style={{ background: 'var(--bg-subtle, #f8f9fa)', borderRadius: 8, padding: 12 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8, marginBottom: 12 }}>
                      <div className="pn-worker-metric">
                        <span className="pn-worker-metric-value">{Object.values(allOvertimeHours).filter(h => h > 0).length}</span>
                        <span className="pn-worker-metric-label">Employees with overtime</span>
                      </div>
                      <div className="pn-worker-metric">
                        <span className="pn-worker-metric-value">{Object.values(allOvertimeHours).reduce((s, h) => s + h, 0).toFixed(1)}h</span>
                        <span className="pn-worker-metric-label">Total overtime hours</span>
                      </div>
                      <div className="pn-worker-metric">
                        <span className="pn-worker-metric-value">{wizUnpaidLeave.length}</span>
                        <span className="pn-worker-metric-label">Unpaid leave deductions</span>
                      </div>
                      {wizSickLeave.length > 0 && (
                        <div className="pn-worker-metric">
                          <span className="pn-worker-metric-value">{wizSickLeave.length}</span>
                          <span className="pn-worker-metric-label">Sick leave adjustments</span>
                        </div>
                      )}
                      <div className="pn-worker-metric">
                        <span className="pn-worker-metric-value">{wizBenefitChanges.length}</span>
                        <span className="pn-worker-metric-label">Benefit changes</span>
                      </div>
                    </div>

                    {wizUnpaidLeave.length > 0 && (
                      <div style={{ borderTop: '1px solid var(--border, #e5e7eb)', paddingTop: 8, marginTop: 4, marginBottom: 8 }}>
                        <p style={{ fontSize: 12, fontWeight: 600, margin: '0 0 4px', color: '#e65100' }}>Unpaid Leave Deductions</p>
                        {wizUnpaidLeave.map((u, i) => (
                          <div key={i} style={{ fontSize: 12, color: 'var(--text-muted, #6b7280)', marginBottom: 2 }}>
                            {u.employee_name}: {u.days} day{u.days !== 1 ? 's' : ''}
                          </div>
                        ))}
                      </div>
                    )}

                    {wizBenefitChanges.length > 0 && (
                      <div style={{ borderTop: '1px solid var(--border, #e5e7eb)', paddingTop: 8, marginTop: 4 }}>
                        <p style={{ fontSize: 12, fontWeight: 600, margin: '0 0 4px', color: '#7e57c2' }}>Benefit Enrolment Changes</p>
                        {wizBenefitChanges.map((b, i) => (
                          <div key={i} style={{ fontSize: 12, color: 'var(--text-muted, #6b7280)', marginBottom: 2 }}>
                            {b.employee_name}: {b.action} — {b.benefit} ({currencySymbol(currency)}{b.monthly_cost}/mo)
                          </div>
                        ))}
                      </div>
                    )}

                    {wizSickLeave.length > 0 && (
                      <div style={{ borderTop: '1px solid var(--border, #e5e7eb)', paddingTop: 8, marginTop: 4, marginBottom: 8 }}>
                        <p style={{ fontSize: 12, fontWeight: 600, margin: '0 0 4px', color: '#c62828' }}>Sick Leave Adjustments</p>
                        {wizSickLeave.map((s, i) => {
                          const typeLabel = s.sick_pay_status === 'csp_full' ? 'CSP (Full Pay — no deduction)' : s.sick_pay_status === 'csp_half' ? 'CSP (Half Pay)' : s.sick_pay_status === 'ssp' ? 'SSP' : 'Unpaid Sick Leave'
                          return (
                            <div key={i} style={{ fontSize: 12, color: 'var(--text-muted, #6b7280)', marginBottom: 2 }}>
                              {s.employee_name}: {s.days} day{s.days !== 1 ? 's' : ''} — {typeLabel}
                              {s.deduction > 0 && ` (deduction: ${currencySymbol(currency)}${s.deduction.toFixed(2)})`}
                              {s.ssp_added > 0 && ` + SSP: ${currencySymbol(currency)}${s.ssp_added.toFixed(2)}`}
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {Object.values(allOvertimeHours).every(h => h === 0) && wizUnpaidLeave.length === 0 && wizBenefitChanges.length === 0 && wizSickLeave.length === 0 && (
                      <p style={{ fontSize: 12, color: '#558b2f', margin: 0, fontStyle: 'italic' }}>
                        No adjustments detected — a clean pay run. You can skip the push step and go straight to syncing payslips from your provider.
                      </p>
                    )}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
                <button className="admin-btn" style={{ marginRight: 'auto', color: '#c62828' }} onClick={wizCancelPayRun}>Cancel Pay Run</button>
                <button className="admin-btn" onClick={() => setWizStep(1)}>← Back</button>
                <button className="admin-btn admin-btn-primary" disabled={!canProceed} onClick={async () => {
                  const overrides = Object.entries(wizOvertimeRates).filter(([empId, rate]) => {
                    const emp = employees.find(e => e.id === empId)
                    if (!emp) return false
                    const derived = getDerivedHourlyRate(emp)
                    return Math.abs(rate - derived) > 0.001
                  })
                  if (overrides.length > 0 && selectedCompanyId && session) {
                    const details = overrides.map(([empId, rate]) => {
                      const emp = employees.find(e => e.id === empId)
                      const derived = getDerivedHourlyRate(emp!)
                      return `${emp!.first_name} ${emp!.last_name}: ${currencySymbol(currency)}${derived.toFixed(2)} → ${currencySymbol(currency)}${rate.toFixed(2)}/hr`
                    }).join('; ')
                    await supabase.from('payroll_audit_log').insert({
                      company_id: selectedCompanyId,
                      user_id: session.user.id,
                      action: 'Overtime Rate Override',
                      detail: `Admin overrode overtime hourly rates for ${overrides.length} employee(s): ${details}`,
                      status: 'success',
                    })
                  }
                  setWizStep(3)
                }}>
                  {providerConnected ? 'Next: Push to Provider →' : 'Next: Generate Payslips →'}
                </button>
              </div>
            </div>
            )
          })()}

          {/* Step 3: Generate / Push */}
          {wizStep === 3 && (
            <div className="admin-settings-group" style={{ marginTop: 20 }}>
              <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700 }}>
                {providerConnected
                  ? connectedProvider === 'xero' ? 'Push to Xero' : 'Export to Sage'
                  : 'Generate Estimate Payslips'}
              </h3>

              {providerConnected ? (
                !wizGenerated ? (
                  <>
                    <p style={{ fontSize: 13, color: 'var(--text-muted, #6b7280)', marginBottom: 16 }}>
                      {connectedProvider === 'xero'
                        ? 'Overtime hours will be pushed directly to Xero via the Timesheets API. Unpaid leave and benefit changes will be listed for you to enter manually in Xero.'
                        : 'This will export adjustment lines as a CSV file for Sage import.'
                      } TOIL hours are credited as lieu days internally and are not sent to the provider.
                    </p>
                    <div style={{ background: 'var(--bg-subtle, #f8f9fa)', borderRadius: 8, padding: 16, marginBottom: 16 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
                        <div className="pn-worker-metric">
                          <span className="pn-worker-metric-value">{(() => {
                            return Object.entries(allOvertimeHours).filter(([empId, hrs]) => {
                              const emp = employees.find(e => e.id === empId)
                              return emp && hrs > 0 && getEffectiveSetting(emp, workerSettings, 'overtime_handling') !== 'toil'
                            }).length
                          })()}</span>
                          <span className="pn-worker-metric-label">{connectedProvider === 'xero' ? 'Timesheets to push' : 'Overtime entries'}</span>
                        </div>
                        <div className="pn-worker-metric">
                          <span className="pn-worker-metric-value">{wizUnpaidLeave.length + wizBenefitChanges.length + wizSickLeave.length}</span>
                          <span className="pn-worker-metric-label">{connectedProvider === 'xero' ? 'Manual items' : 'Other adjustments'}</span>
                        </div>
                        <div className="pn-worker-metric">
                          <span className="pn-worker-metric-value" style={{ textTransform: 'capitalize' }}>{connectedProvider}</span>
                          <span className="pn-worker-metric-label">Provider</span>
                        </div>
                        <div className="pn-worker-metric">
                          <span className="pn-worker-metric-value">
                            {(() => {
                              const firstPeriod = Object.values(wizPeriodByType)[0]
                              if (firstPeriod) {
                                const d = new Date(firstPeriod.start + 'T00:00:00')
                                return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`
                              }
                              const d = new Date(now.getFullYear(), now.getMonth(), 1)
                              return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`
                            })()}
                          </span>
                          <span className="pn-worker-metric-label">Target period</span>
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                      <button className="admin-btn" style={{ marginRight: 'auto', color: '#c62828' }} onClick={wizCancelPayRun}>Cancel Pay Run</button>
                      <button className="admin-btn" onClick={() => setWizStep(2)}>← Back</button>
                      {(() => {
                        const otCount = Object.entries(allOvertimeHours).filter(([empId, hrs]) => {
                          const emp = employees.find(e => e.id === empId)
                          return emp && hrs > 0 && getEffectiveSetting(emp, workerSettings, 'overtime_handling') !== 'toil'
                        }).length
                        const toilCount = Object.entries(allOvertimeHours).filter(([empId, hrs]) => {
                          const emp = employees.find(e => e.id === empId)
                          return emp && hrs > 0 && getEffectiveSetting(emp, workerSettings, 'overtime_handling') === 'toil'
                        }).length
                        // Count zero hours workers with approved regular hours to push
                        const zhRegularCount = wizWorkerTypes.has('zero_hours') ? wizPeriodReviews.filter(r => {
                          if (r.status !== 'approved') return false
                          const emp = employees.find(e => e.id === r.employee_id)
                          return emp && emp.contract_type === 'Zero hours shift worker' && Number(r.adjusted_hours ?? r.total_hours ?? 0) > 0
                        }).length : 0
                        const pushCount = otCount + zhRegularCount
                        const manualCount = wizUnpaidLeave.length + wizBenefitChanges.length + wizBonusEntries.length + wizSickLeave.length
                        const totalCount = pushCount + manualCount + toilCount
                        return totalCount === 0 ? (
                          <button className="admin-btn admin-btn-primary" onClick={() => setWizStep(providerConnected ? 5 : 4)}>
                            Skip to {providerConnected ? 'Sync Back' : 'Export'} →
                          </button>
                        ) : (
                          <button className="admin-btn admin-btn-primary" disabled={wizGenerating} onClick={wizPushAdjustments}>
                            {wizGenerating
                              ? (connectedProvider === 'xero' ? 'Pushing to Xero…' : 'Exporting…')
                              : connectedProvider === 'xero'
                                ? pushCount > 0 ? `Push ${pushCount} Timesheet${pushCount !== 1 ? 's' : ''} to Xero` : manualCount > 0 ? 'Process Adjustments' : 'Credit TOIL Lieu Days'
                                : pushCount > 0 || manualCount > 0 ? 'Export Adjustments CSV' : 'Credit TOIL Lieu Days'
                            }
                          </button>
                        )
                      })()}
                    </div>
                  </>
                ) : wizPushResult?.api === 'xero' ? (
                  <>
                    {/* Xero push results */}
                    <div style={{ background: (wizPushResult.pushed || 0) > 0 ? '#e8f5e9' : (wizPushResult.failed || 0) > 0 ? '#ffebee' : '#fff3e0', borderRadius: 8, padding: 16, marginBottom: 16, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={(wizPushResult.pushed || 0) > 0 ? '#2e7d32' : '#e65100'} strokeWidth="2" style={{ flexShrink: 0, marginTop: 2 }}>
                        {(wizPushResult.pushed || 0) > 0
                          ? <><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></>
                          : <><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></>
                        }
                      </svg>
                      <div style={{ flex: 1 }}>
                        <strong style={{ color: (wizPushResult.pushed || 0) > 0 ? '#2e7d32' : '#e65100' }}>
                          {(wizPushResult.pushed || 0) > 0
                            ? `${wizPushResult.pushed} timesheet${wizPushResult.pushed !== 1 ? 's' : ''} pushed to Xero`
                            : (wizPushResult.failed || 0) > 0 ? 'Push failed — check errors below' : 'No hours to push'}
                        </strong>
                        <p style={{ fontSize: 12, margin: '4px 0 0', color: 'var(--text-muted, #6b7280)' }}>
                          {(wizPushResult.pushed || 0) > 0
                            ? 'Hours have been pushed as timesheet lines in Xero. Review them in Xero before processing the pay run.'
                            : (wizPushResult.manual_items?.length || 0) > 0 ? 'Check the manual action items below.' : 'No adjustments for this period.'}
                        </p>
                      </div>
                    </div>

                    {/* Auto-pushed results */}
                    {wizPushResult.timesheet_results && wizPushResult.timesheet_results.length > 0 && (
                      <div style={{ marginBottom: 16 }}>
                        <h4 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600, color: '#1565c0', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1565c0" strokeWidth="2"><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></svg>
                          Auto-pushed to Xero
                        </h4>
                        <div style={{ background: 'var(--bg-subtle, #f8f9fa)', borderRadius: 8, overflow: 'hidden' }}>
                          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                            <thead>
                              <tr style={{ background: 'var(--bg-muted, #f0f1f3)', textAlign: 'left' }}>
                                <th style={{ padding: '8px 12px', fontWeight: 600 }}>Employee</th>
                                <th style={{ padding: '8px 12px', fontWeight: 600 }}>Regular Hrs</th>
                                <th style={{ padding: '8px 12px', fontWeight: 600 }}>Overtime</th>
                                <th style={{ padding: '8px 12px', fontWeight: 600 }}>Rate</th>
                                <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'right' }}>Amount</th>
                                <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'center' }}>Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {wizPushResult.timesheet_results.map((r: any, i: number) => (
                                <tr key={i} style={{ borderTop: '1px solid var(--border, #e5e7eb)' }}>
                                  <td style={{ padding: '8px 12px', fontWeight: 500 }}>{r.employee}</td>
                                  <td style={{ padding: '8px 12px' }}>{r.regular_hours ? `${r.regular_hours}h` : '—'}</td>
                                  <td style={{ padding: '8px 12px' }}>{r.hours > 0 ? `${r.hours}h × ${r.multiplier}x` : '—'}</td>
                                  <td style={{ padding: '8px 12px' }}>{currencySymbol(currency)}{(r.rate || 0).toFixed(2)}/hr</td>
                                  <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>{currencySymbol(currency)}{((r.regular_amount || 0) + (r.amount || 0)).toFixed(2)}</td>
                                  <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                                    {r.status === 'pushed' ? (
                                      <span style={{ fontSize: 11, background: '#e8f5e9', color: '#2e7d32', padding: '2px 10px', borderRadius: 10, fontWeight: 600 }}>Pushed</span>
                                    ) : (
                                      <div>
                                        <span style={{ fontSize: 11, background: '#ffebee', color: '#c62828', padding: '2px 10px', borderRadius: 10, fontWeight: 600 }}>Failed</span>
                                        {r.error && <div style={{ fontSize: 11, color: '#c62828', marginTop: 4, wordBreak: 'break-word' }}>{r.error}</div>}
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                            {wizPushResult.timesheet_results.filter((r: any) => r.status === 'pushed').length > 0 && (
                              <tfoot>
                                <tr style={{ borderTop: '2px solid var(--border, #d1d5db)', background: 'var(--bg-muted, #f0f1f3)' }}>
                                  <td colSpan={4} style={{ padding: '8px 12px', fontWeight: 700 }}>Total pushed</td>
                                  <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700 }}>
                                    {currencySymbol(currency)}{wizPushResult.timesheet_results.filter((r: any) => r.status === 'pushed').reduce((s: number, r: any) => s + (r.regular_amount || 0) + (r.amount || 0), 0).toFixed(2)}
                                  </td>
                                  <td />
                                </tr>
                              </tfoot>
                            )}
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Skipped employees */}
                    {wizPushResult.skipped_details && wizPushResult.skipped_details.length > 0 && (
                      <div style={{ background: '#fff8e1', borderRadius: 8, padding: 14, marginBottom: 16, borderLeft: '4px solid #ffa000' }}>
                        <strong style={{ color: '#e65100', fontSize: 13 }}>Skipped ({wizPushResult.skipped_details.length})</strong>
                        <ul style={{ fontSize: 12, color: '#bf360c', margin: '6px 0 0', paddingLeft: 20 }}>
                          {wizPushResult.skipped_details.map((s: any, i: number) => (
                            <li key={i}><strong>{s.employee}</strong>: {s.reason}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Manual action checklist for Xero */}
                    {wizPushResult.manual_items && wizPushResult.manual_items.length > 0 && (() => {
                      const allManualIds = wizPushResult.manual_items.map((_: any, i: number) => `manual-${i}`)
                      const allChecked = allManualIds.every((id: string) => wizManualChecked.has(id))
                      return (
                      <div style={{ marginBottom: 16 }}>
                        <h4 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 600, color: '#e65100', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e65100" strokeWidth="2"><path d="M12 9v2m0 4h.01M5.07 19h13.86a2 2 0 0 0 1.73-3L13.73 4a2 2 0 0 0-3.46 0L3.34 16a2 2 0 0 0 1.73 3z"/></svg>
                          Manual actions — enter these in {wizPushResult.provider === 'sage' ? 'Sage' : 'Xero'} ({wizManualChecked.size}/{wizPushResult.manual_items.length} done)
                        </h4>
                        <p style={{ fontSize: 12, color: 'var(--text-muted, #6b7280)', marginBottom: 10 }}>
                          These items cannot be pushed automatically. Work through each one in your {wizPushResult.provider === 'sage' ? 'Sage' : 'Xero'} pay run, then tick it off. You cannot proceed until all items are confirmed.
                        </p>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {wizPushResult.manual_items.map((item: any, i: number) => {
                            const checkId = `manual-${i}`
                            const checked = wizManualChecked.has(checkId)
                            const typeLabel = item.type === 'unpaid_leave' ? 'Unpaid Leave'
                              : item.type === 'benefit_addition' ? 'Benefit Addition'
                              : item.type === 'benefit_deduction' ? 'Benefit Removal'
                              : item.type === 'bonus' ? 'Bonus'
                              : item.type === 'deduction' ? 'Deduction'
                              : item.type === 'benefit_removal' ? 'Benefit Removal'
                              : item.type === 'holiday_pay' ? 'Holiday Pay'
                              : item.type
                            const typeBg = item.type === 'unpaid_leave' ? '#e3f2fd'
                              : item.type === 'bonus' ? '#e8f5e9'
                              : item.type === 'deduction' ? '#ffebee'
                              : item.type === 'holiday_pay' ? '#fff8e1'
                              : '#f3e5f5'
                            const typeColor = item.type === 'unpaid_leave' ? '#1565c0'
                              : item.type === 'bonus' ? '#2e7d32'
                              : item.type === 'deduction' ? '#c62828'
                              : item.type === 'holiday_pay' ? '#f57f17'
                              : '#7b1fa2'
                            const xeroPath = item.type === 'unpaid_leave'
                              ? 'Payroll → Pay Runs → select employee → Leave tab → add Unpaid Leave for ' + (item.days || '') + ' day(s)'
                              : item.type === 'bonus' || item.type === 'deduction'
                              ? 'Payroll → Pay Runs → select employee → Earnings/Deductions → add line'
                              : item.type === 'holiday_pay'
                              ? 'Payroll → Pay Runs → select employee → Earnings → add Holiday Pay line'
                              : 'Payroll → Pay Runs → select employee → Benefits tab → add/remove benefit'
                            return (
                              <div key={i} style={{
                                background: checked ? '#f1f8e9' : '#fff3e0', borderRadius: 8, padding: '10px 14px',
                                border: `1px solid ${checked ? '#a5d6a7' : '#ffcc80'}`, opacity: checked ? 0.7 : 1,
                                display: 'flex', gap: 10, alignItems: 'flex-start',
                              }}>
                                <input type="checkbox" checked={checked} onChange={() => {
                                  setWizManualChecked(prev => {
                                    const next = new Set(prev)
                                    if (next.has(checkId)) next.delete(checkId); else next.add(checkId)
                                    return next
                                  })
                                }} style={{ marginTop: 3, accentColor: '#2e7d32', width: 16, height: 16, flexShrink: 0 }} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                                    <strong style={{ fontSize: 13 }}>{item.employee}</strong>
                                    <span style={{ fontSize: 10, background: typeBg, color: typeColor, padding: '1px 8px', borderRadius: 10, fontWeight: 600 }}>{typeLabel}</span>
                                    <span style={{ fontSize: 13, fontWeight: 700, marginLeft: 'auto' }}>{currencySymbol(currency)}{(item.amount || 0).toFixed(2)}{item.days ? ` (${item.days} day${item.days !== 1 ? 's' : ''})` : ''}</span>
                                  </div>
                                  <div style={{ fontSize: 12, color: 'var(--text-muted, #6b7280)' }}>{item.description}</div>
                                  <div style={{ fontSize: 11, color: '#6d4c41', marginTop: 4, fontStyle: 'italic' }}>
                                    Xero: {xeroPath}
                                  </div>
                                </div>
                              </div>
                            )
                          })}
                        </div>

                        {!allChecked && (
                          <p style={{ fontSize: 12, color: '#e65100', marginTop: 8, fontWeight: 500 }}>
                            Tick off each item above after entering it in Xero to continue.
                          </p>
                        )}
                      </div>
                      )
                    })()}

                    {/* Benefit changes checklist */}
                    {wizBenefitChanges.length > 0 && (
                      <div style={{ background: '#f3e5f5', borderRadius: 8, padding: 14, marginBottom: 16, borderLeft: '4px solid #7e57c2' }}>
                        <strong style={{ color: '#4a148c', fontSize: 14 }}>Benefit Adjustments — enter these in {connectedProvider === 'xero' ? 'Xero' : 'Sage'}</strong>
                        <p style={{ fontSize: 12, color: '#6a1b9a', margin: '4px 0 8px' }}>
                          These benefit changes need to be added manually in {connectedProvider === 'xero' ? 'Xero' : 'Sage'} before running the pay run. Tick each one once done.
                        </p>
                        <div style={{ background: 'rgba(255,255,255,0.6)', borderRadius: 6, overflow: 'hidden' }}>
                          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                            <thead>
                              <tr style={{ background: 'rgba(126,87,194,0.1)', textAlign: 'left' }}>
                                <th style={{ padding: '6px 10px', width: 28 }}></th>
                                <th style={{ padding: '6px 10px', fontWeight: 600 }}>Employee</th>
                                <th style={{ padding: '6px 10px', fontWeight: 600 }}>Benefit</th>
                                <th style={{ padding: '6px 10px', fontWeight: 600, textAlign: 'right' }}>Monthly Cost</th>
                              </tr>
                            </thead>
                            <tbody>
                              {wizBenefitChanges.map((b, i) => (
                                <tr key={i} style={{ borderTop: '1px solid rgba(126,87,194,0.15)' }}>
                                  <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                                    <input type="checkbox" checked={wizBenefitChecked.has(`benefit-${i}`)}
                                      onChange={e => {
                                        const next = new Set(wizBenefitChecked)
                                        e.target.checked ? next.add(`benefit-${i}`) : next.delete(`benefit-${i}`)
                                        setWizBenefitChecked(next)
                                      }}
                                    />
                                  </td>
                                  <td style={{ padding: '6px 10px', fontWeight: 500, textDecoration: wizBenefitChecked.has(`benefit-${i}`) ? 'line-through' : undefined, opacity: wizBenefitChecked.has(`benefit-${i}`) ? 0.5 : 1 }}>{b.employee_name}</td>
                                  <td style={{ padding: '6px 10px', textDecoration: wizBenefitChecked.has(`benefit-${i}`) ? 'line-through' : undefined, opacity: wizBenefitChecked.has(`benefit-${i}`) ? 0.5 : 1 }}>{b.benefit} ({b.action})</td>
                                  <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600, textDecoration: wizBenefitChecked.has(`benefit-${i}`) ? 'line-through' : undefined, opacity: wizBenefitChecked.has(`benefit-${i}`) ? 0.5 : 1 }}>{currencySymbol(currency)}{b.monthly_cost.toFixed(2)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {wizBenefitChecked.size < wizBenefitChanges.length && (
                          <p style={{ fontSize: 11, color: '#e65100', margin: '8px 0 0', fontStyle: 'italic' }}>
                            Tick each item once added in {connectedProvider === 'xero' ? 'Xero' : 'Sage'} to confirm completion.
                          </p>
                        )}
                        {wizBenefitChecked.size === wizBenefitChanges.length && (
                          <p style={{ fontSize: 11, color: '#2e7d32', margin: '8px 0 0', fontWeight: 600 }}>
                            All benefit adjustments confirmed.
                          </p>
                        )}
                      </div>
                    )}

                    {/* No manual items */}
                    {(!wizPushResult.manual_items || wizPushResult.manual_items.length === 0) && wizBenefitChanges.length === 0 && (
                      <div style={{ background: '#e8f5e9', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 13, color: '#2e7d32' }}>
                        No manual actions required — all adjustments were pushed automatically.
                      </div>
                    )}

                    {/* Pay template cleanup notice for salaried overtime */}
                    {wizPushResult.timesheet_results && wizPushResult.timesheet_results.some((r: any) => r.method === 'pay_template' && r.status === 'pushed') && (
                      <div style={{ background: '#fff3e0', borderRadius: 8, padding: 14, marginBottom: 16, borderLeft: '4px solid #ff9800', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#e65100" strokeWidth="2" style={{ flexShrink: 0, marginTop: 2 }}><path d="M12 9v2m0 4h.01M5.07 19h13.86a2 2 0 0 0 1.73-3L13.73 4a2 2 0 0 0-3.46 0L3.34 16a2 2 0 0 0 1.73 3z"/></svg>
                        <div>
                          <strong style={{ color: '#e65100', fontSize: 13 }}>Important: Clean up pay templates after pay run</strong>
                          <p style={{ fontSize: 12, color: '#bf360c', margin: '4px 0 0' }}>
                            Overtime for salaried staff was added to their Xero pay templates. After the pay run is posted and finalised,
                            you <strong>must delete the overtime earnings line</strong> from each employee's pay template in Xero to prevent
                            it carrying over to the next pay period. Go to Payroll &gt; Employees &gt; [Employee] &gt; Pay Template &gt; remove the overtime earnings line.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* CSV fallback download */}
                    <div style={{ background: 'var(--bg-subtle, #f8f9fa)', borderRadius: 8, padding: 14, marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <strong style={{ fontSize: 13 }}>Download Changes as CSV</strong>
                        <p style={{ fontSize: 12, color: 'var(--text-muted, #6b7280)', margin: '2px 0 0' }}>
                          Fallback if Xero is unavailable — download all adjustments to apply manually.
                        </p>
                      </div>
                      <button className="admin-btn" style={{ fontSize: 12 }} onClick={() => {
                        const { csv, rowCount } = generateAdjustmentsCsv()
                        if (rowCount === 0) { showError('No adjustments to export'); return }
                        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
                        const url = URL.createObjectURL(blob)
                        const a = document.createElement('a')
                        a.href = url
                        a.download = `Payroll_Adjustments_Fallback_${localDateStr(new Date())}.csv`
                        a.click()
                        URL.revokeObjectURL(url)
                      }}>
                        Download CSV
                      </button>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                      <button className="admin-btn" style={{ marginRight: 'auto', color: '#c62828' }} onClick={wizCancelPayRun}>Cancel Pay Run</button>
                      <button className="admin-btn admin-btn-primary"
                        disabled={wizPushResult.manual_items && wizPushResult.manual_items.length > 0 && !wizPushResult.manual_items.every((_: any, i: number) => wizManualChecked.has(`manual-${i}`))}
                        onClick={() => setWizStep(4)}>
                        Next: Processing →
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    {/* Sage CSV export results */}
                    <div style={{ background: (wizPushResult?.csv_exported || 0) > 0 ? '#e8f5e9' : '#fff3e0', borderRadius: 8, padding: 16, marginBottom: 16, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={(wizPushResult?.csv_exported || 0) > 0 ? '#2e7d32' : '#e65100'} strokeWidth="2" style={{ flexShrink: 0, marginTop: 2 }}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                      <div style={{ flex: 1 }}>
                        <strong style={{ color: (wizPushResult?.csv_exported || 0) > 0 ? '#2e7d32' : '#e65100' }}>
                          {(wizPushResult?.csv_exported || 0) > 0
                            ? `${wizPushResult!.csv_exported} adjustment${wizPushResult!.csv_exported !== 1 ? 's' : ''} exported to CSV`
                            : 'No adjustments to export'}
                        </strong>
                        <p style={{ fontSize: 12, margin: '4px 0 0', color: '#558b2f' }}>
                          {(wizPushResult?.csv_exported || 0) > 0
                            ? 'The CSV file has been downloaded. Import it into Sage, then come back to sync the final payslips.'
                            : 'No adjustments were found for this period.'}
                        </p>
                      </div>
                    </div>

                    {/* Sage exported adjustments table */}
                    {wizPushResult?.csv_items && wizPushResult.csv_items.length > 0 && (
                      <div style={{ marginBottom: 16 }}>
                        <h4 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600, color: '#2e7d32', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2e7d32" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                          Exported Adjustments
                        </h4>
                        <div style={{ background: 'var(--bg-subtle, #f8f9fa)', borderRadius: 8, overflow: 'hidden' }}>
                          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                            <thead>
                              <tr style={{ background: 'var(--bg-muted, #f0f1f3)', textAlign: 'left' }}>
                                <th style={{ padding: '8px 12px', fontWeight: 600 }}>Employee</th>
                                <th style={{ padding: '8px 12px', fontWeight: 600 }}>Type</th>
                                <th style={{ padding: '8px 12px', fontWeight: 600 }}>Description</th>
                                <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'right' }}>Amount</th>
                              </tr>
                            </thead>
                            <tbody>
                              {wizPushResult.csv_items.map((item: any, i: number) => (
                                <tr key={i} style={{ borderTop: '1px solid var(--border, #e5e7eb)' }}>
                                  <td style={{ padding: '8px 12px', fontWeight: 500 }}>{item.employee}</td>
                                  <td style={{ padding: '8px 12px' }}>
                                    <span style={{ fontSize: 11, background: item.amount >= 0 ? '#e8f5e9' : '#fff3e0', color: item.amount >= 0 ? '#2e7d32' : '#e65100', padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>
                                      {item.type}
                                    </span>
                                  </td>
                                  <td style={{ padding: '8px 12px' }}>{item.description}</td>
                                  <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: item.amount < 0 ? '#c62828' : undefined }}>
                                    {item.amount < 0 ? '-' : '+'}{currencySymbol(currency)}{Math.abs(item.amount).toFixed(2)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr style={{ borderTop: '2px solid var(--border, #d1d5db)', background: 'var(--bg-muted, #f0f1f3)' }}>
                                <td colSpan={3} style={{ padding: '8px 12px', fontWeight: 700 }}>Net adjustment total</td>
                                <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700 }}>
                                  {currencySymbol(currency)}{wizPushResult.csv_items.reduce((s: number, i: any) => s + i.amount, 0).toFixed(2)}
                                </td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>

                        <button
                          className="admin-btn"
                          style={{ marginTop: 10, fontSize: 12 }}
                          onClick={() => {
                            const { csv } = generateAdjustmentsCsv()
                            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
                            const url = URL.createObjectURL(blob)
                            const a = document.createElement('a')
                            a.href = url
                            a.download = `Sage_Adjustments_${localDateStr(new Date())}.csv`
                            a.click()
                            URL.revokeObjectURL(url)
                          }}
                        >
                          Download CSV Again
                        </button>
                      </div>
                    )}

                    {/* Sage import instructions */}
                    {(wizPushResult?.csv_exported || 0) > 0 && (
                      <div style={{ background: '#e3f2fd', borderRadius: 8, padding: 14, marginBottom: 16, borderLeft: '4px solid #1565c0' }}>
                        <strong style={{ color: '#1565c0', fontSize: 13 }}>How to Import into Sage</strong>
                        <ol style={{ fontSize: 12, color: '#1565c0', margin: '6px 0 0', paddingLeft: 20 }}>
                          <li>Open Sage 50 Payroll</li>
                          <li>Go to <strong>File &gt; Import</strong> and select <strong>Advanced Data Import</strong></li>
                          <li>Choose <strong>Employee Payments and Deductions</strong> as the import type</li>
                          <li>Select the downloaded CSV file and map the columns</li>
                          <li>Review the imported data and process your pay run</li>
                          <li>Come back here and click <strong>Next: Sync Back</strong> to pull the final payslips</li>
                        </ol>
                      </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                      <button className="admin-btn" style={{ marginRight: 'auto', color: '#c62828' }} onClick={wizCancelPayRun}>Cancel Pay Run</button>
                      <button className="admin-btn admin-btn-primary" onClick={() => setWizStep(4)}>
                        Next: Processing →
                      </button>
                    </div>
                  </>
                )
              ) : (
                !wizGenerated ? (
                  <>
                    <p style={{ fontSize: 13, color: 'var(--text-muted, #6b7280)', marginBottom: 16 }}>
                      This will create draft payslips for the next calendar month with estimated tax and NI. Payslips are generated in draft status — you can review and edit them before submitting.
                    </p>
                    <div style={{ background: '#fff8e1', borderRadius: 8, padding: 14, marginBottom: 16, borderLeft: '4px solid #ffa000' }}>
                      <strong style={{ color: '#e65100', fontSize: 13 }}>Standalone Mode — Estimates Only</strong>
                      <p style={{ fontSize: 12, color: '#bf360c', margin: '4px 0 0' }}>
                        These payslips use estimated UK tax and NI figures. For accurate calculations, connect Xero or Sage via Integrations. The estimates shown are for reference only and should not be treated as official payslips.
                      </p>
                    </div>
                    <div style={{ background: 'var(--bg-subtle, #f8f9fa)', borderRadius: 8, padding: 16, marginBottom: 16 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
                        <div className="pn-worker-metric">
                          <span className="pn-worker-metric-value">
                            {(() => {
                              let count = 0
                              if (wizWorkerTypes.has('employed')) count += employedEmployees.length
                              if (wizWorkerTypes.has('shift')) count += shiftEmployees.length
                              if (wizWorkerTypes.has('zero_hours')) count += zeroHoursEmployees.length
                              return count
                            })()}
                          </span>
                          <span className="pn-worker-metric-label">Payslips to generate</span>
                        </div>
                        <div className="pn-worker-metric">
                          <span className="pn-worker-metric-value">{[...wizWorkerTypes].length}</span>
                          <span className="pn-worker-metric-label">Worker types</span>
                        </div>
                        <div className="pn-worker-metric">
                          <span className="pn-worker-metric-value">
                            {(() => {
                              const firstPeriod = Object.values(wizPeriodByType)[0]
                              if (firstPeriod) {
                                const d = new Date(firstPeriod.start + 'T00:00:00')
                                return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`
                              }
                              const d = new Date(now.getFullYear(), now.getMonth(), 1)
                              return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`
                            })()}
                          </span>
                          <span className="pn-worker-metric-label">Target period</span>
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                      <button className="admin-btn" style={{ marginRight: 'auto', color: '#c62828' }} onClick={wizCancelPayRun}>Cancel Pay Run</button>
                      <button className="admin-btn" onClick={() => setWizStep(2)}>← Back</button>
                      <button className="admin-btn admin-btn-primary" disabled={wizGenerating} onClick={wizGenerate}>
                        {wizGenerating ? 'Generating…' : 'Generate Estimate Payslips'}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ background: '#e8f5e9', borderRadius: 8, padding: 16, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2e7d32" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                      <div>
                        <strong style={{ color: '#2e7d32' }}>Estimate payslips generated</strong>
                        <p style={{ fontSize: 12, margin: '4px 0 0', color: '#558b2f' }}>Draft payslips with estimated figures have been created. Review them before proceeding to payment.</p>
                      </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                      <button className="admin-btn" style={{ marginRight: 'auto', color: '#c62828' }} onClick={wizCancelPayRun}>Cancel Pay Run</button>
                      <button className="admin-btn" onClick={() => { setView('payslips') }}>Review Payslips</button>
                      <button className="admin-btn admin-btn-primary" onClick={() => setWizStep(4)}>
                        Next: Export & Pay →
                      </button>
                    </div>
                  </>
                )
              )}
            </div>
          )}

          {/* Step 4: Processing (connected) / Export (standalone) */}
          {wizStep === 4 && providerConnected && (
            <div className="admin-settings-group" style={{ marginTop: 20 }}>
              <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700 }}>Processing — Reconcile in {connectedProvider === 'xero' ? 'Xero' : 'Sage'}</h3>
              <p style={{ fontSize: 13, color: 'var(--text-muted, #6b7280)', marginBottom: 16 }}>
                Adjustments have been pushed. Complete the following steps in {connectedProvider === 'xero' ? 'Xero' : 'Sage'} before syncing payslips back to InflowHR.
              </p>

              {/* Summary of what was pushed */}
              {wizPushResult && (
                <div style={{ background: 'var(--bg-subtle, #f8f9fa)', borderRadius: 8, padding: 14, marginBottom: 16 }}>
                  <strong style={{ fontSize: 13 }}>Push Summary</strong>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10, marginTop: 8 }}>
                    {(wizPushResult.pushed || 0) > 0 && (
                      <div className="pn-worker-metric">
                        <span className="pn-worker-metric-value" style={{ color: '#2e7d32' }}>{wizPushResult.pushed}</span>
                        <span className="pn-worker-metric-label">Auto-pushed</span>
                      </div>
                    )}
                    {(wizPushResult.manual_items?.length || 0) > 0 && (
                      <div className="pn-worker-metric">
                        <span className="pn-worker-metric-value" style={{ color: '#e65100' }}>{wizPushResult.manual_items!.length}</span>
                        <span className="pn-worker-metric-label">Manual items</span>
                      </div>
                    )}
                    {(wizPushResult.skipped || 0) > 0 && (
                      <div className="pn-worker-metric">
                        <span className="pn-worker-metric-value" style={{ color: '#78909c' }}>{wizPushResult.skipped}</span>
                        <span className="pn-worker-metric-label">Skipped</span>
                      </div>
                    )}
                    <div className="pn-worker-metric">
                      <span className="pn-worker-metric-value">{wizRunEmployees.length}</span>
                      <span className="pn-worker-metric-label">Employees in run</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Checklist */}
              {(() => {
                const checklistItems = [
                  { id: 'verify_push', label: `Verify all overtime and adjustments appear correctly in ${connectedProvider === 'xero' ? 'Xero' : 'Sage'}`, detail: connectedProvider === 'xero' ? 'Payroll → Employees → check pay templates and timesheets' : 'Check imported adjustments in Sage' },
                  { id: 'manual_items', label: 'Complete any manual items (benefits, deductions, bonuses) not pushed automatically', detail: 'See the manual actions listed in the previous step' },
                  { id: 'create_payrun', label: `Create a pay run in ${connectedProvider === 'xero' ? 'Xero' : 'Sage'} for this period`, detail: connectedProvider === 'xero' ? 'Payroll → Pay Runs → Create Draft Pay Run' : 'Process → Pay Run' },
                  { id: 'review_payrun', label: 'Review the draft pay run — check gross, tax, NI, net for each employee', detail: 'Verify figures match expected amounts before posting' },
                  { id: 'post_payrun', label: `Post the pay run in ${connectedProvider === 'xero' ? 'Xero' : 'Sage'}`, detail: connectedProvider === 'xero' ? 'Pay Run → Post → Confirm' : 'Process → Post Pay Run' },
                ]
                if (connectedProvider === 'xero' && wizPushResult?.timesheet_results?.some((r: any) => r.method === 'pay_template')) {
                  checklistItems.push({ id: 'cleanup_template', label: 'Delete overtime earnings lines from pay templates after posting', detail: 'Payroll → Employees → [name] → Pay Template → remove overtime line to prevent carry-over' })
                }
                return (
                  <div style={{ marginBottom: 16 }}>
                    <h4 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 600, color: '#1565c0', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1565c0" strokeWidth="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                      Processing Checklist ({wizManualChecked.size}/{checklistItems.length} complete)
                    </h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {checklistItems.map(item => {
                        const checked = wizManualChecked.has(item.id)
                        return (
                          <div key={item.id} style={{
                            background: checked ? '#f1f8e9' : '#fff', borderRadius: 8, padding: '10px 14px',
                            border: `1px solid ${checked ? '#a5d6a7' : 'var(--border, #e5e7eb)'}`, opacity: checked ? 0.8 : 1,
                            display: 'flex', gap: 10, alignItems: 'flex-start',
                          }}>
                            <input type="checkbox" checked={checked} onChange={() => {
                              setWizManualChecked(prev => {
                                const next = new Set(prev)
                                if (next.has(item.id)) next.delete(item.id); else next.add(item.id)
                                return next
                              })
                            }} style={{ marginTop: 3, accentColor: '#2e7d32', width: 16, height: 16, flexShrink: 0 }} />
                            <div style={{ flex: 1 }}>
                              <strong style={{ fontSize: 13, textDecoration: checked ? 'line-through' : undefined }}>{item.label}</strong>
                              <p style={{ fontSize: 12, color: 'var(--text-muted, #6b7280)', margin: '2px 0 0' }}>{item.detail}</p>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    {wizManualChecked.size < checklistItems.length && (
                      <p style={{ fontSize: 12, color: '#e65100', marginTop: 8, fontWeight: 500 }}>
                        Complete all checklist items before continuing to sync.
                      </p>
                    )}
                  </div>
                )
              })()}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button className="admin-btn" style={{ marginRight: 'auto', color: '#c62828' }} onClick={wizCancelPayRun}>Cancel Pay Run</button>
                <button className="admin-btn" onClick={() => setWizStep(3)}>← Back</button>
                <button className="admin-btn admin-btn-primary" onClick={async () => {
                  if (wizPayRunId) {
                    await supabase.from('pay_runs').update({ status: 'exported' }).eq('id', wizPayRunId)
                  }
                  setWizStep(5)
                }}>
                  Continue to Sync Back →
                </button>
              </div>
            </div>
          )}

          {/* Step 5: Sync Back (connected) / Sync & Release (standalone step 5) */}
          {((wizStep === 5 && providerConnected) || (wizStep === 4 && !providerConnected)) && (
            <div className="admin-settings-group" style={{ marginTop: 20 }}>
              {providerConnected ? (
                <>
                  <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700 }}>Sync Back from {connectedProvider === 'xero' ? 'Xero' : 'Sage'}</h3>
                  <p style={{ fontSize: 13, color: 'var(--text-muted, #6b7280)', marginBottom: 16 }}>
                    After running your pay run in {connectedProvider === 'xero' ? 'Xero' : 'Sage'}, sync the actual payslips back to InflowHR so employees can view their real pay details.
                  </p>

                  {(() => {
                    const rosterTotal = wizRunEmployees.length
                    const rosterPages = Math.ceil(rosterTotal / ROSTER_PAGE_SIZE)
                    const rosterSlice = wizRunEmployees.slice((wizRosterPage - 1) * ROSTER_PAGE_SIZE, wizRosterPage * ROSTER_PAGE_SIZE)
                    const workerTypeLabel = wizWorkerTypes.has('employed') ? 'Employed Staff' : wizWorkerTypes.has('shift') ? 'Shift Workers' : 'Zero Hours'
                    return (
                      <div style={{ background: 'var(--bg-subtle, #f8f9fa)', borderRadius: 8, padding: 14, marginBottom: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                          <strong style={{ fontSize: 14 }}>Employees in this Pay Run — {workerTypeLabel} ({rosterTotal})</strong>
                        </div>
                        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ borderBottom: '1px solid var(--border, #e5e7eb)' }}>
                              <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600, color: 'var(--text-muted, #6b7280)' }}>Name</th>
                              <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600, color: 'var(--text-muted, #6b7280)' }}>Job Title</th>
                              <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600, color: 'var(--text-muted, #6b7280)' }}>Department</th>
                              <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600, color: 'var(--text-muted, #6b7280)' }}>Payroll ID</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rosterSlice.map(emp => (
                              <tr key={emp.id} style={{ borderBottom: '1px solid var(--border, #f0f0f0)' }}>
                                <td style={{ padding: '6px 8px', fontWeight: 500 }}>{emp.last_name}, {emp.first_name}</td>
                                <td style={{ padding: '6px 8px', color: 'var(--text-muted, #6b7280)' }}>{emp.job_title || '—'}</td>
                                <td style={{ padding: '6px 8px', color: 'var(--text-muted, #6b7280)' }}>{emp.department || '—'}</td>
                                <td style={{ padding: '6px 8px', color: 'var(--text-muted, #999)', fontFamily: 'monospace', fontSize: 11 }}>{emp.payroll_id || '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {rosterPages > 1 && (
                          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 12 }}>
                            <button className="admin-btn" style={{ fontSize: 11, padding: '2px 8px' }} disabled={wizRosterPage <= 1} onClick={() => setWizRosterPage(p => p - 1)}>← Prev</button>
                            <span style={{ color: 'var(--text-muted, #6b7280)' }}>Page {wizRosterPage} of {rosterPages}</span>
                            <button className="admin-btn" style={{ fontSize: 11, padding: '2px 8px' }} disabled={wizRosterPage >= rosterPages} onClick={() => setWizRosterPage(p => p + 1)}>Next →</button>
                          </div>
                        )}
                      </div>
                    )
                  })()}

                  {connectedProvider === 'xero' && (() => {
                    const allStarts = Object.values(wizPeriodByType).map(p => p.start).sort()
                    const allEnds = Object.values(wizPeriodByType).map(p => p.end).sort().reverse()
                    const wizStart = allStarts[0]
                    const wizEnd = allEnds[0]
                    const periodMismatch = lastXeroPayRun && wizStart && wizEnd &&
                      (lastXeroPayRun.period_start !== wizStart || lastXeroPayRun.period_end !== wizEnd)
                    const noLastPayRun = !lastXeroPayRun && wizStart
                    return (
                    <div style={{ background: 'var(--bg-subtle, #f8f9fa)', borderRadius: 8, padding: 14, marginBottom: 12 }}>
                      {(periodMismatch || noLastPayRun) && !wizPayslipsFetched && (
                        <div style={{ background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 6, padding: '10px 14px', marginBottom: 12, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                          <span style={{ fontSize: 18, lineHeight: 1 }}>⚠️</span>
                          <div style={{ fontSize: 12, color: '#795548' }}>
                            {periodMismatch ? (
                              <>
                                <strong>Pay run period mismatch.</strong> The last Xero pay run fetched was for{' '}
                                {formatDate(lastXeroPayRun!.period_start)} – {formatDate(lastXeroPayRun!.period_end)},
                                but this wizard is running for {formatDate(wizStart!)} – {formatDate(wizEnd!)}.
                                If no pay run exists in Xero for this period, you may need to create one in Xero first.
                              </>
                            ) : (
                              <>
                                <strong>No previous Xero pay run on record.</strong> This wizard is running for{' '}
                                {formatDate(wizStart!)} – {formatDate(wizEnd!)}.
                                If no pay run exists in Xero for this period, you may need to create one in Xero first.
                              </>
                            )}
                          </div>
                        </div>
                      )}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <strong style={{ fontSize: 14 }}>Fetch Payslips from Xero</strong>
                          <p style={{ fontSize: 12, color: 'var(--text-muted, #6b7280)', margin: '4px 0 0' }}>
                            Only payslips for the {wizRunEmployees.length} {wizWorkerTypes.has('employed') ? 'employed' : wizWorkerTypes.has('shift') ? 'shift worker' : 'zero hours'} employee{wizRunEmployees.length !== 1 ? 's' : ''} in this pay run will be synced.
                          </p>
                        </div>
                        <button className="admin-btn admin-btn-primary" disabled={wizExporting || wizPayslipsFetched} onClick={async () => {
                          const ok = await wizSyncXero()
                          if (ok) setWizPayslipsFetched(true)
                        }} style={{ fontSize: 13 }}>
                          {wizExporting ? 'Syncing…' : wizPayslipsFetched ? '✓ Fetched' : 'Fetch Pay Run'}
                        </button>
                      </div>
                    </div>
                    )
                  })()}

                  {connectedProvider === 'xero' && !wizPayslipsFetched && (
                    <div style={{ background: 'var(--bg-subtle, #f8f9fa)', borderRadius: 8, padding: 14, marginBottom: 12, borderLeft: '4px solid #e0e0e0' }}>
                      <strong style={{ fontSize: 14 }}>Or Import Payslips from CSV</strong>
                      <p style={{ fontSize: 12, color: 'var(--text-muted, #6b7280)', margin: '4px 0 8px' }}>
                        If the API fetch above doesn't work, export payslips from Xero as CSV and import them here. The CSV should include Employee Name, Gross Pay, Tax, NI, and Net Pay columns.
                      </p>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <input type="file" accept=".csv" id="xero-csv-import"
                          style={{ display: 'none' }}
                          onChange={e => {
                            const file = e.target.files?.[0]
                            if (file) setWizXeroCsvFile(file)
                            e.target.value = ''
                          }}
                        />
                        <label htmlFor="xero-csv-import" className="admin-btn" style={{ fontSize: 12, cursor: 'pointer', margin: 0 }}>
                          {wizXeroCsvFile ? wizXeroCsvFile.name : 'Choose CSV file…'}
                        </label>
                        {wizXeroCsvFile && (
                          <>
                            <button className="admin-btn admin-btn-primary" style={{ fontSize: 12 }}
                              disabled={wizXeroCsvImporting}
                              onClick={async () => {
                                const ok = await wizImportXeroCsv()
                                if (ok) setWizPayslipsFetched(true)
                              }}>
                              {wizXeroCsvImporting ? 'Importing…' : 'Import CSV'}
                            </button>
                            <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e53935', fontSize: 14, padding: 0 }}
                              onClick={() => setWizXeroCsvFile(null)}>×</button>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {connectedProvider === 'sage' && (
                    <div style={{ background: 'var(--bg-subtle, #f8f9fa)', borderRadius: 8, padding: 14, marginBottom: 12 }}>
                      <strong style={{ fontSize: 14 }}>Import Payslips from Sage</strong>
                      <p style={{ fontSize: 12, color: 'var(--text-muted, #6b7280)', margin: '4px 0 0 0' }}>
                        After running payroll in Sage, export individual PDF payslips and upload them here. InflowHR will store them so employees can view their payslips.
                      </p>

                      <div style={{ marginTop: 12, border: '2px dashed var(--border, #d1d5db)', borderRadius: 8, padding: 16, textAlign: 'center', background: 'var(--bg, #fff)' }}>
                        <input type="file" accept=".pdf" multiple id="sage-pdf-upload"
                          style={{ display: 'none' }}
                          onChange={e => {
                            const files = Array.from(e.target.files || [])
                            if (files.length > 0) setWizSageFiles(prev => [...prev, ...files])
                            e.target.value = ''
                          }}
                        />
                        <label htmlFor="sage-pdf-upload" style={{ cursor: 'pointer', display: 'block' }}>
                          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted, #9ca3af)" strokeWidth="1.5" style={{ marginBottom: 6 }}>
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                          </svg>
                          <p style={{ fontSize: 13, color: 'var(--text-muted, #6b7280)', margin: 0 }}>
                            Click to select PDF payslips, or drag and drop
                          </p>
                          <p style={{ fontSize: 11, color: 'var(--text-muted, #999)', margin: '4px 0 0' }}>
                            Upload one PDF per employee from your Sage payslip export
                          </p>
                        </label>
                      </div>

                      {wizSageFiles.length > 0 && (
                        <div style={{ marginTop: 10 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{wizSageFiles.length} file{wizSageFiles.length !== 1 ? 's' : ''} selected</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflowY: 'auto' }}>
                            {wizSageFiles.map((f, i) => (
                              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, background: 'var(--bg, #fff)', borderRadius: 4, padding: '4px 8px', border: '1px solid var(--border, #e5e7eb)' }}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#e53935" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                                <span style={{ color: 'var(--text-muted, #999)', fontSize: 11 }}>{(f.size / 1024).toFixed(0)} KB</span>
                                <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e53935', fontSize: 14, padding: 0 }}
                                  onClick={() => setWizSageFiles(prev => prev.filter((_, j) => j !== i))}>×</button>
                              </div>
                            ))}
                          </div>

                          <button className="admin-btn admin-btn-primary" style={{ marginTop: 10, fontSize: 13 }}
                            disabled={wizSageUploading}
                            onClick={async () => {
                              if (!selectedCompanyId || !session) return
                              setWizSageUploading(true)
                              let uploaded = 0
                              for (const file of wizSageFiles) {
                                const path = `${selectedCompanyId}/payslips/${Date.now()}_${file.name}`
                                const { error } = await supabase.storage.from('receipts').upload(path, file, { contentType: 'application/pdf' })
                                if (!error) uploaded++
                              }
                              showSuccess(`Uploaded ${uploaded} of ${wizSageFiles.length} payslip PDF${wizSageFiles.length !== 1 ? 's' : ''}`)
                              setWizSageFiles([])
                              setWizSageUploading(false)
                              setWizExported(true)
                            }}>
                            {wizSageUploading ? 'Uploading…' : `Upload ${wizSageFiles.length} Payslip${wizSageFiles.length !== 1 ? 's' : ''}`}
                          </button>
                        </div>
                      )}

                      <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted, #999)' }}>
                        Or go to the <button style={{ background: 'none', border: 'none', color: '#1565c0', cursor: 'pointer', fontSize: 11, textDecoration: 'underline', padding: 0 }} onClick={() => setView('payslips')}>Payslips page</button> to upload individually.
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16, alignItems: 'center' }}>
                    <button className="admin-btn" style={{ marginRight: !wizPayslipsFetched ? 0 : 'auto', color: '#c62828' }} onClick={wizCancelPayRun}>Cancel Pay Run</button>
                    {!wizPayslipsFetched && (
                      <span style={{ fontSize: 12, color: '#e65100', marginRight: 'auto' }}>
                        Sync payslips from {connectedProvider === 'xero' ? 'Xero' : 'Sage'} before releasing to employees.
                      </span>
                    )}
                    <button className="admin-btn" onClick={() => setWizStep(4)}>← Back</button>
                    <button className="admin-btn admin-btn-primary" disabled={!wizPayslipsFetched} onClick={() => setWizStep(6)}>
                      Next: Release →
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700 }}>Export Payroll</h3>
                  <p style={{ fontSize: 13, color: 'var(--text-muted, #6b7280)', marginBottom: 16 }}>
                    Choose how to export this payroll run for payment processing.
                  </p>

                  {(() => {
                    const rosterTotal = wizRunEmployees.length
                    const rosterPages = Math.ceil(rosterTotal / ROSTER_PAGE_SIZE)
                    const rosterSlice = wizRunEmployees.slice((wizRosterPage - 1) * ROSTER_PAGE_SIZE, wizRosterPage * ROSTER_PAGE_SIZE)
                    const workerTypeLabel = wizWorkerTypes.has('employed') ? 'Employed Staff' : wizWorkerTypes.has('shift') ? 'Shift Workers' : 'Zero Hours'
                    return (
                      <div style={{ background: 'var(--bg-subtle, #f8f9fa)', borderRadius: 8, padding: 14, marginBottom: 16 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                          <strong style={{ fontSize: 14 }}>Employees in this Pay Run — {workerTypeLabel} ({rosterTotal})</strong>
                        </div>
                        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ borderBottom: '1px solid var(--border, #e5e7eb)' }}>
                              <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600, color: 'var(--text-muted, #6b7280)' }}>Name</th>
                              <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600, color: 'var(--text-muted, #6b7280)' }}>Job Title</th>
                              <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600, color: 'var(--text-muted, #6b7280)' }}>Department</th>
                              <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600, color: 'var(--text-muted, #6b7280)' }}>Payroll ID</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rosterSlice.map(emp => (
                              <tr key={emp.id} style={{ borderBottom: '1px solid var(--border, #f0f0f0)' }}>
                                <td style={{ padding: '6px 8px', fontWeight: 500 }}>{emp.last_name}, {emp.first_name}</td>
                                <td style={{ padding: '6px 8px', color: 'var(--text-muted, #6b7280)' }}>{emp.job_title || '—'}</td>
                                <td style={{ padding: '6px 8px', color: 'var(--text-muted, #6b7280)' }}>{emp.department || '—'}</td>
                                <td style={{ padding: '6px 8px', color: 'var(--text-muted, #999)', fontFamily: 'monospace', fontSize: 11 }}>{emp.payroll_id || '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {rosterPages > 1 && (
                          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 12 }}>
                            <button className="admin-btn" style={{ fontSize: 11, padding: '2px 8px' }} disabled={wizRosterPage <= 1} onClick={() => setWizRosterPage(p => p - 1)}>← Prev</button>
                            <span style={{ color: 'var(--text-muted, #6b7280)' }}>Page {wizRosterPage} of {rosterPages}</span>
                            <button className="admin-btn" style={{ fontSize: 11, padding: '2px 8px' }} disabled={wizRosterPage >= rosterPages} onClick={() => setWizRosterPage(p => p + 1)}>Next →</button>
                          </div>
                        )}
                      </div>
                    )
                  })()}

                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
                    <label className={`pn-wiz-type-card ${wizPayMethod === 'external' ? 'pn-wiz-type-selected' : ''}`}>
                      <input type="radio" name="paymethod" checked={wizPayMethod === 'external'} onChange={() => setWizPayMethod('external')} style={{ display: 'none' }} />
                      <div className="pn-wiz-type-icon" style={{ background: '#78909c' }}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
                      </div>
                      <strong>Pay Externally</strong>
                      <span style={{ fontSize: 11, color: 'var(--text-muted, #999)' }}>Mark as paid via your bank</span>
                    </label>

                    {features.modulr_integration && modulrConnected && (
                      <label className={`pn-wiz-type-card ${wizPayMethod === 'modulr' ? 'pn-wiz-type-selected' : ''}`}>
                        <input type="radio" name="paymethod" checked={wizPayMethod === 'modulr'} onChange={() => setWizPayMethod('modulr')} style={{ display: 'none' }} />
                        <div className="pn-wiz-type-icon" style={{ background: '#1a1a2e' }}>
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
                        </div>
                        <strong>Modulr Payouts</strong>
                        <span style={{ fontSize: 11, color: 'var(--text-muted, #999)' }}>Direct BACS payments</span>
                      </label>
                    )}

                    {features.modulr_integration && (
                      <label className={`pn-wiz-type-card ${wizPayMethod === 'bacs' ? 'pn-wiz-type-selected' : ''}`}>
                        <input type="radio" name="paymethod" checked={wizPayMethod === 'bacs'} onChange={() => setWizPayMethod('bacs')} style={{ display: 'none' }} />
                        <div className="pn-wiz-type-icon" style={{ background: '#455a64' }}>
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        </div>
                        <strong>BACS Export</strong>
                        <span style={{ fontSize: 11, color: 'var(--text-muted, #999)' }}>Download BACS file</span>
                      </label>
                    )}
                  </div>

                  <div style={{ background: '#fff8e1', borderRadius: 8, padding: 14, marginBottom: 16, borderLeft: '4px solid #ffa000' }}>
                    <p style={{ fontSize: 13, margin: 0, color: '#e65100' }}>
                      <strong>Estimates only:</strong> The payslips use estimated tax/NI. For accurate payroll, connect Xero or Sage via the Integrations page.
                    </p>
                  </div>

                  {!wizExported ? (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                      <button className="admin-btn" style={{ marginRight: 'auto', color: '#c62828' }} onClick={wizCancelPayRun}>Cancel Pay Run</button>
                      <button className="admin-btn" onClick={() => setWizStep(3)}>← Back</button>
                      <button className="admin-btn admin-btn-primary" disabled={wizExporting} onClick={wizExport}>
                        {wizExporting ? 'Exporting…' : wizPayMethod === 'external' ? 'Mark as Externally Managed' : `Export via ${wizPayMethod.toUpperCase()}`}
                      </button>
                    </div>
                  ) : (
                    <>
                      <div style={{ background: '#e8f5e9', borderRadius: 8, padding: 14, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2e7d32" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                        <div>
                          <strong style={{ color: '#2e7d32' }}>Exported successfully</strong>
                          <p style={{ fontSize: 12, margin: '2px 0 0', color: '#558b2f' }}>
                            {wizPayMethod === 'bacs' ? 'BACS file downloaded. Upload to your bank.' :
                             wizPayMethod === 'modulr' ? 'Payments submitted via Modulr.' :
                             'Marked as externally managed.'}
                          </p>
                        </div>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                        <button className="admin-btn admin-btn-primary" onClick={() => setWizStep(5)}>
                          Next: Release →
                        </button>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {/* Step 6: Complete (connected) / Step 5: Complete (standalone) */}
          {(providerConnected ? wizStep === 6 : wizStep === 5) || wizComplete ? (
            wizComplete ? (
              <div className="admin-settings-group" style={{ marginTop: 20, textAlign: 'center', padding: 40 }}>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#43a047" strokeWidth="2" style={{ marginBottom: 12 }}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700, color: '#2e7d32' }}>Payroll Run Complete</h3>
                <p style={{ fontSize: 13, color: 'var(--text-muted, #6b7280)', marginBottom: 20 }}>
                  Payslips are ready for review. Go to <strong>Payslips</strong> to approve and release them to employees.
                </p>
                <div style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
                  <button className="admin-btn admin-btn-primary" onClick={() => setView('payslips')}>Review & Release Payslips →</button>
                  <button className="admin-btn" onClick={() => setView('dashboard')}>Back to Dashboard</button>
                </div>
              </div>
            ) : (
              <div className="admin-settings-group" style={{ marginTop: 20 }}>
                <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700 }}>
                  {providerConnected ? 'Complete Pay Run' : 'Complete Pay Run'}
                </h3>
                <p style={{ fontSize: 13, color: 'var(--text-muted, #6b7280)', marginBottom: 16 }}>
                  Complete this pay run to finalise payslips. You can then review and release them individually from the Payslips page.
                </p>

                {!providerConnected && wizPayMethod === 'external' && (
                  <div style={{ background: '#e3f2fd', borderRadius: 8, padding: 14, marginBottom: 12 }}>
                    <p style={{ fontSize: 13, margin: 0, color: '#1565c0' }}>
                      Once completed, go to Payslips to review and release to employees when ready.
                    </p>
                  </div>
                )}

                {!providerConnected && (
                  <div style={{ background: '#fff3e0', borderRadius: 8, padding: 14, marginBottom: 12, borderLeft: '4px solid #ffa000' }}>
                    <p style={{ fontSize: 12, margin: 0, color: '#e65100' }}>
                      <strong>Reminder:</strong> These are estimate payslips with approximate tax/NI. For accurate figures, connect a payroll provider.
                    </p>
                  </div>
                )}

                {(() => {
                  const rosterTotal = wizRunEmployees.length
                  const rosterPages = Math.ceil(rosterTotal / ROSTER_PAGE_SIZE)
                  const rosterSlice = wizRunEmployees.slice((wizRosterPage - 1) * ROSTER_PAGE_SIZE, wizRosterPage * ROSTER_PAGE_SIZE)
                  const workerTypeLabel = wizWorkerTypes.has('employed') ? 'Employed Staff' : wizWorkerTypes.has('shift') ? 'Shift Workers' : 'Zero Hours'
                  return (
                    <div style={{ background: 'var(--bg-subtle, #f8f9fa)', borderRadius: 8, padding: 14, marginBottom: 16 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                        <strong style={{ fontSize: 14 }}>Completing Payslips for — {workerTypeLabel} ({rosterTotal})</strong>
                      </div>
                      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--border, #e5e7eb)' }}>
                            <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600, color: 'var(--text-muted, #6b7280)' }}>Name</th>
                            <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600, color: 'var(--text-muted, #6b7280)' }}>Job Title</th>
                            <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600, color: 'var(--text-muted, #6b7280)' }}>Department</th>
                            <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600, color: 'var(--text-muted, #6b7280)' }}>Payroll ID</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rosterSlice.map(emp => (
                            <tr key={emp.id} style={{ borderBottom: '1px solid var(--border, #f0f0f0)' }}>
                              <td style={{ padding: '6px 8px', fontWeight: 500 }}>{emp.last_name}, {emp.first_name}</td>
                              <td style={{ padding: '6px 8px', color: 'var(--text-muted, #6b7280)' }}>{emp.job_title || '—'}</td>
                              <td style={{ padding: '6px 8px', color: 'var(--text-muted, #6b7280)' }}>{emp.department || '—'}</td>
                              <td style={{ padding: '6px 8px', color: 'var(--text-muted, #999)', fontFamily: 'monospace', fontSize: 11 }}>{emp.payroll_id || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {rosterPages > 1 && (
                        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 12 }}>
                          <button className="admin-btn" style={{ fontSize: 11, padding: '2px 8px' }} disabled={wizRosterPage <= 1} onClick={() => setWizRosterPage(p => p - 1)}>← Prev</button>
                          <span style={{ color: 'var(--text-muted, #6b7280)' }}>Page {wizRosterPage} of {rosterPages}</span>
                          <button className="admin-btn" style={{ fontSize: 11, padding: '2px 8px' }} disabled={wizRosterPage >= rosterPages} onClick={() => setWizRosterPage(p => p + 1)}>Next →</button>
                        </div>
                      )}
                    </div>
                  )
                })()}

                <div style={{ background: '#e8f5e9', borderRadius: 8, padding: 14, marginBottom: 16, borderLeft: '4px solid #43a047' }}>
                  <strong style={{ color: '#2e7d32', fontSize: 14 }}>Ready to Complete</strong>
                  <p style={{ fontSize: 12, color: '#1b5e20', margin: '4px 0 0' }}>
                    Completing the pay run will finalise payslips. Go to the Payslips page to review and release them to employees.
                  </p>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                  <button className="admin-btn" style={{ marginRight: 'auto', color: '#c62828' }} onClick={wizCancelPayRun}>Cancel Pay Run</button>
                  <button className="admin-btn" onClick={() => setWizStep(providerConnected ? 5 : 4)}>← Back</button>
                  <button className="admin-btn admin-btn-primary" disabled={wizReleasing} onClick={wizCompleteRun} style={{ background: '#2e7d32' }}>
                    {wizReleasing ? 'Completing…' : `Complete Pay Run (${wizRunEmployees.length} Payslip${wizRunEmployees.length !== 1 ? 's' : ''})`}
                  </button>
                </div>
              </div>
            )
          ) : null}
        </div>
      )}
    </div>
  )
}
