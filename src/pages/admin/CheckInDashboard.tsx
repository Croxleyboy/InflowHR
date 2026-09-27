import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { useAuth } from '../../context/AuthContext'
import { toLocalDateStr, formatDate } from '../../lib/formatters'

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

interface ShiftAssignmentRow {
  id: string
  employee_id: string
  date: string
  shift_template_id: string
}

interface ShiftTemplateRow {
  id: string
  name: string
  start_time: string
  end_time: string
}

interface Props {
  source: 'timesheets' | 'shifts'
}

const PAGE_SIZE = 30

function getFYRange(fyStartMonth: number): { start: string; end: string } {
  const now = new Date()
  const currentMonth = now.getMonth() + 1
  let fyStartYear = now.getFullYear()
  if (currentMonth < fyStartMonth) fyStartYear--
  const startDate = new Date(fyStartYear, fyStartMonth - 1, 1)
  const endDate = new Date(fyStartYear + 1, fyStartMonth - 1, 0)
  return {
    start: toLocalDateStr(startDate),
    end: toLocalDateStr(endDate),
  }
}

export default function CheckInDashboardPanel({ source }: Props) {
  const { selectedCompanyId } = useAdminCompany()
  const { employeeEmail: adminEmail, employeeName: adminName } = useAuth()
  const companyId = selectedCompanyId || ''

  const [liveRecords, setLiveRecords] = useState<CheckinRow[]>([])
  const [history, setHistory] = useState<CheckinRow[]>([])
  const [loading, setLoading] = useState(true)
  const [employees, setEmployees] = useState<Record<string, { name: string; dept: string }>>({})
  const [locationNames, setLocationNames] = useState<Record<string, string>>({})
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(1); return toLocalDateStr(d)
  })
  const [dateTo, setDateTo] = useState(() => toLocalDateStr())
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [filterDept, setFilterDept] = useState('')
  const [rotaExpanded, setRotaExpanded] = useState(false)
  const [rotaAssignments, setRotaAssignments] = useState<ShiftAssignmentRow[]>([])
  const [shiftTemplates, setShiftTemplates] = useState<ShiftTemplateRow[]>([])
  const [exporting, setExporting] = useState(false)
  const [flagging, setFlagging] = useState(false)

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

    if (source === 'shifts') {
      const todayStr = toLocalDateStr()
      const [assignRes, tmplRes] = await Promise.all([
        supabase.from('shift_assignments').select('id, employee_id, date, shift_template_id')
          .eq('company_id', companyId).eq('date', todayStr),
        supabase.from('shift_templates').select('id, name, start_time, end_time')
          .eq('company_id', companyId),
      ])
      if (assignRes.data) setRotaAssignments(assignRes.data as ShiftAssignmentRow[])
      if (tmplRes.data) setShiftTemplates(tmplRes.data as ShiftTemplateRow[])
    }

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

  const todayStr = toLocalDateStr()
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

  const tmplMap = useMemo(() => {
    const m: Record<string, ShiftTemplateRow> = {}
    shiftTemplates.forEach(t => { m[t.id] = t })
    return m
  }, [shiftTemplates])

  const rotaEmployeeRows = useMemo(() => {
    if (source !== 'shifts' || rotaAssignments.length === 0) return []
    const now = new Date()
    const empAssignments: Record<string, ShiftAssignmentRow[]> = {}
    rotaAssignments.forEach(a => {
      if (!empAssignments[a.employee_id]) empAssignments[a.employee_id] = []
      empAssignments[a.employee_id].push(a)
    })
    return Object.entries(empAssignments).map(([empId, assigns]) => {
      const emp = employees[empId]
      const checkins = todayRecords.filter(r => r.employee_id === empId)
      const totalMins = checkins.reduce((sum, r) => {
        const end = r.check_out_at ? new Date(r.check_out_at) : now
        return sum + (end.getTime() - new Date(r.check_in_at).getTime()) / 60000
      }, 0)
      const isCheckedIn = liveRecords.some(r => r.employee_id === empId)
      const firstShift = assigns.sort((a, b) => {
        const ta = tmplMap[a.shift_template_id]?.start_time || ''
        const tb = tmplMap[b.shift_template_id]?.start_time || ''
        return ta.localeCompare(tb)
      })[0]
      const tmpl = firstShift ? tmplMap[firstShift.shift_template_id] : null
      const shiftStarted = tmpl ? now >= new Date(todayStr + 'T' + tmpl.start_time) : false
      const shiftEnded = tmpl ? now >= new Date(todayStr + 'T' + tmpl.end_time) : false
      const missed = shiftStarted && !isCheckedIn && checkins.length === 0
      return {
        empId,
        name: emp?.name || 'Unknown',
        dept: emp?.dept || '',
        shiftName: tmpl?.name || '—',
        shiftTime: tmpl ? `${tmpl.start_time.substring(0, 5)}–${tmpl.end_time.substring(0, 5)}` : '',
        totalMins: Math.round(totalMins),
        isCheckedIn,
        hasCheckedIn: checkins.length > 0,
        missed,
        shiftStarted,
        shiftEnded,
      }
    }).sort((a, b) => {
      if (a.missed && !b.missed) return -1
      if (!a.missed && b.missed) return 1
      return a.name.localeCompare(b.name)
    })
  }, [source, rotaAssignments, employees, todayRecords, liveRecords, tmplMap, todayStr])

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
  function fmtMins(mins: number) {
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return `${h}h ${m}m`
  }

  async function exportCheckinCSV() {
    setExporting(true)
    const { data: compData } = await supabase.from('companies').select('fy_start_month').eq('id', companyId).single()
    const fyMonth = compData?.fy_start_month || 4
    const fy = getFYRange(fyMonth)
    const { data: records } = await supabase.from('checkin_records').select('*')
      .eq('company_id', companyId).eq('source', source)
      .gte('check_in_at', fy.start + 'T00:00:00').lte('check_in_at', fy.end + 'T23:59:59')
      .order('check_in_at', { ascending: true })
    if (!records || records.length === 0) {
      setExporting(false)
      alert('No check-in data for the current financial year.')
      return
    }
    const empGroups: Record<string, CheckinRow[]> = {}
    records.forEach((r: CheckinRow) => {
      const name = employees[r.employee_id]?.name || r.employee_id
      if (!empGroups[name]) empGroups[name] = []
      empGroups[name].push(r)
    })
    const lines = ['Employee,Department,Date,Check In,Check Out,Duration (hrs),Location,Status']
    Object.keys(empGroups).sort().forEach(name => {
      empGroups[name].forEach(r => {
        const dept = employees[r.employee_id]?.dept || ''
        const date = fmtDate(r.check_in_at)
        const inTime = fmtTime(r.check_in_at)
        const outTime = r.check_out_at ? fmtTime(r.check_out_at) : ''
        const durHrs = r.check_out_at
          ? ((new Date(r.check_out_at).getTime() - new Date(r.check_in_at).getTime()) / 3600000).toFixed(2)
          : ''
        const loc = r.work_from_home ? 'Remote' : (r.check_in_location_id ? locationNames[r.check_in_location_id] || 'On-site' : '')
        const status = r.status === 'checked_in' ? 'In' : r.status === 'checked_out' ? 'Out' : r.status === 'auto_closed' ? 'Auto' : 'Cancelled'
        lines.push(`"${name}","${dept}","${date}","${inTime}","${outTime}","${durHrs}","${loc}","${status}"`)
      })
    })
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `checkin-export-${source}-${fy.start}-to-${fy.end}.csv`
    a.click()
    URL.revokeObjectURL(url)
    setExporting(false)
  }

  async function flagMissedCheckIns() {
    const missed = rotaEmployeeRows.filter(r => r.missed)
    if (missed.length === 0) return
    setFlagging(true)

    const { data: existing } = await supabase.from('workflow_tracker')
      .select('extra_info')
      .eq('record_type', 'Missed Check-In')
      .eq('status', 'Pending')
      .eq('company_id', companyId)

    const alreadyFlagged = new Set<string>()
    if (existing) existing.forEach((row: { extra_info: string | null }) => {
      if (row.extra_info) {
        try { const info = JSON.parse(row.extra_info); if (info.key) alreadyFlagged.add(info.key) } catch {}
      }
    })

    const inserts: any[] = []
    for (const row of missed) {
      const emp = employees[row.empId]
      const empName = emp?.name || 'Unknown'
      const key = `${row.empId}-${todayStr}-${row.shiftName}`
      if (alreadyFlagged.has(key)) continue

      inserts.push({
        emp_display_name: empName,
        step: 1,
        status: 'Pending',
        record_type: 'Missed Check-In',
        action: 'Missed shift check-in',
        employee_email: '',
        assigned_to: adminEmail,
        task_description: `${empName} did not check in for ${row.shiftName} (${row.shiftTime}) on ${formatDate(todayStr)}`,
        extra_info: JSON.stringify({ employee_id: row.empId, shift_name: row.shiftName, shift_time: row.shiftTime, date: todayStr, key }),
        company_id: companyId,
      })
    }

    if (inserts.length > 0) {
      await supabase.from('workflow_tracker').insert(inserts)
      window.dispatchEvent(new Event('notifications-updated'))
      alert(`${inserts.length} missed check-in${inserts.length > 1 ? 's' : ''} flagged.`)
    } else {
      alert('All missed check-ins have already been flagged.')
    }
    setFlagging(false)
  }

  if (loading) return <div className="admin-loading">Loading...</div>

  const liveEnriched = enriched(liveRecords)

  return (
    <div>
      {/* Metrics + Export */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, flex: 1, minWidth: 0 }}>
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
        <button className="admin-btn-sm admin-btn-save" onClick={exportCheckinCSV} disabled={exporting} style={{ flexShrink: 0 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 4, verticalAlign: 'middle' }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          {exporting ? 'Exporting...' : 'Export CSV'}
        </button>
      </div>

      {/* Rota'd Employees Today (shifts only) */}
      {source === 'shifts' && rotaAssignments.length > 0 && (
        <div className="admin-section" style={{ marginBottom: 16 }}>
          <button
            onClick={() => setRotaExpanded(!rotaExpanded)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none',
              cursor: 'pointer', padding: 0, fontSize: 14, fontWeight: 600, color: 'var(--text)',
              marginBottom: rotaExpanded ? 10 : 0, fontFamily: 'inherit',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
              style={{ transform: rotaExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
              <path d="M9 18l6-6-6-6" />
            </svg>
            Today's Rota ({rotaEmployeeRows.length} employees)
            {rotaEmployeeRows.filter(r => r.missed).length > 0 && (
              <>
                <span style={{ background: '#e53935', color: '#fff', fontSize: 11, fontWeight: 700, padding: '1px 8px', borderRadius: 10, marginLeft: 6 }}>
                  {rotaEmployeeRows.filter(r => r.missed).length} not checked in
                </span>
                <button
                  className="admin-btn-sm"
                  style={{ marginLeft: 8, fontSize: 11, padding: '2px 10px', background: '#e53935', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
                  onClick={e => { e.stopPropagation(); flagMissedCheckIns() }}
                  disabled={flagging}
                >
                  {flagging ? 'Flagging...' : 'Flag Missed'}
                </button>
              </>
            )}
          </button>
          {rotaExpanded && (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr><th>Employee</th><th>Department</th><th>Shift</th><th>Time</th><th>Check-in Hours</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {rotaEmployeeRows.map(r => (
                    <tr key={r.empId} style={r.missed ? { background: 'rgba(229,57,53,0.08)' } : undefined}>
                      <td>{r.name}</td>
                      <td>{r.dept || '—'}</td>
                      <td>{r.shiftName}</td>
                      <td>{r.shiftTime}</td>
                      <td>{r.hasCheckedIn || r.isCheckedIn ? fmtMins(r.totalMins) : '—'}</td>
                      <td>
                        {r.isCheckedIn
                          ? <span className="admin-badge admin-badge-active">Checked In</span>
                          : r.hasCheckedIn
                            ? <span className="admin-badge admin-badge-complete">Checked Out</span>
                            : r.missed
                              ? <span className="admin-badge admin-badge-cancelled">Not Checked In</span>
                              : <span className="admin-badge" style={{ background: '#f5f5f5', color: '#999' }}>Upcoming</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

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
