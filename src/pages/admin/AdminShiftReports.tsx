import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { toLocalDateStr } from '../../lib/formatters'

interface ShiftAssignmentRow {
  id: string
  employee_id: string
  date: string
  shift_template_id: string
  rota_id: string
}

interface ShiftTemplate {
  id: string
  name: string
  start_time: string
  end_time: string
  break_minutes: number
  department: string | null
}

interface Rota {
  id: string
  name: string
  status: string
}

interface Employee {
  id: string
  first_name: string
  last_name: string
  department: string
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function timeToMins(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + (m || 0)
}

function shiftHours(tmpl: ShiftTemplate): number {
  const start = timeToMins(tmpl.start_time)
  const end = timeToMins(tmpl.end_time)
  return Math.max(0, (end - start - (tmpl.break_minutes || 0)) / 60)
}

function getFYRange(fyStartMonth: number): { start: string; end: string; label: string } {
  const now = new Date()
  const currentMonth = now.getMonth() + 1
  let fyStartYear = now.getFullYear()
  if (currentMonth < fyStartMonth) fyStartYear--
  const startDate = new Date(fyStartYear, fyStartMonth - 1, 1)
  const endDate = new Date(fyStartYear + 1, fyStartMonth - 1, 0)
  const label = fyStartMonth === 1
    ? `${fyStartYear}`
    : `${fyStartYear}/${fyStartYear + 1}`
  return {
    start: toLocalDateStr(startDate),
    end: toLocalDateStr(endDate),
    label,
  }
}

interface CheckinRow {
  employee_id: string
  check_in_at: string
  check_out_at: string | null
  status: string
  work_from_home: boolean
  shift_assignment_id: string | null
}

export default function AdminShiftReports() {
  const { selectedCompanyId } = useAdminCompany()
  const [fyStartMonth, setFyStartMonth] = useState(4)
  const [assignments, setAssignments] = useState<ShiftAssignmentRow[]>([])
  const [templates, setTemplates] = useState<ShiftTemplate[]>([])
  const [rotas, setRotas] = useState<Rota[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [editingFy, setEditingFy] = useState(false)
  const [draftFy, setDraftFy] = useState(4)
  const [checkinEnabled, setCheckinEnabled] = useState(false)
  const [checkinRecords, setCheckinRecords] = useState<CheckinRow[]>([])

  const fy = useMemo(() => getFYRange(fyStartMonth), [fyStartMonth])

  const loadData = useCallback(async () => {
    if (!selectedCompanyId) return
    setLoading(true)

    const [compRes, assignRes, tmplRes, rotaRes, empRes] = await Promise.all([
      supabase.from('companies').select('fy_start_month').eq('id', selectedCompanyId).single(),
      supabase.from('shift_assignments').select('id, employee_id, date, shift_template_id, rota_id')
        .eq('company_id', selectedCompanyId),
      supabase.from('shift_templates').select('id, name, start_time, end_time, break_minutes, department')
        .eq('company_id', selectedCompanyId),
      supabase.from('rotas').select('id, name, status')
        .eq('company_id', selectedCompanyId),
      supabase.from('employees').select('id, first_name, last_name, department')
        .eq('company_id', selectedCompanyId).eq('is_active', true),
    ])

    if (compRes.data?.fy_start_month) {
      setFyStartMonth(compRes.data.fy_start_month)
      setDraftFy(compRes.data.fy_start_month)
    }
    setTemplates((tmplRes.data as ShiftTemplate[]) || [])
    setRotas((rotaRes.data as Rota[]) || [])
    setEmployees((empRes.data as Employee[]) || [])
    setAssignments((assignRes.data as ShiftAssignmentRow[]) || [])

    const ciSettingsRes = await supabase.from('checkin_settings').select('shifts_checkin_enabled').eq('company_id', selectedCompanyId).single()
    const ciEnabled = ciSettingsRes.data?.shifts_checkin_enabled || false
    setCheckinEnabled(ciEnabled)
    if (ciEnabled) {
      const fyRange = getFYRange(compRes.data?.fy_start_month || 4)
      const { data: ciData } = await supabase.from('checkin_records')
        .select('employee_id, check_in_at, check_out_at, status, work_from_home, shift_assignment_id')
        .eq('company_id', selectedCompanyId).eq('source', 'shifts')
        .gte('check_in_at', fyRange.start + 'T00:00:00').lte('check_in_at', fyRange.end + 'T23:59:59')
      setCheckinRecords((ciData as CheckinRow[]) || [])
    }
    setLoading(false)
  }, [selectedCompanyId])

  useEffect(() => { loadData() }, [loadData])

  async function saveFyStart() {
    await supabase.from('companies').update({ fy_start_month: draftFy }).eq('id', selectedCompanyId)
    setFyStartMonth(draftFy)
    setEditingFy(false)
  }

  const tmplMap = useMemo(() => {
    const m: Record<string, ShiftTemplate> = {}
    templates.forEach(t => { m[t.id] = t })
    return m
  }, [templates])

  const rotaMap = useMemo(() => {
    const m: Record<string, Rota> = {}
    rotas.forEach(r => { m[r.id] = r })
    return m
  }, [rotas])

  const empMap = useMemo(() => {
    const m: Record<string, Employee> = {}
    employees.forEach(e => { m[e.id] = e })
    return m
  }, [employees])

  const fyAssignments = useMemo(() => {
    return assignments.filter(a => {
      if (a.date < fy.start || a.date > fy.end) return false
      const rota = rotaMap[a.rota_id]
      return rota?.status === 'published'
    })
  }, [assignments, fy, rotaMap])

  const metrics = useMemo(() => {
    const uniqueEmployees = new Set<string>()
    let totalHrs = 0
    let totalBreakMins = 0
    const empHours: Record<string, number> = {}
    const empShiftCount: Record<string, number> = {}
    const templateUsage: Record<string, number> = {}
    const deptHours: Record<string, number> = {}
    const monthHours: Record<string, number> = {}
    const dayOfWeekCount: number[] = [0, 0, 0, 0, 0, 0, 0]
    let weekendShifts = 0
    let weekdayShifts = 0
    const rotaShiftCount: Record<string, number> = {}

    for (const a of fyAssignments) {
      const tmpl = tmplMap[a.shift_template_id]
      if (!tmpl) continue

      uniqueEmployees.add(a.employee_id)
      const hrs = shiftHours(tmpl)
      totalHrs += hrs
      totalBreakMins += tmpl.break_minutes || 0

      empHours[a.employee_id] = (empHours[a.employee_id] || 0) + hrs
      empShiftCount[a.employee_id] = (empShiftCount[a.employee_id] || 0) + 1
      templateUsage[a.shift_template_id] = (templateUsage[a.shift_template_id] || 0) + 1

      const dept = tmpl.department || empMap[a.employee_id]?.department || 'Unassigned'
      deptHours[dept] = (deptHours[dept] || 0) + hrs

      const monthKey = a.date.slice(0, 7)
      monthHours[monthKey] = (monthHours[monthKey] || 0) + hrs

      const dow = new Date(a.date + 'T00:00:00').getDay()
      dayOfWeekCount[dow]++
      if (dow === 0 || dow === 6) weekendShifts++
      else weekdayShifts++

      rotaShiftCount[a.rota_id] = (rotaShiftCount[a.rota_id] || 0) + 1
    }

    const topWorkers = Object.entries(empHours)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([empId, hrs]) => ({
        employee: empMap[empId],
        hours: hrs,
        shifts: empShiftCount[empId] || 0,
      }))

    const topTemplates = Object.entries(templateUsage)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tmplId, count]) => ({
        template: tmplMap[tmplId],
        count,
      }))

