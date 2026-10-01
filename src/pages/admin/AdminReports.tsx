import { useState, useEffect, useMemo } from 'react'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { useFeatures } from '../../context/FeatureContext'
import { supabase } from '../../lib/supabase'

function getFYRange(fyStartMonth: number) {
  const now = new Date()
  const currentMonth = now.getMonth() + 1
  const startYear = currentMonth >= fyStartMonth ? now.getFullYear() : now.getFullYear() - 1
  const startDate = new Date(startYear, fyStartMonth - 1, 1)
  const endDate = new Date(startYear + 1, fyStartMonth - 1, 0)
  return { startDate, endDate, startYear }
}

function fmtDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function csvSafe(val: string): string {
  let s = (val || '').replace(/"/g, '""')
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
  return `"${s}"`
}

type ReportKey =
  | 'leave-carry-over' | 'outstanding-workflows' | 'pending-leave' | 'pending-expenses'
  | 'overdue-elearning' | 'probation-ending' | 'rtw-expiry' | 'absence-frequency'
  | 'headcount-dept' | 'turnover' | 'overtime-alerts' | 'shift-coverage'
  | 'payroll-variance' | 'benefits-uptake' | 'skills-gaps' | 'onboarding-progress'
  | 'performance-overdue' | 'survey-engagement' | 'stale-tickets' | 'document-expiry'

interface ReportDef {
  key: ReportKey
  title: string
  description: string
  category: 'leave' | 'people' | 'finance' | 'compliance' | 'engagement' | 'operations'
  icon: string
  feature?: string
}

const REPORTS: ReportDef[] = [
  { key: 'leave-carry-over', title: 'Leave Carry-Over Forecast', description: 'Projected unused leave days at financial year end per employee', category: 'leave', icon: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>', feature: 'leave' },
  { key: 'pending-leave', title: 'Leave Requests Awaiting Action', description: 'All pending leave requests with days waiting and impact on team coverage', category: 'leave', icon: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>', feature: 'leave' },
  { key: 'absence-frequency', title: 'Absence Frequency (Bradford)', description: 'Employees ranked by Bradford Factor score — flags frequent short-term absence', category: 'leave', icon: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>', feature: 'leave' },
  { key: 'outstanding-workflows', title: 'Outstanding Management Actions', description: 'All workflow tracker items not yet completed or approved', category: 'operations', icon: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>' },
  { key: 'stale-tickets', title: 'Stale HR Tickets', description: 'Open HR tickets older than 7 days without resolution', category: 'operations', icon: '<path d="M2 9V7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v2"/><path d="M22 15v2a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-2"/><path d="M2 10a2 2 0 0 1 0 4"/><path d="M22 10a2 2 0 0 0 0 4"/>' },
  { key: 'onboarding-progress', title: 'Onboarding Progress', description: 'New starters and their onboarding completion status', category: 'people', icon: '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/>' },
  { key: 'headcount-dept', title: 'Headcount by Department', description: 'Active employee count per department with FTE and vacancy indicators', category: 'people', icon: '<circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><path d="M17 11a4 4 0 1 0 0-8"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/>' },
  { key: 'turnover', title: 'Employee Turnover', description: 'Leavers in the current FY with annualised turnover rate', category: 'people', icon: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>' },
  { key: 'probation-ending', title: 'Probation Periods Ending', description: 'Employees whose probation ends within the next 30 days', category: 'people', icon: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>' },
  { key: 'pending-expenses', title: 'Expenses Awaiting Approval', description: 'Submitted expense claims not yet approved, with total value at risk', category: 'finance', icon: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>', feature: 'expenses' },
  { key: 'payroll-variance', title: 'Payroll Cost Variance', description: 'Month-on-month payroll cost change highlighting significant increases', category: 'finance', icon: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 12h.01M18 12h.01"/>', feature: 'payslips' },
  { key: 'overtime-alerts', title: 'Overtime / Excess Hours', description: 'Employees logging more than contracted hours this period', category: 'finance', icon: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>', feature: 'timesheets' },
  { key: 'overdue-elearning', title: 'Overdue E-Learning Courses', description: 'Mandatory courses past their due date — compliance risk', category: 'compliance', icon: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>', feature: 'elearning' },
  { key: 'rtw-expiry', title: 'Right to Work Expiry', description: 'Employees with right-to-work documents expiring in the next 90 days', category: 'compliance', icon: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>' },
  { key: 'document-expiry', title: 'Document Expiry Tracker', description: 'All employee documents approaching expiry within 90 days', category: 'compliance', icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>' },
  { key: 'performance-overdue', title: 'Overdue Performance Reviews', description: 'Reviews past their scheduled date without completion', category: 'engagement', icon: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>', feature: 'performance' },
  { key: 'survey-engagement', title: 'Survey Response Rates', description: 'Active survey deployments with response rate and outstanding count', category: 'engagement', icon: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>', feature: 'surveys' },
  { key: 'benefits-uptake', title: 'Benefits Enrolment Rate', description: 'Available benefits and percentage of eligible employees enrolled', category: 'engagement', icon: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>', feature: 'benefits' },
  { key: 'shift-coverage', title: 'Shift Coverage Gaps', description: 'Upcoming shifts with unfilled slots or no assigned employee', category: 'operations', icon: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>', feature: 'shifts' },
  { key: 'skills-gaps', title: 'Skills Gap Analysis', description: 'Role requirements vs actual employee skill levels across departments', category: 'engagement', icon: '<path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44"/>', feature: 'skills_passport' },
]

const CATEGORY_LABELS: Record<string, string> = {
  leave: 'Leave & Absence',
  people: 'People & Headcount',
  finance: 'Pay & Finance',
  compliance: 'Compliance & Risk',
  engagement: 'Engagement & Growth',
  operations: 'Operations',
}

const CATEGORY_ORDER = ['leave', 'people', 'finance', 'compliance', 'engagement', 'operations']

export default function AdminReports() {
  const { selectedCompanyId, selectedCompany } = useAdminCompany()
  const { features } = useFeatures()
  const [activeReport, setActiveReport] = useState<ReportKey | null>(null)
  const [loading, setLoading] = useState(false)
  const [reportData, setReportData] = useState<Record<string, unknown>[]>([])
  const [reportColumns, setReportColumns] = useState<{ key: string; label: string }[]>([])
  const [reportSummary, setReportSummary] = useState('')
  const [filter, setFilter] = useState('')

  const fyStartMonth = selectedCompany?.fy_start_month || 4
  const { startDate: fyStart, endDate: fyEnd } = useMemo(() => getFYRange(fyStartMonth), [fyStartMonth])

  const visibleReports = REPORTS.filter(r => !r.feature || features[r.feature as keyof typeof features])

  const grouped = useMemo(() => {
    const groups: Record<string, ReportDef[]> = {}
    visibleReports.forEach(r => {
      if (!groups[r.category]) groups[r.category] = []
      groups[r.category].push(r)
    })
    return groups
  }, [visibleReports])

  async function runReport(key: ReportKey) {
    if (!selectedCompanyId) return
    setActiveReport(key)
    setLoading(true)
    setReportData([])
    setReportColumns([])
    setReportSummary('')

    try {
      switch (key) {
        case 'leave-carry-over': await loadLeaveCarryOver(); break
        case 'pending-leave': await loadPendingLeave(); break
        case 'absence-frequency': await loadAbsenceFrequency(); break
        case 'outstanding-workflows': await loadOutstandingWorkflows(); break
        case 'stale-tickets': await loadStaleTickets(); break
        case 'onboarding-progress': await loadOnboardingProgress(); break
        case 'headcount-dept': await loadHeadcountDept(); break
        case 'turnover': await loadTurnover(); break
        case 'probation-ending': await loadProbationEnding(); break
        case 'pending-expenses': await loadPendingExpenses(); break
        case 'payroll-variance': await loadPayrollVariance(); break
        case 'overtime-alerts': await loadOvertimeAlerts(); break
        case 'overdue-elearning': await loadOverdueElearning(); break
        case 'rtw-expiry': await loadRtwExpiry(); break
        case 'document-expiry': await loadDocumentExpiry(); break
        case 'performance-overdue': await loadPerformanceOverdue(); break
        case 'survey-engagement': await loadSurveyEngagement(); break
        case 'benefits-uptake': await loadBenefitsUptake(); break
        case 'shift-coverage': await loadShiftCoverage(); break
        case 'skills-gaps': await loadSkillsGaps(); break
      }
    } catch {
      setReportSummary('Failed to load report data')
    } finally {
      setLoading(false)
    }
  }

  async function loadLeaveCarryOver() {
    const [{ data: employees }, { data: balances }, { data: requests }] = await Promise.all([
      supabase.from('employees').select('id, first_name, last_name, department').eq('company_id', selectedCompanyId).eq('is_active', true),
      supabase.from('leave_balances').select('employee_id, leave_type_id, entitlement, used, carried_over, leave_type:leave_types!leave_balances_leave_type_id_fkey(name)').eq('company_id', selectedCompanyId),
      supabase.from('leave_requests').select('employee_id, leave_type_id, total_days, status').eq('company_id', selectedCompanyId).in('status', ['approved', 'pending']).gte('start_date', fyStart.toISOString().split('T')[0]).lte('start_date', fyEnd.toISOString().split('T')[0]),
    ])
    const rows = (employees || []).flatMap(emp => {
      const empBals = (balances || []).filter(b => b.employee_id === emp.id)
      return empBals.map(b => {
        const approved = (requests || []).filter(r => r.employee_id === emp.id && r.leave_type_id === b.leave_type_id && r.status === 'approved').reduce((s, r) => s + Number(r.total_days || 0), 0)
        const pending = (requests || []).filter(r => r.employee_id === emp.id && r.leave_type_id === b.leave_type_id && r.status === 'pending').reduce((s, r) => s + Number(r.total_days || 0), 0)
        const entitlement = Number(b.entitlement || 0) + Number(b.carried_over || 0)
        const used = Number(b.used || 0) + approved
        const projected = Math.max(0, entitlement - used - pending)
        const lt = b.leave_type as unknown as { name: string } | null
        return { Employee: `${emp.first_name} ${emp.last_name}`, Department: emp.department || '', 'Leave Type': lt?.name || '', Entitlement: entitlement, Used: used, Pending: pending, 'Projected Unused': projected }
      })
    }).filter(r => r['Projected Unused'] > 0).sort((a, b) => b['Projected Unused'] - a['Projected Unused'])
    setReportColumns([{ key: 'Employee', label: 'Employee' }, { key: 'Department', label: 'Department' }, { key: 'Leave Type', label: 'Leave Type' }, { key: 'Entitlement', label: 'Entitlement' }, { key: 'Used', label: 'Used' }, { key: 'Pending', label: 'Pending' }, { key: 'Projected Unused', label: 'Projected Unused' }])
    setReportData(rows)
    const totalUnused = rows.reduce((s, r) => s + (r['Projected Unused'] as number), 0)
    setReportSummary(`${rows.length} employees with unused leave. ${totalUnused.toFixed(1)} total days projected to carry over at FY end.`)
  }

  async function loadPendingLeave() {
    const { data } = await supabase.from('leave_requests').select('*, employee:employees!leave_requests_employee_id_fkey(first_name, last_name, department)').eq('company_id', selectedCompanyId).eq('status', 'pending').order('created_at', { ascending: true })
    const rows = (data || []).map(r => {
      const days = Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86400000)
      return { Employee: `${r.employee?.first_name} ${r.employee?.last_name}`, Department: r.employee?.department || '', 'Start Date': fmtDate(r.start_date), 'End Date': fmtDate(r.end_date), Days: Number(r.total_days || 0), 'Days Waiting': days, 'Request Date': fmtDate(r.created_at?.split('T')[0]) }
    })
    setReportColumns([{ key: 'Employee', label: 'Employee' }, { key: 'Department', label: 'Department' }, { key: 'Start Date', label: 'Start Date' }, { key: 'End Date', label: 'End Date' }, { key: 'Days', label: 'Days' }, { key: 'Days Waiting', label: 'Days Waiting' }, { key: 'Request Date', label: 'Requested' }])
    setReportData(rows)
    setReportSummary(`${rows.length} leave requests pending approval. ${rows.filter(r => (r['Days Waiting'] as number) > 3).length} waiting more than 3 days.`)
  }

  async function loadAbsenceFrequency() {
    const { data } = await supabase.from('leave_requests').select('employee_id, start_date, total_days, employee:employees!leave_requests_employee_id_fkey(first_name, last_name, department)').eq('company_id', selectedCompanyId).eq('status', 'approved').gte('start_date', new Date(Date.now() - 365 * 86400000).toISOString().split('T')[0])
    const byEmp: Record<string, { name: string; dept: string; spells: number; days: number }> = {}
    ;(data || []).forEach(r => {
      const emp = r.employee as unknown as { first_name: string; last_name: string; department: string } | null
      if (!byEmp[r.employee_id]) byEmp[r.employee_id] = { name: `${emp?.first_name} ${emp?.last_name}`, dept: emp?.department || '', spells: 0, days: 0 }
      byEmp[r.employee_id].spells++
      byEmp[r.employee_id].days += Number(r.total_days || 0)
    })
    const rows = Object.values(byEmp).map(e => ({
      Employee: e.name, Department: e.dept, Spells: e.spells, 'Total Days': e.days, 'Bradford Score': e.spells * e.spells * e.days,
    })).sort((a, b) => (b['Bradford Score'] as number) - (a['Bradford Score'] as number))
    setReportColumns([{ key: 'Employee', label: 'Employee' }, { key: 'Department', label: 'Department' }, { key: 'Spells', label: 'Spells (12m)' }, { key: 'Total Days', label: 'Total Days' }, { key: 'Bradford Score', label: 'Bradford Score' }])
    setReportData(rows)
    const high = rows.filter(r => (r['Bradford Score'] as number) >= 200)
    setReportSummary(`${rows.length} employees with absence in the last 12 months. ${high.length} with Bradford score >= 200 (trigger level).`)
  }

  async function loadOutstandingWorkflows() {
    const { data } = await supabase.from('workflow_tracker').select('*').eq('company_id', selectedCompanyId).not('status', 'in', '("completed","cancelled")').order('created_at', { ascending: true })
    const rows = (data || []).map(r => {
      const days = Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86400000)
      return { Title: r.title || r.type, Type: r.type, Status: r.status, 'Assigned To': r.assigned_to_name || '', 'Days Open': days, Created: fmtDate(r.created_at?.split('T')[0]) }
    })
    setReportColumns([{ key: 'Title', label: 'Title' }, { key: 'Type', label: 'Type' }, { key: 'Status', label: 'Status' }, { key: 'Assigned To', label: 'Assigned To' }, { key: 'Days Open', label: 'Days Open' }, { key: 'Created', label: 'Created' }])
    setReportData(rows)
    const overWeek = rows.filter(r => (r['Days Open'] as number) > 7)
    setReportSummary(`${rows.length} outstanding workflow actions. ${overWeek.length} open for more than 7 days.`)
  }

  async function loadStaleTickets() {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString()
    const { data } = await supabase.from('notifications').select('*, employee:employees!notifications_employee_id_fkey(first_name, last_name)').eq('company_id', selectedCompanyId).eq('type', 'hr_ticket').eq('read', false).lt('created_at', sevenDaysAgo).order('created_at', { ascending: true })
    const rows = (data || []).map(r => {
      const days = Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86400000)
      return { Employee: r.employee ? `${r.employee.first_name} ${r.employee.last_name}` : '', Subject: r.title || r.message?.substring(0, 60) || '', 'Days Open': days, Created: fmtDate(r.created_at?.split('T')[0]) }
    })
    setReportColumns([{ key: 'Employee', label: 'Employee' }, { key: 'Subject', label: 'Subject' }, { key: 'Days Open', label: 'Days Open' }, { key: 'Created', label: 'Created' }])
    setReportData(rows)
    setReportSummary(`${rows.length} unresolved HR tickets older than 7 days.`)
  }

  async function loadOnboardingProgress() {
    const { data } = await supabase.from('onboarding').select('*, employee:employees!onboarding_employee_id_fkey(first_name, last_name, department, start_date)').eq('company_id', selectedCompanyId).order('created_at', { ascending: false })
    const rows = (data || []).map(r => {
      const tasks = [
        { name: 'Contract Signed', done: r.contract_signed },
        { name: 'IT Setup', done: r.it_setup_complete },
        { name: 'Bank Details', done: r.bank_details_received },
        { name: 'Right to Work', done: r.rtw_verified },
        { name: 'Induction', done: r.induction_complete },
      ]
      const completed = tasks.filter(t => t.done).length
      return {
        Employee: r.employee ? `${r.employee.first_name} ${r.employee.last_name}` : '', Department: r.employee?.department || '',
        'Start Date': r.employee?.start_date ? fmtDate(r.employee.start_date) : '', Progress: `${completed}/5`, Status: completed === 5 ? 'Complete' : 'In Progress',
        'Outstanding': tasks.filter(t => !t.done).map(t => t.name).join(', ') || 'None',
      }
    })
    setReportColumns([{ key: 'Employee', label: 'Employee' }, { key: 'Department', label: 'Department' }, { key: 'Start Date', label: 'Start Date' }, { key: 'Progress', label: 'Progress' }, { key: 'Status', label: 'Status' }, { key: 'Outstanding', label: 'Outstanding Tasks' }])
    setReportData(rows)
    const incomplete = rows.filter(r => r.Status !== 'Complete')
    setReportSummary(`${rows.length} onboarding records. ${incomplete.length} still in progress.`)
  }

  async function loadHeadcountDept() {
    const { data } = await supabase.from('employees').select('department, employment_type, is_active').eq('company_id', selectedCompanyId).eq('is_active', true)
    const depts: Record<string, { total: number; ft: number; pt: number }> = {}
    ;(data || []).forEach(e => {
      const d = e.department || 'Unassigned'
      if (!depts[d]) depts[d] = { total: 0, ft: 0, pt: 0 }
      depts[d].total++
      if (e.employment_type === 'part_time') depts[d].pt++
      else depts[d].ft++
    })
    const rows = Object.entries(depts).map(([dept, c]) => ({
      Department: dept, 'Full-Time': c.ft, 'Part-Time': c.pt, Total: c.total, 'FTE Estimate': (c.ft + c.pt * 0.5).toFixed(1),
    })).sort((a, b) => (b.Total as number) - (a.Total as number))
    setReportColumns([{ key: 'Department', label: 'Department' }, { key: 'Full-Time', label: 'Full-Time' }, { key: 'Part-Time', label: 'Part-Time' }, { key: 'Total', label: 'Total' }, { key: 'FTE Estimate', label: 'FTE Estimate' }])
    setReportData(rows)
    const total = (data || []).length
    setReportSummary(`${total} active employees across ${Object.keys(depts).length} departments.`)
  }

  async function loadTurnover() {
    const fyStartStr = fyStart.toISOString().split('T')[0]
    const [{ data: leavers }, { data: active }] = await Promise.all([
      supabase.from('employees').select('first_name, last_name, department, end_date').eq('company_id', selectedCompanyId).eq('is_active', false).gte('end_date', fyStartStr),
      supabase.from('employees').select('id').eq('company_id', selectedCompanyId).eq('is_active', true),
    ])
    const rows = (leavers || []).map(e => ({
      Employee: `${e.first_name} ${e.last_name}`, Department: e.department || '', 'Leave Date': e.end_date ? fmtDate(e.end_date) : '',
    }))
    setReportColumns([{ key: 'Employee', label: 'Employee' }, { key: 'Department', label: 'Department' }, { key: 'Leave Date', label: 'Leave Date' }])
    setReportData(rows)
    const activeCount = (active || []).length
    const leaverCount = rows.length
    const monthsElapsed = Math.max(1, (Date.now() - fyStart.getTime()) / (30.44 * 86400000))
    const annualised = (leaverCount / monthsElapsed) * 12
    const rate = activeCount > 0 ? ((annualised / activeCount) * 100).toFixed(1) : '0'
    setReportSummary(`${leaverCount} leavers this FY. Annualised turnover rate: ${rate}% (based on ${activeCount} current headcount).`)
  }

  async function loadProbationEnding() {
    const in30 = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]
    const today = new Date().toISOString().split('T')[0]
    const { data } = await supabase.from('employees').select('first_name, last_name, department, probation_end_date, job_title').eq('company_id', selectedCompanyId).eq('is_active', true).gte('probation_end_date', today).lte('probation_end_date', in30)
    const rows = (data || []).map(e => {
      const days = Math.ceil((new Date(e.probation_end_date + 'T00:00:00').getTime() - Date.now()) / 86400000)
      return { Employee: `${e.first_name} ${e.last_name}`, Department: e.department || '', 'Job Title': e.job_title || '', 'Probation Ends': fmtDate(e.probation_end_date), 'Days Remaining': days }
    }).sort((a, b) => (a['Days Remaining'] as number) - (b['Days Remaining'] as number))
    setReportColumns([{ key: 'Employee', label: 'Employee' }, { key: 'Department', label: 'Department' }, { key: 'Job Title', label: 'Job Title' }, { key: 'Probation Ends', label: 'Probation Ends' }, { key: 'Days Remaining', label: 'Days Left' }])
    setReportData(rows)
    setReportSummary(`${rows.length} employees with probation ending in the next 30 days.`)
  }

  async function loadPendingExpenses() {
    const { data } = await supabase.from('expense_claims').select('*, employee:employees!expense_claims_employee_id_fkey(first_name, last_name, department)').eq('company_id', selectedCompanyId).eq('status', 'submitted').order('created_at', { ascending: true })
    const rows = (data || []).map(r => {
      const days = Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86400000)
      return { Employee: r.employee ? `${r.employee.first_name} ${r.employee.last_name}` : '', Department: r.employee?.department || '', Description: r.description || '', Amount: `£${Number(r.total_amount || 0).toFixed(2)}`, 'Days Waiting': days, Submitted: fmtDate(r.created_at?.split('T')[0]) }
    })
    setReportColumns([{ key: 'Employee', label: 'Employee' }, { key: 'Department', label: 'Department' }, { key: 'Description', label: 'Description' }, { key: 'Amount', label: 'Amount' }, { key: 'Days Waiting', label: 'Days Waiting' }, { key: 'Submitted', label: 'Submitted' }])
    setReportData(rows)
    const total = rows.reduce((s, r) => s + parseFloat((r.Amount as string).replace('£', '')), 0)
    setReportSummary(`${rows.length} expense claims awaiting approval. Total value: £${total.toFixed(2)}.`)
  }

  async function loadPayrollVariance() {
    const { data } = await supabase.from('payslips').select('pay_period_start, gross_pay, net_pay, tax_deducted, ni_deducted').eq('company_id', selectedCompanyId).gte('pay_period_start', fyStart.toISOString().split('T')[0]).order('pay_period_start')
    const byMonth: Record<string, { gross: number; net: number; tax: number; ni: number; count: number }> = {}
    ;(data || []).forEach(p => {
      const m = p.pay_period_start.substring(0, 7)
      if (!byMonth[m]) byMonth[m] = { gross: 0, net: 0, tax: 0, ni: 0, count: 0 }
      byMonth[m].gross += Number(p.gross_pay || 0)
      byMonth[m].net += Number(p.net_pay || 0)
      byMonth[m].tax += Number(p.tax_deducted || 0)
      byMonth[m].ni += Number(p.ni_deducted || 0)
      byMonth[m].count++
    })
    const months = Object.keys(byMonth).sort()
    const rows = months.map((m, i) => {
      const curr = byMonth[m]
      const prev = i > 0 ? byMonth[months[i - 1]] : null
      const variance = prev ? ((curr.gross - prev.gross) / prev.gross * 100).toFixed(1) : '—'
      return { Period: m, Headcount: curr.count, 'Gross Pay': `£${curr.gross.toFixed(2)}`, 'Net Pay': `£${curr.net.toFixed(2)}`, Tax: `£${curr.tax.toFixed(2)}`, NI: `£${curr.ni.toFixed(2)}`, 'Variance %': variance }
    })
    setReportColumns([{ key: 'Period', label: 'Period' }, { key: 'Headcount', label: 'Headcount' }, { key: 'Gross Pay', label: 'Gross Pay' }, { key: 'Net Pay', label: 'Net Pay' }, { key: 'Tax', label: 'Tax' }, { key: 'NI', label: 'NI' }, { key: 'Variance %', label: 'MoM Variance' }])
    setReportData(rows)
    setReportSummary(`${months.length} payroll periods this FY. ${(data || []).length} total payslips processed.`)
  }

  async function loadOvertimeAlerts() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
    const [{ data: timesheets }, { data: employees }] = await Promise.all([
      supabase.from('timesheets').select('employee_id, hours').eq('company_id', selectedCompanyId).gte('date', thirtyDaysAgo),
      supabase.from('employees').select('id, first_name, last_name, department, contracted_hours').eq('company_id', selectedCompanyId).eq('is_active', true),
    ])
    const byEmp: Record<string, number> = {}
    ;(timesheets || []).forEach(t => {
      byEmp[t.employee_id] = (byEmp[t.employee_id] || 0) + Number(t.hours || 0)
    })
    const rows = (employees || []).filter(e => {
      const logged = byEmp[e.id] || 0
      const contracted = Number(e.contracted_hours || 37.5) * 4.33
      return logged > contracted
    }).map(e => {
      const logged = byEmp[e.id] || 0
      const contracted = Number(e.contracted_hours || 37.5) * 4.33
      return { Employee: `${e.first_name} ${e.last_name}`, Department: e.department || '', 'Contracted (monthly)': contracted.toFixed(1), 'Logged (30d)': logged.toFixed(1), Excess: (logged - contracted).toFixed(1) }
    }).sort((a, b) => parseFloat(b.Excess as string) - parseFloat(a.Excess as string))
    setReportColumns([{ key: 'Employee', label: 'Employee' }, { key: 'Department', label: 'Department' }, { key: 'Contracted (monthly)', label: 'Contracted (monthly)' }, { key: 'Logged (30d)', label: 'Logged (30d)' }, { key: 'Excess', label: 'Excess Hours' }])
    setReportData(rows)
    const totalExcess = rows.reduce((s, r) => s + parseFloat(r.Excess as string), 0)
    setReportSummary(`${rows.length} employees exceeding contracted hours. ${totalExcess.toFixed(1)} total excess hours in the last 30 days.`)
  }

  async function loadOverdueElearning() {
    const today = new Date().toISOString().split('T')[0]
    const { data } = await supabase.from('course_enrolments').select('*, employee:employees!course_enrolments_employee_id_fkey(first_name, last_name, department), course:elearning_courses!course_enrolments_course_id_fkey(title, is_mandatory)').eq('company_id', selectedCompanyId).eq('status', 'enrolled').not('due_date', 'is', null).lt('due_date', today)
    const rows = (data || []).filter(r => r.course?.is_mandatory).map(r => {
      const daysOverdue = Math.floor((Date.now() - new Date(r.due_date + 'T00:00:00').getTime()) / 86400000)
      return { Employee: r.employee ? `${r.employee.first_name} ${r.employee.last_name}` : '', Department: r.employee?.department || '', Course: r.course?.title || '', 'Due Date': fmtDate(r.due_date), 'Days Overdue': daysOverdue }
    }).sort((a, b) => (b['Days Overdue'] as number) - (a['Days Overdue'] as number))
    setReportColumns([{ key: 'Employee', label: 'Employee' }, { key: 'Department', label: 'Department' }, { key: 'Course', label: 'Course' }, { key: 'Due Date', label: 'Due Date' }, { key: 'Days Overdue', label: 'Days Overdue' }])
    setReportData(rows)
    setReportSummary(`${rows.length} overdue mandatory e-learning enrolments across the company.`)
  }

  async function loadRtwExpiry() {
    const in90 = new Date(Date.now() + 90 * 86400000).toISOString().split('T')[0]
    const { data } = await supabase.from('employees').select('first_name, last_name, department, rtw_expiry_date, nationality').eq('company_id', selectedCompanyId).eq('is_active', true).not('rtw_expiry_date', 'is', null).lte('rtw_expiry_date', in90)
    const rows = (data || []).map(e => {
      const days = Math.ceil((new Date(e.rtw_expiry_date + 'T00:00:00').getTime() - Date.now()) / 86400000)
      return { Employee: `${e.first_name} ${e.last_name}`, Department: e.department || '', Nationality: e.nationality || '', 'Expiry Date': fmtDate(e.rtw_expiry_date), 'Days Left': days, Status: days < 0 ? 'EXPIRED' : days <= 30 ? 'Urgent' : 'Upcoming' }
    }).sort((a, b) => (a['Days Left'] as number) - (b['Days Left'] as number))
    setReportColumns([{ key: 'Employee', label: 'Employee' }, { key: 'Department', label: 'Department' }, { key: 'Nationality', label: 'Nationality' }, { key: 'Expiry Date', label: 'Expiry Date' }, { key: 'Days Left', label: 'Days Left' }, { key: 'Status', label: 'Status' }])
    setReportData(rows)
    const expired = rows.filter(r => r.Status === 'EXPIRED')
    setReportSummary(`${rows.length} right-to-work documents expiring within 90 days. ${expired.length} already expired.`)
  }

  async function loadDocumentExpiry() {
    const in90 = new Date(Date.now() + 90 * 86400000).toISOString().split('T')[0]
    const { data } = await supabase.from('employee_documents').select('*, employee:employees!employee_documents_employee_id_fkey(first_name, last_name, department)').eq('company_id', selectedCompanyId).not('expiry_date', 'is', null).lte('expiry_date', in90).order('expiry_date')
    const rows = (data || []).map(d => {
      const days = Math.ceil((new Date(d.expiry_date + 'T00:00:00').getTime() - Date.now()) / 86400000)
      return { Employee: d.employee ? `${d.employee.first_name} ${d.employee.last_name}` : '', Department: d.employee?.department || '', Document: d.document_type || d.name || '', 'Expiry Date': fmtDate(d.expiry_date), 'Days Left': days, Status: days < 0 ? 'EXPIRED' : days <= 30 ? 'Urgent' : 'Upcoming' }
    })
    setReportColumns([{ key: 'Employee', label: 'Employee' }, { key: 'Department', label: 'Department' }, { key: 'Document', label: 'Document' }, { key: 'Expiry Date', label: 'Expiry Date' }, { key: 'Days Left', label: 'Days Left' }, { key: 'Status', label: 'Status' }])
    setReportData(rows)
    const expired = rows.filter(r => r.Status === 'EXPIRED')
    setReportSummary(`${rows.length} documents expiring within 90 days. ${expired.length} already expired.`)
  }

  async function loadPerformanceOverdue() {
    const today = new Date().toISOString().split('T')[0]
    const { data } = await supabase.from('performance_reviews').select('*, employee:employees!performance_reviews_employee_id_fkey(first_name, last_name, department)').eq('company_id', selectedCompanyId).in('status', ['scheduled', 'in_progress']).lt('review_date', today)
    const rows = (data || []).map(r => {
      const days = Math.floor((Date.now() - new Date(r.review_date + 'T00:00:00').getTime()) / 86400000)
      return { Employee: r.employee ? `${r.employee.first_name} ${r.employee.last_name}` : '', Department: r.employee?.department || '', 'Review Type': r.review_type || '', 'Scheduled Date': fmtDate(r.review_date), 'Days Overdue': days, Status: r.status }
    }).sort((a, b) => (b['Days Overdue'] as number) - (a['Days Overdue'] as number))
    setReportColumns([{ key: 'Employee', label: 'Employee' }, { key: 'Department', label: 'Department' }, { key: 'Review Type', label: 'Review Type' }, { key: 'Scheduled Date', label: 'Scheduled Date' }, { key: 'Days Overdue', label: 'Days Overdue' }, { key: 'Status', label: 'Status' }])
    setReportData(rows)
    setReportSummary(`${rows.length} performance reviews past their scheduled date.`)
  }

  async function loadSurveyEngagement() {
    const { data: deployments } = await supabase.from('survey_deployments').select('*, survey:company_surveys!survey_deployments_survey_id_fkey(title)').eq('company_id', selectedCompanyId).eq('status', 'active')
    const { data: responses } = await supabase.from('survey_responses').select('deployment_id, employee_id').eq('company_id', selectedCompanyId)
    const { data: employees } = await supabase.from('employees').select('id').eq('company_id', selectedCompanyId).eq('is_active', true)
    const totalEmps = (employees || []).length
    const rows = (deployments || []).map(d => {
      const resps = (responses || []).filter(r => r.deployment_id === d.id)
      const uniqueRespondents = new Set(resps.map(r => r.employee_id)).size
      const rate = totalEmps > 0 ? ((uniqueRespondents / totalEmps) * 100).toFixed(1) : '0'
      return { Survey: d.survey?.title || '', 'Start Date': d.start_date ? fmtDate(d.start_date) : '', 'End Date': d.end_date ? fmtDate(d.end_date) : '', Responses: uniqueRespondents, 'Total Eligible': totalEmps, 'Response Rate': `${rate}%`, Outstanding: totalEmps - uniqueRespondents }
    })
    setReportColumns([{ key: 'Survey', label: 'Survey' }, { key: 'Start Date', label: 'Start Date' }, { key: 'End Date', label: 'End Date' }, { key: 'Responses', label: 'Responses' }, { key: 'Total Eligible', label: 'Eligible' }, { key: 'Response Rate', label: 'Response Rate' }, { key: 'Outstanding', label: 'Outstanding' }])
    setReportData(rows)
    setReportSummary(`${rows.length} active survey deployments.`)
  }

  async function loadBenefitsUptake() {
    const [{ data: benefits }, { data: enrolments }, { data: employees }] = await Promise.all([
      supabase.from('benefits').select('id, name, category').eq('company_id', selectedCompanyId),
      supabase.from('employee_benefits').select('benefit_id, employee_id').eq('company_id', selectedCompanyId),
      supabase.from('employees').select('id').eq('company_id', selectedCompanyId).eq('is_active', true),
    ])
    const totalEmps = (employees || []).length
    const rows = (benefits || []).map(b => {
      const enrolled = new Set((enrolments || []).filter(e => e.benefit_id === b.id).map(e => e.employee_id)).size
      const rate = totalEmps > 0 ? ((enrolled / totalEmps) * 100).toFixed(1) : '0'
      return { Benefit: b.name, Category: b.category || '', Enrolled: enrolled, 'Eligible Employees': totalEmps, 'Uptake Rate': `${rate}%` }
    }).sort((a, b) => parseFloat(b['Uptake Rate'] as string) - parseFloat(a['Uptake Rate'] as string))
    setReportColumns([{ key: 'Benefit', label: 'Benefit' }, { key: 'Category', label: 'Category' }, { key: 'Enrolled', label: 'Enrolled' }, { key: 'Eligible Employees', label: 'Eligible' }, { key: 'Uptake Rate', label: 'Uptake Rate' }])
    setReportData(rows)
    setReportSummary(`${(benefits || []).length} benefits available. Average uptake: ${rows.length > 0 ? (rows.reduce((s, r) => s + parseFloat(r['Uptake Rate'] as string), 0) / rows.length).toFixed(1) : '0'}%.`)
  }

  async function loadShiftCoverage() {
    const today = new Date().toISOString().split('T')[0]
    const in14 = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0]
    const { data } = await supabase.from('shift_assignments' as 'shift_assignments').select('*, shift_template:shift_templates!shift_assignments_template_id_fkey(name, start_time, end_time), employee:employees!shift_assignments_employee_id_fkey(first_name, last_name)').eq('company_id', selectedCompanyId).gte('date', today).lte('date', in14).is('employee_id', null)
    const rows = (data || []).map((s: Record<string, unknown>) => ({
      Date: fmtDate(s.date as string),
      Shift: (s.shift_template as Record<string, string>)?.name || '',
      Time: `${(s.shift_template as Record<string, string>)?.start_time || ''} — ${(s.shift_template as Record<string, string>)?.end_time || ''}`,
      Status: 'Unassigned',
    }))
    setReportColumns([{ key: 'Date', label: 'Date' }, { key: 'Shift', label: 'Shift' }, { key: 'Time', label: 'Time' }, { key: 'Status', label: 'Status' }])
    setReportData(rows)
    setReportSummary(`${rows.length} unassigned shift slots in the next 14 days.`)
  }

  async function loadSkillsGaps() {
    const [{ data: reqs }, { data: empSkills }, { data: skills }] = await Promise.all([
      supabase.from('role_skill_requirements').select('*, skill:skills!role_skill_requirements_skill_id_fkey(name), role:role_profiles!role_skill_requirements_role_profile_id_fkey(title, department)').eq('company_id', selectedCompanyId),
      supabase.from('employee_skills').select('skill_id, proficiency_level').eq('company_id', selectedCompanyId),
      supabase.from('skills').select('id, name').eq('company_id', selectedCompanyId),
    ])
    const skillMap = new Map((skills || []).map(s => [s.id, s.name]))
    const empBySkill: Record<string, number[]> = {}
    ;(empSkills || []).forEach(es => {
      if (!empBySkill[es.skill_id]) empBySkill[es.skill_id] = []
      empBySkill[es.skill_id].push(Number(es.proficiency_level || 0))
    })
    const rows = (reqs || []).map(r => {
      const levels = empBySkill[r.skill_id] || []
      const avg = levels.length > 0 ? levels.reduce((s, l) => s + l, 0) / levels.length : 0
      const gap = Number(r.required_level || 3) - avg
      return { Role: (r.role as Record<string, string>)?.title || '', Department: (r.role as Record<string, string>)?.department || '', Skill: skillMap.get(r.skill_id) || '', 'Required Level': r.required_level || 3, 'Avg Employee Level': avg.toFixed(1), 'Gap': gap.toFixed(1), 'Employees with Skill': levels.length }
    }).filter(r => parseFloat(r.Gap as string) > 0).sort((a, b) => parseFloat(b.Gap as string) - parseFloat(a.Gap as string))
    setReportColumns([{ key: 'Role', label: 'Role' }, { key: 'Department', label: 'Department' }, { key: 'Skill', label: 'Skill' }, { key: 'Required Level', label: 'Required' }, { key: 'Avg Employee Level', label: 'Avg Level' }, { key: 'Gap', label: 'Gap' }, { key: 'Employees with Skill', label: 'Staff Count' }])
    setReportData(rows)
    setReportSummary(`${rows.length} skills gaps identified across ${new Set(rows.map(r => r.Role)).size} roles.`)
  }

  function exportReportCsv() {
    if (!reportColumns.length || !reportData.length) return
    const report = REPORTS.find(r => r.key === activeReport)
    const headers = reportColumns.map(c => c.label)
    const rows = reportData.map(row => reportColumns.map(c => csvSafe(String(row[c.key] ?? ''))))
    const csv = [headers.map(h => csvSafe(h)).join(','), ...rows.map(r => r.join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${report?.key || 'report'}-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const filteredData = filter
    ? reportData.filter(row => Object.values(row).some(v => String(v).toLowerCase().includes(filter.toLowerCase())))
    : reportData

  useEffect(() => { setActiveReport(null); setReportData([]) }, [selectedCompanyId])

  if (!selectedCompanyId) return <div className="admin-section"><div className="admin-loading">Select a company to view reports.</div></div>

  return (
    <div className="admin-section alt-section">
      <div className="admin-page-header">
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#00897b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
          HR Reports & Insights
        </h2>
        <p>Operational reports that surface what needs attention across your organisation</p>
      </div>

      {!activeReport ? (
        <div>
          {CATEGORY_ORDER.filter(cat => grouped[cat]).map(cat => (
            <div key={cat} style={{ marginBottom: 28 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-secondary, #64748b)', marginBottom: 12, paddingBottom: 6, borderBottom: '1px solid var(--border, #e2e8f0)' }}>{CATEGORY_LABELS[cat]}</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
                {grouped[cat].map(report => (
                  <button
                    key={report.key}
                    onClick={() => runReport(report.key)}
                    style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 16px', background: 'var(--card-bg, #fff)', border: '1px solid var(--border, #e2e8f0)', borderRadius: 10, cursor: 'pointer', textAlign: 'left', transition: 'all .15s' }}
                    onMouseOver={e => { (e.currentTarget as HTMLElement).style.borderColor = '#00897b'; (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 8px rgba(0,137,123,.12)' }}
                    onMouseOut={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border, #e2e8f0)'; (e.currentTarget as HTMLElement).style.boxShadow = 'none' }}
                  >
                    <span style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 8, background: 'rgba(0,137,123,.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00897b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: report.icon }} />
                    </span>
                    <span>
                      <span style={{ display: 'block', fontWeight: 600, fontSize: 14, color: 'var(--text-primary, #1e293b)', marginBottom: 2 }}>{report.title}</span>
                      <span style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary, #64748b)', lineHeight: 1.4 }}>{report.description}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
            <button className="admin-btn alt-btn-secondary" onClick={() => { setActiveReport(null); setReportData([]) }} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
              All Reports
            </button>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary, #1e293b)', margin: 0, flex: 1 }}>
              {REPORTS.find(r => r.key === activeReport)?.title}
            </h3>
            {reportData.length > 0 && (
              <>
                <input
                  type="text"
                  placeholder="Filter results..."
                  value={filter}
                  onChange={e => setFilter(e.target.value)}
                  style={{ padding: '6px 12px', border: '1px solid var(--border, #e2e8f0)', borderRadius: 6, fontSize: 13, width: 200 }}
                />
                <button className="admin-btn alt-btn-secondary" onClick={exportReportCsv} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Export CSV
                </button>
              </>
            )}
          </div>

          {reportSummary && (
            <div style={{ padding: '10px 16px', background: 'rgba(0,137,123,.06)', border: '1px solid rgba(0,137,123,.15)', borderRadius: 8, marginBottom: 16, fontSize: 13, color: 'var(--text-primary, #1e293b)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00897b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
              {reportSummary}
            </div>
          )}

          {loading ? (
            <div className="admin-loading">Loading report data...</div>
          ) : reportData.length === 0 && reportSummary ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary, #64748b)' }}>No data found for this report.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="alt-table" style={{ width: '100%', fontSize: 13 }}>
                <thead>
                  <tr>
                    {reportColumns.map(c => (
                      <th key={c.key} style={{ whiteSpace: 'nowrap' }}>{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredData.map((row, i) => (
                    <tr key={i}>
                      {reportColumns.map(c => {
                        const val = String(row[c.key] ?? '')
                        const isAlert = val === 'EXPIRED' || val === 'Urgent'
                        return (
                          <td key={c.key} style={isAlert ? { color: '#dc2626', fontWeight: 600 } : undefined}>
                            {val}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredData.length === 0 && filter && (
                <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-secondary, #64748b)', fontSize: 13 }}>No results matching "{filter}"</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
