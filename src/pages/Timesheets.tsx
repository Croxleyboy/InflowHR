import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'
import { useCheckIn } from '../context/CheckInContext'
import { formatDate, formatTime24 as formatTime } from '../lib/formatters'

type TimesheetStatus = 'draft' | 'pending' | 'approved' | 'rejected'
type Filter = 'all' | 'approved' | 'pending' | 'cancelled'

interface Timesheet {
  id: number
  location: string
  customer: string | null
  role: string
  date: string
  end_date: string | null
  start_time: string
  end_time: string
  hours: number
  status: TimesheetStatus
  created_at: string
}

const statusColor: Record<string, string> = {
  draft: '#9e9e9e',
  pending: '#ff9800',
  approved: '#4caf50',
  rejected: '#f44336',
  cancelled: '#78909c',
}

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']

function getFYMonths(): { year: number; month: number }[] {
  const now = new Date()
  const fyStartMonth = 3
  const fyStartYear = now.getMonth() >= fyStartMonth ? now.getFullYear() : now.getFullYear() - 1
  const months: { year: number; month: number }[] = []
  for (let i = 0; i < 12; i++) {
    const m = (fyStartMonth + i) % 12
    const y = fyStartYear + Math.floor((fyStartMonth + i) / 12)
    if (y > now.getFullYear() || (y === now.getFullYear() && m > now.getMonth())) break
    months.push({ year: y, month: m })
  }
  return months
}

function getWeekRange(offset: number): { start: string; end: string; label: string } {
  const now = new Date()
  const day = now.getDay()
  const mondayOffset = day === 0 ? -6 : 1 - day
  const monday = new Date(now)
  monday.setDate(now.getDate() + mondayOffset + offset * 7)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return {
    start: fmt(monday),
    end: fmt(sunday),
    label: `${monday.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${sunday.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`,
  }
}

function getWorkingDaysInMonth(year: number, month: number): number {
  let count = 0
  const d = new Date(year, month, 1)
  const end = new Date(year, month + 1, 0)
  while (d <= end) {
    const day = d.getDay()
    if (day !== 0 && day !== 6) count++
    d.setDate(d.getDate() + 1)
  }
  return count
}

