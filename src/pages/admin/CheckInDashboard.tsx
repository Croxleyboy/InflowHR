import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

interface CheckinRow {
  id: string
  employee_id: string
  check_in_at: string
  check_out_at: string | null
  source: string
  status: string
  work_from_home: boolean
  check_in_location_id: string | null
  emp_name?: string
  dept?: string
  loc_name?: string
}

interface Props {
  source: 'timesheets' | 'shifts'
}

const PAGE_SIZE = 30

export default function CheckInDashboardPanel({ source }: Props) {
  const { companyUser } = useAuth()
  const companyId = companyUser?.company_id || ''

  const [liveRecords, setLiveRecords] = useState<CheckinRow[]>([])
  const [history, setHistory] = useState<CheckinRow[]>([])
  const [loading, setLoading] = useState(true)
  const [employees, setEmployees] = useState<Record<string, { name: string; dept: string }>>({})
  const [locationNames, setLocationNames] = useState<Record<string, string>>({})
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(1); return d.toISOString().split('T')[0]
  })
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split('T')[0])
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [filterDept, setFilterDept] = useState('')

  const load = useCallback(async () => {
    if (!companyId) return
    setLoading(true)

    const [empRes, locRes, liveRes, histRes] = await Promise.all([
      supabase.from('employees').select('id, first_name, last_name, department').eq('company_id', companyId).eq('is_active', true),
      supabase.from('work_locations').select('id, name').eq('company_id', companyId),
      supabase.from('checkin_records').select('*').eq('company_id', companyId).eq('source', source).eq('status', 'checked_in').order('check_in_at', { ascending: false }),
      supabase.from('checkin_records').select('*').eq('company_id', companyId).eq('source', source)
        .gte('check_in_at', dateFrom + 'T00:00:00').lte('check_in_at', dateTo + 'T23:59:59')
        .order('check_in_at', { ascending: false }).limit(500),
    ])

    const empMap: Record<string, { name: string; dept: string }> = {}
    if (empRes.data) empRes.data.forEach((e: { id: string; first_name: string; last_name: string; department: string | null }) => {
      empMap[e.id] = { name: `${e.first_name} ${e.last_name}`, dept: e.department || '' }
    })
    setEmployees(empMap)

    const locMap: Record<string, string> = {}
    if (locRes.data) locRes.data.forEach((l: { id: string; name: string }) => { locMap[l.id] = l.name })
    setLocationNames(locMap)

    if (liveRes.data) setLiveRecords(liveRes.data)
    if (histRes.data) setHistory(histRes.data)
    setLoading(false)
  }, [companyId, source, dateFrom, dateTo])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [search, filterDept])

  const enriched = (rows: CheckinRow[]) => rows.map(r => ({
    ...r,
    emp_name: employees[r.employee_id]?.name || 'Unknown',
    dept: employees[r.employee_id]?.dept || '',
    loc_name: r.check_in_location_id ? locationNames[r.check_in_location_id] || '' : r.work_from_home ? 'Remote' : '',
  }))

  const filteredHistory = enriched(history).filter(r => {
    if (filterDept && r.dept !== filterDept) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      return r.emp_name.toLowerCase().includes(q) || r.loc_name.toLowerCase().includes(q) || r.status.toLowerCase().includes(q)
    }
    return true
  })

  const totalPages = Math.max(1, Math.ceil(filteredHistory.length / PAGE_SIZE))
  const paginated = filteredHistory.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const todayStr = new Date().toISOString().split('T')[0]
  const todayRecords = enriched(history).filter(r => r.check_in_at.startsWith(todayStr))
  const uniqueDepts = [...new Set(Object.values(employees).map(e => e.dept).filter(Boolean))].sort()

  const totalToday = todayRecords.length
  const wfhToday = todayRecords.filter(r => r.work_from_home).length
  const checkedOutToday = todayRecords.filter(r => r.status === 'checked_out' || r.status === 'auto_closed')
  const avgHours = checkedOutToday.length > 0
    ? (checkedOutToday.reduce((sum, r) => {
        const d = (new Date(r.check_out_at!).getTime() - new Date(r.check_in_at).getTime()) / 3600000
        return sum + d
      }, 0) / checkedOutToday.length).toFixed(1)
    : '—'

  function fmtTime(iso: string) {
    return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  }
  function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
  }
  function duration(start: string, end: string | null) {
    if (!end) {
      const mins = Math.round((Date.now() - new Date(start).getTime()) / 60000)
      const h = Math.floor(mins / 60)
      const m = mins % 60
      return `${h}h ${m}m`
    }
    const mins = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000)
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return `${h}h ${m}m`
  }

  if (loading) return <div className="admin-loading">Loading...</div>

  const liveEnriched = enriched(liveRecords)

  return (
    <div>
      {/* Metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 20 }}>
        <div className="admin-stat-card">
          <div className="admin-stat-label">Currently In</div>
          <div className="admin-stat-value">{liveEnriched.length}</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-label">Today Total</div>
          <div className="admin-stat-value">{totalToday}</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-label">WFH Today</div>
          <div className="admin-stat-value">{wfhToday}</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-label">Avg Hours</div>
          <div className="admin-stat-value">{avgHours}</div>
        </div>
      </div>

      {/* Live check-ins */}
      {liveEnriched.length > 0 && (
        <div className="admin-section">
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Currently Checked In</h3>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr><th>Employee</th><th>Department</th><th>Since</th><th>Duration</th><th>Location</th></tr>
              </thead>
              <tbody>
                {liveEnriched.map(r => (
                  <tr key={r.id}>
                    <td>{r.emp_name}</td>
                    <td>{r.dept || '—'}</td>
                    <td>{fmtTime(r.check_in_at)}</td>
                    <td>{duration(r.check_in_at, null)}</td>
                    <td>
                      {r.work_from_home
                        ? <span className="admin-badge admin-badge-info">Remote</span>
                        : <span className="admin-badge admin-badge-active">{r.loc_name || 'On-site'}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* History */}
      <div className="admin-section">
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Check-In History</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12, alignItems: 'flex-end' }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#888', display: 'block' }}>From</label>
            <input className="admin-input" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ maxWidth: 160 }} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#888', display: 'block' }}>To</label>
            <input className="admin-input" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ maxWidth: 160 }} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#888', display: 'block' }}>Department</label>
            <select className="admin-input" value={filterDept} onChange={e => setFilterDept(e.target.value)} style={{ maxWidth: 180 }}>
              <option value="">All</option>
              {uniqueDepts.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <input className="admin-input" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} style={{ maxWidth: 200 }} />
        </div>

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr><th>Employee</th><th>Department</th><th>Date</th><th>In</th><th>Out</th><th>Duration</th><th>Location</th><th>Status</th></tr>
            </thead>
            <tbody>
              {paginated.map(r => (
                <tr key={r.id}>
                  <td>{r.emp_name}</td>
                  <td>{r.dept || '—'}</td>
                  <td>{fmtDate(r.check_in_at)}</td>
                  <td>{fmtTime(r.check_in_at)}</td>
                  <td>{r.check_out_at ? fmtTime(r.check_out_at) : '—'}</td>
                  <td>{duration(r.check_in_at, r.check_out_at)}</td>
                  <td>{r.work_from_home ? 'Remote' : r.loc_name || '—'}</td>
                  <td>
                    <span className={`admin-badge admin-badge-${r.status === 'checked_in' ? 'active' : r.status === 'cancelled' ? 'cancelled' : 'complete'}`}>
                      {r.status === 'checked_in' ? 'In' : r.status === 'checked_out' ? 'Out' : r.status === 'auto_closed' ? 'Auto' : 'Cancelled'}
                    </span>
                  </td>
                </tr>
              ))}
              {paginated.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: '#999' }}>No records found</td></tr>}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 12 }}>
            <button className="admin-action-btn" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</button>
            <span style={{ fontSize: 13 }}>Page {page} of {totalPages}</span>
            <button className="admin-action-btn" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</button>
          </div>
        )}
      </div>
    </div>
  )
}
