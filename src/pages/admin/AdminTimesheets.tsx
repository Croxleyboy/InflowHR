import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { useToast } from '../../context/ToastContext'
import { formatDate } from '../../lib/formatters'
import CheckInSettingsPanel from './CheckInSettings'
import CheckInDashboardPanel from './CheckInDashboard'

interface Timesheet {
  id: number
  employee_id: string
  location: string
  customer: string | null
  role: string
  date: string
  end_date: string | null
  start_time: string
  end_time: string
  hours: number
  status: string
  created_at: string
  project_id: string | null
  employee: { first_name: string; last_name: string; email: string; avatar_url: string | null } | null
  project: { name: string; customer_name: string } | null
}

interface CustomerProject {
  id: string
  name: string
  customer_name: string
  description: string | null
  start_date: string
  end_date: string | null
  is_active: boolean
  created_at: string
}

interface ReportEmployee {
  id: string
  first_name: string
  last_name: string
  department: string | null
  weekly_hours: number | null
  working_pattern: string | null
  is_active: boolean
}

const PAGE_SIZE = 30

const STATUS_OPTIONS = ['draft', 'pending', 'approved', 'rejected']
const MONTH_NAMES_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December']
const MONTH_NAMES_CAL = MONTH_NAMES_FULL

const BAR_COLORS = [
  '#5c6bc0','#26a69a','#ef5350','#ab47bc','#ffa726','#42a5f5',
  '#66bb6a','#ec407a','#7e57c2','#78909c','#8d6e63','#d4e157',
]

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatDateUK(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-GB')
}

function getWeekRange(offset: number): { start: string; end: string; label: string } {
  const now = new Date()
  const day = now.getDay()
  const mondayOffset = day === 0 ? -6 : 1 - day
  const monday = new Date(now)
  monday.setDate(now.getDate() + mondayOffset + offset * 7)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return {
    start: localDateStr(monday),
    end: localDateStr(sunday),
    label: `${monday.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${sunday.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`,
  }
}

function getMonthRange(offset: number): { start: string; end: string; label: string } {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  return {
    start: localDateStr(d),
    end: localDateStr(end),
    label: `${MONTH_NAMES_CAL[d.getMonth()]} ${d.getFullYear()}`,
  }
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
    months.push({ year: y, month: m, label: `${MONTH_NAMES_CAL[m]} ${y}` })
  }
  return months
}

function getWorkingDaysInRange(start: string, end: string): number {
  let count = 0
  const d = new Date(start + 'T00:00:00')
  const e = new Date(end + 'T00:00:00')
  while (d <= e) {
    const day = d.getDay()
    if (day !== 0 && day !== 6) count++
    d.setDate(d.getDate() + 1)
  }
  return count
}

