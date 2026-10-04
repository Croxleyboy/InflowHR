import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { useToast } from '../../context/ToastContext'
import { useFeatures } from '../../context/FeatureContext'
import { formatDate } from '../../lib/formatters'

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

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
  const primaryThreshold = 1048
  const upperEarningsLimit = 4189
  let ni = 0
  if (monthlyGross > primaryThreshold) ni += Math.min(monthlyGross - primaryThreshold, upperEarningsLimit - primaryThreshold) * 0.08
  if (monthlyGross > upperEarningsLimit) ni += (monthlyGross - upperEarningsLimit) * 0.02
  return Math.round(ni * 100) / 100
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
      supabase.from('employees').select('id, first_name, last_name, job_title, department, annual_salary, hourly_rate, pay_frequency, overtime_rate_multiplier, tax_code, payroll_id, employment_category, contract_type, bank_sort_code, bank_account_number, bank_account_name').eq('company_id', selectedCompanyId).eq('is_active', true).order('last_name'),
      supabase.from('xero_integrations').select('id, company_id, sync_status').eq('company_id', selectedCompanyId).maybeSingle(),
      supabase.from('sage_integrations').select('id, company_id, sync_status').eq('company_id', selectedCompanyId).maybeSingle(),
      supabase.from('modulr_integrations').select('id, company_id, status').eq('company_id', selectedCompanyId).maybeSingle(),
    ])
    setPayslips((pRes.data as Payslip[]) || [])
    setEmployees((eRes.data as Employee[]) || [])
    setXeroConnected(!!(xRes.data && (xRes.data as any).sync_status !== 'not_connected'))
    setSageConnected(!!(sRes.data && (sRes.data as any).sync_status !== 'not_connected'))
    setModulrConnected(!!(mRes.data && (mRes.data as any).status === 'active'))

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

    const startDate = new Date(nextYear, nextMonth, 1)
    const endOfMonth = new Date(nextYear, nextMonth + 1, 0)
    const paymentDate = new Date(endOfMonth)
    paymentDate.setDate(paymentDate.getDate() - 3)
    const batch = Date.now().toString(36).slice(-4)

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
        if (new Date(row.enrolled_at) > endOfMonth) continue
        benefitCostMap[row.employee_id] = (benefitCostMap[row.employee_id] || 0) + (bt.monthly_cost || 0)
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
    for (let idx = 0; idx < targetEmployees.length; idx++) {
      const emp = targetEmployees[idx]
      if (!emp.payroll_id) {
        nextPayrollSeq++
        emp.payroll_id = `PAY-${String(nextPayrollSeq).padStart(4, '0')}`
        await supabase.from('employees').update({ payroll_id: emp.payroll_id }).eq('id', emp.id)
      }

      const latest = payslips.find(p => p.employee?.id === emp.id)
      const salary = emp.annual_salary || latest?.annual_salary || 42000
      const gross = Math.round((salary / 12) * 100) / 100
      const benefitDeductions = Math.round((benefitCostMap[emp.id] || 0) * 100) / 100
      const annualAfterSacrifice = salary - (benefitDeductions * 12)
      const tax = latest ? Number(latest.tax) : calcMonthlyTax(annualAfterSacrifice)
      const ni = latest ? Number(latest.national_insurance) : calcMonthlyNI(annualAfterSacrifice)
      const pen = latest ? Number(latest.pension) : Math.round(gross * 0.05 * 100) / 100

      const missing: string[] = []
      if (!emp.annual_salary && !latest?.annual_salary) missing.push('Annual salary')
      if (!emp.tax_code && !latest?.tax_code) missing.push('Tax code')

      const { error } = await supabase.from('payslips').insert({
        employee_id: emp.id, company_id: selectedCompanyId,
        reference_number: `PAY-${nextKey}-${batch}-${String(idx + 1).padStart(3, '0')}`,
        pay_period_start: localDateStr(startDate), pay_period_end: localDateStr(endOfMonth),
        gross_pay: gross, tax, national_insurance: ni, pension: pen, other_deductions: 0,
        monthly_deductions: benefitDeductions,
        net_pay: (gross - benefitDeductions) - tax - ni - pen,
        payment_date: localDateStr(paymentDate),
        status: missing.length > 0 ? 'flagged' : 'draft',
        tax_code: emp.tax_code || latest?.tax_code || '1257L',
        annual_salary: salary, payroll_id: emp.payroll_id,
        payroll_office: missing.length > 0 ? `Missing: ${missing.join(', ')}` : '',
      })
      if (error) errors.push(`${emp.first_name} ${emp.last_name}: ${error.message}`)
    }

    setWizGenerating(false)
    if (errors.length > 0) {
      showError(`Failed to generate ${errors.length} payslip(s)`)
    } else {
      showSuccess(`Generated ${targetEmployees.length} payslips for ${MONTH_NAMES[nextDate.getMonth()]} ${nextDate.getFullYear()}`)
      setWizGenerated(true)
      await loadAll()
    }
  }

  async function wizMarkPaid() {
    const nextDate = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    const nextKey = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}`
    const toMark = payslips.filter(p => p.pay_period_start.startsWith(nextKey) && (p.status === 'draft' || p.status === 'processed'))
    for (const p of toMark) {
      await supabase.from('payslips').update({ status: 'paid' }).eq('id', p.id)
    }
    showSuccess(`Marked ${toMark.length} payslips as paid`)
    setWizComplete(true)
    await loadAll()
  }

  function startRunPayroll() {
    setView('run_payroll')
    setWizStep(1)
    setWizWorkerTypes(new Set())
    setWizGenerated(false)
    setWizComplete(false)
    setWizPayMethod('external')
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
                      <button className="admin-btn admin-btn-primary" style={{ background: wt.colour, fontSize: 13 }} onClick={() => { setPayslipSubTab(wt.key === 'employed' ? 'employed' : 'shift'); setView('payslips') }}>
                        Review Payslips
                      </button>
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
            {['Select Workers', 'Review', 'Generate', 'Submit & Pay', 'Complete'].map((label, i) => {
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
                <button className="admin-btn admin-btn-primary" disabled={wizWorkerTypes.size === 0} onClick={() => setWizStep(2)}>
                  Next: Review →
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Review */}
          {wizStep === 2 && (
            <div className="admin-settings-group" style={{ marginTop: 20 }}>
              <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700 }}>Review Before Generating</h3>
              <p style={{ fontSize: 13, color: 'var(--text-muted, #6b7280)', marginBottom: 16 }}>
                Review the employees and their pay details before generating payslips. Payslips will be created for the next calendar month.
              </p>

              {wizWorkerTypes.has('employed') && employedEmployees.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <h4 style={{ margin: '0 0 8px', fontSize: 14, color: '#5c6bc0' }}>Employed Staff ({employedEmployees.length})</h4>
                  <div style={{ background: 'var(--bg-subtle, #f8f9fa)', borderRadius: 8, padding: 12 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
                      <div className="pn-worker-metric">
                        <span className="pn-worker-metric-value">£{employedEmployees.reduce((s, e) => s + (e.annual_salary || 0), 0).toLocaleString()}</span>
                        <span className="pn-worker-metric-label">Total annual salary</span>
                      </div>
                      <div className="pn-worker-metric">
                        <span className="pn-worker-metric-value">£{Math.round(employedEmployees.reduce((s, e) => s + ((e.annual_salary || 42000) / 12), 0)).toLocaleString()}</span>
                        <span className="pn-worker-metric-label">Est. monthly gross</span>
                      </div>
                      <div className="pn-worker-metric">
                        <span className="pn-worker-metric-value">{employedEmployees.filter(e => !e.tax_code).length}</span>
                        <span className="pn-worker-metric-label">Missing tax codes</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {wizWorkerTypes.has('shift') && shiftEmployees.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <h4 style={{ margin: '0 0 8px', fontSize: 14, color: '#7e57c2' }}>Shift Workers ({shiftEmployees.length})</h4>
                  <div style={{ background: 'var(--bg-subtle, #f8f9fa)', borderRadius: 8, padding: 12 }}>
                    <p style={{ fontSize: 12, color: 'var(--text-muted, #6b7280)', margin: '0 0 8px' }}>
                      Shift worker payslips are calculated from hours worked × hourly rate. Ensure check-in data and timesheets are up to date before generating.
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
                      <div className="pn-worker-metric">
                        <span className="pn-worker-metric-value">£{shiftEmployees.reduce((s, e) => s + (e.hourly_rate || 0), 0).toFixed(2)}</span>
                        <span className="pn-worker-metric-label">Combined hourly rate</span>
                      </div>
                      <div className="pn-worker-metric">
                        <span className="pn-worker-metric-value">{shiftEmployees.filter(e => !e.hourly_rate).length}</span>
                        <span className="pn-worker-metric-label">Missing hourly rates</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {wizWorkerTypes.has('zero_hours') && zeroHoursEmployees.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <h4 style={{ margin: '0 0 8px', fontSize: 14, color: '#ef6c00' }}>Zero Hours Workers ({zeroHoursEmployees.length})</h4>
                  <div style={{ background: 'var(--bg-subtle, #f8f9fa)', borderRadius: 8, padding: 12 }}>
                    <p style={{ fontSize: 12, color: 'var(--text-muted, #6b7280)', margin: '0 0 8px' }}>
                      Zero hours workers have no guaranteed hours. Pay is based entirely on hours actually worked during the period.
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
                      <div className="pn-worker-metric">
                        <span className="pn-worker-metric-value">{zeroHoursEmployees.length}</span>
                        <span className="pn-worker-metric-label">Active workers</span>
                      </div>
                      <div className="pn-worker-metric">
                        <span className="pn-worker-metric-value">{zeroHoursEmployees.filter(e => !e.hourly_rate).length}</span>
                        <span className="pn-worker-metric-label">Missing hourly rates</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
                <button className="admin-btn" onClick={() => setWizStep(1)}>← Back</button>
                <button className="admin-btn admin-btn-primary" onClick={() => setWizStep(3)}>
                  Next: Generate Payslips →
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Generate */}
          {wizStep === 3 && (
            <div className="admin-settings-group" style={{ marginTop: 20 }}>
              <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700 }}>Generate Payslips</h3>
              {!wizGenerated ? (
                <>
                  <p style={{ fontSize: 13, color: 'var(--text-muted, #6b7280)', marginBottom: 16 }}>
                    This will create draft payslips for the next calendar month for the selected worker types. Payslips are generated in draft status — you can review and edit them before submitting.
                  </p>
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
                      {wizGenerating ? 'Generating…' : 'Generate Payslips'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ background: '#e8f5e9', borderRadius: 8, padding: 16, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2e7d32" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                    <div>
                      <strong style={{ color: '#2e7d32' }}>Payslips generated successfully</strong>
                      <p style={{ fontSize: 12, margin: '4px 0 0', color: '#558b2f' }}>Draft payslips have been created. You can review them in the Payslips view before proceeding to payment.</p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                    <button className="admin-btn" onClick={() => { setView('payslips') }}>Review Payslips</button>
                    <button className="admin-btn admin-btn-primary" onClick={() => setWizStep(4)}>
                      Next: Submit & Pay →
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Step 4: Submit & Pay */}
          {wizStep === 4 && (
            <div className="admin-settings-group" style={{ marginTop: 20 }}>
              <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700 }}>Submit & Pay</h3>
              <p style={{ fontSize: 13, color: 'var(--text-muted, #6b7280)', marginBottom: 16 }}>
                Choose how you want to process payment for this payroll run. Select your payment method and confirm.
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

                {xeroConnected && (
                  <label className={`pn-wiz-type-card ${wizPayMethod === 'xero' ? 'pn-wiz-type-selected' : ''}`}>
                    <input type="radio" name="paymethod" checked={wizPayMethod === 'xero'} onChange={() => setWizPayMethod('xero')} style={{ display: 'none' }} />
                    <div className="pn-wiz-type-icon" style={{ background: '#13b5ea' }}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                    </div>
                    <strong>Export to Xero</strong>
                    <span style={{ fontSize: 11, color: 'var(--text-muted, #999)' }}>Sync with Xero payroll</span>
                  </label>
                )}

                {sageConnected && (
                  <label className={`pn-wiz-type-card ${wizPayMethod === 'sage' ? 'pn-wiz-type-selected' : ''}`}>
                    <input type="radio" name="paymethod" checked={wizPayMethod === 'sage'} onChange={() => setWizPayMethod('sage')} style={{ display: 'none' }} />
                    <div className="pn-wiz-type-icon" style={{ background: '#00d639' }}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    </div>
                    <strong>Export to Sage</strong>
                    <span style={{ fontSize: 11, color: 'var(--text-muted, #999)' }}>Upload payslip PDFs</span>
                  </label>
                )}
              </div>

              <div style={{ background: '#e3f2fd', borderRadius: 8, padding: 14, marginBottom: 16 }}>
                <p style={{ fontSize: 13, margin: 0, color: '#1565c0' }}>
                  <strong>Note:</strong> InflowHR captures time and calculates gross pay. Your Sage or Xero account handles the tax engine. The payslips generated here use estimated tax/NI for reference only.
                </p>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button className="admin-btn" onClick={() => setWizStep(3)}>← Back</button>
                <button className="admin-btn admin-btn-primary" onClick={wizMarkPaid}>
                  Confirm & Mark as Paid
                </button>
              </div>
            </div>
          )}

          {/* Step 5: Complete */}
          {wizStep === 5 || wizComplete ? (
            <div className="admin-settings-group" style={{ marginTop: 20, textAlign: 'center', padding: 40 }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#43a047" strokeWidth="2" style={{ marginBottom: 12 }}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700, color: '#2e7d32' }}>Payroll Run Complete</h3>
              <p style={{ fontSize: 13, color: 'var(--text-muted, #6b7280)', marginBottom: 20 }}>
                All payslips have been processed and marked as paid. Employees will see their payslips on their next login.
              </p>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
                <button className="admin-btn" onClick={() => { setView('payslips') }}>View Payslips</button>
                <button className="admin-btn admin-btn-primary" onClick={() => setView('dashboard')}>Back to Dashboard</button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
