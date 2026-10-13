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

const PAGE_SIZE = 25

type ReportKey =
  | 'leave-carry-over' | 'outstanding-workflows' | 'pending-leave' | 'pending-expenses'
  | 'overdue-elearning' | 'probation-ending' | 'rtw-expiry' | 'absence-frequency'
  | 'headcount-dept' | 'turnover' | 'overtime-alerts' | 'shift-coverage'
  | 'payroll-variance' | 'benefits-uptake' | 'skills-gaps' | 'onboarding-progress'
  | 'performance-overdue' | 'survey-engagement' | 'stale-tickets' | 'document-expiry'
  | 'shift-discrepancies'

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
  { key: 'shift-discrepancies', title: 'Shift Discrepancy Report', description: 'Missed check-ins, late arrivals, early departures and short hours with per-employee trends', category: 'operations', icon: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>', feature: 'shifts' },
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
  const [reportKPIs, setReportKPIs] = useState<{ label: string; value: string | number; status?: 'good' | 'warning' | 'danger' | 'neutral' }[]>([])
  const [filter, setFilter] = useState('')
  const [page, setPage] = useState(1)

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
    setReportKPIs([])
    setFilter('')
    setPage(1)

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
        case 'shift-discrepancies': await loadShiftDiscrepancies(); break
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
      supabase.from('leave_balances').select('employee_id, leave_type_id, total_allowance, used, carried_over, leave_type:leave_types!leave_balances_leave_type_id_fkey(name)').eq('company_id', selectedCompanyId),
      supabase.from('leave_requests').select('employee_id, leave_type_id, days_requested, status').eq('company_id', selectedCompanyId).in('status', ['approved', 'pending']).gte('start_date', fyStart.toISOString().split('T')[0]).lte('start_date', fyEnd.toISOString().split('T')[0]),
    ])
    const rows = (employees || []).flatMap(emp => {
      const empBals = (balances || []).filter(b => b.employee_id === emp.id)
      return empBals.map(b => {
        const approved = (requests || []).filter(r => r.employee_id === emp.id && r.leave_type_id === b.leave_type_id && r.status === 'approved').reduce((s, r) => s + Number(r.days_requested || 0), 0)
        const pending = (requests || []).filter(r => r.employee_id === emp.id && r.leave_type_id === b.leave_type_id && r.status === 'pending').reduce((s, r) => s + Number(r.days_requested || 0), 0)
        const entitlement = Number(b.total_allowance || 0) + Number(b.carried_over || 0)
        const used = Number(b.used || 0) + approved
        const projected = Math.max(0, entitlement - used - pending)
        const lt = b.leave_type as unknown as { name: string } | null
        return { Employee: `${emp.first_name} ${emp.last_name}`, Department: emp.department || '', 'Leave Type': lt?.name || '', Entitlement: entitlement, Used: used, Pending: pending, 'Projected Unused': projected }
      })
    }).sort((a, b) => (b['Projected Unused'] as number) - (a['Projected Unused'] as number))
    setReportColumns([{ key: 'Employee', label: 'Employee' }, { key: 'Department', label: 'Department' }, { key: 'Leave Type', label: 'Leave Type' }, { key: 'Entitlement', label: 'Entitlement' }, { key: 'Used', label: 'Used' }, { key: 'Pending', label: 'Pending' }, { key: 'Projected Unused', label: 'Projected Unused' }, { key: 'Status', label: 'Status' }])
    const withUnused = rows.filter(r => (r['Projected Unused'] as number) > 0)
    const highUnused = rows.filter(r => (r['Projected Unused'] as number) >= 5)
    const totalUnused = rows.reduce((s, r) => s + (r['Projected Unused'] as number), 0)
    const avgUnused = rows.length > 0 ? totalUnused / rows.length : 0
    const tagged = rows.map(r => ({ ...r, Status: (r['Projected Unused'] as number) >= 10 ? 'High' : (r['Projected Unused'] as number) >= 5 ? 'Medium' : (r['Projected Unused'] as number) > 0 ? 'Low' : 'None' }))
    setReportData(tagged)
    setReportKPIs([
      { label: 'Total Leave Balances', value: rows.length, status: 'neutral' },
      { label: 'With Unused Leave', value: withUnused.length, status: withUnused.length > 0 ? 'warning' : 'good' },
      { label: 'High Unused (5+ days)', value: highUnused.length, status: highUnused.length > 0 ? 'danger' : 'good' },
      { label: 'Total Days to Carry Over', value: totalUnused.toFixed(1), status: totalUnused > 20 ? 'danger' : totalUnused > 0 ? 'warning' : 'good' },
    ])
    setReportSummary(`${rows.length} leave balances across ${(employees || []).length} employees. ${withUnused.length} with projected unused leave (${totalUnused.toFixed(1)} days total, avg ${avgUnused.toFixed(1)} per balance).`)
  }

  async function loadPendingLeave() {
    const { data } = await supabase.from('leave_requests').select('*, employee:employees!leave_requests_employee_id_fkey(first_name, last_name, department)').eq('company_id', selectedCompanyId).eq('status', 'pending').order('created_at', { ascending: true })
    const rows = (data || []).map(r => {
      const days = Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86400000)
      return { Employee: `${r.employee?.first_name} ${r.employee?.last_name}`, Department: r.employee?.department || '', 'Start Date': fmtDate(r.start_date), 'End Date': fmtDate(r.end_date), Days: Number(r.days_requested || 0), 'Days Waiting': days, 'Request Date': fmtDate(r.created_at?.split('T')[0]) }
    })
    const tagged = rows.map(r => ({ ...r, Status: (r['Days Waiting'] as number) > 7 ? 'Overdue' : (r['Days Waiting'] as number) > 3 ? 'Urgent' : 'Pending' }))
    setReportColumns([{ key: 'Employee', label: 'Employee' }, { key: 'Department', label: 'Department' }, { key: 'Start Date', label: 'Start Date' }, { key: 'End Date', label: 'End Date' }, { key: 'Days', label: 'Days' }, { key: 'Days Waiting', label: 'Days Waiting' }, { key: 'Request Date', label: 'Requested' }, { key: 'Status', label: 'Status' }])
    setReportData(tagged)
    const totalDays = rows.reduce((s, r) => s + (r.Days as number), 0)
    const overThree = rows.filter(r => (r['Days Waiting'] as number) > 3)
    const overSeven = rows.filter(r => (r['Days Waiting'] as number) > 7)
    setReportKPIs([
      { label: 'Pending Requests', value: rows.length, status: rows.length > 5 ? 'danger' : rows.length > 0 ? 'warning' : 'good' },
      { label: 'Total Days Requested', value: totalDays.toFixed(1), status: 'neutral' },
      { label: 'Waiting > 3 Days', value: overThree.length, status: overThree.length > 0 ? 'warning' : 'good' },
      { label: 'Waiting > 7 Days', value: overSeven.length, status: overSeven.length > 0 ? 'danger' : 'good' },
    ])
    setReportSummary(`${rows.length} leave requests pending approval. ${overThree.length} waiting more than 3 days, ${overSeven.length} more than 7 days.`)
  }

  async function loadAbsenceFrequency() {
    const [{ data: leaveData }, { data: employees }] = await Promise.all([
      supabase.from('leave_requests').select('employee_id, start_date, days_requested').eq('company_id', selectedCompanyId).eq('status', 'approved').gte('start_date', new Date(Date.now() - 365 * 86400000).toISOString().split('T')[0]),
      supabase.from('employees').select('id, first_name, last_name, department').eq('company_id', selectedCompanyId).eq('is_active', true),
    ])
    const byEmp: Record<string, { spells: number; days: number }> = {}
    ;(leaveData || []).forEach(r => {
      if (!byEmp[r.employee_id]) byEmp[r.employee_id] = { spells: 0, days: 0 }
      byEmp[r.employee_id].spells++
      byEmp[r.employee_id].days += Number(r.days_requested || 0)
    })
    const rows = (employees || []).map(e => {
      const ab = byEmp[e.id] || { spells: 0, days: 0 }
      const bradford = ab.spells * ab.spells * ab.days
      return { Employee: `${e.first_name} ${e.last_name}`, Department: e.department || '', Spells: ab.spells, 'Total Days': ab.days, 'Bradford Score': bradford, 'Risk Level': bradford >= 500 ? 'High' : bradford >= 200 ? 'Medium' : bradford > 0 ? 'Low' : 'None' }
    }).sort((a, b) => (b['Bradford Score'] as number) - (a['Bradford Score'] as number))
    setReportColumns([{ key: 'Employee', label: 'Employee' }, { key: 'Department', label: 'Department' }, { key: 'Spells', label: 'Spells (12m)' }, { key: 'Total Days', label: 'Total Days' }, { key: 'Bradford Score', label: 'Bradford Score' }, { key: 'Risk Level', label: 'Risk Level' }])
    setReportData(rows)
    const totalDaysLost = rows.reduce((s, r) => s + (r['Total Days'] as number), 0)
    const high = rows.filter(r => (r['Bradford Score'] as number) >= 200)
    const withAbsence = rows.filter(r => (r.Spells as number) > 0)
    setReportKPIs([
      { label: 'Active Employees', value: rows.length, status: 'neutral' },
      { label: 'With Absence (12m)', value: withAbsence.length, status: withAbsence.length > 0 ? 'warning' : 'good' },
      { label: 'High Risk (Bradford 200+)', value: high.length, status: high.length > 0 ? 'danger' : 'good' },
      { label: 'Total Days Lost', value: totalDaysLost.toFixed(1), status: totalDaysLost > 30 ? 'danger' : totalDaysLost > 10 ? 'warning' : 'good' },
    ])
    setReportSummary(`${rows.length} employees reviewed. ${withAbsence.length} with absence in the last 12 months. ${high.length} with Bradford score >= 200 (trigger level). ${totalDaysLost.toFixed(1)} total days lost.`)
  }

  async function loadOutstandingWorkflows() {
    const { data } = await supabase.from('workflow_tracker').select('*').eq('company_id', selectedCompanyId).neq('status', 'Complete').order('created_at', { ascending: true })
    const rows = (data || []).map(r => {
      const days = Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86400000)
      return { Title: r.task_description || r.record_type, Type: r.record_type, Status: r.status, 'Assigned To': r.assigned_to || r.emp_display_name || '', 'Days Open': days, Created: fmtDate(r.created_at?.split('T')[0]) }
    })
    const tagged = rows.map(r => ({ ...r, Urgency: (r['Days Open'] as number) > 30 ? 'Critical' : (r['Days Open'] as number) > 14 ? 'Overdue' : (r['Days Open'] as number) > 7 ? 'Urgent' : 'Normal' }))
    setReportColumns([{ key: 'Title', label: 'Title' }, { key: 'Type', label: 'Type' }, { key: 'Status', label: 'Status' }, { key: 'Assigned To', label: 'Assigned To' }, { key: 'Days Open', label: 'Days Open' }, { key: 'Urgency', label: 'Urgency' }, { key: 'Created', label: 'Created' }])
    setReportData(tagged)
    const overWeek = rows.filter(r => (r['Days Open'] as number) > 7)
    const overMonth = rows.filter(r => (r['Days Open'] as number) > 30)
    const avgDays = rows.length > 0 ? rows.reduce((s, r) => s + (r['Days Open'] as number), 0) / rows.length : 0
    setReportKPIs([
      { label: 'Total Outstanding', value: rows.length, status: rows.length > 10 ? 'danger' : rows.length > 5 ? 'warning' : 'neutral' },
      { label: 'Over 7 Days', value: overWeek.length, status: overWeek.length > 0 ? 'warning' : 'good' },
      { label: 'Over 30 Days', value: overMonth.length, status: overMonth.length > 0 ? 'danger' : 'good' },
      { label: 'Avg Days Open', value: avgDays.toFixed(0), status: avgDays > 14 ? 'danger' : avgDays > 7 ? 'warning' : 'good' },
    ])
    setReportSummary(`${rows.length} outstanding workflow actions. ${overWeek.length} open for more than 7 days, ${overMonth.length} over 30 days.`)
  }

  async function loadStaleTickets() {
    const { data } = await supabase.from('hr_tickets').select('*').eq('company_id', selectedCompanyId).in('status', ['open', 'in_progress', 'pending']).order('created_at', { ascending: true })
    const rows = (data || []).map(r => {
      const days = Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86400000)
      return { Ref: r.ref || '', 'Submitted By': r.submitted_by || '', Subject: r.title || '', Category: r.category || '', Status: r.status, 'Days Open': days, Priority: (r.priority || 'normal'), Created: fmtDate(r.created_at?.split('T')[0]) }
    })
    setReportColumns([{ key: 'Ref', label: 'Ref' }, { key: 'Submitted By', label: 'Submitted By' }, { key: 'Subject', label: 'Subject' }, { key: 'Category', label: 'Category' }, { key: 'Status', label: 'Status' }, { key: 'Days Open', label: 'Days Open' }, { key: 'Priority', label: 'Priority' }, { key: 'Created', label: 'Created' }])
    setReportData(rows)
    const stale = rows.filter(r => (r['Days Open'] as number) > 7)
    const avgDays = rows.length > 0 ? rows.reduce((s, r) => s + (r['Days Open'] as number), 0) / rows.length : 0
    setReportKPIs([
      { label: 'Open Tickets', value: rows.length, status: rows.length > 10 ? 'danger' : rows.length > 5 ? 'warning' : 'neutral' },
      { label: 'Stale (7+ days)', value: stale.length, status: stale.length > 0 ? 'danger' : 'good' },
      { label: 'Avg Days Open', value: avgDays.toFixed(0), status: avgDays > 7 ? 'danger' : avgDays > 3 ? 'warning' : 'good' },
      { label: 'Oldest Ticket', value: rows.length > 0 ? `${rows[0]['Days Open']}d` : '0d', status: rows.length > 0 && (rows[0]['Days Open'] as number) > 14 ? 'danger' : 'neutral' },
    ])
    setReportSummary(`${rows.length} open HR tickets. ${stale.length} older than 7 days. Average age: ${avgDays.toFixed(0)} days.`)
  }

  async function loadOnboardingProgress() {
    const { data } = await supabase.from('onboarding').select('*, employee:employees!onboarding_employee_id_fkey(first_name, last_name, department, start_date)').eq('company_id', selectedCompanyId).order('created_at', { ascending: false })
    const rows = (data || []).map(r => {
      const tasks = [
        { name: 'First Day', done: r.first_day },
        { name: 'First Week', done: r.first_week },
        { name: 'First Month', done: r.first_month },
        { name: 'Feedback', done: r.feedback },
        { name: 'Three Month', done: r.three_month },
        { name: 'E-Learning', done: r.elearning },
      ]
      const completed = tasks.filter(t => t.done).length
      const total = tasks.length
      return {
        Employee: r.employee ? `${r.employee.first_name} ${r.employee.last_name}` : (r.firstname ? `${r.firstname} ${r.surname || ''}` : ''),
        Department: r.employee?.department || r.department || '',
        'Start Date': r.employee?.start_date ? fmtDate(r.employee.start_date) : (r.start_date ? fmtDate(r.start_date) : ''),
        Progress: `${completed}/${total}`,
        Status: r.is_complete ? 'Complete' : completed === total ? 'Complete' : 'In Progress',
        'Outstanding': tasks.filter(t => !t.done).map(t => t.name).join(', ') || 'None',
      }
    })
    setReportColumns([{ key: 'Employee', label: 'Employee' }, { key: 'Department', label: 'Department' }, { key: 'Start Date', label: 'Start Date' }, { key: 'Progress', label: 'Progress' }, { key: 'Status', label: 'Status' }, { key: 'Outstanding', label: 'Outstanding Tasks' }])
    setReportData(rows)
    const incomplete = rows.filter(r => r.Status !== 'Complete')
    const complete = rows.filter(r => r.Status === 'Complete')
    const avgProgress = rows.length > 0 ? rows.reduce((s, r) => s + parseInt((r.Progress as string).split('/')[0]), 0) / rows.length : 0
    setReportKPIs([
      { label: 'Total Onboarding', value: rows.length, status: 'neutral' },
      { label: 'Complete', value: complete.length, status: 'good' },
      { label: 'In Progress', value: incomplete.length, status: incomplete.length > 0 ? 'warning' : 'good' },
      { label: 'Avg Completion', value: `${((avgProgress / 6) * 100).toFixed(0)}%`, status: avgProgress >= 5 ? 'good' : avgProgress >= 3 ? 'warning' : 'danger' },
    ])
    setReportSummary(`${rows.length} onboarding records. ${complete.length} complete, ${incomplete.length} still in progress.`)
  }

  async function loadHeadcountDept() {
    const { data } = await supabase.from('employees').select('department, employment_category, is_active').eq('company_id', selectedCompanyId).eq('is_active', true)
    const depts: Record<string, { total: number; employed: number; contractor: number; shiftWorker: number; other: number }> = {}
    ;(data || []).forEach(e => {
      const d = e.department || 'Unassigned'
      if (!depts[d]) depts[d] = { total: 0, employed: 0, contractor: 0, shiftWorker: 0, other: 0 }
      depts[d].total++
      const cat = e.employment_category || 'not_assigned'
      if (cat === 'employed') depts[d].employed++
      else if (cat === 'contractor') depts[d].contractor++
      else if (cat === 'shift_worker') depts[d].shiftWorker++
      else depts[d].other++
    })
    const rows = Object.entries(depts).map(([dept, c]) => ({
      Department: dept, Employed: c.employed, Contractor: c.contractor, 'Shift Worker': c.shiftWorker, Unassigned: c.other, Total: c.total,
    })).sort((a, b) => (b.Total as number) - (a.Total as number))
    setReportColumns([{ key: 'Department', label: 'Department' }, { key: 'Employed', label: 'Employed' }, { key: 'Contractor', label: 'Contractor' }, { key: 'Shift Worker', label: 'Shift Worker' }, { key: 'Unassigned', label: 'Unassigned' }, { key: 'Total', label: 'Total' }])
    setReportData(rows)
    const total = (data || []).length
    const totalContractors = rows.reduce((s, r) => s + (r.Contractor as number), 0)
    setReportKPIs([
      { label: 'Total Headcount', value: total, status: 'neutral' },
      { label: 'Departments', value: Object.keys(depts).length, status: 'neutral' },
      { label: 'Employed', value: rows.reduce((s, r) => s + (r.Employed as number), 0), status: 'neutral' },
      { label: 'Contractors', value: totalContractors, status: 'neutral' },
    ])
    setReportSummary(`${total} active employees across ${Object.keys(depts).length} departments.`)
  }

  async function loadTurnover() {
    const fyStartStr = fyStart.toISOString().split('T')[0]
    const [{ data: offboarded }, { data: active }] = await Promise.all([
      supabase.from('offboarding').select('employee_name, employee_email, department, end_date, reason').eq('company_id', selectedCompanyId).gte('end_date', fyStartStr),
      supabase.from('employees').select('id').eq('company_id', selectedCompanyId).eq('is_active', true),
    ])
    const rows = (offboarded || []).map(e => ({
      Employee: e.employee_name || '', Department: e.department || '', 'Leave Date': e.end_date ? fmtDate(e.end_date) : '', Reason: e.reason || '',
    }))
    setReportColumns([{ key: 'Employee', label: 'Employee' }, { key: 'Department', label: 'Department' }, { key: 'Leave Date', label: 'Leave Date' }, { key: 'Reason', label: 'Reason' }])
    setReportData(rows)
    const activeCount = (active || []).length
    const leaverCount = rows.length
    const monthsElapsed = Math.max(1, (Date.now() - fyStart.getTime()) / (30.44 * 86400000))
    const annualised = (leaverCount / monthsElapsed) * 12
    const rate = activeCount > 0 ? ((annualised / activeCount) * 100).toFixed(1) : '0'
    setReportKPIs([
      { label: 'Leavers (FY)', value: leaverCount, status: leaverCount > 5 ? 'danger' : leaverCount > 2 ? 'warning' : 'neutral' },
      { label: 'Turnover Rate', value: `${rate}%`, status: parseFloat(rate) > 20 ? 'danger' : parseFloat(rate) > 10 ? 'warning' : 'good' },
      { label: 'Active Headcount', value: activeCount, status: 'neutral' },
      { label: 'FY Months Elapsed', value: Math.floor(monthsElapsed), status: 'neutral' },
    ])
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
    const within7 = rows.filter(r => (r['Days Remaining'] as number) <= 7)
    const within14 = rows.filter(r => (r['Days Remaining'] as number) <= 14)
    setReportKPIs([
      { label: 'Ending in 30 Days', value: rows.length, status: rows.length > 3 ? 'warning' : 'neutral' },
      { label: 'Within 7 Days', value: within7.length, status: within7.length > 0 ? 'danger' : 'good' },
      { label: 'Within 14 Days', value: within14.length, status: within14.length > 0 ? 'warning' : 'good' },
    ])
    setReportSummary(`${rows.length} employees with probation ending in the next 30 days. ${within7.length} within 7 days.`)
  }

  async function loadPendingExpenses() {
    const { data } = await supabase.from('expense_claims').select('*, employee:employees!expense_claims_employee_id_fkey(first_name, last_name, department)').eq('company_id', selectedCompanyId).eq('status', 'pending').order('created_at', { ascending: true })
    const rows = (data || []).map(r => {
      const days = Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86400000)
      return { Employee: r.employee ? `${r.employee.first_name} ${r.employee.last_name}` : '', Department: r.employee?.department || '', Description: r.description || '', Amount: `£${Number(r.amount || 0).toFixed(2)}`, 'Days Waiting': days, Submitted: fmtDate(r.created_at?.split('T')[0]) }
    })
    setReportColumns([{ key: 'Employee', label: 'Employee' }, { key: 'Department', label: 'Department' }, { key: 'Description', label: 'Description' }, { key: 'Amount', label: 'Amount' }, { key: 'Days Waiting', label: 'Days Waiting' }, { key: 'Submitted', label: 'Submitted' }])
    setReportData(rows)
    const total = rows.reduce((s, r) => s + parseFloat((r.Amount as string).replace('£', '')), 0)
    const avgWaiting = rows.length > 0 ? rows.reduce((s, r) => s + (r['Days Waiting'] as number), 0) / rows.length : 0
    const overWeek = rows.filter(r => (r['Days Waiting'] as number) > 7)
    setReportKPIs([
      { label: 'Pending Claims', value: rows.length, status: rows.length > 5 ? 'danger' : rows.length > 0 ? 'warning' : 'good' },
      { label: 'Total Value', value: `£${total.toFixed(2)}`, status: total > 1000 ? 'danger' : total > 500 ? 'warning' : 'neutral' },
      { label: 'Avg Wait (days)', value: avgWaiting.toFixed(0), status: avgWaiting > 7 ? 'danger' : avgWaiting > 3 ? 'warning' : 'good' },
      { label: 'Over 7 Days', value: overWeek.length, status: overWeek.length > 0 ? 'danger' : 'good' },
    ])
    setReportSummary(`${rows.length} expense claims awaiting approval. Total value: £${total.toFixed(2)}. ${overWeek.length} waiting more than 7 days.`)
  }

  async function loadPayrollVariance() {
    const { data } = await supabase.from('payslips').select('pay_period_start, gross_pay, net_pay, tax, national_insurance').eq('company_id', selectedCompanyId).gte('pay_period_start', fyStart.toISOString().split('T')[0]).order('pay_period_start')
    const byMonth: Record<string, { gross: number; net: number; tax: number; ni: number; count: number }> = {}
    ;(data || []).forEach(p => {
      const m = p.pay_period_start.substring(0, 7)
      if (!byMonth[m]) byMonth[m] = { gross: 0, net: 0, tax: 0, ni: 0, count: 0 }
      byMonth[m].gross += Number(p.gross_pay || 0)
      byMonth[m].net += Number(p.net_pay || 0)
      byMonth[m].tax += Number(p.tax || 0)
      byMonth[m].ni += Number(p.national_insurance || 0)
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
    const totalGross = Object.values(byMonth).reduce((s, m) => s + m.gross, 0)
    const latestMonth = months.length > 0 ? byMonth[months[months.length - 1]] : null
    setReportKPIs([
      { label: 'Periods Processed', value: months.length, status: 'neutral' },
      { label: 'Total Payslips', value: (data || []).length, status: 'neutral' },
      { label: 'Total Gross Pay', value: `£${totalGross.toFixed(2)}`, status: 'neutral' },
      { label: 'Latest Headcount', value: latestMonth?.count || 0, status: 'neutral' },
    ])
    setReportSummary(`${months.length} payroll periods this FY. ${(data || []).length} total payslips processed. Total gross: £${totalGross.toFixed(2)}.`)
  }

  async function loadOvertimeAlerts() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
    const [{ data: timesheets }, { data: employees }] = await Promise.all([
      supabase.from('timesheets').select('employee_id, hours').eq('company_id', selectedCompanyId).gte('date', thirtyDaysAgo),
      supabase.from('employees').select('id, first_name, last_name, department, weekly_hours').eq('company_id', selectedCompanyId).eq('is_active', true),
    ])
    const byEmp: Record<string, number> = {}
    ;(timesheets || []).forEach(t => {
      byEmp[t.employee_id] = (byEmp[t.employee_id] || 0) + Number(t.hours || 0)
    })
    const rows = (employees || []).filter(e => {
      const logged = byEmp[e.id] || 0
      const contracted = Number(e.weekly_hours || 37.5) * 4.33
      return logged > contracted
    }).map(e => {
      const logged = byEmp[e.id] || 0
      const contracted = Number(e.weekly_hours || 37.5) * 4.33
      return { Employee: `${e.first_name} ${e.last_name}`, Department: e.department || '', 'Contracted (monthly)': contracted.toFixed(1), 'Logged (30d)': logged.toFixed(1), Excess: (logged - contracted).toFixed(1) }
    }).sort((a, b) => parseFloat(b.Excess as string) - parseFloat(a.Excess as string))
    setReportColumns([{ key: 'Employee', label: 'Employee' }, { key: 'Department', label: 'Department' }, { key: 'Contracted (monthly)', label: 'Contracted (monthly)' }, { key: 'Logged (30d)', label: 'Logged (30d)' }, { key: 'Excess', label: 'Excess Hours' }])
    setReportData(rows)
    const totalExcess = rows.reduce((s, r) => s + parseFloat(r.Excess as string), 0)
    const maxExcess = rows.length > 0 ? Math.max(...rows.map(r => parseFloat(r.Excess as string))) : 0
    setReportKPIs([
      { label: 'Over Contracted', value: rows.length, status: rows.length > 3 ? 'danger' : rows.length > 0 ? 'warning' : 'good' },
      { label: 'Total Excess Hours', value: totalExcess.toFixed(1), status: totalExcess > 40 ? 'danger' : totalExcess > 20 ? 'warning' : 'neutral' },
      { label: 'Max Excess (single)', value: maxExcess.toFixed(1), status: maxExcess > 20 ? 'danger' : maxExcess > 10 ? 'warning' : 'neutral' },
      { label: 'Total Staff Tracked', value: (employees || []).length, status: 'neutral' },
    ])
    setReportSummary(`${rows.length} employees exceeding contracted hours. ${totalExcess.toFixed(1)} total excess hours in the last 30 days.`)
  }

  async function loadOverdueElearning() {
    const [enrolRes, completionRes, enabledRes, courseRes, empRes] = await Promise.all([
      supabase.from('course_enrolments').select('employee_id, course_id, status, progress_pct, enrolled_at').eq('company_id', selectedCompanyId),
      supabase.from('elearning_completions').select('employee_id, course_id').eq('company_id', selectedCompanyId),
      supabase.from('company_elearning_courses').select('course_id').eq('company_id', selectedCompanyId).eq('is_enabled', true),
      supabase.from('elearning_courses').select('id, title, required').eq('is_active', true),
      supabase.from('employees').select('id, first_name, last_name, department').eq('company_id', selectedCompanyId).eq('is_active', true),
    ])
    const completedSet = new Set((completionRes.data || []).map((r: any) => `${r.employee_id}|${r.course_id}`))
    const enabledIds = new Set((enabledRes.data || []).map((r: any) => r.course_id))
    const courseMap: Record<string, any> = {}
    ;(courseRes.data || []).forEach((c: any) => { courseMap[c.id] = c })
    const empMap: Record<string, any> = {}
    ;(empRes.data || []).forEach((e: any) => { empMap[e.id] = e })
    const rows = (enrolRes.data || [])
      .filter((r: any) => enabledIds.has(r.course_id) && courseMap[r.course_id]?.required && !completedSet.has(`${r.employee_id}|${r.course_id}`))
      .map((r: any) => {
        const emp = empMap[r.employee_id]
        const course = courseMap[r.course_id]
        return { Employee: emp ? `${emp.first_name} ${emp.last_name}` : '', Department: emp?.department || '', Course: course?.title || '', Status: r.status === 'not_started' ? 'Not Started' : 'In Progress', 'Progress': `${r.progress_pct || 0}%` }
      }).sort((a: any, b: any) => parseInt(a.Progress) - parseInt(b.Progress))
    setReportColumns([{ key: 'Employee', label: 'Employee' }, { key: 'Department', label: 'Department' }, { key: 'Course', label: 'Course' }, { key: 'Status', label: 'Status' }, { key: 'Progress', label: 'Progress' }])
    setReportData(rows)
    const uniqueEmps = new Set(rows.map((r: any) => r.Employee)).size
    const notStarted = rows.filter((r: any) => r.Status === 'Not Started')
    setReportKPIs([
      { label: 'Incomplete Enrolments', value: rows.length, status: rows.length > 5 ? 'danger' : rows.length > 0 ? 'warning' : 'good' },
      { label: 'Employees Affected', value: uniqueEmps, status: uniqueEmps > 3 ? 'danger' : uniqueEmps > 0 ? 'warning' : 'good' },
      { label: 'Not Started', value: notStarted.length, status: notStarted.length > 0 ? 'danger' : 'good' },
      { label: 'Courses Affected', value: new Set(rows.map((r: any) => r.Course)).size, status: 'neutral' },
    ])
    setReportSummary(`${rows.length} incomplete mandatory e-learning enrolments affecting ${uniqueEmps} employees. ${notStarted.length} not yet started.`)
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
    const urgent = rows.filter(r => r.Status === 'Urgent')
    setReportKPIs([
      { label: 'Expiring (90 days)', value: rows.length, status: rows.length > 3 ? 'danger' : rows.length > 0 ? 'warning' : 'good' },
      { label: 'Already Expired', value: expired.length, status: expired.length > 0 ? 'danger' : 'good' },
      { label: 'Within 30 Days', value: urgent.length, status: urgent.length > 0 ? 'danger' : 'good' },
      { label: 'Upcoming', value: rows.length - expired.length - urgent.length, status: 'neutral' },
    ])
    setReportSummary(`${rows.length} right-to-work documents expiring within 90 days. ${expired.length} already expired, ${urgent.length} within 30 days.`)
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
    const urgent = rows.filter(r => r.Status === 'Urgent')
    const uniqueEmps = new Set(rows.map(r => r.Employee)).size
    setReportKPIs([
      { label: 'Expiring (90 days)', value: rows.length, status: rows.length > 5 ? 'danger' : rows.length > 0 ? 'warning' : 'good' },
      { label: 'Already Expired', value: expired.length, status: expired.length > 0 ? 'danger' : 'good' },
      { label: 'Within 30 Days', value: urgent.length, status: urgent.length > 0 ? 'danger' : 'good' },
      { label: 'Employees Affected', value: uniqueEmps, status: 'neutral' },
    ])
    setReportSummary(`${rows.length} documents expiring within 90 days. ${expired.length} already expired. ${uniqueEmps} employees affected.`)
  }

  async function loadPerformanceOverdue() {
    const { data } = await supabase.from('performance_reviews').select('*, employee:employees!performance_reviews_employee_id_fkey(first_name, last_name, department)').eq('company_id', selectedCompanyId).in('status', ['draft', 'in_progress'])
    const rows = (data || []).map(r => {
      const createdDate = r.created_at?.split('T')[0] || ''
      const days = createdDate ? Math.floor((Date.now() - new Date(createdDate + 'T00:00:00').getTime()) / 86400000) : 0
      return { Employee: r.employee ? `${r.employee.first_name} ${r.employee.last_name}` : '', Department: r.employee?.department || '', 'Review Period': r.review_period || '', 'Created': createdDate ? fmtDate(createdDate) : '', 'Days Since Created': days, Status: r.status === 'draft' ? 'Draft' : 'In Progress' }
    }).sort((a, b) => (b['Days Since Created'] as number) - (a['Days Since Created'] as number))
    setReportColumns([{ key: 'Employee', label: 'Employee' }, { key: 'Department', label: 'Department' }, { key: 'Review Period', label: 'Review Period' }, { key: 'Created', label: 'Created' }, { key: 'Days Since Created', label: 'Days Open' }, { key: 'Status', label: 'Status' }])
    setReportData(rows)
    const uniqueEmps = new Set(rows.map(r => r.Employee)).size
    const avgDays = rows.length > 0 ? rows.reduce((s, r) => s + (r['Days Since Created'] as number), 0) / rows.length : 0
    const drafts = rows.filter(r => r.Status === 'Draft')
    setReportKPIs([
      { label: 'Incomplete Reviews', value: rows.length, status: rows.length > 5 ? 'danger' : rows.length > 0 ? 'warning' : 'good' },
      { label: 'Employees Affected', value: uniqueEmps, status: uniqueEmps > 3 ? 'danger' : uniqueEmps > 0 ? 'warning' : 'good' },
      { label: 'Still in Draft', value: drafts.length, status: drafts.length > 0 ? 'warning' : 'good' },
      { label: 'Avg Days Open', value: avgDays.toFixed(0), status: avgDays > 30 ? 'danger' : avgDays > 14 ? 'warning' : 'neutral' },
    ])
    setReportSummary(`${rows.length} performance reviews not yet completed. ${uniqueEmps} employees affected. ${drafts.length} still in draft.`)
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
      return { Survey: d.survey?.title || '', 'Start Date': d.starts_at ? fmtDate(d.starts_at.split('T')[0]) : '', 'End Date': d.ends_at ? fmtDate(d.ends_at.split('T')[0]) : '', Responses: uniqueRespondents, 'Total Eligible': totalEmps, 'Response Rate': `${rate}%`, Outstanding: totalEmps - uniqueRespondents }
    })
    setReportColumns([{ key: 'Survey', label: 'Survey' }, { key: 'Start Date', label: 'Start Date' }, { key: 'End Date', label: 'End Date' }, { key: 'Responses', label: 'Responses' }, { key: 'Total Eligible', label: 'Eligible' }, { key: 'Response Rate', label: 'Response Rate' }, { key: 'Outstanding', label: 'Outstanding' }])
    setReportData(rows)
    const totalResponses = rows.reduce((s, r) => s + (r.Responses as number), 0)
    const totalOutstanding = rows.reduce((s, r) => s + (r.Outstanding as number), 0)
    const avgRate = rows.length > 0 ? rows.reduce((s, r) => s + parseFloat((r['Response Rate'] as string).replace('%', '')), 0) / rows.length : 0
    setReportKPIs([
      { label: 'Active Surveys', value: rows.length, status: 'neutral' },
      { label: 'Total Responses', value: totalResponses, status: 'neutral' },
      { label: 'Avg Response Rate', value: `${avgRate.toFixed(0)}%`, status: avgRate < 50 ? 'danger' : avgRate < 75 ? 'warning' : 'good' },
      { label: 'Outstanding', value: totalOutstanding, status: totalOutstanding > 10 ? 'warning' : 'neutral' },
    ])
    setReportSummary(`${rows.length} active survey deployments. ${totalResponses} total responses. ${totalOutstanding} outstanding.`)
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
    const avgUptake = rows.length > 0 ? rows.reduce((s, r) => s + parseFloat(r['Uptake Rate'] as string), 0) / rows.length : 0
    const highestUptake = rows.length > 0 ? rows[0] : null
    const lowestUptake = rows.length > 0 ? rows[rows.length - 1] : null
    setReportKPIs([
      { label: 'Benefits Available', value: (benefits || []).length, status: 'neutral' },
      { label: 'Avg Uptake Rate', value: `${avgUptake.toFixed(0)}%`, status: avgUptake < 30 ? 'danger' : avgUptake < 60 ? 'warning' : 'good' },
      { label: 'Highest Uptake', value: highestUptake ? `${highestUptake['Uptake Rate']}` : '—', status: 'good' },
      { label: 'Lowest Uptake', value: lowestUptake ? `${lowestUptake['Uptake Rate']}` : '—', status: lowestUptake && parseFloat(lowestUptake['Uptake Rate'] as string) < 20 ? 'danger' : 'neutral' },
    ])
    setReportSummary(`${(benefits || []).length} benefits available. Average uptake: ${avgUptake.toFixed(1)}%.`)
  }

  async function loadShiftDiscrepancies() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
    const today = new Date().toISOString().split('T')[0]
    const LATE_THRESHOLD_MINS = 10
    const EARLY_THRESHOLD_MINS = 10
    const SHORT_HOURS_THRESHOLD_MINS = 30

    const [{ data: assignments }, { data: checkins }] = await Promise.all([
      supabase.from('shift_assignments' as 'shift_assignments').select('id, date, employee_id, employee:employees!shift_assignments_employee_id_fkey(first_name, last_name), shift_template:shift_templates!shift_assignments_shift_template_id_fkey(name, start_time, end_time, break_minutes), rota:rotas!shift_assignments_rota_id_fkey(status)').eq('company_id', selectedCompanyId).gte('date', thirtyDaysAgo).lte('date', today).not('employee_id', 'is', null),
      supabase.from('checkin_records' as 'checkin_records').select('shift_assignment_id, check_in_at, check_out_at, status').eq('company_id', selectedCompanyId).eq('source', 'shifts').gte('check_in_at', thirtyDaysAgo + 'T00:00:00'),
    ])

    const checkinByAssignment = new Map<string, Record<string, unknown>>()
    ;(checkins || []).forEach((c: Record<string, unknown>) => {
      if (c.shift_assignment_id) checkinByAssignment.set(c.shift_assignment_id as string, c)
    })

    const rows: Record<string, unknown>[] = []
    const employeeIssues: Record<string, { name: string; noCheckin: number; late: number; earlyOut: number; missedCheckout: number; shortHours: number }> = {}

    ;(assignments || []).filter((a: Record<string, unknown>) => (a.rota as Record<string, unknown>)?.status === 'published').forEach((a: Record<string, unknown>) => {
      const emp = a.employee as Record<string, string>
      const tmpl = a.shift_template as Record<string, unknown>
      if (!emp || !tmpl) return
      const empName = `${emp.first_name} ${emp.last_name}`
      const empId = a.employee_id as string
      if (!employeeIssues[empId]) employeeIssues[empId] = { name: empName, noCheckin: 0, late: 0, earlyOut: 0, missedCheckout: 0, shortHours: 0 }

      const checkin = checkinByAssignment.get(a.id as string)
      const shiftName = (tmpl.name as string) || ''
      const shiftStart = tmpl.start_time as string
      const shiftEnd = tmpl.end_time as string
      const breakMins = Number(tmpl.break_minutes || 0)
      const dateStr = a.date as string

      if (!checkin) {
        const assignmentDate = new Date(dateStr + 'T00:00:00')
        if (assignmentDate < new Date(today + 'T00:00:00')) {
          rows.push({ Employee: empName, Date: fmtDate(dateStr), Shift: shiftName, Expected: `${shiftStart} — ${shiftEnd}`, Actual: '—', 'Discrepancy Type': 'No Check-in', Variance: 'Entire shift' })
          employeeIssues[empId].noCheckin++
        }
        return
      }

      const checkinTime = new Date(checkin.check_in_at as string)
      const scheduledStart = new Date(`${dateStr}T${shiftStart}`)
      const lateMins = Math.round((checkinTime.getTime() - scheduledStart.getTime()) / 60000)
      if (lateMins > LATE_THRESHOLD_MINS) {
        rows.push({ Employee: empName, Date: fmtDate(dateStr), Shift: shiftName, Expected: shiftStart, Actual: checkinTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), 'Discrepancy Type': 'Late Check-in', Variance: `${lateMins} mins late` })
        employeeIssues[empId].late++
      }

      if (checkin.status === 'checked_in' || checkin.status === 'auto_closed') {
        rows.push({ Employee: empName, Date: fmtDate(dateStr), Shift: shiftName, Expected: shiftEnd, Actual: checkin.status === 'auto_closed' ? 'Auto-closed' : 'Still open', 'Discrepancy Type': 'Missed Check-out', Variance: checkin.status === 'auto_closed' ? 'Auto-closed by system' : 'No check-out recorded' })
        employeeIssues[empId].missedCheckout++
      } else if (checkin.check_out_at) {
        const checkoutTime = new Date(checkin.check_out_at as string)
        const scheduledEnd = new Date(`${dateStr}T${shiftEnd}`)
        const earlyMins = Math.round((scheduledEnd.getTime() - checkoutTime.getTime()) / 60000)
        if (earlyMins > EARLY_THRESHOLD_MINS) {
          rows.push({ Employee: empName, Date: fmtDate(dateStr), Shift: shiftName, Expected: shiftEnd, Actual: checkoutTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), 'Discrepancy Type': 'Early Check-out', Variance: `${earlyMins} mins early` })
          employeeIssues[empId].earlyOut++
        }

        const workedMins = Math.round((checkoutTime.getTime() - checkinTime.getTime()) / 60000) - breakMins
        const [sh, sm] = shiftStart.split(':').map(Number)
        const [eh, em] = shiftEnd.split(':').map(Number)
        const expectedMins = (eh * 60 + em) - (sh * 60 + sm) - breakMins
        const shortfall = expectedMins - workedMins
        if (shortfall > SHORT_HOURS_THRESHOLD_MINS && earlyMins <= EARLY_THRESHOLD_MINS && lateMins <= LATE_THRESHOLD_MINS) {
          const hrs = Math.floor(shortfall / 60)
          const mins = shortfall % 60
          rows.push({ Employee: empName, Date: fmtDate(dateStr), Shift: shiftName, Expected: `${Math.floor(expectedMins / 60)}h ${expectedMins % 60}m`, Actual: `${Math.floor(workedMins / 60)}h ${workedMins % 60}m`, 'Discrepancy Type': 'Short Hours', Variance: hrs > 0 ? `${hrs}h ${mins}m short` : `${mins}m short` })
          employeeIssues[empId].shortHours++
        }
      }
    })

    rows.sort((a, b) => {
      const da = new Date((a.Date as string).split(' ').reverse().join('-'))
      const db = new Date((b.Date as string).split(' ').reverse().join('-'))
      return db.getTime() - da.getTime()
    })

    setReportColumns([
      { key: 'Employee', label: 'Employee' }, { key: 'Date', label: 'Date' }, { key: 'Shift', label: 'Shift' },
      { key: 'Expected', label: 'Expected' }, { key: 'Actual', label: 'Actual' },
      { key: 'Discrepancy Type', label: 'Discrepancy Type' }, { key: 'Variance', label: 'Variance' },
    ])
    setReportData(rows)

    const noCheckins = rows.filter(r => r['Discrepancy Type'] === 'No Check-in').length
    const missedCheckouts = rows.filter(r => r['Discrepancy Type'] === 'Missed Check-out').length
    const lateCheckins = rows.filter(r => r['Discrepancy Type'] === 'Late Check-in').length
    const employeesAffected = Object.keys(employeeIssues).filter(id => {
      const e = employeeIssues[id]
      return e.noCheckin + e.late + e.earlyOut + e.missedCheckout + e.shortHours > 0
    }).length

    setReportKPIs([
      { label: 'Total Discrepancies', value: rows.length, status: rows.length > 20 ? 'danger' : rows.length > 5 ? 'warning' : 'good' },
      { label: 'No Check-ins', value: noCheckins, status: noCheckins > 5 ? 'danger' : noCheckins > 0 ? 'warning' : 'good' },
      { label: 'Missed Check-outs', value: missedCheckouts, status: missedCheckouts > 5 ? 'danger' : missedCheckouts > 0 ? 'warning' : 'good' },
      { label: 'Employees Affected', value: employeesAffected, status: employeesAffected > 5 ? 'danger' : employeesAffected > 0 ? 'warning' : 'neutral' },
    ])

    const trendEmployees = Object.values(employeeIssues)
      .filter(e => e.noCheckin + e.late + e.earlyOut + e.missedCheckout + e.shortHours > 0)
      .sort((a, b) => (b.noCheckin + b.late + b.earlyOut + b.missedCheckout + b.shortHours) - (a.noCheckin + a.late + a.earlyOut + a.missedCheckout + a.shortHours))
    const trendSummary = trendEmployees.length > 0
      ? ` Top offenders: ${trendEmployees.slice(0, 3).map(e => `${e.name} (${e.noCheckin + e.late + e.earlyOut + e.missedCheckout + e.shortHours} issues)`).join(', ')}.`
      : ''
    setReportSummary(`${rows.length} discrepancies found across ${employeesAffected} employees in the last 30 days. ${noCheckins} missed check-ins, ${lateCheckins} late arrivals, ${missedCheckouts} missed check-outs.${trendSummary}`)
  }

  async function loadShiftCoverage() {
    const today = new Date().toISOString().split('T')[0]
    const in14 = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0]
    const { data } = await supabase.from('shift_assignments' as 'shift_assignments').select('*, shift_template:shift_templates!shift_assignments_shift_template_id_fkey(name, start_time, end_time), employee:employees!shift_assignments_employee_id_fkey(first_name, last_name)').eq('company_id', selectedCompanyId).gte('date', today).lte('date', in14).is('employee_id', null)
    const rows = (data || []).map((s: Record<string, unknown>) => ({
      Date: fmtDate(s.date as string),
      Shift: (s.shift_template as Record<string, string>)?.name || '',
      Time: `${(s.shift_template as Record<string, string>)?.start_time || ''} — ${(s.shift_template as Record<string, string>)?.end_time || ''}`,
      Status: 'Unassigned',
    }))
    setReportColumns([{ key: 'Date', label: 'Date' }, { key: 'Shift', label: 'Shift' }, { key: 'Time', label: 'Time' }, { key: 'Status', label: 'Status' }])
    setReportData(rows)
    const uniqueDates = new Set(rows.map(r => r.Date)).size
    const thisWeek = rows.filter(r => {
      const d = new Date(r.Date as string)
      return d.getTime() <= Date.now() + 7 * 86400000
    })
    setReportKPIs([
      { label: 'Unassigned Slots', value: rows.length, status: rows.length > 5 ? 'danger' : rows.length > 0 ? 'warning' : 'good' },
      { label: 'Days Affected', value: uniqueDates, status: uniqueDates > 3 ? 'danger' : uniqueDates > 0 ? 'warning' : 'good' },
      { label: 'This Week', value: thisWeek.length, status: thisWeek.length > 0 ? 'danger' : 'good' },
      { label: 'Next Week', value: rows.length - thisWeek.length, status: 'neutral' },
    ])
    setReportSummary(`${rows.length} unassigned shift slots in the next 14 days across ${uniqueDates} days.`)
  }

  async function loadSkillsGaps() {
    const [{ data: reqs }, { data: empSkills }, { data: skills }] = await Promise.all([
      supabase.from('role_skill_requirements').select('*, skill:skills!role_skill_requirements_skill_id_fkey(name), role:role_profiles!role_skill_requirements_role_profile_id_fkey(title, department)').eq('company_id', selectedCompanyId),
      supabase.from('employee_skills').select('skill_id, proficiency').eq('company_id', selectedCompanyId),
      supabase.from('skills').select('id, name').eq('company_id', selectedCompanyId),
    ])
    const skillMap = new Map((skills || []).map(s => [s.id, s.name]))
    const empBySkill: Record<string, number[]> = {}
    ;(empSkills || []).forEach(es => {
      if (!empBySkill[es.skill_id]) empBySkill[es.skill_id] = []
      empBySkill[es.skill_id].push(Number(es.proficiency || 0))
    })
    const rows = (reqs || []).map(r => {
      const levels = empBySkill[r.skill_id] || []
      const avg = levels.length > 0 ? levels.reduce((s, l) => s + l, 0) / levels.length : 0
      const gap = Number(r.min_proficiency || 3) - avg
      return { Role: (r.role as Record<string, string>)?.title || '', Department: (r.role as Record<string, string>)?.department || '', Skill: skillMap.get(r.skill_id) || '', 'Required Level': r.min_proficiency || 3, 'Avg Employee Level': avg.toFixed(1), 'Gap': gap.toFixed(1), 'Employees with Skill': levels.length }
    }).filter(r => parseFloat(r.Gap as string) > 0).sort((a, b) => parseFloat(b.Gap as string) - parseFloat(a.Gap as string))
    setReportColumns([{ key: 'Role', label: 'Role' }, { key: 'Department', label: 'Department' }, { key: 'Skill', label: 'Skill' }, { key: 'Required Level', label: 'Required' }, { key: 'Avg Employee Level', label: 'Avg Level' }, { key: 'Gap', label: 'Gap' }, { key: 'Employees with Skill', label: 'Staff Count' }])
    setReportData(rows)
    const avgGap = rows.length > 0 ? rows.reduce((s, r) => s + parseFloat(r.Gap as string), 0) / rows.length : 0
    const rolesAffected = new Set(rows.map(r => r.Role)).size
    setReportKPIs([
      { label: 'Skills Gaps', value: rows.length, status: rows.length > 10 ? 'danger' : rows.length > 5 ? 'warning' : 'neutral' },
      { label: 'Roles Affected', value: rolesAffected, status: rolesAffected > 3 ? 'danger' : rolesAffected > 0 ? 'warning' : 'good' },
      { label: 'Avg Gap Size', value: avgGap.toFixed(1), status: avgGap > 2 ? 'danger' : avgGap > 1 ? 'warning' : 'neutral' },
      { label: 'Skills Needed', value: new Set(rows.map(r => r.Skill)).size, status: 'neutral' },
    ])
    setReportSummary(`${rows.length} skills gaps identified across ${rolesAffected} roles. Average gap: ${avgGap.toFixed(1)} levels.`)
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

  const totalPages = Math.max(1, Math.ceil(filteredData.length / PAGE_SIZE))
  const pagedData = filteredData.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  useEffect(() => { setPage(1) }, [filter])
  useEffect(() => { setActiveReport(null); setReportData([]); setReportKPIs([]) }, [selectedCompanyId])

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
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
            <button className="admin-btn alt-btn-secondary" onClick={() => { setActiveReport(null); setReportData([]); setReportKPIs([]) }} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
              All Reports
            </button>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary, #1e293b)', margin: 0, flex: 1 }}>
              {REPORTS.find(r => r.key === activeReport)?.title}
            </h3>
            {reportData.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="text"
                  placeholder="Filter results..."
                  value={filter}
                  onChange={e => setFilter(e.target.value)}
                  style={{ padding: '8px 12px', border: '1px solid var(--border, #e2e8f0)', borderRadius: 8, fontSize: 13, width: 220, background: 'var(--card-bg, #fff)' }}
                />
                <button className="admin-btn alt-btn-secondary" onClick={exportReportCsv} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Export CSV
                </button>
              </div>
            )}
          </div>

          {reportKPIs.length > 0 && !loading && (
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(reportKPIs.length, 4)}, 1fr)`, gap: 12, marginBottom: 20 }}>
              {reportKPIs.map((kpi, i) => {
                const colors: Record<string, { bg: string; border: string; text: string }> = {
                  good: { bg: 'rgba(16,185,129,.08)', border: 'rgba(16,185,129,.2)', text: '#059669' },
                  warning: { bg: 'rgba(245,158,11,.08)', border: 'rgba(245,158,11,.2)', text: '#d97706' },
                  danger: { bg: 'rgba(239,68,68,.08)', border: 'rgba(239,68,68,.2)', text: '#dc2626' },
                  neutral: { bg: 'rgba(100,116,139,.06)', border: 'rgba(100,116,139,.15)', text: 'var(--text-primary, #1e293b)' },
                }
                const c = colors[kpi.status || 'neutral']
                return (
                  <div key={i} style={{ padding: '16px 18px', background: c.bg, border: `1px solid ${c.border}`, borderRadius: 10, textAlign: 'center' }}>
                    <div style={{ fontSize: 28, fontWeight: 700, color: c.text, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>{kpi.value}</div>
                    <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary, #64748b)', marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>{kpi.label}</div>
                  </div>
                )
              })}
            </div>
          )}

          {reportSummary && !loading && (
            <div style={{ padding: '10px 16px', background: 'rgba(0,137,123,.06)', border: '1px solid rgba(0,137,123,.15)', borderRadius: 8, marginBottom: 16, fontSize: 13, color: 'var(--text-primary, #1e293b)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00897b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
              {reportSummary}
            </div>
          )}

          {loading ? (
            <div className="admin-loading">Loading report data...</div>
          ) : reportData.length === 0 && reportSummary ? (
            <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-secondary, #64748b)' }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4, marginBottom: 12 }}><circle cx="12" cy="12" r="10"/><path d="M8 15h8M9 9h.01M15 9h.01"/></svg>
              <div style={{ fontSize: 14, fontWeight: 500 }}>No data found for this report</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>This is a positive result — nothing requires attention</div>
            </div>
          ) : (
            <div>
              {filteredData.length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary, #64748b)', fontWeight: 500 }}>
                    {filter ? `${filteredData.length} of ${reportData.length} rows` : `${reportData.length} rows`}
                    {totalPages > 1 && ` · Page ${page} of ${totalPages}`}
                  </span>
                </div>
              )}
              <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid var(--border, #e2e8f0)' }}>
                <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}>
                  <thead>
                    <tr style={{ background: 'var(--header-bg, #f8fafc)' }}>
                      {reportColumns.map(c => (
                        <th key={c.key} style={{ whiteSpace: 'nowrap', padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-secondary, #64748b)', borderBottom: '2px solid var(--border, #e2e8f0)' }}>{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pagedData.map((row, i) => (
                      <tr key={i} style={{ background: i % 2 === 0 ? 'var(--card-bg, #fff)' : 'var(--row-alt, rgba(0,0,0,.015))', borderBottom: '1px solid var(--border, #e2e8f0)' }}>
                        {reportColumns.map(c => {
                          const val = String(row[c.key] ?? '')
                          const statusColors: Record<string, { bg: string; color: string }> = {
                            'EXPIRED': { bg: 'rgba(239,68,68,.1)', color: '#dc2626' },
                            'Overdue': { bg: 'rgba(239,68,68,.1)', color: '#dc2626' },
                            'Critical': { bg: 'rgba(239,68,68,.1)', color: '#dc2626' },
                            'High': { bg: 'rgba(239,68,68,.1)', color: '#dc2626' },
                            'Urgent': { bg: 'rgba(245,158,11,.1)', color: '#d97706' },
                            'Medium': { bg: 'rgba(245,158,11,.1)', color: '#d97706' },
                            'Warning': { bg: 'rgba(245,158,11,.1)', color: '#d97706' },
                            'Pending': { bg: 'rgba(59,130,246,.1)', color: '#2563eb' },
                            'In Progress': { bg: 'rgba(59,130,246,.1)', color: '#2563eb' },
                            'Draft': { bg: 'rgba(100,116,139,.08)', color: '#64748b' },
                            'Not Started': { bg: 'rgba(245,158,11,.1)', color: '#d97706' },
                            'Normal': { bg: 'rgba(100,116,139,.08)', color: '#64748b' },
                            'Complete': { bg: 'rgba(16,185,129,.1)', color: '#059669' },
                            'Good': { bg: 'rgba(16,185,129,.1)', color: '#059669' },
                            'None': { bg: 'rgba(100,116,139,.06)', color: '#94a3b8' },
                            'Low': { bg: 'rgba(100,116,139,.08)', color: '#64748b' },
                            'Upcoming': { bg: 'rgba(59,130,246,.08)', color: '#3b82f6' },
                            'Unassigned': { bg: 'rgba(245,158,11,.1)', color: '#d97706' },
                            'No Check-in': { bg: 'rgba(239,68,68,.1)', color: '#dc2626' },
                            'Missed Check-out': { bg: 'rgba(239,68,68,.1)', color: '#dc2626' },
                            'Late Check-in': { bg: 'rgba(245,158,11,.1)', color: '#d97706' },
                            'Early Check-out': { bg: 'rgba(245,158,11,.1)', color: '#d97706' },
                            'Short Hours': { bg: 'rgba(59,130,246,.1)', color: '#2563eb' },
                          }
                          const isStatus = (c.key === 'Status' || c.key === 'Urgency' || c.key === 'Risk Level' || c.key === 'Priority' || c.key === 'Discrepancy Type') && statusColors[val]
                          const isNumeric = typeof row[c.key] === 'number' || /^[\d.]+$/.test(val) || /^£/.test(val)
                          return (
                            <td key={c.key} style={{ padding: '9px 14px', textAlign: isNumeric && !isStatus ? 'right' : 'left' }}>
                              {isStatus ? (
                                <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: statusColors[val].bg, color: statusColors[val].color }}>{val}</span>
                              ) : val}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {totalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 16 }}>
                  <button className="admin-btn alt-btn-secondary" disabled={page <= 1} onClick={() => setPage(p => p - 1)} style={{ padding: '6px 14px', fontSize: 13, opacity: page <= 1 ? 0.4 : 1 }}>
                    Previous
                  </button>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary, #64748b)', fontVariantNumeric: 'tabular-nums' }}>
                    Page {page} of {totalPages}
                  </span>
                  <button className="admin-btn alt-btn-secondary" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} style={{ padding: '6px 14px', fontSize: 13, opacity: page >= totalPages ? 0.4 : 1 }}>
                    Next
                  </button>
                </div>
              )}
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
