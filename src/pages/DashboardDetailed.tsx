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
  to_employee?: { first_name: string; last_name: string } | null
  direction?: 'received' | 'sent'
}

interface Announcement {
  title: string
  body: string
  published_at?: string
}

interface AttendanceDay {
  date: string
  status: 'present' | 'absent' | 'late' | 'leave' | 'no_shift'
  hours?: number
}

function DonutChart({ segments, size = 100 }: { segments: { value: number; color: string; label: string }[]; size?: number }) {
  const total = segments.reduce((s, seg) => s + seg.value, 0)
  if (total === 0) {
    return (
      <svg width={size} height={size} viewBox="0 0 36 36">
        <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--border)" strokeWidth="3" />
      </svg>
    )
  }
  let offset = 25
  return (
    <svg width={size} height={size} viewBox="0 0 36 36">
      {segments.map((seg, i) => {
        const pct = (seg.value / total) * 100
        const el = (
          <circle
            key={i}
            cx="18" cy="18" r="15.9"
            fill="none"
            stroke={seg.color}
            strokeWidth="3.5"
            strokeDasharray={`${pct} ${100 - pct}`}
            strokeDashoffset={`${offset}`}
            strokeLinecap="round"
          />
        )
        offset -= pct
        return el
      })}
    </svg>
  )
}

function AttendanceBarChart({ days }: { days: AttendanceDay[] }) {
  const statusColors: Record<string, string> = {
    present: '#43a047',
    late: '#ff9800',
    absent: '#e53935',
    leave: '#7e57c2',
    no_shift: 'var(--border)',
  }
  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const display = days.length > 0 ? days.slice(-7) : Array(7).fill({ date: '', status: 'no_shift', hours: 0 })
  return (
    <div className="dd2-attendance-bars">
      {display.map((d: AttendanceDay, i: number) => (
        <div key={i} className="dd2-att-bar-col">
          <div className="dd2-att-bar-track">
            <div
              className="dd2-att-bar-fill"
              style={{
                height: d.status === 'no_shift' ? '10%' : d.status === 'present' ? '100%' : d.status === 'late' ? '70%' : d.status === 'absent' ? '30%' : '50%',
                background: statusColors[d.status] || 'var(--border)',
              }}
            />
          </div>
          <span className="dd2-att-bar-label">{dayLabels[i] || ''}</span>
        </div>
      ))}
    </div>
  )
}

