import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import LegalClientMatters from './LegalClientMatters'
import { toLocalDateStr, formatCurrency, currencySymbol } from '../../lib/formatters'
import jsPDF from 'jspdf'

// ── Types ──
export interface Employee {
  id: string
  first_name: string
  last_name: string
  department: string
  is_active: boolean
  hourly_rate: number | null
  charge_out_rate: number | null
}

export interface LegalClient {
  id: string
  company_id: string
  name: string
  status: 'active' | 'archived'
  contact_name: string | null
  contact_email: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  county: string | null
  postcode: string | null
  country: string | null
  payment_terms_days: number | null
  created_at: string
}

interface LegalInvoice {
  id: string
  company_id: string
  client_id: string
  invoice_number: string
  invoice_date: string
  due_date: string
  period_start: string
  period_end: string
  subtotal: number
  vat_rate: number
  vat_amount: number
  total: number
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled'
  notes: string | null
  created_at: string
  client?: { name: string } | null
}

interface LegalInvoiceLine {
  id: string
  invoice_id: string
  timesheet_entry_id: string | null
  employee_name: string
  matter_name: string
  date: string
  description: string
  task_code: string | null
  hours: number
  rate: number
  amount: number
}

interface CompanyBillingDetails {
  name: string
  logo_url: string | null
  company_registration_number: string | null
  vat_number: string | null
  billing_address_line1: string | null
  billing_address_line2: string | null
  billing_city: string | null
  billing_county: string | null
  billing_postcode: string | null
  billing_country: string | null
  billing_email: string | null
  billing_phone: string | null
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

type Tab = 'overview' | 'review' | 'matters' | 'invoices' | 'compliance' | 'settings'
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

const PAGE_SIZE = 30

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
  return toLocalDateStr(mon)
}

function getWeekRange(weekKey: string): string {
  const mon = new Date(weekKey + 'T00:00:00')
  const sun = new Date(mon)
  sun.setDate(mon.getDate() + 6)
  return `${fmtDate(weekKey)} — ${fmtDate(toLocalDateStr(sun))}`
}

function empName(e: { first_name: string; last_name: string } | null | undefined): string {
  return e ? `${e.first_name} ${e.last_name}` : 'Unknown'
}

