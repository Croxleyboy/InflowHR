import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { toLocalDateStr } from '../../lib/formatters'

interface Employee {
  id: string
  first_name: string
  last_name: string
  department: string | null
}

interface AvailabilityRecord {
  employee_id: string
  day_of_week: number
  is_available: boolean
  start_time: string
  end_time: string
}

interface LeaveRecord {
  employee_id: string
  start_date: string
  end_date: string
}

interface DemandRecord {
  shift_template_id: string
  day_of_week: number
  min_staff: number
  template_name: string
  template_colour: string
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function getMonday(d: Date): Date {
  const dt = new Date(d)
  const day = dt.getDay()
  const diff = dt.getDate() - day + (day === 0 ? -6 : 1)
  dt.setDate(diff)
  dt.setHours(0, 0, 0, 0)
  return dt
}

function addDays(d: Date, n: number): Date {
  const dt = new Date(d)
  dt.setDate(dt.getDate() + n)
  return dt
}

function isDateInRange(date: string, start: string, end: string): boolean {
  return date >= start && date <= end
}

export default function AdminAvailabilityOverview() {
  const { selectedCompanyId } = useAdminCompany()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [availability, setAvailability] = useState<AvailabilityRecord[]>([])
  const [leave, setLeave] = useState<LeaveRecord[]>([])
  const [demandRecords, setDemandRecords] = useState<DemandRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [weekOffset, setWeekOffset] = useState(0)
  const [filterDept, setFilterDept] = useState('')
  const [search, setSearch] = useState('')

  const baseMonday = useMemo(() => getMonday(new Date()), [])

  useEffect(() => { if (selectedCompanyId) load() }, [selectedCompanyId])

  async function load() {
    setLoading(true)
    const threeWeeksEnd = toLocalDateStr(addDays(getMonday(new Date()), 27))
    const [empRes, availRes, leaveRes, demandRes] = await Promise.all([
      supabase.from('employees').select('id, first_name, last_name, department')
        .eq('company_id', selectedCompanyId).eq('is_active', true).order('first_name'),
      supabase.from('employee_availability').select('employee_id, day_of_week, is_available, start_time, end_time')
        .eq('company_id', selectedCompanyId),
      supabase.from('leave_requests').select('employee_id, start_date, end_date')
        .eq('company_id', selectedCompanyId).in('status', ['pending', 'approved'])
        .gte('end_date', toLocalDateStr(new Date()))
        .lte('start_date', threeWeeksEnd),
      supabase.from('labour_demand').select('shift_template_id, day_of_week, min_staff, shift_templates(name, colour)')
        .eq('company_id', selectedCompanyId),
    ])
    setEmployees((empRes.data as Employee[]) || [])
    setAvailability((availRes.data as AvailabilityRecord[]) || [])
    setLeave((leaveRes.data as LeaveRecord[]) || [])

    const dr: DemandRecord[] = []
    if (demandRes.data) {
      for (const row of demandRes.data as any[]) {
        const tmpl = Array.isArray(row.shift_templates) ? row.shift_templates[0] : row.shift_templates
        if (tmpl) {
          dr.push({
            shift_template_id: row.shift_template_id,
            day_of_week: row.day_of_week,
            min_staff: row.min_staff,
            template_name: tmpl.name,
            template_colour: tmpl.colour,
          })
        }
      }
    }
    setDemandRecords(dr)
    setLoading(false)
  }

  const departments = useMemo(() => {
    const depts = new Set<string>()
    employees.forEach(e => { if (e.department) depts.add(e.department) })
    return Array.from(depts).sort()
  }, [employees])

  const filteredEmployees = useMemo(() => {
    return employees.filter(e => {
      if (filterDept && e.department !== filterDept) return false
      if (search) {
        const name = `${e.first_name} ${e.last_name}`.toLowerCase()
        if (!name.includes(search.toLowerCase())) return false
      }
      return true
    })
  }, [employees, filterDept, search])

  const currentWeekStart = useMemo(() => addDays(baseMonday, weekOffset * 7), [baseMonday, weekOffset])

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(currentWeekStart, i)
      return {
        date: toLocalDateStr(d),
        label: DAY_LABELS[i],
        dayNum: d.getDate(),
        month: d.toLocaleDateString('en-GB', { month: 'short' }),
        dayOfWeek: d.getDay(),
      }
    })
  }, [currentWeekStart])

  const weekLabel = useMemo(() => {
    const s = weekDays[0]
    const e = weekDays[6]
    return `${s.dayNum} ${s.month} – ${e.dayNum} ${e.month}`
  }, [weekDays])

  function getEmployeeAvail(empId: string, dayOfWeek: number): AvailabilityRecord | undefined {
    return availability.find(a => a.employee_id === empId && a.day_of_week === dayOfWeek)
  }

  function hasLeave(empId: string, date: string): boolean {
    return leave.some(l => l.employee_id === empId && isDateInRange(date, l.start_date, l.end_date))
  }

  function getDayDemand(dayOfWeek: number): number {
    return demandRecords.filter(d => d.day_of_week === dayOfWeek).reduce((s, d) => s + d.min_staff, 0)
  }

  function getDayAvailableCount(dayOfWeek: number, date: string): number {
    return filteredEmployees.filter(e => {
      if (hasLeave(e.id, date)) return false
      const avail = getEmployeeAvail(e.id, dayOfWeek)
      return avail ? avail.is_available : false
    }).length
  }

  const todayStr = toLocalDateStr(new Date())

  const availSummary = useMemo(() => {
    let totalAvail = 0
    let totalOnLeave = 0
    weekDays.forEach(d => {
      filteredEmployees.forEach(e => {
        if (hasLeave(e.id, d.date)) { totalOnLeave++; return }
        const avail = getEmployeeAvail(e.id, d.dayOfWeek)
        if (avail?.is_available) totalAvail++
      })
    })
    return { totalAvail, totalOnLeave }
  }, [filteredEmployees, weekDays, availability, leave])

  if (loading) return <div className="admin-loading">Loading...</div>

  return (
    <>
      <div className="admin-mini-stats">
        <div className="admin-mini-stat">
          <span className="admin-mini-value">{filteredEmployees.length}</span>
          <span>Employees</span>
        </div>
        <div className="admin-mini-stat">
          <span className="admin-mini-value" style={{ color: '#43a047' }}>{availSummary.totalAvail}</span>
          <span>Available Slots</span>
        </div>
        <div className="admin-mini-stat">
          <span className="admin-mini-value" style={{ color: '#e53935' }}>{availSummary.totalOnLeave}</span>
          <span>On Leave</span>
        </div>
      </div>

      <div className="admin-filters">
        <input
          type="text"
          placeholder="Search employee..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="admin-select"
          style={{ minWidth: 180 }}
        />
        <select value={filterDept} onChange={e => setFilterDept(e.target.value)} className="admin-select">
          <option value="">All Departments</option>
          {departments.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      {/* Week Navigation */}
      <div className="ao-week-nav">
        <button
          className="ao-nav-btn"
          onClick={() => setWeekOffset(Math.max(0, weekOffset - 1))}
          disabled={weekOffset === 0}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <div className="ao-week-pills">
          {[0, 1, 2].map(w => (
            <button
              key={w}
              className={`ao-week-pill ${weekOffset === w ? 'ao-week-pill-active' : ''}`}
              onClick={() => setWeekOffset(w)}
            >
              {w === 0 ? 'This Week' : w === 1 ? 'Next Week' : 'Week 3'}
            </button>
          ))}
        </div>
        <button
          className="ao-nav-btn"
          onClick={() => setWeekOffset(Math.min(2, weekOffset + 1))}
          disabled={weekOffset === 2}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>

      <div className="ao-week-label">{weekLabel}</div>

      {/* Demand vs Available summary row */}
      {demandRecords.length > 0 && (
        <div className="ao-demand-row">
          <div className="ao-demand-label">Demand</div>
          {weekDays.map((d, i) => {
            const required = getDayDemand(d.dayOfWeek)
            const available = getDayAvailableCount(d.dayOfWeek, d.date)
            const short = available < required
            return (
              <div key={i} className={`ao-demand-cell ${short ? 'ao-demand-short' : 'ao-demand-ok'}`}>
                <span className="ao-demand-avail">{available}</span>
                <span className="ao-demand-slash">/</span>
                <span className="ao-demand-need">{required}</span>
              </div>
            )
          })}
        </div>
      )}

      {/* Availability Grid */}
      <div className="ao-grid-wrap">
        <table className="ao-table">
          <thead>
            <tr>
              <th className="ao-th-emp">Employee</th>
              {weekDays.map(d => {
                const isToday = d.date === todayStr
                return (
                  <th key={d.date} className={`ao-th-day ${isToday ? 'ao-th-today' : ''}`}>
                    <div className="ao-th-name">{d.label}</div>
                    <div className="ao-th-num">{d.dayNum}</div>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {filteredEmployees.map(emp => {
              const initials = `${emp.first_name.charAt(0)}${emp.last_name.charAt(0)}`.toUpperCase()
              return (
                <tr key={emp.id}>
                  <td className="ao-td-emp">
                    <div className="ao-emp-row">
                      <div className="ao-emp-avatar">{initials}</div>
                      <div>
                        <div className="ao-emp-name">{emp.first_name} {emp.last_name}</div>
                        {emp.department && <div className="ao-emp-dept">{emp.department}</div>}
                      </div>
                    </div>
                  </td>
                  {weekDays.map(d => {
                    const onLeave = hasLeave(emp.id, d.date)
                    const avail = getEmployeeAvail(emp.id, d.dayOfWeek)
                    const isAvailable = avail?.is_available ?? false
                    const isToday = d.date === todayStr

                    let cellClass = 'ao-cell-unset'
                    let label = '—'
                    if (onLeave) {
                      cellClass = 'ao-cell-leave'
                      label = 'Leave'
                    } else if (isAvailable) {
                      cellClass = 'ao-cell-available'
                      label = avail ? `${avail.start_time.slice(0, 5)}–${avail.end_time.slice(0, 5)}` : 'Yes'
                    } else if (avail && !avail.is_available) {
                      cellClass = 'ao-cell-unavailable'
                      label = 'Off'
                    }

                    return (
                      <td key={d.date} className={`ao-td-cell ${isToday ? 'ao-td-today' : ''}`}>
                        <div className={`ao-cell ${cellClass}`}>
                          {label}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
        {filteredEmployees.length === 0 && <div className="admin-empty" style={{ padding: 32 }}>No employees found</div>}
      </div>

      {/* Legend */}
      <div className="ao-legend">
        <span className="ao-legend-item"><span className="ao-legend-dot ao-dot-avail" /> Available</span>
        <span className="ao-legend-item"><span className="ao-legend-dot ao-dot-off" /> Unavailable</span>
        <span className="ao-legend-item"><span className="ao-legend-dot ao-dot-leave" /> On Leave</span>
        <span className="ao-legend-item"><span className="ao-legend-dot ao-dot-unset" /> Not Set</span>
      </div>
    </>
  )
}