export default function Timesheets() {
  const navigate = useNavigate()
  const { t, tStatus } = useLanguage()
  const { employeeId, companyUser } = useAuth()
  const { settings: ciSettings } = useCheckIn()
  const [filter, setFilter] = useState<Filter>('all')
  const [timesheets, setTimesheets] = useState<Timesheet[]>([])
  const [loading, setLoading] = useState(true)
  const [monitoringEnabled, setMonitoringEnabled] = useState(false)
  const [monitoringPeriod, setMonitoringPeriod] = useState<'weekly' | 'monthly'>('weekly')
  const [weeklyHours, setWeeklyHours] = useState(37.5)

  const fyMonths = useMemo(() => getFYMonths(), [])
  const [monthIdx, setMonthIdx] = useState(fyMonths.length - 1)
  const current = fyMonths[monthIdx]

  const fetchTimesheets = useCallback(async () => {
    if (!employeeId) return
    setLoading(true)
    const fyStartMonth = 3
    const now = new Date()
    const fyStartYear = now.getMonth() >= fyStartMonth ? now.getFullYear() : now.getFullYear() - 1
    const startDate = `${fyStartYear}-${String(fyStartMonth + 1).padStart(2, '0')}-01`

    const companyId = companyUser?.company_id
    const [tsRes, companyRes, empRes] = await Promise.all([
      supabase.from('timesheets')
        .select('id, location, customer, role, date, end_date, start_time, end_time, hours, status, created_at')
        .eq('employee_id', employeeId)
        .gte('date', startDate)
        .order('date', { ascending: false }),
      companyId ? supabase.from('companies').select('timesheet_monitoring_enabled, timesheet_monitoring_period').eq('id', companyId).single() : Promise.resolve({ data: null }),
      supabase.from('employees').select('weekly_hours').eq('id', employeeId).single(),
    ])

    setTimesheets((tsRes.data as Timesheet[]) || [])
    if (companyRes.data) {
      setMonitoringEnabled(companyRes.data.timesheet_monitoring_enabled || false)
      setMonitoringPeriod(companyRes.data.timesheet_monitoring_period || 'weekly')
    }
    if (empRes.data?.weekly_hours) setWeeklyHours(empRes.data.weekly_hours)
    setLoading(false)
  }, [employeeId, companyUser?.company_id])

  useEffect(() => { fetchTimesheets() }, [fetchTimesheets])

  const monthEntries = useMemo(() => {
    if (!current) return []
    const y = current.year
    const m = current.month
    const start = `${y}-${String(m + 1).padStart(2, '0')}-01`
    const endDate = new Date(y, m + 1, 0)
    const end = `${y}-${String(m + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`
    let entries = timesheets.filter(ts => ts.date >= start && ts.date <= end)
    if (filter === 'cancelled') entries = entries.filter(ts => ts.status === 'rejected')
    else if (filter !== 'all') entries = entries.filter(ts => ts.status === filter)
    return entries
  }, [timesheets, current, filter])

  const monthTotal = monthEntries.reduce((s, ts) => s + Number(ts.hours), 0)
  const canPrev = monthIdx > 0
  const canNext = monthIdx < fyMonths.length - 1

  const weekRange = useMemo(() => getWeekRange(0), [])
  const weekTotal = useMemo(() => {
    return timesheets
      .filter(ts => ts.date >= weekRange.start && ts.date <= weekRange.end)
      .reduce((s, ts) => s + Number(ts.hours), 0)
  }, [timesheets, weekRange])

  const monthContracted = useMemo(() => {
    if (!current) return 0
    const workingDays = getWorkingDaysInMonth(current.year, current.month)
    return (weeklyHours / 5) * workingDays
  }, [current, weeklyHours])

  const weekShortfall = Math.max(0, weeklyHours - weekTotal)
  const monthShortfall = Math.max(0, monthContracted - monthTotal)

  const filters: { key: Filter; label: string }[] = [
    { key: 'all', label: t('timesheets.all') },
    { key: 'approved', label: t('timesheets.approved') },
    { key: 'pending', label: t('timesheets.pending') },
    { key: 'cancelled', label: 'Declined' },
  ]

  return (
    <div className="feature-page timesheets-page">
      <header className="feature-header">
        <button className="feature-back" onClick={() => navigate('/')}>
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
            <circle cx="18" cy="18" r="17" stroke="rgba(255,255,255,0.5)" strokeWidth="2" />
            <path d="M21 12l-6 6 6 6" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="feature-header-center">
          <h1 className="feature-title">{t('timesheets.title')} <span className="feature-title-accent">{t('timesheets.title_accent')}</span></h1>
          <p className="feature-subtitle">{t('timesheets.subtitle')}</p>
        </div>
        <button className="feature-refresh" onClick={fetchTimesheets}>
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="14" stroke="rgba(255,255,255,0.5)" strokeWidth="2" />
            <path d="M22 14a6.5 6.5 0 0 0-11.3-1.5M10 18a6.5 6.5 0 0 0 11.3 1.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
            <path d="M22 10v4h-4M10 22v-4h4" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </header>

      <div className="ts-filters">
        {filters.map(f => (
          <button
            key={f.key}
            className={`ts-filter-btn ${filter === f.key ? 'active' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="ts-action-row">
        <button className="ts-action-btn ts-action-add" onClick={() => navigate('/timesheets/new')}>
          + {t('timesheets.add_new')}
        </button>
        {ciSettings?.timesheets_checkin_enabled && (
          <button className="ts-action-btn ts-action-checkin" onClick={() => navigate('/timesheets/checkin')}>
            Check In
          </button>
        )}
        <button className="ts-action-btn ts-action-history" onClick={() => navigate('/timesheets/history')}>
          {t('timesheets.last_4_weeks')}
        </button>
      </div>

      {monitoringEnabled && !loading && (
        <div className="ts-summary-cards">
          {monitoringPeriod === 'weekly' && (
            <>
              <div className="ts-summary-card">
                <span className="ts-summary-label">This Week</span>
                <span className="ts-summary-value">{weekTotal.toFixed(1)}h</span>
                <span className="ts-summary-sub">of {weeklyHours.toFixed(1)}h</span>
              </div>
              <div className="ts-summary-card">
                <span className="ts-summary-label">This Month</span>
                <span className="ts-summary-value">{monthTotal.toFixed(1)}h</span>
                <span className="ts-summary-sub">of {monthContracted.toFixed(1)}h</span>
              </div>
              <div className={`ts-summary-card ${weekShortfall > 0 ? 'ts-summary-shortfall' : 'ts-summary-ontrack'}`}>
                <span className="ts-summary-label">Week Shortfall</span>
                <span className="ts-summary-value">{weekShortfall > 0 ? `${weekShortfall.toFixed(1)}h` : 'On track'}</span>
                <span className="ts-summary-sub">{weekRange.label}</span>
              </div>
            </>
          )}
          {monitoringPeriod === 'monthly' && (
            <>
              <div className="ts-summary-card">
                <span className="ts-summary-label">This Month</span>
                <span className="ts-summary-value">{monthTotal.toFixed(1)}h</span>
                <span className="ts-summary-sub">of {monthContracted.toFixed(1)}h</span>
              </div>
              <div className={`ts-summary-card ${monthShortfall > 0 ? 'ts-summary-shortfall' : 'ts-summary-ontrack'}`}>
                <span className="ts-summary-label">Month Shortfall</span>
                <span className="ts-summary-value">{monthShortfall > 0 ? `${monthShortfall.toFixed(1)}h` : 'On track'}</span>
                <span className="ts-summary-sub">{current ? `${MONTH_NAMES[current.month]} ${current.year}` : ''}</span>
              </div>
            </>
          )}
        </div>
      )}

      <div className="ts-month-card">
        <div className="ts-month-nav">
          <button className="ts-month-nav-btn" disabled={!canPrev} onClick={() => setMonthIdx(i => i - 1)}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
          <span className="ts-month-label">
            {current ? `${MONTH_NAMES[current.month]} ${current.year}` : ''}
          </span>
          <button className="ts-month-nav-btn" disabled={!canNext} onClick={() => setMonthIdx(i => i + 1)}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6"/></svg>
          </button>
        </div>

        <div className="ts-month-list">
          {loading && <p className="claims-empty">{t('common.loading')}</p>}
          {!loading && monthEntries.length === 0 && (
            <p className="claims-empty">{t('timesheets.no_timesheets')}</p>
          )}
          <div className="claims-list">
            {monthEntries.map(ts => (
              <button key={ts.id} className="claim-row" onClick={() => navigate(`/timesheets/${ts.id}`)}>
                <div className="claim-date-col">
                  <span className="claim-date">{ts.end_date && ts.end_date !== ts.date ? `${formatDate(ts.date)} – ${formatDate(ts.end_date)}` : formatDate(ts.date)}</span>
                  <span className="claim-id">{formatTime(ts.start_time)} - {formatTime(ts.end_time)}</span>
                </div>
                <div className="claim-detail-col">
                  <span className="claim-desc">{ts.role}</span>
                  <div className="claim-amount-row">
                    <span className="claim-amount">{Number(ts.hours).toFixed(1)}h</span>
                    <span className="claim-status">
                      <span className="status-dot" style={{ background: statusColor[ts.status] }} />
                      {tStatus(ts.status)}
                    </span>
                  </div>
                </div>
                <svg width="28" height="28" viewBox="0 0 32 32" fill="none" className="claim-arrow">
                  <path d="M12 6l10 10-10 10" stroke="#1565c0" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            ))}
          </div>
        </div>

        {!loading && monthEntries.length > 0 && (
          <div className="ts-month-total">
            <span className="ts-month-total-label">{t('timesheets.month_total')}</span>
            <span className="ts-month-total-value">{monthTotal.toFixed(1)}h</span>
          </div>
        )}
      </div>
    </div>
  )
}
