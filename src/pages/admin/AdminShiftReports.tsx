import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAdminCompany } from '../../context/AdminCompanyContext'

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
    start: startDate.toISOString().split('T')[0],
    end: endDate.toISOString().split('T')[0],
    label,
  }
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
    </div>
  )
}
