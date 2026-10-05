import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { useToast } from '../../context/ToastContext'
import { useFeatures } from '../../context/FeatureContext'
import { useAuth } from '../../context/AuthContext'
import { formatDate } from '../../lib/formatters'

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

function getPeriodBoundaries(year: number, month: number, freq: PayFrequency, fyStartMonth: number): { start: Date; end: Date }[] {
  if (freq === 'monthly') {
    return [{ start: new Date(year, month, 1), end: new Date(year, month + 1, 0) }]
  }
  const fyStartDate = new Date(month >= fyStartMonth - 1 ? year : year - 1, fyStartMonth - 1, 1)
  const daysPerPeriod = freq === 'weekly' ? 7 : 14
  const monthStart = new Date(year, month, 1)
  const monthEnd = new Date(year, month + 1, 0)
  const periods: { start: Date; end: Date }[] = []
  let anchor = new Date(fyStartDate)
  while (anchor <= monthEnd) {
    const periodEnd = new Date(anchor)
    periodEnd.setDate(periodEnd.getDate() + daysPerPeriod - 1)
    if (periodEnd >= monthStart && anchor <= monthEnd) {
      periods.push({
        start: anchor < monthStart ? monthStart : new Date(anchor),
        end: periodEnd > monthEnd ? monthEnd : periodEnd,
      })
    }
    anchor = new Date(anchor)
    anchor.setDate(anchor.getDate() + daysPerPeriod)
    if (anchor > monthEnd) break
  }
  return periods.length > 0 ? periods : [{ start: monthStart, end: monthEnd }]
}

interface WorkerTypeSetting {
  id: number; company_id: string; worker_type: string
  pay_pattern: PayFrequency; overtime_handling: string; time_recording: string
  overtime_rate_multiplier: number
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
}

interface AuditLogEntry {
  id: string; action: string; detail: string | null; employee_id: string | null
  performed_by: string; performer_name: string | null; status: string; created_at: string
}

type View = 'dashboard' | 'payslips' | 'employee_pay' | 'schedule' | 'reporting' | 'logs' | 'run_payroll'

