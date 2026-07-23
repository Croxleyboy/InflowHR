import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useAdminCompany } from '../../context/AdminCompanyContext'

interface Announcement {
  id: number
  title: string
  body: string
  is_pinned: boolean
  published_at: string
  expires_at: string | null
  author: { first_name: string; last_name: string } | null
}

export default function AdminAnnouncements() {
  const { selectedCompanyId } = useAdminCompany()
  const [items, setItems] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<Record<string, any>>({})
  const [search, setSearch] = useState('')

  useEffect(() => { if (selectedCompanyId) load() }, [selectedCompanyId])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('announcements')
      .select('*, author:employees!announcements_author_id_fkey(first_name, last_name)')
      .eq('company_id', selectedCompanyId)
      .order('published_at', { ascending: false })
    setItems((data as Announcement[]) || [])
    setLoading(false)
  }

  function startEdit(a: Announcement) {
    setEditingId(a.id)
    setEditForm({ title: a.title, body: a.body, is_pinned: a.is_pinned, expires_at: a.expires_at || '' })
  }

  async function saveEdit(id: number) {
    await supabase.from('announcements').update({
      title: editForm.title, body: editForm.body, is_pinned: editForm.is_pinned,
      expires_at: editForm.expires_at || null,
    }).eq('id', id)
    setEditingId(null)
    load()
  }

  async function deleteAnnouncement(id: number) {
    if (!confirm('Delete this announcement?')) return
    await supabase.from('announcements').delete().eq('id', id)
    setItems(prev => prev.filter(a => a.id !== id))
  }

  const filtered = useMemo(() => {
    if (!search) return items
    const q = search.toLowerCase()
    return items.filter(a => `${a.title} ${a.body}`.toLowerCase().includes(q))
  }, [items, search])

  const stats = useMemo(() => ({
    total: items.length,
    pinned: items.filter(a => a.is_pinned).length,
    active: items.filter(a => !a.expires_at || new Date(a.expires_at) > new Date()).length,
    expired: items.filter(a => a.expires_at && new Date(a.expires_at) <= new Date()).length,
  }), [items])

  return (
    <div className="admin-section">
      <div className="admin-page-header">
        <h2>Announcements Management</h2>
        <p>{items.length} total announcements</p>
      </div>

      <div className="admin-mini-stats">
        <div className="admin-mini-stat"><span className="admin-mini-value">{stats.total}</span><span>Total</span></div>
        <div className="admin-mini-stat"><span className="admin-mini-value" style={{color:'#7b1fa2'}}>{stats.pinned}</span><span>Pinned</span></div>
        <div className="admin-mini-stat"><span className="admin-mini-value" style={{color:'#43a047'}}>{stats.active}</span><span>Active</span></div>
        <div className="admin-mini-stat"><span className="admin-mini-value" style={{color:'#e53935'}}>{stats.expired}</span><span>Expired</span></div>
      </div>

      <div className="admin-filters">
        <input placeholder="Search announcements..." value={search} onChange={e => setSearch(e.target.value)} className="admin-input admin-search" />
      </div>

      {loading ? <div className="admin-loading">Loading...</div> : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Title</th><th>Author</th><th>Published</th><th>Expires</th><th>Pinned</th><th>Actions</th></tr></thead>
            <tbody>
              {filtered.map(a => (
                <tr key={a.id}>
                  <td>{editingId === a.id ? (
                    <div>
                      <input className="admin-inline-input" value={editForm.title} onChange={e => setEditForm(f => ({...f, title: e.target.value}))} />
                      <textarea className="admin-inline-textarea" value={editForm.body} onChange={e => setEditForm(f => ({...f, body: e.target.value}))} />
                    </div>
                  ) : (
                    <div><strong>{a.title}</strong><br/><span className="admin-td-desc">{a.body.slice(0, 80)}{a.body.length > 80 ? '...' : ''}</span></div>
                  )}</td>
                  <td>{a.author ? `${a.author.first_name} ${a.author.last_name}` : '—'}</td>
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
                        <button className="admin-btn-icon" onClick={() => startEdit(a)}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
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
    </div>
  )
}
