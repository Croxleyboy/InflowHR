import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { useToast } from '../../context/ToastContext'

interface Kudo {
  id: number
  from_employee_id: string
  to_employee_id: string
  message: string
  category: string
  is_public: boolean
  created_at: string
  from_emp: { first_name: string; last_name: string; avatar_url: string | null; department: string | null } | null
  to_emp: { first_name: string; last_name: string; avatar_url: string | null; department: string | null } | null
}

interface Employee {
  id: string
  first_name: string
  last_name: string
  department: string | null
  is_active: boolean
}

const PAGE_SIZE = 30
const CATEGORIES = ['teamwork', 'innovation', 'leadership', 'customer_focus', 'going_above']
const CATEGORY_COLOURS: Record<string, string> = {
  teamwork: '#2563eb',
  innovation: '#7c3aed',
  leadership: '#d97706',
  customer_focus: '#059669',
  going_above: '#dc2626',
}
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export default function AdminKudos() {
  const { selectedCompanyId, selectedCompany } = useAdminCompany()
  const { showError, showSuccess } = useToast()
  const [kudos, setKudos] = useState<Kudo[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [filterCat, setFilterCat] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<Record<string, any>>({})
  const [tab, setTab] = useState<'management' | 'analytics'>('management')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const load = useCallback(async () => {
    if (!selectedCompanyId) return
    setLoading(true)
    const [kudosRes, empRes] = await Promise.all([
      supabase
        .from('kudos')
        .select('*, from_emp:employees!kudos_from_employee_id_fkey(first_name, last_name, avatar_url, department), to_emp:employees!kudos_to_employee_id_fkey(first_name, last_name, avatar_url, department)')
        .eq('company_id', selectedCompanyId)
        .order('created_at', { ascending: false }),
      supabase
        .from('employees')
        .select('id, first_name, last_name, department, is_active')
        .eq('company_id', selectedCompanyId)
        .eq('is_active', true),
    ])
    setKudos((kudosRes.data as Kudo[]) || [])
    setEmployees((empRes.data as Employee[]) || [])
    setLoading(false)
  }, [selectedCompanyId])

  useEffect(() => { load() }, [load])

  function startEdit(k: Kudo) {
    setEditingId(k.id)
    setEditForm({ message: k.message, category: k.category, is_public: k.is_public })
  }

  async function saveEdit(id: number) {
    const { error } = await supabase.from('kudos').update(editForm).eq('id', id)
    if (error) { showError('Failed to save kudos: ' + error.message); return }
    setEditingId(null)
    showSuccess('Kudos updated')
    load()
  }

  async function deleteKudo(id: number) {
    if (!confirm('Delete this kudos entry?')) return
    const { error } = await supabase.from('kudos').delete().eq('id', id)
    if (error) { showError('Failed to delete kudos: ' + error.message); return }
    setKudos(prev => prev.filter(k => k.id !== id))
    showSuccess('Kudos deleted')
  }

  const filtered = useMemo(() => {
    let result = kudos
    if (filterCat) result = result.filter(k => k.category === filterCat)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter(k => {
        const from = k.from_emp ? `${k.from_emp.first_name} ${k.from_emp.last_name}` : ''
        const to = k.to_emp ? `${k.to_emp.first_name} ${k.to_emp.last_name}` : ''
        return from.toLowerCase().includes(q)
          || to.toLowerCase().includes(q)
          || k.message.toLowerCase().includes(q)
          || k.category.toLowerCase().includes(q)
      })
    }
    return result
  }, [kudos, filterCat, search])

  useEffect(() => { setPage(1) }, [filterCat, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

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

      <div className="admin-tabs" style={{ marginBottom: 16 }}>
        <button className={`admin-tab ${tab === 'management' ? 'admin-tab-active' : ''}`} onClick={() => setTab('management')}>Management</button>
        <button className={`admin-tab ${tab === 'analytics' ? 'admin-tab-active' : ''}`} onClick={() => setTab('analytics')}>Analytics</button>
      </div>

      {tab === 'management' && (
        <>
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

          <input
            className="admin-input"
            placeholder="Search kudos..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ marginBottom: 12, width: '100%', maxWidth: 320 }}
          />

          {loading ? <div className="admin-loading">Loading...</div> : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>From</th><th>To</th><th>Category</th><th>Message</th><th>Date</th><th>Public</th><th>Actions</th></tr></thead>
                <tbody>
                  {paginated.map(k => (
                    <tr key={k.id}>
                      <td>{k.from_emp ? <span className="admin-inline-avatar">{k.from_emp.avatar_url ? <img src={k.from_emp.avatar_url} alt="" /> : <span className="admin-avatar-initials">{k.from_emp.first_name[0]}{k.from_emp.last_name[0]}</span>}{k.from_emp.first_name} {k.from_emp.last_name}</span> : '—'}</td>
                      <td>{k.to_emp ? <span className="admin-inline-avatar">{k.to_emp.avatar_url ? <img src={k.to_emp.avatar_url} alt="" /> : <span className="admin-avatar-initials">{k.to_emp.first_name[0]}{k.to_emp.last_name[0]}</span>}{k.to_emp.first_name} {k.to_emp.last_name}</span> : '—'}</td>
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

          {!loading && filtered.length > PAGE_SIZE && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 16, fontSize: 13 }}>
              <button className="admin-btn-sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Prev</button>
              <span>Page {page} of {totalPages}</span>
              <button className="admin-btn-sm" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next</button>
            </div>
          )}
        </>
      )}

      {tab === 'analytics' && !loading && (
        <KudosAnalytics
          kudos={kudos}
          employees={employees}
          fyStartMonth={selectedCompany?.fy_start_month || 4}
        />
      )}
    </div>
  )
}

/* ─── Kudos Analytics ─── */

function KudosAnalytics({ kudos, employees, fyStartMonth }: {
  kudos: Kudo[]
  employees: Employee[]
  fyStartMonth: number
}) {
  const now = new Date()
  const curMonth = now.getMonth() + 1
  const fyYear = curMonth >= fyStartMonth ? now.getFullYear() : now.getFullYear() - 1

  const fyMonths = useMemo(() => {
    const months: { month: number; year: number; label: string; key: string }[] = []
    for (let i = 0; i < 12; i++) {
      const m = (fyStartMonth - 1 + i) % 12
      const y = fyYear + (fyStartMonth - 1 + i >= 12 ? 1 : 0)
      months.push({ month: m, year: y, label: `${MONTH_LABELS[m]} ${y}`, key: `${y}-${String(m + 1).padStart(2, '0')}` })
    }
    return months
  }, [fyStartMonth, fyYear])

  const fyStartDate = `${fyYear}-${String(fyStartMonth).padStart(2, '0')}-01`
  const endMonth = fyStartMonth === 1 ? 12 : fyStartMonth - 1
  const endYear = fyStartMonth === 1 ? fyYear : fyYear + 1
  const endDay = new Date(endYear, endMonth, 0).getDate()
  const fyEndDate = `${endYear}-${String(endMonth).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`
  const fyLabel = `${MONTH_LABELS[fyStartMonth - 1]} ${fyYear} – ${MONTH_LABELS[(fyStartMonth - 2 + 12) % 12]} ${endYear}`

  const fyKudos = useMemo(() => {
    return kudos.filter(k => {
      const d = k.created_at.slice(0, 10)
      return d >= fyStartDate && d <= fyEndDate
    })
  }, [kudos, fyStartDate, fyEndDate])

  const totalActiveEmployees = employees.length

  // Leaderboard: most received
  const leaderboard = useMemo(() => {
    const counts: Record<string, number> = {}
    fyKudos.forEach(k => { counts[k.to_employee_id] = (counts[k.to_employee_id] || 0) + 1 })
    return Object.entries(counts)
      .map(([id, count]) => {
        const emp = employees.find(e => e.id === id)
        const k = fyKudos.find(kk => kk.to_employee_id === id)
        return {
          id, count,
          name: emp ? `${emp.first_name} ${emp.last_name}` : (k?.to_emp ? `${k.to_emp.first_name} ${k.to_emp.last_name}` : 'Unknown'),
          department: emp?.department || k?.to_emp?.department || null,
          avatar_url: k?.to_emp?.avatar_url || null,
        }
      })
      .sort((a, b) => b.count - a.count)
  }, [fyKudos, employees])

  // Top givers
  const topGivers = useMemo(() => {
    const counts: Record<string, number> = {}
    fyKudos.forEach(k => { counts[k.from_employee_id] = (counts[k.from_employee_id] || 0) + 1 })
    return Object.entries(counts)
      .map(([id, count]) => {
        const emp = employees.find(e => e.id === id)
        const k = fyKudos.find(kk => kk.from_employee_id === id)
        return {
          id, count,
          name: emp ? `${emp.first_name} ${emp.last_name}` : (k?.from_emp ? `${k.from_emp.first_name} ${k.from_emp.last_name}` : 'Unknown'),
        }
      })
      .sort((a, b) => b.count - a.count)
  }, [fyKudos, employees])

  // Monthly data
  const monthlyData = useMemo(() => {
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    return fyMonths.map(fm => {
      const monthKudos = fyKudos.filter(k => {
        const d = new Date(k.created_at)
        return d.getMonth() === fm.month && d.getFullYear() === fm.year
      })
      const recipientIds = new Set(monthKudos.map(k => k.to_employee_id))
      const recognitionPct = totalActiveEmployees > 0 ? (recipientIds.size / totalActiveEmployees) * 100 : 0
      return {
        ...fm,
        count: monthKudos.length,
        recipientCount: recipientIds.size,
        recognitionPct,
        isFuture: fm.key > currentMonthKey,
        byCat: CATEGORIES.reduce((acc, cat) => {
          acc[cat] = monthKudos.filter(k => k.category === cat).length
          return acc
        }, {} as Record<string, number>),
      }
    })
  }, [fyMonths, fyKudos, totalActiveEmployees, now])

  const maxMonthlyCount = Math.max(...monthlyData.map(m => m.count), 1)

  // Category breakdown for FY
  const categoryBreakdown = useMemo(() => {
    return CATEGORIES.map(cat => {
      const count = fyKudos.filter(k => k.category === cat).length
      return { category: cat, count, pct: fyKudos.length > 0 ? (count / fyKudos.length) * 100 : 0 }
    }).sort((a, b) => b.count - a.count)
  }, [fyKudos])

  // Year-level recognition
  const yearRecognitionPct = useMemo(() => {
    const recipientIds = new Set(fyKudos.map(k => k.to_employee_id))
    return totalActiveEmployees > 0 ? (recipientIds.size / totalActiveEmployees) * 100 : 0
  }, [fyKudos, totalActiveEmployees])

  // Department engagement
  const departmentData = useMemo(() => {
    const depts: Record<string, { sent: number; received: number; employees: Set<string>; recognised: Set<string> }> = {}

    employees.forEach(emp => {
      const dept = emp.department || 'Unassigned'
      if (!depts[dept]) depts[dept] = { sent: 0, received: 0, employees: new Set(), recognised: new Set() }
      depts[dept].employees.add(emp.id)
    })

    fyKudos.forEach(k => {
      const fromDept = k.from_emp?.department || 'Unassigned'
      const toDept = k.to_emp?.department || 'Unassigned'
      if (!depts[fromDept]) depts[fromDept] = { sent: 0, received: 0, employees: new Set(), recognised: new Set() }
      if (!depts[toDept]) depts[toDept] = { sent: 0, received: 0, employees: new Set(), recognised: new Set() }
      depts[fromDept].sent++
      depts[toDept].received++
      depts[toDept].recognised.add(k.to_employee_id)
    })

    return Object.entries(depts)
      .map(([dept, d]) => ({
        department: dept,
        sent: d.sent,
        received: d.received,
        total: d.sent + d.received,
        employeeCount: d.employees.size,
        recognisedCount: d.recognised.size,
        recognitionPct: d.employees.size > 0 ? (d.recognised.size / d.employees.size) * 100 : 0,
        perCapita: d.employees.size > 0 ? ((d.sent + d.received) / d.employees.size) : 0,
      }))
      .filter(d => d.employeeCount > 0)
      .sort((a, b) => b.total - a.total)
  }, [employees, fyKudos])

  const maxDeptTotal = Math.max(...departmentData.map(d => d.total), 1)

  return (
    <div>
      <p style={{ fontSize: 12, color: 'var(--text-muted, #888)', marginBottom: 16 }}>
        Kudos analytics for <strong>{fyLabel}</strong> · {fyKudos.length} total kudos · {totalActiveEmployees} active employees
      </p>

      {/* Summary stats */}
      <div className="admin-stat-grid">
        <div className="admin-stat-card">
          <div className="admin-stat-icon" style={{ background: '#7c3aed' }}>🏆</div>
          <div className="admin-stat-info">
            <span className="admin-stat-value">{fyKudos.length}</span>
            <span className="admin-stat-label">Total Kudos (FY)</span>
          </div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-icon" style={{ background: '#059669' }}>👤</div>
          <div className="admin-stat-info">
            <span className="admin-stat-value">{yearRecognitionPct.toFixed(0)}%</span>
            <span className="admin-stat-label">Employees Recognised</span>
          </div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-icon" style={{ background: '#2563eb' }}>📊</div>
          <div className="admin-stat-info">
            <span className="admin-stat-value">{totalActiveEmployees > 0 ? (fyKudos.length / totalActiveEmployees).toFixed(1) : '0'}</span>
            <span className="admin-stat-label">Avg per Employee</span>
          </div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-icon" style={{ background: '#d97706' }}>🤝</div>
          <div className="admin-stat-info">
            <span className="admin-stat-value">{new Set(fyKudos.map(k => k.from_employee_id)).size}</span>
            <span className="admin-stat-label">Active Givers</span>
          </div>
        </div>
      </div>

      {/* Monthly kudos chart */}
      <div style={{ background: 'var(--bg-card, #fff)', borderRadius: 10, padding: '16px 16px 12px', marginBottom: 16, border: '1px solid var(--border, #e0e0e0)', overflowX: 'auto' }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 600 }}>Kudos per Month</h3>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 180, minWidth: 500 }}>
          {monthlyData.map((m, i) => (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end', opacity: m.isFuture ? 0.3 : 1 }}>
              {m.count > 0 && (
                <span style={{ fontSize: 11, fontWeight: 600, marginBottom: 2, color: 'var(--text, #333)' }}>{m.count}</span>
              )}
              <div style={{ width: '100%', maxWidth: 40, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', borderRadius: '3px 3px 0 0', overflow: 'hidden' }}>
                {CATEGORIES.map(cat => {
                  const val = m.byCat[cat] || 0
                  if (val === 0) return null
                  const pct = (val / maxMonthlyCount) * 160
                  return (
                    <div
                      key={cat}
                      title={`${cat.replace('_', ' ')}: ${val}`}
                      style={{ height: pct, background: CATEGORY_COLOURS[cat], minHeight: val > 0 ? 3 : 0 }}
                    />
                  )
                })}
              </div>
              <span style={{ fontSize: 10, marginTop: 4, color: 'var(--text-muted, #888)' }}>{m.label.split(' ')[0]}</span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginTop: 10 }}>
          {CATEGORIES.map(cat => (
            <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-muted, #666)' }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: CATEGORY_COLOURS[cat], flexShrink: 0 }} />
              <span style={{ textTransform: 'capitalize' }}>{cat.replace('_', ' ')}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Recognition coverage per month */}
      <div style={{ background: 'var(--bg-card, #fff)', borderRadius: 10, padding: '16px 16px 12px', marginBottom: 16, border: '1px solid var(--border, #e0e0e0)', overflowX: 'auto' }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600 }}>Recognition Coverage per Month</h3>
        <p style={{ fontSize: 12, color: 'var(--text-muted, #888)', margin: '0 0 12px' }}>Percentage of active employees who received at least one kudos each month</p>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 140 }}>
          {monthlyData.map((m, i) => {
            const barH = m.isFuture ? 0 : Math.max(m.recognitionPct * 1.2, m.recognitionPct > 0 ? 6 : 0)
            const colour = m.recognitionPct >= 50 ? '#059669' : m.recognitionPct >= 25 ? '#d97706' : '#dc2626'
            return (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end', opacity: m.isFuture ? 0.3 : 1 }}>
                {!m.isFuture && m.recognitionPct > 0 && (
                  <span style={{ fontSize: 10, fontWeight: 600, marginBottom: 2, color: colour }}>{m.recognitionPct.toFixed(0)}%</span>
                )}
                <div style={{ width: '60%', maxWidth: 30, height: barH, background: colour, borderRadius: '3px 3px 0 0', transition: 'height 0.3s' }} />
                <span style={{ fontSize: 10, marginTop: 4, color: 'var(--text-muted, #888)' }}>{m.label.split(' ')[0]}</span>
              </div>
            )
          })}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16, marginBottom: 16 }}>
        {/* Category breakdown */}
        <div style={{ background: 'var(--bg-card, #fff)', borderRadius: 10, padding: 16, border: '1px solid var(--border, #e0e0e0)' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 600 }}>Category Breakdown</h3>
          {categoryBreakdown.map(c => (
            <div key={c.category} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 13 }}>
                <span style={{ textTransform: 'capitalize', fontWeight: 500 }}>{c.category.replace('_', ' ')}</span>
                <span style={{ fontWeight: 600, color: CATEGORY_COLOURS[c.category] }}>{c.count} ({c.pct.toFixed(0)}%)</span>
              </div>
              <div style={{ height: 8, background: 'var(--bg, #f0f0f0)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${c.pct}%`, background: CATEGORY_COLOURS[c.category], borderRadius: 4, transition: 'width 0.3s' }} />
              </div>
            </div>
          ))}
        </div>

        {/* Leaderboard */}
        <div style={{ background: 'var(--bg-card, #fff)', borderRadius: 10, padding: 16, border: '1px solid var(--border, #e0e0e0)' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 600 }}>🏆 Leaderboard — Most Recognised</h3>
          {leaderboard.length === 0 ? (
            <div className="admin-empty">No kudos this FY</div>
          ) : (
            <div style={{ maxHeight: 280, overflowY: 'auto' }}>
              {leaderboard.slice(0, 10).map((emp, i) => (
                <div key={emp.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: i < 9 ? '1px solid var(--border, #eee)' : 'none' }}>
                  <span style={{ width: 24, textAlign: 'center', fontWeight: 700, fontSize: 14, color: i < 3 ? '#d97706' : 'var(--text-muted, #888)' }}>
                    {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`}
                  </span>
                  {emp.avatar_url
                    ? <img src={emp.avatar_url} alt="" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }} />
                    : <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#7c3aed', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>
                        {emp.name.split(' ').map(n => n[0]).join('').toUpperCase()}
                      </div>
                  }
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ fontSize: 13 }}>{emp.name}</strong>
                    {emp.department && <span style={{ fontSize: 11, opacity: 0.5, marginLeft: 6 }}>{emp.department}</span>}
                  </div>
                  <span style={{ fontWeight: 700, fontSize: 14, color: '#7c3aed' }}>{emp.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Top givers */}
      <div style={{ background: 'var(--bg-card, #fff)', borderRadius: 10, padding: 16, marginBottom: 16, border: '1px solid var(--border, #e0e0e0)' }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 600 }}>Top Givers</h3>
        {topGivers.length === 0 ? (
          <div className="admin-empty">No kudos this FY</div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {topGivers.slice(0, 15).map((g, i) => (
              <span key={g.id} style={{
                fontSize: 12, fontWeight: 600, padding: '4px 12px', borderRadius: 6,
                background: i < 3 ? '#dbeafe' : 'var(--bg, #f5f5f5)',
                color: i < 3 ? '#2563eb' : 'var(--text, #333)',
                display: 'inline-flex', alignItems: 'center', gap: 4,
              }}>
                {g.name} <span style={{ opacity: 0.6 }}>({g.count})</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Department engagement */}
      <div style={{ background: 'var(--bg-card, #fff)', borderRadius: 10, padding: 16, border: '1px solid var(--border, #e0e0e0)' }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600 }}>Department Engagement</h3>
        <p style={{ fontSize: 12, color: 'var(--text-muted, #888)', margin: '0 0 12px' }}>Kudos sent and received per department, with recognition coverage</p>

        {departmentData.length === 0 ? (
          <div className="admin-empty">No department data available</div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table" style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th>Department</th>
                  <th>Employees</th>
                  <th>Sent</th>
                  <th>Received</th>
                  <th>Per Capita</th>
                  <th>Recognition %</th>
                  <th>Engagement</th>
                </tr>
              </thead>
              <tbody>
                {departmentData.map(d => {
                  const barW = (d.total / maxDeptTotal) * 100
                  const colour = d.recognitionPct >= 50 ? '#059669' : d.recognitionPct >= 25 ? '#d97706' : '#dc2626'
                  return (
                    <tr key={d.department}>
                      <td><strong>{d.department}</strong></td>
                      <td>{d.employeeCount}</td>
                      <td style={{ color: '#2563eb', fontWeight: 600 }}>{d.sent}</td>
                      <td style={{ color: '#7c3aed', fontWeight: 600 }}>{d.received}</td>
                      <td>{d.perCapita.toFixed(1)}</td>
                      <td><span style={{ fontWeight: 600, color: colour }}>{d.recognitionPct.toFixed(0)}%</span></td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ flex: 1, height: 8, background: 'var(--bg, #f0f0f0)', borderRadius: 4, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${barW}%`, background: 'linear-gradient(90deg, #2563eb, #7c3aed)', borderRadius: 4 }} />
                          </div>
                          <span style={{ fontSize: 11, fontWeight: 600, minWidth: 24, textAlign: 'right' }}>{d.total}</span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