export default function AdminPayrollNew() {
  const { selectedCompanyId, selectedCompany } = useAdminCompany()
  const { showError, showSuccess } = useToast()
  const { features } = useFeatures()
  const { session } = useAuth()

  const [view, setView] = useState<View>('dashboard')
  const [loading, setLoading] = useState(true)
  const [payslips, setPayslips] = useState<Payslip[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [xeroConnected, setXeroConnected] = useState(false)
  const [sageConnected, setSageConnected] = useState(false)
  const [modulrConnected, setModulrConnected] = useState(false)
  const [enabledFeatures, setEnabledFeatures] = useState({ timesheets: false, shifts: false, legal_timesheets: false })
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
  const [payslipSubTab, setPayslipSubTab] = useState<'employed' | 'shift'>('employed')
  const [empBenefits, setEmpBenefits] = useState<Record<string, { title: string; enrolled_at: string; monthly_cost: number }[]>>({})
  const [workerSettings, setWorkerSettings] = useState<WorkerTypeSetting[]>([])
  const [wizPeriodReviews, setWizPeriodReviews] = useState<PeriodReview[]>([])
  const [wizOvertimeHours, setWizOvertimeHours] = useState<Record<string, number>>({})
  const [wizPayRunId, setWizPayRunId] = useState<string | null>(null)
  const [wizExporting, setWizExporting] = useState(false)
  const [wizExported, setWizExported] = useState(false)
  const [wizReleasing, setWizReleasing] = useState(false)
  const [wizUnpaidLeave, setWizUnpaidLeave] = useState<{ employee_id: string; days: number; employee_name: string }[]>([])
  const [wizBenefitChanges, setWizBenefitChanges] = useState<{ employee_id: string; employee_name: string; benefit: string; action: string; monthly_cost: number }[]>([])

  const providerConnected = xeroConnected || sageConnected
  const connectedProvider = xeroConnected ? 'xero' : sageConnected ? 'sage' : null

  // FY
  const fyStartMonth = selectedCompany?.fy_start_month || 4
  const fyMonths = useMemo(() => getFYMonths(fyStartMonth), [fyStartMonth])
  const fyRange = useMemo(() => getFYRange(fyStartMonth), [fyStartMonth])
  const fyLabel = `FY ${fyRange.startYear}/${fyRange.startYear + 1}`

  // Employee categorisation
  const employedEmployees = useMemo(() => employees.filter(e => e.employment_category !== 'shift_worker'), [employees])
  const shiftEmployees = useMemo(() => employees.filter(e => e.employment_category === 'shift_worker' && e.contract_type !== 'Zero hours shift worker'), [employees])
  const zeroHoursEmployees = useMemo(() => employees.filter(e => e.employment_category === 'shift_worker' && e.contract_type === 'Zero hours shift worker'), [employees])

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
    }
  }, [payslips, employees])

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

      let nextPayDate: Date
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

      return { ...t, status, gross, net, nextPayDate }
    })
  }, [payslips, employedEmployees, shiftEmployees, zeroHoursEmployees, currentMonthKey, payDayMode, customPayDay, shiftPayDayMode, shiftCustomPayDay, zeroHrsPayDayMode, zeroHrsCustomPayDay])

  // Data loading
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

  const loadAll = useCallback(async () => {
    setLoading(true)
    const fyStart = localDateStr(fyRange.startDate)
    const fyEnd = localDateStr(fyRange.endDate)
    const [pRes, eRes, xRes, sRes, mRes] = await Promise.all([
      supabase.from('payslips').select('*, employee:employees!payslips_employee_id_fkey(id, first_name, last_name)').eq('company_id', selectedCompanyId).gte('pay_period_start', fyStart).lte('pay_period_start', fyEnd).order('payment_date', { ascending: false }),
      supabase.from('employees').select('id, first_name, last_name, job_title, department, annual_salary, hourly_rate, pay_frequency, overtime_rate_multiplier, tax_code, payroll_id, employment_category, contract_type, bank_sort_code, bank_account_number, bank_account_name, pay_pattern_override, overtime_handling_override, time_recording_override, is_payroll_exception, weekly_hours').eq('company_id', selectedCompanyId).eq('is_active', true).order('last_name'),
      supabase.from('xero_integrations').select('id, company_id, sync_status').eq('company_id', selectedCompanyId).maybeSingle(),
      supabase.from('sage_integrations').select('id, company_id, sync_status').eq('company_id', selectedCompanyId).maybeSingle(),
      supabase.from('modulr_integrations').select('id, company_id, status').eq('company_id', selectedCompanyId).maybeSingle(),
    ])
    setPayslips((pRes.data as Payslip[]) || [])
    setEmployees((eRes.data as Employee[]) || [])
    setXeroConnected(!!(xRes.data && (xRes.data as any).sync_status !== 'not_connected'))
    setSageConnected(!!(sRes.data && (sRes.data as any).sync_status !== 'not_connected'))
    setModulrConnected(!!(mRes.data && (mRes.data as any).status === 'active'))

    // Load worker type settings
    const { data: wtsData } = await supabase.from('worker_type_settings').select('*').eq('company_id', selectedCompanyId)
    setWorkerSettings((wtsData as WorkerTypeSetting[]) || [])

    // Load pay settings from xero_integrations.cached_pay_run
    const settingsRes = await supabase.from('xero_integrations').select('cached_pay_run').eq('company_id', selectedCompanyId).maybeSingle()
    const cpr = ((settingsRes.data as any)?.cached_pay_run as any) || {}
    if (cpr.pay_day_mode) setPayDayMode(cpr.pay_day_mode)
    if (cpr.custom_pay_day) setCustomPayDay(cpr.custom_pay_day)
    if (cpr.shift_pay_day_mode) setShiftPayDayMode(cpr.shift_pay_day_mode)
    if (cpr.shift_custom_pay_day) setShiftCustomPayDay(cpr.shift_custom_pay_day)
    if (cpr.zero_hrs_pay_day_mode) setZeroHrsPayDayMode(cpr.zero_hrs_pay_day_mode)
    if (cpr.zero_hrs_custom_pay_day) setZeroHrsCustomPayDay(cpr.zero_hrs_custom_pay_day)

    // Load recent audit logs
    const { data: logData } = await supabase.from('payroll_audit_log').select('*').eq('company_id', selectedCompanyId).order('created_at', { ascending: false }).limit(5)
    setRecentLogs((logData as AuditLogEntry[]) || [])

    setLoading(false)
  }, [selectedCompanyId, fyRange])

  // Payslip filtering for browse view
  const empCategoryById = useMemo(() => {
    const map: Record<string, string> = {}
    employees.forEach(e => { map[e.id] = e.employment_category || 'not_assigned' })
    return map
  }, [employees])

  const filtered = useMemo(() => {
    const base = payslips.filter(p => {
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
  }, [filterStatus, filterEmployee, payslips, search, payslipSubTab, empCategoryById])

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

  async function loadWizPeriodReviews() {
    if (!selectedCompanyId) return
    const nextDate = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    const nextMonth = nextDate.getMonth()
    const nextYear = nextDate.getFullYear()
    const monthStart = `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}-01`
    const monthEnd = localDateStr(new Date(nextYear, nextMonth + 1, 0))
    const { data } = await supabase.from('pay_period_reviews')
      .select('id, employee_id, period_start, period_end, total_hours, adjusted_hours, overtime_hours, hourly_rate, gross_pay, status')
      .eq('company_id', selectedCompanyId)
      .gte('period_start', monthStart)
      .lte('period_end', monthEnd)
    setWizPeriodReviews((data as PeriodReview[]) || [])
  }

  async function loadWizTimesheets() {
    if (!selectedCompanyId) return
    const nextDate = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    const nextMonth = nextDate.getMonth()
    const nextYear = nextDate.getFullYear()
    const monthStart = `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}-01`
    const monthEnd = localDateStr(new Date(nextYear, nextMonth + 1, 0))
    const { data } = await supabase.from('timesheets')
      .select('employee_id, hours')
      .eq('company_id', selectedCompanyId)
      .eq('status', 'approved')
      .gte('date', monthStart)
      .lte('date', monthEnd)
    const hoursByEmp: Record<string, number> = {}
    if (data) {
      for (const t of data as { employee_id: string; hours: number }[]) {
        hoursByEmp[t.employee_id] = (hoursByEmp[t.employee_id] || 0) + Number(t.hours)
      }
    }

    const autoOvertime: Record<string, number> = {}
    for (const emp of employees) {
      const overtimeHandling = getEffectiveSetting(emp, workerSettings, 'overtime_handling')
      if (overtimeHandling === 'none') continue
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
  }

  async function loadWizAdjustments() {
    if (!selectedCompanyId) return
    const nextDate = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    const nextMonth = nextDate.getMonth()
    const nextYear = nextDate.getFullYear()
    const monthStart = `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}-01`
    const monthEnd = localDateStr(new Date(nextYear, nextMonth + 1, 0))

    const { data: leaveData } = await supabase.from('leave_requests')
      .select('employee_id, days_requested, employees!leave_requests_employee_id_fkey(first_name, last_name)')
      .eq('company_id', selectedCompanyId)
      .eq('status', 'approved')
      .eq('leave_type', 'Unpaid Leave')
      .gte('start_date', monthStart)
      .lte('start_date', monthEnd)
    const unpaid: { employee_id: string; days: number; employee_name: string }[] = []
    if (leaveData) {
      for (const r of leaveData as any[]) {
        const emp = r.employees
        unpaid.push({
          employee_id: r.employee_id,
          days: Number(r.days_requested) || 1,
          employee_name: emp ? `${emp.first_name} ${emp.last_name}` : 'Unknown',
        })
      }
    }
    setWizUnpaidLeave(unpaid)

    const periodStart = new Date(nextYear, nextMonth, 1)
    const recentStart = new Date(periodStart)
    recentStart.setDate(recentStart.getDate() - 30)
    const { data: enrollData } = await supabase.from('benefit_enrollments')
      .select('employee_id, enrolled_at, benefit_type:benefit_types(title, monthly_cost)')
      .eq('company_id', selectedCompanyId)
      .gte('enrolled_at', localDateStr(recentStart))
      .lte('enrolled_at', monthEnd)
    const changes: { employee_id: string; employee_name: string; benefit: string; action: string; monthly_cost: number }[] = []
    if (enrollData) {
      for (const r of enrollData as any[]) {
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
  }

  // Wizard: generate payslips for selected worker types
  async function wizGenerate() {
    setWizGenerating(true)
    const nextDate = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    const nextYear = nextDate.getFullYear()
    const nextMonth = nextDate.getMonth()
    const nextKey = `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}`

    const existingNext = payslips.filter(p => p.pay_period_start.startsWith(nextKey))
    if (existingNext.length > 0) {
      showError(`Payslips for ${MONTH_NAMES[nextMonth]} ${nextYear} already exist`)
      setWizGenerating(false)
      return
    }

    const targetEmployees = employees.filter(e => {
      if (wizWorkerTypes.has('employed') && e.employment_category !== 'shift_worker') return true
      if (wizWorkerTypes.has('shift') && e.employment_category === 'shift_worker' && e.contract_type !== 'Zero hours shift worker') return true
      if (wizWorkerTypes.has('zero_hours') && e.employment_category === 'shift_worker' && e.contract_type === 'Zero hours shift worker') return true
      return false
    })

    if (targetEmployees.length === 0) {
      showError('No employees match the selected worker types')
      setWizGenerating(false)
      return
    }

    const endOfMonth = new Date(nextYear, nextMonth + 1, 0)
    const batch = Date.now().toString(36).slice(-4)
    const monthStart = `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}-01`
    const monthEnd = localDateStr(endOfMonth)

    const workerTypeArr = [...wizWorkerTypes].map(t => t === 'shift' ? 'shift_worker' : t)
    const { data: existingRun } = await supabase.from('pay_runs')
      .select('id').eq('company_id', selectedCompanyId).eq('frequency', 'monthly')
      .eq('period_start', monthStart).eq('period_end', monthEnd).maybeSingle()

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
        company_id: selectedCompanyId, frequency: 'monthly', period_start: monthStart,
        period_end: monthEnd, status: 'generating', worker_types: workerTypeArr,
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
        if (new Date(row.enrolled_at) > endOfMonth) continue
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
      const periods = getPeriodBoundaries(nextYear, nextMonth, freq, fyStartMonth)

      if (isShiftOrZero) {
        const empReview = wizPeriodReviews.find(r => r.employee_id === emp.id && r.status === 'approved')
        if (!empReview) {
          errors.push(`${emp.first_name} ${emp.last_name}: No approved period review`)
          continue
        }

        const reviewGross = Number(empReview.gross_pay)
        const annualised = reviewGross * getPeriodsPerYear(freq)
        const benefitMonthly = benefitCostMapMonthly[emp.id] || 0
        const benefitPeriod = prorateBenefit(benefitMonthly, freq)
        const annualAfterSacrifice = annualised - (benefitMonthly * 12)
        const tax = calcTax(annualAfterSacrifice, freq)
        const ni = calcNI(annualAfterSacrifice, freq)
        const pen = Math.round(reviewGross * 0.05 * 100) / 100

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

          const { error } = await supabase.from('payslips').insert({
            employee_id: emp.id, company_id: selectedCompanyId,
            reference_number: `PAY-${nextKey}-${batch}-${String(payslipIdx).padStart(3, '0')}`,
            pay_period_start: localDateStr(period.start), pay_period_end: localDateStr(period.end),
            pay_period_type: freq,
            source_review_id: empReview.id,
            pay_run_id: payRunId,
            gross_pay: reviewGross, tax, national_insurance: ni, pension: pen, other_deductions: 0,
            monthly_deductions: benefitPeriod,
            net_pay: (reviewGross - benefitPeriod) - tax - ni - pen,
            payment_date: localDateStr(paymentDate),
            status: 'draft',
            tax_code: emp.tax_code || '1257L',
            annual_salary: emp.annual_salary || 0,
            payroll_id: emp.payroll_id,
            overtime: Number(empReview.overtime_hours) || 0,
          })
          if (error) errors.push(`${emp.first_name} ${emp.last_name}: ${error.message}`)
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
        const hourlyFromSalary = salary / (52 * (emp.weekly_hours || 37.5))
        const overtimePay = empOvertimeHrs > 0 ? Math.round(empOvertimeHrs * hourlyFromSalary * multiplier * 100) / 100 : 0

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
            net_pay: (gross - benefitPeriod) + overtimePay - tax - ni - pen,
            payment_date: localDateStr(paymentDate),
            status: missing.length > 0 ? 'flagged' : 'draft',
            tax_code: emp.tax_code || latest?.tax_code || '1257L',
            annual_salary: salary, payroll_id: emp.payroll_id,
            payroll_office: missing.length > 0 ? `Missing: ${missing.join(', ')}` : '',
            overtime: overtimePay,
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
    } else {
      showSuccess(`Generated payslips for ${MONTH_NAMES[nextDate.getMonth()]} ${nextDate.getFullYear()}`)
      setWizGenerated(true)
      await loadAll()
    }
  }

  async function wizPushAdjustments() {
    if (!selectedCompanyId || !session) return
    setWizGenerating(true)
    const nextDate = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    const nextYear = nextDate.getFullYear()
    const nextMonth = nextDate.getMonth()
    const monthStart = `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}-01`
    const monthEnd = localDateStr(new Date(nextYear, nextMonth + 1, 0))

    const workerTypeArr = [...wizWorkerTypes].map(t => t === 'shift' ? 'shift_worker' : t)
    const { data: existingRun } = await supabase.from('pay_runs')
      .select('id').eq('company_id', selectedCompanyId).eq('frequency', 'monthly')
      .eq('period_start', monthStart).eq('period_end', monthEnd).maybeSingle()

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
        company_id: selectedCompanyId, frequency: 'monthly', period_start: monthStart,
        period_end: monthEnd, status: 'generating', payment_method: connectedProvider || 'external',
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
      const adjustments = {
        overtime: Object.entries(wizOvertimeHours).filter(([empId, hrs]) => {
          const emp = employees.find(e => e.id === empId)
          if (!emp) return false
          return hrs > 0 && getEffectiveSetting(emp, workerSettings, 'overtime_handling') !== 'toil'
        }).map(([empId, hrs]) => {
          const emp = employees.find(e => e.id === empId)
          return { employee_id: empId, hours: hrs, multiplier: emp?.overtime_rate_multiplier || 1.5 }
        }),
        unpaid_leave: wizUnpaidLeave.map(u => ({ employee_id: u.employee_id, days: u.days })),
        benefit_changes: wizBenefitChanges.map(b => ({ employee_id: b.employee_id, benefit: b.benefit, monthly_cost: b.monthly_cost })),
      }

      const toilEntries = Object.entries(wizOvertimeHours).filter(([empId, hrs]) => {
        const emp = employees.find(e => e.id === empId)
        if (!emp) return false
        return hrs > 0 && getEffectiveSetting(emp, workerSettings, 'overtime_handling') === 'toil'
      }).map(([empId, hrs]) => ({ employee_id: empId, hours: hrs }))

      const hasAdjustments = adjustments.overtime.length > 0 || adjustments.unpaid_leave.length > 0 || adjustments.benefit_changes.length > 0

      if (hasAdjustments && connectedProvider === 'xero') {
        const { data: xeroResult, error } = await supabase.functions.invoke('xero-push-adjustments', {
          headers: { Authorization: `Bearer ${session.access_token}` },
          body: { company_id: selectedCompanyId, pay_run_id: payRunId, adjustments },
        })
        if (error) {
          let msg = error.message || 'Edge function error'
          try {
            const errBody = await (error as any).context?.json()
            if (errBody?.error) msg = errBody.error
            if (errBody?.detail) msg += ' — ' + errBody.detail
          } catch { /* context not available */ }
          throw new Error(msg)
        }
        if (xeroResult?.error) throw new Error(xeroResult.error)
        if (xeroResult?.pushed === 0 && xeroResult?.skipped > 0) {
          const reasons = (xeroResult.skipped_details || []).map((s: any) => `${s.employee}: ${s.reason}`).join('; ')
          showError(`0 adjustments pushed — all ${xeroResult.skipped} employees skipped. ${reasons}`)
          await supabase.from('pay_runs').update({ status: 'draft' }).eq('id', payRunId)
          setWizGenerating(false)
          return
        }
        if (xeroResult) {
          const parts = [`${xeroResult.pushed} adjustment(s) pushed to Xero (${xeroResult.api} API)`]
          if (xeroResult.failed > 0) parts.push(`${xeroResult.failed} failed`)
          if (xeroResult.skipped > 0) parts.push(`${xeroResult.skipped} skipped`)
          showSuccess(parts.join(', '))
        }
      } else if (hasAdjustments && connectedProvider === 'sage') {
        const targetEmployees = employees.filter(e => {
          if (wizWorkerTypes.has('employed') && e.employment_category !== 'shift_worker') return true
          if (wizWorkerTypes.has('shift') && e.employment_category === 'shift_worker' && e.contract_type !== 'Zero hours shift worker') return true
          if (wizWorkerTypes.has('zero_hours') && e.employment_category === 'shift_worker' && e.contract_type === 'Zero hours shift worker') return true
          return false
        })
        const header = 'Employee ID,Name,Overtime Hours,Overtime Multiplier,Unpaid Leave Days,Benefit Changes'
        const rows = targetEmployees.map(emp => {
          const ot = wizOvertimeHours[emp.id] || 0
          const mul = emp.overtime_rate_multiplier || 1.5
          const unpaid = wizUnpaidLeave.filter(u => u.employee_id === emp.id).reduce((s, u) => s + u.days, 0)
          const bens = wizBenefitChanges.filter(b => b.employee_id === emp.id).map(b => b.benefit).join('; ')
          const safeName = `${emp.first_name} ${emp.last_name}`.replace(/[=+\-@\t\r]/g, "'$&")
          return `${emp.payroll_id || ''},${safeName},${ot},${mul},${unpaid},${bens.replace(/[=+\-@\t\r]/g, "'$&")}`
        })
        const csv = [header, ...rows].join('\n')
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `Sage_Adjustments_${localDateStr(new Date())}.csv`
        a.click()
        URL.revokeObjectURL(url)
      }

      for (const toilEntry of toilEntries) {
        const emp = employees.find(e => e.id === toilEntry.employee_id)
        const dailyHours = ((emp?.weekly_hours || 37.5) / 5)
        const toilDays = Math.round(toilEntry.hours / dailyHours * 100) / 100
        try {
          const { data: lb } = await supabase.from('leave_balances').select('lieu_days').eq('employee_id', toilEntry.employee_id).maybeSingle()
          await supabase.from('leave_balances').update({ lieu_days: (lb?.lieu_days || 0) + toilDays }).eq('employee_id', toilEntry.employee_id)
        } catch { /* non-blocking */ }
      }

      await supabase.from('pay_runs').update({ status: 'exported' }).eq('id', payRunId)
      setWizGenerated(true)
      setWizExported(true)
      if (hasAdjustments && connectedProvider === 'sage') {
        showSuccess('Adjustments exported to Sage CSV — import in Sage, then sync back')
      } else if (!hasAdjustments) {
        showSuccess('TOIL lieu days credited — no adjustment lines were pushed to the provider')
      }
      await loadAll()
    } catch (err: any) {
      showError('Push failed: ' + (err?.message || 'Unknown error'))
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
    } catch (err: any) {
      showError('Export failed: ' + (err?.message || 'Unknown error'))
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
    if (!session) throw new Error('Not authenticated')
    const { data, error } = await supabase.functions.invoke('xero-push-timesheets', {
      headers: { Authorization: `Bearer ${session.access_token}` },
      body: { company_id: selectedCompanyId, pay_run_id: wizPayRunId },
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
    const { data, error } = await supabase.functions.invoke('modulr-payout', {
      headers: { Authorization: `Bearer ${session.access_token}` },
      body: { company_id: selectedCompanyId, pay_run_id: wizPayRunId },
    })
    if (error) throw error
    if (data?.error) throw new Error(data.error)
  }

  // Phase 5: Sync + release
  async function wizSyncXero() {
    if (!session || !selectedCompanyId) return
    setWizExporting(true)
    try {
      const { data, error } = await supabase.functions.invoke('xero-payslips', {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: { company_id: selectedCompanyId },
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      if (wizPayRunId) {
        await supabase.from('pay_runs').update({ status: 'synced' }).eq('id', wizPayRunId)
      }
      showSuccess('Pay run synced from Xero — payslips updated with actual tax/NI')
      await loadAll()
    } catch (err: any) {
      showError('Xero sync failed: ' + (err?.message || 'Unknown error'))
    }
    setWizExporting(false)
  }

  async function wizRelease() {
    if (!wizPayRunId) return
    setWizReleasing(true)
    const nextDate = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    const nextKey = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}`
    const toRelease = payslips.filter(p => p.pay_period_start.startsWith(nextKey) && (p.status === 'draft' || p.status === 'processed'))
    for (const p of toRelease) {
      await supabase.from('payslips').update({ status: 'paid' }).eq('id', p.id)
    }
    await supabase.from('pay_runs').update({ status: 'released', completed_at: new Date().toISOString() }).eq('id', wizPayRunId)
    showSuccess(`Released ${toRelease.length} payslips to employees`)
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
        .in('status', ['generating', 'exported', 'synced'])
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
          setWizStep(4)
          setWizExported(false)
          setWizPayMethod(run.payment_method || 'external')
        } else if (run.status === 'exported') {
          setWizStep(5)
          setWizExported(true)
          setWizPayMethod(run.payment_method || 'external')
        } else if (run.status === 'synced') {
          setWizStep(5)
          setWizExported(true)
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
    setWizReleasing(false)
  }

  function advanceToStep2() {
    if (wizWorkerTypes.has('shift') || wizWorkerTypes.has('zero_hours')) {
      loadWizPeriodReviews()
    }
    loadWizTimesheets()
    if (providerConnected) loadWizAdjustments()
    setWizStep(2)
  }

  function toggleWizWorkerType(t: 'employed' | 'shift' | 'zero_hours') {
    setWizWorkerTypes(prev => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t); else next.add(t)
      return next
    })
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

  if (loading) return <div className="admin-section"><p style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted, #888)' }}>Loading payroll data…</p></div>

  const statusBadge = (status: string) => {
    const map: Record<string, { label: string; cls: string }> = {
      not_started: { label: 'Not Started', cls: 'pn-badge-grey' },
      in_progress: { label: 'In Progress', cls: 'pn-badge-amber' },
      submitted: { label: 'Submitted', cls: 'pn-badge-blue' },
      paid: { label: 'Paid', cls: 'pn-badge-green' },
    }
    const b = map[status] || { label: status, cls: 'pn-badge-grey' }
    return <span className={`pn-badge ${b.cls}`}>{b.label}</span>
  }

  // Breadcrumb nav
  const viewLabels: Record<View, string> = {
    dashboard: 'Dashboard', payslips: 'Payslips', employee_pay: 'Employee Pay',
    schedule: 'Payroll Schedule', reporting: 'Reporting', logs: 'Audit Logs', run_payroll: 'Run Payroll',
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
            <div className="admin-stat-card">
              <div className="admin-stat-icon" style={{ background: '#43a047' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/></svg>
              </div>
              <div className="admin-stat-info">
                <span className="admin-stat-value">£{stats.totalGross.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                <span className="admin-stat-label">Total Gross ({fyLabel})</span>
              </div>
            </div>
            <div className="admin-stat-card">
              <div className="admin-stat-icon" style={{ background: '#1e88e5' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
              </div>
              <div className="admin-stat-info">
                <span className="admin-stat-value">£{stats.totalNet.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                <span className="admin-stat-label">Total Net ({fyLabel})</span>
              </div>
            </div>
            <div className="admin-stat-card">
              <div className="admin-stat-icon" style={{ background: '#ef5350' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M12 3v18"/><path d="M6 6l6 3 6-3"/></svg>
              </div>
              <div className="admin-stat-info">
                <span className="admin-stat-value">£{stats.totalTax.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                <span className="admin-stat-label">Total Tax ({fyLabel})</span>
              </div>
            </div>
          </div>

          {/* Current Month Status per Worker Type */}
          <h3 className="pn-section-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            {MONTH_NAMES[now.getMonth()]} {now.getFullYear()} — Payroll Status
          </h3>

          {workerTypeStats.length === 0 ? (
            <div className="admin-settings-group" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted, #888)' }}>
              No active employees found. Add employees in the People section to get started with payroll.
            </div>
          ) : (
            <div className="pn-worker-cards">
              {workerTypeStats.map(wt => (
                <div key={wt.key} className="pn-worker-card" style={{ borderTop: `4px solid ${wt.colour}` }}>
                  <div className="pn-worker-card-header">
                    <div>
                      <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{wt.label}</h4>
                      <span style={{ fontSize: 12, color: 'var(--text-muted, #6b7280)' }}>{wt.employees.length} employee{wt.employees.length !== 1 ? 's' : ''}</span>
                    </div>
                    {statusBadge(wt.status)}
                  </div>
                  <div className="pn-worker-card-body">
                    <div className="pn-worker-metric">
                      <span className="pn-worker-metric-value">£{wt.gross.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                      <span className="pn-worker-metric-label">Gross this month</span>
                    </div>
                    <div className="pn-worker-metric">
                      <span className="pn-worker-metric-value">£{wt.net.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                      <span className="pn-worker-metric-label">Net this month</span>
                    </div>
                    <div className="pn-worker-metric">
                      <span className="pn-worker-metric-value">{wt.payslips.length}</span>
                      <span className="pn-worker-metric-label">Payslips</span>
                    </div>
                    <div className="pn-worker-metric">
                      <span className="pn-worker-metric-value">{formatDate(wt.nextPayDate.toISOString().split('T')[0])}</span>
                      <span className="pn-worker-metric-label">Next pay date</span>
                    </div>
                  </div>
                  <div className="pn-worker-card-footer">
                    {wt.status === 'not_started' && (
                      <button className="admin-btn admin-btn-primary" style={{ background: wt.colour, fontSize: 13 }} onClick={startRunPayroll}>
                        Run Payroll
                      </button>
                    )}
                    {wt.status === 'in_progress' && (
                      <>
                        <button className="admin-btn admin-btn-primary" style={{ background: wt.colour, fontSize: 13 }} onClick={startRunPayroll}>
                          Continue Pay Run
                        </button>
                        <button className="admin-btn" style={{ fontSize: 13, marginLeft: 6 }} onClick={() => { setPayslipSubTab(wt.key === 'employed' ? 'employed' : 'shift'); setView('payslips') }}>
                          Review Payslips
                        </button>
                      </>
                    )}
                    {(wt.status === 'submitted' || wt.status === 'paid') && (
                      <button className="admin-btn" style={{ fontSize: 13 }} onClick={() => { setPayslipSubTab(wt.key === 'employed' ? 'employed' : 'shift'); setView('payslips') }}>
                        View Payslips
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
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
            {(enabledFeatures.timesheets || enabledFeatures.shifts) && (
              <button className="pn-action-card" onClick={() => setView('reporting')}>
                <div className="pn-action-icon" style={{ background: '#1e88e5' }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></svg>
                </div>
                <div><strong>Reporting</strong><br /><span>Time breakdown and analytics</span></div>
              </button>
            )}
            <button className="pn-action-card" onClick={() => setView('logs')}>
              <div className="pn-action-icon" style={{ background: '#78909c' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              </div>
              <div><strong>Audit Logs</strong><br /><span>Payroll action history</span></div>
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
                <span style={{ fontSize: 13, fontWeight: 600, color: '#e65100' }}>A pay run is in progress. Review your payslips below, then continue the wizard to export and release.</span>
              </div>
              <button className="admin-btn admin-btn-primary" style={{ fontSize: 13, whiteSpace: 'nowrap' }} onClick={startRunPayroll}>Continue Pay Run →</button>
            </div>
          )}
          {/* Employed / Shift sub-tabs */}
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
                borderLeft: 'none', borderRadius: '0 8px 8px 0', cursor: 'pointer',
                background: payslipSubTab === 'shift' ? '#7e57c2' : 'var(--bg-card, #fff)',
                color: payslipSubTab === 'shift' ? '#fff' : 'var(--text, #1a1a2e)',
              }}
            >
              Shift Payslips
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
                        <thead><tr><th>Ref</th><th>Employee</th><th>Gross</th><th>Tax</th><th>NI</th><th>Pension</th><th>Net</th><th>Status</th><th>Actions</th></tr></thead>
                        <tbody>
                          {group.payslips.map(p => {
                            const isPaid = p.status === 'paid'
                            const isDraft = p.status === 'draft'
                            return (
                              <React.Fragment key={p.id}>
                                <tr className={`${expandedId === p.id ? 'admin-row-active' : ''} ${p.status === 'flagged' ? 'admin-row-flagged' : ''}`}>
                                  <td className="admin-td-mono">{p.reference_number}</td>
                                  <td>{p.employee ? `${p.employee.first_name} ${p.employee.last_name}` : '—'}</td>
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
                                    <td colSpan={9}>
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
                    <td>{emp.annual_salary ? `£${Number(emp.annual_salary).toLocaleString()}` : '—'}</td>
                    <td>{emp.hourly_rate ? `£${Number(emp.hourly_rate).toFixed(2)}` : '—'}</td>
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
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {fyMonths.map(m => {
                  const key = `${m.year}-${String(m.month + 1).padStart(2, '0')}`
                  const monthPayslips = payslips.filter(p => p.pay_period_start.startsWith(key))
                  const empIds = new Set(employedEmployees.map(e => e.id))
                  const shiftIds = new Set(shiftEmployees.map(e => e.id))
                  const zeroIds = new Set(zeroHoursEmployees.map(e => e.id))
                  const empCount = monthPayslips.filter(p => p.employee?.id && empIds.has(p.employee.id)).length
                  const shiftCount = monthPayslips.filter(p => p.employee?.id && shiftIds.has(p.employee.id)).length
                  const zeroCount = monthPayslips.filter(p => p.employee?.id && zeroIds.has(p.employee.id)).length
                  const gross = monthPayslips.reduce((s, p) => s + Number(p.gross_pay), 0)
                  const allPaid = monthPayslips.length > 0 && monthPayslips.every(p => p.status === 'paid')
                  const hasDraft = monthPayslips.some(p => p.status === 'draft' || p.status === 'flagged')
                  const startDate = new Date(m.year, m.month, 1)
                  const endDate = new Date(m.year, m.month + 1, 0)
                  const payDate = getPayDay(m.year, m.month, payDayMode, customPayDay)
                  const isPast = endDate < new Date()
                  const status = allPaid ? 'Paid' : hasDraft ? 'Draft' : monthPayslips.length > 0 ? 'Processed' : isPast ? 'No Payslips' : 'Upcoming'
                  const statusCls = allPaid ? 'admin-badge-paid' : hasDraft ? 'admin-badge-draft' : monthPayslips.length > 0 ? 'admin-badge-approved' : 'admin-badge-pending'
                  return (
                    <tr key={key}>
                      <td style={{ fontWeight: 600 }}>{m.label}</td>
                      <td>{formatDate(localDateStr(startDate))} – {formatDate(localDateStr(endDate))}</td>
                      <td>{formatDate(localDateStr(payDate))}</td>
                      <td style={{ textAlign: 'center' }}>{empCount || '—'}</td>
                      <td style={{ textAlign: 'center' }}>{shiftCount || '—'}</td>
                      <td style={{ textAlign: 'center' }}>{zeroCount || '—'}</td>
                      <td>£{gross.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                      <td><span className={`admin-badge ${statusCls}`}>{status}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── REPORTING ──────────────────────────────────────────── */}
      {view === 'reporting' && (
        <div className="admin-settings-group">
          <h3 style={{ margin: '0 0 14px', fontSize: 16, fontWeight: 700 }}>Payroll Reporting</h3>
          <p style={{ fontSize: 13, color: 'var(--text-muted, #6b7280)', marginBottom: 16 }}>
            Time breakdown and payroll analytics are available on the existing Payroll page. This section will be expanded in a future update.
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {(enabledFeatures.timesheets || enabledFeatures.shifts) && (
              <div className="admin-settings-group" style={{ flex: '1 1 280px', minWidth: 280 }}>
                <h4 style={{ margin: '0 0 8px', fontSize: 14 }}>Summary ({MONTH_NAMES[now.getMonth()]} {now.getFullYear()})</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="pn-worker-metric">
                    <span className="pn-worker-metric-value">{employedEmployees.length}</span>
                    <span className="pn-worker-metric-label">Salaried employees</span>
                  </div>
                  <div className="pn-worker-metric">
                    <span className="pn-worker-metric-value">{shiftEmployees.length + zeroHoursEmployees.length}</span>
                    <span className="pn-worker-metric-label">Hourly workers</span>
                  </div>
                  <div className="pn-worker-metric">
                    <span className="pn-worker-metric-value">{stats.draft}</span>
                    <span className="pn-worker-metric-label">Draft payslips</span>
                  </div>
                  <div className="pn-worker-metric">
                    <span className="pn-worker-metric-value">{stats.paid}</span>
                    <span className="pn-worker-metric-label">Paid payslips</span>
                  </div>
                </div>
              </div>
            )}
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

      {/* ── RUN PAYROLL WIZARD ─────────────────────────────────── */}
      {view === 'run_payroll' && (
        <div className="pn-wizard">
          {/* Progress steps */}
          <div className="pn-wizard-steps">
            {(providerConnected
              ? ['Select Workers', 'Review Adjustments', 'Push to Provider', 'Sync Back', 'Release']
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
              <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700 }}>Select Worker Types</h3>
              <p style={{ fontSize: 13, color: 'var(--text-muted, #6b7280)', marginBottom: 16 }}>
                Choose which worker types to include in this payroll run. You can run payroll for all types together or process them separately.
              </p>

              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
                {employedEmployees.length > 0 && (
                  <label className={`pn-wiz-type-card ${wizWorkerTypes.has('employed') ? 'pn-wiz-type-selected' : ''}`} style={{ borderColor: wizWorkerTypes.has('employed') ? '#5c6bc0' : undefined }}>
                    <input type="checkbox" checked={wizWorkerTypes.has('employed')} onChange={() => toggleWizWorkerType('employed')} style={{ display: 'none' }} />
                    <div className="pn-wiz-type-icon" style={{ background: '#5c6bc0' }}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/></svg>
                    </div>
                    <strong>Employed Staff</strong>
                    <span style={{ fontSize: 12, color: 'var(--text-muted, #6b7280)' }}>{employedEmployees.length} employee{employedEmployees.length !== 1 ? 's' : ''}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted, #999)' }}>Monthly salary, fixed gross pay</span>
                  </label>
                )}
                {shiftEmployees.length > 0 && (
                  <label className={`pn-wiz-type-card ${wizWorkerTypes.has('shift') ? 'pn-wiz-type-selected' : ''}`} style={{ borderColor: wizWorkerTypes.has('shift') ? '#7e57c2' : undefined }}>
                    <input type="checkbox" checked={wizWorkerTypes.has('shift')} onChange={() => toggleWizWorkerType('shift')} style={{ display: 'none' }} />
                    <div className="pn-wiz-type-icon" style={{ background: '#7e57c2' }}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    </div>
                    <strong>Shift Workers</strong>
                    <span style={{ fontSize: 12, color: 'var(--text-muted, #6b7280)' }}>{shiftEmployees.length} employee{shiftEmployees.length !== 1 ? 's' : ''}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted, #999)' }}>Hourly rate × hours worked</span>
                  </label>
                )}
                {zeroHoursEmployees.length > 0 && (
                  <label className={`pn-wiz-type-card ${wizWorkerTypes.has('zero_hours') ? 'pn-wiz-type-selected' : ''}`} style={{ borderColor: wizWorkerTypes.has('zero_hours') ? '#ef6c00' : undefined }}>
                    <input type="checkbox" checked={wizWorkerTypes.has('zero_hours')} onChange={() => toggleWizWorkerType('zero_hours')} style={{ display: 'none' }} />
                    <div className="pn-wiz-type-icon" style={{ background: '#ef6c00' }}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    </div>
                    <strong>Zero Hours</strong>
                    <span style={{ fontSize: 12, color: 'var(--text-muted, #6b7280)' }}>{zeroHoursEmployees.length} employee{zeroHoursEmployees.length !== 1 ? 's' : ''}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted, #999)' }}>Variable hours, weekly/fortnightly pay</span>
                  </label>
                )}
              </div>

              {workerTypeStats.length > 1 && (
                <button className="admin-btn" style={{ fontSize: 12, marginBottom: 16 }} onClick={() => {
                  const all = new Set<'employed' | 'shift' | 'zero_hours'>()
                  if (employedEmployees.length > 0) all.add('employed')
                  if (shiftEmployees.length > 0) all.add('shift')
                  if (zeroHoursEmployees.length > 0) all.add('zero_hours')
                  setWizWorkerTypes(all)
                }}>
                  Select All Types
                </button>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button className="admin-btn" onClick={() => setView('dashboard')}>Cancel</button>
                <button className="admin-btn admin-btn-primary" disabled={wizWorkerTypes.size === 0} onClick={advanceToStep2}>
                  Next: Review →
                </button>
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

              {providerConnected && (
                <div style={{ background: '#e3f2fd', borderRadius: 8, padding: 14, marginBottom: 16, borderLeft: '4px solid #1565c0' }}>
                  <strong style={{ color: '#1565c0', fontSize: 14 }}>Connected to {connectedProvider === 'xero' ? 'Xero' : 'Sage'}</strong>
                  <p style={{ fontSize: 12, color: '#1565c0', margin: '4px 0 0' }}>
                    InflowHR will push adjustment lines only — overtime, benefit changes, and unpaid leave deductions. TOIL hours are credited internally as lieu days. Your provider calculates tax, NI, pension, and net pay.
                  </p>
                </div>
              )}

              {wizWorkerTypes.has('employed') && employedEmployees.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <h4 style={{ margin: '0 0 8px', fontSize: 14, color: '#5c6bc0' }}>Employed Staff ({employedEmployees.length})</h4>
                  <div style={{ background: 'var(--bg-subtle, #f8f9fa)', borderRadius: 8, padding: 12 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8, marginBottom: 12 }}>
                      <div className="pn-worker-metric">
                        <span className="pn-worker-metric-value">£{employedEmployees.reduce((s, e) => s + (e.annual_salary || 0), 0).toLocaleString()}</span>
                        <span className="pn-worker-metric-label">Total annual salary</span>
                      </div>
                      <div className="pn-worker-metric">
                        <span className="pn-worker-metric-value">£{Math.round(employedEmployees.reduce((s, e) => s + ((e.annual_salary || 42000) / periodsPerYear), 0)).toLocaleString()}</span>
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
                    {(employedOvertimeHandling === 'overtime' || employedOvertimeHandling === 'toil') && (
                      <div style={{ borderTop: '1px solid var(--border, #e5e7eb)', paddingTop: 10, marginTop: 4 }}>
                        <p style={{ fontSize: 12, fontWeight: 600, margin: '0 0 4px', color: '#5c6bc0' }}>
                          {employedOvertimeHandling === 'toil' ? 'TOIL Hours (auto-calculated from timesheets, adjustable)' : 'Overtime Hours (auto-calculated from timesheets, adjustable)'}
                        </p>
                        {employedOvertimeHandling === 'toil' && (
                          <p style={{ fontSize: 11, color: '#7e57c2', margin: '0 0 8px' }}>Hours will be credited as time off in lieu, not paid.</p>
                        )}
                        <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                          {employedEmployees.map(emp => (
                            <div key={emp.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                              <span style={{ fontSize: 13, minWidth: 160 }}>{emp.first_name} {emp.last_name}</span>
                              <input type="number" min="0" step="0.5" style={{ width: 70, padding: '3px 6px', fontSize: 13, borderRadius: 4, border: '1px solid var(--border, #d1d5db)' }}
                                value={wizOvertimeHours[emp.id] || ''}
                                onChange={e => setWizOvertimeHours(prev => ({ ...prev, [emp.id]: Number(e.target.value) || 0 }))}
                                placeholder="0"
                              />
                              <span style={{ fontSize: 11, color: 'var(--text-muted, #999)' }}>hrs @ {emp.overtime_rate_multiplier || 1.5}x</span>
                              {wizOvertimeHours[emp.id] > 0 && (
                                <span style={{ fontSize: 10, background: '#e8f5e9', color: '#2e7d32', padding: '1px 6px', borderRadius: 3, fontWeight: 600 }}>Auto</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {wizWorkerTypes.has('shift') && shiftEmployees.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <h4 style={{ margin: '0 0 8px', fontSize: 14, color: '#7e57c2' }}>Shift Workers ({shiftEmployees.length})</h4>
                  <div style={{ background: 'var(--bg-subtle, #f8f9fa)', borderRadius: 8, padding: 12 }}>
                    <p style={{ fontSize: 12, color: 'var(--text-muted, #6b7280)', margin: '0 0 8px' }}>
                      Shift worker payslips are generated from approved period reviews (hours worked × hourly rate).
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8, marginBottom: 8 }}>
                      <div className="pn-worker-metric">
                        <span className="pn-worker-metric-value" style={{ color: '#2e7d32' }}>{shiftReviewsApproved.length}</span>
                        <span className="pn-worker-metric-label">Approved reviews</span>
                      </div>
                      <div className="pn-worker-metric">
                        <span className="pn-worker-metric-value" style={{ color: shiftReviewsPending.length > 0 ? '#e65100' : undefined }}>{shiftReviewsPending.length}</span>
                        <span className="pn-worker-metric-label">Pending reviews</span>
                      </div>
                      <div className="pn-worker-metric">
                        <span className="pn-worker-metric-value">£{shiftReviewsApproved.reduce((s, r) => s + Number(r.gross_pay), 0).toFixed(2)}</span>
                        <span className="pn-worker-metric-label">Total approved gross</span>
                      </div>
                      <div className="pn-worker-metric">
                        <span className="pn-worker-metric-value">{shiftReviewsApproved.reduce((s, r) => s + Number(r.adjusted_hours), 0).toFixed(1)}</span>
                        <span className="pn-worker-metric-label">Total approved hours</span>
                      </div>
                    </div>
                    {hasShiftBlocker && (
                      <div style={{ background: '#fff3e0', borderRadius: 6, padding: 10, fontSize: 13 }}>
                        <strong style={{ color: '#e65100' }}>Cannot generate payslips</strong>
                        <p style={{ margin: '4px 0 0', color: '#bf360c', fontSize: 12 }}>
                          {shiftMissingReview.length > 0 && `${shiftMissingReview.length} employee(s) have no period review. `}
                          {shiftReviewsPending.length > 0 && `${shiftReviewsPending.length} review(s) are not yet approved. `}
                          Go to Payroll → Period Review to generate and approve reviews first.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {wizWorkerTypes.has('zero_hours') && zeroHoursEmployees.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <h4 style={{ margin: '0 0 8px', fontSize: 14, color: '#ef6c00' }}>Zero Hours Workers ({zeroHoursEmployees.length})</h4>
                  <div style={{ background: 'var(--bg-subtle, #f8f9fa)', borderRadius: 8, padding: 12 }}>
                    <p style={{ fontSize: 12, color: 'var(--text-muted, #6b7280)', margin: '0 0 8px' }}>
                      Zero hours pay is based entirely on hours actually worked. Approved period reviews required.
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8, marginBottom: 8 }}>
                      <div className="pn-worker-metric">
                        <span className="pn-worker-metric-value" style={{ color: '#2e7d32' }}>{zeroReviewsApproved.length}</span>
                        <span className="pn-worker-metric-label">Approved reviews</span>
                      </div>
                      <div className="pn-worker-metric">
                        <span className="pn-worker-metric-value" style={{ color: zeroReviewsPending.length > 0 ? '#e65100' : undefined }}>{zeroReviewsPending.length}</span>
                        <span className="pn-worker-metric-label">Pending reviews</span>
                      </div>
                      <div className="pn-worker-metric">
                        <span className="pn-worker-metric-value">£{zeroReviewsApproved.reduce((s, r) => s + Number(r.gross_pay), 0).toFixed(2)}</span>
                        <span className="pn-worker-metric-label">Total approved gross</span>
                      </div>
                      <div className="pn-worker-metric">
                        <span className="pn-worker-metric-value">{zeroReviewsApproved.reduce((s, r) => s + Number(r.adjusted_hours), 0).toFixed(1)}</span>
                        <span className="pn-worker-metric-label">Total approved hours</span>
                      </div>
                    </div>
                    {hasZeroBlocker && (
                      <div style={{ background: '#fff3e0', borderRadius: 6, padding: 10, fontSize: 13 }}>
                        <strong style={{ color: '#e65100' }}>Cannot generate payslips</strong>
                        <p style={{ margin: '4px 0 0', color: '#bf360c', fontSize: 12 }}>
                          {zeroMissingReview.length > 0 && `${zeroMissingReview.length} employee(s) have no period review. `}
                          {zeroReviewsPending.length > 0 && `${zeroReviewsPending.length} review(s) are not yet approved. `}
                          Go to Payroll → Period Review to generate and approve reviews first.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {providerConnected && (
                <div style={{ marginBottom: 16 }}>
                  <h4 style={{ margin: '0 0 8px', fontSize: 14, color: '#1565c0' }}>Adjustments Summary</h4>
                  <div style={{ background: 'var(--bg-subtle, #f8f9fa)', borderRadius: 8, padding: 12 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8, marginBottom: 12 }}>
                      <div className="pn-worker-metric">
                        <span className="pn-worker-metric-value">{Object.values(wizOvertimeHours).filter(h => h > 0).length}</span>
                        <span className="pn-worker-metric-label">Employees with overtime</span>
                      </div>
                      <div className="pn-worker-metric">
                        <span className="pn-worker-metric-value">{Object.values(wizOvertimeHours).reduce((s, h) => s + h, 0).toFixed(1)}h</span>
                        <span className="pn-worker-metric-label">Total overtime hours</span>
                      </div>
                      <div className="pn-worker-metric">
                        <span className="pn-worker-metric-value">{wizUnpaidLeave.length}</span>
                        <span className="pn-worker-metric-label">Unpaid leave deductions</span>
                      </div>
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
                            {b.employee_name}: {b.action} — {b.benefit} (£{b.monthly_cost}/mo)
                          </div>
                        ))}
                      </div>
                    )}

                    {Object.values(wizOvertimeHours).every(h => h === 0) && wizUnpaidLeave.length === 0 && wizBenefitChanges.length === 0 && (
                      <p style={{ fontSize: 12, color: '#558b2f', margin: 0, fontStyle: 'italic' }}>
                        No adjustments detected — a clean pay run. Your provider will process standard salaries.
                      </p>
                    )}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
                <button className="admin-btn" onClick={() => setWizStep(1)}>← Back</button>
                <button className="admin-btn admin-btn-primary" disabled={!canProceed} onClick={() => setWizStep(3)}>
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
                {providerConnected ? 'Push Adjustments to Provider' : 'Generate Estimate Payslips'}
              </h3>

              {providerConnected ? (
                !wizGenerated ? (
                  <>
                    <p style={{ fontSize: 13, color: 'var(--text-muted, #6b7280)', marginBottom: 16 }}>
                      This will push the adjustment lines (overtime, benefit changes, unpaid leave) to {connectedProvider === 'xero' ? 'Xero' : 'Sage'}. TOIL hours are credited as lieu days internally and are not sent to the provider.
                    </p>
                    <div style={{ background: 'var(--bg-subtle, #f8f9fa)', borderRadius: 8, padding: 16, marginBottom: 16 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
                        <div className="pn-worker-metric">
                          <span className="pn-worker-metric-value">{(() => {
                            const otCount = Object.entries(wizOvertimeHours).filter(([empId, hrs]) => {
                              const emp = employees.find(e => e.id === empId)
                              return emp && hrs > 0 && getEffectiveSetting(emp, workerSettings, 'overtime_handling') !== 'toil'
                            }).length
                            return otCount + wizUnpaidLeave.length + wizBenefitChanges.length
                          })()}</span>
                          <span className="pn-worker-metric-label">Adjustment lines</span>
                        </div>
                        <div className="pn-worker-metric">
                          <span className="pn-worker-metric-value" style={{ textTransform: 'capitalize' }}>{connectedProvider}</span>
                          <span className="pn-worker-metric-label">Provider</span>
                        </div>
                        <div className="pn-worker-metric">
                          <span className="pn-worker-metric-value">
                            {(() => {
                              const d = new Date(now.getFullYear(), now.getMonth() + 1, 1)
                              return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`
                            })()}
                          </span>
                          <span className="pn-worker-metric-label">Target period</span>
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                      <button className="admin-btn" onClick={() => setWizStep(2)}>← Back</button>
                      {(() => {
                        const otCount = Object.entries(wizOvertimeHours).filter(([empId, hrs]) => {
                          const emp = employees.find(e => e.id === empId)
                          return emp && hrs > 0 && getEffectiveSetting(emp, workerSettings, 'overtime_handling') !== 'toil'
                        }).length
                        const toilCount = Object.entries(wizOvertimeHours).filter(([empId, hrs]) => {
                          const emp = employees.find(e => e.id === empId)
                          return emp && hrs > 0 && getEffectiveSetting(emp, workerSettings, 'overtime_handling') === 'toil'
                        }).length
                        const pushCount = otCount + wizUnpaidLeave.length + wizBenefitChanges.length
                        const totalCount = pushCount + toilCount
                        return (
                          <>
                            <button className="admin-btn admin-btn-primary" disabled={wizGenerating || totalCount === 0} onClick={wizPushAdjustments}>
                              {wizGenerating ? 'Pushing…' : pushCount > 0 ? `Push to ${connectedProvider === 'xero' ? 'Xero' : 'Sage'}` : 'Credit TOIL Lieu Days'}
                            </button>
                            {pushCount === 0 && toilCount > 0 && (
                              <p style={{ fontSize: 12, color: '#7e57c2', marginTop: 8, textAlign: 'right' }}>No adjustment lines to push — TOIL hours will be credited as lieu days only.</p>
                            )}
                            {totalCount === 0 && (
                              <p style={{ fontSize: 12, color: '#e53935', marginTop: 8, textAlign: 'right' }}>No adjustments found for this period.</p>
                            )}
                          </>
                        )
                      })()}
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ background: '#e8f5e9', borderRadius: 8, padding: 16, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2e7d32" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                      <div>
                        <strong style={{ color: '#2e7d32' }}>Adjustments pushed successfully</strong>
                        <p style={{ fontSize: 12, margin: '4px 0 0', color: '#558b2f' }}>
                          Run your pay run in {connectedProvider === 'xero' ? 'Xero' : 'Sage'}, then come back to sync the real payslips.
                        </p>
                      </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                      <button className="admin-btn admin-btn-primary" onClick={() => setWizStep(4)}>
                        Next: Sync Back →
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
                              const d = new Date(now.getFullYear(), now.getMonth() + 1, 1)
                              return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`
                            })()}
                          </span>
                          <span className="pn-worker-metric-label">Target period</span>
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
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

          {/* Step 4: Sync Back (connected) / Export (standalone) */}
          {wizStep === 4 && (
            <div className="admin-settings-group" style={{ marginTop: 20 }}>
              {providerConnected ? (
                <>
                  <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700 }}>Sync Back from {connectedProvider === 'xero' ? 'Xero' : 'Sage'}</h3>
                  <p style={{ fontSize: 13, color: 'var(--text-muted, #6b7280)', marginBottom: 16 }}>
                    After running your pay run in {connectedProvider === 'xero' ? 'Xero' : 'Sage'}, sync the actual payslips back to InflowHR so employees can view their real pay details.
                  </p>

                  {connectedProvider === 'xero' && (
                    <div style={{ background: 'var(--bg-subtle, #f8f9fa)', borderRadius: 8, padding: 14, marginBottom: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <strong style={{ fontSize: 14 }}>Fetch Payslips from Xero</strong>
                          <p style={{ fontSize: 12, color: 'var(--text-muted, #6b7280)', margin: '4px 0 0' }}>
                            This pulls actual tax, NI, deductions, and net pay from your Xero pay run and creates payslips in InflowHR with the real figures.
                          </p>
                        </div>
                        <button className="admin-btn admin-btn-primary" disabled={wizExporting} onClick={async () => {
                          await wizSyncXero()
                          setWizExported(true)
                        }} style={{ fontSize: 13 }}>
                          {wizExporting ? 'Syncing…' : 'Fetch Pay Run'}
                        </button>
                      </div>
                    </div>
                  )}

                  {connectedProvider === 'sage' && (
                    <div style={{ background: 'var(--bg-subtle, #f8f9fa)', borderRadius: 8, padding: 14, marginBottom: 12 }}>
                      <strong style={{ fontSize: 14 }}>Import Payslips from Sage</strong>
                      <p style={{ fontSize: 12, color: 'var(--text-muted, #6b7280)', margin: '4px 0 0' }}>
                        After running payroll in Sage, upload the PDF payslips from the Payslips view. Sage will parse and create employee payslips with the actual figures.
                      </p>
                      <button className="admin-btn" style={{ marginTop: 8, fontSize: 13 }} onClick={() => setView('payslips')}>
                        Go to Payslips to Upload
                      </button>
                    </div>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
                    <button className="admin-btn" onClick={() => setWizStep(3)}>← Back</button>
                    <button className="admin-btn admin-btn-primary" onClick={() => setWizStep(5)}>
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

          {/* Step 5: Sync & Release */}
          {wizStep === 5 || wizComplete ? (
            wizComplete ? (
              <div className="admin-settings-group" style={{ marginTop: 20, textAlign: 'center', padding: 40 }}>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#43a047" strokeWidth="2" style={{ marginBottom: 12 }}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700, color: '#2e7d32' }}>Payroll Run Complete</h3>
                <p style={{ fontSize: 13, color: 'var(--text-muted, #6b7280)', marginBottom: 20 }}>
                  Payslips have been released. Employees will see them on their next login.
                </p>
                <div style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
                  <button className="admin-btn" onClick={() => setView('payslips')}>View Payslips</button>
                  <button className="admin-btn admin-btn-primary" onClick={() => setView('dashboard')}>Back to Dashboard</button>
                </div>
              </div>
            ) : (
              <div className="admin-settings-group" style={{ marginTop: 20 }}>
                <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700 }}>
                  {providerConnected ? 'Release Payslips' : 'Sync & Release'}
                </h3>
                <p style={{ fontSize: 13, color: 'var(--text-muted, #6b7280)', marginBottom: 16 }}>
                  {providerConnected
                    ? 'Payslips have been synced from your provider. Release them to make them visible to employees.'
                    : 'Release the estimate payslips to employees. They will see them on their next login.'}
                </p>

                {!providerConnected && wizPayMethod === 'external' && (
                  <div style={{ background: '#e3f2fd', borderRadius: 8, padding: 14, marginBottom: 12 }}>
                    <p style={{ fontSize: 13, margin: 0, color: '#1565c0' }}>
                      When your external payroll is complete, release the payslips below so employees can view them.
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

                <div style={{ background: '#fff8e1', borderRadius: 8, padding: 14, marginBottom: 16, borderLeft: '4px solid #ffa000' }}>
                  <strong style={{ color: '#e65100', fontSize: 14 }}>Release to Employees</strong>
                  <p style={{ fontSize: 12, color: '#bf360c', margin: '4px 0 0' }}>
                    Once released, employees will see their payslips in their app. This cannot be undone.
                  </p>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                  <button className="admin-btn" onClick={() => setWizStep(4)}>← Back</button>
                  <button className="admin-btn admin-btn-primary" disabled={wizReleasing} onClick={wizRelease} style={{ background: '#2e7d32' }}>
                    {wizReleasing ? 'Releasing…' : 'Release Payslips to Employees'}
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
