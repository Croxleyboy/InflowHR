import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { useToast } from '../../context/ToastContext'
import { formatDate } from '../../lib/formatters'

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
  source: string
  xero_payslip_id: string | null
  employee: { id: string; first_name: string; last_name: string } | null
}

interface XeroConfig {
  id: string
  company_id: string
  is_enabled: boolean
  client_id: string
  client_secret: string
  tenant_id: string
  redirect_uri: string
  sync_status: string
  sync_error: string | null
  last_sync_at: string | null
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

const PAYROLL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export default function AdminPayroll() {
  const { selectedCompanyId } = useAdminCompany()
  const { showError, showSuccess } = useToast()
  const [payslips, setPayslips] = useState<Payslip[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'payslips' | 'schedule' | 'employees' | 'time_breakdown' | 'analytics' | 'xero_pay'>('payslips')
  const [filterEmployee, setFilterEmployee] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<Record<string, any>>({})
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [generating, setGenerating] = useState(false)
  const [empEditId, setEmpEditId] = useState<string | null>(null)
  const [empForm, setEmpForm] = useState<Record<string, any>>({})
  const [empBenefits, setEmpBenefits] = useState<Record<string, { title: string; enrolled_at: string; monthly_cost: number }[]>>({})

  // Xero integration state
  const [xeroConfig, setXeroConfig] = useState<XeroConfig | null>(null)
  const [xeroForm, setXeroForm] = useState({ client_id: '', client_secret: '', tenant_id: '', redirect_uri: '' })
  const [xeroSaving, setXeroSaving] = useState(false)
  const [xeroSyncing, setXeroSyncing] = useState(false)
  const [xeroAuthCode, setXeroAuthCode] = useState('')

  const [enabledFeatures, setEnabledFeatures] = useState({ timesheets: false, shifts: false, legal_timesheets: false })
  const [tbPeriodStart, setTbPeriodStart] = useState(() => {
    const d = new Date(); d.setDate(1); return d.toISOString().split('T')[0]
  })
  const [tbPeriodEnd, setTbPeriodEnd] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() + 1, 0); return d.toISOString().split('T')[0]
  })
  const [tbData, setTbData] = useState<Record<string, { shiftHrs: number; shiftEntries: any[]; tsHrs: number; tsEntries: any[]; legalHrs: number; legalEntries: any[] }>>({})
  const [tbLoading, setTbLoading] = useState(false)
  const [tbExpandedEmp, setTbExpandedEmp] = useState<string | null>(null)
  const [tbFilterEmp, setTbFilterEmp] = useState('')

  const [anPeriodStart, setAnPeriodStart] = useState(() => {
    const d = new Date(); d.setDate(1); return d.toISOString().split('T')[0]
  })
  const [anPeriodEnd, setAnPeriodEnd] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() + 1, 0); return d.toISOString().split('T')[0]
  })
  const [anLoading, setAnLoading] = useState(false)
  const [anData, setAnData] = useState<{
    empMetrics: { id: string; name: string; dept: string; weeklyHrs: number; tsHrs: number; shiftHrs: number; legalHrs: number; totalHrs: number; contractedPeriodHrs: number }[]
    projectBreakdown: { project: string; customer: string; hours: number }[]
    legalClientBreakdown: { client: string; matter: string; hours: number }[]
    weeklySubmissions: { week: string; count: number; hours: number }[]
  }>({ empMetrics: [], projectBreakdown: [], legalClientBreakdown: [], weeklySubmissions: [] })

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
    const [pRes, eRes, xRes] = await Promise.all([
      supabase.from('payslips').select('*, employee:employees!payslips_employee_id_fkey(id, first_name, last_name)').eq('company_id', selectedCompanyId).order('payment_date', { ascending: false }),
      supabase.from('employees').select('id, first_name, last_name, job_title, department, annual_salary, tax_code, payroll_id').eq('company_id', selectedCompanyId).eq('is_active', true).order('last_name'),
      supabase.from('company_xero_config').select('id, company_id, is_enabled, client_id, client_secret, tenant_id, redirect_uri, sync_status, sync_error, last_sync_at').eq('company_id', selectedCompanyId).maybeSingle(),
    ])
    setPayslips((pRes.data as Payslip[]) || [])
    setEmployees((eRes.data as Employee[]) || [])
    if (xRes.data) {
      setXeroConfig(xRes.data as XeroConfig)
      setXeroForm({
        client_id: xRes.data.client_id || '',
        client_secret: xRes.data.client_secret || '',
        tenant_id: xRes.data.tenant_id || '',
        redirect_uri: xRes.data.redirect_uri || '',
      })
    } else {
      setXeroConfig(null)
    }
    setLoading(false)
  }

  function startEdit(p: Payslip) {
    setEditingId(p.id)
    setEditForm({ gross_pay: p.gross_pay, tax: p.tax, national_insurance: p.national_insurance, pension: p.pension, other_deductions: p.other_deductions, net_pay: p.net_pay, status: p.status, tax_code: p.tax_code, overtime: p.overtime, adjustments: p.adjustments })
  }

  async function saveEdit(id: number) {
    const net = Number(editForm.gross_pay) + Number(editForm.overtime) + Number(editForm.adjustments) - Number(editForm.tax) - Number(editForm.national_insurance) - Number(editForm.pension) - Number(editForm.other_deductions)
    const { error } = await supabase.from('payslips').update({ ...editForm, net_pay: net }).eq('id', id)
    if (error) { showError('Failed to save payslip: ' + error.message); return }
    setEditingId(null)
    loadAll()
    showSuccess('Payslip saved')
  }

  async function deletePayslip(id: number) {
    if (!confirm('Delete this payslip?')) return
    const { error } = await supabase.from('payslips').delete().eq('id', id)
    if (error) { showError('Failed to delete payslip: ' + error.message); return }
    setPayslips(prev => prev.filter(p => p.id !== id))
    showSuccess('Payslip deleted')
  }

  async function generateNextPayroll() {
    setGenerating(true)
    const now = new Date()
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    const endOfMonth = new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0)
    const paymentDate = new Date(endOfMonth)
    paymentDate.setDate(paymentDate.getDate() - 3)
    const ref = `PAY-${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}`

    const errors: string[] = []
    for (const emp of employees) {
      const latest = payslips.find(p => p.employee?.id === emp.id)
      const salary = emp.annual_salary || latest?.annual_salary || 42000
      const gross = Math.round((salary / 12) * 100) / 100
      const tax = latest ? Number(latest.tax) : Math.round(gross * 0.2 * 100) / 100
      const ni = latest ? Number(latest.national_insurance) : Math.round(gross * 0.12 * 100) / 100
      const pension = latest ? Number(latest.pension) : Math.round(gross * 0.05 * 100) / 100

      const { error } = await supabase.from('payslips').insert({
        employee_id: emp.id,
        reference_number: `${ref}-${emp.id.slice(0, 4)}`,
        pay_period_start: nextMonth.toISOString().split('T')[0],
        pay_period_end: endOfMonth.toISOString().split('T')[0],
        gross_pay: gross, tax, national_insurance: ni, pension,
        other_deductions: 0,
        net_pay: gross - tax - ni - pension,
        payment_date: paymentDate.toISOString().split('T')[0],
        status: 'draft',
        tax_code: emp.tax_code || latest?.tax_code || '1257L',
        annual_salary: salary,
        payroll_id: emp.payroll_id || latest?.payroll_id || '',
      }).select()
      if (error) errors.push(`${emp.first_name} ${emp.last_name}: ${error.message}`)
    }
    setGenerating(false)
    if (errors.length > 0) {
      showError(`Failed to generate ${errors.length} payslip(s): ${errors[0]}`)
    } else {
      showSuccess('Next payroll generated')
    }
    loadAll()
  }

  const xeroPayslips = useMemo(() => payslips.filter(p => p.source === 'xero'), [payslips])
  const inflowPayslips = useMemo(() => payslips.filter(p => p.source !== 'xero'), [payslips])

  const filtered = useMemo(() => {
    const sourceFiltered = xeroConfig?.is_enabled ? xeroPayslips : inflowPayslips
    return sourceFiltered.filter(p => {
      if (filterStatus && p.status !== filterStatus) return false
      if (filterEmployee && p.employee && `${p.employee.first_name} ${p.employee.last_name}` !== filterEmployee) return false
      return true
    })
  }, [payslips, filterStatus, filterEmployee, xeroConfig?.is_enabled, xeroPayslips, inflowPayslips])

  const empNames = useMemo(() => {
    const names = new Set<string>()
    payslips.forEach(p => { if (p.employee) names.add(`${p.employee.first_name} ${p.employee.last_name}`) })
    return Array.from(names).sort()
  }, [payslips])

  const stats = useMemo(() => ({
    total: payslips.length,
    draft: payslips.filter(p => p.status === 'draft').length,
    processed: payslips.filter(p => p.status === 'processed').length,
    paid: payslips.filter(p => p.status === 'paid').length,
    totalGross: payslips.reduce((s, p) => s + Number(p.gross_pay), 0),
    totalNet: payslips.reduce((s, p) => s + Number(p.net_pay), 0),
  }), [payslips])

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

    const queries: Promise<void>[] = []

    if (enabledFeatures.timesheets) {
      queries.push((async () => {
        const { data } = await supabase.from('timesheets')
          .select('employee_id, date, hours, project_id, customer, project:customer_projects!timesheets_project_id_fkey(name, customer_name)')
          .eq('company_id', selectedCompanyId).neq('status', 'rejected')
          .gte('date', anPeriodStart).lte('date', anPeriodEnd)
        if (data) for (const row of data as any[]) {
          if (empMap[row.employee_id]) empMap[row.employee_id].tsHrs += Number(row.hours) || 0
          const projName = row.project?.name || row.customer || 'Unassigned'
          const custName = row.project?.customer_name || row.customer || 'Unassigned'
          const pKey = `${custName}|||${projName}`
          if (!projectMap[pKey]) projectMap[pKey] = { customer: custName, hours: 0 }
          projectMap[pKey].hours += Number(row.hours) || 0

          const weekStart = getWeekStart(row.date)
          if (!weekMap[weekStart]) weekMap[weekStart] = { count: 0, hours: 0 }
          weekMap[weekStart].count++
          weekMap[weekStart].hours += Number(row.hours) || 0
        }
      })())
    }

    if (enabledFeatures.shifts) {
      queries.push((async () => {
        const { data } = await supabase.from('shift_assignments')
          .select('employee_id, date, shift_templates(name, start_time, end_time, break_minutes), rotas(status)')
          .eq('company_id', selectedCompanyId)
          .gte('date', anPeriodStart).lte('date', anPeriodEnd)
        if (data) for (const row of data as any[]) {
          if (row.rotas?.status === 'draft') continue
          const tmpl = row.shift_templates as any
          if (!tmpl || !empMap[row.employee_id]) continue
          const startMins = parseInt(tmpl.start_time?.split(':')[0]) * 60 + parseInt(tmpl.start_time?.split(':')[1] || '0')
          const endMins = parseInt(tmpl.end_time?.split(':')[0]) * 60 + parseInt(tmpl.end_time?.split(':')[1] || '0')
          const hrs = Math.max(0, (endMins - startMins - (tmpl.break_minutes || 0)) / 60)
          empMap[row.employee_id].shiftHrs += hrs
        }
      })())
    }

    if (enabledFeatures.legal_timesheets) {
      queries.push((async () => {
        const { data } = await supabase.from('legal_timesheet_entries')
          .select('employee_id, date, duration_hrs, client:legal_clients!legal_timesheet_entries_client_id_fkey(name), matter:legal_matters!legal_timesheet_entries_matter_id_fkey(name)')
          .eq('company_id', selectedCompanyId).neq('status', 'rejected')
          .gte('date', anPeriodStart).lte('date', anPeriodEnd)
        if (data) for (const row of data as any[]) {
          if (empMap[row.employee_id]) empMap[row.employee_id].legalHrs += Number(row.duration_hrs) || 0
          const cName = row.client?.name || 'Unknown'
          const mName = row.matter?.name || 'Unknown'
          const lKey = `${cName}|||${mName}`
          if (!legalMap[lKey]) legalMap[lKey] = { matter: mName, hours: 0 }
          legalMap[lKey].hours += Number(row.duration_hrs) || 0
        }
      })())
    }

    await Promise.all(queries)

    const periodDays = Math.max(1, (new Date(anPeriodEnd).getTime() - new Date(anPeriodStart).getTime()) / 86400000 + 1)
    const periodWeeks = periodDays / 7

    const empMetrics = Object.entries(empMap).map(([id, d]) => ({
      id, name: d.name, dept: d.dept, weeklyHrs: d.weeklyHrs,
      tsHrs: d.tsHrs, shiftHrs: d.shiftHrs, legalHrs: d.legalHrs,
      totalHrs: d.tsHrs + d.shiftHrs + d.legalHrs,
      contractedPeriodHrs: d.weeklyHrs * periodWeeks,
    })).filter(e => e.totalHrs > 0).sort((a, b) => b.totalHrs - a.totalHrs)

    const projectBreakdown = Object.entries(projectMap).map(([key, v]) => {
      const [customer, project] = key.split('|||')
      return { project, customer, hours: v.hours }
    }).sort((a, b) => b.hours - a.hours)

    const legalClientBreakdown = Object.entries(legalMap).map(([key, v]) => {
      const [client] = key.split('|||')
      return { client, matter: v.matter, hours: v.hours }
    }).sort((a, b) => b.hours - a.hours)

    const weeklySubmissions = Object.entries(weekMap)
      .map(([week, v]) => ({ week, ...v }))
      .sort((a, b) => a.week.localeCompare(b.week))

    setAnData({ empMetrics, projectBreakdown, legalClientBreakdown, weeklySubmissions })
    setAnLoading(false)
  }, [selectedCompanyId, anPeriodStart, anPeriodEnd, employees, enabledFeatures])

  function getWeekStart(dateStr: string) {
    const d = new Date(dateStr + 'T00:00:00')
    const day = d.getDay()
    const diff = d.getDate() - day + (day === 0 ? -6 : 1)
    d.setDate(diff)
    return d.toISOString().split('T')[0]
  }

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
      new Date(r.date + 'T00:00:00').toLocaleDateString('en-GB'),
      (r.client as any)?.name || '', (r.matter as any)?.name || '',
      r.task_code, String(r.duration_hrs), r.narrative || '', r.status,
    ])
    downloadCsv(`legal-timesheets-${anPeriodStart}-to-${anPeriodEnd}.csv`,
      ['Employee', 'Date', 'Client', 'Matter', 'Task Code', 'Hours', 'Narrative', 'Status'], rows)
    showSuccess('Legal timesheets CSV downloaded')
  }

  async function exportShiftsCsv() {
    if (!confirm('This export contains employee shift data.\n\nThis action will be logged. Proceed?')) return
    const { data } = await supabase.from('shift_assignments')
      .select('employee_id, date, shift_templates(name, start_time, end_time, break_minutes), rotas(name, status)')
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
        new Date(r.date + 'T00:00:00').toLocaleDateString('en-GB'),
        tmpl?.name || '', tmpl?.start_time?.slice(0, 5) || '', tmpl?.end_time?.slice(0, 5) || '',
        String(hrs.toFixed(1)), r.rotas?.name || '',
      ]
    })
    downloadCsv(`shifts-rotas-${anPeriodStart}-to-${anPeriodEnd}.csv`,
      ['Employee', 'Date', 'Shift', 'Start', 'End', 'Hours', 'Rota'], rows)
    showSuccess('Shifts & rotas CSV downloaded')
  }

  async function exportAdjustmentsCsv() {
    if (!confirm('This export contains employee financial data (leave, overtime, adjustments).\n\nThis action will be logged. Proceed?')) return
    const empLookup: Record<string, string> = {}
    employees.forEach(e => { empLookup[e.id] = `${e.first_name} ${e.last_name}` })

    const rows: string[][] = []

    const [leaveRes, payslipRes] = await Promise.all([
      supabase.from('leave_requests')
        .select('employee_id, start_date, end_date, leave_type, status, total_days')
        .eq('company_id', selectedCompanyId).eq('status', 'approved')
        .gte('start_date', anPeriodStart).lte('start_date', anPeriodEnd),
      supabase.from('payslips')
        .select('employee_id, pay_period_start, overtime, adjustments, employee:employees!payslips_employee_id_fkey(first_name, last_name)')
        .eq('company_id', selectedCompanyId)
        .gte('pay_period_start', anPeriodStart).lte('pay_period_start', anPeriodEnd),
    ])

    if (leaveRes.data) {
      for (const r of leaveRes.data as any[]) {
        const lType = (r.leave_type || '').toLowerCase()
        if (lType.includes('unpaid') || lType.includes('sick') || lType.includes('compassionate')) {
          rows.push([
            empLookup[r.employee_id] || r.employee_id,
            new Date(r.start_date + 'T00:00:00').toLocaleDateString('en-GB'),
            new Date(r.end_date + 'T00:00:00').toLocaleDateString('en-GB'),
            'Leave', r.leave_type, String(r.total_days || 0), '0', '',
          ])
        }
      }
    }

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

  // ── Xero helpers ──

  async function saveXeroConfig() {
    if (!selectedCompanyId) return
    setXeroSaving(true)
    if (xeroConfig) {
      const { error } = await supabase.from('company_xero_config').update({
        client_id: xeroForm.client_id,
        client_secret: xeroForm.client_secret,
        tenant_id: xeroForm.tenant_id,
        redirect_uri: xeroForm.redirect_uri,
        updated_at: new Date().toISOString(),
      }).eq('id', xeroConfig.id)
      if (error) { showError('Failed to save Xero config: ' + error.message); setXeroSaving(false); return }
    } else {
      const { error } = await supabase.from('company_xero_config').insert({
        company_id: selectedCompanyId,
        client_id: xeroForm.client_id,
        client_secret: xeroForm.client_secret,
        tenant_id: xeroForm.tenant_id,
        redirect_uri: xeroForm.redirect_uri,
      })
      if (error) { showError('Failed to save Xero config: ' + error.message); setXeroSaving(false); return }
    }
    showSuccess('Xero configuration saved')
    setXeroSaving(false)
    loadAll()
  }

  async function toggleXeroEnabled(enabled: boolean) {
    if (!selectedCompanyId) return
    if (!xeroConfig) {
      const { error } = await supabase.from('company_xero_config').insert({
        company_id: selectedCompanyId,
        is_enabled: enabled,
      })
      if (error) { showError('Failed to update: ' + error.message); return }
    } else {
      const { error } = await supabase.from('company_xero_config').update({
        is_enabled: enabled,
        updated_at: new Date().toISOString(),
      }).eq('id', xeroConfig.id)
      if (error) { showError('Failed to update: ' + error.message); return }
    }
    showSuccess(enabled ? 'Xero Payslips enabled' : 'InflowHR Payslips enabled')
    loadAll()
  }

  async function callXeroProxy(action: string, extra: Record<string, unknown> = {}) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { showError('Not authenticated'); return null }
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    const res = await fetch(`${supabaseUrl}/functions/v1/xero-proxy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ action, company_id: selectedCompanyId, ...extra }),
    })
    const data = await res.json()
    if (!res.ok) { showError(data.error || 'Xero request failed'); return null }
    return data
  }

  async function connectXero() {
    const result = await callXeroProxy('get_auth_url')
    if (result?.url) {
      window.open(result.url, '_blank', 'width=600,height=700')
    }
  }

  async function submitXeroAuthCode() {
    if (!xeroAuthCode.trim()) { showError('Please enter the authorization code'); return }
    setXeroSaving(true)
    const result = await callXeroProxy('exchange_code', { code: xeroAuthCode.trim() })
    setXeroSaving(false)
    if (result?.success) {
      showSuccess('Connected to Xero successfully')
      setXeroAuthCode('')
      loadAll()
    }
  }

  async function syncXeroPayslips() {
    setXeroSyncing(true)
    const result = await callXeroProxy('sync_payslips')
    setXeroSyncing(false)
    if (result?.success) {
      showSuccess(`Synced ${result.synced} payslip(s) from ${result.payRuns} pay run(s) (${result.skipped} skipped)`)
      loadAll()
    }
  }

  async function disconnectXero() {
    if (!confirm('Disconnect from Xero? Existing synced payslips will remain.')) return
    await callXeroProxy('disconnect')
    showSuccess('Disconnected from Xero')
    loadAll()
  }

  function startEmpEdit(emp: Employee) {
    setEmpEditId(emp.id)
    const latest = payslips.find(p => p.employee?.id === emp.id)
    setEmpForm({ annual_salary: emp.annual_salary || latest?.annual_salary || 0, tax_code: emp.tax_code || latest?.tax_code || '1257L', pension_pct: latest ? (Number(latest.pension) / Number(latest.gross_pay) * 100).toFixed(1) : '5.0' })
  }

  return (
    <div className="admin-section">
      <div className="admin-page-header">
        <h2>Payroll Management</h2>
        <p>{payslips.length} payslips · {employees.length} employees</p>
      </div>

      <div className="admin-mini-stats">
        <div className="admin-mini-stat"><span className="admin-mini-value">{stats.total}</span><span>Total</span></div>
        <div className="admin-mini-stat"><span className="admin-mini-value" style={{color:'#ff9800'}}>{stats.draft}</span><span>Draft</span></div>
        <div className="admin-mini-stat"><span className="admin-mini-value" style={{color:'#5b9bd5'}}>{stats.processed}</span><span>Processed</span></div>
        <div className="admin-mini-stat"><span className="admin-mini-value" style={{color:'#43a047'}}>{stats.paid}</span><span>Paid</span></div>
      </div>

      <div className="admin-tabs">
        <button className={`admin-tab ${tab === 'payslips' ? 'admin-tab-active' : ''}`} onClick={() => setTab('payslips')}>Payslips</button>
        <button className={`admin-tab ${tab === 'xero_pay' ? 'admin-tab-active' : ''}`} onClick={() => setTab('xero_pay')}>Xero Pay</button>
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
          {/* Payslip source toggle */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', marginBottom: 12,
            background: 'var(--bg-card, #fff)', borderRadius: 8, border: '1px solid var(--border, #e5e7eb)',
          }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text, #1a1a2e)' }}>Payslip Source:</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
              <input
                type="radio"
                name="payslipSource"
                checked={!xeroConfig?.is_enabled}
                onChange={() => toggleXeroEnabled(false)}
              />
              InflowHR Payslips
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
              <input
                type="radio"
                name="payslipSource"
                checked={!!xeroConfig?.is_enabled}
                onChange={() => toggleXeroEnabled(true)}
              />
              Xero Payslips
            </label>
            {xeroConfig?.is_enabled && xeroConfig.sync_status === 'connected' && (
              <span className="admin-badge admin-badge-approved" style={{ marginLeft: 8 }}>Connected</span>
            )}
            {xeroConfig?.is_enabled && xeroConfig.sync_status !== 'connected' && (
              <span className="admin-badge admin-badge-pending" style={{ marginLeft: 8 }}>
                {xeroConfig.sync_status === 'not_connected' ? 'Not Connected' : xeroConfig.sync_status}
              </span>
            )}
          </div>

          <div className="admin-filters">
            <select value={filterEmployee} onChange={e => setFilterEmployee(e.target.value)} className="admin-select">
              <option value="">All Employees</option>
              {empNames.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="admin-select">
              <option value="">All Statuses</option>
              <option value="draft">Draft</option><option value="processed">Processed</option><option value="paid">Paid</option>
            </select>
            {!xeroConfig?.is_enabled && (
              <button className="admin-btn admin-btn-primary" onClick={generateNextPayroll} disabled={generating}>
                {generating ? 'Generating...' : '+ Generate Next Payroll'}
              </button>
            )}
            {xeroConfig?.is_enabled && xeroConfig.sync_status === 'connected' && (
              <button className="admin-btn admin-btn-primary" onClick={syncXeroPayslips} disabled={xeroSyncing}>
                {xeroSyncing ? 'Syncing...' : '↻ Sync from Xero'}
              </button>
            )}
          </div>

          {loading ? <div className="admin-loading">Loading...</div> : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>Ref</th><th>Employee</th><th>Period</th><th>Gross</th><th>Net</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {filtered.map(p => (
                    <>
                      <tr key={p.id} className={expandedId === p.id ? 'admin-row-active' : ''}>
                        <td className="admin-td-mono">{p.reference_number}</td>
                        <td>{p.employee ? `${p.employee.first_name} ${p.employee.last_name}` : '—'}</td>
                        <td>{new Date(p.pay_period_start).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}</td>
                        <td>{editingId === p.id ? <input type="number" className="admin-inline-input admin-inline-sm" value={editForm.gross_pay} onChange={e => setEditForm(f => ({...f, gross_pay: +e.target.value}))} /> : `£${Number(p.gross_pay).toFixed(2)}`}</td>
                        <td>£{Number(p.net_pay).toFixed(2)}</td>
                        <td>{editingId === p.id ? (
                          <select className="admin-inline-select" value={editForm.status} onChange={e => setEditForm(f => ({...f, status: e.target.value}))}>
                            <option value="draft">Draft</option><option value="processed">Processed</option><option value="paid">Paid</option>
                          </select>
                        ) : <span className={`admin-badge admin-badge-${p.status}`}>{p.status}</span>}</td>
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
                          <td colSpan={7}>
                            <div className="admin-detail-grid admin-detail-grid-4">
                              <div><strong>Tax Code:</strong> {p.tax_code}</div>
                              <div><strong>Annual Salary:</strong> £{Number(p.annual_salary || 0).toLocaleString()}</div>
                              <div><strong>Tax:</strong> £{Number(p.tax).toFixed(2)}</div>
                              <div><strong>NI:</strong> £{Number(p.national_insurance).toFixed(2)}</div>
                              <div><strong>Pension:</strong> £{Number(p.pension).toFixed(2)}</div>
                              <div><strong>Overtime:</strong> £{Number(p.overtime || 0).toFixed(2)}</div>
                              <div><strong>Adjustments:</strong> £{Number(p.adjustments || 0).toFixed(2)}</div>
                              <div><strong>Payment Date:</strong> {new Date(p.payment_date).toLocaleDateString('en-GB')}</div>
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
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && <div className="admin-empty">No payslips found</div>}
            </div>
          )}
        </>
      )}

      {tab === 'employees' && (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Employee</th><th>Department</th><th>Role</th><th>Annual Salary</th><th>Tax Code</th><th>Pension %</th><th></th></tr></thead>
            <tbody>
              {employees.map(emp => {
                const latest = payslips.find(p => p.employee?.id === emp.id)
                return (
                  <tr key={emp.id}>
                    <td>{emp.first_name} {emp.last_name}</td>
                    <td>{emp.department || '—'}</td>
                    <td>{emp.job_title || '—'}</td>
                    <td>{empEditId === emp.id ? <input type="number" className="admin-inline-input admin-inline-sm" value={empForm.annual_salary} onChange={e => setEmpForm(f => ({...f, annual_salary: +e.target.value}))} /> : `£${Number(emp.annual_salary || latest?.annual_salary || 0).toLocaleString()}`}</td>
                    <td>{empEditId === emp.id ? <input className="admin-inline-input admin-inline-sm" value={empForm.tax_code} onChange={e => setEmpForm(f => ({...f, tax_code: e.target.value}))} /> : (emp.tax_code || latest?.tax_code || '—')}</td>
                    <td>{empEditId === emp.id ? <input type="number" step="0.1" className="admin-inline-input admin-inline-sm" value={empForm.pension_pct} onChange={e => setEmpForm(f => ({...f, pension_pct: e.target.value}))} /> : (latest ? `${(Number(latest.pension) / Number(latest.gross_pay) * 100).toFixed(1)}%` : '—')}</td>
                    <td className="admin-actions">
                      {empEditId === emp.id ? (
                        <>
                          <button className="admin-btn-sm admin-btn-save" onClick={() => setEmpEditId(null)}>Save</button>
                          <button className="admin-btn-sm admin-btn-cancel" onClick={() => setEmpEditId(null)}>Cancel</button>
                        </>
                      ) : (
                        <button className="admin-btn-icon" onClick={() => startEmpEdit(emp)}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'schedule' && (
        <div className="admin-schedule">
          <h3>Payroll Calendar — FY 2026/2027</h3>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Month</th><th>Period Start</th><th>Period End</th><th>Payment Date</th><th>Cutoff</th><th>Status</th></tr></thead>
              <tbody>
                {PAYROLL_MONTHS.map((month, i) => {
                  const fyMonth = (i + 3) % 12
                  const year = fyMonth >= 3 ? 2026 : 2027
                  const start = new Date(year, fyMonth, 1)
                  const end = new Date(year, fyMonth + 1, 0)
                  const payDate = new Date(end)
                  payDate.setDate(payDate.getDate() - 2)
                  const cutoff = new Date(end)
                  cutoff.setDate(cutoff.getDate() - 5)
                  const isPast = end < new Date()
                  return (
                    <tr key={month} className={isPast ? 'admin-row-muted' : ''}>
                      <td><strong>{PAYROLL_MONTHS[fyMonth]}</strong></td>
                      <td>{start.toLocaleDateString('en-GB')}</td>
                      <td>{end.toLocaleDateString('en-GB')}</td>
                      <td>{payDate.toLocaleDateString('en-GB')}</td>
                      <td>{cutoff.toLocaleDateString('en-GB')}</td>
                      <td><span className={`admin-badge ${isPast ? 'admin-badge-paid' : 'admin-badge-pending'}`}>{isPast ? 'Completed' : 'Upcoming'}</span></td>
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

      {tab === 'xero_pay' && (
        <>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginBottom: 16,
          }}>
            {/* Config panel */}
            <div style={{
              padding: 20, background: 'var(--bg-card, #fff)', borderRadius: 12,
              border: '1px solid var(--border, #e5e7eb)',
            }}>
              <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700, color: 'var(--text, #1a1a2e)' }}>
                Xero API Configuration
              </h3>
              <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--text-muted, #8b8fa3)' }}>
                Enter your Xero app credentials from{' '}
                <span style={{ fontWeight: 600 }}>developer.xero.com</span>.
                Credentials are stored securely and never exposed to the browser.
              </p>

              <div style={{ display: 'grid', gap: 12 }}>
                <div className="admin-form-field">
                  <label>Client ID</label>
                  <input
                    className="admin-input"
                    placeholder="Your Xero app Client ID"
                    value={xeroForm.client_id}
                    onChange={e => setXeroForm(f => ({ ...f, client_id: e.target.value }))}
                  />
                </div>
                <div className="admin-form-field">
                  <label>Client Secret</label>
                  <input
                    className="admin-input"
                    type="password"
                    placeholder="Your Xero app Client Secret"
                    value={xeroForm.client_secret}
                    onChange={e => setXeroForm(f => ({ ...f, client_secret: e.target.value }))}
                  />
                </div>
                <div className="admin-form-field">
                  <label>Tenant ID</label>
                  <input
                    className="admin-input"
                    placeholder="Xero Organisation Tenant ID"
                    value={xeroForm.tenant_id}
                    onChange={e => setXeroForm(f => ({ ...f, tenant_id: e.target.value }))}
                  />
                </div>
                <div className="admin-form-field">
                  <label>Redirect URI</label>
                  <input
                    className="admin-input"
                    placeholder="e.g. https://yourapp.com/xero/callback"
                    value={xeroForm.redirect_uri}
                    onChange={e => setXeroForm(f => ({ ...f, redirect_uri: e.target.value }))}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button
                  className="admin-btn admin-btn-primary"
                  onClick={saveXeroConfig}
                  disabled={xeroSaving || !xeroForm.client_id || !xeroForm.client_secret || !xeroForm.tenant_id}
                >
                  {xeroSaving ? 'Saving...' : 'Save Configuration'}
                </button>
              </div>
            </div>

            {/* Connection panel */}
            <div style={{
              padding: 20, background: 'var(--bg-card, #fff)', borderRadius: 12,
              border: '1px solid var(--border, #e5e7eb)',
            }}>
              <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700, color: 'var(--text, #1a1a2e)' }}>
                Connection Status
              </h3>
              <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--text-muted, #8b8fa3)' }}>
                Authorise InflowHR to access your Xero payroll data.
              </p>

              <div style={{
                padding: 16, borderRadius: 8, marginBottom: 16,
                background: xeroConfig?.sync_status === 'connected' ? '#e8f5e9' : xeroConfig?.sync_status === 'error' ? '#ffebee' : 'var(--bg, #f8f9fa)',
                border: `1px solid ${xeroConfig?.sync_status === 'connected' ? '#a5d6a7' : xeroConfig?.sync_status === 'error' ? '#ef9a9a' : 'var(--border, #e5e7eb)'}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 20 }}>
                    {xeroConfig?.sync_status === 'connected' ? '✅' : xeroConfig?.sync_status === 'error' ? '❌' : xeroConfig?.sync_status === 'syncing' ? '⏳' : '⚪'}
                  </span>
                  <strong style={{ fontSize: 14 }}>
                    {xeroConfig?.sync_status === 'connected' ? 'Connected to Xero' :
                     xeroConfig?.sync_status === 'error' ? 'Connection Error' :
                     xeroConfig?.sync_status === 'syncing' ? 'Syncing...' : 'Not Connected'}
                  </strong>
                </div>
                {xeroConfig?.last_sync_at && (
                  <p style={{ margin: 0, fontSize: 12, color: '#666' }}>
                    Last synced: {new Date(xeroConfig.last_sync_at).toLocaleString('en-GB')}
                  </p>
                )}
                {xeroConfig?.sync_error && (
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: '#c62828' }}>
                    {xeroConfig.sync_error}
                  </p>
                )}
              </div>

              {xeroConfig?.sync_status !== 'connected' && xeroConfig?.client_id && (
                <>
                  <div style={{ marginBottom: 12 }}>
                    <p style={{ fontSize: 13, margin: '0 0 8px', color: 'var(--text, #1a1a2e)' }}>
                      <strong>Step 1:</strong> Click to open Xero authorisation:
                    </p>
                    <button className="admin-btn admin-btn-primary" onClick={connectXero}>
                      Authorise with Xero
                    </button>
                  </div>
                  <div>
                    <p style={{ fontSize: 13, margin: '0 0 8px', color: 'var(--text, #1a1a2e)' }}>
                      <strong>Step 2:</strong> Paste the authorisation code from Xero:
                    </p>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        className="admin-input"
                        placeholder="Paste authorisation code here"
                        value={xeroAuthCode}
                        onChange={e => setXeroAuthCode(e.target.value)}
                        style={{ flex: 1 }}
                      />
                      <button
                        className="admin-btn admin-btn-primary"
                        onClick={submitXeroAuthCode}
                        disabled={xeroSaving || !xeroAuthCode.trim()}
                      >
                        {xeroSaving ? 'Connecting...' : 'Connect'}
                      </button>
                    </div>
                  </div>
                </>
              )}

              {xeroConfig?.sync_status === 'connected' && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="admin-btn admin-btn-primary"
                    onClick={syncXeroPayslips}
                    disabled={xeroSyncing}
                  >
                    {xeroSyncing ? 'Syncing...' : '↻ Sync Payslips Now'}
                  </button>
                  <button className="admin-btn" onClick={disconnectXero}>
                    Disconnect
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Xero payslip list */}
          {xeroPayslips.length > 0 && (
            <>
              <h3 style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 600, color: 'var(--text, #1a1a2e)' }}>
                Synced Xero Payslips ({xeroPayslips.length})
              </h3>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Ref</th>
                      <th>Employee</th>
                      <th>Period</th>
                      <th>Gross</th>
                      <th>Tax</th>
                      <th>NI</th>
                      <th>Pension</th>
                      <th>Net</th>
                      <th>Status</th>
                      <th>Payment Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {xeroPayslips.map(p => (
                      <tr key={p.id}>
                        <td className="admin-td-mono" style={{ fontSize: 11 }}>{p.reference_number}</td>
                        <td>{p.employee ? `${p.employee.first_name} ${p.employee.last_name}` : '—'}</td>
                        <td>{new Date(p.pay_period_start).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}</td>
                        <td>£{Number(p.gross_pay).toFixed(2)}</td>
                        <td>£{Number(p.tax).toFixed(2)}</td>
                        <td>£{Number(p.national_insurance).toFixed(2)}</td>
                        <td>£{Number(p.pension).toFixed(2)}</td>
                        <td><strong>£{Number(p.net_pay).toFixed(2)}</strong></td>
                        <td><span className={`admin-badge admin-badge-${p.status}`}>{p.status}</span></td>
                        <td>{new Date(p.payment_date).toLocaleDateString('en-GB')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {xeroPayslips.length === 0 && xeroConfig?.sync_status === 'connected' && (
            <div className="admin-empty" style={{ marginTop: 16 }}>
              No payslips synced yet. Click "Sync Payslips Now" to pull data from Xero.
            </div>
          )}

          {!xeroConfig?.client_id && (
            <div style={{
              padding: 32, textAlign: 'center', background: 'var(--bg-card, #fff)',
              borderRadius: 12, border: '1px solid var(--border, #e5e7eb)',
            }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>🔗</div>
              <h3 style={{ margin: '0 0 8px', color: 'var(--text, #1a1a2e)' }}>Set Up Xero Integration</h3>
              <p style={{ color: 'var(--text-muted, #8b8fa3)', fontSize: 14, maxWidth: 480, margin: '0 auto' }}>
                Enter your Xero API credentials above to connect your Xero payroll account.
                Payslips will be synced and matched to InflowHR employees by email address.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
