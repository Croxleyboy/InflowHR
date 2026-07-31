import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'

type Tab = 'upcoming' | 'history' | 'reports'

interface Meeting {
  id: number
  manager_id: string
  employee_id: string
  scheduled_date: string
  scheduled_time: string
  status: string
  summary: string | null
  created_at: string
  manager_name?: string
  employee_name?: string
  manager_avatar?: string | null
  employee_avatar?: string | null
}

interface DirectReport {
  id: string
  first_name: string
  last_name: string
  job_title: string | null
  department: string | null
  email: string
  avatar_url: string | null
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00')
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`
}

export default function OneToOnes() {
  const navigate = useNavigate()
  const { t } = useLanguage()
  const { employeeId } = useAuth()
  const [tab, setTab] = useState<Tab>('upcoming')
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [directReports, setDirectReports] = useState<DirectReport[]>([])
  const [loading, setLoading] = useState(true)
  const [isManager, setIsManager] = useState(false)

  const fetchData = useCallback(async () => {
    if (!employeeId) return
    setLoading(true)

    const { data: reports } = await supabase.from('employees')
      .select('id, first_name, last_name, job_title, department, email, avatar_url')
      .eq('manager_id', employeeId)
      .eq('is_active', true)
    const dr = (reports || []) as DirectReport[]
    setDirectReports(dr)
    setIsManager(dr.length > 0)

    const { data: allMeetings } = await supabase.from('one_to_one_meetings')
      .select('*')
      .or(`manager_id.eq.${employeeId},employee_id.eq.${employeeId}`)
      .order('scheduled_date', { ascending: false })

    if (allMeetings && allMeetings.length > 0) {
      const empIds = new Set<string>()
      allMeetings.forEach((m: Meeting) => { empIds.add(m.manager_id); empIds.add(m.employee_id) })
      const { data: empData } = await supabase.from('employees')
        .select('id, first_name, last_name, avatar_url')
        .in('id', Array.from(empIds))
      const nameMap: Record<string, string> = {}
      const avatarMap: Record<string, string | null> = {}
      ;(empData || []).forEach((e: { id: string; first_name: string; last_name: string; avatar_url: string | null }) => {
        nameMap[e.id] = `${e.first_name} ${e.last_name}`
        avatarMap[e.id] = e.avatar_url
      })
      const enriched = allMeetings.map((m: Meeting) => ({
        ...m,
        manager_name: nameMap[m.manager_id] || '',
        employee_name: nameMap[m.employee_id] || '',
        manager_avatar: avatarMap[m.manager_id] || null,
        employee_avatar: avatarMap[m.employee_id] || null,
      }))
      setMeetings(enriched)
    } else {
      setMeetings([])
    }

    setLoading(false)
  }, [employeeId])

  useEffect(() => { fetchData() }, [fetchData])

  async function handleAccept(meetingId: number) {
    await supabase.from('one_to_one_meetings').update({ status: 'accepted', updated_at: new Date().toISOString() }).eq('id', meetingId)
    await supabase.from('workflow_tracker')
      .update({ status: 'Complete', approval_status: 'Approved', action: '1:1 meeting accepted' })
      .eq('record_type', 'Meeting').eq('approval_id', meetingId)
    fetchData()
  }

  async function handleDecline(meetingId: number) {
    await supabase.from('one_to_one_meetings').update({ status: 'declined', updated_at: new Date().toISOString() }).eq('id', meetingId)
    await supabase.from('workflow_tracker')
      .update({ status: 'Complete', approval_status: 'Declined', action: '1:1 meeting declined' })
      .eq('record_type', 'Meeting').eq('approval_id', meetingId)
    fetchData()
  }

  const today = new Date().toISOString().split('T')[0]
  const upcoming = meetings.filter(m => ['pending', 'accepted'].includes(m.status) && m.scheduled_date >= today)
  const history = meetings.filter(m => m.status === 'completed' || m.scheduled_date < today)

  return (
    <div className="oto-page">
      <header className="oto-header">
        <div className="oto-header-center">
          <h1 className="oto-header-title">{t('one_to_one.title')}</h1>
          <p className="oto-header-subtitle">{t('one_to_one.page_subtitle')}</p>
        </div>
        <button className="oto-header-refresh" onClick={fetchData}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
        </button>
      </header>

      <div className="oto-tabs">
        <button className={`oto-tab ${tab === 'upcoming' ? 'oto-tab-active' : ''}`} onClick={() => setTab('upcoming')}>
          {t('one_to_one.upcoming')} {upcoming.length > 0 && <span className="oto-tab-badge">{upcoming.length}</span>}
        </button>
        <button className={`oto-tab ${tab === 'history' ? 'oto-tab-active' : ''}`} onClick={() => setTab('history')}>
          {t('one_to_one.history')}
        </button>
        {isManager && (
          <button className={`oto-tab ${tab === 'reports' ? 'oto-tab-active' : ''}`} onClick={() => setTab('reports')}>
            {t('one_to_one.direct_reports')}
          </button>
        )}
      </div>

      {isManager && tab === 'upcoming' && (
        <button className="oto-schedule-btn" onClick={() => navigate('/one-to-ones/new')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          {t('one_to_one.schedule_new')}
        </button>
      )}

      {loading && <p className="claims-empty">{t('common.loading')}</p>}

      {!loading && tab === 'upcoming' && (
        <div className="oto-list">
          {upcoming.length === 0 && <p className="claims-empty">{t('one_to_one.no_upcoming')}</p>}
          {upcoming.map(m => {
            const iAmManager = m.manager_id === employeeId
            const otherName = iAmManager ? m.employee_name : m.manager_name
            const otherAvatar = iAmManager ? m.employee_avatar : m.manager_avatar
            const initials = (otherName || '').split(' ').map(n => n[0]).join('').toUpperCase()
            return (
              <div key={m.id} className="oto-card" onClick={() => navigate(`/one-to-ones/${m.id}`)}>
                {otherAvatar ? <img className="oto-card-avatar-img" src={otherAvatar} alt={otherName} /> : <div className="oto-card-avatar">{initials}</div>}
                <div className="oto-card-content">
                  <span className="oto-card-name">{otherName}</span>
                  <span className="oto-card-date">{formatDate(m.scheduled_date)} &middot; {m.scheduled_time.slice(0, 5)}</span>
                  <span className={`oto-card-status oto-status-${m.status}`}>
                    {m.status === 'pending' ? t('one_to_one.awaiting_response') :
                     m.status === 'accepted' ? t('one_to_one.confirmed') : m.status}
                  </span>
                </div>
                {!iAmManager && m.status === 'pending' && (
                  <div className="oto-card-actions" onClick={e => e.stopPropagation()}>
                    <button className="oto-accept-btn" onClick={() => handleAccept(m.id)} title={t('one_to_one.accept')}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><path d="M20 6L9 17l-5-5" /></svg>
                    </button>
                    <button className="oto-decline-btn" onClick={() => handleDecline(m.id)} title={t('one_to_one.decline_btn')}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </button>
                  </div>
                )}
                <svg width="24" height="24" viewBox="0 0 32 32" fill="none" className="oto-card-arrow">
                  <path d="M12 6l10 10-10 10" stroke="#6b7280" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            )
          })}
        </div>
      )}

      {!loading && tab === 'history' && (
        <div className="oto-list">
          {history.length === 0 && <p className="claims-empty">{t('one_to_one.no_history')}</p>}
          {history.map(m => {
            const iAmManager = m.manager_id === employeeId
            const otherName = iAmManager ? m.employee_name : m.manager_name
            const otherAvatar = iAmManager ? m.employee_avatar : m.manager_avatar
            const initials = (otherName || '').split(' ').map(n => n[0]).join('').toUpperCase()
            return (
              <div key={m.id} className="oto-card" onClick={() => navigate(`/one-to-ones/${m.id}`)}>
                {otherAvatar ? <img className="oto-card-avatar-img" src={otherAvatar} alt={otherName} /> : <div className="oto-card-avatar">{initials}</div>}
                <div className="oto-card-content">
                  <span className="oto-card-name">{otherName}</span>
                  <span className="oto-card-date">{formatDate(m.scheduled_date)}</span>
                  <span className={`oto-card-status oto-status-${m.status}`}>
                    {m.status === 'completed' ? t('one_to_one.completed') :
                     m.status === 'cancelled' ? t('one_to_one.cancelled') :
                     m.status === 'declined' ? t('one_to_one.declined') : m.status}
                  </span>
                </div>
                {m.summary && (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" className="oto-has-notes">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
                  </svg>
                )}
                <svg width="24" height="24" viewBox="0 0 32 32" fill="none" className="oto-card-arrow">
                  <path d="M12 6l10 10-10 10" stroke="#6b7280" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            )
          })}
        </div>
      )}

      {!loading && tab === 'reports' && isManager && (
        <div className="oto-list">
          {directReports.map(dr => {
            const initials = `${dr.first_name[0]}${dr.last_name[0]}`
            const reportMeetings = meetings.filter(m => m.employee_id === dr.id && m.status === 'completed')
            const lastMeeting = reportMeetings[0]
            return (
              <div key={dr.id} className="oto-report-card">
                {dr.avatar_url ? <img className="oto-card-avatar-img" src={dr.avatar_url} alt={`${dr.first_name} ${dr.last_name}`} /> : <div className="oto-card-avatar">{initials}</div>}
                <div className="oto-report-info">
                  <span className="oto-report-name">{dr.first_name} {dr.last_name}</span>
                  <span className="oto-report-role">{dr.job_title} &middot; {dr.department}</span>
                  <span className="oto-report-last">
                    {lastMeeting ? `${t('one_to_one.last_meeting')}: ${formatDate(lastMeeting.scheduled_date)}` : t('one_to_one.no_meetings_yet')}
                  </span>
                </div>
                <div className="oto-report-actions">
                  <button className="oto-report-schedule" onClick={() => navigate('/one-to-ones/new', { state: { employeeId: dr.id, employeeName: `${dr.first_name} ${dr.last_name}` } })}>
                    {t('one_to_one.schedule')}
                  </button>
                  <span className="oto-report-count">{reportMeetings.length} {t('one_to_one.meetings_count')}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
