import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'
import Chevron from '../components/Chevron'
import { formatDate } from '../lib/formatters'

type StatusFilter = 'all' | 'approved' | 'pending' | 'rejected'

interface LeaveRequest {
  id: number
  leave_type_id: number
  start_date: string
  end_date: string
  days_requested: number
  status: string
  reason: string | null
  created_at: string
}

interface LeaveType {
  id: number
  name: string
  colour: string
}

const LEAVE_TYPE_KEY_MAP: Record<string, string> = {
  'Annual Leave': 'my_leave.annual_leave',
  'Sick Leave': 'my_leave.sick_leave',
  'Compassionate Leave': 'my_leave.compassionate_leave',
  'Parental Leave': 'my_leave.parental_leave',
  'Jury Duty': 'my_leave.jury_duty',
  'Bereavement': 'my_leave.bereavement',
  'Exam Leave': 'my_leave.exam_leave',
  'Carers Leave': 'my_leave.carers_leave',
  'Career Break': 'my_leave.career_break',
  'Lieu Days': 'my_leave.lieu_days',
}

export default function MyLeaveHistory() {
  const navigate = useNavigate()
  const { t, tStatus } = useLanguage()
  const { employeeId: EMPLOYEE_ID, companyUser } = useAuth()
  const [requests, setRequests] = useState<LeaveRequest[]>([])
  const [typeMap, setTypeMap] = useState<Map<number, LeaveType>>(new Map())
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [loading, setLoading] = useState(true)
  const [offThisWeek, setOffThisWeek] = useState(0)

  function translateLeaveType(name: string): string {
    return LEAVE_TYPE_KEY_MAP[name] ? t(LEAVE_TYPE_KEY_MAP[name]) : name
  }

  const fetchData = useCallback(async () => {
    setLoading(true)

    const { data: reqs } = await supabase
      .from('leave_requests')
      .select('id, leave_type_id, start_date, end_date, days_requested, status, reason, created_at')
      .eq('employee_id', EMPLOYEE_ID)
      .eq('company_id', companyUser?.company_id)
      .order('created_at', { ascending: false })

    if (reqs && reqs.length > 0) {
      setRequests(reqs as LeaveRequest[])
      const typeIds = [...new Set(reqs.map((r: any) => r.leave_type_id))]
      const { data: types } = await supabase
        .from('leave_types')
        .select('id, name, colour')
        .in('id', typeIds)
      if (types) {
        setTypeMap(new Map(types.map((lt: any) => [lt.id, lt as LeaveType])))
      }
    }

    const now = new Date()
    const weekStart = new Date(now)
    weekStart.setDate(now.getDate() - now.getDay() + 1)
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekStart.getDate() + 6)
    const ws = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`
    const we = `${weekEnd.getFullYear()}-${String(weekEnd.getMonth() + 1).padStart(2, '0')}-${String(weekEnd.getDate()).padStart(2, '0')}`

    const { data: offData } = await supabase
      .from('leave_requests')
      .select('id, employee_id')
      .eq('company_id', companyUser?.company_id)
      .eq('status', 'approved')
      .lte('start_date', we)
      .gte('end_date', ws)

    if (offData) {
      const uniqueEmps = new Set(offData.map((r: any) => r.employee_id))
      setOffThisWeek(uniqueEmps.size)
    }

    setLoading(false)
  }, [EMPLOYEE_ID, companyUser?.company_id])

  useEffect(() => {
    if (!EMPLOYEE_ID) return
    fetchData()
  }, [fetchData, EMPLOYEE_ID])

  const filtered = filter === 'all'
    ? requests
    : requests.filter(r => r.status === filter)

  const todayStr = (() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })()
  const upcoming = filtered.filter(r => r.end_date >= todayStr).sort((a, b) => a.start_date.localeCompare(b.start_date))
  const previous = filtered.filter(r => r.end_date < todayStr)

  function statusColor(status: string): string {
    if (status === 'approved') return '#43a047'
    if (status === 'pending') return '#e65100'
    if (status === 'rejected') return '#c62828'
    return '#999'
  }

  return (
    <div className="feature-page leave-history-page">
      <header className="leave-history-header">
        <button className="leave-history-back" onClick={() => navigate('/leave')}>
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
            <circle cx="18" cy="18" r="17" stroke="#43a047" strokeWidth="2" />
            <path d="M21 12l-6 6 6 6" stroke="#43a047" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="leave-history-header-center">
          <h1 className="leave-history-title">{t('leave_history.title')} <span className="leave-history-title-accent">{t('leave_history.title_accent')}</span></h1>
          <p className="leave-history-subtitle">{t('leave_history.subtitle')}</p>
        </div>
        <button className="my-leave-add-btn" onClick={() => navigate('/leave/new')}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#43a047" strokeWidth="3" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </header>

      <div className="leave-history-top-bar">
        <button className="leave-history-off-badge" onClick={() => navigate('/leave/calendar')}>
          <div className="leave-history-off-text">
            <span className="leave-history-off-label">{t('leave_history.employees_off')}</span>
            <span className="leave-history-off-sub">{t('leave_history.this_week')}</span>
          </div>
          <span className="leave-history-off-count">{offThisWeek}</span>
          <Chevron color="#c8e600" />
        </button>
        <div className="leave-history-filter-wrap">
          <label className="leave-history-filter-label">{t('leave_history.leave_status')}</label>
          <div className="select-wrap">
            <select
              value={filter}
              onChange={e => setFilter(e.target.value as StatusFilter)}
              className="form-select"
            >
              <option value="all">{t('leave_history.filter_all')}</option>
              <option value="approved">{t('leave_history.filter_approved')}</option>
              <option value="pending">{t('leave_history.filter_pending')}</option>
              <option value="rejected">{t('leave_history.filter_declined')}</option>
            </select>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#43a047" strokeWidth="2.5" className="select-arrow">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>
        </div>
      </div>

      {loading && <p className="claims-empty">{t('common.loading')}</p>}

      {!loading && filtered.length === 0 && (
        <p className="claims-empty">{t('leave_history.no_leave')}</p>
      )}

      {!loading && upcoming.length > 0 && (
        <>
          <h3 className="leave-history-section-title">{t('leave_history.upcoming')}</h3>
          <div className="leave-history-list">
            {upcoming.map(req => {
              const lt = typeMap.get(req.leave_type_id)
              const typeName = lt ? lt.name : 'Leave'
              const colour = lt ? lt.colour : '#999'
              return (
                <button
                  key={req.id}
                  className="leave-history-row"
                  style={{ borderLeftColor: colour }}
                  onClick={() => navigate(`/leave/${req.id}`)}
                >
                  <div className="leave-history-row-main">
                    <span className="leave-history-row-type">{translateLeaveType(typeName)}</span>
                    <div className="leave-history-row-dates">
                      <span className="leave-history-row-date-label">{t('leave_history.from')}</span>
                      <span className="leave-history-row-date">{formatDate(req.start_date)}</span>
                      <span className="leave-history-row-date-label">{t('leave_history.to')}</span>
                      <span className="leave-history-row-date">{formatDate(req.end_date)}</span>
                    </div>
                  </div>
                  <div className="leave-history-row-right">
                    <div className="leave-history-row-days">
                      <span className="leave-history-row-days-count" style={{ borderColor: colour, color: colour }}>{req.days_requested}</span>
                      <span className="leave-history-row-days-label">{t('leave_history.days')}</span>
                    </div>
                    <span className="leave-history-row-status" style={{ color: statusColor(req.status) }}>
                      {tStatus(req.status)}
                    </span>
                  </div>
                  <Chevron color="#c8e600" />
                </button>
              )
            })}
          </div>
        </>
      )}

      {!loading && previous.length > 0 && (
        <>
          <h3 className="leave-history-section-title">{t('leave_history.previous')}</h3>
          <div className="leave-history-list">
            {previous.map(req => {
              const lt = typeMap.get(req.leave_type_id)
              const typeName = lt ? lt.name : 'Leave'
              const colour = lt ? lt.colour : '#999'
              return (
                <button
                  key={req.id}
                  className="leave-history-row"
                  style={{ borderLeftColor: colour }}
                  onClick={() => navigate(`/leave/${req.id}`)}
                >
                  <div className="leave-history-row-main">
                    <span className="leave-history-row-type">{translateLeaveType(typeName)}</span>
                    <div className="leave-history-row-dates">
                      <span className="leave-history-row-date-label">{t('leave_history.from')}</span>
                      <span className="leave-history-row-date">{formatDate(req.start_date)}</span>
                      <span className="leave-history-row-date-label">{t('leave_history.to')}</span>
                      <span className="leave-history-row-date">{formatDate(req.end_date)}</span>
                    </div>
                  </div>
                  <div className="leave-history-row-right">
                    <div className="leave-history-row-days">
                      <span className="leave-history-row-days-count" style={{ borderColor: colour, color: colour }}>{req.days_requested}</span>
                      <span className="leave-history-row-days-label">{t('leave_history.days')}</span>
                    </div>
                    <span className="leave-history-row-status" style={{ color: statusColor(req.status) }}>
                      {tStatus(req.status)}
                    </span>
                  </div>
                  <Chevron color="#c8e600" />
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
