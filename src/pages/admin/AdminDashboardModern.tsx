import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, callRpcDirect } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { getCompanyFY } from '../../lib/companyArchive'

interface Employee {
  id: string
  first_name: string
  last_name: string
  job_title: string | null
  department: string | null
  avatar_url: string | null
  contract_type: string | null
}

interface LeaveRow {
  id: number
  employee_id: string
  start_date: string
  end_date: string
  days_requested: number
  status: string
  leave_type: { name: string } | null
  employee: { first_name: string; last_name: string; department: string | null } | null
}

interface WorkflowRow {
  id: number
  emp_display_name: string
  record_type: string
  action: string
  status: string
  approval_status: string | null
  task_description: string | null
  created_at: string
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function startOfWeek(d: Date): Date {
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  const r = new Date(d)
  r.setDate(d.getDate() + diff)
  r.setHours(0, 0, 0, 0)
  return r
}

function fmtIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

function countWorkingDays(from: Date, to: Date): number {
  let count = 0
  const d = new Date(from)
  while (d <= to) {
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6) count++
    d.setDate(d.getDate() + 1)
  }
  return count
}

function fmtRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return fmtDate(iso)
}

function initialsOf(first: string, last: string): string {
  return `${(first || '?')[0] || ''}${(last || '?')[0] || ''}`.toUpperCase()
}

function colourForType(t: string): string {
  const colors: Record<string, string> = {
    Expense: '#10b981', Leave: '#3b82f6', Timesheet: '#f59e0b',
    Meeting: '#8b5cf6', Birthday: '#ec4899', Kudos: '#eab308',
  }
  return colors[t] || '#6b7280'
}

// palette for calendar leave chips, keyed by employee id hash
const LEAVE_COLOURS = ['#3b82f6','#10b981','#f59e0b','#8b5cf6','#ec4899','#14b8a6','#f97316','#6366f1']

