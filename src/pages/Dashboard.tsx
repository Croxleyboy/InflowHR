import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTheme } from '../context/ThemeContext'
import { useFeatures } from '../context/FeatureContext'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import Chevron from '../components/Chevron'

function getDateString(lang: string) {
  const d = new Date()
  const enDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const deDays = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']
  const enMonths = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const deMonths = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
  const days = lang === 'de' ? deDays : enDays
  const months = lang === 'de' ? deMonths : enMonths
  const day = d.getDate()
  if (lang === 'de') {
    return `${days[d.getDay()]}, ${day}. ${months[d.getMonth()]} ${String(d.getFullYear()).slice(-2)}`
  }
  const suffix = day === 1 || day === 21 || day === 31 ? 'st' : day === 2 || day === 22 ? 'nd' : day === 3 || day === 23 ? 'rd' : 'th'
  const year = String(d.getFullYear()).slice(-2)
  return `${days[d.getDay()]}, ${day}${suffix} ${months[d.getMonth()]} ${year}`
}

interface LatestAnnouncement {
  title: string
  body: string
}

export default function Dashboard() {
  const { dark, toggle } = useTheme()
  const { features } = useFeatures()
  const { t, lang } = useLanguage()
  const { signOut, employeeId, employeeName, employeeEmail } = useAuth()
  const navigate = useNavigate()
  const [latest, setLatest] = useState<LatestAnnouncement | null>(null)
  const [kudosUnread, setKudosUnread] = useState(0)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [lastExpense, setLastExpense] = useState<number | null>(null)
  const [leaveRemaining, setLeaveRemaining] = useState<number | null>(null)
  const initials = employeeName.split(' ').map(n => n[0]).join('').toUpperCase() || '?'

  useEffect(() => {
    if (employeeEmail) {
      supabase.from('onboarding')
        .select('avatar_url')
        .eq('user_email', employeeEmail)
        .single()
        .then(({ data }) => { if (data?.avatar_url) setAvatarUrl(data.avatar_url) })
    }

    supabase.from('announcements')
      .select('title, body')
      .order('published_at', { ascending: false })
      .limit(1)
      .single()
      .then(({ data }) => { if (data) setLatest(data as LatestAnnouncement) })

    if (employeeId) {
      const lastSeen = localStorage.getItem('inflowhr-kudos-seen') || '1970-01-01'
      supabase.from('kudos')
        .select('id', { count: 'exact', head: true })
        .eq('to_employee_id', employeeId)
        .gt('created_at', lastSeen)
        .then(({ count }) => { if (count && count > 0) setKudosUnread(count) })

      supabase.from('expense_claims')
        .select('amount')
        .eq('employee_id', employeeId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
        .then(({ data }) => { if (data) setLastExpense(data.amount) })

      supabase.from('leave_balances')
        .select('total_allowance, used')
        .eq('employee_id', employeeId)
        .eq('year', new Date().getFullYear())
        .limit(1)
        .single()
        .then(({ data }) => { if (data) setLeaveRemaining(data.total_allowance - data.used) })
    }
  }, [employeeId, employeeEmail])

  const h = new Date().getHours()
  const greeting = h < 12 ? t('dashboard.greeting_morning') : h < 18 ? t('dashboard.greeting_afternoon') : t('dashboard.greeting_evening')

  return (
    <div className="dashboard">
      <header className="dash-header">
        {avatarUrl ? (
          <img className="profile-avatar-img" src={avatarUrl} alt={initials} />
        ) : (
          <div className="profile-avatar">{initials}</div>
        )}
        <div className="header-center">
          <p className="header-tagline">{t('dashboard.tagline')}</p>
          <p className="header-date">{getDateString(lang)}</p>
        </div>
        <div className="header-logo">
          <span className="logo-text">InflowHR</span>
        </div>
      </header>

      <div className="greeting-row">
        <h2 className="greeting">{greeting} {'\u{1F44B}'} {employeeName}</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="theme-toggle" onClick={toggle} aria-label="Toggle dark mode">
            {dark ? (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="5" /><g stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></g></svg>
            ) : (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
            )}
          </button>
          <button className="theme-toggle" onClick={signOut} aria-label="Sign out" title="Sign out">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>
      </div>

      <div className="card-grid">
        {features.expenses && (
          <button className="dash-card card-expenses" onClick={() => navigate('/expenses')}>
            <div className="card-content">
              <span className="card-label">{t('dashboard.expenses')}</span>
              <span className="card-value">&pound;{lastExpense !== null ? lastExpense.toFixed(2) : '--'}</span>
              <span className="card-sub">{t('dashboard.last_claim')}</span>
            </div>
            <Chevron color="#c8e600" />
          </button>
        )}
        {features.leave && (
          <button className="dash-card card-leave" onClick={() => navigate('/leave')}>
            <div className="card-content">
              <span className="card-label">{t('dashboard.leave_remaining')}</span>
              <span className="card-value card-value-large">{leaveRemaining !== null ? leaveRemaining : '--'} <span className="card-value-unit">{t('dashboard.days')}</span></span>
            </div>
            <Chevron color="#d4e600" />
          </button>
        )}
        {features.profile && (
          <button className="dash-card card-profile" onClick={() => navigate('/my-profile')}>
            <div className="card-content">
              <span className="card-label">{t('dashboard.my_profile')}</span>
            </div>
            <Chevron color="#00bcd4" />
          </button>
        )}
        {features.payslips && (
          <button className="dash-card card-payslips" onClick={() => navigate('/payslips')}>
            <div className="card-content">
              <span className="card-label">{t('dashboard.payslips')}</span>
            </div>
            <Chevron color="#1a237e" />
          </button>
        )}
        {features.kudos && (
          <button className="dash-card card-kudos" onClick={() => navigate('/kudos')}>
            <div className="card-content">
              <span className="card-label">{t('dashboard.kudos')}</span>
            </div>
            {kudosUnread > 0 && <span className="kudos-unread-badge">{kudosUnread}</span>}
            <Chevron color="#00897b" />
          </button>
        )}
        {features.benefits && (
          <button className="dash-card card-benefits" onClick={() => navigate('/benefits')}>
            <div className="card-content">
              <span className="card-label">{t('dashboard.benefits')}</span>
            </div>
            <Chevron color="#00897b" />
          </button>
        )}
        {features.elearning && (
          <button className="dash-card card-elearning" onClick={() => navigate('/elearning')}>
            <div className="card-content">
              <span className="card-label">{t('dashboard.elearning')}</span>
            </div>
            <Chevron color="#c62828" />
          </button>
        )}
        {features.performance && (
          <button className="dash-card card-performance" onClick={() => navigate('/performance')}>
            <div className="card-content">
              <span className="card-label">{t('dashboard.performance')}</span>
            </div>
            <Chevron color="#ad1457" />
          </button>
        )}
      </div>

      {latest && (
        <section className="announcements">
          <h3 className="announcements-title">{t('dashboard.announcements')}</h3>
          <button className="announcement-card" onClick={() => navigate('/notifications', { state: { tab: 'company' } })}>
            <div className="announcement-content">
              <h4 className="announcement-heading">{latest.title}</h4>
              <p className="announcement-text">{latest.body}</p>
            </div>
            <svg width="36" height="36" viewBox="0 0 32 32" fill="none" className="announcement-arrow">
              <path d="M11 6l10 10-10 10" stroke="#8b0000" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </section>
      )}
    </div>
  )
}
