import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'

interface Employee {
  id: string
  employee_number: string
  first_name: string
  last_name: string
  email: string
  job_title: string | null
  department: string | null
  phone: string | null
  start_date: string
  is_active: boolean
  is_admin: boolean
  avatar_url: string | null
}

export default function AdminEmployees() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [filterDept, setFilterDept] = useState('')
  const [filterActive, setFilterActive] = useState('')
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Record<string, any>>({})
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [uploading, setUploading] = useState<string | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('employees').select('*').order('last_name')
    setEmployees((data as Employee[]) || [])
    setLoading(false)
  }

  function startEdit(emp: Employee) {
    setEditingId(emp.id)
    setEditForm({ first_name: emp.first_name, last_name: emp.last_name, email: emp.email, job_title: emp.job_title || '', department: emp.department || '', phone: emp.phone || '', is_active: emp.is_active, is_admin: emp.is_admin })
  }

  async function saveEdit(id: string) {
    await supabase.from('employees').update(editForm).eq('id', id)
    setEditingId(null)
    load()
  }

  async function deleteEmployee(id: string) {
    if (!confirm('Deactivate this employee? This will mark them as inactive.')) return
    await supabase.from('employees').update({ is_active: false }).eq('id', id)
    load()
  }

  async function uploadPhoto(emp: Employee, file: File) {
    setUploading(emp.id)
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
    const path = `${emp.id}.${ext}`
    const { error: uploadErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true })
    if (uploadErr) { alert('Upload failed: ' + uploadErr.message); setUploading(null); return }
    const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path)
    const avatarUrl = urlData.publicUrl + '?t=' + Date.now()
    const { error: empErr } = await supabase.from('employees').update({ avatar_url: avatarUrl }).eq('id', emp.id)
    if (empErr) console.error('Employee update failed:', empErr)
    const { error: onbErr } = await supabase.from('onboarding').update({ avatar_url: avatarUrl }).eq('user_email', emp.email)
    if (onbErr) console.error('Onboarding update failed:', onbErr)
    if (empErr && onbErr) alert('Photo uploaded but database update failed. Check RLS policies.')
    setUploading(null)
    load()
  }

  async function removePhoto(emp: Employee) {
    if (!confirm('Remove this employee photo?')) return
    await supabase.from('employees').update({ avatar_url: null }).eq('id', emp.id)
    await supabase.from('onboarding').update({ avatar_url: null }).eq('user_email', emp.email)
    load()
  }

  const departments = useMemo(() => {
    const depts = new Set<string>()
    employees.forEach(e => { if (e.department) depts.add(e.department) })
    return Array.from(depts).sort()
  }, [employees])

  const filtered = useMemo(() => {
    return employees.filter(e => {
      if (filterDept && e.department !== filterDept) return false
      if (filterActive === 'active' && !e.is_active) return false
      if (filterActive === 'inactive' && e.is_active) return false
      if (search) {
        const q = search.toLowerCase()
        if (!`${e.first_name} ${e.last_name} ${e.email} ${e.employee_number}`.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [employees, filterDept, filterActive, search])

  return (
    <div className="admin-section">
      <div className="admin-page-header">
        <h2>Employee Management</h2>
        <p>{employees.length} employees · {employees.filter(e => e.is_active).length} active</p>
      </div>

      <div className="admin-filters">
        <input placeholder="Search name, email, ID..." value={search} onChange={e => setSearch(e.target.value)} className="admin-input admin-search" />
        <select value={filterDept} onChange={e => setFilterDept(e.target.value)} className="admin-select">
          <option value="">All Departments</option>
          {departments.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={filterActive} onChange={e => setFilterActive(e.target.value)} className="admin-select">
          <option value="">All</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {loading ? <div className="admin-loading">Loading...</div> : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>ID</th><th>Name</th><th>Email</th><th>Department</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {filtered.map(emp => (
                <>
                  <tr key={emp.id} className={expandedId === emp.id ? 'admin-row-active' : ''}>
                    <td className="admin-td-mono">{emp.employee_number}</td>
                    <td>{editingId === emp.id ? (
                      <div className="admin-name-inputs">
                        <input className="admin-inline-input" value={editForm.first_name} onChange={e => setEditForm(f => ({...f, first_name: e.target.value}))} placeholder="First" />
                        <input className="admin-inline-input" value={editForm.last_name} onChange={e => setEditForm(f => ({...f, last_name: e.target.value}))} placeholder="Last" />
                      </div>
                    ) : `${emp.first_name} ${emp.last_name}`}</td>
                    <td>{editingId === emp.id ? <input className="admin-inline-input" value={editForm.email} onChange={e => setEditForm(f => ({...f, email: e.target.value}))} /> : emp.email}</td>
                    <td>{editingId === emp.id ? <input className="admin-inline-input" value={editForm.department} onChange={e => setEditForm(f => ({...f, department: e.target.value}))} /> : (emp.department || '—')}</td>
                    <td>{editingId === emp.id ? <input className="admin-inline-input" value={editForm.job_title} onChange={e => setEditForm(f => ({...f, job_title: e.target.value}))} /> : (emp.job_title || '—')}</td>
                    <td><span className={`admin-badge ${emp.is_active ? 'admin-badge-approved' : 'admin-badge-rejected'}`}>{emp.is_active ? 'Active' : 'Inactive'}</span></td>
                    <td className="admin-actions">
                      {editingId === emp.id ? (
                        <>
                          <button className="admin-btn-sm admin-btn-save" onClick={() => saveEdit(emp.id)}>Save</button>
                          <button className="admin-btn-sm admin-btn-cancel" onClick={() => setEditingId(null)}>Cancel</button>
                        </>
                      ) : (
                        <>
                          <button className="admin-btn-icon" onClick={() => setExpandedId(expandedId === emp.id ? null : emp.id)}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points={expandedId === emp.id ? "18 15 12 9 6 15" : "6 9 12 15 18 9"}/></svg>
                          </button>
                          <button className="admin-btn-icon" onClick={() => startEdit(emp)}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                          </button>
                          <button className="admin-btn-icon admin-btn-danger" onClick={() => deleteEmployee(emp.id)}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                  {expandedId === emp.id && (
                    <tr key={`exp-${emp.id}`} className="admin-expanded-row">
                      <td colSpan={7}>
                        <div className="admin-expanded-content" style={{display:'flex', gap:'20px', alignItems:'flex-start'}}>
                          <div className="admin-photo-section">
                            <div className="admin-photo-preview">
                              {emp.avatar_url ? (
                                <img src={emp.avatar_url} alt={`${emp.first_name} ${emp.last_name}`} className="admin-photo-img" />
                              ) : (
                                <div className="admin-photo-placeholder">
                                  <span>{emp.first_name[0]}{emp.last_name[0]}</span>
                                </div>
                              )}
                            </div>
                            <div className="admin-photo-actions">
                              <label className="admin-btn-sm admin-btn-save admin-photo-upload-label">
                                {uploading === emp.id ? 'Uploading...' : emp.avatar_url ? 'Change Photo' : 'Upload Photo'}
                                <input type="file" accept="image/*" style={{display:'none'}} disabled={uploading === emp.id}
                                  onChange={e => { const f = e.target.files?.[0]; if (f) uploadPhoto(emp, f); e.target.value = '' }} />
                              </label>
                              {emp.avatar_url && (
                                <button className="admin-btn-sm admin-btn-cancel" onClick={() => removePhoto(emp)}>Remove</button>
                              )}
                            </div>
                          </div>
                          <div className="admin-detail-grid admin-detail-grid-2" style={{flex:1}}>
                            <div><strong>Phone:</strong> {emp.phone || '—'}</div>
                            <div><strong>Start Date:</strong> {new Date(emp.start_date).toLocaleDateString('en-GB')}</div>
                            <div><strong>Admin:</strong> {emp.is_admin ? 'Yes' : 'No'}</div>
                            <div><strong>Employee ID:</strong> {emp.employee_number}</div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <div className="admin-empty">No employees found</div>}
        </div>
      )}
    </div>
  )
}
