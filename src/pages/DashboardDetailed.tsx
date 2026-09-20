import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTheme } from '../context/ThemeContext'
import { useFeatures } from '../context/FeatureContext'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { formatDate, toLocalDateStr } from '../lib/formatters'

interface LeaveRequest {
  id: number
  start_date: string
  end_date: string
  days_requested: number
  status: string
  leave_type: { name: string } | null
}

interface Notification {
  id: number
  title: string
  message: string
  type: string
  created_at: string
  is_read: boolean
}

interface Colleague {
  id: string
  first_name: string
  last_name: string
  date_of_birth: string | null
  start_date: string | null
  avatar_url: string | null
  department: string | null
}

interface ExpenseClaim {
  id: number
  amount: number
  status: string
  created_at: string
  description: string | null
}

interface KudosItem {
  id: number
  message: string
  created_at: string
  from_employee: { first_name: string; last_name: string } | null
}

const SECTION_ICONS: Record<string, string> = {
  leave: '🏖️',
  notifications: '🔔',
  expenses: '💷',
  kudos: '⭐',
  meetings: '👥',
  newsfeed: '📢',
  birthdays: '🎂',
  anniversaries: '🎉',
}

export default function DashboardDetailed() {
  const { dark, toggle } = useTheme()
  const { features } = useFeatures()
  const { t, lang } = useLanguage()
  const { signOut, employeeId, employeeName, company, avatarUrl, companyUser } = useAuth()
  const navigate = useNavigate()

  const [leaveRemaining, setLeaveRemaining] = useState<number | null>(null)
  const [leavePending, setLeavePending] = useState<number | null>(null)
  const [leaveApproved, setLeaveApproved] = useState<number | null>(null)
  const [leaveTotal, setLeaveTotal] = useState<number | null>(null)
  const [upcomingLeave, setUpcomingLeave] = useState<LeaveRequest[]>([])
  const [recentNotifications, setRecentNotifications] = useState<Notification[]>([])
  const [birthdays, setBirthdays] = useState<Colleague[]>([])
  const [anniversaries, setAnniversaries] = useState<Colleague[]>([])
  const [recentExpenses, setRecentExpenses] = useState<ExpenseClaim[]>([])
  const [expenseTotal, setExpenseTotal] = useState(0)
  const [recentKudos, setRecentKudos] = useState<KudosItem[]>([])
  const [latestAnnouncement, setLatestAnnouncement] = useState<{ title: string; body: string } | null>(null)
  const [pendingOneToOnes, setPendingOneToOnes] = useState(0)

  const initials = employeeName.split(' ').map(n => n[0]).join('').toUpperCase() || '?'
  const firstName = employeeName.split(' ')[0] || employeeName

  useEffect(() => {
    if (!employeeId || !companyUser?.company_id) return
    const cid = companyUser.company_id
    const today = toLocalDateStr()
    const year = new Date().getFullYear()
    const yearStart = `${year}-01-01`
    const yearEnd = `${year}-12-31`

    supabase.from('leave_types').select('id, name').eq('company_id', cid).eq('name', 'Annual Leave').limit(1).single()
      .then(async ({ data: annualType }) => {
        if (!annualType) return
        const { data: balRow } = await supabase.from('leave_balances')
          .select('total_allowance, lieu_days')
          .eq('employee_id', employeeId).eq('company_id', cid).eq('leave_type_id', annualType.id).eq('year', year)
          .limit(1).single()
        if (!balRow) return
        const total = balRow.total_allowance + (Number(balRow.lieu_days) || 0)
        setLeaveTotal(total)
        const [approvedRes, pendingRes] = await Promise.all([
          supabase.from('leave_requests').select('days_requested')
            .eq('employee_id', employeeId).eq('company_id', cid).eq('leave_type_id', annualType.id)
            .eq('status', 'approved').gte('start_date', yearStart).lte('start_date', yearEnd),
          supabase.from('leave_requests').select('days_requested')
            .eq('employee_id', employeeId).eq('company_id', cid).eq('leave_type_id', annualType.id)
            .eq('status', 'pending').gte('start_date', yearStart).lte('start_date', yearEnd),
        ])
        const approved = (approvedRes.data || []).reduce((s: number, r: any) => s + Number(r.days_requested), 0)
        const pending = (pendingRes.data || []).reduce((s: number, r: any) => s + Number(r.days_requested), 0)
        setLeaveApproved(approved)
        setLeavePending(pending)
        setLeaveRemaining(total - approved)
      })

    supabase.from('leave_requests')
      .select('id, start_date, end_date, days_requested, status, leave_type:leave_types(name)')
      .eq('employee_id', employeeId).eq('company_id', cid)
      .in('status', ['approved', 'pending']).gte('start_date', today)
      .order('start_date').limit(5)
      .then(({ data }) => { if (data) setUpcomingLeave(data as any) })

    supabase.from('notifications')
      .select('id, title, message, type, created_at, is_read')
      .eq('employee_id', employeeId).eq('company_id', cid)
      .order('created_at', { ascending: false }).limit(5)
      .then(({ data }) => { if (data) setRecentNotifications(data as Notification[]) })

    let watchlistIds: string[] = []
    try { watchlistIds = JSON.parse(localStorage.getItem('inflowhr-kudos-watchlist') || '[]') } catch { /* empty */ }

    supabase.from('employees')
      .select('id, first_name, last_name, date_of_birth, start_date, avatar_url, department')
      .eq('company_id', cid).eq('is_active', true)
      .then(({ data: colleagues }) => {
        if (!colleagues) return
        const now = new Date()
        const thirtyDays = 30 * 86400000
        const bdays: Colleague[] = []
        const annivs: Colleague[] = []
        colleagues.forEach((c: any) => {
          if (c.date_of_birth && watchlistIds.includes(c.id)) {
            const dob = new Date(c.date_of_birth)
            const bday = new Date(year, dob.getMonth(), dob.getDate())
            if (bday < now) bday.setFullYear(year + 1)
            if (bday.getTime() - now.getTime() <= thirtyDays) bdays.push(c)
          }
          if (c.start_date) {
            const sd = new Date(c.start_date)
            const anniv = new Date(year, sd.getMonth(), sd.getDate())
            if (anniv < now) anniv.setFullYear(year + 1)
            if (anniv.getTime() - now.getTime() <= thirtyDays) {
              const years = year - sd.getFullYear() + (anniv.getFullYear() > year ? 1 : 0)
              if (years > 0) annivs.push({ ...c, department: `${years} Year${years !== 1 ? 's' : ''}` })
            }
          }
        })
        bdays.sort((a, b) => {
          const da = new Date(a.date_of_birth!), db = new Date(b.date_of_birth!)
          const ba = new Date(year, da.getMonth(), da.getDate()), bb = new Date(year, db.getMonth(), db.getDate())
          if (ba < now) ba.setFullYear(year + 1)
          if (bb < now) bb.setFullYear(year + 1)
          return ba.getTime() - bb.getTime()
        })
        setBirthdays(bdays.slice(0, 6))
        setAnniversaries(annivs.slice(0, 6))
      })

    if (features.expenses) {
      supabase.from('expense_claims')
        .select('id, amount, status, created_at, description')
        .eq('employee_id', employeeId).eq('company_id', cid)
        .order('created_at', { ascending: false }).limit(5)
        .then(({ data }) => {
          if (data) {
            setRecentExpenses(data as ExpenseClaim[])
            setExpenseTotal(data.reduce((s: number, e: any) => s + Number(e.amount), 0))
          }
        })
    }

    if (features.kudos) {
      supabase.from('kudos')
        .select('id, message, created_at, from_employee:employees!kudos_from_employee_id_fkey(first_name, last_name)')
        .eq('to_employee_id', employeeId).eq('company_id', cid)
        .order('created_at', { ascending: false }).limit(4)
        .then(({ data }) => { if (data) setRecentKudos(data as any) })
    }

    supabase.from('announcements')
      .select('title, body').eq('company_id', cid)
      .order('published_at', { ascending: false }).limit(1).single()
      .then(({ data }) => { if (data) setLatestAnnouncement(data) })

    if (features.performance) {
      supabase.from('one_to_one_meetings')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', cid).eq('status', 'pending').gte('scheduled_date', today)
        .or(`manager_id.eq.${employeeId},employee_id.eq.${employeeId}`)
        .then(({ count }) => { if (count) setPendingOneToOnes(count) })
    }
  }, [employeeId, companyUser?.company_id, features.expenses, features.kudos, features.performance])

  const h = new Date().getHours()
  const greeting = h < 12 ? t('dashboard.greeting_morning') : h < 18 ? t('dashboard.greeting_afternoon') : t('dashboard.greeting_evening')

  const dateStr = new Date().toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })

  const unreadCount = recentNotifications.filter(n => !n.is_read).length

  return (
    <div className="dd2">
      {/* Header */}
      <header className="dd2-header">
        <div className="dd2-header-left">
          {avatarUrl ? (
            <img className="dd2-avatar" src={avatarUrl} alt={initials} />
          ) : (
            <div className="dd2-avatar dd2-avatar-initials">{initials}</div>
          )}
          <div>
            <h1 className="dd2-greeting">{greeting} {firstName}</h1>
            <p className="dd2-date">{dateStr}</p>
          </div>
        </div>
        <div className="dd2-header-right">
          {company?.logo_url ? (
            <img className="dd2-company-logo" src={company.logo_url} alt={company.name} />
          ) : (
            <span className="dd2-company-name">{company?.name || 'InflowHR'}</span>
          )}
          <div className="dd2-header-actions">
            <button className="dd2-action-btn" onClick={toggle} title="Toggle theme">
              {dark ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="5"/><g stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></g></svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
              )}
            </button>
            <button className="dd2-action-btn" onClick={signOut} title="Sign out">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* Summary strip */}
      {features.leave && (
        <div className="dd2-summary-strip">
          <div className="dd2-summary-card dd2-summary-remaining" onClick={() => navigate('/leave')}>
            <span className="dd2-summary-value">{leaveRemaining ?? '--'}</span>
            <span className="dd2-summary-label">Days Remaining</span>
          </div>
          <div className="dd2-summary-card dd2-summary-approved" onClick={() => navigate('/leave')}>
            <span className="dd2-summary-value">{leaveApproved ?? 0}</span>
            <span className="dd2-summary-label">Approved</span>
          </div>
          <div className="dd2-summary-card dd2-summary-pending" onClick={() => navigate('/leave')}>
            <span className="dd2-summary-value">{leavePending ?? 0}</span>
            <span className="dd2-summary-label">Pending</span>
          </div>
          <div className="dd2-summary-card dd2-summary-total" onClick={() => navigate('/leave')}>
            <span className="dd2-summary-value">{leaveTotal ?? '--'}</span>
            <span className="dd2-summary-label">Total Allowance</span>
          </div>
        </div>
      )}

      {/* Main content grid */}
      <div className="dd2-grid">
        {/* Left column */}
        <div className="dd2-col">
          {/* Upcoming Leave */}
          {features.leave && (
            <section className="dd2-card" onClick={() => navigate('/leave')}>
              <div className="dd2-card-header">
                <span className="dd2-card-icon">{SECTION_ICONS.leave}</span>
                <h2 className="dd2-card-title">Upcoming Leave</h2>
                <span className="dd2-card-count">{upcomingLeave.length}</span>
              </div>
              <div className="dd2-card-body">
                {upcomingLeave.length === 0 ? (
                  <p className="dd2-empty">No upcoming leave planned</p>
                ) : (
                  <ul className="dd2-item-list">
                    {upcomingLeave.map(lr => (
                      <li key={lr.id} className="dd2-item">
                        <span className={`dd2-badge dd2-badge-${lr.status}`}>{lr.status}</span>
                        <div className="dd2-item-content">
                          <span className="dd2-item-title">{(lr.leave_type as any)?.name || 'Leave'}</span>
                          <span className="dd2-item-sub">{formatDate(lr.start_date)} – {formatDate(lr.end_date)} ({lr.days_requested}d)</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          )}

          {/* Notifications */}
          <section className="dd2-card" onClick={() => navigate('/notifications')}>
            <div className="dd2-card-header">
              <span className="dd2-card-icon">{SECTION_ICONS.notifications}</span>
              <h2 className="dd2-card-title">Notifications</h2>
              {unreadCount > 0 && <span className="dd2-card-count dd2-card-count-alert">{unreadCount} new</span>}
            </div>
            <div className="dd2-card-body">
              {recentNotifications.length === 0 ? (
                <p className="dd2-empty">No recent notifications</p>
              ) : (
                <ul className="dd2-item-list">
                  {recentNotifications.map(n => (
                    <li key={n.id} className={`dd2-item ${!n.is_read ? 'dd2-item-unread' : ''}`}>
                      <span className={`dd2-notif-indicator dd2-notif-${n.type}`} />
                      <div className="dd2-item-content">
                        <span className="dd2-item-title">{n.title}</span>
                        <span className="dd2-item-sub">{n.message.length > 60 ? n.message.slice(0, 60) + '…' : n.message}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* Expenses */}
          {features.expenses && (
            <section className="dd2-card" onClick={() => navigate('/expenses')}>
              <div className="dd2-card-header">
                <span className="dd2-card-icon">{SECTION_ICONS.expenses}</span>
                <h2 className="dd2-card-title">Expenses</h2>
                <span className="dd2-card-count">&pound;{expenseTotal.toFixed(2)}</span>
              </div>
              <div className="dd2-card-body">
                {recentExpenses.length === 0 ? (
                  <p className="dd2-empty">No expense claims</p>
                ) : (
                  <ul className="dd2-item-list">
                    {recentExpenses.slice(0, 3).map(e => (
                      <li key={e.id} className="dd2-item">
                        <span className={`dd2-badge dd2-badge-${e.status}`}>{e.status}</span>
                        <div className="dd2-item-content">
                          <span className="dd2-item-title">&pound;{Number(e.amount).toFixed(2)}</span>
                          <span className="dd2-item-sub">{e.description || e.status}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          )}
        </div>

        {/* Right column */}
        <div className="dd2-col">
          {/* Kudos */}
          {features.kudos && (
            <section className="dd2-card" onClick={() => navigate('/kudos')}>
              <div className="dd2-card-header">
                <span className="dd2-card-icon">{SECTION_ICONS.kudos}</span>
                <h2 className="dd2-card-title">Recent Kudos</h2>
                <span className="dd2-card-count">{recentKudos.length}</span>
              </div>
              <div className="dd2-card-body">
                {recentKudos.length === 0 ? (
                  <p className="dd2-empty">No kudos yet</p>
                ) : (
                  <ul className="dd2-item-list">
                    {recentKudos.map(k => (
                      <li key={k.id} className="dd2-item">
                        <div className="dd2-person-circle">
                          {k.from_employee ? `${k.from_employee.first_name[0]}${k.from_employee.last_name[0]}` : '?'}
                        </div>
                        <div className="dd2-item-content">
                          <span className="dd2-item-title">{k.from_employee ? `${k.from_employee.first_name} ${k.from_employee.last_name}` : 'Someone'}</span>
                          <span className="dd2-item-sub">{k.message.length > 50 ? k.message.slice(0, 50) + '…' : k.message}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          )}

          {/* 1:1 Meetings */}
          {features.performance && (
            <section className="dd2-card" onClick={() => navigate('/one-to-ones')}>
              <div className="dd2-card-header">
                <span className="dd2-card-icon">{SECTION_ICONS.meetings}</span>
                <h2 className="dd2-card-title">1:1 Meetings</h2>
              </div>
              <div className="dd2-card-body">
                <div className="dd2-meeting-hero">
                  <span className="dd2-meeting-num">{pendingOneToOnes}</span>
                  <span className="dd2-meeting-text">upcoming meeting{pendingOneToOnes !== 1 ? 's' : ''}</span>
                </div>
              </div>
            </section>
          )}

          {/* Newsfeed */}
          <section className="dd2-card" onClick={() => navigate('/notifications', { state: { tab: 'company' } })}>
            <div className="dd2-card-header">
              <span className="dd2-card-icon">{SECTION_ICONS.newsfeed}</span>
              <h2 className="dd2-card-title">Newsfeed</h2>
            </div>
            <div className="dd2-card-body">
              {latestAnnouncement ? (
                <div className="dd2-announcement">
                  <h4 className="dd2-announcement-title">{latestAnnouncement.title}</h4>
                  <p className="dd2-announcement-body">{latestAnnouncement.body.length > 120 ? latestAnnouncement.body.slice(0, 120) + '…' : latestAnnouncement.body}</p>
                </div>
              ) : (
                <p className="dd2-empty">No announcements</p>
              )}
            </div>
          </section>

          {/* Birthdays */}
          <section className="dd2-card">
            <div className="dd2-card-header">
              <span className="dd2-card-icon">{SECTION_ICONS.birthdays}</span>
              <h2 className="dd2-card-title">Birthdays</h2>
              <span className="dd2-card-count">{birthdays.length}</span>
            </div>
            <div className="dd2-card-body">
              {birthdays.length === 0 ? (
                <p className="dd2-empty">No watchlist birthdays in the next 30 days — add colleagues via the Directory</p>
              ) : (
                <ul className="dd2-item-list">
                  {birthdays.map(c => {
                    const dob = new Date(c.date_of_birth!)
                    const bday = new Date(new Date().getFullYear(), dob.getMonth(), dob.getDate())
                    if (bday < new Date()) bday.setFullYear(bday.getFullYear() + 1)
                    const isToday = toLocalDateStr(bday) === toLocalDateStr()
                    return (
                      <li key={c.id} className={`dd2-item ${isToday ? 'dd2-item-highlight' : ''}`}>
                        {c.avatar_url ? (
                          <img className="dd2-person-circle dd2-person-img" src={c.avatar_url} alt="" />
                        ) : (
                          <div className="dd2-person-circle">{c.first_name[0]}{c.last_name[0]}</div>
                        )}
                        <div className="dd2-item-content">
                          <span className="dd2-item-title">{c.first_name} {c.last_name}</span>
                          <span className="dd2-item-sub">{isToday ? 'Today!' : formatDate(bday.toISOString().split('T')[0])}</span>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </section>

          {/* Work Anniversaries */}
          <section className="dd2-card">
            <div className="dd2-card-header">
              <span className="dd2-card-icon">{SECTION_ICONS.anniversaries}</span>
              <h2 className="dd2-card-title">Work Anniversaries</h2>
              <span className="dd2-card-count">{anniversaries.length}</span>
            </div>
            <div className="dd2-card-body">
              {anniversaries.length === 0 ? (
                <p className="dd2-empty">No upcoming anniversaries</p>
              ) : (
                <ul className="dd2-item-list">
                  {anniversaries.map(c => (
                    <li key={c.id} className="dd2-item">
                      {c.avatar_url ? (
                        <img className="dd2-person-circle dd2-person-img" src={c.avatar_url} alt="" />
                      ) : (
                        <div className="dd2-person-circle">{c.first_name[0]}{c.last_name[0]}</div>
                      )}
                      <div className="dd2-item-content">
                        <span className="dd2-item-title">{c.first_name} {c.last_name}</span>
                        <span className="dd2-item-sub">{c.department}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
