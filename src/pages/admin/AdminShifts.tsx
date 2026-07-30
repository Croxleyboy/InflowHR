import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useAdminCompany } from '../../context/AdminCompanyContext'

interface ShiftTemplate {
  id: string
  company_id: string
  name: string
  start_time: string
  end_time: string
  break_minutes: number
  colour: string
  role_required: string | null
  department: string | null
  is_active: boolean
  created_at: string
}

const EMPTY_TEMPLATE = { name: '', start_time: '09:00', end_time: '17:00', break_minutes: 30, colour: '#4CAF50', role_required: '', department: '', is_active: true }

export default function AdminShifts() {
  const { selectedCompanyId } = useAdminCompany()
  const [templates, setTemplates] = useState<ShiftTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState({ ...EMPTY_TEMPLATE })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Record<string, any>>({})
  const [search, setSearch] = useState('')
  const [filterDept, setFilterDept] = useState('')

  useEffect(() => { if (selectedCompanyId) load() }, [selectedCompanyId])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('shift_templates')
      .select('*')
      .eq('company_id', selectedCompanyId)
      .order('name')
    setTemplates((data as ShiftTemplate[]) || [])
    setLoading(false)
  }

  async function addTemplate() {
    if (!addForm.name.trim()) return
    await supabase.from('shift_templates').insert({
      company_id: selectedCompanyId,
      name: addForm.name.trim(),
      start_time: addForm.start_time,
      end_time: addForm.end_time,
      break_minutes: addForm.break_minutes,
      colour: addForm.colour,
      role_required: addForm.role_required || null,
      department: addForm.department || null,
      is_active: addForm.is_active,
    })
    setAddForm({ ...EMPTY_TEMPLATE })
    setShowAdd(false)
    load()
  }

  function startEdit(t: ShiftTemplate) {
    setEditingId(t.id)
    setEditForm({
      name: t.name,
      start_time: t.start_time,
      end_time: t.end_time,
      break_minutes: t.break_minutes,
      colour: t.colour,
      role_required: t.role_required || '',
      department: t.department || '',
      is_active: t.is_active,
    })
  }

  async function saveEdit(id: string) {
    await supabase.from('shift_templates').update({
      name: editForm.name,
      start_time: editForm.start_time,
      end_time: editForm.end_time,
      break_minutes: editForm.break_minutes,
      colour: editForm.colour,
      role_required: editForm.role_required || null,
      department: editForm.department || null,
      is_active: editForm.is_active,
    }).eq('id', id)
    setEditingId(null)
    load()
  }

  async function deleteTemplate(id: string) {
    if (!confirm('Delete this shift template?')) return
    await supabase.from('shift_templates').delete().eq('id', id)
    setTemplates(prev => prev.filter(t => t.id !== id))
  }

  const departments = useMemo(() => {
    const depts = new Set<string>()
    templates.forEach(t => { if (t.department) depts.add(t.department) })
    return Array.from(depts).sort()
  }, [templates])

  const filtered = useMemo(() => {
    return templates.filter(t => {
      if (filterDept && t.department !== filterDept) return false
      if (search && !t.name.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
  }, [templates, filterDept, search])

  const stats = useMemo(() => ({
    total: templates.length,
    active: templates.filter(t => t.is_active).length,
    inactive: templates.filter(t => !t.is_active).length,
  }), [templates])

  return (
    <>
      <div className="admin-mini-stats">
        <div className="admin-mini-stat"><span className="admin-mini-value">{stats.total}</span><span>Total</span></div>
        <div className="admin-mini-stat"><span className="admin-mini-value" style={{color:'#43a047'}}>{stats.active}</span><span>Active</span></div>
        <div className="admin-mini-stat"><span className="admin-mini-value" style={{color:'#e53935'}}>{stats.inactive}</span><span>Inactive</span></div>
      </div>

      <div className="admin-filters">
        <input
          type="text"
          placeholder="Search by name..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="admin-select"
          style={{ minWidth: 180 }}
        />
        <select value={filterDept} onChange={e => setFilterDept(e.target.value)} className="admin-select">
          <option value="">All Departments</option>
          {departments.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <button className="admin-btn-sm admin-btn-save" onClick={() => setShowAdd(!showAdd)}>
          {showAdd ? 'Cancel' : '+ Add Template'}
        </button>
      </div>

      {showAdd && (
        <div className="admin-table-wrap" style={{ marginBottom: 16 }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th><th>Start</th><th>End</th><th>Break (mins)</th><th>Colour</th>
                <th className="admin-shift-hide-mobile">Role Required</th>
                <th className="admin-shift-hide-mobile">Department</th>
                <th>Active</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><input className="admin-inline-input" value={addForm.name} onChange={e => setAddForm(p => ({...p, name: e.target.value}))} placeholder="Shift name" /></td>
                <td><input type="time" className="admin-inline-input" value={addForm.start_time} onChange={e => setAddForm(p => ({...p, start_time: e.target.value}))} /></td>
                <td><input type="time" className="admin-inline-input" value={addForm.end_time} onChange={e => setAddForm(p => ({...p, end_time: e.target.value}))} /></td>
                <td><input type="number" className="admin-inline-input admin-inline-sm" value={addForm.break_minutes} onChange={e => setAddForm(p => ({...p, break_minutes: +e.target.value}))} /></td>
                <td><input type="color" value={addForm.colour} onChange={e => setAddForm(p => ({...p, colour: e.target.value}))} style={{ width: 32, height: 24, border: 'none', cursor: 'pointer' }} /></td>
                <td className="admin-shift-hide-mobile"><input className="admin-inline-input" value={addForm.role_required} onChange={e => setAddForm(p => ({...p, role_required: e.target.value}))} placeholder="Optional" /></td>
                <td className="admin-shift-hide-mobile"><input className="admin-inline-input" value={addForm.department} onChange={e => setAddForm(p => ({...p, department: e.target.value}))} placeholder="Optional" /></td>
                <td>
                  <input type="checkbox" checked={addForm.is_active} onChange={e => setAddForm(p => ({...p, is_active: e.target.checked}))} />
                </td>
                <td className="admin-actions">
                  <button className="admin-btn-sm admin-btn-save" onClick={addTemplate}>Save</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {loading ? <div className="admin-loading">Loading...</div> : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th><th>Start</th><th>End</th><th>Break (mins)</th><th>Colour</th>
                <th className="admin-shift-hide-mobile">Role Required</th>
                <th className="admin-shift-hide-mobile">Department</th>
                <th>Status</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(t => (
                <tr key={t.id}>
                  <td>{editingId === t.id ? <input className="admin-inline-input" value={editForm.name} onChange={e => setEditForm(p => ({...p, name: e.target.value}))} /> : t.name}</td>
                  <td>{editingId === t.id ? <input type="time" className="admin-inline-input" value={editForm.start_time} onChange={e => setEditForm(p => ({...p, start_time: e.target.value}))} /> : t.start_time}</td>
                  <td>{editingId === t.id ? <input type="time" className="admin-inline-input" value={editForm.end_time} onChange={e => setEditForm(p => ({...p, end_time: e.target.value}))} /> : t.end_time}</td>
                  <td>{editingId === t.id ? <input type="number" className="admin-inline-input admin-inline-sm" value={editForm.break_minutes} onChange={e => setEditForm(p => ({...p, break_minutes: +e.target.value}))} /> : t.break_minutes}</td>
                  <td>{editingId === t.id ? <input type="color" value={editForm.colour} onChange={e => setEditForm(p => ({...p, colour: e.target.value}))} style={{ width: 32, height: 24, border: 'none', cursor: 'pointer' }} /> : <span className="admin-colour-swatch" style={{ backgroundColor: t.colour }} />}</td>
                  <td className="admin-shift-hide-mobile">{editingId === t.id ? <input className="admin-inline-input" value={editForm.role_required} onChange={e => setEditForm(p => ({...p, role_required: e.target.value}))} /> : (t.role_required || '—')}</td>
                  <td className="admin-shift-hide-mobile">{editingId === t.id ? <input className="admin-inline-input" value={editForm.department} onChange={e => setEditForm(p => ({...p, department: e.target.value}))} /> : (t.department || '—')}</td>
                  <td>{editingId === t.id ? (
                    <input type="checkbox" checked={editForm.is_active} onChange={e => setEditForm(p => ({...p, is_active: e.target.checked}))} />
                  ) : <span className={`admin-badge ${t.is_active ? 'admin-badge-approved' : 'admin-badge-rejected'}`}>{t.is_active ? 'Active' : 'Inactive'}</span>}</td>
                  <td className="admin-actions">
                    {editingId === t.id ? (
                      <>
                        <button className="admin-btn-sm admin-btn-save" onClick={() => saveEdit(t.id)}>Save</button>
                        <button className="admin-btn-sm admin-btn-cancel" onClick={() => setEditingId(null)}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button className="admin-btn-icon" title="Edit" onClick={() => startEdit(t)}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                        <button className="admin-btn-icon admin-btn-danger" title="Delete" onClick={() => deleteTemplate(t.id)}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <div className="admin-empty">No shift templates found</div>}
        </div>
      )}
    </>
  )
}
