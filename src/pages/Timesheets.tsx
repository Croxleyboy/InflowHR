import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'
import { formatDate, formatTime24 as formatTime } from '../lib/formatters'

type TimesheetStatus = 'draft' | 'pending' | 'approved' | 'rejected'
type Filter = 'all' | 'approved' | 'pending'

interface Timesheet {
  id: number
  location: string
  customer: string | null
  role: string
  date: string
  start_time: string
  end_time: string
  hours: number
  status: TimesheetStatus
  created_at: string
}

const statusColor: Record<TimesheetStatus, string> = {
  draft: '#9e9e9e',
  pending: '#ff9800',
  approved: '#4caf50',
  rejected: '#f44336',
}

export default function Timesheets() {
  const navigate = useNavigate()
  const { t, tStatus } = useLanguage()
  const { employeeId } = useAuth()
  const [filter, setFilter] = useState<Filter>('all')
  const [timesheets, setTimesheets] = useState<Timesheet[]>([])
  const [loading, setLoading] = useState(true)

  const fetchTimesheets = useCallback(async () => {
    if (!employeeId) return
    setLoading(true)
    const { data } = await supabase
      .from('timesheets')
      .select('id, location, customer, role, date, start_time, end_time, hours, status, created_at')
      .eq('employee_id', employeeId)
      .order('date', { ascending: false })
      .limit(20)
    setTimesheets((data as Timesheet[]) || [])
    setLoading(false)
  }, [employeeId])

  useEffect(() => { fetchTimesheets() }, [fetchTimesheets])

  const filtered = filter === 'all'
    ? timesheets
    : timesheets.filter(ts => ts.status === filter)

  const filters: { key: Filter; label: string }[] = [
    { key: 'all', label: t('timesheets.all') },
    { key: 'approved', label: t('timesheets.approved') },
    { key: 'pending', label: t('timesheets.pending') },
  ]

  return (
    <div className="feature-page timesheets-page">
      <header className="feature-header">
        <button className="feature-back" onClick={() => navigate('/')}>
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
            <circle cx="18" cy="18" r="17" stroke="#1565c0" strokeWidth="2" />
            <path d="M21 12l-6 6 6 6" stroke="#1565c0" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="feature-header-center">
          <h1 className="feature-title">{t('timesheets.title')} <span className="feature-title-accent">{t('timesheets.title_accent')}</span></h1>
          <p className="feature-subtitle">{t('timesheets.subtitle')}</p>
        </div>
        <button className="feature-refresh" onClick={fetchTimesheets}>
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="14" stroke="#1565c0" strokeWidth="2" />
            <path d="M22 14a6.5 6.5 0 0 0-11.3-1.5M10 18a6.5 6.5 0 0 0 11.3 1.5" stroke="#1565c0" strokeWidth="2" strokeLinecap="round" />
            <path d="M22 10v4h-4M10 22v-4h4" stroke="#1565c0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </header>

      <div className="expense-filters">
        {filters.map(f => (
          <button
            key={f.key}
            className={`filter-btn ${filter === f.key ? 'filter-active' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <button className="add-claim-btn" onClick={() => navigate('/timesheets/new')}>
        + {t('timesheets.add_new')}
      </button>

      <button className="ts-history-btn" onClick={() => navigate('/timesheets/history')}>
        {t('timesheets.last_4_weeks')}
      </button>

      {loading && <p className="claims-empty">{t('common.loading')}</p>}

      <div className="claims-list">
        {!loading && filtered.length === 0 && (
          <p className="claims-empty">{t('timesheets.no_timesheets')}</p>
        )}
        {filtered.slice(0, 5).map(ts => (
          <button key={ts.id} className="claim-row" onClick={() => navigate(`/timesheets/${ts.id}`)}>
            <div className="claim-date-col">
              <span className="claim-date">{formatDate(ts.date)}</span>
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
  )
}
