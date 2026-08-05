import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'
import { formatDate, formatTime24 as formatTime } from '../lib/formatters'

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
  status: string
}

interface WeekGroup {
  weekStart: string
  weekEnd: string
  entries: Timesheet[]
  totalHours: number
}

function getMonday(d: Date): Date {
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  return new Date(d.getFullYear(), d.getMonth(), diff)
}

const statusColor: Record<string, string> = {
  draft: '#9e9e9e',
  pending: '#ff9800',
  approved: '#4caf50',
  rejected: '#f44336',
}

function groupByWeek(timesheets: Timesheet[]): WeekGroup[] {
  const weeks = new Map<string, Timesheet[]>()

  for (const ts of timesheets) {
    const d = new Date(ts.date + 'T00:00:00')
    const monday = getMonday(d)
    const key = monday.toISOString().split('T')[0]
    if (!weeks.has(key)) weeks.set(key, [])
    weeks.get(key)!.push(ts)
  }

  const sorted = Array.from(weeks.entries()).sort((a, b) => b[0].localeCompare(a[0]))

  return sorted.map(([mondayStr, entries]) => {
    const monday = new Date(mondayStr + 'T00:00:00')
    const sunday = new Date(monday)
    sunday.setDate(sunday.getDate() + 6)
    return {
      weekStart: formatDate(mondayStr),
      weekEnd: formatDate(sunday.toISOString().split('T')[0]),
      entries: entries.sort((a, b) => a.date.localeCompare(b.date)),
      totalHours: entries.reduce((sum, e) => sum + Number(e.hours), 0),
    }
  })
}

export default function TimesheetHistory() {
  const navigate = useNavigate()
  const { t, tStatus } = useLanguage()
  const { employeeId } = useAuth()
  const [timesheets, setTimesheets] = useState<Timesheet[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    if (!employeeId) return
    setLoading(true)
    const fourWeeksAgo = new Date()
    fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28)
    const cutoff = fourWeeksAgo.toISOString().split('T')[0]

    const { data } = await supabase
      .from('timesheets')
      .select('id, location, customer, role, date, end_date, start_time, end_time, hours, status')
      .eq('employee_id', employeeId)
      .gte('date', cutoff)
      .order('date', { ascending: false })

    setTimesheets((data as Timesheet[]) || [])
    setLoading(false)
  }, [employeeId])

  useEffect(() => { fetchData() }, [fetchData])

  const weeks = groupByWeek(timesheets)

  return (
    <div className="feature-page timesheets-page">
      <header className="feature-header">
        <button className="feature-back" onClick={() => navigate('/timesheets')}>
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
            <circle cx="18" cy="18" r="17" stroke="#1565c0" strokeWidth="2" />
            <path d="M21 12l-6 6 6 6" stroke="#1565c0" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="feature-header-center">
          <h1 className="feature-title">{t('timesheets.history_title')}</h1>
          <p className="feature-subtitle">{t('timesheets.history_subtitle')}</p>
        </div>
        <button className="feature-refresh" onClick={fetchData}>
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="14" stroke="#1565c0" strokeWidth="2" />
            <path d="M22 14a6.5 6.5 0 0 0-11.3-1.5M10 18a6.5 6.5 0 0 0 11.3 1.5" stroke="#1565c0" strokeWidth="2" strokeLinecap="round" />
            <path d="M22 10v4h-4M10 22v-4h4" stroke="#1565c0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </header>

      {loading && <p className="claims-empty">{t('common.loading')}</p>}

      {!loading && weeks.length === 0 && (
        <p className="claims-empty">{t('timesheets.no_timesheets')}</p>
      )}

      <div className="ts-history-weeks">
        {weeks.map(week => (
          <div key={week.weekStart} className="ts-week-group">
            <div className="ts-week-header">
              <span className="ts-week-range">{t('timesheets.week_of')} {week.weekStart} - {week.weekEnd}</span>
              <span className="ts-week-total">{week.totalHours.toFixed(1)}h</span>
            </div>
            <div className="claims-list">
              {week.entries.map(ts => (
                <button key={ts.id} className="claim-row" onClick={() => navigate(`/timesheets/${ts.id}`)}>
                  <div className="claim-date-col">
                    <span className="claim-date">{ts.end_date && ts.end_date !== ts.date ? `${formatDate(ts.date)} – ${formatDate(ts.end_date)}` : formatDate(ts.date)}</span>
                    <span className="claim-id">{formatTime(ts.start_time)} - {formatTime(ts.end_time)}</span>
                  </div>
                  <div className="claim-detail-col">
                    <span className="claim-desc">{ts.role} {ts.location !== 'Unassigned' ? `- ${ts.location}` : ''}</span>
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
            <div className="ts-week-total-row">
              <span className="ts-week-total-label">{t('timesheets.total_hours')}</span>
              <span className="ts-week-total-value">{week.totalHours.toFixed(1)}h</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
