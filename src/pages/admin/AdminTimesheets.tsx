import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { useToast } from '../../context/ToastContext'
import { formatDate } from '../../lib/formatters'

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
  employee: { first_name: string; last_name: string; email: string } | null
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

const STATUS_OPTIONS = ['draft', 'pending', 'approved', 'rejected']
const MONTH_NAMES = ['Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar']
const MONTH_NAMES_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December']

const BAR_COLORS = [
  '#5c6bc0','#26a69a','#ef5350','#ab47bc','#ffa726','#42a5f5',
  '#66bb6a','#ec407a','#7e57c2','#78909c','#8d6e63','#d4e157',
]

export default function AdminTimesheets() {
  const { selectedCompanyId } = useAdminCompany()
  const { showError, showSuccess } = useToast()
  const [tsTab, setTsTab] = useState<'entries' | 'projects' | 'timeline'>('entries')
  const [timesheets, setTimesheets] = useState<Timesheet[]>([])
  const [loading, setLoading] = useState(true)
  const [filterEmployee, setFilterEmployee] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<Record<string, any>>({})

  const [projects, setProjects] = useState<CustomerProject[]>([])
  const [projLoading, setProjLoading] = useState(false)
  const [projEditId, setProjEditId] = useState<string | null>(null)
  const [projForm, setProjForm] = useState({ name: '', customer_name: '', description: '', start_date: '', end_date: '', is_active: true })
  const [projAdding, setProjAdding] = useState(false)

  useEffect(() => { if (selectedCompanyId) { load(); loadProjects() } }, [selectedCompanyId])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('timesheets')
      .select('*, employee:employees!timesheets_employee_id_fkey(first_name, last_name, email), project:customer_projects!timesheets_project_id_fkey(name, customer_name)')
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
    setProjForm({ name: '', customer_name: '', description: '', start_date: new Date().toISOString().split('T')[0], end_date: '', is_active: true })
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

  const employees = useMemo(() => {
    const names = new Set<string>()
    timesheets.forEach(t => { if (t.employee) names.add(`${t.employee.first_name} ${t.employee.last_name}`) })
    return Array.from(names).sort()
  }, [timesheets])

  const filtered = useMemo(() => {
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

  const totalHours = filtered.reduce((s, t) => s + Number(t.hours), 0)

  return (
    <div className="admin-section">
      <div className="admin-page-header">
        <h2>Timesheet Management</h2>
        <p>{timesheets.length} total entries &middot; {totalHours.toFixed(1)} hours</p>
      </div>

      <div className="admin-tabs">
        <button className={`admin-tab ${tsTab === 'entries' ? 'admin-tab-active' : ''}`} onClick={() => setTsTab('entries')}>Entries</button>
        <button className={`admin-tab ${tsTab === 'projects' ? 'admin-tab-active' : ''}`} onClick={() => setTsTab('projects')}>Customer Projects</button>
        <button className={`admin-tab ${tsTab === 'timeline' ? 'admin-tab-active' : ''}`} onClick={() => setTsTab('timeline')}>Project Timeline</button>
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
                  {filtered.map(ts => (
                    <tr key={ts.id}>
                      <td>{ts.employee ? `${ts.employee.first_name} ${ts.employee.last_name}` : '—'}</td>
                      <td>{editingId === ts.id
                        ? <input type="date" className="admin-inline-input" value={editForm.date || ''} onChange={e => setEditForm(p => ({ ...p, date: e.target.value }))} />
                        : new Date(ts.date + 'T00:00:00').toLocaleDateString('en-GB')
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
              {filtered.length === 0 && <div className="admin-empty">No timesheets found</div>}
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
                      <td>{projEditId === p.id ? <input type="date" className="admin-inline-input" value={projForm.start_date} onChange={e => setProjForm(f => ({ ...f, start_date: e.target.value }))} /> : new Date(p.start_date + 'T00:00:00').toLocaleDateString('en-GB')}</td>
                      <td>{projEditId === p.id ? <input type="date" className="admin-inline-input" value={projForm.end_date} onChange={e => setProjForm(f => ({ ...f, end_date: e.target.value }))} /> : (p.end_date ? new Date(p.end_date + 'T00:00:00').toLocaleDateString('en-GB') : '—')}</td>
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
        <ProjectTimeline projects={projects} loading={projLoading} />
      )}
    </div>
  )
}

function ProjectTimeline({ projects, loading }: { projects: CustomerProject[]; loading: boolean }) {
  const now = new Date()
  const fyStartMonth = 3
  const fyStartYear = now.getMonth() >= fyStartMonth ? now.getFullYear() : now.getFullYear() - 1

  const fyMonths: { year: number; month: number; label: string }[] = []
  for (let i = 0; i < 12; i++) {
    const m = (fyStartMonth + i) % 12
    const y = fyStartYear + Math.floor((fyStartMonth + i) / 12)
    fyMonths.push({ year: y, month: m, label: MONTH_NAMES[i] })
  }

  const fyStart = new Date(fyStartYear, fyStartMonth, 1)
  const fyEnd = new Date(fyStartYear + 1, fyStartMonth, 0)
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
        Financial Year {MONTH_NAMES_FULL[fyStartMonth]} {fyStartYear} — {MONTH_NAMES_FULL[(fyStartMonth - 1 + 12) % 12]} {fyStartYear + 1}
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
                  {m.label}
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
                  }} title={`${p.customer_name} — ${p.name}: ${new Date(p.start_date).toLocaleDateString('en-GB')} → ${p.end_date ? new Date(p.end_date).toLocaleDateString('en-GB') : 'Ongoing'}`} />
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
