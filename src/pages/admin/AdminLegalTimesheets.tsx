import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import LegalClientMatters from './LegalClientMatters'

// ── Types ──
export interface Employee {
  id: string
  first_name: string
  last_name: string
  department: string
  is_active: boolean
}

export interface LegalClient {
  id: string
  company_id: string
  name: string
  status: 'active' | 'archived'
  created_at: string
}

export interface LegalMatter {
  id: string
  company_id: string
  client_id: string
  name: string
  status: 'active' | 'archived'
  daily_cap: number | null
  rate_card: string
  assigned_employees: string[]
  allowed_codes: string[]
  created_at: string
}

interface TimesheetEntry {
  id: string
  company_id: string
  employee_id: string
  date: string
  client_id: string
  matter_id: string
  task_code: string
  duration_hrs: number
  narrative: string
  status: 'draft' | 'submitted' | 'pending' | 'approved' | 'rejected' | 'billed'
  submitted_at: string
  audit_log: AuditEntry[]
  created_at: string
  // Joined fields
  employee?: { first_name: string; last_name: string; department: string } | null
  client?: { name: string } | null
  matter?: { name: string } | null
}

interface AuditEntry {
  action: string
  by: string
  at: string
  reason?: string
}

interface ComplianceAlert {
  employeeName: string
  type: 'overtime' | 'missing' | 'leave-conflict'
  detail: string
  date: string
}

interface LeaveRequest {
  employee_id: string
  start_date: string
  end_date: string
  status: string
  employee?: { first_name: string; last_name: string } | null
}

type Tab = 'overview' | 'review' | 'matters' | 'compliance' | 'settings'
type ReviewFilter = 'all' | 'draft' | 'submitted' | 'pending' | 'approved' | 'rejected' | 'billed'

// ── Constants ──
export const TASK_CODES = [
  { code: 'L110', label: 'Research' },
  { code: 'L120', label: 'Drafting' },
  { code: 'L130', label: 'Review / Analysis' },
  { code: 'L140', label: 'Communication' },
  { code: 'L150', label: 'Negotiation' },
  { code: 'L160', label: 'Counseling / Advice' },
  { code: 'L210', label: 'Pleadings' },
  { code: 'L220', label: 'Discovery' },
  { code: 'L230', label: 'Motions' },
  { code: 'L310', label: 'Court Appearances' },
  { code: 'L320', label: 'Depositions' },
  { code: 'L410', label: 'Case Management' },
  { code: 'L510', label: 'Document Management' },
  { code: 'A101', label: 'Plan / Strategy' },
  { code: 'A102', label: 'Conferencing' },
  { code: 'A104', label: 'Travel' },
]

const DEPARTMENTS = ['Corporate', 'Litigation', 'Employment', 'Property', 'Tax', 'IP']
export const RATE_CARDS = ['Partner', 'Senior Associate', 'Associate', 'Trainee', 'Paralegal']

export const STATUS_COLOR: Record<string, { bg: string; text: string }> = {
  draft: { bg: '#f5f5f5', text: '#666' },
  submitted: { bg: '#fff3e0', text: '#e65100' },
  pending: { bg: '#fff3e0', text: '#e65100' },
  approved: { bg: '#e8f5e9', text: '#2e7d32' },
  rejected: { bg: '#ffebee', text: '#c62828' },
  billed: { bg: '#e3f2fd', text: '#1565c0' },
  active: { bg: '#e8f5e9', text: '#2e7d32' },
  archived: { bg: '#f5f5f5', text: '#888' },
}
export const DEFAULT_STATUS_COLOR = { bg: '#f5f5f5', text: '#666' }

// ── Helpers ──
function fmtDate(d: string): string {
  const dt = new Date(d + 'T00:00:00')
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
}

function getWeekKey(d: string): string {
  const dt = new Date(d + 'T00:00:00')
  const day = dt.getDay()
  const diff = day === 0 ? -6 : 1 - day
  const mon = new Date(dt)
  mon.setDate(dt.getDate() + diff)
  return mon.toISOString().split('T')[0]
}

function getWeekRange(weekKey: string): string {
  const mon = new Date(weekKey + 'T00:00:00')
  const sun = new Date(mon)
  sun.setDate(mon.getDate() + 6)
  return `${fmtDate(weekKey)} — ${fmtDate(sun.toISOString().split('T')[0])}`
}

function empName(e: { first_name: string; last_name: string } | null | undefined): string {
  return e ? `${e.first_name} ${e.last_name}` : 'Unknown'
}