export default function AdminDashboardModern() {
  const navigate = useNavigate()
  const { employeeName, avatarUrl } = useAuth()
  const { selectedCompanyId, selectedCompany } = useAdminCompany()

  const [loading, setLoading] = useState(true)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [leaves, setLeaves] = useState<LeaveRow[]>([])
  const [notifications, setNotifications] = useState<WorkflowRow[]>([])
  const [leaveStats, setLeaveStats] = useState({ submitted: 0, pending: 0, approved: 0, declined: 0 })
  const [expenseStats, setExpenseStats] = useState({ submitted: 0, pending: 0, approved: 0, declined: 0 })
  const [fyLabel, setFyLabel] = useState('')
  const [deptFilter, setDeptFilter] = useState('')
  const [elearningStats, setElearningStats] = useState({ total: 0, completed: 0, rate: 0 })
  const [upcomingShifts, setUpcomingShifts] = useState(0)
  const [spacesStats, setSpacesStats] = useState({ total: 0, booked: 0, available: 0 })
  const [assetsStats, setAssetsStats] = useState({ total: 0, change: 0 })
  const [supportGrant, setSupportGrant] = useState<{ active: boolean; expires_at: string; reason: string } | null>(null)
  const [grantingAccess, setGrantingAccess] = useState(false)
  const [revokingAccess, setRevokingAccess] = useState(false)
  const [popupDate, setPopupDate] = useState<string | null>(null)
  const [empBreakdown, setEmpBreakdown] = useState({ fulltime: 0, parttime: 0, freelance: 0, ftChange: 0, flChange: 0 })
  const [attendanceRate, setAttendanceRate] = useState({ rate: 0, change: 0 , sickDays: 0, daysOff: 0, onTime: 0 })
  const [topAssets, setTopAssets] = useState<{ type: string; count: number; color: string }[]>([])

  const firstName = employeeName.split(' ')[0] || 'Admin'
  const initials = employeeName.split(' ').map(n => n[0]).join('').toUpperCase() || '?'

  useEffect(() => {
    if (selectedCompanyId) loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCompanyId])

  async function loadAll() {
    setLoading(true)
    const cid = selectedCompanyId

    const fy = await getCompanyFY(cid)
    setFyLabel(fy.label)

    const weeksStart = startOfWeek(new Date())
    const weeksEndDate = new Date(weeksStart)
    weeksEndDate.setDate(weeksStart.getDate() + 27)

    const [emp, lvCal, lvFY, expFY, notif, leaveTypes] = await Promise.all([
      supabase.from('employees')
        .select('id, first_name, last_name, job_title, department, avatar_url, contract_type')
        .eq('company_id', cid).eq('is_active', true)
        .order('first_name', { ascending: true }),
      supabase.from('leave_requests')
        .select('id, employee_id, start_date, end_date, days_requested, status, leave_type_id')
        .eq('company_id', cid)
        .lte('start_date', fmtIso(weeksEndDate))
        .gte('end_date', fmtIso(weeksStart))
        .in('status', ['pending', 'approved'])
        .order('start_date', { ascending: true }),
      supabase.from('leave_requests')
        .select('id, status', { count: 'exact' })
        .eq('company_id', cid)
        .gte('start_date', fy.start).lte('start_date', fy.end),
      supabase.from('expense_claims')
        .select('id, status, amount')
        .eq('company_id', cid)
        .gte('created_at', fy.start).lte('created_at', fy.end + 'T23:59:59'),
      supabase.from('workflow_tracker')
        .select('id, emp_display_name, record_type, action, status, approval_status, task_description, created_at')
        .eq('company_id', cid)
        .order('created_at', { ascending: false })
        .limit(20),
      supabase.from('leave_types').select('id, name').eq('company_id', cid),
    ])

    const employeeList = (emp.data as Employee[]) || []
    setEmployees(employeeList)

    // Stitch calendar leave rows with employee + leave_type client-side (avoids FK join reliability issues)
    const empMap = new Map(employeeList.map(e => [e.id, e]))
    const typeMap = new Map(((leaveTypes.data as { id: number; name: string }[]) || []).map(t => [t.id, t.name]))
    const rawLeaves = (lvCal.data as {
      id: number; employee_id: string; start_date: string; end_date: string;
      days_requested: number; status: string; leave_type_id: number | null
    }[]) || []
    const stitched: LeaveRow[] = rawLeaves.map(r => {
      const e = empMap.get(r.employee_id)
      return {
        id: r.id,
        employee_id: r.employee_id,
        start_date: (r.start_date || '').slice(0, 10),
        end_date: (r.end_date || '').slice(0, 10),
        days_requested: r.days_requested,
        status: r.status,
        leave_type: r.leave_type_id ? { name: typeMap.get(r.leave_type_id) || 'Leave' } : null,
        employee: e ? { first_name: e.first_name, last_name: e.last_name, department: e.department } : null,
      }
    })
    setLeaves(stitched)
    setNotifications((notif.data as WorkflowRow[]) || [])

    const all = (lvFY.data || []) as { status: string }[]
    setLeaveStats({
      submitted: all.length,
      pending: all.filter(r => r.status === 'pending').length,
      approved: all.filter(r => r.status === 'approved').length,
      declined: all.filter(r => r.status === 'rejected' || r.status === 'declined').length,
    })

    const allExp = (expFY.data || []) as { status: string }[]
    const activeExp = allExp.filter(r => r.status !== 'draft')
    setExpenseStats({
      submitted: activeExp.length,
      pending: activeExp.filter(r => r.status === 'pending').length,
      approved: activeExp.filter(r => r.status === 'approved').length,
      declined: activeExp.filter(r => r.status === 'rejected' || r.status === 'declined').length,
    })

    const todayStr = fmtIso(new Date())
    const monthAgo = new Date()
    monthAgo.setMonth(monthAgo.getMonth() - 1)
    const monthAgoEnd = fmtIso(monthAgo)

    const [enrolAll, enrolDone, upShifts, totalSpaces, bookedSpaces, assetsNow, assetsPrev] = await Promise.all([
      supabase.from('course_enrolments').select('id', { count: 'exact', head: true }).eq('company_id', cid),
      supabase.from('course_enrolments').select('id', { count: 'exact', head: true }).eq('company_id', cid).eq('status', 'completed'),
      supabase.from('shift_assignments').select('id', { count: 'exact', head: true }).eq('company_id', cid).gte('shift_date', todayStr),
      supabase.from('spaces').select('id', { count: 'exact', head: true }).eq('company_id', cid).eq('is_active', true),
      supabase.from('space_bookings').select('id', { count: 'exact', head: true }).eq('company_id', cid).eq('booking_date', todayStr),
      supabase.from('company_assets').select('id', { count: 'exact', head: true }).eq('company_id', cid),
      supabase.from('company_assets').select('id', { count: 'exact', head: true }).eq('company_id', cid).lte('created_at', monthAgoEnd + 'T23:59:59'),
    ])

    const eTotal = enrolAll.count || 0
    const eCompleted = enrolDone.count || 0
    setElearningStats({ total: eTotal, completed: eCompleted, rate: eTotal > 0 ? Math.round((eCompleted / eTotal) * 100) : 0 })
    setUpcomingShifts(upShifts.count || 0)
    const sTotal = totalSpaces.count || 0
    const sBooked = bookedSpaces.count || 0
    setSpacesStats({ total: sTotal, booked: sBooked, available: Math.max(0, sTotal - sBooked) })
    const aNow = assetsNow.count || 0
    const aPrev = assetsPrev.count || 0
    setAssetsStats({ total: aNow, change: aPrev > 0 ? Math.round(((aNow - aPrev) / aPrev) * 100) : 0 })

    // ── Card data: employee breakdown, attendance, top assets ──
    const empList = employeeList
    const ft = empList.filter(e => e.contract_type === 'Full-time' || !e.contract_type).length
    const fl = empList.filter(e => e.contract_type === 'Freelance').length
    const pt = empList.length - ft - fl

    const [ftPrev, flPrev] = await Promise.all([
      supabase.from('employees').select('id', { count: 'exact', head: true })
        .eq('company_id', cid).eq('is_active', true).eq('contract_type', 'Full-time').lte('created_at', monthAgoEnd + 'T23:59:59'),
      supabase.from('employees').select('id', { count: 'exact', head: true })
        .eq('company_id', cid).eq('is_active', true).eq('contract_type', 'Freelance').lte('created_at', monthAgoEnd + 'T23:59:59'),
    ])
    setEmpBreakdown({
      fulltime: ft, parttime: pt, freelance: fl,
      ftChange: ft - (ftPrev.count || 0),
      flChange: fl - (flPrev.count || 0),
    })

    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0)
    const workingDaysThis = countWorkingDays(monthStart, now)
    const workingDaysPrev = countWorkingDays(prevMonthStart, prevMonthEnd)
    const totalSlots = empList.length * workingDaysThis
    const totalSlotsPrev = empList.length * workingDaysPrev

    const [allLeaveThis, offPrev, sickLeaveTypes] = await Promise.all([
      supabase.from('leave_requests')
        .select('days_requested, leave_type_id')
        .eq('company_id', cid).eq('status', 'approved')
        .gte('start_date', fmtIso(monthStart)).lte('start_date', fmtIso(now)),
      supabase.from('leave_requests').select('days_requested')
        .eq('company_id', cid).eq('status', 'approved')
        .gte('start_date', fmtIso(prevMonthStart)).lte('start_date', fmtIso(prevMonthEnd)),
      supabase.from('leave_types').select('id').eq('company_id', cid).ilike('name', '%sick%'),
    ])

    const sickTypeIds = new Set(((sickLeaveTypes.data as { id: number }[]) || []).map(t => t.id))

    const leaveRowsThis = (allLeaveThis.data as { days_requested: number; leave_type_id: number | null }[]) || []
    const sickDaysThis = leaveRowsThis.filter(r => r.leave_type_id && sickTypeIds.has(r.leave_type_id)).reduce((s, r) => s + (r.days_requested || 0), 0)
    const totalOffThis = leaveRowsThis.reduce((s, r) => s + (r.days_requested || 0), 0)
    const daysOffThis = totalOffThis - sickDaysThis

    const offDaysPrev = ((offPrev.data as { days_requested: number }[]) || []).reduce((s, r) => s + (r.days_requested || 0), 0)
    const rateThis = totalSlots > 0 ? Math.round(((totalSlots - totalOffThis) / totalSlots) * 100) : 100
    const ratePrev = totalSlotsPrev > 0 ? Math.round(((totalSlotsPrev - offDaysPrev) / totalSlotsPrev) * 100) : 100
    setAttendanceRate({ rate: rateThis, change: rateThis - ratePrev, sickDays: Math.round(sickDaysThis), daysOff: Math.round(daysOffThis), onTime: Math.round(totalSlots - totalOffThis) })

    const { data: assetRows } = await supabase.from('company_assets')
      .select('asset_type')
      .eq('company_id', cid)
    const typeCounts: Record<string, number> = {}
    ;((assetRows as { asset_type: string }[]) || []).forEach(r => {
      typeCounts[r.asset_type] = (typeCounts[r.asset_type] || 0) + 1
    })
    const ASSET_COLOURS = ['#6366f1', '#f59e0b', '#10b981', '#ec4899', '#3b82f6']
    const sorted = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).slice(0, 3)
    setTopAssets(sorted.map(([type, count], i) => ({ type, count, color: ASSET_COLOURS[i % ASSET_COLOURS.length] })))

    await loadSupportStatus(cid)
    setLoading(false)
  }

  async function loadSupportStatus(cid: string) {
    const { data } = await supabase
      .from('tenant_support_access')
      .select('id, status, expires_at, reason')
      .eq('company_id', cid)
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString())
      .order('expires_at', { ascending: false })
      .limit(1)
    if (data && data.length > 0) {
      setSupportGrant({ active: true, expires_at: data[0].expires_at, reason: data[0].reason })
    } else {
      setSupportGrant({ active: false, expires_at: '', reason: '' })
    }
  }

  async function grantPlatformAccess() {
    setGrantingAccess(true)
    const { error } = await callRpcDirect('extend_support_access', {
      p_company_id: selectedCompanyId,
      p_hours: 48,
    })
    if (error) alert('Failed to grant access: ' + error)
    await loadSupportStatus(selectedCompanyId)
    setGrantingAccess(false)
  }

  async function revokePlatformAccess() {
    setRevokingAccess(true)
    const { data } = await supabase
      .from('tenant_support_access')
      .select('id')
      .eq('company_id', selectedCompanyId)
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString())
    if (data) {
      for (const g of data) {
        await callRpcDirect('revoke_support_access', { p_grant_id: g.id })
      }
    }
    await loadSupportStatus(selectedCompanyId)
    setRevokingAccess(false)
  }

  const departments = useMemo(() => {
    const s = new Set<string>()
    employees.forEach(e => { if (e.department) s.add(e.department) })
    return Array.from(s).sort()
  }, [employees])

  const filteredEmployees = useMemo(() => {
    if (!deptFilter) return employees
    return employees.filter(e => e.department === deptFilter)
  }, [employees, deptFilter])

  const filteredLeaves = useMemo(() => {
    if (!deptFilter) return leaves
    return leaves.filter(l => l.employee?.department === deptFilter)
  }, [leaves, deptFilter])

  // Build 4 weeks starting Monday of this week
  const weeks = useMemo(() => {
    const start = startOfWeek(new Date())
    const arr: Date[][] = []
    for (let w = 0; w < 4; w++) {
      const row: Date[] = []
      for (let d = 0; d < 7; d++) {
        const day = new Date(start)
        day.setDate(start.getDate() + w * 7 + d)
        row.push(day)
      }
      arr.push(row)
    }
    return arr
  }, [])

  const empColour = useMemo(() => {
    const m = new Map<string, string>()
    let i = 0
    for (const e of employees) {
      m.set(e.id, LEAVE_COLOURS[i % LEAVE_COLOURS.length])
      i++
    }
    return m
  }, [employees])

  const empById = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees])

  function leavesForDay(iso: string) {
    return filteredLeaves.filter(l => {
      const start = (l.start_date || '').slice(0, 10)
      const end = (l.end_date || '').slice(0, 10)
      return iso >= start && iso <= end
    })
  }

  function buildDonut(stats: { pending: number; approved: number; declined: number }) {
    const totalStates = stats.pending + stats.approved + stats.declined
    const segs = [
      { label: 'Approved', value: stats.approved, color: '#22c55e' },
      { label: 'Pending', value: stats.pending, color: '#f59e0b' },
      { label: 'Declined', value: stats.declined, color: '#ef4444' },
    ]
    const C = 2 * Math.PI * 48
    let acc = 0
    const parts = segs.map(s => {
      const frac = totalStates > 0 ? s.value / totalStates : 0
      const dash = frac * C
      const off = -acc
      acc += dash
      return { ...s, dash, gap: C - dash, off }
    })
    return { parts, C }
  }
  const leaveDonut = useMemo(() => buildDonut(leaveStats), [leaveStats])
  const expenseDonut = useMemo(() => buildDonut(expenseStats), [expenseStats])

  return (
    <>
      <style>{CSS}</style>
      <div className="dm">
        {/* ── Top Bar ── */}
        <header className="dm-topbar">
          <div className="dm-topbar-left">
            <h1 className="dm-title">Dashboard</h1>
            <p className="dm-subtitle">
              Today is {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>
          <div className="dm-topbar-right">
            <div className="dm-dept-filter">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
              </svg>
              <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
                <option value="">All departments</option>
                {departments.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <button className="dm-classic" onClick={() => navigate('/admin/dashboard-classic')} title="Classic dashboard">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
              <span>Classic view</span>
            </button>
            <div className="dm-user">
              {avatarUrl
                ? <img className="dm-user-avatar" src={avatarUrl} alt="" />
                : <div className="dm-user-avatar dm-user-avatar-init">{initials}</div>
              }
              <div className="dm-user-info">
                <span className="dm-user-name">{firstName}</span>
                <span className="dm-user-role">{selectedCompany?.name || 'Admin'}</span>
              </div>
            </div>
          </div>
        </header>

        {loading && <div className="dm-loading">Loading dashboard…</div>}

        {!loading && (<>
          {/* ── KPI Strip ── */}
          <div className="dm-kpi-strip">
            {/* E-Learning Completion */}
            <section className="dm-kpi" onClick={() => navigate('/admin/e-learning')}>
              <div className="dm-kpi-visual">
                <svg viewBox="0 0 80 80" className="dm-kpi-ring">
                  <circle cx="40" cy="40" r="32" fill="none" stroke="#e5e7eb" strokeWidth="7" />
                  <circle cx="40" cy="40" r="32" fill="none" stroke="#6366f1" strokeWidth="7"
                    strokeLinecap="round"
                    strokeDasharray={`${(elearningStats.rate / 100) * 2 * Math.PI * 32} ${2 * Math.PI * 32}`}
                    transform="rotate(-90 40 40)"
                  />
                  <text x="40" y="38" textAnchor="middle" className="dm-kpi-ring-num">{elearningStats.rate}</text>
                  <text x="40" y="50" textAnchor="middle" className="dm-kpi-ring-pct">%</text>
                </svg>
              </div>
              <div className="dm-kpi-info">
                <span className="dm-kpi-label">E-Learning</span>
                <span className="dm-kpi-detail">{elearningStats.completed}/{elearningStats.total} completed</span>
              </div>
            </section>

            {/* Upcoming Shifts */}
            <section className="dm-kpi" onClick={() => navigate('/admin/shifts-rotas')}>
              <div className="dm-kpi-visual">
                <div className="dm-kpi-icon dm-kpi-icon-shifts">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                </div>
              </div>
              <div className="dm-kpi-info">
                <span className="dm-kpi-big">{upcomingShifts}</span>
                <span className="dm-kpi-label">Upcoming Shifts</span>
              </div>
            </section>

            {/* Spaces Available Today */}
            <section className="dm-kpi" onClick={() => navigate('/admin/space-management')}>
              <div className="dm-kpi-visual">
                <div className="dm-kpi-gauge">
                  <div className="dm-kpi-gauge-track">
                    <div className="dm-kpi-gauge-fill" style={{ width: spacesStats.total > 0 ? `${Math.min(100, (spacesStats.booked / spacesStats.total) * 100)}%` : '0%' }} />
                  </div>
                  <span className="dm-kpi-gauge-label">{spacesStats.booked}/{spacesStats.total} booked</span>
                </div>
              </div>
              <div className="dm-kpi-info">
                <span className="dm-kpi-big">{spacesStats.available}</span>
                <span className="dm-kpi-label">Spaces Available</span>
                <span className="dm-kpi-detail">Today</span>
              </div>
            </section>

            {/* Assets Registered */}
            <section className="dm-kpi" onClick={() => navigate('/admin/asset-management')}>
              <div className="dm-kpi-visual">
                <div className="dm-kpi-icon dm-kpi-icon-assets">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><polyline points="17 2 12 7 7 2" />
                  </svg>
                </div>
              </div>
              <div className="dm-kpi-info">
                <span className="dm-kpi-big">{assetsStats.total}</span>
                <span className="dm-kpi-label">Assets Registered</span>
                {assetsStats.change !== 0 && (
                  <span className={`dm-kpi-change ${assetsStats.change > 0 ? 'dm-kpi-up' : 'dm-kpi-down'}`}>
                    <svg viewBox="0 0 12 12" width="12" height="12">
                      {assetsStats.change > 0
                        ? <path d="M6 2L10 7H2L6 2Z" fill="currentColor" />
                        : <path d="M6 10L2 5H10L6 10Z" fill="currentColor" />
                      }
                    </svg>
                    {Math.abs(assetsStats.change)}% vs last month
                  </span>
                )}
              </div>
            </section>
          </div>

          {/* ── Insight Cards ── */}
          <div className="dm-insight-strip">
            {/* Total Employees */}
            <section className="dm-insight-card" onClick={() => navigate('/admin/employees')}>
              <div className="dm-insight-head">
                <span className="dm-insight-title">Total Employees</span>
                <span className="dm-insight-dots">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
                </span>
              </div>
              <div className="dm-insight-body dm-insight-emp">
                <div className="dm-emp-col">
                  <div className="dm-emp-row-big">
                    <span className="dm-emp-num">{empBreakdown.fulltime}</span>
                    {empBreakdown.ftChange !== 0 && (
                      <span className={`dm-emp-badge ${empBreakdown.ftChange > 0 ? 'dm-emp-badge-up' : 'dm-emp-badge-down'}`}>
                        <svg width="10" height="10" viewBox="0 0 12 12"><path d={empBreakdown.ftChange > 0 ? 'M6 2L10 7H2Z' : 'M6 10L2 5H10Z'} fill="currentColor"/></svg>
                        {Math.abs(empBreakdown.ftChange)}
                      </span>
                    )}
                  </div>
                  <div className="dm-emp-row-big">
                    <span className="dm-emp-num dm-emp-num-sm">{empBreakdown.freelance}</span>
                    {empBreakdown.flChange !== 0 && (
                      <span className={`dm-emp-badge ${empBreakdown.flChange > 0 ? 'dm-emp-badge-up' : 'dm-emp-badge-down'}`}>
                        <svg width="10" height="10" viewBox="0 0 12 12"><path d={empBreakdown.flChange > 0 ? 'M6 2L10 7H2Z' : 'M6 10L2 5H10Z'} fill="currentColor"/></svg>
                        {Math.abs(empBreakdown.flChange)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="dm-emp-col dm-emp-labels">
                  <div className="dm-emp-bar-row">
                    <div className="dm-emp-bar"><div className="dm-emp-bar-fill dm-emp-bar-ft" style={{ width: employees.length > 0 ? `${(empBreakdown.fulltime / employees.length) * 100}%` : '0%' }}/></div>
                    <span className="dm-emp-bar-label">Full-time</span>
                  </div>
                  <div className="dm-emp-bar-row">
                    <div className="dm-emp-bar"><div className="dm-emp-bar-fill dm-emp-bar-fl" style={{ width: employees.length > 0 ? `${(empBreakdown.freelance / employees.length) * 100}%` : '0%' }}/></div>
                    <span className="dm-emp-bar-label">Freelance</span>
                  </div>
                </div>
              </div>
            </section>

            {/* Attendance Overview */}
            <section className="dm-insight-card">
              <div className="dm-insight-head">
                <span className="dm-insight-title">Attendance Overview</span>
                <span className="dm-insight-dots">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
                </span>
              </div>
              <div className="dm-insight-body dm-insight-attend">
                <div className="dm-attend-left">
                  <div className="dm-attend-ring-wrap">
                    <svg viewBox="0 0 100 100" className="dm-attend-ring">
                      <circle cx="50" cy="50" r="40" fill="none" stroke="#f3f4f6" strokeWidth="10"/>
                      <circle cx="50" cy="50" r="40" fill="none" stroke="#8b5cf6" strokeWidth="10"
                        strokeLinecap="round"
                        strokeDasharray={`${(attendanceRate.rate / 100) * 2 * Math.PI * 40} ${2 * Math.PI * 40}`}
                        transform="rotate(-90 50 50)"/>
                      <text x="50" y="48" textAnchor="middle" className="dm-attend-num">{attendanceRate.rate}%</text>
                    </svg>
                  </div>
                  <div className={`dm-attend-change ${attendanceRate.change >= 0 ? 'dm-attend-up' : 'dm-attend-down'}`}>
                    <svg width="10" height="10" viewBox="0 0 12 12"><path d={attendanceRate.change >= 0 ? 'M6 2L10 7H2Z' : 'M6 10L2 5H10Z'} fill="currentColor"/></svg>
                    {Math.abs(attendanceRate.change)}% <span className="dm-attend-since">since last month</span>
                  </div>
                </div>
                <div className="dm-attend-legend">
                  <div className="dm-attend-legend-row"><span className="dm-attend-dot" style={{ background: '#10b981' }}/> <span>On time</span> <span className="dm-attend-legend-val">{attendanceRate.onTime}</span></div>
                  <div className="dm-attend-legend-row"><span className="dm-attend-dot" style={{ background: '#f59e0b' }}/> <span>Day Off</span> <span className="dm-attend-legend-val">{attendanceRate.daysOff}</span></div>
                  <div className="dm-attend-legend-row"><span className="dm-attend-dot" style={{ background: '#8b5cf6' }}/> <span>Sick Leave</span> <span className="dm-attend-legend-val">{attendanceRate.sickDays}</span></div>
                </div>
              </div>
            </section>

            {/* Assets Deployed */}
            <section className="dm-insight-card" onClick={() => navigate('/admin/asset-management')}>
              <div className="dm-insight-head">
                <span className="dm-insight-title">Assets Deployed</span>
                <span className="dm-insight-dots">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
                </span>
              </div>
              <div className="dm-insight-body dm-insight-assets">
                <div className="dm-asset-gauge-wrap">
                  <svg viewBox="0 0 120 70" className="dm-asset-gauge">
                    <path d="M10 65 A50 50 0 0 1 110 65" fill="none" stroke="#e5e7eb" strokeWidth="10" strokeLinecap="round"/>
                    {(() => {
                      const total = assetsStats.total
                      const maxVal = Math.max(total, 1)
                      let offset = 0
                      return topAssets.map((a, i) => {
                        const frac = a.count / maxVal
                        const arcLen = frac * Math.PI * 50
                        const totalArc = Math.PI * 50
                        const el = (
                          <path key={i} d="M10 65 A50 50 0 0 1 110 65" fill="none" stroke={a.color} strokeWidth="10"
                            strokeLinecap="round"
                            strokeDasharray={`${arcLen} ${totalArc}`}
                            strokeDashoffset={-offset}
                          />
                        )
                        offset += arcLen
                        return el
                      })
                    })()}
                    <text x="60" y="55" textAnchor="middle" className="dm-asset-gauge-num">{assetsStats.total}</text>
                    <text x="60" y="67" textAnchor="middle" className="dm-asset-gauge-lbl">Overall</text>
                  </svg>
                </div>
                <div className="dm-asset-list">
                  {topAssets.map((a, i) => (
                    <div key={i} className="dm-asset-list-row">
                      <span className="dm-asset-dot" style={{ background: a.color }}/>
                      <span className="dm-asset-count">{String(a.count).padStart(2, '0')}</span>
                      <span className="dm-asset-type">{a.type}</span>
                    </div>
                  ))}
                  {topAssets.length === 0 && <span className="dm-empty" style={{ padding: 8, fontSize: 12 }}>No assets</span>}
                </div>
              </div>
            </section>
          </div>

          <div className="dm-grid">
            {/* ── Leave Calendar (Hiring slot) ── */}
            <section className="dm-card dm-card-cal">
              <div className="dm-card-head">
                <h2 className="dm-card-title">Leave Calendar</h2>
                <button className="dm-view-all" onClick={() => navigate('/admin/leave')}>
                  View all <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
              </div>
              <p className="dm-card-sub">Next 4 weeks · people away shown as colour blocks</p>
              <div className="dm-cal">
                <div className="dm-cal-headrow">
                  {WEEKDAYS.map(w => <div key={w} className="dm-cal-headcell">{w}</div>)}
                </div>
                {weeks.map((week, wi) => (
                  <div key={wi} className="dm-cal-row">
                    {week.map(day => {
                      const iso = fmtIso(day)
                      const isToday = iso === fmtIso(new Date())
                      const isWeekend = day.getDay() === 0 || day.getDay() === 6
                      const all = leavesForDay(iso)
                      const hasApproved = all.some(l => l.status === 'approved')
                      const hasPending = all.some(l => l.status === 'pending')
                      const hasHalf = all.some(l => Number(l.days_requested) === 0.5 && l.start_date === l.end_date)
                      const statusClass = hasApproved ? 'dm-cal-approved' : hasPending ? 'dm-cal-pending' : ''
                      const preview = all.slice(0, 2)
                      const extra = all.length - preview.length
                      return (
                        <div key={iso} className={`dm-cal-cell ${statusClass} ${isToday ? 'dm-cal-today' : ''} ${isWeekend ? 'dm-cal-weekend' : ''} ${hasHalf ? 'dm-cal-half' : ''}`}>
                          <span className="dm-cal-num">{day.getDate()}</span>
                          <div className="dm-cal-chips">
                            {preview.map(l => {
                              const half = Number(l.days_requested) === 0.5 && l.start_date === l.end_date
                              return (
                                <div
                                  key={l.id}
                                  className={`dm-cal-chip ${l.status === 'pending' ? 'dm-cal-chip-pending' : ''} ${half ? 'dm-cal-chip-half' : ''}`}
                                  style={{ background: empColour.get(l.employee_id) || '#6b7280' }}
                                  title={`${l.employee?.first_name} ${l.employee?.last_name} — ${l.leave_type?.name || 'Leave'} (${l.status}${half ? ', half day' : ''})`}
                                >
                                  {(l.employee?.first_name || '?')[0]}{(l.employee?.last_name || '?')[0]}{half ? ' ½' : ''}
                                </div>
                              )
                            })}
                            {extra > 0 && (
                              <button className="dm-cal-chip dm-cal-chip-expand" onClick={() => setPopupDate(iso)}>
                                +{extra} <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                              </button>
                            )}
                          </div>
                          {all.length > 0 && all.length <= 2 && (
                            <button className="dm-cal-more-btn" onClick={() => setPopupDate(iso)} title="View details">
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
              <div className="dm-cal-legend">
                <span className="dm-cal-legend-item"><span className="dm-cal-legend-swatch dm-cal-legend-approved"/>Approved</span>
                <span className="dm-cal-legend-item"><span className="dm-cal-legend-swatch dm-cal-legend-pending"/>Pending</span>
                <span className="dm-cal-legend-item"><span className="dm-cal-legend-swatch dm-cal-legend-half"/>Half day</span>
              </div>

              {popupDate && (() => {
                const dayLeaves = leavesForDay(popupDate)
                  .sort((a, b) => {
                    const an = `${a.employee?.first_name || ''} ${a.employee?.last_name || ''}`.toLowerCase()
                    const bn = `${b.employee?.first_name || ''} ${b.employee?.last_name || ''}`.toLowerCase()
                    return an.localeCompare(bn)
                  })
                const popupD = new Date(popupDate + 'T00:00:00')
                const dateLabel = `${String(popupD.getDate()).padStart(2, '0')}/${String(popupD.getMonth() + 1).padStart(2, '0')}/${popupD.getFullYear()}`
                return (
                  <div className="dm-cal-popup-overlay" onClick={() => setPopupDate(null)}>
                    <div className="dm-cal-popup" onClick={e => e.stopPropagation()}>
                      <div className="dm-cal-popup-head">
                        <h3 className="dm-cal-popup-title">On Leave — {dateLabel}</h3>
                        <button className="dm-cal-popup-close" onClick={() => setPopupDate(null)}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                      </div>
                      <div className="dm-cal-popup-count">{dayLeaves.length} {dayLeaves.length === 1 ? 'person' : 'people'} off</div>
                      <div className="dm-cal-popup-list">
                        {dayLeaves.map(l => {
                          const emp = empById.get(l.employee_id)
                          const half = Number(l.days_requested) === 0.5 && l.start_date === l.end_date
                          return (
                            <div key={l.id} className="dm-cal-popup-row">
                              <div className="dm-cal-popup-avatar">
                                {emp?.avatar_url
                                  ? <img src={emp.avatar_url} alt="" className="dm-cal-popup-img" />
                                  : <span className="dm-cal-popup-initials" style={{ background: empColour.get(l.employee_id) || '#6b7280' }}>
                                      {(l.employee?.first_name || '?')[0]}{(l.employee?.last_name || '?')[0]}
                                    </span>
                                }
                              </div>
                              <div className="dm-cal-popup-info">
                                <span className="dm-cal-popup-name">{l.employee?.first_name} {l.employee?.last_name}</span>
                                <span className="dm-cal-popup-dept">{l.employee?.department || '—'}</span>
                              </div>
                              <div className="dm-cal-popup-meta">
                                <span className={`dm-cal-popup-status dm-cal-popup-status-${l.status}`}>{l.status}{half ? ' (½)' : ''}</span>
                                <span className="dm-cal-popup-type">{l.leave_type?.name || 'Leave'}</span>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )
              })()}
            </section>

            {/* ── Leave Donut ── */}
            <section className="dm-card dm-card-leave">
              <div className="dm-card-head">
                <h2 className="dm-card-title">Leave Requests</h2>
                <button className="dm-view-all" onClick={() => navigate('/admin/leave')}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
                </button>
              </div>
              <p className="dm-card-sub">FY {fyLabel || '—'}</p>
              <div className="dm-donut-row">
                <svg viewBox="0 0 128 128" className="dm-donut-sm">
                  <circle cx="64" cy="64" r="48" fill="none" stroke="#f3f4f6" strokeWidth="14" />
                  {leaveDonut.parts.map((p, i) => (
                    p.value > 0 && (
                      <circle key={i} cx="64" cy="64" r="48" fill="none"
                        stroke={p.color} strokeWidth="14"
                        strokeDasharray={`${p.dash} ${p.gap}`}
                        strokeDashoffset={p.off}
                        transform="rotate(-90 64 64)"
                      />
                    )
                  ))}
                  <text x="64" y="62" textAnchor="middle" className="dm-donut-num-sm">{leaveStats.submitted}</text>
                  <text x="64" y="78" textAnchor="middle" className="dm-donut-lbl-sm">SUBMITTED</text>
                </svg>
                <div className="dm-donut-legend">
                  <div className="dm-legend-row"><span className="dm-legend-dot" style={{ background: '#22c55e' }}/> <span className="dm-legend-lbl">Approved</span> <span className="dm-legend-val">{leaveStats.approved}</span></div>
                  <div className="dm-legend-row"><span className="dm-legend-dot" style={{ background: '#f59e0b' }}/> <span className="dm-legend-lbl">Pending</span> <span className="dm-legend-val">{leaveStats.pending}</span></div>
                  <div className="dm-legend-row"><span className="dm-legend-dot" style={{ background: '#ef4444' }}/> <span className="dm-legend-lbl">Declined</span> <span className="dm-legend-val">{leaveStats.declined}</span></div>
                </div>
              </div>
            </section>

            {/* ── Expense Donut ── */}
            <section className="dm-card dm-card-expense">
              <div className="dm-card-head">
                <h2 className="dm-card-title">Expenses</h2>
                <button className="dm-view-all" onClick={() => navigate('/admin/expenses')}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
                </button>
              </div>
              <p className="dm-card-sub">FY {fyLabel || '—'}</p>
              <div className="dm-donut-row">
                <svg viewBox="0 0 128 128" className="dm-donut-sm">
                  <circle cx="64" cy="64" r="48" fill="none" stroke="#f3f4f6" strokeWidth="14" />
                  {expenseDonut.parts.map((p, i) => (
                    p.value > 0 && (
                      <circle key={i} cx="64" cy="64" r="48" fill="none"
                        stroke={p.color} strokeWidth="14"
                        strokeDasharray={`${p.dash} ${p.gap}`}
                        strokeDashoffset={p.off}
                        transform="rotate(-90 64 64)"
                      />
                    )
                  ))}
                  <text x="64" y="62" textAnchor="middle" className="dm-donut-num-sm">{expenseStats.submitted}</text>
                  <text x="64" y="78" textAnchor="middle" className="dm-donut-lbl-sm">SUBMITTED</text>
                </svg>
                <div className="dm-donut-legend">
                  <div className="dm-legend-row"><span className="dm-legend-dot" style={{ background: '#22c55e' }}/> <span className="dm-legend-lbl">Approved</span> <span className="dm-legend-val">{expenseStats.approved}</span></div>
                  <div className="dm-legend-row"><span className="dm-legend-dot" style={{ background: '#f59e0b' }}/> <span className="dm-legend-lbl">Pending</span> <span className="dm-legend-val">{expenseStats.pending}</span></div>
                  <div className="dm-legend-row"><span className="dm-legend-dot" style={{ background: '#ef4444' }}/> <span className="dm-legend-lbl">Declined</span> <span className="dm-legend-val">{expenseStats.declined}</span></div>
                </div>
              </div>
            </section>

            {/* ── Notifications (My Task slot) ── */}
            <section className="dm-card dm-card-tasks">
              <div className="dm-card-head">
                <h2 className="dm-card-title">Latest Notifications</h2>
                <button className="dm-view-all" onClick={() => navigate('/admin/notifications')}>
                  View all <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
              </div>
              <p className="dm-card-sub">Recent activity across all employees</p>
              <div className="dm-tasks">
                {notifications.length === 0 && <p className="dm-empty">No recent notifications</p>}
                {notifications.slice(0, 8).map(n => (
                  <button key={n.id} className="dm-task-row" onClick={() => navigate('/admin/notifications')}>
                    <span className="dm-task-bar" style={{ background: colourForType(n.record_type) }} />
                    <div className="dm-task-time">{fmtRelative(n.created_at)}</div>
                    <div className="dm-task-body">
                      <span className="dm-task-desc">
                        <strong>{n.emp_display_name}</strong> — {n.record_type} · {n.action}
                        {n.task_description ? ` · ${n.task_description}` : ''}
                      </span>
                    </div>
                    <span className={`dm-task-badge ${n.status.toLowerCase() === 'complete' ? 'dm-task-done' : 'dm-task-open'}`}>
                      {n.approval_status || n.status}
                    </span>
                  </button>
                ))}
              </div>
            </section>

            {/* ── Employees (Employee slot) ── */}
            <section className="dm-card dm-card-emps">
              <div className="dm-card-head">
                <h2 className="dm-card-title">Employees</h2>
                <button className="dm-view-all" onClick={() => navigate('/admin/employees')}>
                  View all <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
              </div>
              <p className="dm-card-sub">{filteredEmployees.length} {deptFilter || 'total'}</p>
              <div className="dm-emp-scroll">
                {filteredEmployees.length === 0 && <p className="dm-empty">No employees</p>}
                {filteredEmployees.map(e => (
                  <button key={e.id} className="dm-emp-row" onClick={() => navigate('/admin/employees')}>
                    {e.avatar_url
                      ? <img className="dm-emp-avatar" src={e.avatar_url} alt="" />
                      : <div className="dm-emp-avatar dm-emp-avatar-init">{initialsOf(e.first_name, e.last_name)}</div>
                    }
                    <div className="dm-emp-info">
                      <span className="dm-emp-name">{e.first_name} {e.last_name}</span>
                      <span className="dm-emp-role">{e.job_title || '—'}{e.department ? ` · ${e.department}` : ''}</span>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          </div>

          {supportGrant && (
            <section className="dm-card dm-support">
              <div className="dm-card-head">
                <h2 className="dm-card-title">Platform Support Access</h2>
                <span className={`dm-support-badge ${supportGrant.active ? 'dm-support-active' : 'dm-support-inactive'}`}>
                  {supportGrant.active ? 'Access Granted' : 'No Access'}
                </span>
              </div>
              <p className="dm-card-sub">Control whether the InflowHR platform team can access your company data for support</p>

              {supportGrant.active && (
                <div className="dm-support-info">
                  <strong>Active until:</strong>{' '}
                  {new Date(supportGrant.expires_at).toLocaleDateString('en-GB')}{' '}
                  {new Date(supportGrant.expires_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                  {supportGrant.reason && <> &mdash; <em>{supportGrant.reason}</em></>}
                </div>
              )}

              <div className="dm-support-actions">
                {!supportGrant.active ? (
                  <button className="dm-support-btn dm-support-grant" onClick={grantPlatformAccess} disabled={grantingAccess}>
                    {grantingAccess ? 'Granting...' : 'Grant Platform Access (48h)'}
                  </button>
                ) : (
                  <>
                    <button className="dm-support-btn dm-support-grant" onClick={grantPlatformAccess} disabled={grantingAccess}>
                      {grantingAccess ? 'Extending...' : 'Extend 48h'}
                    </button>
                    <button className="dm-support-btn dm-support-revoke" onClick={revokePlatformAccess} disabled={revokingAccess}>
                      {revokingAccess ? 'Revoking...' : 'Revoke Access'}
                    </button>
                  </>
                )}
              </div>
            </section>
          )}
        </>)}
      </div>
    </>
  )
}

const CSS = `
.dm { padding: 20px; background: #f4f5fb; min-height: calc(100vh - 56px); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }

/* Top bar */
.dm-topbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
.dm-topbar-left { min-width: 0; }
.dm-title { margin: 0; font-size: 26px; font-weight: 800; color: #0f172a; }
.dm-subtitle { margin: 4px 0 0; font-size: 13px; color: #64748b; }
.dm-topbar-right { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.dm-dept-filter { display: flex; align-items: center; gap: 8px; background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 8px 14px; color: #64748b; }
.dm-dept-filter select { border: none; background: none; font-size: 13px; font-weight: 600; color: #0f172a; cursor: pointer; outline: none; font-family: inherit; padding-right: 4px; }
.dm-classic { display: flex; align-items: center; gap: 6px; background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 8px 14px; font-size: 13px; font-weight: 600; color: #475569; cursor: pointer; font-family: inherit; }
.dm-classic:hover { background: #f1f5f9; }
.dm-user { display: flex; align-items: center; gap: 10px; background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 6px 14px 6px 6px; }
.dm-user-avatar { width: 34px; height: 34px; border-radius: 50%; object-fit: cover; }
.dm-user-avatar-init { display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #fff; font-size: 13px; font-weight: 700; }
.dm-user-info { display: flex; flex-direction: column; line-height: 1.1; }
.dm-user-name { font-size: 13px; font-weight: 700; color: #0f172a; }
.dm-user-role { font-size: 11px; color: #94a3b8; }

.dm-loading { padding: 60px; text-align: center; color: #94a3b8; }

/* KPI Strip */
.dm-kpi-strip { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 16px; }
.dm-kpi { display: flex; align-items: center; gap: 14px; background: #fff; border-radius: 16px; padding: 18px 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); border: 1px solid #eef0f4; cursor: pointer; transition: box-shadow 0.2s, transform 0.15s; }
.dm-kpi:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.08); transform: translateY(-1px); }
.dm-kpi-visual { flex-shrink: 0; }
.dm-kpi-ring { width: 64px; height: 64px; }
.dm-kpi-ring-num { font-size: 18px; font-weight: 800; fill: #0f172a; }
.dm-kpi-ring-pct { font-size: 9px; font-weight: 700; fill: #94a3b8; letter-spacing: 0.04em; }
.dm-kpi-icon { width: 52px; height: 52px; border-radius: 14px; display: flex; align-items: center; justify-content: center; }
.dm-kpi-icon svg { width: 26px; height: 26px; }
.dm-kpi-icon-shifts { background: linear-gradient(135deg, #dbeafe, #bfdbfe); color: #2563eb; }
.dm-kpi-icon-assets { background: linear-gradient(135deg, #fce7f3, #fbcfe8); color: #db2777; }
.dm-kpi-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.dm-kpi-big { font-size: 28px; font-weight: 800; color: #0f172a; line-height: 1; }
.dm-kpi-label { font-size: 13px; font-weight: 700; color: #475569; }
.dm-kpi-detail { font-size: 11px; color: #94a3b8; }
.dm-kpi-gauge { display: flex; flex-direction: column; gap: 4px; width: 64px; }
.dm-kpi-gauge-track { height: 8px; background: #e5e7eb; border-radius: 4px; overflow: hidden; }
.dm-kpi-gauge-fill { height: 100%; background: linear-gradient(90deg, #10b981, #059669); border-radius: 4px; transition: width 0.4s ease; }
.dm-kpi-gauge-label { font-size: 10px; color: #94a3b8; font-weight: 600; white-space: nowrap; }
.dm-kpi-change { display: flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 700; }
.dm-kpi-up { color: #16a34a; }
.dm-kpi-down { color: #dc2626; }

/* Grid */
.dm-grid { display: grid; grid-template-columns: 2fr 1fr; grid-template-rows: 1fr 1fr auto; gap: 16px; }
.dm-card-cal { grid-column: 1; grid-row: 1 / span 2; }
.dm-card-leave { grid-column: 2; grid-row: 1; }
.dm-card-expense { grid-column: 2; grid-row: 2; }
.dm-card-tasks { grid-column: 1; grid-row: 3; }
.dm-card-emps { grid-column: 2; grid-row: 3; }

.dm-card { background: #fff; border-radius: 16px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); border: 1px solid #eef0f4; }
.dm-card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
.dm-card-title { margin: 0; font-size: 16px; font-weight: 800; color: #0f172a; }
.dm-card-sub { margin: 0 0 14px; font-size: 12px; color: #94a3b8; }
.dm-view-all { display: flex; align-items: center; gap: 4px; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 6px 10px; font-size: 12px; font-weight: 600; color: #475569; cursor: pointer; font-family: inherit; }
.dm-view-all:hover { background: #f1f5f9; }
.dm-empty { color: #94a3b8; font-size: 13px; text-align: center; padding: 20px; }

/* Calendar */
.dm-cal { display: flex; flex-direction: column; gap: 4px; }
.dm-cal-headrow, .dm-cal-row { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
.dm-cal-headcell { text-align: center; font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.04em; padding: 6px 0; }
.dm-cal-cell { position: relative; min-height: 78px; background: #f8fafc; border: 1px solid #eef0f4; border-radius: 8px; padding: 6px; display: flex; flex-direction: column; gap: 4px; overflow: hidden; }
.dm-cal-weekend { background: #f1f5f9; opacity: 0.7; }
.dm-cal-today { border-color: #6366f1; box-shadow: inset 0 0 0 1px #6366f1; }
.dm-cal-approved { background: #dcfce7; border-color: #86efac; }
.dm-cal-pending { background: #fef3c7; border-color: #fcd34d; }
.dm-cal-half.dm-cal-approved { background: linear-gradient(135deg, #dcfce7 0%, #dcfce7 50%, #f8fafc 50%, #f8fafc 100%); }
.dm-cal-half.dm-cal-pending { background: linear-gradient(135deg, #fef3c7 0%, #fef3c7 50%, #f8fafc 50%, #f8fafc 100%); }
.dm-cal-num { font-size: 12px; font-weight: 700; color: #475569; position: relative; z-index: 1; }
.dm-cal-today .dm-cal-num { color: #4338ca; }
.dm-cal-approved .dm-cal-num { color: #14532d; }
.dm-cal-pending .dm-cal-num { color: #78350f; }
.dm-cal-chips { display: flex; flex-direction: column; gap: 3px; overflow: hidden; position: relative; z-index: 1; }
.dm-cal-chip { display: flex; align-items: center; justify-content: center; height: 18px; border-radius: 4px; color: #fff; font-size: 10px; font-weight: 700; padding: 0 4px; box-shadow: 0 0 0 1px rgba(255,255,255,0.5); }
.dm-cal-chip-pending { opacity: 0.85; border: 1.5px dashed rgba(255,255,255,0.8); }
.dm-cal-chip-half { background-image: linear-gradient(90deg, currentColor 50%, rgba(255,255,255,0.4) 50%) !important; }
.dm-cal-chip-more { background: #cbd5e1 !important; color: #475569; box-shadow: none; }

.dm-cal-legend { display: flex; gap: 14px; align-items: center; margin-top: 10px; padding-top: 10px; border-top: 1px solid #eef0f4; flex-wrap: wrap; }
.dm-cal-legend-item { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #64748b; font-weight: 600; }
.dm-cal-legend-swatch { width: 14px; height: 14px; border-radius: 4px; border: 1px solid #cbd5e1; }
.dm-cal-legend-approved { background: #dcfce7; border-color: #86efac; }
.dm-cal-legend-pending { background: #fef3c7; border-color: #fcd34d; }
.dm-cal-legend-half { background: linear-gradient(135deg, #dcfce7 0%, #dcfce7 50%, #f8fafc 50%, #f8fafc 100%); border-color: #86efac; }

.dm-cal-chip-expand { background: #e2e8f0 !important; color: #475569; box-shadow: none; border: none; cursor: pointer; font-family: inherit; display: flex; align-items: center; gap: 3px; height: 18px; border-radius: 4px; font-size: 10px; font-weight: 700; padding: 0 6px; }
.dm-cal-chip-expand:hover { background: #cbd5e1 !important; }
.dm-cal-more-btn { position: absolute; bottom: 3px; right: 3px; width: 16px; height: 16px; border-radius: 50%; background: #e2e8f0; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; color: #64748b; padding: 0; z-index: 2; }
.dm-cal-more-btn:hover { background: #cbd5e1; }

.dm-cal-popup-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.35); display: flex; align-items: center; justify-content: center; z-index: 1000; animation: dm-fade-in 0.15s ease-out; }
@keyframes dm-fade-in { from { opacity: 0; } to { opacity: 1; } }
.dm-cal-popup { background: #fff; border-radius: 14px; box-shadow: 0 20px 60px rgba(0,0,0,0.18); width: 420px; max-width: calc(100vw - 32px); max-height: 80vh; display: flex; flex-direction: column; animation: dm-slide-up 0.2s ease-out; }
@keyframes dm-slide-up { from { transform: translateY(12px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
.dm-cal-popup-head { display: flex; align-items: center; justify-content: space-between; padding: 18px 20px 0; }
.dm-cal-popup-title { margin: 0; font-size: 16px; font-weight: 700; color: #0f172a; }
.dm-cal-popup-close { background: none; border: none; cursor: pointer; color: #94a3b8; padding: 4px; border-radius: 6px; display: flex; }
.dm-cal-popup-close:hover { background: #f1f5f9; color: #475569; }
.dm-cal-popup-count { padding: 4px 20px 14px; font-size: 12px; color: #94a3b8; font-weight: 600; border-bottom: 1px solid #f1f5f9; }
.dm-cal-popup-list { overflow-y: auto; padding: 8px 12px 12px; display: flex; flex-direction: column; gap: 2px; }
.dm-cal-popup-row { display: flex; align-items: center; gap: 12px; padding: 10px 8px; border-radius: 10px; }
.dm-cal-popup-row:hover { background: #f8fafc; }
.dm-cal-popup-avatar { flex-shrink: 0; }
.dm-cal-popup-img { width: 36px; height: 36px; border-radius: 50%; object-fit: cover; }
.dm-cal-popup-initials { width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 12px; font-weight: 700; }
.dm-cal-popup-info { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.dm-cal-popup-name { font-size: 13px; font-weight: 700; color: #0f172a; }
.dm-cal-popup-dept { font-size: 11px; color: #94a3b8; }
.dm-cal-popup-meta { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; flex-shrink: 0; }
.dm-cal-popup-status { font-size: 11px; font-weight: 700; text-transform: capitalize; padding: 2px 8px; border-radius: 999px; }
.dm-cal-popup-status-approved { background: #dcfce7; color: #15803d; }
.dm-cal-popup-status-pending { background: #fef3c7; color: #92400e; }
.dm-cal-popup-type { font-size: 10px; color: #94a3b8; }

/* Insight Cards */
.dm-insight-strip { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 20px; }
.dm-insight-card { background: #fff; border-radius: 14px; border: 1px solid #eef0f4; padding: 18px 20px; cursor: pointer; transition: box-shadow 0.2s, transform 0.15s; }
.dm-insight-card:hover { box-shadow: 0 4px 20px rgba(0,0,0,0.06); transform: translateY(-1px); }
.dm-insight-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.dm-insight-title { font-size: 13px; font-weight: 700; color: #475569; letter-spacing: 0.01em; }
.dm-insight-dots { opacity: 0.5; }
.dm-insight-body { display: flex; gap: 16px; align-items: center; }

/* Employees card */
.dm-insight-emp { gap: 20px; }
.dm-emp-col { display: flex; flex-direction: column; gap: 10px; }
.dm-emp-row-big { display: flex; align-items: center; gap: 8px; }
.dm-emp-num { font-size: 28px; font-weight: 800; color: #0f172a; line-height: 1; }
.dm-emp-num-sm { font-size: 22px; color: #475569; }
.dm-emp-badge { display: inline-flex; align-items: center; gap: 3px; font-size: 11px; font-weight: 700; padding: 2px 7px; border-radius: 6px; }
.dm-emp-badge-up { background: #dcfce7; color: #15803d; }
.dm-emp-badge-down { background: #fee2e2; color: #dc2626; }
.dm-emp-labels { flex: 1; min-width: 0; gap: 12px; }
.dm-emp-bar-row { display: flex; flex-direction: column; gap: 4px; }
.dm-emp-bar { height: 8px; background: #f1f5f9; border-radius: 4px; overflow: hidden; width: 100%; }
.dm-emp-bar-fill { height: 100%; border-radius: 4px; transition: width 0.5s ease; }
.dm-emp-bar-ft { background: linear-gradient(90deg, #f59e0b, #fbbf24); }
.dm-emp-bar-fl { background: linear-gradient(90deg, #10b981, #34d399); }
.dm-emp-bar-label { font-size: 11px; color: #94a3b8; font-weight: 600; }

/* Attendance card */
.dm-insight-attend { gap: 16px; }
.dm-attend-left { display: flex; flex-direction: column; align-items: center; gap: 8px; flex-shrink: 0; }
.dm-attend-ring-wrap { width: 90px; height: 90px; }
.dm-attend-ring { width: 100%; height: 100%; }
.dm-attend-num { font-size: 18px; font-weight: 800; fill: #0f172a; }
.dm-attend-change { display: flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 700; white-space: nowrap; }
.dm-attend-up { color: #15803d; }
.dm-attend-down { color: #dc2626; }
.dm-attend-since { color: #94a3b8; font-weight: 500; }
.dm-attend-legend { display: flex; flex-direction: column; gap: 8px; flex: 1; min-width: 0; }
.dm-attend-legend-row { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #475569; font-weight: 500; }
.dm-attend-legend-row span:last-child { margin-left: auto; }
.dm-attend-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.dm-attend-legend-val { font-weight: 700; color: #0f172a; }

/* Assets card */
.dm-insight-assets { gap: 12px; }
.dm-asset-gauge-wrap { flex-shrink: 0; width: 110px; }
.dm-asset-gauge { width: 100%; height: auto; }
.dm-asset-gauge-num { font-size: 22px; font-weight: 800; fill: #0f172a; }
.dm-asset-gauge-lbl { font-size: 9px; font-weight: 600; fill: #94a3b8; letter-spacing: 0.05em; text-transform: uppercase; }
.dm-asset-list { display: flex; flex-direction: column; gap: 8px; flex: 1; min-width: 0; }
.dm-asset-list-row { display: flex; align-items: center; gap: 8px; }
.dm-asset-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.dm-asset-count { font-size: 14px; font-weight: 800; color: #0f172a; min-width: 22px; }
.dm-asset-type { font-size: 12px; color: #64748b; font-weight: 500; }

/* Donut */
.dm-donut-wrap { display: flex; justify-content: center; padding: 6px 0 14px; }
.dm-donut { width: 180px; height: 180px; }
.dm-donut-num { font-size: 32px; font-weight: 800; fill: #0f172a; }
.dm-donut-lbl { font-size: 10px; font-weight: 700; fill: #94a3b8; letter-spacing: 0.06em; }
.dm-donut-row { display: flex; align-items: center; gap: 16px; padding: 4px 0; }
.dm-donut-sm { width: 120px; height: 120px; flex-shrink: 0; }
.dm-donut-num-sm { font-size: 24px; font-weight: 800; fill: #0f172a; }
.dm-donut-lbl-sm { font-size: 8px; font-weight: 700; fill: #94a3b8; letter-spacing: 0.06em; }
.dm-donut-legend { display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 0; }
.dm-legend-row { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.dm-legend-dot { width: 10px; height: 10px; border-radius: 50%; }
.dm-legend-lbl { flex: 1; color: #475569; font-weight: 500; }
.dm-legend-val { font-weight: 800; color: #0f172a; }

/* Tasks (Notifications) */
.dm-tasks { display: flex; flex-direction: column; gap: 6px; max-height: 360px; overflow-y: auto; }
.dm-task-row { display: grid; grid-template-columns: 4px 90px 1fr auto; align-items: center; gap: 12px; padding: 12px 14px; background: #fff; border: 1px solid #eef0f4; border-radius: 10px; cursor: pointer; text-align: left; font-family: inherit; transition: background 0.15s; }
.dm-task-row:hover { background: #f8fafc; }
.dm-task-bar { width: 4px; height: 32px; border-radius: 2px; }
.dm-task-time { font-size: 12px; font-weight: 600; color: #94a3b8; }
.dm-task-desc { font-size: 13px; color: #0f172a; }
.dm-task-desc strong { font-weight: 700; }
.dm-task-badge { padding: 4px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
.dm-task-open { background: #fef3c7; color: #92400e; }
.dm-task-done { background: #dcfce7; color: #15803d; }

/* Employees */
.dm-emp-scroll { display: flex; flex-direction: column; gap: 4px; max-height: 360px; overflow-y: auto; padding-right: 4px; }
.dm-emp-row { display: flex; align-items: center; gap: 12px; padding: 8px 10px; background: #fff; border: none; border-radius: 10px; cursor: pointer; text-align: left; font-family: inherit; transition: background 0.15s; }
.dm-emp-row:hover { background: #f1f5f9; }
.dm-emp-avatar { width: 36px; height: 36px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }
.dm-emp-avatar-init { display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #94a3b8, #64748b); color: #fff; font-size: 12px; font-weight: 700; }
.dm-emp-info { min-width: 0; display: flex; flex-direction: column; }
.dm-emp-name { font-size: 13px; font-weight: 700; color: #0f172a; }
.dm-emp-role { font-size: 11px; color: #94a3b8; }

/* Platform Support Access */
.dm-support { margin-top: 16px; }
.dm-support-badge { padding: 4px 12px; border-radius: 999px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
.dm-support-active { background: #dcfce7; color: #15803d; }
.dm-support-inactive { background: #fee2e2; color: #991b1b; }
.dm-support-info { padding: 10px 14px; background: #f0fdf4; border-radius: 8px; margin-bottom: 12px; font-size: 13px; color: #166534; }
.dm-support-actions { display: flex; gap: 8px; }
.dm-support-btn { padding: 8px 18px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; border: none; font-family: inherit; }
.dm-support-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.dm-support-grant { background: #4f46e5; color: #fff; }
.dm-support-grant:hover:not(:disabled) { background: #4338ca; }
.dm-support-revoke { background: #dc2626; color: #fff; }
.dm-support-revoke:hover:not(:disabled) { background: #b91c1c; }

@media (max-width: 1024px) {
  .dm-kpi-strip { grid-template-columns: repeat(2, 1fr); }
  .dm-insight-strip { grid-template-columns: 1fr; }
  .dm-grid { grid-template-columns: 1fr; }
  .dm-card-cal, .dm-card-leave, .dm-card-expense, .dm-card-tasks, .dm-card-emps { grid-column: 1; grid-row: auto; }
}
@media (max-width: 640px) {
  .dm { padding: 12px; }
  .dm-kpi-strip { grid-template-columns: 1fr; }
  .dm-insight-strip { grid-template-columns: 1fr; }
  .dm-cal-cell { min-height: 60px; padding: 4px; }
  .dm-task-row { grid-template-columns: 4px 1fr auto; }
  .dm-task-time { display: none; }
}
`