export default function DashboardDetailed() {
  const { dark, toggle } = useTheme()
  const { features } = useFeatures()
  const { t, lang } = useLanguage()
  const { signOut, employeeId, employeeName, company, avatarUrl, companyUser, employmentCategory } = useAuth()
  const navigate = useNavigate()

  const isShiftWorker = employmentCategory === 'shift_worker'

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
  const [expensePage, setExpensePage] = useState(0)
  const [recentKudos, setRecentKudos] = useState<KudosItem[]>([])
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [newsPage, setNewsPage] = useState(0)
  const [pendingOneToOnes, setPendingOneToOnes] = useState(0)
  const [completedOneToOnes, setCompletedOneToOnes] = useState(0)
  const [nextMeetingDate, setNextMeetingDate] = useState<string | null>(null)
  const [nextMeetingTime, setNextMeetingTime] = useState<string | null>(null)
  const [nextMeetingWith, setNextMeetingWith] = useState<string | null>(null)
  const [elearningCompleted, setElearningCompleted] = useState(0)
  const [elearningOutstanding, setElearningOutstanding] = useState(0)
  const [elearningOverdue, setElearningOverdue] = useState(0)
  const [surveyOutstanding, setSurveyOutstanding] = useState(0)
  const [surveyCompleted, setSurveyCompleted] = useState(0)
  const [attendanceDays, setAttendanceDays] = useState<AttendanceDay[]>([])
  const [tsHoursThisWeek, setTsHoursThisWeek] = useState<number | null>(null)
  const [tsExpectedHours] = useState(37.5)
  const [attendancePresent, setAttendancePresent] = useState(0)
  const [attendanceLate, setAttendanceLate] = useState(0)
  const [attendanceAbsent, setAttendanceAbsent] = useState(0)
  const [jobTitle, setJobTitle] = useState<string | null>(null)
  const [lastPayNet, setLastPayNet] = useState<number | null>(null)
  const [lastPayDate, setLastPayDate] = useState<string | null>(null)

  const initials = employeeName.split(' ').map(n => n[0]).join('').toUpperCase() || '?'
  const firstName = employeeName.split(' ')[0] || employeeName

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

    supabase.from('leave_requests')
      .select('id, start_date, end_date, days_requested, status, leave_type:leave_types(name)')
      .eq('employee_id', employeeId).eq('company_id', cid)
      .in('status', ['approved', 'pending']).gte('start_date', today)
      .order('start_date').limit(5)
      .then(({ data }) => { if (data) setUpcomingLeave(data as any) })

    // Job title + last payslip
    supabase.from('employees').select('job_title').eq('id', employeeId).maybeSingle()
      .then(({ data }) => { if (data) setJobTitle((data as any).job_title || null) })
    supabase.from('payslips')
      .select('net_pay, payment_date, pay_period_start, pay_period_end')
      .eq('employee_id', employeeId).eq('company_id', cid).eq('status', 'final')
      .order('pay_period_end', { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => {
        if (data) {
          setLastPayNet(Number((data as any).net_pay))
          setLastPayDate((data as any).payment_date || (data as any).pay_period_end)
        }
      })

    // Notifications — last 5
    supabase.from('notifications')
      .select('id, title, message, type, created_at, is_read')
      .eq('employee_id', employeeId).eq('company_id', cid)
      .order('created_at', { ascending: false }).limit(5)
      .then(({ data }) => { if (data) setRecentNotifications(data as Notification[]) })

    // Birthdays & anniversaries
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

    // Expenses — last 6 for pagination
    if (features.expenses) {
      supabase.from('expense_claims')
        .select('id, amount, status, created_at, description')
        .eq('employee_id', employeeId).eq('company_id', cid)
        .order('created_at', { ascending: false }).limit(6)
        .then(({ data }) => {
          if (data) {
            setRecentExpenses(data as ExpenseClaim[])
            setExpenseTotal(data.reduce((s: number, e: any) => s + Number(e.amount), 0))
          }
        })
    }

    // Kudos — last 6 received + sent
    if (features.kudos) {
      ;(async () => {
        const [receivedRes, sentRes] = await Promise.all([
          supabase.from('kudos')
            .select('id, message, created_at, from_employee:employees!kudos_from_employee_id_fkey(first_name, last_name)')
            .eq('to_employee_id', employeeId).eq('company_id', cid)
            .order('created_at', { ascending: false }).limit(3),
          supabase.from('kudos')
            .select('id, message, created_at, to_employee:employees!kudos_to_employee_id_fkey(first_name, last_name)')
            .eq('from_employee_id', employeeId).eq('company_id', cid)
            .order('created_at', { ascending: false }).limit(3),
        ])
        const received = (receivedRes.data || []).map((k: any) => ({ ...k, direction: 'received' as const }))
        const sent = (sentRes.data || []).map((k: any) => ({ ...k, direction: 'sent' as const }))
        const combined = [...received, ...sent].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        setRecentKudos(combined.slice(0, 6) as KudosItem[])
      })()
    }

    // Announcements — last 6 for pagination
    supabase.from('announcements')
      .select('title, body, published_at').eq('company_id', cid)
      .order('published_at', { ascending: false }).limit(6)
      .then(({ data }) => { if (data) setAnnouncements(data as Announcement[]) })

    // 1:1 Meetings — pending + completed counts + next scheduled
    if (features.performance) {
      ;(async () => {
        const [pendingRes, completedRes] = await Promise.all([
          supabase.from('one_to_one_meetings')
            .select('id', { count: 'exact', head: true })
            .eq('company_id', cid).eq('status', 'pending')
            .or(`manager_id.eq.${employeeId},employee_id.eq.${employeeId}`),
          supabase.from('one_to_one_meetings')
            .select('id', { count: 'exact', head: true })
            .eq('company_id', cid).eq('status', 'completed')
            .or(`manager_id.eq.${employeeId},employee_id.eq.${employeeId}`),
        ])
        setPendingOneToOnes(pendingRes.count || 0)
        setCompletedOneToOnes(completedRes.count || 0)

        const { data: nextMtg } = await supabase.from('one_to_one_meetings')
          .select('scheduled_date, scheduled_time, manager_id, employee_id')
          .eq('company_id', cid).in('status', ['pending', 'accepted'])
          .gte('scheduled_date', today)
          .or(`manager_id.eq.${employeeId},employee_id.eq.${employeeId}`)
          .order('scheduled_date', { ascending: true }).limit(1).maybeSingle()
        if (nextMtg) {
          setNextMeetingDate(nextMtg.scheduled_date)
          setNextMeetingTime(nextMtg.scheduled_time?.slice(0, 5) || null)
          const otherId = nextMtg.manager_id === employeeId ? nextMtg.employee_id : nextMtg.manager_id
          const { data: otherEmp } = await supabase.from('employees').select('first_name, last_name').eq('id', otherId).maybeSingle()
          if (otherEmp) setNextMeetingWith(`${otherEmp.first_name} ${otherEmp.last_name}`)
        }
      })()
    }

    // E-Learning counts
    if (features.elearning) {
      ;(async () => {
        const [enabledRes, completedRes, empDeptRes] = await Promise.all([
          supabase.from('company_elearning_courses').select('course_id, target_departments').eq('company_id', cid).eq('is_enabled', true),
          supabase.from('elearning_completions').select('course_id').eq('employee_id', employeeId).eq('company_id', cid),
          supabase.from('employees').select('department').eq('id', employeeId).maybeSingle(),
        ])
        const myDept = (empDeptRes.data as any)?.department || ''
        const enabledIds = (enabledRes.data || []).filter((r: any) => { const d: string[] = r.target_departments || []; return d.length === 0 || d.includes(myDept) }).map((r: any) => r.course_id)
        const completedIds = new Set((completedRes.data || []).map((r: any) => r.course_id))
        try {
          const raw = localStorage.getItem('inflowhr-elearning')
          if (raw) {
            const parsed = JSON.parse(raw)
            if (Array.isArray(parsed.completed)) parsed.completed.forEach((id: string) => completedIds.add(id))
          }
        } catch { /* empty */ }
        const outstandingIds = enabledIds.filter((id: string) => !completedIds.has(id))
        setElearningCompleted(completedIds.size)
        if (outstandingIds.length > 0) {
          const { data: courses } = await supabase.from('elearning_courses').select('id, deadline').in('id', outstandingIds)
          const now = new Date()
          let overdue = 0
          if (courses) courses.forEach((c: any) => { if (c.deadline && new Date(c.deadline) < now) overdue++ })
          setElearningOverdue(overdue)
          setElearningOutstanding(outstandingIds.length - overdue)
        }
      })()
    }

    // Surveys
    supabase.from('survey_responses')
      .select('id, status')
      .eq('company_id', cid).eq('employee_id', employeeId)
      .then(({ data }) => {
        const rows = data || []
        setSurveyOutstanding(rows.filter((r: any) => r.status === 'pending').length)
        setSurveyCompleted(rows.filter((r: any) => r.status === 'completed').length)
      })

    // Attendance — shift workers: last 7 shift assignments; employed: timesheet hours this week
    if (isShiftWorker) {
      ;(async () => {
        const now = new Date()
        const sevenDaysAgo = new Date(now)
        sevenDaysAgo.setDate(now.getDate() - 6)
        const { data: shifts } = await supabase.from('shift_assignments')
          .select('date, check_in_status')
          .eq('employee_id', employeeId).eq('company_id', cid)
          .gte('date', toLocalDateStr(sevenDaysAgo)).lte('date', today)
          .order('date', { ascending: true })

        const days: AttendanceDay[] = []
        let present = 0, late = 0, absent = 0
        for (let i = 0; i < 7; i++) {
          const d = new Date(sevenDaysAgo)
          d.setDate(sevenDaysAgo.getDate() + i)
          const dateStr = toLocalDateStr(d)
          const shift = shifts?.find((s: any) => s.date === dateStr)
          let status: AttendanceDay['status'] = 'no_shift'
          if (shift) {
            const cis = shift.check_in_status
            if (cis === 'checked_in' || cis === 'checked_out') { status = 'present'; present++ }
            else if (cis === 'late') { status = 'late'; late++ }
            else if (dateStr < today) { status = 'absent'; absent++ }
            else { status = 'no_shift' }
          }
          days.push({ date: dateStr, status })
        }
        setAttendanceDays(days)
        setAttendancePresent(present)
        setAttendanceLate(late)
        setAttendanceAbsent(absent)
      })()
    } else {
      ;(async () => {
        const now = new Date()
        const dayOfWeek = now.getDay()
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
        const monday = new Date(now)
        monday.setDate(now.getDate() + mondayOffset)
        const sunday = new Date(monday)
        sunday.setDate(monday.getDate() + 6)
        const { data: tsEntries } = await supabase.from('timesheet_entries')
          .select('hours, date')
          .eq('employee_id', employeeId).eq('company_id', cid)
          .gte('date', toLocalDateStr(monday)).lte('date', toLocalDateStr(sunday))

        if (tsEntries) {
          const total = tsEntries.reduce((s: number, e: any) => s + Number(e.hours || 0), 0)
          setTsHoursThisWeek(total)
          const days: AttendanceDay[] = []
          let present = 0
          for (let i = 0; i < 7; i++) {
            const d = new Date(monday)
            d.setDate(monday.getDate() + i)
            const dateStr = toLocalDateStr(d)
            const dayEntries = tsEntries.filter((e: any) => e.date === dateStr)
            const hrs = dayEntries.reduce((s: number, e: any) => s + Number(e.hours || 0), 0)
            const status: AttendanceDay['status'] = hrs > 0 ? 'present' : (d <= now && i < 5 ? 'absent' : 'no_shift')
            if (hrs > 0) present++
            days.push({ date: dateStr, status, hours: hrs })
          }
          setAttendanceDays(days)
          setAttendancePresent(present)
        }
      })()
    }
  }, [employeeId, companyUser?.company_id, features.expenses, features.kudos, features.performance, features.elearning, isShiftWorker])

  const h = new Date().getHours()
  const greeting = h < 12 ? t('dashboard.greeting_morning') : h < 18 ? t('dashboard.greeting_afternoon') : t('dashboard.greeting_evening')

  const dateStr = new Date().toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })

  const unreadCount = recentNotifications.filter(n => !n.is_read).length

  const expensesPerPage = 3
  const expensePages = Math.ceil(recentExpenses.length / expensesPerPage)
  const expenseSlice = recentExpenses.slice(expensePage * expensesPerPage, (expensePage + 1) * expensesPerPage)

  const newsPerPage = 3
  const newsPages = Math.ceil(announcements.length / newsPerPage)
  const newsSlice = announcements.slice(newsPage * newsPerPage, (newsPage + 1) * newsPerPage)

  const meetingTotal = pendingOneToOnes + completedOneToOnes

  return (
    <div className="dd2">
      {/* Top bar: greeting left, actions right */}
      <header className="dd2-header">
        <div className="dd2-header-left">
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

      {/* Profile hero card — landscape background with avatar overlay */}
      <section className="dd2-profile-hero" onClick={() => navigate('/profile')}>
        <div className="dd2-profile-bg" />
        <div className="dd2-profile-content">
          <div className="dd2-profile-avatar-wrap">
            {avatarUrl ? (
              <img className="dd2-profile-avatar" src={avatarUrl} alt={initials} />
            ) : (
              <div className="dd2-profile-avatar dd2-profile-avatar-initials">{initials}</div>
            )}
          </div>
          <div className="dd2-profile-info">
            <h2 className="dd2-profile-name">{employeeName}</h2>
            {jobTitle && <p className="dd2-profile-title">{jobTitle}</p>}
          </div>
          {lastPayNet !== null && (
            <div className="dd2-profile-pay" onClick={(e) => { e.stopPropagation(); navigate('/payslips') }}>
              <span className="dd2-profile-pay-amount">&pound;{lastPayNet.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              <span className="dd2-profile-pay-label">
                Last Pay{lastPayDate ? ` · ${new Date(lastPayDate + 'T00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}
              </span>
            </div>
          )}
        </div>
      </section>

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

      {/* Main content — 3-column grid */}
      <div className="dd2-grid dd2-grid-3">

        {/* ─── Row 1: Attendance · Notifications · 1:1 Meetings ─── */}

        {/* Attendance Overview */}
        <section className="dd2-card dd2-card-accent-green" onClick={() => navigate(isShiftWorker ? '/shifts' : '/timesheets')}>
          <div className="dd2-card-header">
            <svg className="dd2-card-hicon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#43a047" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            <h2 className="dd2-card-title">Attendance Overview</h2>
          </div>
          <div className="dd2-card-body">
            {isShiftWorker ? (
              <>
                <AttendanceBarChart days={attendanceDays} />
                <div className="dd2-att-legend">
                  <span className="dd2-att-legend-item"><span className="dd2-att-dot" style={{ background: '#43a047' }} />{attendancePresent} Present</span>
                  <span className="dd2-att-legend-item"><span className="dd2-att-dot" style={{ background: '#ff9800' }} />{attendanceLate} Late</span>
                  <span className="dd2-att-legend-item"><span className="dd2-att-dot" style={{ background: '#e53935' }} />{attendanceAbsent} Absent</span>
                </div>
              </>
            ) : (
              <>
                <div className="dd2-att-week-dots">
                  {attendanceDays.map((d, i) => (
                    <div key={i} className="dd2-att-dot-col">
                      <div className={`dd2-att-week-dot dd2-att-week-dot-${d.status}`} title={d.hours ? `${d.hours}h` : d.status} />
                      <span className="dd2-att-bar-label">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i]}</span>
                    </div>
                  ))}
                </div>
                <div className="dd2-att-hours-summary">
                  <span className="dd2-att-hours-big">{tsHoursThisWeek !== null ? tsHoursThisWeek.toFixed(1) : '--'}h</span>
                  <span className="dd2-att-hours-label">of {tsExpectedHours}h this week</span>
                </div>
              </>
            )}
          </div>
        </section>

        {/* Notifications */}
        <section className="dd2-card dd2-card-accent-blue" onClick={() => navigate('/notifications')}>
          <div className="dd2-card-header">
            <svg className="dd2-card-hicon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1565c0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
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
                      <span className="dd2-item-sub">{n.message.length > 50 ? n.message.slice(0, 50) + '…' : n.message}</span>
                    </div>
                    <span className="dd2-item-time">{new Date(n.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="dd2-card-link">View all notifications →</div>
          </div>
        </section>

        {/* 1:1 Meetings with donut */}
        {features.performance ? (
          <section className="dd2-card dd2-card-accent-pink" onClick={() => navigate('/one-to-ones')}>
            <div className="dd2-card-header">
              <svg className="dd2-card-hicon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#c2185b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              <h2 className="dd2-card-title">1:1 Meetings</h2>
            </div>
            <div className="dd2-card-body">
              <div className="dd2-meeting-donut-row">
                <div className="dd2-meeting-donut-wrap">
                  <DonutChart
                    segments={[
                      { value: completedOneToOnes, color: '#43a047', label: 'Completed' },
                      { value: pendingOneToOnes, color: '#ff9800', label: 'Pending' },
                    ]}
                    size={90}
                  />
                  <div className="dd2-meeting-donut-center">
                    <span className="dd2-meeting-donut-num">{meetingTotal}</span>
                    <span className="dd2-meeting-donut-label">total</span>
                  </div>
                </div>
                <div className="dd2-meeting-donut-legend">
                  <div className="dd2-meeting-legend-row">
                    <span className="dd2-att-dot" style={{ background: '#43a047' }} />
                    <span>{completedOneToOnes} Completed</span>
                  </div>
                  <div className="dd2-meeting-legend-row">
                    <span className="dd2-att-dot" style={{ background: '#ff9800' }} />
                    <span>{pendingOneToOnes} Pending</span>
                  </div>
                </div>
              </div>
              {nextMeetingDate && (
                <div className="dd2-meeting-next">
                  <span className="dd2-meeting-next-label">Next:</span>
                  <span>{new Date(nextMeetingDate + 'T00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}{nextMeetingTime ? ` at ${nextMeetingTime}` : ''}</span>
                  {nextMeetingWith && <span className="dd2-meeting-next-with">with {nextMeetingWith}</span>}
                </div>
              )}
            </div>
          </section>
        ) : (
          <section className="dd2-card dd2-card-accent-purple" onClick={() => navigate('/leave')}>
            <div className="dd2-card-header">
              <svg className="dd2-card-hicon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7b1fa2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              <h2 className="dd2-card-title">Upcoming Leave</h2>
              <span className="dd2-card-count">{upcomingLeave.length}</span>
            </div>
            <div className="dd2-card-body">
              {upcomingLeave.length === 0 ? (
                <p className="dd2-empty">No upcoming leave planned</p>
              ) : (
                <ul className="dd2-item-list">
                  {upcomingLeave.slice(0, 3).map(lr => (
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

        {/* ─── Row 2: Expenses · Kudos · Leave/Shifts ─── */}

        {/* Expenses with pagination */}
        {features.expenses && (
          <section className="dd2-card dd2-card-accent-red">
            <div className="dd2-card-header" onClick={() => navigate('/expenses')}>
              <svg className="dd2-card-hicon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#e53935" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
              <h2 className="dd2-card-title">Expenses</h2>
              <span className="dd2-card-count">&pound;{expenseTotal.toFixed(2)}</span>
            </div>
            <div className="dd2-card-body">
              {recentExpenses.length === 0 ? (
                <p className="dd2-empty" onClick={() => navigate('/expenses')}>No expense claims</p>
              ) : (
                <>
                  <ul className="dd2-item-list" onClick={() => navigate('/expenses')}>
                    {expenseSlice.map(e => (
                      <li key={e.id} className="dd2-item">
                        <span className={`dd2-badge dd2-badge-${e.status}`}>{e.status}</span>
                        <div className="dd2-item-content">
                          <span className="dd2-item-title">&pound;{Number(e.amount).toFixed(2)}</span>
                          <span className="dd2-item-sub">{e.description || new Date(e.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                  {expensePages > 1 && (
                    <div className="dd2-pagination">
                      <button className="dd2-page-btn" disabled={expensePage === 0} onClick={(e) => { e.stopPropagation(); setExpensePage(p => p - 1) }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
                      </button>
                      <span className="dd2-page-info">{expensePage + 1} / {expensePages}</span>
                      <button className="dd2-page-btn" disabled={expensePage >= expensePages - 1} onClick={(e) => { e.stopPropagation(); setExpensePage(p => p + 1) }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </section>
        )}

        {/* Kudos — last 3 received/sent */}
        {features.kudos && (
          <section className="dd2-card dd2-card-accent-amber" onClick={() => navigate('/kudos')}>
            <div className="dd2-card-header">
              <svg className="dd2-card-hicon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
              <h2 className="dd2-card-title">Kudos</h2>
              <span className="dd2-card-count">{recentKudos.length}</span>
            </div>
            <div className="dd2-card-body">
              {recentKudos.length === 0 ? (
                <p className="dd2-empty">No kudos yet — give or receive recognition</p>
              ) : (
                <ul className="dd2-item-list">
                  {recentKudos.slice(0, 3).map(k => {
                    const person = k.direction === 'sent' ? k.to_employee : k.from_employee
                    const dirLabel = k.direction === 'sent' ? 'Sent to' : 'From'
                    return (
                      <li key={`${k.id}-${k.direction}`} className="dd2-item">
                        <div className="dd2-person-circle" style={{ background: k.direction === 'sent' ? '#fff3e0' : '#e8f5e9', color: k.direction === 'sent' ? '#e65100' : '#2e7d32', fontSize: 11 }}>
                          {person ? `${person.first_name[0]}${person.last_name[0]}` : '?'}
                        </div>
                        <div className="dd2-item-content">
                          <span className="dd2-item-title">{person ? `${person.first_name} ${person.last_name}` : 'Someone'}</span>
                          <span className="dd2-item-sub"><span style={{ fontWeight: 600 }}>{dirLabel}:</span> {k.message.length > 40 ? k.message.slice(0, 40) + '…' : k.message}</span>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </section>
        )}

        {/* Upcoming Leave (if performance is on, leave goes here instead of row 1) */}
        {features.performance && features.leave && (
          <section className="dd2-card dd2-card-accent-purple" onClick={() => navigate('/leave')}>
            <div className="dd2-card-header">
              <svg className="dd2-card-hicon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7b1fa2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              <h2 className="dd2-card-title">Upcoming Leave</h2>
              <span className="dd2-card-count">{upcomingLeave.length}</span>
            </div>
            <div className="dd2-card-body">
              {upcomingLeave.length === 0 ? (
                <p className="dd2-empty">No upcoming leave planned</p>
              ) : (
                <ul className="dd2-item-list">
                  {upcomingLeave.slice(0, 3).map(lr => (
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

        {/* ─── Row 3: News Feed · E-Learning · Surveys ─── */}

        {/* News Feed with pagination */}
        <section className="dd2-card dd2-card-accent-indigo">
          <div className="dd2-card-header" onClick={() => navigate('/notifications', { state: { tab: 'company' } })}>
            <svg className="dd2-card-hicon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3949ab" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 20H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v1"/><path d="M21 12h-8"/><path d="M21 16h-8"/><path d="M21 8h-8"/></svg>
            <h2 className="dd2-card-title">News Feed</h2>
          </div>
          <div className="dd2-card-body">
            {announcements.length === 0 ? (
              <p className="dd2-empty" onClick={() => navigate('/notifications', { state: { tab: 'company' } })}>No announcements</p>
            ) : (
              <>
                <ul className="dd2-item-list" onClick={() => navigate('/notifications', { state: { tab: 'company' } })}>
                  {newsSlice.map((a, i) => (
                    <li key={i} className="dd2-item">
                      <div className="dd2-item-content">
                        <span className="dd2-item-title">{a.title}</span>
                        <span className="dd2-item-sub">{a.body.length > 60 ? a.body.slice(0, 60) + '…' : a.body}</span>
                      </div>
                      {a.published_at && <span className="dd2-item-time">{new Date(a.published_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>}
                    </li>
                  ))}
                </ul>
                {newsPages > 1 && (
                  <div className="dd2-pagination">
                    <button className="dd2-page-btn" disabled={newsPage === 0} onClick={(e) => { e.stopPropagation(); setNewsPage(p => p - 1) }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
                    </button>
                    <span className="dd2-page-info">{newsPage + 1} / {newsPages}</span>
                    <button className="dd2-page-btn" disabled={newsPage >= newsPages - 1} onClick={(e) => { e.stopPropagation(); setNewsPage(p => p + 1) }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        {/* E-Learning */}
        {features.elearning && (
          <section className="dd2-card dd2-card-accent-yellow" onClick={() => navigate('/elearning')}>
            <div className="dd2-card-header">
              <svg className="dd2-card-hicon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c0 1.1 2.7 3 6 3s6-1.9 6-3v-5"/></svg>
              <h2 className="dd2-card-title">E-Learning</h2>
            </div>
            <div className="dd2-card-body">
              <div className="dd2-elearn-stats">
                <div className="dd2-elearn-stat">
                  <span className="dd2-elearn-num dd2-elearn-completed">{elearningCompleted}</span>
                  <span className="dd2-elearn-label">Completed</span>
                </div>
                <div className="dd2-elearn-stat">
                  <span className="dd2-elearn-num dd2-elearn-outstanding">{elearningOutstanding}</span>
                  <span className="dd2-elearn-label">Outstanding</span>
                </div>
                <div className="dd2-elearn-stat">
                  <span className="dd2-elearn-num dd2-elearn-overdue">{elearningOverdue}</span>
                  <span className="dd2-elearn-label">Overdue</span>
                </div>
              </div>
              {elearningOverdue > 0 && (
                <div className="dd2-elearn-alert">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#e53935" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                  {elearningOverdue} course{elearningOverdue !== 1 ? 's' : ''} past deadline
                </div>
              )}
            </div>
          </section>
        )}

        {/* Surveys */}
        {features.surveys && (
          <section className="dd2-card dd2-card-accent-violet" onClick={() => navigate('/surveys')}>
            <div className="dd2-card-header">
              <svg className="dd2-card-hicon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6d28d9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
              <h2 className="dd2-card-title">Surveys</h2>
            </div>
            <div className="dd2-card-body">
              <div className="dd2-survey-stats">
                {surveyOutstanding > 0 ? (
                  <div className="dd2-survey-badge dd2-survey-badge-pending">{surveyOutstanding} outstanding</div>
                ) : (
                  <div className="dd2-survey-badge dd2-survey-badge-ok">All caught up!</div>
                )}
                <span className="dd2-survey-completed">{surveyCompleted} completed</span>
              </div>
            </div>
          </section>
        )}

        {/* ─── Row 4: Birthdays · Anniversaries ─── */}

        {/* Birthdays */}
        <section className="dd2-card dd2-card-accent-cyan">
          <div className="dd2-card-header">
            <span className="dd2-card-icon">🎂</span>
            <h2 className="dd2-card-title">Birthdays</h2>
            <span className="dd2-card-count">{birthdays.length}</span>
          </div>
          <div className="dd2-card-body">
            {birthdays.length === 0 ? (
              <p className="dd2-empty">No watchlist birthdays in the next 30 days — add colleagues via the Directory</p>
            ) : (
              <ul className="dd2-item-list">
                {birthdays.slice(0, 4).map(c => {
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
        <section className="dd2-card dd2-card-accent-teal">
          <div className="dd2-card-header">
            <span className="dd2-card-icon">🎉</span>
            <h2 className="dd2-card-title">Work Anniversaries</h2>
            <span className="dd2-card-count">{anniversaries.length}</span>
          </div>
          <div className="dd2-card-body">
            {anniversaries.length === 0 ? (
              <p className="dd2-empty">No upcoming anniversaries</p>
            ) : (
              <ul className="dd2-item-list">
                {anniversaries.slice(0, 4).map(c => (
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
  )
}