export default function AdminLegalTimesheets() {
  const { selectedCompanyId } = useAdminCompany()
  const [tab, setTab] = useState<Tab>('overview')
  const [employees, setEmployees] = useState<Employee[]>([])
  const [entries, setEntries] = useState<TimesheetEntry[]>([])
  const [clients, setClients] = useState<LegalClient[]>([])
  const [matters, setMatters] = useState<LegalMatter[]>([])
  const [alerts, setAlerts] = useState<ComplianceAlert[]>([])
  const [loading, setLoading] = useState(true)

  // Filters
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [filterDept, setFilterDept] = useState('')
  const [filterEmployee, setFilterEmployee] = useState('')
  const [filterClient, setFilterClient] = useState('')
  const [filterStatus, setFilterStatus] = useState<ReviewFilter>('all')
  const [search, setSearch] = useState('')

  // Review state
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editNarrative, setEditNarrative] = useState('')
  const [editHrs, setEditHrs] = useState('')
  const [editCode, setEditCode] = useState('')
  const [rejectReason, setRejectReason] = useState('')
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [auditReason, setAuditReason] = useState('')

  // Settings state
  const ROUNDING_OPTIONS = [
    { value: 1, label: '1 minute (no rounding)' },
    { value: 6, label: '6 minutes (UK standard)' },
    { value: 10, label: '10 minutes' },
    { value: 15, label: '15 minutes (quarter hour)' },
    { value: 30, label: '30 minutes (half hour)' },
  ]
  const [roundingMinutes, setRoundingMinutes] = useState(6)
  const [roundingLoaded, setRoundingLoaded] = useState(false)
  const [roundingSaving, setRoundingSaving] = useState(false)

  // ── Data loading ──
  const loadRoundingSetting = useCallback(async () => {
    if (!selectedCompanyId) return
    const { data } = await supabase
      .from('companies')
      .select('legal_ts_rounding_minutes')
      .eq('id', selectedCompanyId)
      .single()
    if (data?.legal_ts_rounding_minutes != null) {
      setRoundingMinutes(data.legal_ts_rounding_minutes)
    } else {
      setRoundingMinutes(6)
    }
    setRoundingLoaded(true)
  }, [selectedCompanyId])

  async function saveRoundingSetting(val: number) {
    if (!selectedCompanyId) return
    setRoundingSaving(true)
    await supabase
      .from('companies')
      .update({ legal_ts_rounding_minutes: val })
      .eq('id', selectedCompanyId)
    setRoundingMinutes(val)
    setRoundingSaving(false)
  }

  const loadEmployees = useCallback(async () => {
    if (!selectedCompanyId) return
    const { data } = await supabase
      .from('employees')
      .select('id, first_name, last_name, department, is_active')
      .eq('company_id', selectedCompanyId)
      .order('first_name')
    setEmployees((data as Employee[]) || [])
  }, [selectedCompanyId])

  const loadClients = useCallback(async () => {
    if (!selectedCompanyId) return
    const { data } = await supabase
      .from('legal_clients')
      .select('*')
      .eq('company_id', selectedCompanyId)
      .order('name')
    setClients((data as LegalClient[]) || [])
  }, [selectedCompanyId])

  const loadMatters = useCallback(async () => {
    if (!selectedCompanyId) return
    const { data } = await supabase
      .from('legal_matters')
      .select('*')
      .eq('company_id', selectedCompanyId)
      .order('name')
    setMatters((data as LegalMatter[]) || [])
  }, [selectedCompanyId])

  const loadEntries = useCallback(async () => {
    if (!selectedCompanyId) return
    const { data } = await supabase
      .from('legal_timesheet_entries')
      .select('*, employee:employees!legal_timesheet_entries_employee_id_fkey(first_name, last_name, department), client:legal_clients!legal_timesheet_entries_client_id_fkey(name), matter:legal_matters!legal_timesheet_entries_matter_id_fkey(name)')
      .eq('company_id', selectedCompanyId)
      .order('date', { ascending: false })
    setEntries((data as TimesheetEntry[]) || [])
  }, [selectedCompanyId])

  const loadComplianceAlerts = useCallback(async () => {
    if (!selectedCompanyId) return
    const newAlerts: ComplianceAlert[] = []

    // Get entries for the last 14 days
    const twoWeeksAgo = new Date()
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14)
    const fromDate = twoWeeksAgo.toISOString().split('T')[0]

    const { data: recentEntries } = await supabase
      .from('legal_timesheet_entries')
      .select('employee_id, date, duration_hrs, employee:employees!legal_timesheet_entries_employee_id_fkey(first_name, last_name)')
      .eq('company_id', selectedCompanyId)
      .gte('date', fromDate)

    if (recentEntries) {
      // Group by employee+date for daily totals
      const dailyTotals: Record<string, { hrs: number; name: string }> = {}
      const weeklyTotals: Record<string, { hrs: number; name: string }> = {}

      for (const e of recentEntries) {
        const empRec = e.employee as unknown as { first_name: string; last_name: string } | { first_name: string; last_name: string }[] | null
        const name = empName(Array.isArray(empRec) ? empRec[0] ?? null : empRec)
        const dayKey = `${e.employee_id}|${e.date}`
        if (!dailyTotals[dayKey]) dailyTotals[dayKey] = { hrs: 0, name }
        dailyTotals[dayKey].hrs += Number(e.duration_hrs)

        const wk = getWeekKey(e.date)
        const weekKey = `${e.employee_id}|${wk}`
        if (!weeklyTotals[weekKey]) weeklyTotals[weekKey] = { hrs: 0, name }
        weeklyTotals[weekKey].hrs += Number(e.duration_hrs)
      }

      for (const [key, val] of Object.entries(dailyTotals)) {
        if (val.hrs > 10) {
          const date = key.split('|')[1]
          newAlerts.push({ employeeName: val.name, type: 'overtime', detail: `Logged ${val.hrs.toFixed(1)}h on a single day — exceeds 10h statutory limit`, date })
        }
      }

      for (const [key, val] of Object.entries(weeklyTotals)) {
        if (val.hrs > 48) {
          const weekStart = key.split('|')[1]
          newAlerts.push({ employeeName: val.name, type: 'overtime', detail: `Weekly total ${val.hrs.toFixed(1)}h — exceeds 48h weekly working time limit`, date: weekStart })
        }
      }
    }

    // Check leave conflicts
    const { data: leaveData } = await supabase
      .from('leave_requests')
      .select('employee_id, start_date, end_date, status, employee:employees!leave_requests_employee_id_fkey(first_name, last_name)')
      .eq('company_id', selectedCompanyId)
      .eq('status', 'approved')
      .gte('end_date', fromDate) as { data: LeaveRequest[] | null }

    if (leaveData && recentEntries) {
      for (const leave of leaveData) {
        const leaveName = empName(leave.employee as { first_name: string; last_name: string } | null)
        const entriesOnLeave = recentEntries.filter(e =>
          e.employee_id === leave.employee_id &&
          e.date >= leave.start_date &&
          e.date <= leave.end_date
        )
        if (entriesOnLeave.length > 0) {
          const dates = [...new Set(entriesOnLeave.map(e => e.date))].sort()
          for (const d of dates) {
            newAlerts.push({ employeeName: leaveName, type: 'leave-conflict', detail: `Time logged on approved leave day (${fmtDate(d)})`, date: d })
          }
        }
      }
    }

    setAlerts(newAlerts)
  }, [selectedCompanyId])

  useEffect(() => {
    if (!selectedCompanyId) return
    setLoading(true)
    Promise.all([loadEmployees(), loadClients(), loadMatters(), loadEntries(), loadComplianceAlerts(), loadRoundingSetting()])
      .finally(() => setLoading(false))
  }, [selectedCompanyId, loadEmployees, loadClients, loadMatters, loadEntries, loadComplianceAlerts, loadRoundingSetting])

  // ── Derived data ──
  const filtered = useMemo(() => {
    return entries.filter(e => {
      if (dateFrom && e.date < dateFrom) return false
      if (dateTo && e.date > dateTo) return false
      if (filterDept && e.employee?.department !== filterDept) return false
      if (filterEmployee && e.employee_id !== filterEmployee) return false
      if (filterClient && e.client_id !== filterClient) return false
      if (filterStatus !== 'all' && e.status !== filterStatus) return false
      if (search) {
        const q = search.toLowerCase()
        const eName = empName(e.employee).toLowerCase()
        const cName = (e.client?.name || '').toLowerCase()
        const mName = (e.matter?.name || '').toLowerCase()
        if (!eName.includes(q) && !cName.includes(q) && !mName.includes(q) && !e.task_code.toLowerCase().includes(q) && !e.narrative.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [entries, dateFrom, dateTo, filterDept, filterEmployee, filterClient, filterStatus, search])

  // KPIs
  const now = new Date()
  const thisWeekKey = getWeekKey(now.toISOString().split('T')[0])
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const weekHrs = filtered.filter(e => e.date >= thisWeekKey).reduce((s, e) => s + Number(e.duration_hrs), 0)
  const monthHrs = filtered.filter(e => e.date >= monthStart).reduce((s, e) => s + Number(e.duration_hrs), 0)
  const totalHrs = filtered.reduce((s, e) => s + Number(e.duration_hrs), 0)
  const billableHrs = filtered.filter(e => e.status === 'approved' || e.status === 'billed').reduce((s, e) => s + Number(e.duration_hrs), 0)
  const realizationRate = totalHrs > 0 ? Math.round((billableHrs / totalHrs) * 100) : 0
  const pendingCount = entries.filter(e => e.status === 'pending').length
  const overtimeAlerts = alerts.filter(a => a.type === 'overtime').length

  // Grouped by week+employee for review pane
  const groupedForReview = useMemo(() => {
    const pending = filtered.filter(e => filterStatus === 'all' ? true : e.status === filterStatus)
    const groups: Record<string, { weekKey: string; employee: string; employeeId: string; dept: string; entries: TimesheetEntry[]; totalHrs: number; billableRatio: number; hasFlags: boolean }> = {}
    for (const e of pending) {
      const wk = getWeekKey(e.date)
      const key = `${wk}|${e.employee_id}`
      if (!groups[key]) {
        groups[key] = { weekKey: wk, employee: empName(e.employee), employeeId: e.employee_id, dept: e.employee?.department || '', entries: [], totalHrs: 0, billableRatio: 0, hasFlags: false }
      }
      groups[key].entries.push(e)
      groups[key].totalHrs += Number(e.duration_hrs)
    }
    for (const g of Object.values(groups)) {
      const billable = g.entries.filter(e => e.status !== 'rejected').reduce((s, e) => s + Number(e.duration_hrs), 0)
      g.billableRatio = g.totalHrs > 0 ? Math.round((billable / g.totalHrs) * 100) : 0
      g.hasFlags = g.totalHrs > 40 || g.entries.some(e => Number(e.duration_hrs) > 8)
    }
    return Object.values(groups).sort((a, b) => b.weekKey.localeCompare(a.weekKey) || a.employee.localeCompare(b.employee))
  }, [filtered, filterStatus])

  const selectedGroup = selectedEmployee ? groupedForReview.find(g => `${g.weekKey}|${g.employeeId}` === selectedEmployee) : null

  // Matters grouped by client for the matters tab
  // Leave data for compliance tab
  const [leaveThisWeek, setLeaveThisWeek] = useState(0)
  const [leaveConflictCount, setLeaveConflictCount] = useState(0)
  useEffect(() => {
    setLeaveThisWeek(0)
    setLeaveConflictCount(alerts.filter(a => a.type === 'leave-conflict').length)
    if (!selectedCompanyId) return
    const weekStart = thisWeekKey
    const weekEnd = new Date(new Date(weekStart + 'T00:00:00').getTime() + 6 * 86400000).toISOString().split('T')[0]
    supabase
      .from('leave_requests')
      .select('employee_id')
      .eq('company_id', selectedCompanyId)
      .eq('status', 'approved')
      .lte('start_date', weekEnd)
      .gte('end_date', weekStart)
      .then(({ data }) => {
        if (data) {
          const uniqueEmps = new Set(data.map(d => d.employee_id))
          setLeaveThisWeek(uniqueEmps.size)
        }
      })
  }, [selectedCompanyId, alerts, thisWeekKey])

  // ── Actions ──
  async function approveSelected() {
    const ids = Array.from(selectedIds)
    const auditEntry: AuditEntry = { action: 'approved', by: 'Admin', at: new Date().toISOString() }
    await Promise.all(ids.map(id => {
      const entry = entries.find(e => e.id === id)
      if (!entry || !['submitted', 'pending'].includes(entry.status)) return Promise.resolve()
      const newLog = [...(entry.audit_log || []), auditEntry]
      return supabase.from('legal_timesheet_entries').update({ status: 'approved', audit_log: newLog }).eq('id', id)
    }))
    setSelectedIds(new Set())
    await loadEntries()
  }

  async function rejectSelected() {
    if (!rejectReason.trim()) return
    const ids = Array.from(selectedIds)
    const auditEntry: AuditEntry = { action: 'rejected', by: 'Admin', at: new Date().toISOString(), reason: rejectReason }
    await Promise.all(ids.map(id => {
      const entry = entries.find(e => e.id === id)
      if (!entry || !['submitted', 'pending'].includes(entry.status)) return Promise.resolve()
      const newLog = [...(entry.audit_log || []), auditEntry]
      return supabase.from('legal_timesheet_entries').update({ status: 'rejected', audit_log: newLog }).eq('id', id)
    }))
    setSelectedIds(new Set())
    setRejectReason('')
    setShowRejectModal(false)
    await loadEntries()
  }

  async function requestRevision() {
    const ids = Array.from(selectedIds)
    const auditEntry: AuditEntry = { action: 'revision_requested', by: 'Admin', at: new Date().toISOString(), reason: 'Narrative revision needed' }
    await Promise.all(ids.map(id => {
      const entry = entries.find(e => e.id === id)
      if (!entry) return Promise.resolve()
      const newLog = [...(entry.audit_log || []), auditEntry]
      return supabase.from('legal_timesheet_entries').update({ audit_log: newLog }).eq('id', id)
    }))
    setSelectedIds(new Set())
    await loadEntries()
  }

  async function saveInlineEdit(id: string) {
    const entry = entries.find(e => e.id === id)
    if (!entry) return
    const changes: string[] = []
    if (editNarrative !== entry.narrative) changes.push('narrative changed')
    if (parseFloat(editHrs) !== Number(entry.duration_hrs)) changes.push(`hours ${entry.duration_hrs} → ${editHrs}`)
    if (editCode !== entry.task_code) changes.push(`code ${entry.task_code} → ${editCode}`)
    const auditEntry: AuditEntry = { action: `edited: ${changes.join(', ')}`, by: 'Admin', at: new Date().toISOString(), reason: auditReason || undefined }
    const newLog = [...(entry.audit_log || []), auditEntry]
    await supabase.from('legal_timesheet_entries').update({
      narrative: editNarrative,
      duration_hrs: parseFloat(editHrs) || entry.duration_hrs,
      task_code: editCode,
      audit_log: newLog,
    }).eq('id', id)
    setEditingId(null)
    setAuditReason('')
    await loadEntries()
  }

  function startEdit(e: TimesheetEntry) {
    setEditingId(e.id)
    setEditNarrative(e.narrative)
    setEditHrs(String(e.duration_hrs))
    setEditCode(e.task_code)
    setAuditReason('')
  }

  // Export
  function exportToCSV() {
    const approved = entries.filter(e => e.status === 'approved' || e.status === 'billed')
    const headers = ['Date', 'Employee', 'Client', 'Matter', 'Task Code', 'Activity', 'Hours', 'Narrative', 'Status']
    const rows = approved.map(e => {
      const taskLabel = TASK_CODES.find(tc => tc.code === e.task_code)?.label || e.task_code
      return [e.date, empName(e.employee), e.client?.name || '', e.matter?.name || '', e.task_code, taskLabel, Number(e.duration_hrs).toFixed(1), `"${e.narrative.replace(/"/g, '""')}"`, e.status]
    })
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `legal-timesheets-export-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function exportLEDES() {
    const approved = entries.filter(e => e.status === 'approved' || e.status === 'billed')
    const lines = [
      'LEDES1998B[]',
      'INVOICE_DATE|INVOICE_NUMBER|CLIENT_ID|LAW_FIRM_MATTER_ID|INVOICE_TOTAL|BILLING_START_DATE|BILLING_END_DATE|INVOICE_DESCRIPTION|LINE_ITEM_NUMBER|EXP/FEE/INV_ADJ_TYPE|LINE_ITEM_NUMBER_OF_UNITS|LINE_ITEM_ADJUSTMENT_AMOUNT|LINE_ITEM_TOTAL|LINE_ITEM_DATE|LINE_ITEM_TASK_CODE|LINE_ITEM_EXPENSE_CODE|LINE_ITEM_ACTIVITY_CODE|TIMEKEEPER_ID|LINE_ITEM_DESCRIPTION|LAW_FIRM_ID|LINE_ITEM_UNIT_COST|TIMEKEEPER_NAME|TIMEKEEPER_CLASSIFICATION[]',
    ]
    approved.forEach((e, i) => {
      const hrs = Number(e.duration_hrs)
      lines.push(`${e.date}|INV-${Date.now()}|${e.client?.name || ''}|${e.matter?.name || ''}|${hrs * 250}|${e.date}|${e.date}|${e.narrative}|${i + 1}|F|${hrs}|0|${hrs * 250}|${e.date}|${e.task_code}||${e.task_code}|${e.employee_id}|${e.narrative}|FIRM001|250|${empName(e.employee)}|ASSOCIATE[]`)
    })
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `legal-timesheets-LEDES-${new Date().toISOString().split('T')[0]}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) return <div className="admin-section"><div className="admin-loading">Loading legal timesheets...</div></div>

  return (
    <div className="admin-section alt-section">
      <div className="admin-page-header">
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: '#00897b' }}>⚖️</span> Legal Timesheet Management
        </h2>
        <p>Review, approve, and manage employee legal time entries, clients, and matters</p>
      </div>

      {/* Tabs */}
      <div className="alt-tabs">
        {(['overview', 'review', 'matters', 'compliance', 'settings'] as Tab[]).map(t => (
          <button key={t} className={`alt-tab ${tab === t ? 'alt-tab-active' : ''}`} onClick={() => setTab(t)}>
            {t === 'overview' && '📊 '}
            {t === 'review' && '✅ '}
            {t === 'matters' && '📁 '}
            {t === 'compliance' && '🛡️ '}
            {t === 'settings' && '⚙️ '}
            {t === 'overview' && 'Overview'}
            {t === 'review' && 'Review & Approve'}
            {t === 'matters' && 'Clients & Matters'}
            {t === 'compliance' && 'Compliance'}
            {t === 'settings' && 'Settings'}
            {t === 'review' && pendingCount > 0 && <span className="alt-tab-badge">{pendingCount}</span>}
            {t === 'compliance' && overtimeAlerts > 0 && <span className="alt-tab-badge alt-tab-badge-red">{overtimeAlerts}</span>}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW TAB ── */}
      {tab === 'overview' && (
        <>
          {/* KPI Cards */}
          <div className="alt-kpi-grid">
            <div className="alt-kpi alt-kpi-orange">
              <div className="alt-kpi-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#00897b" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
              </div>
              <div>
                <div className="alt-kpi-value">{weekHrs.toFixed(1)}h</div>
                <div className="alt-kpi-label">Billable This Week</div>
              </div>
            </div>
            <div className="alt-kpi alt-kpi-blue">
              <div className="alt-kpi-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1565c0" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
              </div>
              <div>
                <div className="alt-kpi-value">{monthHrs.toFixed(1)}h</div>
                <div className="alt-kpi-label">Billable This Month</div>
              </div>
            </div>
            <div className="alt-kpi alt-kpi-green">
              <div className="alt-kpi-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2e7d32" strokeWidth="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>
              </div>
              <div>
                <div className="alt-kpi-value">{realizationRate}%</div>
                <div className="alt-kpi-label">Realization Rate</div>
              </div>
            </div>
            <div className="alt-kpi alt-kpi-amber" onClick={() => setTab('review')} style={{ cursor: 'pointer' }}>
              <div className="alt-kpi-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#e65100" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
              </div>
              <div>
                <div className="alt-kpi-value">{pendingCount}</div>
                <div className="alt-kpi-label">Pending Approvals</div>
              </div>
            </div>
            <div className="alt-kpi alt-kpi-red" onClick={() => setTab('compliance')} style={{ cursor: 'pointer' }}>
              <div className="alt-kpi-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#c62828" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
              </div>
              <div>
                <div className="alt-kpi-value">{alerts.length}</div>
                <div className="alt-kpi-label">Compliance Alerts</div>
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="admin-filters">
            <input type="date" className="admin-input" value={dateFrom} onChange={e => setDateFrom(e.target.value)} title="From date" />
            <input type="date" className="admin-input" value={dateTo} onChange={e => setDateTo(e.target.value)} title="To date" />
            <select className="admin-select" value={filterDept} onChange={e => setFilterDept(e.target.value)}>
              <option value="">All Departments</option>
              {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <select className="admin-select" value={filterEmployee} onChange={e => setFilterEmployee(e.target.value)}>
              <option value="">All Employees</option>
              {employees.filter(emp => emp.is_active).map(emp => (
                <option key={emp.id} value={emp.id}>{emp.first_name} {emp.last_name}</option>
              ))}
            </select>
            <select className="admin-select" value={filterClient} onChange={e => setFilterClient(e.target.value)}>
              <option value="">All Clients</option>
              {clients.filter(c => c.status === 'active').map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <input className="admin-input admin-search" placeholder="Search all..." value={search} onChange={e => setSearch(e.target.value)} />
            <select className="admin-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value as ReviewFilter)}>
              <option value="all">All Statuses</option>
              <option value="draft">Draft</option>
              <option value="submitted">Submitted</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="billed">Billed</option>
            </select>
          </div>

          {/* Summary Table */}
          <div className="admin-table-wrap">
            <table className="admin-table alt-dense-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Department</th>
                  <th>Date</th>
                  <th>Client / Matter</th>
                  <th>Task Code</th>
                  <th>Hours</th>
                  <th>Narrative</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 100).map(e => (
                  <tr key={e.id} className="alt-row-hover">
                    <td style={{ fontWeight: 600 }}>{empName(e.employee)}</td>
                    <td><span className="alt-dept-badge">{e.employee?.department || '—'}</span></td>
                    <td className="admin-td-mono">{fmtDate(e.date)}</td>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 12 }}>{e.client?.name || '—'}</div>
                      <div style={{ fontSize: 11, color: '#8b8fa3' }}>{e.matter?.name || '—'}</div>
                    </td>
                    <td><span className="alt-code-badge">{e.task_code}</span></td>
                    <td style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{Number(e.duration_hrs).toFixed(1)}</td>
                    <td className="admin-td-wrap" style={{ maxWidth: 220, fontSize: 12, color: '#666' }}>{e.narrative.slice(0, 60)}{e.narrative.length > 60 ? '...' : ''}</td>
                    <td><span className="admin-badge" style={{ background: (STATUS_COLOR[e.status] || DEFAULT_STATUS_COLOR).bg, color: (STATUS_COLOR[e.status] || DEFAULT_STATUS_COLOR).text }}>{e.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && <div className="admin-empty">No entries match your filters</div>}
            {filtered.length > 100 && <div style={{ padding: '8px 12px', fontSize: 12, color: '#8b8fa3', textAlign: 'right' }}>Showing 100 of {filtered.length} entries</div>}
          </div>
        </>
      )}

      {/* ── REVIEW & APPROVE TAB ── */}
      {tab === 'review' && (
        <>
          <div className="admin-filters">
            <select className="admin-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value as ReviewFilter)}>
              <option value="all">All Statuses</option>
              <option value="pending">Pending Review</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="billed">Billed</option>
            </select>
            <input className="admin-input admin-search" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>

          <div className="alt-split">
            {/* Left: grouped list */}
            <div className="alt-split-left">
              <div className="alt-split-header">Submissions by Week / Employee</div>
              {groupedForReview.length === 0 && <div className="admin-empty">No submissions found</div>}
              {groupedForReview.map(g => {
                const key = `${g.weekKey}|${g.employeeId}`
                const isActive = selectedEmployee === key
                const pendingInGroup = g.entries.filter(e => e.status === 'pending').length
                return (
                  <button key={key} className={`alt-group-card ${isActive ? 'alt-group-active' : ''}`} onClick={() => { setSelectedEmployee(key); setSelectedIds(new Set()); setEditingId(null) }}>
                    <div className="alt-group-top">
                      <span className="alt-group-name">{g.employee}</span>
                      <span className="alt-group-hrs">{g.totalHrs.toFixed(1)}h</span>
                    </div>
                    <div className="alt-group-mid">
                      <span className="alt-dept-badge">{g.dept}</span>
                      <span style={{ fontSize: 11, color: '#8b8fa3' }}>{getWeekRange(g.weekKey)}</span>
                    </div>
                    <div className="alt-group-bottom">
                      <span style={{ fontSize: 11 }}>Billable: {g.billableRatio}%</span>
                      {pendingInGroup > 0 && <span className="alt-pending-pill">{pendingInGroup} pending</span>}
                      {g.hasFlags && <span className="alt-flag-pill">⚠ Flag</span>}
                    </div>
                  </button>
                )
              })}
            </div>

            {/* Right: detail */}
            <div className="alt-split-right">
              {!selectedGroup ? (
                <div className="alt-split-empty">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                  <p>Select an employee submission to review</p>
                </div>
              ) : (
                <>
                  <div className="alt-detail-header">
                    <div>
                      <h3>{selectedGroup.employee}</h3>
                      <span style={{ fontSize: 12, color: '#8b8fa3' }}>{selectedGroup.dept} — {getWeekRange(selectedGroup.weekKey)} — {selectedGroup.totalHrs.toFixed(1)}h total</span>
                    </div>
                  </div>

                  {/* Action toolbar */}
                  {selectedIds.size > 0 && (
                    <div className="alt-toolbar">
                      <span className="alt-toolbar-count">{selectedIds.size} selected</span>
                      <button className="alt-toolbar-btn alt-toolbar-approve" onClick={approveSelected}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                        Approve
                      </button>
                      <button className="alt-toolbar-btn alt-toolbar-reject" onClick={() => setShowRejectModal(true)}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                        Reject
                      </button>
                      <button className="alt-toolbar-btn alt-toolbar-revise" onClick={requestRevision}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                        Request Revision
                      </button>
                    </div>
                  )}

                  <div className="admin-table-wrap">
                    <table className="admin-table alt-dense-table">
                      <thead>
                        <tr>
                          <th style={{ width: 32 }}>
                            <input type="checkbox"
                              checked={selectedGroup.entries.length > 0 && selectedGroup.entries.every(e => selectedIds.has(e.id))}
                              onChange={ev => {
                                if (ev.target.checked) setSelectedIds(new Set(selectedGroup.entries.map(e => e.id)))
                                else setSelectedIds(new Set())
                              }}
                            />
                          </th>
                          <th>Date</th>
                          <th>Client / Matter</th>
                          <th>Code</th>
                          <th>Hrs</th>
                          <th>Narrative</th>
                          <th>Status</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedGroup.entries.sort((a, b) => a.date.localeCompare(b.date)).map(e => (
                          <tr key={e.id} className={editingId === e.id ? 'admin-row-active' : ''}>
                            <td><input type="checkbox" checked={selectedIds.has(e.id)} onChange={() => setSelectedIds(prev => { const n = new Set(prev); n.has(e.id) ? n.delete(e.id) : n.add(e.id); return n })} /></td>
                            <td className="admin-td-mono">{fmtDate(e.date)}</td>
                            <td>
                              <div style={{ fontWeight: 600, fontSize: 12 }}>{e.client?.name || '—'}</div>
                              <div style={{ fontSize: 11, color: '#8b8fa3' }}>{e.matter?.name || '—'}</div>
                            </td>
                            <td>
                              {editingId === e.id ? (
                                <select className="admin-inline-select" value={editCode} onChange={ev => setEditCode(ev.target.value)}>
                                  {TASK_CODES.map(tc => <option key={tc.code} value={tc.code}>{tc.code}</option>)}
                                </select>
                              ) : <span className="alt-code-badge">{e.task_code}</span>}
                            </td>
                            <td>
                              {editingId === e.id ? (
                                <input type="number" step="0.1" className="admin-inline-input admin-inline-sm" value={editHrs} onChange={ev => setEditHrs(ev.target.value)} />
                              ) : <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{Number(e.duration_hrs).toFixed(1)}</span>}
                            </td>
                            <td style={{ maxWidth: 260 }}>
                              {editingId === e.id ? (
                                <>
                                  <textarea className="admin-inline-textarea" value={editNarrative} onChange={ev => setEditNarrative(ev.target.value)} rows={2} />
                                  <input className="admin-inline-input" placeholder="Audit reason..." value={auditReason} onChange={ev => setAuditReason(ev.target.value)} style={{ marginTop: 4, fontSize: 11 }} />
                                </>
                              ) : <span style={{ fontSize: 12, color: '#555', lineHeight: 1.4, display: 'block' }}>{e.narrative}</span>}
                            </td>
                            <td><span className="admin-badge" style={{ background: (STATUS_COLOR[e.status] || DEFAULT_STATUS_COLOR).bg, color: (STATUS_COLOR[e.status] || DEFAULT_STATUS_COLOR).text }}>{e.status}</span></td>
                            <td className="admin-actions">
                              {editingId === e.id ? (
                                <>
                                  <button className="admin-btn-sm admin-btn-save" onClick={() => saveInlineEdit(e.id)}>Save</button>
                                  <button className="admin-btn-sm admin-btn-cancel" onClick={() => setEditingId(null)}>Cancel</button>
                                </>
                              ) : (
                                <button className="admin-btn-icon" title="Edit" onClick={() => startEdit(e)}>
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Reject Modal */}
          {showRejectModal && (
            <div className="admin-modal-overlay" onClick={() => setShowRejectModal(false)}>
              <div className="admin-modal" onClick={ev => ev.stopPropagation()} style={{ maxWidth: 440 }}>
                <h2 style={{ marginBottom: 12 }}>Reject with Comment</h2>
                <textarea className="admin-textarea" placeholder="Reason for rejection..." value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={3} />
                <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
                  <button className="admin-btn admin-btn-cancel-lg" onClick={() => setShowRejectModal(false)}>Cancel</button>
                  <button className="admin-btn alt-btn-reject" onClick={rejectSelected} disabled={!rejectReason.trim()}>Reject Selected</button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── CLIENTS & MATTERS TAB ── */}
      {tab === 'matters' && (
        <LegalClientMatters
          clients={clients}
          matters={matters}
          employees={employees}
          selectedCompanyId={selectedCompanyId}
          onDataChanged={async () => { await loadClients(); await loadMatters() }}
        />
      )}

      {/* ── COMPLIANCE TAB ── */}
      {tab === 'compliance' && (
        <>
          {/* Alerts */}
          <div className="alt-compliance-section">
            <h3 className="alt-section-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#c62828" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
              Working Time Alerts ({alerts.length})
            </h3>
            {alerts.length === 0 ? (
              <div className="admin-empty">No compliance alerts detected</div>
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-table alt-dense-table">
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Employee</th>
                      <th>Detail</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alerts.map((a, i) => (
                      <tr key={i} className={a.type === 'overtime' ? 'alt-row-danger' : ''}>
                        <td>
                          <span className={`alt-alert-type alt-alert-${a.type}`}>
                            {a.type === 'overtime' && '🔴 Overtime'}
                            {a.type === 'missing' && '🟡 Missing'}
                            {a.type === 'leave-conflict' && '🟠 Leave Conflict'}
                          </span>
                        </td>
                        <td style={{ fontWeight: 600 }}>{a.employeeName}</td>
                        <td style={{ fontSize: 12 }}>{a.detail}</td>
                        <td className="admin-td-mono">{fmtDate(a.date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Leave Integration */}
          <div className="alt-compliance-section">
            <h3 className="alt-section-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1565c0" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
              Leave Integration
            </h3>
            <p style={{ fontSize: 13, color: '#8b8fa3', marginBottom: 12 }}>Days with approved leave are automatically locked — employees cannot log time on those dates.</p>
            <div className="alt-info-cards">
              <div className="alt-info-card">
                <div className="alt-info-value">{leaveThisWeek}</div>
                <div className="alt-info-label">Employees on leave this week</div>
              </div>
              <div className="alt-info-card">
                <div className="alt-info-value">{leaveConflictCount}</div>
                <div className="alt-info-label">Leave conflicts detected</div>
              </div>
            </div>
          </div>

          {/* Export */}
          <div className="alt-compliance-section">
            <h3 className="alt-section-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2e7d32" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
              Export & Billing Integration
            </h3>
            <div className="alt-export-btns">
              <button className="admin-btn alt-btn-primary" onClick={exportToCSV}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                Export CSV
              </button>
              <button className="admin-btn alt-btn-secondary" onClick={exportLEDES}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                Export LEDES 1998B
              </button>
              <button className="admin-btn alt-btn-secondary">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>
                Sync to Payroll
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── SETTINGS TAB ── */}
      {tab === 'settings' && (
        <>
          <div className="alt-compliance-section">
            <h3 className="alt-section-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00897b" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
              Time Rounding
            </h3>
            <p style={{ fontSize: 13, color: '#8b8fa3', marginBottom: 16 }}>
              Set the billing increment for auto-rounding time entries. The UK legal industry standard is 6 minutes (1/10th of an hour). All durations are rounded <strong>up</strong> to the nearest increment.
            </p>

            {!roundingLoaded ? (
              <div className="admin-empty">Loading settings...</div>
            ) : (
              <div style={{ maxWidth: 400 }}>
                <label className="admin-form-label" style={{ fontWeight: 600, marginBottom: 8, display: 'block' }}>Auto-round up increment</label>
                <select
                  className="admin-select"
                  value={roundingMinutes}
                  onChange={e => saveRoundingSetting(Number(e.target.value))}
                  disabled={roundingSaving}
                  style={{ width: '100%', padding: '10px 12px', fontSize: 14 }}
                >
                  {ROUNDING_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                {roundingSaving && <p style={{ fontSize: 12, color: '#8b8fa3', marginTop: 8 }}>Saving...</p>}

                <div style={{ marginTop: 20, padding: 16, background: '#f5f5f5', borderRadius: 10, fontSize: 13 }}>
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>How it works</div>
                  <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8, color: '#555' }}>
                    <li>Time is always rounded <strong>up</strong> to the next {roundingMinutes}-minute unit — partial units are never rounded down</li>
                    <li>Example: 7 minutes of work → {roundingMinutes === 1 ? '7 mins' : `${Math.ceil(7 / roundingMinutes) * roundingMinutes} mins`} charged ({roundingMinutes === 1 ? '0.12' : (Math.ceil(7 / roundingMinutes) * roundingMinutes / 60).toFixed(2)}h)</li>
                    <li>Example: 13 minutes of work → {roundingMinutes === 1 ? '13 mins' : `${Math.ceil(13 / roundingMinutes) * roundingMinutes} mins`} charged ({roundingMinutes === 1 ? '0.22' : (Math.ceil(13 / roundingMinutes) * roundingMinutes / 60).toFixed(2)}h)</li>
                    <li>Employees can still disable auto-rounding per entry if needed</li>
                    <li>This setting applies to all employees in this company</li>
                  </ul>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
