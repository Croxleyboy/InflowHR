import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useAdminCompany } from '../../context/AdminCompanyContext'

interface Timesheet {
  id: number
  location: string
  customer: string | null
  role: string
  date: string
  start_time: string
  end_time: string
  hours: number
  status: string
  created_at: string
  employee: { first_name: string; last_name: string } | null
}

const STATUS_OPTIONS = ['draft', 'pending', 'approved', 'rejected']

export default function AdminTimesheets() {
  const { selectedCompanyId } = useAdminCompany()
  const [timesheets, setTimesheets] = useState<Timesheet[]>([])
  const [loading, setLoading] = useState(true)
  const [filterEmployee, setFilterEmployee] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<Partial<Timesheet>>({})

  useEffect(() => { if (selectedCompanyId) load() }, [selectedCompanyId])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('timesheets')
      .select('*, employee:employees!timesheets_employee_id_fkey(first_name, last_name)')
      .eq('company_id', selectedCompanyId)
      .order('date', { ascending: false })
    setTimesheets((data as Timesheet[]) || [])
    setLoading(false)
  }

  function startEdit(ts: Timesheet) {
    setEditingId(ts.id)
    setEditForm({ location: ts.location, customer: ts.customer, role: ts.role, date: ts.date, start_time: ts.start_time, end_time: ts.end_time, status: ts.status })
  }

  async function saveEdit(id: number) {
    await supabase.from('timesheets').update({
      location: editForm.location,
      customer: editForm.customer || null,
      role: editForm.role,
      date: editForm.date,
      start_time: editForm.start_time,
      end_time: editForm.end_time,
      status: editForm.status,
    }).eq('id', id)
    setEditingId(null)
    load()
  }

  async function deleteTimesheet(id: number) {
    if (!confirm('Delete this timesheet entry?')) return
    await supabase.from('workflow_tracker').delete().eq('record_type', 'Timesheet').eq('approval_id', id)
    await supabase.from('timesheets').delete().eq('id', id)
    window.dispatchEvent(new Event('notifications-updated'))
    setTimesheets(prev => prev.filter(t => t.id !== id))
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
                <th>Location</th>
                <th>Role</th>
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
                  <td>{Number(ts.hours).toFixed(1)}</td>
                  <td>{editingId === ts.id
                    ? <input className="admin-inline-input" value={editForm.location || ''} onChange={e => setEditForm(p => ({ ...p, location: e.target.value }))} />
                    : ts.location
                  }</td>
                  <td>{editingId === ts.id
                    ? <input className="admin-inline-input" value={editForm.role || ''} onChange={e => setEditForm(p => ({ ...p, role: e.target.value }))} />
                    : ts.role
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
    </div>
  )
}