export default function AdminTimesheets() {
  const { selectedCompanyId, selectedCompany, refreshCompanies } = useAdminCompany()
  const { showError, showSuccess } = useToast()
  const [tsTab, setTsTab] = useState<'entries' | 'projects' | 'timeline' | 'reports' | 'checkin'>('entries')
  const [timesheets, setTimesheets] = useState<Timesheet[]>([])
  const [loading, setLoading] = useState(true)
  const [filterEmployee, setFilterEmployee] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [search, setSearch] = useState('')
  const [entriesPage, setEntriesPage] = useState(1)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<Record<string, any>>({})

  const [projects, setProjects] = useState<CustomerProject[]>([])
  const [projLoading, setProjLoading] = useState(false)
  const [projEditId, setProjEditId] = useState<string | null>(null)
  const [projForm, setProjForm] = useState({ name: '', customer_name: '', description: '', start_date: '', end_date: '', is_active: true })
  const [projAdding, setProjAdding] = useState(false)

  const monitoringEnabled = selectedCompany?.timesheet_monitoring_enabled ?? false
  const monitoringPeriod = selectedCompany?.timesheet_monitoring_period ?? 'weekly'
  const [savingMonitoring, setSavingMonitoring] = useState(false)

  useEffect(() => { if (selectedCompanyId) { load(); loadProjects() } }, [selectedCompanyId])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('timesheets')
      .select('*, employee:employees!timesheets_employee_id_fkey(first_name, last_name, email, avatar_url), project:customer_projects!timesheets_project_id_fkey(name, customer_name)')
      .eq('company_id', selectedCompanyId)
      .order('date', { ascending: false })
    setTimesheets((data as Timesheet[]) || [])
    setLoading(false)
  }

  const loadProjects = useCallback(async () => {
    setProjLoading(true)
    const { data } = await supabase
      .from('customer_projects')
      .select('*')
      .eq('company_id', selectedCompanyId)
      .order('customer_name')
    setProjects((data as CustomerProject[]) || [])
    setProjLoading(false)
  }, [selectedCompanyId])

  function startEdit(ts: Timesheet) {
    setEditingId(ts.id)
    setEditForm({
      location: ts.location, customer: ts.customer, role: ts.role,
      date: ts.date, start_time: ts.start_time, end_time: ts.end_time,
      hours: ts.hours, status: ts.status, project_id: ts.project_id || '',
    })
  }

  async function saveEdit(id: number) {
    const ts = timesheets.find(t => t.id === id)
    const oldStatus = ts?.status
    const newStatus = editForm.status

    const { error } = await supabase.from('timesheets').update({
      location: editForm.location,
      customer: editForm.customer || null,
      role: editForm.role,
      date: editForm.date,
      start_time: editForm.start_time,
      end_time: editForm.end_time,
      hours: Number(editForm.hours),
      status: newStatus,
      project_id: editForm.project_id || null,
    }).eq('id', id)
    if (error) { showError('Failed to update timesheet: ' + error.message); return }

    if (ts && oldStatus === 'pending' && (newStatus === 'approved' || newStatus === 'rejected')) {
      const empName = ts.employee ? `${ts.employee.first_name} ${ts.employee.last_name}` : ''
      const empEmail = ts.employee?.email || ''
      const approved = newStatus === 'approved'
      const now = new Date().toISOString()
      const dateDisplay = ts.end_date && ts.end_date !== ts.date
        ? `${formatDate(ts.date)} – ${formatDate(ts.end_date)}`
        : formatDate(ts.date)
      const timeDisplay = `${ts.start_time.slice(0, 5)}-${ts.end_time.slice(0, 5)}`

      const { data: pendingWf } = await supabase.from('workflow_tracker')
        .select('assigned_to')
        .eq('record_type', 'Timesheet').eq('approval_id', id).eq('status', 'Pending')
        .eq('company_id', selectedCompanyId).limit(1).maybeSingle()
      const approverEmail = pendingWf?.assigned_to || ''

      await supabase.from('workflow_tracker').update({
        status: 'Complete',
        approval_status: approved ? 'Approved' : 'Declined',
        updated_at: now,
        task_description: approved
          ? `Timesheet approved - ${dateDisplay} ${timeDisplay}`
          : `Timesheet declined - ${dateDisplay}`,
      }).eq('record_type', 'Timesheet').eq('approval_id', id).eq('status', 'Pending').eq('company_id', selectedCompanyId)

      await supabase.from('workflow_tracker').insert({
        emp_display_name: empName,
        step: 2, status: 'Complete', record_type: 'Timesheet',
        action: approved ? 'Timesheet approved' : 'Timesheet declined',
        employee_email: empEmail, assigned_to: empEmail,
        approval_id: id, reminder_count: 1,
        task_description: approved
          ? `Your timesheet for ${dateDisplay} ${timeDisplay} has been approved by admin.`
          : `Your timesheet for ${dateDisplay} ${timeDisplay} has been declined by admin. Please contact your manager.`,
        approval_status: approved ? 'Approved' : 'Declined',
        company_id: selectedCompanyId,
      })

      if (approverEmail) {
        await supabase.from('workflow_tracker').insert({
          emp_display_name: 'Admin',
          step: 2, status: 'Complete', record_type: 'Timesheet',
          action: approved ? 'Timesheet approved by admin' : 'Timesheet declined by admin',
          employee_email: approverEmail, assigned_to: approverEmail,
          approval_id: id, reminder_count: 1,
          task_description: `Admin ${approved ? 'approved' : 'declined'} timesheet for ${empName} - ${dateDisplay} ${timeDisplay}`,
          approval_status: approved ? 'Approved' : 'Declined',
          company_id: selectedCompanyId,
        })
      }

      window.dispatchEvent(new Event('notifications-updated'))
    }

    setEditingId(null)
    load()
  }

  async function deleteTimesheet(id: number) {
    if (!confirm('Delete this timesheet entry?')) return
    const { error: e1 } = await supabase.from('workflow_tracker').delete().eq('record_type', 'Timesheet').eq('approval_id', id)
    if (e1) { showError('Failed to delete workflow tracker: ' + e1.message); return }
    const { error: e2 } = await supabase.from('timesheets').delete().eq('id', id)
    if (e2) { showError('Failed to delete timesheet: ' + e2.message); return }
    window.dispatchEvent(new Event('notifications-updated'))
    setTimesheets(prev => prev.filter(t => t.id !== id))
  }

  function startProjEdit(p: CustomerProject) {
    setProjEditId(p.id)
    setProjForm({ name: p.name, customer_name: p.customer_name, description: p.description || '', start_date: p.start_date, end_date: p.end_date || '', is_active: p.is_active })
  }

  function startProjAdd() {
    setProjAdding(true)
    setProjForm({ name: '', customer_name: '', description: '', start_date: localDateStr(new Date()), end_date: '', is_active: true })
  }

  async function saveProjEdit(id: string) {
    const { error } = await supabase.from('customer_projects').update({
      name: projForm.name, customer_name: projForm.customer_name,
      description: projForm.description || null,
      start_date: projForm.start_date, end_date: projForm.end_date || null, is_active: projForm.is_active,
    }).eq('id', id)
    if (error) { showError('Failed to update project: ' + error.message); return }
    setProjEditId(null)
    loadProjects()
    showSuccess('Project updated')
  }

  async function saveProjAdd() {
    if (!projForm.name.trim() || !projForm.customer_name.trim() || !projForm.start_date) {
      showError('Name, customer and start date are required'); return
    }
    const { error } = await supabase.from('customer_projects').insert({
      name: projForm.name, customer_name: projForm.customer_name,
      description: projForm.description || null,
      start_date: projForm.start_date, end_date: projForm.end_date || null,
      is_active: projForm.is_active, company_id: selectedCompanyId,
    })
    if (error) { showError('Failed to create project: ' + error.message); return }
    setProjAdding(false)
    loadProjects()
    showSuccess('Project created')
  }

  async function deleteProjById(id: string) {
    if (!confirm('Delete this project?')) return
    const { error } = await supabase.from('customer_projects').delete().eq('id', id)
    if (error) { showError('Failed to delete project: ' + error.message); return }
    setProjects(prev => prev.filter(p => p.id !== id))
    showSuccess('Project deleted')
  }

  async function toggleMonitoring(enabled: boolean) {
    setSavingMonitoring(true)
    const { error } = await supabase.from('companies').update({ timesheet_monitoring_enabled: enabled }).eq('id', selectedCompanyId)
    if (error) { showError('Failed to update monitoring: ' + error.message) }
    else { showSuccess(enabled ? 'Time monitoring enabled' : 'Time monitoring disabled'); refreshCompanies(selectedCompanyId) }
    setSavingMonitoring(false)
  }

  async function setPeriod(period: 'weekly' | 'monthly') {
    setSavingMonitoring(true)
    const { error } = await supabase.from('companies').update({ timesheet_monitoring_period: period }).eq('id', selectedCompanyId)
    if (error) { showError('Failed to update period: ' + error.message) }
    else { showSuccess(`Monitoring period set to ${period}`); refreshCompanies(selectedCompanyId) }
    setSavingMonitoring(false)
  }

  const employees = useMemo(() => {
    const names = new Set<string>()
    timesheets.forEach(t => { if (t.employee) names.add(`${t.employee.first_name} ${t.employee.last_name}`) })
    return Array.from(names).sort()
  }, [timesheets])

  const filteredEntries = useMemo(() => {
    return timesheets.filter(t => {
      if (filterStatus && t.status !== filterStatus) return false
      if (filterEmployee && t.employee && `${t.employee.first_name} ${t.employee.last_name}` !== filterEmployee) return false
      if (search) {
        const q = search.toLowerCase()
        const name = t.employee ? `${t.employee.first_name} ${t.employee.last_name}`.toLowerCase() : ''
        if (!name.includes(q) && !t.location.toLowerCase().includes(q) && !t.role.toLowerCase().includes(q) && !(t.customer || '').toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [timesheets, filterStatus, filterEmployee, search])

  useEffect(() => { setEntriesPage(1) }, [search, filterStatus, filterEmployee])

  const entriesTotalPages = Math.max(1, Math.ceil(filteredEntries.length / PAGE_SIZE))
  const paginatedEntries = filteredEntries.slice((entriesPage - 1) * PAGE_SIZE, entriesPage * PAGE_SIZE)

  const totalHours = filteredEntries.reduce((s, t) => s + Number(t.hours), 0)

  return (
    <div className="admin-section">
      <div className="admin-page-header">
        <h2>Timesheet Management</h2>
        <p>{timesheets.length} total entries &middot; {totalHours.toFixed(1)} hours</p>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '8px 0 4px', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600 }}>
          <span>Time Monitoring</span>
          <button
            className={`ts-toggle ${monitoringEnabled ? 'ts-toggle-on' : ''}`}
            onClick={() => toggleMonitoring(!monitoringEnabled)}
            disabled={savingMonitoring}
            aria-label="Toggle time monitoring"
          >
            <span className="ts-toggle-knob" />
          </button>
        </label>
        {monitoringEnabled && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              className={`admin-btn-sm ${monitoringPeriod === 'weekly' ? 'admin-btn-save' : 'admin-btn-cancel'}`}
              onClick={() => setPeriod('weekly')}
              disabled={savingMonitoring}
            >Weekly</button>
            <button
              className={`admin-btn-sm ${monitoringPeriod === 'monthly' ? 'admin-btn-save' : 'admin-btn-cancel'}`}
              onClick={() => setPeriod('monthly')}
              disabled={savingMonitoring}
            >Monthly</button>
          </div>
        )}
      </div>

      <div className="admin-tabs">
        <button className={`admin-tab ${tsTab === 'entries' ? 'admin-tab-active' : ''}`} onClick={() => setTsTab('entries')}>Entries</button>
        <button className={`admin-tab ${tsTab === 'projects' ? 'admin-tab-active' : ''}`} onClick={() => setTsTab('projects')}>Customer Projects</button>
        <button className={`admin-tab ${tsTab === 'timeline' ? 'admin-tab-active' : ''}`} onClick={() => setTsTab('timeline')}>Project Timeline</button>
        <button className={`admin-tab ${tsTab === 'reports' ? 'admin-tab-active' : ''}`} onClick={() => setTsTab('reports')}>Timesheet Reports</button>
        <button className={`admin-tab ${tsTab === 'checkin' ? 'admin-tab-active' : ''}`} onClick={() => setTsTab('checkin')}>Check-In</button>
      </div>

      {tsTab === 'entries' && (
        <>
          <div className="admin-filters">
            <input
              placeholder="Search by name, location, role..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="admin-input"
              style={{ flex: 1, minWidth: 180 }}
            />
            <select value={filterEmployee} onChange={e => setFilterEmployee(e.target.value)} className="admin-select">
              <option value="">All Employees</option>
              {employees.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="admin-select">
              <option value="">All Statuses</option>
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
            </select>
          </div>

          {loading ? <div className="admin-loading">Loading...</div> : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Date</th>
                    <th>Time</th>
                    <th>Hours</th>
                    <th>Project</th>
                    <th>Location</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedEntries.map(ts => (
                    <tr key={ts.id}>
                      <td>{ts.employee ? <span className="admin-inline-avatar">{ts.employee.avatar_url ? <img src={ts.employee.avatar_url} alt="" /> : <span className="admin-avatar-initials">{ts.employee.first_name[0]}{ts.employee.last_name[0]}</span>}{ts.employee.first_name} {ts.employee.last_name}</span> : '—'}</td>
                      <td>{editingId === ts.id
                        ? <input type="date" className="admin-inline-input" value={editForm.date || ''} onChange={e => setEditForm(p => ({ ...p, date: e.target.value }))} />
                        : ts.end_date && ts.end_date !== ts.date
                          ? `${formatDateUK(ts.date)} – ${formatDateUK(ts.end_date)}`
                          : formatDateUK(ts.date)
                      }</td>
                      <td>{editingId === ts.id
                        ? <><input type="time" className="admin-inline-input admin-inline-sm" value={editForm.start_time?.slice(0, 5) || ''} onChange={e => setEditForm(p => ({ ...p, start_time: e.target.value }))} /> - <input type="time" className="admin-inline-input admin-inline-sm" value={editForm.end_time?.slice(0, 5) || ''} onChange={e => setEditForm(p => ({ ...p, end_time: e.target.value }))} /></>
                        : `${ts.start_time.slice(0, 5)} - ${ts.end_time.slice(0, 5)}`
                      }</td>
                      <td>{editingId === ts.id
                        ? <input type="number" step="0.1" min="0" className="admin-inline-input admin-inline-sm" value={editForm.hours ?? ''} onChange={e => setEditForm(p => ({ ...p, hours: e.target.value }))} style={{ width: 60 }} />
                        : Number(ts.hours).toFixed(1)
                      }</td>
                      <td>{editingId === ts.id
                        ? (
                          <select className="admin-inline-select" value={editForm.project_id || ''} onChange={e => setEditForm(p => ({ ...p, project_id: e.target.value }))}>
                            <option value="">No project</option>
                            {projects.map(proj => (
                              <option key={proj.id} value={proj.id}>{proj.customer_name} — {proj.name}</option>
                            ))}
                          </select>
                        )
                        : ts.project ? `${ts.project.customer_name} — ${ts.project.name}` : (ts.customer || '—')
                      }</td>
                      <td>{editingId === ts.id
                        ? <input className="admin-inline-input" value={editForm.location || ''} onChange={e => setEditForm(p => ({ ...p, location: e.target.value }))} />
                        : ts.location
                      }</td>
                      <td>{editingId === ts.id ? (
                        <select className="admin-inline-select" value={editForm.status || ''} onChange={e => setEditForm(p => ({ ...p, status: e.target.value }))}>
                          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      ) : <span className={`admin-badge admin-badge-${ts.status}`}>{ts.status}</span>}</td>
                      <td className="admin-actions">
                        {editingId === ts.id ? (
                          <>
                            <button className="admin-btn-sm admin-btn-save" onClick={() => saveEdit(ts.id)}>Save</button>
                            <button className="admin-btn-sm admin-btn-cancel" onClick={() => setEditingId(null)}>Cancel</button>
                          </>
                        ) : (
                          <>
                            <button className="admin-btn-icon" title="Edit" onClick={() => startEdit(ts)}>
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                            </button>
                            <button className="admin-btn-icon admin-btn-danger" title="Delete" onClick={() => deleteTimesheet(ts.id)}>
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredEntries.length === 0 && <div className="admin-empty">No timesheets found</div>}
              {entriesTotalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 12 }}>
                  <button className="admin-action-btn" disabled={entriesPage <= 1} onClick={() => setEntriesPage(p => p - 1)}>Prev</button>
                  <span style={{ fontSize: 13 }}>Page {entriesPage} of {entriesTotalPages}</span>
                  <button className="admin-action-btn" disabled={entriesPage >= entriesTotalPages} onClick={() => setEntriesPage(p => p + 1)}>Next</button>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {tsTab === 'projects' && (
        <>
          <div className="admin-filters">
            <button className="admin-btn admin-btn-primary" onClick={startProjAdd}>+ Add Project</button>
          </div>

          {projLoading ? <div className="admin-loading">Loading...</div> : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr><th>Customer</th><th>Project Name</th><th>Description</th><th>Start Date</th><th>End Date</th><th>Status</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {projAdding && (
                    <tr>
                      <td><input className="admin-inline-input" placeholder="Customer name" value={projForm.customer_name} onChange={e => setProjForm(f => ({ ...f, customer_name: e.target.value }))} /></td>
                      <td><input className="admin-inline-input" placeholder="Project name" value={projForm.name} onChange={e => setProjForm(f => ({ ...f, name: e.target.value }))} /></td>
                      <td><input className="admin-inline-input" placeholder="Description (optional)" value={projForm.description} onChange={e => setProjForm(f => ({ ...f, description: e.target.value }))} /></td>
                      <td><input type="date" className="admin-inline-input" value={projForm.start_date} onChange={e => setProjForm(f => ({ ...f, start_date: e.target.value }))} /></td>
                      <td><input type="date" className="admin-inline-input" value={projForm.end_date} onChange={e => setProjForm(f => ({ ...f, end_date: e.target.value }))} /></td>
                      <td>
                        <select className="admin-inline-select" value={projForm.is_active ? 'active' : 'inactive'} onChange={e => setProjForm(f => ({ ...f, is_active: e.target.value === 'active' }))}>
                          <option value="active">Active</option>
                          <option value="inactive">Inactive</option>
                        </select>
                      </td>
                      <td className="admin-actions">
                        <button className="admin-btn-sm admin-btn-save" onClick={saveProjAdd}>Save</button>
                        <button className="admin-btn-sm admin-btn-cancel" onClick={() => setProjAdding(false)}>Cancel</button>
                      </td>
                    </tr>
                  )}
                  {projects.map(p => (
                    <tr key={p.id}>
                      <td>{projEditId === p.id ? <input className="admin-inline-input" value={projForm.customer_name} onChange={e => setProjForm(f => ({ ...f, customer_name: e.target.value }))} /> : p.customer_name}</td>
                      <td>{projEditId === p.id ? <input className="admin-inline-input" value={projForm.name} onChange={e => setProjForm(f => ({ ...f, name: e.target.value }))} /> : p.name}</td>
                      <td>{projEditId === p.id ? <input className="admin-inline-input" value={projForm.description} onChange={e => setProjForm(f => ({ ...f, description: e.target.value }))} placeholder="Description (optional)" /> : (p.description || '—')}</td>
                      <td>{projEditId === p.id ? <input type="date" className="admin-inline-input" value={projForm.start_date} onChange={e => setProjForm(f => ({ ...f, start_date: e.target.value }))} /> : formatDateUK(p.start_date)}</td>
                      <td>{projEditId === p.id ? <input type="date" className="admin-inline-input" value={projForm.end_date} onChange={e => setProjForm(f => ({ ...f, end_date: e.target.value }))} /> : (p.end_date ? formatDateUK(p.end_date) : '—')}</td>
                      <td>{projEditId === p.id ? (
                        <select className="admin-inline-select" value={projForm.is_active ? 'active' : 'inactive'} onChange={e => setProjForm(f => ({ ...f, is_active: e.target.value === 'active' }))}>
                          <option value="active">Active</option>
                          <option value="inactive">Inactive</option>
                        </select>
                      ) : <span className={`admin-badge ${p.is_active ? 'admin-badge-approved' : 'admin-badge-rejected'}`}>{p.is_active ? 'Active' : 'Inactive'}</span>}</td>
                      <td className="admin-actions">
                        {projEditId === p.id ? (
                          <>
                            <button className="admin-btn-sm admin-btn-save" onClick={() => saveProjEdit(p.id)}>Save</button>
                            <button className="admin-btn-sm admin-btn-cancel" onClick={() => setProjEditId(null)}>Cancel</button>
                          </>
                        ) : (
                          <>
                            <button className="admin-btn-icon" title="Edit" onClick={() => startProjEdit(p)}>
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                            </button>
                            <button className="admin-btn-icon admin-btn-danger" title="Delete" onClick={() => deleteProjById(p.id)}>
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {projects.length === 0 && !projAdding && <div className="admin-empty">No customer projects. Add one to get started.</div>}
            </div>
          )}
        </>
      )}

      {tsTab === 'timeline' && (
        <ProjectTimeline projects={projects} loading={projLoading} fyStartMonth={selectedCompany?.fy_start_month || 4} />
      )}

      {tsTab === 'reports' && (
        <TimesheetReports
          companyId={selectedCompanyId}
          period={monitoringPeriod}
          fyStartMonth={selectedCompany?.fy_start_month || 4}
        />
      )}

      {tsTab === 'checkin' && (
        <div>
          <CheckInSettingsPanel source="timesheets" />
          <CheckInDashboardPanel source="timesheets" />
        </div>
      )}
    </div>
  )
}

/* ─── Reports ─── */

function TimesheetReports({ companyId, period, fyStartMonth }: { companyId: string; period: 'weekly' | 'monthly'; fyStartMonth: number }) {
  const [reportTab, setReportTab] = useState<'employee_time' | 'metrics'>('employee_time')

  return (
    <div style={{ paddingTop: 8 }}>
      <div className="admin-tabs" style={{ marginBottom: 12 }}>
        <button className={`admin-tab ${reportTab === 'employee_time' ? 'admin-tab-active' : ''}`} onClick={() => setReportTab('employee_time')}>Employee Time Report</button>
        <button className={`admin-tab ${reportTab === 'metrics' ? 'admin-tab-active' : ''}`} onClick={() => setReportTab('metrics')}>Metrics</button>
      </div>

      {reportTab === 'employee_time' && <EmployeeTimeReport companyId={companyId} period={period} />}
      {reportTab === 'metrics' && <MetricsReport companyId={companyId} fyStartMonth={fyStartMonth} />}
    </div>
  )
}

/* ─── Employee Time Report (combined Not Submitted + Missing Time + Check-in) ─── */

interface EmployeeTimeRow {
  emp: ReportEmployee
  contracted: number
  submitted: number
  shortfall: number
  checkinHours: number
  hasSubmitted: boolean
}

function EmployeeTimeReport({ companyId, period }: { companyId: string; period: 'weekly' | 'monthly' }) {
  const [offset, setOffset] = useState(0)
  const [rows, setRows] = useState<EmployeeTimeRow[]>([])
  const [loading, setLoading] = useState(true)
  const [reportsPage, setReportsPage] = useState(1)
  const [filterView, setFilterView] = useState<'all' | 'not_submitted' | 'shortfall'>('all')

  const range = period === 'weekly' ? getWeekRange(offset) : getMonthRange(offset)

  useEffect(() => {
    loadReport()
  }, [companyId, offset, period])

  useEffect(() => { setReportsPage(1) }, [companyId, offset, period, filterView])

  async function loadReport() {
    setLoading(true)
    const [empRes, tsRes, ciRes] = await Promise.all([
      supabase.from('employees').select('id, first_name, last_name, department, weekly_hours, working_pattern, is_active').eq('company_id', companyId).eq('is_active', true).order('last_name'),
      supabase.from('timesheets').select('employee_id, hours').eq('company_id', companyId).gte('date', range.start).lte('date', range.end),
      supabase.from('checkin_records').select('employee_id, check_in_at, check_out_at, status').eq('company_id', companyId).gte('check_in_at', range.start + 'T00:00:00').lte('check_in_at', range.end + 'T23:59:59'),
    ])
    const emps = (empRes.data as ReportEmployee[]) || []
    const hoursByEmp: Record<string, number> = {}
    ;(tsRes.data || []).forEach((t: any) => {
      hoursByEmp[t.employee_id] = (hoursByEmp[t.employee_id] || 0) + Number(t.hours)
    })

    const checkinByEmp: Record<string, number> = {}
    ;(ciRes.data || []).forEach((c: any) => {
      if (!c.check_out_at) return
      const mins = (new Date(c.check_out_at).getTime() - new Date(c.check_in_at).getTime()) / 60000
      checkinByEmp[c.employee_id] = (checkinByEmp[c.employee_id] || 0) + mins / 60
    })

    const workingDays = getWorkingDaysInRange(range.start, range.end)
    const allRows = emps.map(emp => {
      const weeklyHrs = emp.weekly_hours || 37.5
      const contracted = period === 'monthly' ? (weeklyHrs / 5) * workingDays : weeklyHrs
      const submitted = hoursByEmp[emp.id] || 0
      const shortfall = Math.max(0, contracted - submitted)
      const checkinHours = checkinByEmp[emp.id] || 0
      const hasSubmitted = submitted > 0
      return { emp, contracted, submitted, shortfall, checkinHours, hasSubmitted }
    })

    setRows(allRows)
    setLoading(false)
  }

  const filteredRows = rows.filter(r => {
    if (filterView === 'not_submitted') return !r.hasSubmitted
    if (filterView === 'shortfall') return r.shortfall > 0
    return true
  })

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE))
  const paginated = filteredRows.slice((reportsPage - 1) * PAGE_SIZE, reportsPage * PAGE_SIZE)

  const notSubmittedCount = rows.filter(r => !r.hasSubmitted).length
  const shortfallCount = rows.filter(r => r.shortfall > 0).length

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <button className="admin-btn-icon" onClick={() => setOffset(o => o - 1)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <span style={{ fontSize: 14, fontWeight: 600, minWidth: 200, textAlign: 'center' }}>{range.label}</span>
        <button className="admin-btn-icon" onClick={() => setOffset(o => o + 1)} disabled={offset >= 0}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
        <button className="admin-btn-sm admin-btn-cancel" onClick={() => setOffset(0)} style={{ marginLeft: 4 }}>Current</button>
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
          <button className={`admin-btn-sm ${filterView === 'all' ? 'admin-btn-save' : 'admin-btn-cancel'}`} onClick={() => setFilterView('all')}>
            All ({rows.length})
          </button>
          <button className={`admin-btn-sm ${filterView === 'not_submitted' ? 'admin-btn-save' : 'admin-btn-cancel'}`} onClick={() => setFilterView('not_submitted')}>
            Not Submitted ({notSubmittedCount})
          </button>
          <button className={`admin-btn-sm ${filterView === 'shortfall' ? 'admin-btn-save' : 'admin-btn-cancel'}`} onClick={() => setFilterView('shortfall')}>
            Shortfall ({shortfallCount})
          </button>
        </div>
      </div>

      {loading ? <div className="admin-loading">Loading...</div> : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Department</th>
                <th>Contracted</th>
                <th>Submitted</th>
                <th>Shortfall</th>
                <th>Check-in Time</th>
                <th>Pattern</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map(({ emp, contracted, submitted, shortfall, checkinHours, hasSubmitted }) => (
                <tr key={emp.id}>
                  <td>
                    <strong>{emp.first_name} {emp.last_name}</strong>
                    {!hasSubmitted && <span style={{ display: 'inline-block', marginLeft: 6, fontSize: 10, padding: '1px 6px', borderRadius: 4, background: '#fee2e2', color: '#dc2626', fontWeight: 600 }}>Not submitted</span>}
                  </td>
                  <td>{emp.department || '—'}</td>
                  <td>{contracted.toFixed(1)}h</td>
                  <td>{submitted.toFixed(1)}h</td>
                  <td style={{ color: shortfall > 0 ? '#dc2626' : 'var(--text)', fontWeight: shortfall > 0 ? 600 : 400 }}>
                    {shortfall > 0 ? `${shortfall.toFixed(1)}h` : '—'}
                  </td>
                  <td style={{ color: checkinHours > 0 ? '#16a34a' : 'var(--text-muted, #888)' }}>
                    {checkinHours > 0 ? `${checkinHours.toFixed(1)}h` : '—'}
                  </td>
                  <td>{emp.working_pattern || 'Full-time'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredRows.length === 0 && <div className="admin-empty">
            {filterView === 'not_submitted' ? 'All employees have submitted time for this period' :
             filterView === 'shortfall' ? 'All employees have met their contracted hours' :
             'No employees found'}
          </div>}
          <p style={{ fontSize: 12, color: 'var(--text-muted, #888)', marginTop: 8 }}>
            {notSubmittedCount} of {rows.length} not submitted &middot; {shortfallCount} with shortfall
          </p>
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 12 }}>
              <button className="admin-action-btn" disabled={reportsPage <= 1} onClick={() => setReportsPage(p => p - 1)}>Prev</button>
              <span style={{ fontSize: 13 }}>Page {reportsPage} of {totalPages}</span>
              <button className="admin-action-btn" disabled={reportsPage >= totalPages} onClick={() => setReportsPage(p => p + 1)}>Next</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ─── Report 2: Metrics ─── */

function MetricsReport({ companyId, fyStartMonth }: { companyId: string; fyStartMonth: number }) {
  const [loading, setLoading] = useState(true)
  const [employees, setEmployees] = useState<ReportEmployee[]>([])
  const [allTimesheets, setAllTimesheets] = useState<{ employee_id: string; date: string; hours: number; project_id: string | null }[]>([])

  const fyMonths = useMemo(() => getFYMonths(fyStartMonth), [fyStartMonth])
  const fyRange = useMemo(() => getFYRange(fyStartMonth), [fyStartMonth])

  useEffect(() => {
    loadMetrics()
  }, [companyId, fyStartMonth])

  async function loadMetrics() {
    setLoading(true)
    const fyStart = localDateStr(fyRange.startDate)
    const fyEnd = localDateStr(fyRange.endDate)
    const [empRes, tsRes] = await Promise.all([
      supabase.from('employees').select('id, first_name, last_name, department, weekly_hours, working_pattern, is_active').eq('company_id', companyId).eq('is_active', true),
      supabase.from('timesheets').select('employee_id, date, hours, project_id').eq('company_id', companyId).gte('date', fyStart).lte('date', fyEnd),
    ])
    setEmployees((empRes.data as ReportEmployee[]) || [])
    setAllTimesheets((tsRes.data || []) as any[])
    setLoading(false)
  }

  const monthData = useMemo(() => {
    return fyMonths.map(({ year, month, label }) => {
      const monthStart = new Date(year, month, 1)
      const monthEnd = new Date(year, month + 1, 0)
      const startStr = localDateStr(monthStart)
      const endStr = localDateStr(monthEnd)

      const monthTs = allTimesheets.filter(t => t.date >= startStr && t.date <= endStr)

      const submittedEmployees = new Set<string>()
      let totalBooked = 0
      const projectSet = new Set<string>()
      let fullTimeContracted = 0
      let partTimeBooked = 0

      monthTs.forEach(t => {
        submittedEmployees.add(t.employee_id)
        totalBooked += Number(t.hours)
        if (t.project_id) projectSet.add(t.project_id)
      })

      const workingDays = getWorkingDaysInRange(startStr, endStr)

      employees.forEach(emp => {
        const weeklyHrs = emp.weekly_hours || 37.5
        const monthlyHrs = (weeklyHrs / 5) * workingDays
        const pattern = (emp.working_pattern || 'Full-time').toLowerCase()
        if (pattern === 'full-time') {
          fullTimeContracted += monthlyHrs
        } else {
          const empTs = monthTs.filter(t => t.employee_id === emp.id)
          empTs.forEach(t => { partTimeBooked += Number(t.hours) })
        }
      })

      return {
        label,
        submissions: submittedEmployees.size,
        totalBooked,
        fullTimeContracted,
        partTimeBooked,
        projectCount: projectSet.size,
      }
    })
  }, [fyMonths, allTimesheets, employees])

  if (loading) return <div className="admin-loading">Loading...</div>

  const fyLabel = `${MONTH_NAMES_FULL[(fyStartMonth - 1) % 12]} ${fyRange.startYear} – ${MONTH_NAMES_FULL[(fyStartMonth - 2 + 12) % 12]} ${fyRange.startYear + 1}`

  return (
    <div>
      <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>Financial Year: {fyLabel}</h3>
      <p style={{ fontSize: 12, color: 'var(--text-muted, #888)', marginBottom: 12 }}>
        Monthly overview of timesheet submissions across the financial year. An employee counts as 1 submission if they have 1 or more entries in a month.
      </p>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Month</th>
              <th>Submissions</th>
              <th>Total Booked</th>
              <th>FT Contracted</th>
              <th>FT Utilisation</th>
              <th>PT/Contract Booked</th>
              <th>Projects</th>
            </tr>
          </thead>
          <tbody>
            {monthData.map((m, i) => {
              const util = m.fullTimeContracted > 0 ? (m.totalBooked / m.fullTimeContracted * 100) : 0
              const utilColor = util >= 90 ? '#16a34a' : util >= 70 ? '#d97706' : '#dc2626'
              return (
                <tr key={i}>
                  <td><strong>{m.label}</strong></td>
                  <td>{m.submissions} / {employees.length}</td>
                  <td>{m.totalBooked.toFixed(1)}h</td>
                  <td>{m.fullTimeContracted.toFixed(0)}h</td>
                  <td>
                    <span style={{ color: m.totalBooked > 0 ? utilColor : 'var(--text-muted, #888)', fontWeight: 600 }}>
                      {m.totalBooked > 0 ? `${util.toFixed(0)}%` : '—'}
                    </span>
                  </td>
                  <td>{m.partTimeBooked > 0 ? `${m.partTimeBooked.toFixed(1)}h` : '—'}</td>
                  <td>{m.projectCount || '—'}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr style={{ fontWeight: 700 }}>
              <td>Total</td>
              <td>—</td>
              <td>{monthData.reduce((s, m) => s + m.totalBooked, 0).toFixed(1)}h</td>
              <td>{monthData.reduce((s, m) => s + m.fullTimeContracted, 0).toFixed(0)}h</td>
              <td>
                {(() => {
                  const totalBooked = monthData.reduce((s, m) => s + m.totalBooked, 0)
                  const totalContracted = monthData.reduce((s, m) => s + m.fullTimeContracted, 0)
                  const util = totalContracted > 0 ? (totalBooked / totalContracted * 100) : 0
                  return totalBooked > 0 ? `${util.toFixed(0)}%` : '—'
                })()}
              </td>
              <td>{monthData.reduce((s, m) => s + m.partTimeBooked, 0).toFixed(1)}h</td>
              <td>—</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

/* ─── Project Timeline ─── */

function ProjectTimeline({ projects, loading, fyStartMonth }: { projects: CustomerProject[]; loading: boolean; fyStartMonth: number }) {
  const { startDate: fyStart, endDate: fyEnd, startYear: fyStartYear } = getFYRange(fyStartMonth)
  const fyMonths = getFYMonths(fyStartMonth)
  const fyRange = fyEnd.getTime() - fyStart.getTime()

  function getBarStyle(p: CustomerProject): { left: string; width: string } {
    const start = new Date(p.start_date + 'T00:00:00')
    const end = p.end_date ? new Date(p.end_date + 'T00:00:00') : fyEnd
    const clampedStart = start < fyStart ? fyStart : start
    const clampedEnd = end > fyEnd ? fyEnd : end
    if (clampedStart >= clampedEnd) return { left: '0%', width: '0%' }
    const leftPct = ((clampedStart.getTime() - fyStart.getTime()) / fyRange) * 100
    const widthPct = ((clampedEnd.getTime() - clampedStart.getTime()) / fyRange) * 100
    return { left: `${Math.max(0, leftPct)}%`, width: `${Math.min(100 - leftPct, widthPct)}%` }
  }

  if (loading) return <div className="admin-loading">Loading...</div>
  if (projects.length === 0) return <div className="admin-empty">No projects to display</div>

  return (
    <div style={{ padding: '16px 0' }}>
      <h3 style={{ margin: '0 0 16px', fontSize: 15 }}>
        Financial Year {MONTH_NAMES_FULL[(fyStartMonth - 1) % 12]} {fyStartYear} — {MONTH_NAMES_FULL[(fyStartMonth - 2 + 12) % 12]} {fyStartYear + 1}
      </h3>

      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 700 }}>
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border, #e5e7eb)', marginBottom: 4 }}>
            <div style={{ width: 180, flexShrink: 0, padding: '6px 8px', fontWeight: 700, fontSize: 12, color: 'var(--text-muted)' }}>Project</div>
            <div style={{ flex: 1, display: 'flex' }}>
              {fyMonths.map((m, i) => (
                <div key={i} style={{
                  flex: 1, textAlign: 'center', fontSize: 11, fontWeight: 600,
                  color: 'var(--text-muted)', padding: '6px 0',
                  borderLeft: '1px solid var(--border, #e5e7eb)',
                }}>
                  {MONTH_NAMES_CAL[m.month].slice(0, 3)}
                </div>
              ))}
            </div>
          </div>

          {projects.map((p, idx) => {
            const bar = getBarStyle(p)
            const color = BAR_COLORS[idx % BAR_COLORS.length]
            return (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', minHeight: 36, borderBottom: '1px solid var(--border, #f0f0f0)' }}>
                <div style={{ width: 180, flexShrink: 0, padding: '6px 8px', fontSize: 12 }}>
                  <strong>{p.name}</strong>
                  <br /><span style={{ opacity: 0.6, fontSize: 11 }}>{p.customer_name}</span>
                </div>
                <div style={{ flex: 1, position: 'relative', height: 24 }}>
                  {fyMonths.map((_, i) => (
                    <div key={i} style={{
                      position: 'absolute', top: 0, bottom: 0,
                      left: `${(i / 12) * 100}%`, width: `${100 / 12}%`,
                      borderLeft: '1px solid var(--border, #f0f0f0)',
                    }} />
                  ))}
                  <div style={{
                    position: 'absolute', top: 4, height: 16,
                    left: bar.left, width: bar.width,
                    background: color, borderRadius: 4, opacity: p.is_active ? 1 : 0.4,
                    minWidth: bar.width !== '0%' ? 4 : 0,
                  }} title={`${p.customer_name} — ${p.name}: ${formatDateUK(p.start_date)} → ${p.end_date ? formatDateUK(p.end_date) : 'Ongoing'}`} />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', marginTop: 16, fontSize: 12 }}>
        {projects.map((p, idx) => (
          <span key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: BAR_COLORS[idx % BAR_COLORS.length], display: 'inline-block', opacity: p.is_active ? 1 : 0.4 }} />
            {p.customer_name} — {p.name}
          </span>
        ))}
      </div>
    </div>
  )
}
