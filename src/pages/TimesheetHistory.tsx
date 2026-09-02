import { useState, useEffect, useCallback, useMemo } from 'react'
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

const statusColor: Record<string, string> = {
  draft: '#9e9e9e',
  pending: '#ff9800',
  approved: '#4caf50',
  rejected: '#f44336',
}

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']

function getLast4Months(): { year: number; month: number }[] {
  const now = new Date()
  const months: { year: number; month: number }[] = []
  for (let i = 3; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push({ year: d.getFullYear(), month: d.getMonth() })
  }
  return months
}

export default function TimesheetHistory() {
  const navigate = useNavigate()
  const { t, tStatus } = useLanguage()
  const { employeeId } = useAuth()
  const [timesheets, setTimesheets] = useState<Timesheet[]>([])
  const [loading, setLoading] = useState(true)

  const fyMonths = useMemo(() => getLast4Months(), [])
  const [monthIdx, setMonthIdx] = useState(fyMonths.length - 1)
  const current = fyMonths[monthIdx]

  const fetchData = useCallback(async () => {
    if (!employeeId) return
    setLoading(true)
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth() - 3, 1)
    const startDate = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-01`

    const { data } = await supabase
      .from('timesheets')
      .select('id, location, customer, role, date, end_date, start_time, end_time, hours, status')
      .eq('employee_id', employeeId)
      .gte('date', startDate)
      .order('date', { ascending: false })

    setTimesheets((data as Timesheet[]) || [])
    setLoading(false)
  }, [employeeId])

  useEffect(() => { fetchData() }, [fetchData])

  const monthEntries = useMemo(() => {
    if (!current) return []
    const y = current.year
    const m = current.month
    const start = `${y}-${String(m + 1).padStart(2, '0')}-01`
    const endDate = new Date(y, m + 1, 0)
    const end = `${y}-${String(m + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`
    return timesheets.filter(ts => ts.date >= start && ts.date <= end)
  }, [timesheets, current])

  const monthTotal = monthEntries.reduce((s, ts) => s + Number(ts.hours), 0)
  const canPrev = monthIdx > 0
  const canNext = monthIdx < fyMonths.length - 1

  return (
    <div className="feature-page timesheets-page">
      <header className="feature-header">
        <button className="feature-back" onClick={() => navigate('/timesheets')}>
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
            <circle cx="18" cy="18" r="17" stroke="rgba(255,255,255,0.5)" strokeWidth="2" />
            <path d="M21 12l-6 6 6 6" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="feature-header-center">
          <h1 className="feature-title">{t('timesheets.history_title')}</h1>
          <p className="feature-subtitle">{t('timesheets.history_subtitle')}</p>
        </div>
        <button className="feature-refresh" onClick={fetchData}>
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="14" stroke="rgba(255,255,255,0.5)" strokeWidth="2" />
            <path d="M22 14a6.5 6.5 0 0 0-11.3-1.5M10 18a6.5 6.5 0 0 0 11.3 1.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
            <path d="M22 10v4h-4M10 22v-4h4" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </header>

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
        </div>

        {!loading && monthEntries.length > 0 && (
          <div className="ts-month-total">
            <span className="ts-month-total-label">{t('timesheets.month_total')}</span>
            <span className="ts-month-total-value">{monthTotal.toFixed(1)}h</span>
          </div>
        )}

        {!loading && monthEntries.length > 0 && (
          <div className="ts-month-metrics">
            <div className="ts-metric">
              <span className="ts-metric-value">{monthEntries.length}</span>
              <span className="ts-metric-label">Entries</span>
            </div>
            <div className="ts-metric">
              <span className="ts-metric-value">{monthTotal.toFixed(1)}h</span>
              <span className="ts-metric-label">Total Hours</span>
            </div>
            <div className="ts-metric">
              <span className="ts-metric-value">{monthEntries.length > 0 ? (monthTotal / monthEntries.length).toFixed(1) : '0'}h</span>
              <span className="ts-metric-label">Avg / Entry</span>
            </div>
            <div className="ts-metric">
              <span className="ts-metric-value" style={{ color: '#4caf50' }}>{monthEntries.filter(ts => ts.status === 'approved').length}</span>
              <span className="ts-metric-label">Approved</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
