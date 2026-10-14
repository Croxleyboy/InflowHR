import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'
import { useUserPreferences } from '../hooks/useUserPreferences'

interface LeaveEntry {
  id: number
  employee_id: string
  start_date: string
  end_date: string
  days_requested: number
  emp_name: string
  emp_avatar: string | null
}

const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DE_MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const EN_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DE_DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

function dateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

function getMonday(d: Date): Date {
  const result = new Date(d)
  const day = result.getDay()
  result.setDate(result.getDate() - (day === 0 ? 6 : day - 1))
  result.setHours(0, 0, 0, 0)
  return result
}

function getFYRange(fyStartMonth: number, today: Date): { fyStart: Date; fyEnd: Date } {
  const year = today.getFullYear()
  const month = today.getMonth() + 1
  const startYear = month >= fyStartMonth ? year : year - 1
  const fyStart = new Date(startYear, fyStartMonth - 1, 1)
  const fyEnd = new Date(startYear + 1, fyStartMonth - 1, 0)
  return { fyStart, fyEnd }
}

function getCalendarDays(year: number, month: number): Date[] {
  const first = new Date(year, month, 1)
  const last = new Date(year, month + 1, 0)
  const startDay = first.getDay()
  const mondayOffset = startDay === 0 ? -6 : 1 - startDay
  const calStart = new Date(year, month, 1 + mondayOffset)
  const days: Date[] = []
  const totalCells = Math.ceil((last.getDate() - mondayOffset) / 7) * 7
  for (let i = 0; i < Math.max(totalCells, 35); i++) {
    days.push(addDays(calStart, i))
  }
  if (days.length < 42 && days[days.length - 1] < last) {
    while (days.length < 42) days.push(addDays(calStart, days.length))
  }
  return days
}

interface DayLeaveInfo {
  people: { id: string; name: string; avatar: string | null; halfDay: boolean }[]
  hasFullDay: boolean
  hasHalfDayOnly: boolean
}

