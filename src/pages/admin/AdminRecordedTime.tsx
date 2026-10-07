import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

interface Employee {
  id: string
  first_name: string
  last_name: string
  employment_category: string | null
  contract_type: string | null
  job_title: string | null
}

interface CheckinRow {
  id: string
  employee_id: string
  shift_assignment_id: string | null
  check_in_at: string
  check_out_at: string | null
  status: string
}

interface ShiftAssignmentRow {
  id: string
  shift_template_id: string
  employee_id: string
  date: string
  shift_template?: { name: string; start_time: string; end_time: string; break_minutes: number } | { name: string; start_time: string; end_time: string; break_minutes: number }[]
}

interface CorrectionRow {
  id: string
  shift_assignment_id: string
  status: string
  correction_type: string
}

interface RecordedEntry {
  assignmentId: string
  date: string
  shiftName: string
  scheduledStart: string
  scheduledEnd: string
  breakMinutes: number
  checkins: { checkIn: string; checkOut: string | null; hours: number; status: string }[]
  totalHours: number
  payableHours: number
  scheduledHours: number
  hasCorrectionRaised: boolean
  correctionStatus: string | null
}

type SubTab = 'employed' | 'zero_hours'

const fmtTime = (iso: string) => {
  const d = new Date(iso)
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

const fmtDate = (dateStr: string) => {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
}

const getWeekKey = (dateStr: string) => {
  const d = new Date(dateStr + 'T00:00:00')
  const day = d.getDay()
  const mondayOffset = day === 0 ? -6 : 1 - day
  const monday = new Date(d)
  monday.setDate(d.getDate() + mondayOffset)
  const yy = monday.getFullYear()
  const mm = String(monday.getMonth() + 1).padStart(2, '0')
  const dd = String(monday.getDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

const fmtWeekLabel = (mondayStr: string) => {
  const mon = new Date(mondayStr + 'T00:00:00')
  const sun = new Date(mon)
  sun.setDate(mon.getDate() + 6)
  const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  return `${fmt(mon)} – ${fmt(sun)}`
}

export default function AdminRecordedTime() {
  const { companyUser } = useAuth()
  const [subTab, setSubTab] = useState<SubTab>('employed')
  const [employees, setEmployees] = useState<Employee[]>([])
  const [entriesByEmp, setEntriesByEmp] = useState<Record<string, RecordedEntry[]>>({})
  const [loading, setLoading] = useState(true)
  const [expandedEmp, setExpandedEmp] = useState<string | null>(null)
  const [expandedWeeks, setExpandedWeeks] = useState<Set<string>>(new Set())

  const companyId = companyUser?.company_id

  const isEmployedShift = (e: Employee) =>
    e.employment_category === 'shift_worker' && e.contract_type !== 'Zero hours shift worker'

  const isZeroHours = (e: Employee) =>
    e.employment_category === 'shift_worker' && e.contract_type === 'Zero hours shift worker'

  const fetchData = useCallback(async () => {
    if (!companyId) return
    setLoading(true)

    const { data: empData } = await supabase
      .from('employees')
      .select('id, first_name, last_name, employment_category, contract_type, job_title')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .order('last_name')

    const allEmps = (empData || []) as Employee[]
    const filtered = subTab === 'employed'
      ? allEmps.filter(isEmployedShift)
      : allEmps.filter(isZeroHours)

    setEmployees(filtered)

    if (filtered.length === 0) {
      setEntriesByEmp({})
      setLoading(false)
      return
    }

    const empIds = filtered.map(e => e.id)

    const [assignRes, checkinRes, corrRes] = await Promise.all([
      supabase
        .from('shift_assignments')
        .select('id, shift_template_id, employee_id, date, shift_template:shift_templates(name, start_time, end_time, break_minutes)')
        .eq('company_id', companyId)
        .in('employee_id', empIds)
        .order('date', { ascending: false }),
      supabase
        .from('checkin_records')
        .select('id, employee_id, shift_assignment_id, check_in_at, check_out_at, status')
        .eq('company_id', companyId)
        .in('employee_id', empIds)
        .in('status', ['checked_out', 'auto_closed']),
      supabase
        .from('shift_corrections')
        .select('id, shift_assignment_id, status, correction_type')
        .eq('company_id', companyId)
        .in('employee_id', empIds),
    ])

    const assignments = (assignRes.data || []) as ShiftAssignmentRow[]
    const checkins = (checkinRes.data || []) as CheckinRow[]
    const corrections = (corrRes.data || []) as CorrectionRow[]

    const checkinsByAssignment = new Map<string, CheckinRow[]>()
    for (const c of checkins) {
      if (!c.shift_assignment_id) continue
      const key = c.shift_assignment_id
      if (!checkinsByAssignment.has(key)) checkinsByAssignment.set(key, [])
      checkinsByAssignment.get(key)!.push(c)
    }

    const corrByAssignment = new Map<string, CorrectionRow[]>()
    for (const c of corrections) {
      if (!corrByAssignment.has(c.shift_assignment_id)) corrByAssignment.set(c.shift_assignment_id, [])
      corrByAssignment.get(c.shift_assignment_id)!.push(c)
    }

    const result: Record<string, RecordedEntry[]> = {}

    for (const a of assignments) {
      if (!result[a.employee_id]) result[a.employee_id] = []

      const shiftCheckins = checkinsByAssignment.get(a.id) || []
      const shiftCorrs = corrByAssignment.get(a.id) || []

      const rawTmpl = a.shift_template
      const tmpl = Array.isArray(rawTmpl) ? rawTmpl[0] : rawTmpl

      let scheduledHrs = 0
      if (tmpl?.start_time && tmpl?.end_time) {
        const [sh, sm] = tmpl.start_time.split(':').map(Number)
        const [eh, em] = tmpl.end_time.split(':').map(Number)
        scheduledHrs = (eh * 60 + em - (sh * 60 + sm)) / 60
        if (scheduledHrs <= 0) scheduledHrs += 24
      }

      const checkinDetails = shiftCheckins.map(c => {
        let hrs = 0
        let effectiveCheckOut = c.check_out_at
        if (c.check_out_at) {
          hrs = (new Date(c.check_out_at).getTime() - new Date(c.check_in_at).getTime()) / 3600000
          if (hrs < 0 || hrs >= 24) hrs = 0
        } else if (c.status === 'checked_out' && scheduledHrs > 0 && tmpl?.end_time) {
          hrs = scheduledHrs
          effectiveCheckOut = `${a.date}T${tmpl.end_time}`
        }
        if (c.status === 'auto_closed' && scheduledHrs > 0 && hrs > scheduledHrs) {
          hrs = scheduledHrs
        }
        return {
          checkIn: c.check_in_at,
          checkOut: effectiveCheckOut,
          hours: Math.round(hrs * 100) / 100,
          status: c.status,
        }
      })

      const totalHours = checkinDetails.reduce((s, c) => s + c.hours, 0)
      const breakMins = tmpl?.break_minutes ?? 30
      const breakHrs = breakMins / 60
      const payable = Math.max(0, totalHours - breakHrs)
      const hasCorrectionRaised = shiftCorrs.length > 0
      const latestCorr = shiftCorrs.sort((a, b) => a.status.localeCompare(b.status))[0]
      result[a.employee_id].push({
        assignmentId: a.id,
        date: a.date,
        shiftName: tmpl?.name || 'Shift',
        scheduledStart: tmpl?.start_time || '',
        scheduledEnd: tmpl?.end_time || '',
        breakMinutes: breakMins,
        checkins: checkinDetails,
        totalHours: Math.round(totalHours * 100) / 100,
        payableHours: Math.round(payable * 100) / 100,
        scheduledHours: Math.round(scheduledHrs * 100) / 100,
        hasCorrectionRaised,
        correctionStatus: hasCorrectionRaised ? latestCorr?.status || null : null,
      })
    }

    setEntriesByEmp(result)
    setLoading(false)
  }, [companyId, subTab])

  useEffect(() => {
    fetchData()
    setExpandedEmp(null)
    setExpandedWeeks(new Set())
  }, [fetchData])

  const toggleEmp = (empId: string) => {
    setExpandedEmp(prev => prev === empId ? null : empId)
    setExpandedWeeks(new Set())
  }

  const toggleWeek = (weekKey: string) => {
    setExpandedWeeks(prev => {
      const next = new Set(prev)
      if (next.has(weekKey)) next.delete(weekKey)
      else next.add(weekKey)
      return next
    })
  }

  const CORR_BADGES: Record<string, { bg: string; color: string; label: string }> = {
    submitted: { bg: '#fff3e0', color: '#e65100', label: 'Correction Pending' },
    pending: { bg: '#f5f5f5', color: '#666', label: 'Correction Pending' },
    approved: { bg: '#e8f5e9', color: '#2e7d32', label: 'Corrected' },
    declined: { bg: '#fef2f2', color: '#dc2626', label: 'Correction Declined' },
  }

  if (loading) return <p className="claims-empty">Loading recorded time...</p>

  return (
    <div style={{ padding: '16px 0' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          className={`admin-tab ${subTab === 'employed' ? 'admin-tab-active' : ''}`}
          onClick={() => setSubTab('employed')}
          style={{ fontSize: 12, padding: '6px 14px' }}
        >
          Employed Shift Workers
        </button>
        <button
          className={`admin-tab ${subTab === 'zero_hours' ? 'admin-tab-active' : ''}`}
          onClick={() => setSubTab('zero_hours')}
          style={{ fontSize: 12, padding: '6px 14px' }}
        >
          Zero Hours Workers
        </button>
      </div>

      {employees.length === 0 ? (
        <p className="claims-empty">No {subTab === 'employed' ? 'employed shift' : 'zero hours'} workers found.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {employees.map(emp => {
            const entries = entriesByEmp[emp.id] || []
            const isExpanded = expandedEmp === emp.id
            const totalShifts = entries.length
            const totalHrs = entries.reduce((s, e) => s + e.totalHours, 0)
            const totalPayable = entries.reduce((s, e) => s + e.payableHours, 0)
            const corrCount = entries.filter(e => e.hasCorrectionRaised).length

            const weekGroups = new Map<string, RecordedEntry[]>()
            for (const e of entries) {
              const wk = getWeekKey(e.date)
              if (!weekGroups.has(wk)) weekGroups.set(wk, [])
              weekGroups.get(wk)!.push(e)
            }
            const sortedWeeks = [...weekGroups.keys()].sort((a, b) => b.localeCompare(a))

            return (
              <div key={emp.id} style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                <div
                  onClick={() => toggleEmp(emp.id)}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '12px 16px', cursor: 'pointer', background: isExpanded ? 'var(--bg-highlight, #f8f9fa)' : 'transparent',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{emp.first_name} {emp.last_name}</span>
                    {emp.job_title && <span style={{ fontSize: 12, color: '#666' }}>{emp.job_title}</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 16, alignItems: 'center', fontSize: 12 }}>
                    <span>{totalShifts} shift{totalShifts !== 1 ? 's' : ''}</span>
                    <span>{Math.round(totalHrs * 100) / 100} hrs recorded</span>
                    <span style={{ fontWeight: 600 }}>{Math.round(totalPayable * 100) / 100} hrs payable</span>
                    {corrCount > 0 && (
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: '#fff3e0', color: '#e65100' }}>
                        {corrCount} correction{corrCount !== 1 ? 's' : ''}
                      </span>
                    )}
                    <span style={{ fontSize: 16, transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                      &#9662;
                    </span>
                  </div>
                </div>

                {isExpanded && (
                  <div style={{ borderTop: '1px solid var(--border)' }}>
                    {entries.length === 0 ? (
                      <p style={{ padding: 16, fontSize: 12, color: '#666' }}>No shift assignments found.</p>
                    ) : (
                      sortedWeeks.map(weekKey => {
                        const weekEntries = weekGroups.get(weekKey)!
                        const weekOpen = expandedWeeks.has(weekKey)
                        const weekHrs = weekEntries.reduce((s, e) => s + e.totalHours, 0)
                        const weekPayable = weekEntries.reduce((s, e) => s + e.payableHours, 0)

                        return (
                          <div key={weekKey}>
                            <div
                              onClick={() => toggleWeek(weekKey)}
                              style={{
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                padding: '8px 16px', cursor: 'pointer',
                                background: 'var(--bg-subtle, #fafafa)', borderTop: '1px solid var(--border)',
                                fontSize: 12, fontWeight: 600,
                              }}
                            >
                              <span>Week: {fmtWeekLabel(weekKey)}</span>
                              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                                <span>{weekEntries.length} shift{weekEntries.length !== 1 ? 's' : ''}</span>
                                <span>{Math.round(weekHrs * 100) / 100} hrs</span>
                                <span style={{ fontWeight: 700 }}>{Math.round(weekPayable * 100) / 100} payable</span>
                                <span style={{ fontSize: 14, transform: weekOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                                  &#9662;
                                </span>
                              </div>
                            </div>

                            {weekOpen && (
                              <div className="admin-table-wrap" style={{ margin: 0 }}>
                                <table className="admin-table" style={{ fontSize: 12 }}>
                                  <thead>
                                    <tr>
                                      <th>Date</th>
                                      <th>Shift</th>
                                      <th>Scheduled</th>
                                      <th>Check-in</th>
                                      <th>Check-out</th>
                                      <th>Hours</th>
                                      <th>Break</th>
                                      <th>Payable</th>
                                      <th>OT</th>
                                      <th>Correction</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {weekEntries
                                      .sort((a, b) => b.date.localeCompare(a.date))
                                      .map(entry => {
                                        if (entry.checkins.length === 0) {
                                          return (
                                            <tr key={entry.assignmentId}>
                                              <td>{fmtDate(entry.date)}</td>
                                              <td>{entry.shiftName}</td>
                                              <td>{entry.scheduledStart} – {entry.scheduledEnd}</td>
                                              <td style={{ color: '#999' }}>—</td>
                                              <td style={{ color: '#999' }}>—</td>
                                              <td style={{ color: '#999' }}>0</td>
                                              <td>{entry.breakMinutes} mins</td>
                                              <td style={{ color: '#999' }}>0</td>
                                              <td style={{ color: '#999' }}>—</td>
                                              <td>
                                                {entry.hasCorrectionRaised && entry.correctionStatus && (() => {
                                                  const badge = CORR_BADGES[entry.correctionStatus] || CORR_BADGES.pending
                                                  return (
                                                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: badge.bg, color: badge.color }}>
                                                      {badge.label}
                                                    </span>
                                                  )
                                                })()}
                                                {!entry.hasCorrectionRaised && <span style={{ color: '#999' }}>—</span>}
                                              </td>
                                            </tr>
                                          )
                                        }

                                        return entry.checkins.map((ci, idx) => (
                                          <tr key={`${entry.assignmentId}_${idx}`}>
                                            {idx === 0 && (
                                              <>
                                                <td rowSpan={entry.checkins.length}>{fmtDate(entry.date)}</td>
                                                <td rowSpan={entry.checkins.length}>{entry.shiftName}</td>
                                                <td rowSpan={entry.checkins.length}>{entry.scheduledStart} – {entry.scheduledEnd}</td>
                                              </>
                                            )}
                                            <td>{fmtTime(ci.checkIn)}</td>
                                            <td>{ci.checkOut ? fmtTime(ci.checkOut) : <span style={{ color: '#e65100' }}>In progress</span>}</td>
                                            <td>{ci.hours > 0 ? ci.hours : '—'}</td>
                                            {idx === 0 && (
                                              <>
                                                <td rowSpan={entry.checkins.length}>{entry.breakMinutes} mins</td>
                                                <td rowSpan={entry.checkins.length} style={{ fontWeight: 600 }}>{entry.payableHours > 0 ? entry.payableHours : '—'}</td>
                                                {(() => {
                                                  const scheduledPayable = Math.max(0, entry.scheduledHours - entry.breakMinutes / 60)
                                                  const ot = Math.round((entry.payableHours - scheduledPayable) * 100) / 100
                                                  return (
                                                    <td rowSpan={entry.checkins.length} style={{
                                                      fontWeight: 600,
                                                      color: ot > 0 ? '#2e7d32' : ot < 0 ? '#dc2626' : '#999',
                                                    }}>
                                                      {ot > 0 ? `+${ot}` : ot < 0 ? `${ot}` : '—'}
                                                    </td>
                                                  )
                                                })()}
                                              </>
                                            )}
                                            {idx === 0 && (
                                              <td rowSpan={entry.checkins.length}>
                                                {entry.hasCorrectionRaised && entry.correctionStatus && (() => {
                                                  const badge = CORR_BADGES[entry.correctionStatus] || CORR_BADGES.pending
                                                  return (
                                                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: badge.bg, color: badge.color }}>
                                                      {badge.label}
                                                    </span>
                                                  )
                                                })()}
                                                {!entry.hasCorrectionRaised && <span style={{ color: '#999' }}>—</span>}
                                              </td>
                                            )}
                                          </tr>
                                        ))
                                      })}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        )
                      })
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
