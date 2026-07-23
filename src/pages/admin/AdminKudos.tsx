import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useAdminCompany } from '../../context/AdminCompanyContext'

interface Kudo {
  id: number
  message: string
  category: string
  is_public: boolean
  created_at: string
  from_emp: { first_name: string; last_name: string } | null
  to_emp: { first_name: string; last_name: string } | null
}

const CATEGORIES = ['teamwork', 'innovation', 'leadership', 'customer_focus', 'going_above']

export default function AdminKudos() {
  const { selectedCompanyId } = useAdminCompany()
  const [kudos, setKudos] = useState<Kudo[]>([])
  const [loading, setLoading] = useState(true)
  const [filterCat, setFilterCat] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<Record<string, any>>({})

  useEffect(() => { if (selectedCompanyId) load() }, [selectedCompanyId])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('kudos')
      .select('*, from_emp:employees!kudos_from_employee_id_fkey(first_name, last_name), to_emp:employees!kudos_to_employee_id_fkey(first_name, last_name)')
      .eq('company_id', selectedCompanyId)
      .order('created_at', { ascending: false })
    setKudos((data as Kudo[]) || [])
    setLoading(false)
  }

  function startEdit(k: Kudo) {
    setEditingId(k.id)
    setEditForm({ message: k.message, category: k.category, is_public: k.is_public })
  }

  async function saveEdit(id: number) {
    await supabase.from('kudos').update(editForm).eq('id', id)
    setEditingId(null)
    load()
  }

  async function deleteKudo(id: number) {
    if (!confirm('Delete this kudos entry?')) return
    await supabase.from('kudos').delete().eq('id', id)
    setKudos(prev => prev.filter(k => k.id !== id))
  }

  const filtered = useMemo(() => {
    if (!filterCat) return kudos
    return kudos.filter(k => k.category === filterCat)
  }, [kudos, filterCat])

  const stats = useMemo(() => {
    const byCat: Record<string, number> = {}
    kudos.forEach(k => { byCat[k.category] = (byCat[k.category] || 0) + 1 })
    return byCat
  }, [kudos])

  return (
    <div className="admin-section">
      <div className="admin-page-header">
        <h2>Kudos Management</h2>
        <p>{kudos.length} total kudos</p>
      </div>

      <div className="admin-mini-stats">
        {CATEGORIES.map(cat => (
          <div key={cat} className="admin-mini-stat" style={{cursor:'pointer'}} onClick={() => setFilterCat(filterCat === cat ? '' : cat)}>
            <span className="admin-mini-value">{stats[cat] || 0}</span>
            <span style={{textTransform:'capitalize'}}>{cat.replace('_', ' ')}</span>
          </div>
        ))}
      </div>

      <div className="admin-filters">
        <select value={filterCat} onChange={e => setFilterCat(e.target.value)} className="admin-select">
          <option value="">All Categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
        </select>
      </div>

      {loading ? <div className="admin-loading">Loading...</div> : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>From</th><th>To</th><th>Category</th><th>Message</th><th>Date</th><th>Public</th><th>Actions</th></tr></thead>
            <tbody>
              {filtered.map(k => (
                <tr key={k.id}>
                  <td>{k.from_emp ? `${k.from_emp.first_name} ${k.from_emp.last_name}` : '—'}</td>
                  <td>{k.to_emp ? `${k.to_emp.first_name} ${k.to_emp.last_name}` : '—'}</td>
                  <td>{editingId === k.id ? (
                    <select className="admin-inline-select" value={editForm.category} onChange={e => setEditForm(f => ({...f, category: e.target.value}))}>
                      {CATEGORIES.map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
                    </select>
                  ) : <span className="admin-badge admin-badge-info" style={{textTransform:'capitalize'}}>{k.category?.replace('_', ' ')}</span>}</td>
                  <td className="admin-td-wrap">{editingId === k.id ? <textarea className="admin-inline-textarea" value={editForm.message} onChange={e => setEditForm(f => ({...f, message: e.target.value}))} /> : k.message}</td>
                  <td>{new Date(k.created_at).toLocaleDateString('en-GB')}</td>
                  <td>{editingId === k.id ? (
                    <label className="admin-toggle-label"><input type="checkbox" checked={editForm.is_public} onChange={e => setEditForm(f => ({...f, is_public: e.target.checked}))} /> Public</label>
                  ) : (k.is_public ? 'Yes' : 'No')}</td>
                  <td className="admin-actions">
                    {editingId === k.id ? (
                      <>
                        <button className="admin-btn-sm admin-btn-save" onClick={() => saveEdit(k.id)}>Save</button>
                        <button className="admin-btn-sm admin-btn-cancel" onClick={() => setEditingId(null)}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button className="admin-btn-icon" onClick={() => startEdit(k)}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                        <button className="admin-btn-icon admin-btn-danger" onClick={() => deleteKudo(k.id)}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <div className="admin-empty">No kudos found</div>}
        </div>
      )}
    </div>
  )
}