export default function AdminLegalTimesheets() {
  const { selectedCompanyId } = useAdminCompany()
  const { session, company } = useAuth()
  const currency = company?.currency || 'GBP'
  const { showError, showSuccess } = useToast()
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
  const [page, setPage] = useState(1)

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

  // Invoice state
  const [invoices, setInvoices] = useState<LegalInvoice[]>([])
  const [, setInvoiceLines] = useState<LegalInvoiceLine[]>([])
  const [invoiceLoading, setInvoiceLoading] = useState(false)
  const [companyBilling, setCompanyBilling] = useState<CompanyBillingDetails | null>(null)
  const [showCreateInvoice, setShowCreateInvoice] = useState(false)
  const [invClient, setInvClient] = useState('')
  const [invPeriodStart, setInvPeriodStart] = useState('')
  const [invPeriodEnd, setInvPeriodEnd] = useState('')
  const [invVatRate, setInvVatRate] = useState(20)
  const [invNotes, setInvNotes] = useState('')
  const [invCreating, setInvCreating] = useState(false)
  const [viewingInvoice, setViewingInvoice] = useState<string | null>(null)

  // Settings state
  const ROUNDING_OPTIONS = [
    { value: 1, label: '1 minute (no rounding)' },
    { value: 5, label: '5 minutes' },
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
    const { error } = await supabase
      .from('companies')
      .update({ legal_ts_rounding_minutes: val })
      .eq('id', selectedCompanyId)
    if (error) { showError('Failed to save rounding setting: ' + error.message); setRoundingSaving(false); return }
    setRoundingMinutes(val)
    setRoundingSaving(false)
  }

  const loadEmployees = useCallback(async () => {
    if (!selectedCompanyId) return
    const { data } = await supabase
      .from('employees')
      .select('id, first_name, last_name, department, is_active, hourly_rate, charge_out_rate')
      .eq('company_id', selectedCompanyId)
      .eq('is_active', true)
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
    const fromDate = toLocalDateStr(twoWeeksAgo)

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

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  useEffect(() => {
    setPage(1)
  }, [dateFrom, dateTo, filterDept, filterEmployee, filterClient, filterStatus, search])

  // KPIs
  const now = new Date()
  const thisWeekKey = getWeekKey(toLocalDateStr(now))
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
    const weekEnd = toLocalDateStr(new Date(new Date(weekStart + 'T00:00:00').getTime() + 6 * 86400000))
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
    try {
      await Promise.all(ids.map(id => {
        const entry = entries.find(e => e.id === id)
        if (!entry || ['approved', 'billed', 'rejected'].includes(entry.status)) return Promise.resolve()
        const newLog = [...(entry.audit_log || []), auditEntry]
        return supabase.from('legal_timesheet_entries').update({ status: 'approved', audit_log: newLog }).eq('id', id)
      }))
    } catch (err: any) {
      showError('Failed to approve entries: ' + (err.message || err)); return
    }
    setSelectedIds(new Set())
    await loadEntries()
  }

  async function rejectSelected() {
    if (!rejectReason.trim()) return
    const ids = Array.from(selectedIds)
    const auditEntry: AuditEntry = { action: 'rejected', by: 'Admin', at: new Date().toISOString(), reason: rejectReason }
    try {
      await Promise.all(ids.map(id => {
        const entry = entries.find(e => e.id === id)
        if (!entry || ['approved', 'billed', 'rejected'].includes(entry.status)) return Promise.resolve()
        const newLog = [...(entry.audit_log || []), auditEntry]
        return supabase.from('legal_timesheet_entries').update({ status: 'rejected', audit_log: newLog }).eq('id', id)
      }))
    } catch (err: any) {
      showError('Failed to reject entries: ' + (err.message || err)); return
    }
    setSelectedIds(new Set())
    setRejectReason('')
    setShowRejectModal(false)
    await loadEntries()
  }

  async function requestRevision() {
    const ids = Array.from(selectedIds)
    const auditEntry: AuditEntry = { action: 'revision_requested', by: 'Admin', at: new Date().toISOString(), reason: 'Narrative revision needed' }
    try {
      await Promise.all(ids.map(id => {
        const entry = entries.find(e => e.id === id)
        if (!entry) return Promise.resolve()
        const newLog = [...(entry.audit_log || []), auditEntry]
        return supabase.from('legal_timesheet_entries').update({ audit_log: newLog }).eq('id', id)
      }))
    } catch (err: any) {
      showError('Failed to request revision: ' + (err.message || err)); return
    }
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
    const { error } = await supabase.from('legal_timesheet_entries').update({
      narrative: editNarrative,
      duration_hrs: parseFloat(editHrs) || entry.duration_hrs,
      task_code: editCode,
      audit_log: newLog,
    }).eq('id', id)
    if (error) { showError('Failed to save edit: ' + error.message); return }
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

  // ── Invoice functions ──
  const loadCompanyBilling = useCallback(async () => {
    if (!selectedCompanyId) return
    const { data } = await supabase.from('companies')
      .select('name, logo_url, company_registration_number, vat_number, billing_address_line1, billing_address_line2, billing_city, billing_county, billing_postcode, billing_country, billing_email, billing_phone')
      .eq('id', selectedCompanyId).single()
    if (data) setCompanyBilling(data as CompanyBillingDetails)
  }, [selectedCompanyId])

  const loadInvoices = useCallback(async () => {
    if (!selectedCompanyId) return
    setInvoiceLoading(true)
    const { data } = await supabase.from('legal_invoices')
      .select('*, client:legal_clients!legal_invoices_client_id_fkey(name)')
      .eq('company_id', selectedCompanyId)
      .order('invoice_date', { ascending: false })
    setInvoices((data as LegalInvoice[]) || [])
    setInvoiceLoading(false)
  }, [selectedCompanyId])

  const loadInvoiceLines = useCallback(async (invoiceId: string) => {
    const { data } = await supabase.from('legal_invoice_lines')
      .select('*').eq('invoice_id', invoiceId).order('date')
    setInvoiceLines((data as LegalInvoiceLine[]) || [])
  }, [])

  useEffect(() => {
    if (tab === 'invoices') { loadInvoices(); loadCompanyBilling() }
    if (tab === 'settings') { loadCompanyBilling() }
  }, [tab, loadInvoices, loadCompanyBilling])

  useEffect(() => {
    if (viewingInvoice) loadInvoiceLines(viewingInvoice)
  }, [viewingInvoice, loadInvoiceLines])

  async function createInvoice() {
    if (!selectedCompanyId || !invClient || !invPeriodStart || !invPeriodEnd) return
    setInvCreating(true)

    const billableEntries = entries.filter(e =>
      e.client_id === invClient &&
      (e.status === 'approved' || e.status === 'billed') &&
      e.date >= invPeriodStart && e.date <= invPeriodEnd
    )
    if (billableEntries.length === 0) {
      showError('No approved time entries found for this client and period')
      setInvCreating(false)
      return
    }

    const client = clients.find(c => c.id === invClient)
    const paymentDays = client?.payment_terms_days || 30
    const invoiceDate = new Date()
    const dueDate = new Date(invoiceDate)
    dueDate.setDate(dueDate.getDate() + paymentDays)

    const { count: invoiceCount } = await supabase.from('legal_invoices')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', selectedCompanyId)
    const seq = (invoiceCount || 0) + 1
    const invoiceNumber = `INV-${invoiceDate.getFullYear()}${String(invoiceDate.getMonth() + 1).padStart(2, '0')}-${String(seq).padStart(4, '0')}`

    const lines: { entry: typeof billableEntries[0]; rate: number; amount: number }[] = billableEntries.map(e => {
      const emp = employees.find(emp => emp.id === e.employee_id)
      const rate = emp?.charge_out_rate || 250
      const hrs = Number(e.duration_hrs)
      return { entry: e, rate, amount: Math.round(hrs * rate * 100) / 100 }
    })

    const subtotal = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100
    const vatAmount = Math.round(subtotal * (invVatRate / 100) * 100) / 100
    const total = Math.round((subtotal + vatAmount) * 100) / 100

    const { data: inv, error } = await supabase.from('legal_invoices').insert({
      company_id: selectedCompanyId,
      client_id: invClient,
      invoice_number: invoiceNumber,
      invoice_date: toLocalDateStr(invoiceDate),
      due_date: toLocalDateStr(dueDate),
      period_start: invPeriodStart,
      period_end: invPeriodEnd,
      subtotal, vat_rate: invVatRate, vat_amount: vatAmount, total,
      status: 'draft',
      notes: invNotes || null,
      created_by: session?.user?.id,
    }).select().single()

    if (error || !inv) {
      showError('Failed to create invoice: ' + (error?.message || 'Unknown'))
      setInvCreating(false)
      return
    }

    const lineInserts = lines.map(l => ({
      invoice_id: inv.id,
      timesheet_entry_id: l.entry.id,
      employee_name: empName(l.entry.employee),
      matter_name: l.entry.matter?.name || '',
      date: l.entry.date,
      description: l.entry.narrative,
      task_code: l.entry.task_code,
      hours: Number(l.entry.duration_hrs),
      rate: l.rate,
      amount: l.amount,
    }))
    await supabase.from('legal_invoice_lines').insert(lineInserts)

    for (const l of lines) {
      await supabase.from('legal_timesheet_entries').update({ status: 'billed' }).eq('id', l.entry.id)
    }

    showSuccess(`Invoice ${invoiceNumber} created — ${lines.length} entries, ${formatCurrency(total, currency)}`)
    setShowCreateInvoice(false)
    setInvClient('')
    setInvPeriodStart('')
    setInvPeriodEnd('')
    setInvNotes('')
    setInvCreating(false)
    loadInvoices()
    loadEntries()
  }

  async function updateInvoiceStatus(id: string, status: LegalInvoice['status']) {
    const { error } = await supabase.from('legal_invoices').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) showError('Failed to update: ' + error.message)
    else { showSuccess(`Invoice marked as ${status}`); loadInvoices() }
  }

  async function deleteInvoice(inv: LegalInvoice) {
    if (!window.confirm(`Delete invoice ${inv.invoice_number}? This will unbill the associated time entries.`)) return
    const { data: lns } = await supabase.from('legal_invoice_lines').select('entry_id').eq('invoice_id', inv.id)
    if (lns && lns.length > 0) {
      const entryIds = lns.map((l: any) => l.entry_id).filter(Boolean)
      if (entryIds.length > 0) {
        await supabase.from('legal_timesheet_entries').update({ status: 'approved' }).in('id', entryIds)
      }
    }
    await supabase.from('legal_invoice_lines').delete().eq('invoice_id', inv.id)
    const { error } = await supabase.from('legal_invoices').delete().eq('id', inv.id)
    if (error) showError('Failed to delete: ' + error.message)
    else { showSuccess(`Invoice ${inv.invoice_number} deleted`); loadInvoices(); loadEntries() }
  }

  function generateInvoicePDF(invoice: LegalInvoice, lines: LegalInvoiceLine[]) {
    const co = companyBilling
    const client = clients.find(c => c.id === invoice.client_id)
    const doc = new jsPDF()
    const pw = doc.internal.pageSize.getWidth()
    const lm = 20
    const rm = pw - 20
    let y = 20

    // Company name + INVOICE header
    doc.setFontSize(18)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(30, 30, 45)
    doc.text(co?.name || 'Company', lm, y)
    doc.setFontSize(28)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(0, 100, 120)
    doc.text('INVOICE', rm, y, { align: 'right' })
    doc.setTextColor(30, 30, 45)
    y += 8

    // Company address block
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(100, 100, 100)
    const coLines = [
      co?.billing_address_line1, co?.billing_address_line2,
      [co?.billing_city, co?.billing_county, co?.billing_postcode].filter(Boolean).join(', '),
      co?.billing_email, co?.billing_phone,
    ].filter(Boolean)
    coLines.forEach(l => { doc.text(l as string, lm, y); y += 4 })
    const regVat = [
      co?.company_registration_number ? `Reg: ${co.company_registration_number}` : null,
      co?.vat_number ? `VAT: ${co.vat_number}` : null,
    ].filter(Boolean).join('  |  ')
    if (regVat) { doc.text(regVat, lm, y); y += 4 }
    y += 4

    // Divider
    doc.setDrawColor(220, 220, 220)
    doc.line(lm, y, rm, y)
    y += 8

    // Invoice detail row — labels across the top
    doc.setFontSize(8)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(120, 120, 120)
    doc.text('INVOICE NO', lm, y)
    doc.text('ISSUE DATE', lm + 45, y)
    doc.text('DUE DATE', lm + 90, y)
    doc.text('PERIOD', lm + 130, y)
    y += 5
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(30, 30, 45)
    doc.setFontSize(9)
    doc.text(invoice.invoice_number, lm, y)
    doc.text(new Date(invoice.invoice_date + 'T00:00:00').toLocaleDateString('en-GB'), lm + 45, y)
    doc.text(new Date(invoice.due_date + 'T00:00:00').toLocaleDateString('en-GB'), lm + 90, y)
    doc.text(`${fmtDate(invoice.period_start)} — ${fmtDate(invoice.period_end)}`, lm + 130, y)
    y += 12

    // Bill To / Client block
    const billToLines = [
      client?.name,
      client?.contact_name ? `FAO: ${client.contact_name}` : null,
      client?.address_line1, client?.address_line2,
      [client?.city, client?.county, client?.postcode].filter(Boolean).join(', '),
      client?.contact_email,
    ].filter(Boolean)
    const boxH = Math.max(24, 10 + billToLines.length * 5)
    doc.setFillColor(245, 247, 250)
    doc.roundedRect(lm, y, (rm - lm) / 2 - 5, boxH, 3, 3, 'F')
    doc.setFontSize(8)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(120, 120, 120)
    doc.text('BILL TO', lm + 6, y + 7)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(30, 30, 45)
    doc.setFontSize(9)
    let by = y + 13
    if (billToLines[0]) { doc.setFont('helvetica', 'bold'); doc.text(billToLines[0], lm + 6, by); doc.setFont('helvetica', 'normal'); by += 5 }
    billToLines.slice(1).forEach(l => { doc.setFontSize(8); doc.text(l as string, lm + 6, by); by += 4.5 })
    y += boxH + 8

    // Line items table header
    doc.setFillColor(0, 100, 120)
    doc.roundedRect(lm, y, rm - lm, 9, 2, 2, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(8)
    doc.setFont('helvetica', 'bold')
    const cols = [lm + 4, lm + 22, lm + 55, lm + 88, rm - 42, rm - 24, rm - 4]
    doc.text('Date', cols[0], y + 6)
    doc.text('Fee Earner', cols[1], y + 6)
    doc.text('Matter', cols[2], y + 6)
    doc.text('Description', cols[3], y + 6)
    doc.text('Hours', cols[4], y + 6)
    doc.text('Rate', cols[5], y + 6)
    doc.text('Amount', cols[6], y + 6, { align: 'right' })
    doc.setTextColor(30, 30, 45)
    y += 13

    // Line items
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    lines.forEach((line, i) => {
      if (y > 260) { doc.addPage(); y = 20 }
      if (i % 2 === 0) {
        doc.setFillColor(248, 250, 252)
        doc.rect(lm, y - 4, rm - lm, 7, 'F')
      }
      doc.text(new Date(line.date + 'T00:00:00').toLocaleDateString('en-GB'), cols[0], y)
      doc.text((line.employee_name || '').substring(0, 18), cols[1], y)
      doc.text((line.matter_name || '').substring(0, 18), cols[2], y)
      doc.text((line.description || '').substring(0, 22), cols[3], y)
      doc.text(Number(line.hours).toFixed(2), cols[4], y)
      doc.text(formatCurrency(Number(line.rate), currency), cols[5], y)
      doc.text(formatCurrency(Number(line.amount), currency), cols[6], y, { align: 'right' })
      y += 7
    })

    // Totals
    y += 4
    doc.setDrawColor(220, 220, 220)
    doc.line(rm - 70, y, rm, y)
    y += 8
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(80, 80, 80)
    doc.text('Subtotal', rm - 70, y)
    doc.text(formatCurrency(Number(invoice.subtotal), currency), rm, y, { align: 'right' })
    y += 6
    doc.text(`VAT (${Number(invoice.vat_rate).toFixed(0)}%)`, rm - 70, y)
    doc.text(formatCurrency(Number(invoice.vat_amount), currency), rm, y, { align: 'right' })
    y += 3
    doc.setDrawColor(220, 220, 220)
    doc.line(rm - 70, y, rm, y)
    y += 7
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.setTextColor(30, 30, 45)
    doc.text('Total Due', rm - 70, y)
    doc.text(formatCurrency(Number(invoice.total), currency), rm, y, { align: 'right' })

    // Footer
    y += 16
    if (invoice.notes) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(80, 80, 80)
      doc.text(`Notes: ${invoice.notes}`, lm, y)
      y += 8
    }
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(150, 150, 150)
    doc.text(`Payment terms: ${client?.payment_terms_days || 30} days from invoice date`, lm, y)
    y += 4
    if (co?.vat_number) {
      doc.text(`VAT Registration Number: ${co.vat_number}`, lm, y)
    }

    doc.save(`${invoice.invoice_number}.pdf`)
  }

  function csvSafe(val: string): string {
    let s = (val || '').replace(/"/g, '""')
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
    return `"${s}"`
  }

  function exportInvoiceSageCsv(invoice: LegalInvoice, lines: LegalInvoiceLine[]) {
    const client = clients.find(c => c.id === invoice.client_id)
    const headers = ['Type', 'Account Reference', 'Nominal A/C Ref', 'Date', 'Reference', 'Details', 'Net Amount', 'Tax Code', 'Tax Amount']
    const rows = lines.map(l => [
      'SI',
      (client?.name || 'CLIENT').substring(0, 8).toUpperCase(),
      '4000',
      new Date(invoice.invoice_date + 'T00:00:00').toLocaleDateString('en-GB'),
      invoice.invoice_number,
      `${l.employee_name} - ${l.matter_name} - ${Number(l.hours).toFixed(2)}h`,
      Number(l.amount).toFixed(2),
      'T1',
      (Number(l.amount) * (Number(invoice.vat_rate) / 100)).toFixed(2),
    ])
    const csv = [headers.join(','), ...rows.map(r => r.map(c => csvSafe(String(c))).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${invoice.invoice_number}-sage.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function exportInvoiceXeroCsv(invoice: LegalInvoice, lines: LegalInvoiceLine[]) {
    const client = clients.find(c => c.id === invoice.client_id)
    const headers = ['*ContactName', 'EmailAddress', '*InvoiceNumber', '*InvoiceDate', '*DueDate', '*Description', '*Quantity', '*UnitAmount', '*AccountCode', 'TaxType']
    const rows = lines.map(l => [
      client?.name || '',
      client?.contact_email || '',
      invoice.invoice_number,
      new Date(invoice.invoice_date + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }),
      new Date(invoice.due_date + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }),
      `${l.employee_name} - ${l.matter_name} (${Number(l.hours).toFixed(2)}h @ ${formatCurrency(Number(l.rate), currency)}/hr)`,
      Number(l.hours).toFixed(2),
      Number(l.rate).toFixed(2),
      '200',
      Number(invoice.vat_rate) > 0 ? '20% (VAT on Income)' : 'No VAT',
    ])
    const csv = [headers.join(','), ...rows.map(r => r.map(c => csvSafe(String(c))).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${invoice.invoice_number}-xero.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Export
  function exportToCSV() {
    const approved = entries.filter(e => e.status === 'approved' || e.status === 'billed')
    const headers = ['Date', 'Employee', 'Client', 'Matter', 'Task Code', 'Activity', 'Hours', 'Narrative', 'Status']
    const rows = approved.map(e => {
      const taskLabel = TASK_CODES.find(tc => tc.code === e.task_code)?.label || e.task_code
      return [e.date, empName(e.employee), e.client?.name || '', e.matter?.name || '', e.task_code, taskLabel, Number(e.duration_hrs).toFixed(1), e.narrative, e.status]
    })
    const csv = [headers.join(','), ...rows.map(r => r.map(c => csvSafe(String(c))).join(','))].join('\n')
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
      const emp = employees.find(emp => emp.id === e.employee_id)
      const rate = emp?.charge_out_rate || 250
      lines.push(`${e.date}|INV-${Date.now()}|${e.client?.name || ''}|${e.matter?.name || ''}|${(hrs * rate).toFixed(2)}|${e.date}|${e.date}|${e.narrative}|${i + 1}|F|${hrs}|0|${(hrs * rate).toFixed(2)}|${e.date}|${e.task_code}||${e.task_code}|${e.employee_id}|${e.narrative}|FIRM001|${rate.toFixed(2)}|${empName(e.employee)}|ASSOCIATE[]`)
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
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#00897b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v18" /><path d="M5 7l7-4 7 4" /><path d="M5 7v2a7 7 0 0 0 3.5 6" /><path d="M19 7v2a7 7 0 0 1-3.5 6" /><circle cx="5" cy="7" r="1" fill="#00897b" /><circle cx="19" cy="7" r="1" fill="#00897b" /></svg>
          Legal Timesheet Management
        </h2>
        <p>Review, approve, and manage employee legal time entries, clients, and matters</p>
      </div>

      {/* Tabs */}
      <div className="alt-tabs">
        {(['overview', 'review', 'matters', 'invoices', 'compliance', 'settings'] as Tab[]).map(t => (
          <button key={t} className={`alt-tab ${tab === t ? 'alt-tab-active' : ''}`} onClick={() => setTab(t)}>
            {t === 'overview' && <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 20V10" /><path d="M12 20V4" /><path d="M6 20v-6" /></svg> Overview</>}
            {t === 'review' && <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg> Review &amp; Approve</>}
            {t === 'matters' && <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg> Clients &amp; Matters</>}
            {t === 'invoices' && <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg> Invoices</>}
            {t === 'compliance' && <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg> Compliance</>}
            {t === 'settings' && <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg> Settings</>}
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
                {paginated.map(e => (
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
          </div>
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 12 }}>
              <button className="admin-action-btn" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</button>
              <span style={{ fontSize: 13 }}>Page {page} of {totalPages}</span>
              <button className="admin-action-btn" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</button>
            </div>
          )}
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
            </div>
          </div>
        </>
      )}

      {/* ── INVOICES TAB ── */}
      {tab === 'invoices' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Client Invoices</h3>
            <button className="admin-btn alt-btn-primary" onClick={() => setShowCreateInvoice(true)}>
              + Create Invoice
            </button>
          </div>

          {showCreateInvoice && (
            <div className="alt-compliance-section" style={{ marginBottom: 16 }}>
              <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600 }}>Generate Invoice from Approved Time</h4>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Client</label>
                  <select className="admin-select" style={{ minWidth: 200 }} value={invClient} onChange={e => setInvClient(e.target.value)}>
                    <option value="">Select client...</option>
                    {clients.filter(c => c.status === 'active').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Period From</label>
                  <input type="date" className="admin-inline-input" value={invPeriodStart} onChange={e => setInvPeriodStart(e.target.value)} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Period To</label>
                  <input type="date" className="admin-inline-input" value={invPeriodEnd} onChange={e => setInvPeriodEnd(e.target.value)} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>VAT %</label>
                  <input type="number" className="admin-inline-input" style={{ width: 70 }} value={invVatRate} onChange={e => setInvVatRate(Number(e.target.value))} />
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Notes (optional)</label>
                  <input type="text" className="admin-inline-input" style={{ width: '100%' }} value={invNotes} onChange={e => setInvNotes(e.target.value)} placeholder="Payment reference, PO number, etc." />
                </div>
              </div>
              {invClient && invPeriodStart && invPeriodEnd && (
                <div style={{ marginTop: 12, fontSize: 13, color: 'var(--text-muted, #666)' }}>
                  {entries.filter(e => e.client_id === invClient && (e.status === 'approved' || e.status === 'billed') && e.date >= invPeriodStart && e.date <= invPeriodEnd).length} approved entries found for this period
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button className="admin-btn alt-btn-primary" onClick={createInvoice} disabled={invCreating || !invClient || !invPeriodStart || !invPeriodEnd}>
                  {invCreating ? 'Creating...' : 'Create Invoice'}
                </button>
                <button className="admin-btn" onClick={() => setShowCreateInvoice(false)}>Cancel</button>
              </div>
            </div>
          )}

          {invoiceLoading ? <div className="admin-loading">Loading invoices...</div> : invoices.length === 0 ? (
            <div className="admin-empty">No invoices created yet. Use approved time entries to generate invoices.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="admin-table" style={{ fontSize: 13 }}>
                <thead>
                  <tr>
                    <th>Invoice #</th>
                    <th>Client</th>
                    <th>Date</th>
                    <th>Due</th>
                    <th>Period</th>
                    <th>Subtotal</th>
                    <th>VAT</th>
                    <th>Total</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map(inv => (
                    <tr key={inv.id}>
                      <td><strong>{inv.invoice_number}</strong></td>
                      <td>{inv.client?.name || '—'}</td>
                      <td>{new Date(inv.invoice_date + 'T00:00:00').toLocaleDateString('en-GB')}</td>
                      <td>{new Date(inv.due_date + 'T00:00:00').toLocaleDateString('en-GB')}</td>
                      <td style={{ fontSize: 12 }}>{fmtDate(inv.period_start)} — {fmtDate(inv.period_end)}</td>
                      <td>{formatCurrency(Number(inv.subtotal), currency)}</td>
                      <td>{formatCurrency(Number(inv.vat_amount), currency)}</td>
                      <td><strong>{formatCurrency(Number(inv.total), currency)}</strong></td>
                      <td>
                        <span style={{
                          padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                          background: inv.status === 'paid' ? '#e8f5e9' : inv.status === 'sent' ? '#e3f2fd' : inv.status === 'overdue' ? '#ffebee' : inv.status === 'cancelled' ? '#f5f5f5' : '#fff3e0',
                          color: inv.status === 'paid' ? '#2e7d32' : inv.status === 'sent' ? '#1565c0' : inv.status === 'overdue' ? '#c62828' : inv.status === 'cancelled' ? '#888' : '#e65100',
                        }}>
                          {inv.status}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          <button className="admin-btn-sm" onClick={async () => {
                            setViewingInvoice(inv.id)
                            await loadInvoiceLines(inv.id)
                            generateInvoicePDF(inv, (await supabase.from('legal_invoice_lines').select('*').eq('invoice_id', inv.id).order('date')).data as LegalInvoiceLine[] || [])
                          }}>PDF</button>
                          <button className="admin-btn-sm" onClick={async () => {
                            const { data: lns } = await supabase.from('legal_invoice_lines').select('*').eq('invoice_id', inv.id).order('date')
                            exportInvoiceXeroCsv(inv, lns as LegalInvoiceLine[] || [])
                          }}>Xero</button>
                          <button className="admin-btn-sm" onClick={async () => {
                            const { data: lns } = await supabase.from('legal_invoice_lines').select('*').eq('invoice_id', inv.id).order('date')
                            exportInvoiceSageCsv(inv, lns as LegalInvoiceLine[] || [])
                          }}>Sage</button>
                          {inv.status === 'draft' && <button className="admin-btn-sm" style={{ color: '#1565c0' }} onClick={() => updateInvoiceStatus(inv.id, 'sent')}>Mark Sent</button>}
                          {(inv.status === 'sent' || inv.status === 'overdue') && <button className="admin-btn-sm" style={{ color: '#2e7d32' }} onClick={() => updateInvoiceStatus(inv.id, 'paid')}>Mark Paid</button>}
                          {(inv.status === 'draft' || inv.status === 'cancelled') && <button className="admin-btn-sm" style={{ color: '#c62828' }} onClick={() => deleteInvoice(inv)}>Delete</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── SETTINGS TAB ── */}
      {tab === 'settings' && (
        <>
          {/* Charge-out Rates */}
          <div className="alt-compliance-section" style={{ marginBottom: 16 }}>
            <h3 className="alt-section-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1565c0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
              Fee Earner Charge-out Rates
            </h3>
            <p style={{ fontSize: 13, color: '#8b8fa3', marginBottom: 16 }}>
              Set hourly charge-out rates for each fee earner. These rates are used for client billing and invoicing — separate from the employee's pay rate.
            </p>
            <div style={{ overflowX: 'auto' }}>
              <table className="admin-table" style={{ fontSize: 13, maxWidth: 600 }}>
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Pay Rate ({currencySymbol(currency)}/hr)</th>
                    <th>Charge-out Rate ({currencySymbol(currency)}/hr)</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.filter(e => e.is_active).map(emp => (
                    <tr key={emp.id}>
                      <td style={{ fontWeight: 600 }}>{emp.first_name} {emp.last_name}</td>
                      <td style={{ color: '#8b8fa3' }}>{emp.hourly_rate ? formatCurrency(Number(emp.hourly_rate), currency) : '—'}</td>
                      <td>
                        <input
                          className="admin-inline-input"
                          type="number"
                          step="0.01"
                          style={{ width: 100 }}
                          value={emp.charge_out_rate ?? ''}
                          placeholder="0.00"
                          onChange={async (e) => {
                            const val = e.target.value ? parseFloat(e.target.value) : null
                            await supabase.from('employees').update({ charge_out_rate: val }).eq('id', emp.id)
                            loadEmployees()
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Company Billing Details */}
          <div className="alt-compliance-section" style={{ marginBottom: 16 }}>
            <h3 className="alt-section-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#e65100" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
              Company Billing Details
            </h3>
            <p style={{ fontSize: 13, color: '#8b8fa3', marginBottom: 16 }}>
              Your company details appear on generated invoices — logo, name, address, registration number and VAT number.
            </p>
            {companyBilling ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px', maxWidth: 600 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Company Reg. No.</label>
                  <input className="admin-inline-input" style={{ width: '100%' }} value={companyBilling.company_registration_number || ''} onChange={e => setCompanyBilling({ ...companyBilling, company_registration_number: e.target.value })} onBlur={() => supabase.from('companies').update({ company_registration_number: companyBilling.company_registration_number || null }).eq('id', selectedCompanyId)} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>VAT Number</label>
                  <input className="admin-inline-input" style={{ width: '100%' }} value={companyBilling.vat_number || ''} onChange={e => setCompanyBilling({ ...companyBilling, vat_number: e.target.value })} onBlur={() => supabase.from('companies').update({ vat_number: companyBilling.vat_number || null }).eq('id', selectedCompanyId)} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Billing Address Line 1</label>
                  <input className="admin-inline-input" style={{ width: '100%' }} value={companyBilling.billing_address_line1 || ''} onChange={e => setCompanyBilling({ ...companyBilling, billing_address_line1: e.target.value })} onBlur={() => supabase.from('companies').update({ billing_address_line1: companyBilling.billing_address_line1 || null }).eq('id', selectedCompanyId)} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Billing Address Line 2</label>
                  <input className="admin-inline-input" style={{ width: '100%' }} value={companyBilling.billing_address_line2 || ''} onChange={e => setCompanyBilling({ ...companyBilling, billing_address_line2: e.target.value })} onBlur={() => supabase.from('companies').update({ billing_address_line2: companyBilling.billing_address_line2 || null }).eq('id', selectedCompanyId)} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>City</label>
                  <input className="admin-inline-input" style={{ width: '100%' }} value={companyBilling.billing_city || ''} onChange={e => setCompanyBilling({ ...companyBilling, billing_city: e.target.value })} onBlur={() => supabase.from('companies').update({ billing_city: companyBilling.billing_city || null }).eq('id', selectedCompanyId)} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>County</label>
                  <input className="admin-inline-input" style={{ width: '100%' }} value={companyBilling.billing_county || ''} onChange={e => setCompanyBilling({ ...companyBilling, billing_county: e.target.value })} onBlur={() => supabase.from('companies').update({ billing_county: companyBilling.billing_county || null }).eq('id', selectedCompanyId)} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Postcode</label>
                  <input className="admin-inline-input" style={{ width: '100%' }} value={companyBilling.billing_postcode || ''} onChange={e => setCompanyBilling({ ...companyBilling, billing_postcode: e.target.value })} onBlur={() => supabase.from('companies').update({ billing_postcode: companyBilling.billing_postcode || null }).eq('id', selectedCompanyId)} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Billing Email</label>
                  <input className="admin-inline-input" type="email" style={{ width: '100%' }} value={companyBilling.billing_email || ''} onChange={e => setCompanyBilling({ ...companyBilling, billing_email: e.target.value })} onBlur={() => supabase.from('companies').update({ billing_email: companyBilling.billing_email || null }).eq('id', selectedCompanyId)} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Billing Phone</label>
                  <input className="admin-inline-input" style={{ width: '100%' }} value={companyBilling.billing_phone || ''} onChange={e => setCompanyBilling({ ...companyBilling, billing_phone: e.target.value })} onBlur={() => supabase.from('companies').update({ billing_phone: companyBilling.billing_phone || null }).eq('id', selectedCompanyId)} />
                </div>
              </div>
            ) : (
              <div className="admin-empty">Loading company billing details...</div>
            )}
          </div>

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
