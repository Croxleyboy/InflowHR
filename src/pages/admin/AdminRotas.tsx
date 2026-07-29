import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAdminCompany } from '../../context/AdminCompanyContext'

interface Rota {
  id: string
  company_id: string
  name: string
  start_date: string
  end_date: string
  department: string | null
  status: string
  created_at: string
}

interface ShiftAssignment {
  id: string
  company_id: string
  rota_id: string
  shift_template_id: string
  employee_id: string
  date: string
  notes: string | null
}

interface Employee {
  id: string
  first_name: string
  last_name: string
}

interface ShiftTemplate {
  id: string
  name: string
  colour: string
  start_time: string
  end_time: string
}

interface LeaveConflict {
  employee_id: string
  start_date: string
  end_date: string
}

const EMPTY_ROTA = { name: '', start_date: '', end_date: '', department: '', status: 'draft' }

function getMonday(d: Date): Date {
  const dt = new Date(d)
  const day = dt.getDay()
  const diff = dt.getDate() - day + (day === 0 ? -6 : 1)
  dt.setDate(diff)
  dt.setHours(0, 0, 0, 0)
  return dt
}

function addDays(d: Date, n: number): Date {
  const dt = new Date(d)
  dt.setDate(dt.getDate() + n)
  return dt
}

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0]
}

