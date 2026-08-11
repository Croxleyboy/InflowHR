import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'

interface CalendarLeave {
  id: number
  employee_id: string
  start_date: string
  end_date: string
  days_requested: number
  leave_type_id: number
  emp_name: string
  emp_avatar: string | null
  colour: string
}

const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DE_MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

function getMonday(d: Date): Date {
  const result = new Date(d)
  const day = result.getDay()
  const diff = day === 0 ? -6 : 1 - day
  result.setDate(result.getDate() + diff)
  result.setHours(0, 0, 0, 0)
  return result
}

function dateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

interface DayInfo {
  colour: string
  halfDay: boolean
}


export default function LeaveCalendar() {
  const navigate = useNavigate()
  const { t, lang } = useLanguage()
  const { companyUser } = useAuth()
  const [leaves, setLeaves] = useState<CalendarLeave[]>([])
  const [loading, setLoading] = useState(true)

  const today = new Date()
  const thisMonday = getMonday(today)
  const weeks = [thisMonday, addDays(thisMonday, 7), addDays(thisMonday, 14)]
  const rangeStart = dateStr(thisMonday)
  const rangeEnd = dateStr(addDays(thisMonday, 20))

  const dayKeys = ['leave_calendar.mon', 'leave_calendar.tue', 'leave_calendar.wed', 'leave_calendar.thu', 'leave_calendar.fri', 'leave_calendar.sat', 'leave_calendar.sun']

  const fetchData = useCallback(async () => {
    if (!companyUser?.company_id) return
    setLoading(true)
    const { data: reqs } = await supabase
      .from('leave_requests')
      .select('id, employee_id, start_date, end_date, days_requested, leave_type_id')
      .eq('company_id', companyUser.company_id)
      .eq('status', 'approved')
      .lte('start_date', rangeEnd)
      .gte('end_date', rangeStart)

    if (reqs && reqs.length > 0) {
      const empIds = [...new Set(reqs.map((r: any) => r.employee_id))]
      const typeIds = [...new Set(reqs.map((r: any) => r.leave_type_id).filter(Boolean))]

      const [empsRes, typesRes] = await Promise.all([
        supabase
          .from('employees')
          .select('id, first_name, last_name, avatar_url')
          .in('id', empIds)
          .eq('company_id', companyUser.company_id),
        typeIds.length > 0
          ? supabase.from('leave_types').select('id, colour').in('id', typeIds)
          : Promise.resolve({ data: [] }),
      ])

      const empMap = new Map((empsRes.data || []).map((e: any) => [e.id, { name: `${e.first_name} ${e.last_name}`, avatar: e.avatar_url }]))
      const typeMap = new Map((typesRes.data || []).map((lt: any) => [lt.id, lt.colour || '#43a047']))

      setLeaves(reqs.map((r: any) => ({
        ...r,
        days_requested: Number(r.days_requested) || 1,
        emp_name: empMap.get(r.employee_id)?.name || 'Unknown',
        emp_avatar: empMap.get(r.employee_id)?.avatar || null,
        colour: typeMap.get(r.leave_type_id) || '#43a047',
      })))
    } else {
      setLeaves([])
    }

    setLoading(false)
  }, [rangeStart, rangeEnd, companyUser?.company_id])

  useEffect(() => { fetchData() }, [fetchData])

  const nextMonday = addDays(thisMonday, 7)
  const nextSunday = addDays(nextMonday, 6)
  const nextWeekLeaves = leaves.filter(l => l.start_date <= dateStr(nextSunday) && l.end_date >= dateStr(nextMonday))
  const nextWeekPeople = new Set(nextWeekLeaves.map(l => l.employee_id)).size

  function getDayInfo(empLeaves: CalendarLeave[], day: Date): DayInfo | null {
    const ds = dateStr(day)
    for (const l of empLeaves) {
      if (l.start_date <= ds && l.end_date >= ds) {
        return { colour: l.colour, halfDay: l.days_requested === 0.5 }
      }
    }
    return null
  }

  function dayHasLeave(day: Date): boolean {
    const ds = dateStr(day)
    return leaves.some(l => l.start_date <= ds && l.end_date >= ds)
  }

  const months = lang === 'de' ? DE_MONTHS : EN_MONTHS

  return (
    <div className="feature-page leave-calendar-page">
      <header className="leave-calendar-header">
        <button className="leave-calendar-back" onClick={() => navigate('/leave/history')}>
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
            <circle cx="18" cy="18" r="17" stroke="#43a047" strokeWidth="2" />
            <path d="M21 12l-6 6 6 6" stroke="#43a047" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="leave-calendar-header-center">
          <h1 className="leave-calendar-title">{t('leave_calendar.title')} <span className="leave-calendar-title-accent">{t('leave_calendar.title_accent')}</span></h1>
        </div>
        <button className="feature-refresh" onClick={fetchData}>
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="14" stroke="#43a047" strokeWidth="2" />
            <path d="M22 14a6.5 6.5 0 0 0-11.3-1.5M10 18a6.5 6.5 0 0 0 11.3 1.5" stroke="#43a047" strokeWidth="2" strokeLinecap="round" />
            <path d="M22 10v4h-4M10 22v-4h4" stroke="#43a047" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </header>

      <div className="leave-calendar-people-badge">
        <div className="leave-calendar-people-text">
          <span className="leave-calendar-people-label">{t('leave_calendar.people_on_leave')}</span>
          <span className="leave-calendar-people-sub">{t('leave_history.next_week')}</span>
        </div>
        <span className="leave-calendar-people-count">{nextWeekPeople}</span>
      </div>

      {loading && <p className="claims-empty">{t('common.loading')}</p>}

      {!loading && weeks.map((weekStart, wi) => {
        const monthIdx = weekStart.getMonth()
        const year = weekStart.getFullYear()
        const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
        const weekLeaves = leaves.filter(l =>
          l.start_date <= dateStr(addDays(weekStart, 6)) && l.end_date >= dateStr(weekStart)
        )

        const employeeMap = new Map<string, { name: string; avatar: string | null; leaves: CalendarLeave[] }>()
        for (const l of weekLeaves) {
          if (!employeeMap.has(l.employee_id)) {
            employeeMap.set(l.employee_id, { name: l.emp_name, avatar: l.emp_avatar, leaves: [] })
          }
          employeeMap.get(l.employee_id)!.leaves.push(l)
        }
        const groupedEmployees = [...employeeMap.entries()]

        return (
          <div key={wi} className="leave-calendar-week">
            <h3 className="leave-calendar-month">{months[monthIdx]} {year}</h3>
            <div className="leave-calendar-grid">
              <div className="leave-calendar-day-headers">
                {dayKeys.map(k => (
                  <span key={k} className="leave-calendar-day-header">{t(k)}</span>
                ))}
              </div>
              <div className="leave-calendar-day-cells">
                {days.map(day => {
                  const isToday = dateStr(day) === dateStr(today)
                  const isWeekend = day.getDay() === 0 || day.getDay() === 6
                  const hasLeave = dayHasLeave(day)
                  return (
                    <div
                      key={dateStr(day)}
                      className={`leave-calendar-day-cell ${isToday ? 'leave-calendar-today' : ''} ${isWeekend ? 'leave-calendar-weekend' : ''} ${hasLeave ? 'leave-calendar-day-has-leave' : ''}`}
                    >
                      {day.getDate()}
                    </div>
                  )
                })}
              </div>
            </div>

            {groupedEmployees.length === 0 && (
              <p className="leave-calendar-no-leave">{t('leave_calendar.no_leave')}</p>
            )}

            {groupedEmployees.map(([empId, emp]) => (
              <div key={empId} className="leave-calendar-person-row">
                {emp.avatar ? <img className="leave-calendar-person-avatar-img" src={emp.avatar} alt={emp.name} /> : <div className="leave-calendar-person-avatar">
                  {emp.name.split(' ').map(n => n[0]).join('')}
                </div>}
                <span className="leave-calendar-person-name">{emp.name}</span>
                <div className="leave-calendar-person-days">
                  {days.map(day => {
                    const info = getDayInfo(emp.leaves, day)
                    if (info && info.halfDay) {
                      return (
                        <div key={dateStr(day)} className="leave-calendar-person-dot leave-calendar-dot-half" style={{ '--dot-colour': info.colour } as React.CSSProperties} />
                      )
                    }
                    return (
                      <div
                        key={dateStr(day)}
                        className={`leave-calendar-person-dot ${info ? 'leave-calendar-dot-off' : ''}`}
                        style={info ? { background: info.colour } : undefined}
                      />
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}