    const topRotas = Object.entries(rotaShiftCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([rotaId, count]) => ({
        rota: rotaMap[rotaId],
        count,
      }))

    const deptBreakdown = Object.entries(deptHours)
      .sort((a, b) => b[1] - a[1])

    const monthBreakdown = Object.entries(monthHours)
      .sort((a, b) => a[0].localeCompare(b[0]))

    const avgHoursPerEmployee = uniqueEmployees.size > 0
      ? totalHrs / uniqueEmployees.size : 0

    const avgShiftsPerEmployee = uniqueEmployees.size > 0
      ? fyAssignments.length / uniqueEmployees.size : 0

    return {
      totalShifts: fyAssignments.length,
      uniqueEmployees: uniqueEmployees.size,
      totalHrs,
      totalBreakMins,
      avgHoursPerEmployee,
      avgShiftsPerEmployee,
      topWorkers,
      topTemplates,
      topRotas,
      deptBreakdown,
      monthBreakdown,
      dayOfWeekCount,
      weekendShifts,
      weekdayShifts,
    }
  }, [fyAssignments, tmplMap, empMap, rotaMap])

  const maxMonthHrs = useMemo(() => Math.max(...metrics.monthBreakdown.map(([, h]) => h), 1), [metrics.monthBreakdown])
  const maxDow = useMemo(() => Math.max(...metrics.dayOfWeekCount, 1), [metrics.dayOfWeekCount])

  const ciMetrics = useMemo(() => {
    if (!checkinEnabled) return null
    const totalCheckins = checkinRecords.length
    const completedRecords = checkinRecords.filter(r => r.check_out_at)
    const totalHours = completedRecords.reduce((sum, r) => {
      return sum + (new Date(r.check_out_at!).getTime() - new Date(r.check_in_at).getTime()) / 3600000
    }, 0)
    const avgDuration = completedRecords.length > 0 ? totalHours / completedRecords.length : 0
    const wfhCount = checkinRecords.filter(r => r.work_from_home).length
    const uniqueCheckinEmps = new Set(checkinRecords.map(r => r.employee_id)).size
    const empCheckinHrs: Record<string, number> = {}
    completedRecords.forEach(r => {
      const hrs = (new Date(r.check_out_at!).getTime() - new Date(r.check_in_at).getTime()) / 3600000
      empCheckinHrs[r.employee_id] = (empCheckinHrs[r.employee_id] || 0) + hrs
    })
    const topCheckinWorkers = Object.entries(empCheckinHrs)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([empId, hrs]) => ({ employee: empMap[empId], hours: hrs }))

    const assignmentIds = new Set(fyAssignments.map(a => a.id))
    const checkedInAssignments = new Set(checkinRecords.filter(r => r.shift_assignment_id && assignmentIds.has(r.shift_assignment_id)).map(r => r.shift_assignment_id!))
    const noCheckinCount = fyAssignments.length - checkedInAssignments.size
    const noCheckinRate = fyAssignments.length > 0 ? (noCheckinCount / fyAssignments.length) * 100 : 0

    const autoClosedCount = checkinRecords.filter(r => r.status === 'auto_closed').length
    const forgotCheckoutRate = totalCheckins > 0 ? (autoClosedCount / totalCheckins) * 100 : 0

    const expectedCheckouts = fyAssignments.length
    const actualCheckouts = completedRecords.length
    const checkoutRate = expectedCheckouts > 0 ? (actualCheckouts / expectedCheckouts) * 100 : 0

    const monthlyScheduledActual: { month: string; scheduled: number; actual: number }[] = []
    const schedByMonth: Record<string, number> = {}
    const actualByMonth: Record<string, number> = {}
    for (const a of fyAssignments) {
      const tmpl = tmplMap[a.shift_template_id]
      if (!tmpl) continue
      const monthKey = a.date.slice(0, 7)
      schedByMonth[monthKey] = (schedByMonth[monthKey] || 0) + shiftHours(tmpl)
    }
    for (const r of completedRecords) {
      const monthKey = r.check_in_at.slice(0, 7)
      const hrs = (new Date(r.check_out_at!).getTime() - new Date(r.check_in_at).getTime()) / 3600000
      actualByMonth[monthKey] = (actualByMonth[monthKey] || 0) + hrs
    }
    const allMonthKeys = [...new Set([...Object.keys(schedByMonth), ...Object.keys(actualByMonth)])].sort()
    for (const mk of allMonthKeys) {
      monthlyScheduledActual.push({ month: mk, scheduled: schedByMonth[mk] || 0, actual: actualByMonth[mk] || 0 })
    }

    return { totalCheckins, totalHours, avgDuration, wfhCount, uniqueCheckinEmps, topCheckinWorkers, noCheckinRate, forgotCheckoutRate, checkoutRate, monthlyScheduledActual }
  }, [checkinEnabled, checkinRecords, empMap, fyAssignments, tmplMap])

  if (loading) return <div className="admin-loading">Loading reports...</div>

  return (
    <div className="admin-shift-reports">
      {/* FY Setting */}
      <div className="asr-fy-bar">
        <div className="asr-fy-info">
          <span className="asr-fy-label">Financial Year</span>
          <span className="asr-fy-value">{fy.label}</span>
          <span className="asr-fy-range">{new Date(fy.start + 'T00:00:00').toLocaleDateString('en-GB')} — {new Date(fy.end + 'T00:00:00').toLocaleDateString('en-GB')}</span>
        </div>
        {editingFy ? (
          <div className="asr-fy-edit">
            <select className="admin-select" value={draftFy} onChange={e => setDraftFy(Number(e.target.value))}>
              {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
            <button className="admin-btn-sm admin-btn-save" onClick={saveFyStart}>Save</button>
            <button className="admin-btn-sm admin-btn-cancel" onClick={() => { setEditingFy(false); setDraftFy(fyStartMonth) }}>Cancel</button>
          </div>
        ) : (
          <button className="admin-btn-sm" onClick={() => setEditingFy(true)} style={{ background: 'var(--bg-card, #fff)', border: '1px solid var(--border, #ddd)' }}>
            Change FY Start
          </button>
        )}
      </div>

      {/* KPI Cards */}
      <div className="asr-kpi-grid">
        <div className="asr-kpi">
          <span className="asr-kpi-value">{metrics.totalShifts.toLocaleString()}</span>
          <span className="asr-kpi-label">Total Shifts</span>
        </div>
        <div className="asr-kpi">
          <span className="asr-kpi-value">{metrics.uniqueEmployees}</span>
          <span className="asr-kpi-label">People Worked</span>
        </div>
        <div className="asr-kpi">
          <span className="asr-kpi-value">{metrics.totalHrs.toFixed(0)}</span>
          <span className="asr-kpi-label">Total Hours</span>
        </div>
        <div className="asr-kpi">
          <span className="asr-kpi-value">{metrics.avgHoursPerEmployee.toFixed(1)}</span>
          <span className="asr-kpi-label">Avg Hours / Person</span>
        </div>
        <div className="asr-kpi">
          <span className="asr-kpi-value">{metrics.avgShiftsPerEmployee.toFixed(1)}</span>
          <span className="asr-kpi-label">Avg Shifts / Person</span>
        </div>
        <div className="asr-kpi">
          <span className="asr-kpi-value">{Math.round(metrics.totalBreakMins / 60)}h</span>
          <span className="asr-kpi-label">Total Break Time</span>
        </div>
      </div>

      {/* Main content grid */}
      <div className="asr-grid">
        {/* Top 5 Workers */}
        <div className="asr-card">
          <h3 className="asr-card-title">Top 5 — Most Hours</h3>
          {metrics.topWorkers.length === 0 ? (
            <p className="asr-empty">No shift data</p>
          ) : (
            <div className="asr-rank-list">
              {metrics.topWorkers.map((w, i) => (
                <div key={w.employee?.id || i} className="asr-rank-row">
                  <span className="asr-rank-num">{i + 1}</span>
                  <div className="asr-rank-bar-wrap">
                    <div className="asr-rank-name">{w.employee ? `${w.employee.first_name} ${w.employee.last_name}` : 'Unknown'}</div>
                    <div className="asr-rank-bar-track">
                      <div className="asr-rank-bar" style={{ width: `${(w.hours / (metrics.topWorkers[0]?.hours || 1)) * 100}%` }} />
                    </div>
                  </div>
                  <span className="asr-rank-stat">{w.hours.toFixed(1)}h<br /><small>{w.shifts} shifts</small></span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Most Used Shift Templates */}
        <div className="asr-card">
          <h3 className="asr-card-title">Most Used Shifts</h3>
          {metrics.topTemplates.length === 0 ? (
            <p className="asr-empty">No shift data</p>
          ) : (
            <div className="asr-rank-list">
              {metrics.topTemplates.map((t, i) => (
                <div key={t.template?.id || i} className="asr-rank-row">
                  <span className="asr-rank-num">{i + 1}</span>
                  <div className="asr-rank-bar-wrap">
                    <div className="asr-rank-name">{t.template?.name || 'Unknown'}</div>
                    <div className="asr-rank-bar-track">
                      <div className="asr-rank-bar asr-rank-bar-teal" style={{ width: `${(t.count / (metrics.topTemplates[0]?.count || 1)) * 100}%` }} />
                    </div>
                  </div>
                  <span className="asr-rank-stat">{t.count}<br /><small>uses</small></span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Day of Week Distribution */}
        <div className="asr-card">
          <h3 className="asr-card-title">Day of Week Distribution</h3>
          <div className="asr-dow-chart">
            {DAY_NAMES.map((day, i) => (
              <div key={day} className="asr-dow-col">
                <span className="asr-dow-val">{metrics.dayOfWeekCount[i]}</span>
                <div className="asr-dow-bar-track">
                  <div
                    className={`asr-dow-bar ${i === 0 || i === 6 ? 'asr-dow-weekend' : ''}`}
                    style={{ height: `${(metrics.dayOfWeekCount[i] / maxDow) * 100}%` }}
                  />
                </div>
                <span className="asr-dow-label">{day}</span>
              </div>
            ))}
          </div>
          <div className="asr-dow-summary">
            <span>Weekday: {metrics.weekdayShifts} ({metrics.totalShifts > 0 ? ((metrics.weekdayShifts / metrics.totalShifts) * 100).toFixed(0) : 0}%)</span>
            <span>Weekend: {metrics.weekendShifts} ({metrics.totalShifts > 0 ? ((metrics.weekendShifts / metrics.totalShifts) * 100).toFixed(0) : 0}%)</span>
          </div>
        </div>

        {/* Monthly Hours */}
        <div className="asr-card">
          <h3 className="asr-card-title">Monthly Hours</h3>
          {metrics.monthBreakdown.length === 0 ? (
            <p className="asr-empty">No data</p>
          ) : (
            <div className="asr-month-chart">
              {metrics.monthBreakdown.map(([monthKey, hrs]) => {
                const [y, m] = monthKey.split('-')
                const label = `${MONTH_NAMES[Number(m) - 1]?.slice(0, 3)} ${y.slice(2)}`
                return (
                  <div key={monthKey} className="asr-month-row">
                    <span className="asr-month-label">{label}</span>
                    <div className="asr-month-bar-track">
                      <div className="asr-month-bar" style={{ width: `${(hrs / maxMonthHrs) * 100}%` }} />
                    </div>
                    <span className="asr-month-val">{hrs.toFixed(0)}h</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Department Breakdown */}
        <div className="asr-card">
          <h3 className="asr-card-title">Hours by Department</h3>
          {metrics.deptBreakdown.length === 0 ? (
            <p className="asr-empty">No data</p>
          ) : (
            <div className="asr-rank-list">
              {metrics.deptBreakdown.map(([dept, hrs]) => (
                <div key={dept} className="asr-rank-row">
                  <div className="asr-rank-bar-wrap">
                    <div className="asr-rank-name">{dept}</div>
                    <div className="asr-rank-bar-track">
                      <div className="asr-rank-bar asr-rank-bar-purple" style={{ width: `${(hrs / (metrics.deptBreakdown[0]?.[1] || 1)) * 100}%` }} />
                    </div>
                  </div>
                  <span className="asr-rank-stat">{hrs.toFixed(1)}h</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Rotas Overview */}
        <div className="asr-card">
          <h3 className="asr-card-title">Rotas — Shift Coverage</h3>
          {metrics.topRotas.length === 0 ? (
            <p className="asr-empty">No published rotas</p>
          ) : (
            <div className="asr-rank-list">
              {metrics.topRotas.map((r, i) => (
                <div key={r.rota?.id || i} className="asr-rank-row">
                  <div className="asr-rank-bar-wrap">
                    <div className="asr-rank-name">{r.rota?.name || 'Unknown'}</div>
                    <div className="asr-rank-bar-track">
                      <div className="asr-rank-bar asr-rank-bar-amber" style={{ width: `${(r.count / (metrics.topRotas[0]?.count || 1)) * 100}%` }} />
                    </div>
                  </div>
                  <span className="asr-rank-stat">{r.count}<br /><small>shifts</small></span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Check-In Metrics */}
      {ciMetrics && (
        <>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginTop: 28, marginBottom: 12 }}>Check-In / Check-Out</h3>
          <div className="asr-kpi-grid">
            <div className="asr-kpi">
              <span className="asr-kpi-value">{ciMetrics.totalCheckins}</span>
              <span className="asr-kpi-label">Total Check-Ins</span>
            </div>
            <div className="asr-kpi">
              <span className="asr-kpi-value">{ciMetrics.uniqueCheckinEmps}</span>
              <span className="asr-kpi-label">Employees</span>
            </div>
            <div className="asr-kpi">
              <span className="asr-kpi-value">{ciMetrics.totalHours.toFixed(0)}</span>
              <span className="asr-kpi-label">Check-In Hours</span>
            </div>
            <div className="asr-kpi">
              <span className="asr-kpi-value">{ciMetrics.avgDuration.toFixed(1)}</span>
              <span className="asr-kpi-label">Avg Duration (hrs)</span>
            </div>
            <div className="asr-kpi" style={{ borderLeft: '3px solid #dc2626' }}>
              <span className="asr-kpi-value" style={{ color: '#dc2626' }}>{ciMetrics.noCheckinRate.toFixed(0)}%</span>
              <span className="asr-kpi-label">No Check-In Rate</span>
            </div>
            <div className="asr-kpi" style={{ borderLeft: '3px solid #f59e0b' }}>
              <span className="asr-kpi-value" style={{ color: '#92400e' }}>{ciMetrics.forgotCheckoutRate.toFixed(0)}%</span>
              <span className="asr-kpi-label">Forgot Checkout</span>
            </div>
            <div className="asr-kpi">
              <span className="asr-kpi-value">{ciMetrics.checkoutRate.toFixed(0)}%</span>
              <span className="asr-kpi-label">Checkout Rate</span>
            </div>
            <div className="asr-kpi">
              <span className="asr-kpi-value">{ciMetrics.wfhCount}</span>
              <span className="asr-kpi-label">Remote Check-Ins</span>
            </div>
          </div>

          <div className="asr-grid" style={{ marginTop: 16 }}>
            {/* Scheduled vs Actual Hours Chart */}
            {ciMetrics.monthlyScheduledActual.length > 0 && (
              <div className="asr-card" style={{ gridColumn: '1 / -1' }}>
                <h3 className="asr-card-title">Scheduled vs Actual Hours</h3>
                <div style={{ display: 'flex', gap: 16, fontSize: 12, marginBottom: 12, color: 'var(--text-muted, #888)' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: '#6366f1', display: 'inline-block' }} /> Scheduled</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: '#22c55e', display: 'inline-block' }} /> Actual</span>
                </div>
                {(() => {
                  const data = ciMetrics.monthlyScheduledActual
                  const maxVal = Math.max(...data.map(d => Math.max(d.scheduled, d.actual)), 1)
                  const chartW = 700
                  const chartH = 220
                  const pad = { top: 20, right: 20, bottom: 40, left: 50 }
                  const plotW = chartW - pad.left - pad.right
                  const plotH = chartH - pad.top - pad.bottom
                  const barGroupW = data.length > 0 ? plotW / data.length : plotW
                  const barW = Math.min(24, barGroupW * 0.35)
                  const gap = 3
                  return (
                    <svg viewBox={`0 0 ${chartW} ${chartH}`} style={{ width: '100%', height: 'auto', maxHeight: 260, display: 'block' }}>
                      <defs>
                        <linearGradient id="grad-sched" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#818cf8" />
                          <stop offset="100%" stopColor="#6366f1" />
                        </linearGradient>
                        <linearGradient id="grad-actual" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#4ade80" />
                          <stop offset="100%" stopColor="#22c55e" />
                        </linearGradient>
                      </defs>
                      {[0, 0.25, 0.5, 0.75, 1].map(frac => {
                        const y = pad.top + plotH * (1 - frac)
                        return (
                          <g key={frac}>
                            <line x1={pad.left} y1={y} x2={chartW - pad.right} y2={y} stroke="var(--border, #e5e7eb)" strokeDasharray="3,3" />
                            <text x={pad.left - 6} y={y + 4} textAnchor="end" fill="var(--text-muted, #888)" fontSize="10">{Math.round(maxVal * frac)}</text>
                          </g>
                        )
                      })}
                      {data.map((d, i) => {
                        const cx = pad.left + barGroupW * i + barGroupW / 2
                        const schedH = (d.scheduled / maxVal) * plotH
                        const actH = (d.actual / maxVal) * plotH
                        const [, m] = d.month.split('-')
                        const label = MONTH_NAMES[Number(m) - 1]?.slice(0, 3) || d.month
                        return (
                          <g key={d.month}>
                            <rect x={cx - barW - gap / 2} y={pad.top + plotH - schedH} width={barW} height={schedH} rx={3} fill="url(#grad-sched)" />
                            <rect x={cx + gap / 2} y={pad.top + plotH - actH} width={barW} height={actH} rx={3} fill="url(#grad-actual)" />
                            <text x={cx} y={chartH - pad.bottom + 16} textAnchor="middle" fill="var(--text-muted, #888)" fontSize="10">{label}</text>
                            {d.scheduled > 0 && <text x={cx - barW / 2 - gap / 2} y={pad.top + plotH - schedH - 4} textAnchor="middle" fill="#6366f1" fontSize="9" fontWeight="600">{d.scheduled.toFixed(0)}</text>}
                            {d.actual > 0 && <text x={cx + barW / 2 + gap / 2} y={pad.top + plotH - actH - 4} textAnchor="middle" fill="#16a34a" fontSize="9" fontWeight="600">{d.actual.toFixed(0)}</text>}
                          </g>
                        )
                      })}
                    </svg>
                  )
                })()}
              </div>
            )}

            {ciMetrics.topCheckinWorkers.length > 0 && (
              <div className="asr-card">
                <h3 className="asr-card-title">Top 5 — Check-In Hours</h3>
                <div className="asr-rank-list">
                  {ciMetrics.topCheckinWorkers.map((w, i) => (
                    <div key={w.employee?.id || i} className="asr-rank-row">
                      <span className="asr-rank-num">{i + 1}</span>
                      <div className="asr-rank-bar-wrap">
                        <div className="asr-rank-name">{w.employee ? `${w.employee.first_name} ${w.employee.last_name}` : 'Unknown'}</div>
                        <div className="asr-rank-bar-track">
                          <div className="asr-rank-bar" style={{ width: `${(w.hours / (ciMetrics.topCheckinWorkers[0]?.hours || 1)) * 100}%`, background: '#16a34a' }} />
                        </div>
                      </div>
                      <span className="asr-rank-stat">{w.hours.toFixed(1)}h</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
