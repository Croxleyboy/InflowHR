import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'

interface Announcement {
  id: number
  title: string
  body: string
  is_pinned: boolean
  priority: 'low' | 'medium' | 'high'
  published_at: string
  expires_at: string | null
  target_employee_id: string | null
  target_departments: string[] | null
  is_system_generated: boolean
  author: { first_name: string; last_name: string } | null
  target_employee: { first_name: string; last_name: string } | null
}

interface AuditRow {
  id: string
  announcement_id: number | null
  employee_id: string
  action: 'created' | 'deleted'
  created_at: string
  employee: { first_name: string; last_name: string } | null
}

type FilterKey = 'all' | 'company_wide' | 'department' | 'private'

export default function AdminAnnouncements() {
  const { selectedCompanyId } = useAdminCompany()
  const { employeeId } = useAuth()
  const { showError, showSuccess } = useToast()
  const [items, setItems] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<Record<string, any>>({})
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterKey>('all')
  const [showCreate, setShowCreate] = useState(false)
  const [departments, setDepartments] = useState<string[]>([])
  const [auditLog, setAuditLog] = useState<AuditRow[]>([])
  const [showAudit, setShowAudit] = useState(false)
  const [createForm, setCreateForm] = useState({
    title: '', body: '', priority: 'medium' as string, is_pinned: false,
    expires_at: '', target_departments: [] as string[],
  })
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!selectedCompanyId) return
    setLoading(true)
    const [annRes, deptRes] = await Promise.all([
      supabase.from('announcements')
        .select('*, author:employees!announcements_author_id_fkey(first_name, last_name), target_employee:employees!announcements_target_employee_id_fkey(first_name, last_name)')
        .eq('company_id', selectedCompanyId)
        .order('published_at', { ascending: false }),
      supabase.from('employees').select('department').eq('company_id', selectedCompanyId).eq('is_active', true),
    ])
    setItems((annRes.data as Announcement[]) || [])
    const depts = [...new Set((deptRes.data || []).map((e: any) => e.department).filter(Boolean))] as string[]
    setDepartments(depts.sort())
    setLoading(false)
  }, [selectedCompanyId])

  useEffect(() => { load() }, [load])

  async function loadAudit() {
    if (!selectedCompanyId) return
    const { data } = await supabase.from('new_starter_announcement_audit')
      .select('*, employee:employees!new_starter_announcement_audit_employee_id_fkey(first_name, last_name)')
      .eq('company_id', selectedCompanyId)
      .order('created_at', { ascending: false })
      .limit(100)
    setAuditLog((data as AuditRow[]) || [])
    setShowAudit(true)
  }

  async function createAnnouncement() {
    if (!selectedCompanyId || saving) return
    if (!createForm.title.trim()) { showError('Title is required'); return }
    if (!createForm.body.trim()) { showError('Body is required'); return }
    setSaving(true)
    const { error } = await supabase.from('announcements').insert({
      title: createForm.title.trim(),
      body: createForm.body.trim(),
      priority: createForm.priority,
      is_pinned: createForm.is_pinned,
      expires_at: createForm.expires_at || null,
      company_id: selectedCompanyId,
      author_id: employeeId || null,
      target_departments: createForm.target_departments.length > 0 ? createForm.target_departments : null,
      published_at: new Date().toISOString(),
    })
    setSaving(false)
    if (error) { showError('Failed to create announcement: ' + error.message); return }
    showSuccess('Announcement created')
    setCreateForm({ title: '', body: '', priority: 'medium', is_pinned: false, expires_at: '', target_departments: [] })
    setShowCreate(false)
    load()
  }

  function startEdit(a: Announcement) {
    setEditingId(a.id)
    setEditForm({ title: a.title, body: a.body, is_pinned: a.is_pinned, priority: a.priority || 'medium', expires_at: a.expires_at || '' })
  }

  async function saveEdit(id: number) {
    const { error } = await supabase.from('announcements').update({
      title: editForm.title, body: editForm.body, is_pinned: editForm.is_pinned,
      priority: editForm.priority || 'medium', expires_at: editForm.expires_at || null,
    }).eq('id', id)
    if (error) { showError('Failed to save announcement: ' + error.message); return }
    setEditingId(null)
    load()
    showSuccess('Announcement saved')
  }

  async function deleteAnnouncement(id: number) {
    if (!confirm('Delete this announcement?')) return
    const { error } = await supabase.from('announcements').delete().eq('id', id)
    if (error) { showError('Failed to delete announcement: ' + error.message); return }
    setItems(prev => prev.filter(a => a.id !== id))
    showSuccess('Announcement deleted')
  }

  const filtered = useMemo(() => {
    let list = items
    if (filter === 'company_wide') list = list.filter(a => !a.target_employee_id && (!a.target_departments || a.target_departments.length === 0))
    else if (filter === 'department') list = list.filter(a => a.target_departments && a.target_departments.length > 0)
    else if (filter === 'private') list = list.filter(a => a.target_employee_id)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(a => `${a.title} ${a.body}`.toLowerCase().includes(q))
    }
    return list
  }, [items, search, filter])

  const stats = useMemo(() => ({
    total: items.length,
    companyWide: items.filter(a => !a.target_employee_id && (!a.target_departments || a.target_departments.length === 0)).length,
    department: items.filter(a => a.target_departments && a.target_departments.length > 0).length,
    private: items.filter(a => a.target_employee_id).length,
  }), [items])

  const FILTERS: { key: FilterKey; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: stats.total },
    { key: 'company_wide', label: 'Company-wide', count: stats.companyWide },
    { key: 'department', label: 'Department', count: stats.department },
    { key: 'private', label: 'Private (New Starter)', count: stats.private },
  ]

  function toggleDept(dept: string) {
    setCreateForm(f => ({
      ...f,
      target_departments: f.target_departments.includes(dept)
        ? f.target_departments.filter(d => d !== dept)
        : [...f.target_departments, dept],
    }))
  }

  return (
    <div className="admin-section">
      <div className="admin-page-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2>Announcements Management</h2>
            <p>{items.length} total announcements</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="ts-btn ts-btn-sm" onClick={loadAudit}>Audit Log</button>
            <button className="ts-btn ts-btn-sm ts-btn-primary" onClick={() => setShowCreate(!showCreate)}>
              {showCreate ? 'Cancel' : '+ Create Announcement'}
            </button>
          </div>
        </div>
      </div>

      {showCreate && (
        <div className="admin-card" style={{ padding: 20, marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 600 }}>New Announcement</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input className="ts-input" placeholder="Title" value={createForm.title} onChange={e => setCreateForm(f => ({ ...f, title: e.target.value }))} />
            <textarea className="ts-input" placeholder="Announcement body..." rows={4} value={createForm.body} onChange={e => setCreateForm(f => ({ ...f, body: e.target.value }))} style={{ resize: 'vertical' }} />
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <label style={{ fontSize: 13, fontWeight: 600 }}>Priority</label>
                <select className="ts-input" style={{ width: 120 }} value={createForm.priority} onChange={e => setCreateForm(f => ({ ...f, priority: e.target.value }))}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <label style={{ fontSize: 13, fontWeight: 600 }}>Expires</label>
                <input type="date" className="ts-input" style={{ width: 160 }} value={createForm.expires_at} onChange={e => setCreateForm(f => ({ ...f, expires_at: e.target.value }))} />
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={createForm.is_pinned} onChange={e => setCreateForm(f => ({ ...f, is_pinned: e.target.checked }))} /> Pinned
              </label>
            </div>
            <div>
              <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 6 }}>Target Audience</label>
              <p style={{ fontSize: 12, color: 'var(--text-muted, #8b8fa3)', margin: '0 0 8px' }}>
                Leave all unchecked for a company-wide announcement, or select departments to target.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {departments.map(d => (
                  <button
                    key={d}
                    type="button"
                    className={`ts-btn ts-btn-xs ${createForm.target_departments.includes(d) ? 'ts-btn-primary' : ''}`}
                    onClick={() => toggleDept(d)}
                  >
                    {d}
                  </button>
                ))}
                {departments.length === 0 && <span style={{ fontSize: 12, color: 'var(--text-muted, #8b8fa3)' }}>No departments found</span>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="ts-btn ts-btn-sm" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="ts-btn ts-btn-sm ts-btn-primary" onClick={createAnnouncement} disabled={saving}>
                {saving ? 'Creating...' : 'Create Announcement'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="admin-mini-stats">
        <div className="admin-mini-stat"><span className="admin-mini-value">{stats.total}</span><span>Total</span></div>
        <div className="admin-mini-stat"><span className="admin-mini-value" style={{color:'#2563eb'}}>{stats.companyWide}</span><span>Company-wide</span></div>
        <div className="admin-mini-stat"><span className="admin-mini-value" style={{color:'#d97706'}}>{stats.department}</span><span>Department</span></div>
        <div className="admin-mini-stat"><span className="admin-mini-value" style={{color:'#7c3aed'}}>{stats.private}</span><span>Private</span></div>
      </div>

      <div className="admin-tabs" style={{ marginBottom: 12 }}>
        {FILTERS.map(f => (
          <button key={f.key} className={`admin-tab ${filter === f.key ? 'admin-tab-active' : ''}`} onClick={() => setFilter(f.key)}>
            {f.label} ({f.count})
          </button>
        ))}
      </div>

      <div className="admin-filters">
        <input placeholder="Search announcements..." value={search} onChange={e => setSearch(e.target.value)} className="admin-input admin-search" />
      </div>

      {loading ? <div className="admin-loading">Loading...</div> : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Title</th><th>Audience</th><th>Priority</th><th>Author</th><th>Published</th><th>Expires</th><th>Pinned</th><th>Actions</th></tr></thead>
            <tbody>
              {filtered.map(a => (
                <tr key={a.id}>
                  <td>{editingId === a.id ? (
                    <div>
                      <input className="admin-inline-input" value={editForm.title} onChange={e => setEditForm(f => ({...f, title: e.target.value}))} />
                      <textarea className="admin-inline-textarea" value={editForm.body} onChange={e => setEditForm(f => ({...f, body: e.target.value}))} />
                    </div>
                  ) : (
                    <div>
                      <strong>{a.title}</strong>
                      {a.is_system_generated && <span style={{ marginLeft: 6, fontSize: 11, background: '#dbeafe', color: '#2563eb', padding: '1px 6px', borderRadius: 4, fontWeight: 600 }}>System</span>}
                      <br/><span className="admin-td-desc">{a.body.slice(0, 80)}{a.body.length > 80 ? '...' : ''}</span>
                    </div>
                  )}</td>
                  <td>
                    {a.target_employee_id ? (
                      <span style={{ fontSize: 12, color: '#7c3aed' }}>
                        {a.target_employee ? `${a.target_employee.first_name} ${a.target_employee.last_name}` : 'Private'}
                      </span>
                    ) : a.target_departments && a.target_departments.length > 0 ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                        {a.target_departments.map(d => (
                          <span key={d} style={{ fontSize: 11, background: '#fef3c7', color: '#92400e', padding: '1px 6px', borderRadius: 4 }}>{d}</span>
                        ))}
                      </div>
                    ) : (
                      <span style={{ fontSize: 12, color: '#2563eb' }}>All Employees</span>
                    )}
                  </td>
                  <td>{editingId === a.id ? (
                    <select className="admin-inline-input" value={editForm.priority} onChange={e => setEditForm(f => ({...f, priority: e.target.value}))}>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  ) : (
                    <span style={{ fontWeight: 600, color: a.priority === 'high' ? '#d32f2f' : a.priority === 'medium' ? '#e65100' : '#2e7d32' }}>{a.priority ? a.priority.charAt(0).toUpperCase() + a.priority.slice(1) : 'Medium'}</span>
                  )}</td>
                  <td>{a.author ? `${a.author.first_name} ${a.author.last_name}` : a.is_system_generated ? 'System' : '—'}</td>
                  <td>{new Date(a.published_at).toLocaleDateString('en-GB')}</td>
                  <td>{editingId === a.id ? <input type="date" className="admin-inline-input" value={editForm.expires_at} onChange={e => setEditForm(f => ({...f, expires_at: e.target.value}))} /> : (a.expires_at ? new Date(a.expires_at).toLocaleDateString('en-GB') : '—')}</td>
                  <td>{editingId === a.id ? <label className="admin-toggle-label"><input type="checkbox" checked={editForm.is_pinned} onChange={e => setEditForm(f => ({...f, is_pinned: e.target.checked}))} /></label> : (a.is_pinned ? '📌' : '—')}</td>
                  <td className="admin-actions">
                    {editingId === a.id ? (
                      <>
                        <button className="admin-btn-sm admin-btn-save" onClick={() => saveEdit(a.id)}>Save</button>
                        <button className="admin-btn-sm admin-btn-cancel" onClick={() => setEditingId(null)}>Cancel</button>
                      </>
                    ) : (
                      <>
                        {!a.is_system_generated && (
                          <button className="admin-btn-icon" onClick={() => startEdit(a)}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                          </button>
                        )}
                        <button className="admin-btn-icon admin-btn-danger" onClick={() => deleteAnnouncement(a.id)}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <div className="admin-empty">No announcements found</div>}
        </div>
      )}

      {showAudit && (
        <div className="admin-card" style={{ padding: 20, marginTop: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>New Starter Announcement Audit Log</h3>
            <button className="ts-btn ts-btn-xs" onClick={() => setShowAudit(false)}>Close</button>
          </div>
          {auditLog.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--text-muted, #8b8fa3)' }}>No audit records found. Records are created when the daily cron job creates or deletes private welcome announcements.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="ts-table">
                <thead>
                  <tr><th>Date</th><th>Action</th><th>Employee</th><th>Announcement ID</th></tr>
                </thead>
                <tbody>
                  {auditLog.map(r => (
                    <tr key={r.id}>
                      <td>{new Date(r.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} {new Date(r.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</td>
                      <td>
                        <span style={{ fontSize: 12, fontWeight: 600, color: r.action === 'created' ? '#16a34a' : '#dc2626' }}>
                          {r.action === 'created' ? 'Created' : 'Deleted'}
                        </span>
                      </td>
                      <td>{r.employee ? `${r.employee.first_name} ${r.employee.last_name}` : r.employee_id}</td>
                      <td>{r.announcement_id ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