function isDateInRange(date: string, start: string, end: string): boolean {
  return date >= start && date <= end
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default function AdminRotas() {
  const { selectedCompanyId } = useAdminCompany()
  const [rotas, setRotas] = useState<Rota[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState({ ...EMPTY_ROTA })
  const [editingRotaId, setEditingRotaId] = useState<string | null>(null)

  // Grid state
  const [selectedRota, setSelectedRota] = useState<Rota | null>(null)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [shiftTemplates, setShiftTemplates] = useState<ShiftTemplate[]>([])
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([])
  const [leaveConflicts, setLeaveConflicts] = useState<LeaveConflict[]>([])
  const [weekStart, setWeekStart] = useState<Date>(getMonday(new Date()))
  const [activeCell, setActiveCell] = useState<{ employeeId: string; date: string } | null>(null)
  const [editFormRota, setEditFormRota] = useState<Record<string, any>>({})

  useEffect(() => { if (selectedCompanyId) loadRotas() }, [selectedCompanyId])

  async function loadRotas() {
    setLoading(true)
    const { data } = await supabase
      .from('rotas')
      .select('*')
      .eq('company_id', selectedCompanyId)
      .order('created_at', { ascending: false })
    setRotas((data as Rota[]) || [])
    setLoading(false)
  }

  async function createRota() {
    if (!addForm.name.trim() || !addForm.start_date || !addForm.end_date) return
    await supabase.from('rotas').insert({
      company_id: selectedCompanyId,
      name: addForm.name.trim(),
      start_date: addForm.start_date,
      end_date: addForm.end_date,
      department: addForm.department || null,
      status: addForm.status,
    })
    setAddForm({ ...EMPTY_ROTA })
    setShowAdd(false)
    loadRotas()
  }

  function startEditRota(r: Rota) {
    setEditingRotaId(r.id)
    setEditFormRota({
      name: r.name,
      start_date: r.start_date,
      end_date: r.end_date,
      department: r.department || '',
      status: r.status,
    })
  }

  async function saveEditRota(id: string) {
    await supabase.from('rotas').update({
      name: editFormRota.name,
      start_date: editFormRota.start_date,
      end_date: editFormRota.end_date,
      department: editFormRota.department || null,
      status: editFormRota.status,
    }).eq('id', id)
    setEditingRotaId(null)
    loadRotas()
  }

  async function deleteRota(id: string) {
    if (!confirm('Delete this rota and all its assignments?')) return
    await supabase.from('shift_assignments').delete().eq('rota_id', id)
    await supabase.from('rotas').delete().eq('id', id)
    setRotas(prev => prev.filter(r => r.id !== id))
  }

  async function publishRota(id: string) {
    if (!confirm('Publish this rota? Employees will be notified.')) return
    await supabase.from('rotas').update({ status: 'published' }).eq('id', id)
    loadRotas()
    if (selectedRota && selectedRota.id === id) {
      setSelectedRota(prev => prev ? { ...prev, status: 'published' } : null)
    }
  }

  // --- Grid data loading ---
  const loadGridData = useCallback(async (rota: Rota) => {
    const [empRes, tmplRes, assignRes, leaveRes] = await Promise.all([
      supabase.from('employees').select('id, first_name, last_name').eq('company_id', selectedCompanyId).eq('is_active', true).order('first_name'),
      supabase.from('shift_templates').select('id, name, colour, start_time, end_time').eq('company_id', selectedCompanyId).eq('is_active', true),
      supabase.from('shift_assignments').select('*').eq('rota_id', rota.id),
      supabase.from('leave_requests').select('employee_id, start_date, end_date').eq('company_id', selectedCompanyId).in('status', ['pending', 'approved']),
    ])
    setEmployees((empRes.data as Employee[]) || [])
    setShiftTemplates((tmplRes.data as ShiftTemplate[]) || [])
    setAssignments((assignRes.data as ShiftAssignment[]) || [])
    setLeaveConflicts((leaveRes.data as LeaveConflict[]) || [])
  }, [selectedCompanyId])

  function openRota(rota: Rota) {
    setSelectedRota(rota)
    setWeekStart(getMonday(new Date(rota.start_date)))
    loadGridData(rota)
  }

  function backToList() {
    setSelectedRota(null)
    setActiveCell(null)
    loadRotas()
  }

  // Week days for the grid
  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(weekStart, i)
      return { date: formatDate(d), label: DAY_LABELS[i], dayNum: d.getDate(), month: d.toLocaleDateString('en-GB', { month: 'short' }) }
    })
  }, [weekStart])

  // Check if employee has leave on date
  function hasLeave(employeeId: string, date: string): boolean {
    return leaveConflicts.some(l => l.employee_id === employeeId && isDateInRange(date, l.start_date, l.end_date))
  }

  // Get assignment for employee + date
  function getAssignment(employeeId: string, date: string): ShiftAssignment | undefined {
    return assignments.find(a => a.employee_id === employeeId && a.date === date)
  }

  // Get shift template by id
  function getTemplate(id: string): ShiftTemplate | undefined {
    return shiftTemplates.find(t => t.id === id)
  }

  async function assignShift(employeeId: string, date: string, templateId: string) {
    const existing = getAssignment(employeeId, date)
    if (existing) {
      await supabase.from('shift_assignments').update({ shift_template_id: templateId }).eq('id', existing.id)
    } else {
      await supabase.from('shift_assignments').insert({
        company_id: selectedCompanyId,
        rota_id: selectedRota!.id,
        shift_template_id: templateId,
        employee_id: employeeId,
        date,
      })
    }
    setActiveCell(null)
    // Reload assignments
    const { data } = await supabase.from('shift_assignments').select('*').eq('rota_id', selectedRota!.id)
    setAssignments((data as ShiftAssignment[]) || [])
  }

  async function removeAssignment(employeeId: string, date: string) {
    const existing = getAssignment(employeeId, date)
    if (!existing) return
    await supabase.from('shift_assignments').delete().eq('id', existing.id)
    setAssignments(prev => prev.filter(a => a.id !== existing.id))
    setActiveCell(null)
  }

  // Assignment count per rota
  const assignmentCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    // We don't preload all assignment counts; show '—' until grid is open
    return counts
  }, [])

  const stats = useMemo(() => ({
    total: rotas.length,
    draft: rotas.filter(r => r.status === 'draft').length,
    published: rotas.filter(r => r.status === 'published').length,
  }), [rotas])

  // --- ROTA LIST VIEW ---
  if (!selectedRota) {
    return (
      <div className="admin-section">
        <div className="admin-page-header">
          <h2>Rota Management</h2>
          <p>{rotas.length} rotas</p>
        </div>

        <div className="admin-mini-stats">
          <div className="admin-mini-stat"><span className="admin-mini-value">{stats.total}</span><span>Total</span></div>
          <div className="admin-mini-stat"><span className="admin-mini-value" style={{color:'#ff9800'}}>{stats.draft}</span><span>Draft</span></div>
          <div className="admin-mini-stat"><span className="admin-mini-value" style={{color:'#43a047'}}>{stats.published}</span><span>Published</span></div>
        </div>

        <div className="admin-filters">
          <button className="admin-btn-sm admin-btn-save" onClick={() => setShowAdd(!showAdd)}>
            {showAdd ? 'Cancel' : '+ Create Rota'}
          </button>
        </div>

        {showAdd && (
          <div className="admin-table-wrap" style={{ marginBottom: 16, padding: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Name</label>
                <input className="admin-inline-input" value={addForm.name} onChange={e => setAddForm(p => ({...p, name: e.target.value}))} placeholder="e.g. Week 31 Rota" />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Start Date</label>
                <input type="date" className="admin-inline-input" value={addForm.start_date} onChange={e => setAddForm(p => ({...p, start_date: e.target.value}))} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>End Date</label>
                <input type="date" className="admin-inline-input" value={addForm.end_date} onChange={e => setAddForm(p => ({...p, end_date: e.target.value}))} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Department</label>
                <input className="admin-inline-input" value={addForm.department} onChange={e => setAddForm(p => ({...p, department: e.target.value}))} placeholder="Optional" />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Status</label>
                <select className="admin-inline-select" value={addForm.status} onChange={e => setAddForm(p => ({...p, status: e.target.value}))}>
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                </select>
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <button className="admin-btn-sm admin-btn-save" onClick={createRota}>Create Rota</button>
            </div>
          </div>
        )}

        {loading ? <div className="admin-loading">Loading...</div> : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr><th>Name</th><th>Date Range</th><th>Department</th><th>Status</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {rotas.map(r => (
                  <tr key={r.id}>
                    <td>{editingRotaId === r.id ? <input className="admin-inline-input" value={editFormRota.name} onChange={e => setEditFormRota(p => ({...p, name: e.target.value}))} /> : r.name}</td>
                    <td>{editingRotaId === r.id ? (
                      <div className="admin-date-inputs">
                        <input type="date" className="admin-inline-input" value={editFormRota.start_date} onChange={e => setEditFormRota(p => ({...p, start_date: e.target.value}))} />
                        <input type="date" className="admin-inline-input" value={editFormRota.end_date} onChange={e => setEditFormRota(p => ({...p, end_date: e.target.value}))} />
                      </div>
                    ) : `${new Date(r.start_date).toLocaleDateString('en-GB')} – ${new Date(r.end_date).toLocaleDateString('en-GB')}`}</td>
                    <td>{editingRotaId === r.id ? <input className="admin-inline-input" value={editFormRota.department} onChange={e => setEditFormRota(p => ({...p, department: e.target.value}))} /> : (r.department || '—')}</td>
                    <td>{editingRotaId === r.id ? (
                      <select className="admin-inline-select" value={editFormRota.status} onChange={e => setEditFormRota(p => ({...p, status: e.target.value}))}>
                        <option value="draft">Draft</option>
                        <option value="published">Published</option>
                      </select>
                    ) : <span className={`admin-badge ${r.status === 'published' ? 'admin-badge-approved' : 'admin-badge-pending'}`}>{r.status}</span>}</td>
                    <td className="admin-actions">
                      {editingRotaId === r.id ? (
                        <>
                          <button className="admin-btn-sm admin-btn-save" onClick={() => saveEditRota(r.id)}>Save</button>
                          <button className="admin-btn-sm admin-btn-cancel" onClick={() => setEditingRotaId(null)}>Cancel</button>
                        </>
                      ) : (
                        <>
                          <button className="admin-btn-icon" title="Edit Grid" onClick={() => openRota(r)}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
                          </button>
                          <button className="admin-btn-icon" title="Edit Details" onClick={() => startEditRota(r)}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                          </button>
                          {r.status === 'draft' && (
                            <button className="admin-btn-icon" title="Publish" onClick={() => publishRota(r.id)} style={{ color: '#43a047' }}>
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>
                            </button>
                          )}
                          <button className="admin-btn-icon admin-btn-danger" title="Delete" onClick={() => deleteRota(r.id)}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rotas.length === 0 && <div className="admin-empty">No rotas found</div>}
          </div>
        )}
      </div>
    )
  }

  // --- ROTA GRID VIEW ---
  return (
    <div className="admin-section">
      <div className="admin-page-header">
        <button className="admin-btn-sm admin-btn-cancel" onClick={backToList} style={{ marginRight: 12 }}>&larr; Back</button>
        <div>
          <h2 style={{ display: 'inline' }}>{selectedRota.name}</h2>
          <span style={{ marginLeft: 12 }} className={`admin-badge ${selectedRota.status === 'published' ? 'admin-badge-approved' : 'admin-badge-pending'}`}>{selectedRota.status}</span>
        </div>
        <p>{new Date(selectedRota.start_date).toLocaleDateString('en-GB')} – {new Date(selectedRota.end_date).toLocaleDateString('en-GB')}{selectedRota.department ? ` · ${selectedRota.department}` : ''}</p>
      </div>

      <div className="rota-week-nav">
        <button onClick={() => setWeekStart(addDays(weekStart, -7))}>&larr; Prev Week</button>
        <span>{weekDays[0].dayNum} {weekDays[0].month} – {weekDays[6].dayNum} {weekDays[6].month}</span>
        <button onClick={() => setWeekStart(addDays(weekStart, 7))}>Next Week &rarr;</button>
      </div>

      <div className="rota-grid-wrap">
        <table className="rota-grid">
          <thead>
            <tr>
              <th>Employee</th>
              {weekDays.map(d => (
                <th key={d.date}>{d.label}<br /><small>{d.dayNum}</small></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {employees.map(emp => (
              <tr key={emp.id}>
                <td>{emp.first_name} {emp.last_name}</td>
                {weekDays.map(d => {
                  const assignment = getAssignment(emp.id, d.date)
                  const template = assignment ? getTemplate(assignment.shift_template_id) : undefined
                  const onLeave = hasLeave(emp.id, d.date)
                  const isActive = activeCell?.employeeId === emp.id && activeCell?.date === d.date

                  return (
                    <td key={d.date} className={onLeave && assignment ? 'rota-cell-conflict' : ''} style={{ position: 'relative' }}>
                      {assignment && template ? (
                        <span
                          className="rota-cell-shift"
                          style={{ backgroundColor: template.colour }}
                          onClick={() => setActiveCell(isActive ? null : { employeeId: emp.id, date: d.date })}
                        >
                          {template.name}
                        </span>
                      ) : (
                        <span
                          className="rota-cell-empty"
                          style={{ display: 'block', width: '100%', height: '100%' }}
                          onClick={() => setActiveCell(isActive ? null : { employeeId: emp.id, date: d.date })}
                        >
                          {onLeave ? '🏖️' : ''}
                        </span>
                      )}

                      {isActive && (
                        <div className="rota-cell-dropdown">
                          {shiftTemplates.map(t => (
                            <button key={t.id} onClick={() => assignShift(emp.id, d.date, t.id)}>
                              <span className="admin-colour-swatch" style={{ backgroundColor: t.colour, marginRight: 6 }} />
                              {t.name} ({t.start_time}–{t.end_time})
                            </button>
                          ))}
                          {assignment && (
                            <button onClick={() => removeAssignment(emp.id, d.date)} style={{ color: '#e53935', borderTop: '1px solid #eee' }}>
                              Remove shift
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {employees.length === 0 && <div className="admin-empty">No active employees found</div>}
      </div>

      {selectedRota.status === 'draft' && (
        <div className="rota-publish-bar">
          <span style={{ fontSize: 13 }}>This rota is in draft. Publish to notify employees.</span>
          <button onClick={() => publishRota(selectedRota.id)}>Publish Rota</button>
        </div>
      )}
    </div>
  )
}
