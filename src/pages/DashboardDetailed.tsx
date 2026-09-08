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

const BORDER_COLORS: Record<string, string> = {
  expenses: '#c62828',
  leave: '#2e7d32',
  profile: '#7b1fa2',
  payslips: '#1a237e',
  kudos: '#546e7a',
  benefits: '#80deea',
  elearning: '#f9a825',
  performance: '#c2185b',
  timesheets: '#1565c0',
  shifts: '#e65100',
  space_booking: '#263238',
  legal_timesheets: '#00695c',
  notifications: '#5c6bc0',
  birthdays: '#e91e63',
  anniversaries: '#ff9800',
  announcements: '#8b0000',
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

  useEffect(() => {
    if (!employeeId || !companyUser?.company_id) return
    const cid = companyUser.company_id
    const today = toLocalDateStr()
    const year = new Date().getFullYear()
    const yearStart = `${year}-01-01`
    const yearEnd = `${year}-12-31`

    // Leave data
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

    // Upcoming leave
    supabase.from('leave_requests')
      .select('id, start_date, end_date, days_requested, status, leave_type:leave_types(name)')
      .eq('employee_id', employeeId).eq('company_id', cid)
      .in('status', ['approved', 'pending']).gte('start_date', today)
      .order('start_date').limit(5)
      .then(({ data }) => { if (data) setUpcomingLeave(data as any) })

    // Notifications
    supabase.from('notifications')
      .select('id, title, message, type, created_at, is_read')
      .eq('employee_id', employeeId).eq('company_id', cid)
      .order('created_at', { ascending: false }).limit(5)
      .then(({ data }) => { if (data) setRecentNotifications(data as Notification[]) })

    // Birthdays & anniversaries in next 30 days
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
          if (c.date_of_birth) {
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

    // Expenses
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

    // Kudos
    if (features.kudos) {
      supabase.from('kudos')
        .select('id, message, created_at, from_employee:employees!kudos_from_employee_id_fkey(first_name, last_name)')
        .eq('to_employee_id', employeeId).eq('company_id', cid)
        .order('created_at', { ascending: false }).limit(4)
        .then(({ data }) => { if (data) setRecentKudos(data as any) })
    }

    // Announcements
    supabase.from('announcements')
      .select('title, body').eq('company_id', cid)
      .order('published_at', { ascending: false }).limit(1).single()
      .then(({ data }) => { if (data) setLatestAnnouncement(data) })

    // 1:1 meetings
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

  function Widget({ title, color, onClick, children, className }: {
    title: string; color: string; onClick?: () => void; children: React.ReactNode; className?: string
  }) {
    return (
      <div className={`dd-widget ${className || ''}`} style={{ borderTop: `3px solid ${color}` }} onClick={onClick}>
        <div className="dd-widget-header">
          <h3 className="dd-widget-title">{title}</h3>
        </div>
        <div className="dd-widget-body">{children}</div>
      </div>
    )
  }

  return (
    <div className="dashboard-detailed">
      <header className="dd-header">
        <div className="dd-header-left">
          {avatarUrl ? (
            <img className="dd-avatar" src={avatarUrl} alt={initials} />
          ) : (
            <div className="dd-avatar dd-avatar-initials">{initials}</div>
          )}
          <div className="dd-header-info">
            <h1 className="dd-greeting">{greeting} <span style={{ whiteSpace: 'nowrap' }}>{employeeName}</span></h1>
            <p className="dd-date">{dateStr}</p>
          </div>
        </div>
        <div className="dd-header-right">
          {company?.logo_url ? (
            <img className="dd-company-logo" src={company.logo_url} alt={company.name} />
          ) : (
            <span className="dd-company-name">{company?.name || 'InflowHR'}</span>
          )}
          <div className="dd-header-actions">
            <button className="dd-icon-btn" onClick={toggle} aria-label="Toggle dark mode" title="Toggle theme">
              {dark ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="5"/><g stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></g></svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
              )}
            </button>
            <button className="dd-icon-btn" onClick={signOut} aria-label="Sign out" title="Sign out">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
            </button>
          </div>
        </div>
      </header>

      <div className="dd-grid">
        {/* My Allowances */}
        {features.leave && (
          <Widget title="My Allowances" color={BORDER_COLORS.leave} onClick={() => navigate('/leave')} className="dd-clickable">
            <div className="dd-allowance-grid">
              <div className="dd-stat">
                <span className="dd-stat-label dd-stat-pending">Pending</span>
                <span className="dd-stat-value">{leavePending ?? 0} Days</span>
              </div>
              <div className="dd-stat">
                <span className="dd-stat-label dd-stat-approved">Approved</span>
                <span className="dd-stat-value">{leaveApproved ?? 0} Days</span>
              </div>
              <div className="dd-stat">
                <span className="dd-stat-label dd-stat-remaining">Remaining</span>
                <span className="dd-stat-value">{leaveRemaining ?? '--'} Days</span>
              </div>
              <div className="dd-stat">
                <span className="dd-stat-label">Total</span>
                <span className="dd-stat-value">{leaveTotal ?? '--'} Days</span>
              </div>
            </div>
          </Widget>
        )}

        {/* Leave Countdown */}
        {features.leave && (
          <Widget title="Leave Countdown" color={BORDER_COLORS.leave} onClick={() => navigate('/leave')} className="dd-clickable">
            {upcomingLeave.length === 0 ? (
              <p className="dd-empty">No upcoming leave planned</p>
            ) : (
              <div className="dd-list">
                {upcomingLeave.map(lr => (
                  <div key={lr.id} className="dd-list-row">
                    <span className={`dd-status-dot dd-status-${lr.status}`} />
                    <div className="dd-list-detail">
                      <span className="dd-list-primary">{(lr.leave_type as any)?.name || 'Leave'}</span>
                      <span className="dd-list-secondary">{formatDate(lr.start_date)} – {formatDate(lr.end_date)} ({lr.days_requested}d)</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Widget>
        )}

        {/* Notifications */}
        <Widget title="Notifications" color={BORDER_COLORS.notifications} onClick={() => navigate('/notifications')} className="dd-clickable">
          {recentNotifications.length === 0 ? (
            <p className="dd-empty">No recent notifications</p>
          ) : (
            <div className="dd-list">
              {recentNotifications.map(n => (
                <div key={n.id} className={`dd-list-row ${!n.is_read ? 'dd-unread' : ''}`}>
                  <span className={`dd-notif-dot dd-notif-${n.type}`} />
                  <div className="dd-list-detail">
                    <span className="dd-list-primary">{n.title}</span>
                    <span className="dd-list-secondary">{n.message.length > 60 ? n.message.slice(0, 60) + '…' : n.message}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Widget>

        {/* Expenses */}
        {features.expenses && (
          <Widget title="Expenses" color={BORDER_COLORS.expenses} onClick={() => navigate('/expenses')} className="dd-clickable">
            <div className="dd-expense-summary">
              <span className="dd-expense-total">&pound;{expenseTotal.toFixed(2)}</span>
              <span className="dd-expense-label">Total claims</span>
            </div>
            {recentExpenses.length === 0 ? (
              <p className="dd-empty">No expense claims</p>
            ) : (
              <div className="dd-list">
                {recentExpenses.slice(0, 3).map(e => (
                  <div key={e.id} className="dd-list-row">
                    <span className={`dd-status-dot dd-status-${e.status}`} />
                    <div className="dd-list-detail">
                      <span className="dd-list-primary">&pound;{Number(e.amount).toFixed(2)}</span>
                      <span className="dd-list-secondary">{e.description || e.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Widget>
        )}

        {/* Recent Kudos */}
        {features.kudos && (
          <Widget title="Recent Kudos" color={BORDER_COLORS.kudos} onClick={() => navigate('/kudos')} className="dd-clickable">
            {recentKudos.length === 0 ? (
              <p className="dd-empty">No kudos yet</p>
            ) : (
              <div className="dd-list">
                {recentKudos.map(k => (
                  <div key={k.id} className="dd-list-row">
                    <div className="dd-kudos-avatar">{k.from_employee ? `${k.from_employee.first_name[0]}${k.from_employee.last_name[0]}` : '?'}</div>
                    <div className="dd-list-detail">
                      <span className="dd-list-primary">{k.from_employee ? `${k.from_employee.first_name} ${k.from_employee.last_name}` : 'Someone'}</span>
                      <span className="dd-list-secondary">{k.message.length > 50 ? k.message.slice(0, 50) + '…' : k.message}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Widget>
        )}

        {/* 1:1 Meetings */}
        {features.performance && (
          <Widget title="1:1 Meetings" color={BORDER_COLORS.performance} onClick={() => navigate('/one-to-ones')} className="dd-clickable">
            <div className="dd-meeting-count">
              <span className="dd-meeting-number">{pendingOneToOnes}</span>
              <span className="dd-meeting-label">upcoming meeting{pendingOneToOnes !== 1 ? 's' : ''}</span>
            </div>
          </Widget>
        )}

        {/* Newsfeed / Announcements */}
        <Widget title="Newsfeed" color={BORDER_COLORS.announcements} onClick={() => navigate('/notifications', { state: { tab: 'company' } })} className="dd-clickable">
          {latestAnnouncement ? (
            <div className="dd-announcement">
              <h4 className="dd-announcement-title">{latestAnnouncement.title}</h4>
              <p className="dd-announcement-body">{latestAnnouncement.body.length > 120 ? latestAnnouncement.body.slice(0, 120) + '…' : latestAnnouncement.body}</p>
            </div>
          ) : (
            <p className="dd-empty">No announcements</p>
          )}
        </Widget>

        {/* Birthdays */}
        <Widget title={`Birthdays (${birthdays.length})`} color={BORDER_COLORS.birthdays}>
          {birthdays.length === 0 ? (
            <p className="dd-empty">No upcoming birthdays</p>
          ) : (
            <div className="dd-people-list">
              {birthdays.map(c => {
                const dob = new Date(c.date_of_birth!)
                const bday = new Date(new Date().getFullYear(), dob.getMonth(), dob.getDate())
                if (bday < new Date()) bday.setFullYear(bday.getFullYear() + 1)
                const isToday = toLocalDateStr(bday) === toLocalDateStr()
                return (
                  <div key={c.id} className={`dd-person-row ${isToday ? 'dd-today' : ''}`}>
                    {c.avatar_url ? (
                      <img className="dd-person-avatar" src={c.avatar_url} alt="" />
                    ) : (
                      <div className="dd-person-avatar dd-person-initials">{c.first_name[0]}{c.last_name[0]}</div>
                    )}
                    <div className="dd-person-info">
                      <span className="dd-person-name">{c.first_name} {c.last_name}</span>
                      <span className="dd-person-date">{isToday ? 'Today!' : formatDate(bday.toISOString().split('T')[0])}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Widget>

        {/* Work Anniversaries */}
        <Widget title={`Work Anniversaries (${anniversaries.length})`} color={BORDER_COLORS.anniversaries}>
          {anniversaries.length === 0 ? (
            <p className="dd-empty">No upcoming anniversaries</p>
          ) : (
            <div className="dd-people-list">
              {anniversaries.map(c => (
                <div key={c.id} className="dd-person-row">
                  {c.avatar_url ? (
                    <img className="dd-person-avatar" src={c.avatar_url} alt="" />
                  ) : (
                    <div className="dd-person-avatar dd-person-initials">{c.first_name[0]}{c.last_name[0]}</div>
                  )}
                  <div className="dd-person-info">
                    <span className="dd-person-name">{c.first_name} {c.last_name}</span>
                    <span className="dd-person-date">{c.department}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Widget>

      </div>
    </div>
  )
}