export default function LeaveCalendar() {
  const navigate = useNavigate()
  const { t, lang, fyStartMonth } = useLanguage()
  const { companyUser } = useAuth()
  const { prefs } = useUserPreferences()
  const [leaves, setLeaves] = useState<LeaveEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [searchText, setSearchText] = useState('')
  const [watchlistOnly, setWatchlistOnly] = useState(false)
  const [slideDay, setSlideDay] = useState<string | null>(null)

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const { fyStart, fyEnd } = getFYRange(fyStartMonth, today)

  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())

  const months = lang === 'de' ? DE_MONTHS : EN_MONTHS
  const dayHeaders = lang === 'de' ? DE_DAYS : EN_DAYS
  const isEn = lang !== 'de'

  const canGoBack = new Date(viewYear, viewMonth, 1) > fyStart
  const canGoForward = new Date(viewYear, viewMonth + 1, 0) < fyEnd

  function goBack() {
    if (!canGoBack) return
    if (viewMonth === 0) { setViewYear(viewYear - 1); setViewMonth(11) }
    else setViewMonth(viewMonth - 1)
  }
  function goForward() {
    if (!canGoForward) return
    if (viewMonth === 11) { setViewYear(viewYear + 1); setViewMonth(0) }
    else setViewMonth(viewMonth + 1)
  }

  const calDays = useMemo(() => getCalendarDays(viewYear, viewMonth), [viewYear, viewMonth])
  const rangeStart = dateStr(calDays[0])
  const rangeEnd = dateStr(calDays[calDays.length - 1])

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
      const { data: emps } = await supabase
        .from('employees')
        .select('id, first_name, last_name, avatar_url')
        .in('id', empIds)
        .eq('company_id', companyUser.company_id)

      const empMap = new Map((emps || []).map((e: any) => [e.id, { name: `${e.first_name} ${e.last_name}`, avatar: e.avatar_url }]))

      setLeaves(reqs.map((r: any) => ({
        id: r.id,
        employee_id: r.employee_id,
        start_date: r.start_date,
        end_date: r.end_date,
        days_requested: Number(r.days_requested) || 1,
        emp_name: empMap.get(r.employee_id)?.name || 'Unknown',
        emp_avatar: empMap.get(r.employee_id)?.avatar || null,
      })))
    } else {
      setLeaves([])
    }
    setLoading(false)
  }, [rangeStart, rangeEnd, companyUser?.company_id])

  useEffect(() => { fetchData() }, [fetchData])

  const watchlist = prefs.kudos_watchlist || []

  const filteredLeaves = useMemo(() => {
    let result = leaves
    if (watchlistOnly && watchlist.length > 0) {
      result = result.filter(l => watchlist.includes(l.employee_id))
    }
    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase()
      result = result.filter(l => l.emp_name.toLowerCase().includes(q))
    }
    return result
  }, [leaves, watchlistOnly, watchlist, searchText])

  const dayMap = useMemo(() => {
    const map = new Map<string, DayLeaveInfo>()
    for (const day of calDays) {
      const ds = dateStr(day)
      const people: DayLeaveInfo['people'] = []
      const seen = new Set<string>()
      for (const l of filteredLeaves) {
        if (l.start_date <= ds && l.end_date >= ds && !seen.has(l.employee_id)) {
          seen.add(l.employee_id)
          people.push({ id: l.employee_id, name: l.emp_name, avatar: l.emp_avatar, halfDay: l.days_requested === 0.5 })
        }
      }
      const hasFullDay = people.some(p => !p.halfDay)
      const hasHalfDayOnly = people.length > 0 && !hasFullDay
      map.set(ds, { people, hasFullDay, hasHalfDayOnly })
    }
    return map
  }, [calDays, filteredLeaves])

  const thisMonday = getMonday(today)
  const weekCards = [
    { label: isEn ? 'This week' : 'Diese Woche', start: thisMonday, end: addDays(thisMonday, 6) },
    { label: isEn ? 'Next week' : 'Nächste Woche', start: addDays(thisMonday, 7), end: addDays(thisMonday, 13) },
    { label: isEn ? 'In 2 weeks' : 'In 2 Wochen', start: addDays(thisMonday, 14), end: addDays(thisMonday, 20) },
  ]

  function countPeopleInRange(start: Date, end: Date): number {
    const s = dateStr(start)
    const e = dateStr(end)
    const ids = new Set<string>()
    for (const l of leaves) {
      if (l.start_date <= e && l.end_date >= s) ids.add(l.employee_id)
    }
    return ids.size
  }

  const slideDayInfo = slideDay ? dayMap.get(slideDay) : null
  const slideDayDate = slideDay ? new Date(slideDay + 'T00:00:00') : null

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

      <div className="leave-calendar-people-badges">
        {weekCards.map((wc, i) => (
          <div key={i} className="leave-calendar-people-badge">
            <div className="leave-calendar-people-text">
              <span className="leave-calendar-people-label">{t('leave_calendar.people_on_leave')}</span>
              <span className="leave-calendar-people-sub">{wc.label}</span>
            </div>
            <span className="leave-calendar-people-count">{countPeopleInRange(wc.start, wc.end)}</span>
          </div>
        ))}
      </div>

      <div className="lc-controls">
        <div className="lc-search-wrap">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" /><line x1="16.5" y1="16.5" x2="21" y2="21" />
          </svg>
          <input
            type="text"
            className="lc-search"
            placeholder={isEn ? 'Search person...' : 'Person suchen...'}
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
          />
          {searchText && (
            <button className="lc-search-clear" onClick={() => setSearchText('')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          )}
        </div>
        <label className="lc-watchlist-toggle">
          <div className={`lc-switch ${watchlistOnly ? 'lc-switch-on' : ''}`} onClick={() => setWatchlistOnly(!watchlistOnly)}>
            <div className="lc-switch-thumb" />
          </div>
          <span className="lc-watchlist-label">{isEn ? 'Watchlist only' : 'Nur Watchlist'}</span>
        </label>
      </div>

      <div className="lc-month-nav">
        <button className="lc-nav-arrow" disabled={!canGoBack} onClick={goBack}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h2 className="lc-month-title">{months[viewMonth]} {viewYear}</h2>
        <button className="lc-nav-arrow" disabled={!canGoForward} onClick={goForward}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 6 15 12 9 18" />
          </svg>
        </button>
      </div>

      {loading && <p className="claims-empty">{t('common.loading')}</p>}

      {!loading && (
        <div className="lc-grid">
          <div className="lc-day-headers">
            {dayHeaders.map(d => <div key={d} className="lc-day-header">{d}</div>)}
          </div>
          <div className="lc-days">
            {calDays.map(day => {
              const ds = dateStr(day)
              const isCurrentMonth = day.getMonth() === viewMonth
              const isToday = ds === dateStr(today)
              const info = dayMap.get(ds)
              const people = info?.people || []
              const isWeekend = day.getDay() === 0 || day.getDay() === 6

              let cubeClass = 'lc-cube'
              if (!isCurrentMonth) cubeClass += ' lc-cube-other'
              if (isToday) cubeClass += ' lc-cube-today'
              if (isWeekend && !info?.hasFullDay && !info?.hasHalfDayOnly) cubeClass += ' lc-cube-weekend'
              if (info?.hasFullDay) {
                cubeClass += ' lc-cube-full'
                if (people.length > 1) cubeClass += ' lc-cube-multi'
              } else if (info?.hasHalfDayOnly) cubeClass += ' lc-cube-half'
              else cubeClass += ' lc-cube-empty'

              return (
                <button
                  key={ds}
                  className={cubeClass}
                  onClick={() => people.length > 0 && setSlideDay(ds)}
                >
                  <span className="lc-cube-date">{day.getDate()}</span>
                  {people.length > 0 && (
                    <div className="lc-cube-avatars">
                      {people.slice(0, 3).map((p, i) => (
                        p.avatar
                          ? <img key={p.id} className="lc-mini-avatar" src={p.avatar} alt="" style={{ zIndex: 3 - i, marginLeft: i > 0 ? -8 : 0 }} />
                          : <div key={p.id} className="lc-mini-avatar lc-mini-avatar-init" style={{ zIndex: 3 - i, marginLeft: i > 0 ? -8 : 0 }}>
                              {p.name.split(' ').map(n => n[0]).join('')}
                            </div>
                      ))}
                      {people.length > 3 && (
                        <div className="lc-mini-avatar lc-mini-more" style={{ zIndex: 0, marginLeft: -8 }}>
                          +{people.length - 3}
                        </div>
                      )}
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="lc-legend">
        <div className="lc-legend-item"><span className="lc-legend-dot lc-legend-full" />{isEn ? 'Full day leave' : 'Ganzer Tag'}</div>
        <div className="lc-legend-item"><span className="lc-legend-dot lc-legend-multi" />{isEn ? 'Multiple people' : 'Mehrere Personen'}</div>
        <div className="lc-legend-item"><span className="lc-legend-dot lc-legend-half" />{isEn ? 'Half day only' : 'Halber Tag'}</div>
        <div className="lc-legend-item"><span className="lc-legend-dot lc-legend-none" />{isEn ? 'No leave' : 'Kein Urlaub'}</div>
      </div>

      {slideDay && (
        <>
          <div className="lc-overlay" onClick={() => setSlideDay(null)} />
          <div className="lc-slide-panel">
            <div className="lc-slide-header">
              <h3 className="lc-slide-title">
                {slideDayDate && slideDayDate.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </h3>
              <button className="lc-slide-close" onClick={() => setSlideDay(null)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <p className="lc-slide-count">
              {slideDayInfo?.people.length || 0} {isEn ? 'people on leave' : 'Personen im Urlaub'}
            </p>
            <div className="lc-slide-list">
              {slideDayInfo?.people.map(p => (
                <div key={p.id} className="lc-slide-person">
                  {p.avatar
                    ? <img className="lc-slide-avatar" src={p.avatar} alt="" />
                    : <div className="lc-slide-avatar lc-slide-avatar-init">{p.name.split(' ').map(n => n[0]).join('')}</div>
                  }
                  <div className="lc-slide-person-info">
                    <span className="lc-slide-person-name">{p.name}</span>
                    <span className={`lc-slide-person-type ${p.halfDay ? 'lc-slide-half' : 'lc-slide-full'}`}>
                      {p.halfDay ? (isEn ? 'Half day' : 'Halber Tag') : (isEn ? 'Full day' : 'Ganzer Tag')}
                    </span>
                  </div>
                </div>
              ))}
              {(!slideDayInfo || slideDayInfo.people.length === 0) && (
                <p className="lc-slide-empty">{isEn ? 'No one on leave this day' : 'Niemand im Urlaub an diesem Tag'}</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
