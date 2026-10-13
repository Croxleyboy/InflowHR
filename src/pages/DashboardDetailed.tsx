import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTheme } from '../context/ThemeContext'
import { useFeatures } from '../context/FeatureContext'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'
import { useCheckIn } from '../context/CheckInContext'
import { useToast } from '../context/ToastContext'
import { supabase } from '../lib/supabase'
import { formatDate, toLocalDateStr, getFYRange } from '../lib/formatters'

interface LeaveRequest {
  id: number
  start_date: string
  end_date: string
  days_requested: number
  status: string
  leave_type: { name: string } | null
}

interface WorkflowNotif {
  id: number
  action: string
  task_description: string | null
  record_type: string | null
  approval_status: string | null
  status: string
  emp_display_name: string | null
  created_at: string
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

interface ReminderItem {
  id: string
  title: string
  subtitle: string
  navigateTo?: string
  icon: 'shift' | 'meeting' | 'birthday' | 'booking' | 'leave' | 'elearning' | 'survey'
}

interface AttendanceDay {
  date: string
  status: 'present' | 'absent' | 'late' | 'leave' | 'no_shift' | 'submitted' | 'approved' | 'not_contracted'
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


export default function DashboardDetailed() {
  const { dark, toggle } = useTheme()
  const { features } = useFeatures()
  const { t, lang, fyStartMonth } = useLanguage()
  const { signOut, employeeId, employeeName, employeeEmail, company, avatarUrl, companyUser, employmentCategory } = useAuth()
  const { activeCheckin, activeBreak, checkIn, checkOut, startBreak, endBreak, settings: ciSettings } = useCheckIn()
  const { showSuccess, showError } = useToast()
  const navigate = useNavigate()

  const isShiftWorker = employmentCategory === 'shift_worker'

  const [leaveRemaining, setLeaveRemaining] = useState<number | null>(null)
  const [leavePending, setLeavePending] = useState<number | null>(null)
  const [leaveApproved, setLeaveApproved] = useState<number | null>(null)
  const [leaveDeclined, setLeaveDeclined] = useState<number | null>(null)
  const [leaveTotal, setLeaveTotal] = useState<number | null>(null)
  const [upcomingLeave, setUpcomingLeave] = useState<LeaveRequest[]>([])
  const [recentNotifications, setRecentNotifications] = useState<WorkflowNotif[]>([])
  const [totalPendingCount, setTotalPendingCount] = useState(0)
  const [birthdays, setBirthdays] = useState<Colleague[]>([])
  const [anniversaries, setAnniversaries] = useState<Colleague[]>([])
  const [, setRecentExpenses] = useState<ExpenseClaim[]>([])
  const [expenseTotal, setExpenseTotal] = useState(0)
  const [expenseFYSubmitted, setExpenseFYSubmitted] = useState(0)
  const [expenseFYApproved, setExpenseFYApproved] = useState(0)
  const [lastExpense, setLastExpense] = useState<ExpenseClaim | null>(null)
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
  const [attendancePresent, setAttendancePresent] = useState(0)
  const [attendanceLate, setAttendanceLate] = useState(0)
  const [attendanceAbsent, setAttendanceAbsent] = useState(0)
  const [attendanceLeave, setAttendanceLeave] = useState(0)
  const [attendanceSubmitted, setAttendanceSubmitted] = useState(0)
  const [, setAttendanceNotContracted] = useState(0)
  const [attendanceScore, setAttendanceScore] = useState<number | null>(null)
  const [, setContractedDays] = useState<boolean[]>([true, true, true, true, true, false, false])
  const [jobTitle, setJobTitle] = useState<string | null>(null)
  const [lastPayNet, setLastPayNet] = useState<number | null>(null)
  const [lastPayDate, setLastPayDate] = useState<string | null>(null)
  const [lastPayPeriod, setLastPayPeriod] = useState<string | null>(null)
  const [nextPayday, setNextPayday] = useState<string | null>(null)
  const [payHidden, setPayHidden] = useState(() => {
    try { return localStorage.getItem('inflowhr-dd2-hide-pay') === '1' } catch { return false }
  })
  const [empEmail, setEmpEmail] = useState<string | null>(null)
  const [empPhone, setEmpPhone] = useState<string | null>(null)
  const [empStartDate, setEmpStartDate] = useState<string | null>(null)
  const [reminders, setReminders] = useState<ReminderItem[]>([])

  // Hero background image switcher
  const heroImages = ['/images/hero-landscape.jpg', '/images/hero-mountains.jpg', '/images/hero-sunset.jpg']
  const [heroImageIdx, setHeroImageIdx] = useState(() => {
    try { const saved = localStorage.getItem('inflowhr-dd2-hero-img'); return saved ? Math.min(Number(saved), 2) : 0 } catch { return 0 }
  })

  // Shift check-in state for hero bar
  const [heroShift, setHeroShift] = useState<{ id: string; start_time: string; end_time: string; template_name: string } | null>(null)
  const [ciTick, setCiTick] = useState(0)
  const [ciActing, setCiActing] = useState(false)
  const ciTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Legal timesheet timer (read from localStorage, shared with LegalTimesheets page)
  interface LTTimer { id: string; clientId: string; clientName: string; matterId: string; matterName: string; taskCode: string; elapsed: number; running: boolean; startedAt: number | null }
  const ltTimerKey = `lt-timers-${companyUser?.company_id}-${employeeId}`
  const [ltTimers, setLtTimers] = useState<LTTimer[]>([])
  const [, setLtTick] = useState(0)
  const ltTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadLtTimers = useCallback(() => {
    try {
      const saved = localStorage.getItem(ltTimerKey)
      if (saved) setLtTimers(JSON.parse(saved) as LTTimer[])
      else setLtTimers([])
    } catch { setLtTimers([]) }
  }, [ltTimerKey])

  useEffect(() => {
    loadLtTimers()
    const onStorage = (e: StorageEvent) => { if (e.key === ltTimerKey) loadLtTimers() }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [ltTimerKey, loadLtTimers])

  useEffect(() => {
    const hasRunning = ltTimers.some(t => t.running)
    if (hasRunning && !ltTimerRef.current) {
      ltTimerRef.current = setInterval(() => setLtTick(p => p + 1), 1000)
    } else if (!hasRunning && ltTimerRef.current) {
      clearInterval(ltTimerRef.current)
      ltTimerRef.current = null
    }
    return () => { if (ltTimerRef.current) { clearInterval(ltTimerRef.current); ltTimerRef.current = null } }
  }, [ltTimers])

  function getLtElapsed(timer: LTTimer): number {
    if (timer.running && timer.startedAt) return timer.elapsed + Math.floor((Date.now() - timer.startedAt) / 1000)
    return timer.elapsed
  }
  function fmtLtElapsed(seconds: number): string {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  function toggleLtTimer(id: string) {
    setLtTimers(prev => {
      const next = prev.map(tmr => {
        if (tmr.id === id) {
          if (tmr.running) return { ...tmr, running: false, elapsed: getLtElapsed(tmr), startedAt: null }
          return { ...tmr, running: true, startedAt: Date.now() }
        }
        if (tmr.running) return { ...tmr, running: false, elapsed: getLtElapsed(tmr), startedAt: null }
        return tmr
      })
      try { localStorage.setItem(ltTimerKey, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }

  function stopLtTimer(id: string) {
    setLtTimers(prev => {
      const next = prev.filter(tmr => tmr.id !== id)
      try { localStorage.setItem(ltTimerKey, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }

  async function logLtTimer(timer: LTTimer) {
    const elapsed = getLtElapsed(timer)
    const hrs = parseFloat((elapsed / 3600).toFixed(2))
    if (hrs <= 0) return
    const { error } = await supabase.from('legal_timesheet_entries').insert({
      company_id: companyUser?.company_id,
      employee_id: employeeId,
      date: new Date().toISOString().slice(0, 10),
      client_id: timer.clientId,
      matter_id: timer.matterId,
      task_code: timer.taskCode,
      duration_hrs: hrs,
      narrative: '',
      status: 'draft',
    })
    if (!error) stopLtTimer(timer.id)
  }

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
        const [approvedRes, pendingRes, declinedRes] = await Promise.all([
          supabase.from('leave_requests').select('days_requested')
            .eq('employee_id', employeeId).eq('company_id', cid).eq('leave_type_id', annualType.id)
            .eq('status', 'approved').gte('start_date', yearStart).lte('start_date', yearEnd),
          supabase.from('leave_requests').select('days_requested')
            .eq('employee_id', employeeId).eq('company_id', cid).eq('leave_type_id', annualType.id)
            .eq('status', 'pending').gte('start_date', yearStart).lte('start_date', yearEnd),
          supabase.from('leave_requests').select('days_requested')
            .eq('employee_id', employeeId).eq('company_id', cid).eq('leave_type_id', annualType.id)
            .eq('status', 'declined').gte('start_date', yearStart).lte('start_date', yearEnd),
        ])
        const approved = (approvedRes.data || []).reduce((s: number, r: any) => s + Number(r.days_requested), 0)
        const pending = (pendingRes.data || []).reduce((s: number, r: any) => s + Number(r.days_requested), 0)
        const declined = (declinedRes.data || []).length
        setLeaveApproved(approved)
        setLeavePending(pending)
        setLeaveDeclined(declined)
        setLeaveRemaining(total - approved)
      })

    supabase.from('leave_requests')
      .select('id, start_date, end_date, days_requested, status, leave_type:leave_types(name)')
      .eq('employee_id', employeeId).eq('company_id', cid)
      .in('status', ['approved', 'pending']).gte('start_date', today)
      .order('start_date').limit(5)
      .then(({ data }) => { if (data) setUpcomingLeave(data as any) })

    // Job title, email, phone, start date
    supabase.from('employees').select('job_title, email, phone, start_date, contracted_days').eq('id', employeeId).maybeSingle()
      .then(({ data }) => {
        if (data) {
          setJobTitle((data as any).job_title || null)
          setEmpEmail((data as any).email || null)
          setEmpPhone((data as any).phone || null)
          setEmpStartDate((data as any).start_date || null)
          if ((data as any).contracted_days) setContractedDays((data as any).contracted_days)
        }
      })
    supabase.from('payslips')
      .select('net_pay, payment_date, pay_period_start, pay_period_end, frequency')
      .eq('employee_id', employeeId).eq('company_id', cid).eq('released', true)
      .order('id', { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => {
        if (data) {
          setLastPayNet(Number((data as any).net_pay))
          setLastPayDate((data as any).payment_date || (data as any).pay_period_end)
          const ps = (data as any).pay_period_start
          const pe = (data as any).pay_period_end
          if (ps && pe) {
            const fmt = (d: string) => new Date(d + 'T00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
            setLastPayPeriod(`${fmt(ps)} – ${fmt(pe)}`)
          }
          const freq = (data as any).frequency || 'monthly'
          if (pe) {
            const nextDt = new Date(pe + 'T00:00')
            if (freq === 'weekly') nextDt.setDate(nextDt.getDate() + 7)
            else if (freq === 'fortnightly') nextDt.setDate(nextDt.getDate() + 14)
            else nextDt.setMonth(nextDt.getMonth() + 1)
            setNextPayday(toLocalDateStr(nextDt))
          }
        }
      })

    // Notifications — workflow_tracker items (same source as My Notifications page)
    if (employeeEmail) {
      Promise.all([
        supabase.from('workflow_tracker')
          .select('id, action, task_description, record_type, approval_status, status, emp_display_name, created_at')
          .ilike('assigned_to', `%${employeeEmail}%`)
          .eq('status', 'Pending')
          .eq('company_id', cid)
          .order('created_at', { ascending: false }),
        supabase.from('workflow_tracker')
          .select('id, action, task_description, record_type, approval_status, status, emp_display_name, created_at')
          .or(`assigned_to.ilike.%${employeeEmail}%,employee_email.ilike.%${employeeEmail}%`)
          .eq('status', 'Complete')
          .eq('company_id', cid)
          .order('created_at', { ascending: false })
          .limit(20),
      ]).then(([pendingRes, completeRes]) => {
        const pending = pendingRes.data || []
        setTotalPendingCount(pending.length)
        const combined = [...pending, ...(completeRes.data || [])]
          .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .slice(0, 10)
        setRecentNotifications(combined as WorkflowNotif[])
      })
    }

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

    // Expenses — last 6 for pagination + FY totals
    if (features.expenses) {
      const { fyStart, fyEnd } = getFYRange(fyStartMonth)
      supabase.from('expense_claims')
        .select('id, amount, status, created_at, description')
        .eq('employee_id', employeeId).eq('company_id', cid)
        .order('created_at', { ascending: false }).limit(6)
        .then(({ data }) => {
          if (data) {
            setRecentExpenses(data as ExpenseClaim[])
            setExpenseTotal(data.reduce((s: number, e: any) => s + Number(e.amount), 0))
            if (data.length > 0) setLastExpense(data[0] as ExpenseClaim)
          }
        })
      supabase.from('expense_claims')
        .select('amount, status')
        .eq('employee_id', employeeId).eq('company_id', cid)
        .gte('created_at', fyStart).lte('created_at', fyEnd)
        .then(({ data }) => {
          if (data) {
            setExpenseFYSubmitted(data.reduce((s: number, e: any) => s + Number(e.amount), 0))
            setExpenseFYApproved(data.filter((e: any) => e.status === 'approved').reduce((s: number, e: any) => s + Number(e.amount), 0))
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
        const enabledSet = new Set(enabledIds)
        setElearningCompleted([...completedIds].filter(id => enabledSet.has(id)).length)
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

    // Reminders & actions — upcoming shifts, meetings, leave, overdue e-learning
    ;(async () => {
      const items: ReminderItem[] = []
      const weekAhead = new Date()
      weekAhead.setDate(weekAhead.getDate() + 7)
      const weekAheadStr = toLocalDateStr(weekAhead)

      if (isShiftWorker) {
        const { data: upShifts } = await supabase.from('shift_assignments')
          .select('id, date, shift_template:shift_templates(name, start_time, end_time), rota:rotas(status)')
          .eq('employee_id', employeeId).eq('company_id', cid)
          .gte('date', today).lte('date', weekAheadStr).order('date').limit(3)
        if (upShifts) upShifts.filter((s: any) => s.rota?.status === 'published').forEach((s: any) => {
          items.push({
            id: `shift-${s.id}`, icon: 'shift',
            title: `${(s.shift_template as any)?.name || 'Shift'}`,
            subtitle: `${new Date(s.date + 'T00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}${(s.shift_template as any)?.start_time ? ` · ${(s.shift_template as any).start_time.slice(0, 5)}` : ''}`,
            navigateTo: '/shifts',
          })
        })
      }

      if (features.performance) {
        const { data: mtgs } = await supabase.from('one_to_one_meetings')
          .select('id, scheduled_date, scheduled_time, manager_id, employee_id')
          .eq('company_id', cid).in('status', ['pending', 'accepted'])
          .gte('scheduled_date', today).lte('scheduled_date', weekAheadStr)
          .or(`manager_id.eq.${employeeId},employee_id.eq.${employeeId}`)
          .order('scheduled_date').limit(3)
        if (mtgs) {
          const otherIds = [...new Set(mtgs.map((m: any) => m.manager_id === employeeId ? m.employee_id : m.manager_id))]
          const nameMap: Record<string, string> = {}
          if (otherIds.length) {
            const { data: names } = await supabase.from('employees').select('id, first_name, last_name').in('id', otherIds)
            ;(names || []).forEach((e: any) => { nameMap[e.id] = `${e.first_name} ${e.last_name}` })
          }
          mtgs.forEach((m: any) => {
            const otherId = m.manager_id === employeeId ? m.employee_id : m.manager_id
            items.push({
              id: `mtg-${m.id}`, icon: 'meeting',
              title: `1:1 with ${nameMap[otherId] || 'colleague'}`,
              subtitle: `${new Date(m.scheduled_date + 'T00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}${m.scheduled_time ? ` at ${m.scheduled_time.slice(0, 5)}` : ''}`,
              navigateTo: '/one-to-ones',
            })
          })
        }
      }

      const { data: pendingLeaveReqs } = await supabase.from('leave_requests')
        .select('id, start_date, leave_type:leave_types(name)')
        .eq('employee_id', employeeId).eq('company_id', cid).eq('status', 'pending')
        .order('start_date').limit(2)
      if (pendingLeaveReqs) pendingLeaveReqs.forEach((lr: any) => {
        items.push({
          id: `leave-${lr.id}`, icon: 'leave',
          title: `${(lr.leave_type as any)?.name || 'Leave'} request pending`,
          subtitle: formatDate(lr.start_date),
          navigateTo: '/leave',
        })
      })

      if (surveyOutstanding > 0) {
        items.push({ id: 'survey-outstanding', icon: 'survey', title: `${surveyOutstanding} survey${surveyOutstanding > 1 ? 's' : ''} outstanding`, subtitle: 'Complete to share your feedback', navigateTo: '/surveys' })
      }

      items.sort((a, b) => a.title.localeCompare(b.title))
      setReminders(items.slice(0, 3))
    })()

    // Attendance — shift workers: 14-day grid (last week + this week) using checkin_records
    // Non-shift: timesheet hours this week
    if (isShiftWorker) {
      ;(async () => {
        const now = new Date()
        const dayOfWeek = now.getDay()
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
        const thisMonday = new Date(now)
        thisMonday.setDate(now.getDate() + mondayOffset)
        const lastMonday = new Date(thisMonday)
        lastMonday.setDate(thisMonday.getDate() - 7)
        const thisSunday = new Date(thisMonday)
        thisSunday.setDate(thisMonday.getDate() + 6)
        const rangeStart = toLocalDateStr(lastMonday)
        const rangeEnd = toLocalDateStr(thisSunday)

        const [{ data: shifts }, { data: checkins }, { data: leaveRows }] = await Promise.all([
          supabase.from('shift_assignments')
            .select('id, date, shift_template:shift_templates(start_time)')
            .eq('employee_id', employeeId).eq('company_id', cid)
            .gte('date', rangeStart).lte('date', rangeEnd)
            .order('date', { ascending: true }),
          supabase.from('checkin_records')
            .select('shift_assignment_id, check_in_at, status')
            .eq('employee_id', employeeId).eq('company_id', cid)
            .eq('source', 'shifts'),
          supabase.from('leave_requests')
            .select('start_date, end_date')
            .eq('employee_id', employeeId).eq('company_id', cid)
            .eq('status', 'approved')
            .lte('start_date', rangeEnd).gte('end_date', rangeStart),
        ])

        const ciMap: Record<string, { check_in_at: string; status: string }> = {}
        if (checkins) {
          for (const c of checkins as any[]) {
            if (c.shift_assignment_id) ciMap[c.shift_assignment_id] = c
          }
        }

        const leaveDates = new Set<string>()
        if (leaveRows) {
          for (const lr of leaveRows as any[]) {
            const s = new Date(lr.start_date + 'T00:00')
            const e = new Date(lr.end_date + 'T00:00')
            for (let cur = new Date(s); cur <= e; cur.setDate(cur.getDate() + 1)) {
              leaveDates.add(toLocalDateStr(cur))
            }
          }
        }

        const days: AttendanceDay[] = []
        let present = 0, late = 0, absent = 0, onLeave = 0
        let scoredTotal = 0, scoreSum = 0
        for (let i = 0; i < 14; i++) {
          const d = new Date(lastMonday)
          d.setDate(lastMonday.getDate() + i)
          const dateStr = toLocalDateStr(d)
          let status: AttendanceDay['status'] = 'no_shift'

          if (leaveDates.has(dateStr)) {
            status = 'leave'; onLeave++; scoredTotal++; scoreSum += 1
          } else {
            const shift = (shifts as any[])?.find((s: any) => s.date === dateStr)
            if (shift) {
              const ci = ciMap[shift.id]
              if (ci) {
                const startTime = (shift.shift_template as any)?.start_time
                if (startTime) {
                  const expected = new Date(`${dateStr}T${startTime}`)
                  const actual = new Date(ci.check_in_at)
                  const diffMins = (actual.getTime() - expected.getTime()) / 60000
                  if (diffMins > 15) { status = 'late'; late++; scoredTotal++; scoreSum += 0.5 }
                  else { status = 'present'; present++; scoredTotal++; scoreSum += 1 }
                } else {
                  status = 'present'; present++; scoredTotal++; scoreSum += 1
                }
              } else if (dateStr < today) {
                status = 'absent'; absent++; scoredTotal++
              }
            }
          }
          days.push({ date: dateStr, status })
        }
        setAttendanceDays(days)
        setAttendancePresent(present)
        setAttendanceLate(late)
        setAttendanceAbsent(absent)
        setAttendanceLeave(onLeave)
        setAttendanceScore(scoredTotal > 0 ? Math.round((scoreSum / scoredTotal) * 100) : 100)
      })()
    } else {
      ;(async () => {
        const now = new Date()
        const today = toLocalDateStr(now)
        const dayOfWeek = now.getDay()
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
        const thisMonday = new Date(now)
        thisMonday.setDate(now.getDate() + mondayOffset)
        const threeWeeksAgoMonday = new Date(thisMonday)
        threeWeeksAgoMonday.setDate(thisMonday.getDate() - 14)
        const thisSunday = new Date(thisMonday)
        thisSunday.setDate(thisMonday.getDate() + 6)
        const rangeStart = toLocalDateStr(threeWeeksAgoMonday)
        const rangeEnd = toLocalDateStr(thisSunday)

        const [{ data: tsRows }, { data: legalRows }, { data: leaveRows }] = await Promise.all([
          supabase.from('timesheets')
            .select('date, status, hours')
            .eq('employee_id', employeeId).eq('company_id', cid)
            .gte('date', rangeStart).lte('date', rangeEnd),
          supabase.from('legal_timesheet_entries')
            .select('date, status, duration_hrs')
            .eq('employee_id', employeeId).eq('company_id', cid)
            .gte('date', rangeStart).lte('date', rangeEnd),
          supabase.from('leave_requests')
            .select('start_date, end_date')
            .eq('employee_id', employeeId).eq('company_id', cid)
            .eq('status', 'approved')
            .lte('start_date', rangeEnd).gte('end_date', rangeStart),
        ])

        const leaveDates = new Set<string>()
        if (leaveRows) {
          for (const lr of leaveRows) {
            const s = new Date(lr.start_date + 'T00:00')
            const e = new Date(lr.end_date + 'T00:00')
            for (let cur = new Date(s); cur <= e; cur.setDate(cur.getDate() + 1)) {
              leaveDates.add(toLocalDateStr(cur))
            }
          }
        }

        const tsByDate: Record<string, { hasAny: boolean; hasApproved: boolean }> = {}
        if (tsRows) {
          for (const t of tsRows as any[]) {
            if (!tsByDate[t.date]) tsByDate[t.date] = { hasAny: false, hasApproved: false }
            tsByDate[t.date].hasAny = true
            if (t.status === 'approved') tsByDate[t.date].hasApproved = true
          }
        }
        if (legalRows) {
          for (const l of legalRows as any[]) {
            if (!tsByDate[l.date]) tsByDate[l.date] = { hasAny: false, hasApproved: false }
            tsByDate[l.date].hasAny = true
            if (l.status === 'approved') tsByDate[l.date].hasApproved = true
          }
        }

        const { data: cdRow } = await supabase.from('employees').select('contracted_days').eq('id', employeeId).maybeSingle()
        const cDays: boolean[] = (cdRow as any)?.contracted_days || [true, true, true, true, true, false, false]

        const days: AttendanceDay[] = []
        let approved = 0, submitted = 0, onLeave = 0, absent = 0, notContracted = 0
        let scoreSum = 0, scoredDays = 0
        for (let i = 0; i < 21; i++) {
          const d = new Date(threeWeeksAgoMonday)
          d.setDate(threeWeeksAgoMonday.getDate() + i)
          const dateStr = toLocalDateStr(d)
          const dayIdx = d.getDay() === 0 ? 6 : d.getDay() - 1
          const isContracted = cDays[dayIdx]
          const inScoreRange = dateStr < toLocalDateStr(thisMonday)
          let status: AttendanceDay['status'] = 'no_shift'

          if (leaveDates.has(dateStr)) {
            status = 'leave'; onLeave++
            if (inScoreRange) { scoreSum += 1; scoredDays++ }
          } else if (!isContracted) {
            status = 'not_contracted'; notContracted++
            if (inScoreRange) { scoreSum += 1; scoredDays++ }
          } else if (tsByDate[dateStr]?.hasApproved) {
            status = 'approved'; approved++
            if (inScoreRange) { scoreSum += 1; scoredDays++ }
          } else if (tsByDate[dateStr]?.hasAny) {
            status = 'submitted'; submitted++
            if (inScoreRange) { scoreSum += 1; scoredDays++ }
          } else if (dateStr < today) {
            status = 'absent'; absent++
            if (inScoreRange) { scoredDays++ }
          }
          days.push({ date: dateStr, status })
        }

        setAttendanceDays(days)
        setAttendancePresent(approved)
        setAttendanceSubmitted(submitted)
        setAttendanceAbsent(absent)
        setAttendanceLeave(onLeave)
        setAttendanceNotContracted(notContracted)
        setAttendanceScore(scoredDays > 0 ? Math.round((scoreSum / scoredDays) * 100) : 100)
      })()
    }
  }, [employeeId, companyUser?.company_id, features.expenses, features.kudos, features.performance, features.elearning, isShiftWorker])

  // Fetch today's shift for check-in hero strip
  useEffect(() => {
    if (!employeeId || !companyUser?.company_id || !isShiftWorker || !ciSettings?.shifts_checkin_enabled) return
    const todayStr = toLocalDateStr()
    supabase.from('shift_assignments')
      .select('id, date, shift_template:shift_templates(name, start_time, end_time), rota:rotas(status)')
      .eq('employee_id', employeeId).eq('company_id', companyUser.company_id).eq('date', todayStr)
      .then(({ data }) => {
        const valid = (data || []).find((s: any) => s.rota?.status === 'published') || null
        if (valid) {
          const s = valid as any
          const tpl = s.shift_template
          setHeroShift({ id: s.id, start_time: tpl?.start_time || '00:00', end_time: tpl?.end_time || '00:00', template_name: tpl?.name || 'Shift' })
        } else {
          setHeroShift(null)
        }
      })
  }, [employeeId, companyUser?.company_id, isShiftWorker, ciSettings?.shifts_checkin_enabled])

  // Live timer for check-in display
  useEffect(() => {
    if (ciTimerRef.current) clearInterval(ciTimerRef.current)
    const needsTimer = (isShiftWorker && ciSettings?.shifts_checkin_enabled && (activeCheckin?.source === 'shifts' || heroShift))
    if (needsTimer) {
      ciTimerRef.current = setInterval(() => setCiTick(t => t + 1), 1000)
    }
    return () => { if (ciTimerRef.current) clearInterval(ciTimerRef.current) }
  }, [activeCheckin, heroShift, isShiftWorker, ciSettings?.shifts_checkin_enabled])

  // Check-in hero bar computed values
  const ciShiftCheckedIn = activeCheckin?.source === 'shifts'
  const ciOnBreak = !!activeBreak
  const promptMins = ciSettings?.prompt_before_shift_mins || 30

  const ciCanCheckIn = (() => {
    if (!heroShift || activeCheckin) return false
    const now = new Date()
    const [sh, sm] = heroShift.start_time.split(':').map(Number)
    const shiftStart = new Date(); shiftStart.setHours(sh, sm, 0, 0)
    const windowStart = new Date(shiftStart.getTime() - promptMins * 60000)
    const [eh, em] = heroShift.end_time.split(':').map(Number)
    const shiftEnd = new Date(); shiftEnd.setHours(eh, em, 0, 0)
    const windowEnd = new Date(shiftEnd.getTime() + 30 * 60000)
    return now >= windowStart && now <= windowEnd
  })()

  const ciShiftOvertime = (() => {
    void ciTick
    if (!ciShiftCheckedIn || !heroShift) return false
    const now = new Date()
    const [eh, em] = heroShift.end_time.split(':').map(Number)
    const shiftEnd = new Date(); shiftEnd.setHours(eh, em, 0, 0)
    return now > shiftEnd
  })()

  const ciCountdown = (() => {
    void ciTick
    if (!heroShift) return null
    const now = new Date()
    const [eh, em] = heroShift.end_time.split(':').map(Number)
    const shiftEnd = new Date(); shiftEnd.setHours(eh, em, 0, 0)
    const diffMs = shiftEnd.getTime() - now.getTime()
    const absDiff = Math.abs(diffMs)
    const hrs = Math.floor(absDiff / 3600000)
    const mins = Math.floor((absDiff % 3600000) / 60000)
    return { over: diffMs < 0, hrs, mins }
  })()

  const ciElapsedStr = (() => {
    void ciTick
    if (!activeCheckin) return ''
    const mins = Math.floor((Date.now() - new Date(activeCheckin.check_in_at).getTime()) / 60000)
    return `${Math.floor(mins / 60)}h ${mins % 60}m`
  })()

  async function handleHeroCheckIn() {
    if (ciActing || !heroShift) return
    setCiActing(true)
    const result = await checkIn('shifts', heroShift.id)
    if (result.ok) showSuccess(result.wfh ? 'Checked in from home' : 'Checked in for shift')
    else showError(result.error || 'Check-in failed')
    setCiActing(false)
  }
  async function handleHeroCheckOut() {
    if (ciActing) return
    setCiActing(true)
    const result = await checkOut()
    if (result.ok) showSuccess('Checked out')
    else showError(result.error || 'Check-out failed')
    setCiActing(false)
  }
  async function handleHeroBreak() {
    if (ciActing) return
    setCiActing(true)
    if (ciOnBreak) {
      const result = await endBreak()
      if (result.ok) showSuccess('Break ended')
      else showError(result.error || 'Failed to end break')
    } else {
      const result = await startBreak('lunch')
      if (result.ok) showSuccess('Break started')
      else showError(result.error || 'Failed to start break')
    }
    setCiActing(false)
  }

  const showHeroCheckin = isShiftWorker && ciSettings?.shifts_checkin_enabled && (ciCanCheckIn || ciShiftCheckedIn)

  const h = new Date().getHours()
  const greeting = h < 12 ? t('dashboard.greeting_morning') : h < 18 ? t('dashboard.greeting_afternoon') : t('dashboard.greeting_evening')

  const dateStr = new Date().toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })

  const pendingCount = totalPendingCount


  const newsPerPage = 3
  const newsPages = Math.ceil(announcements.length / newsPerPage)
  const newsSlice = announcements.slice(newsPage * newsPerPage, (newsPage + 1) * newsPerPage)

  const meetingTotal = pendingOneToOnes + completedOneToOnes

  // Tenure calculation
  const tenure = (() => {
    if (!empStartDate) return null
    const start = new Date(empStartDate + 'T00:00')
    const now = new Date()
    let years = now.getFullYear() - start.getFullYear()
    const anniversary = new Date(now.getFullYear(), start.getMonth(), start.getDate())
    if (now < anniversary) years--
    const lastAnniversary = new Date(now.getFullYear() - (now < anniversary ? 1 : 0), start.getMonth(), start.getDate())
    const days = Math.floor((now.getTime() - lastAnniversary.getTime()) / 86400000)
    return { years, days }
  })()

  // Column-based drag-and-drop — cards stack vertically within 3 columns, draggable between
  const [dragCard, setDragCard] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ col: number; pos: number } | null>(null)

  type CardDef = { id: string; el: React.ReactNode }
  const allCards: CardDef[] = []

  // Build card list — each card has a stable id
  allCards.push({ id: 'attendance', el: (
    <section className="dd2-card" onClick={() => navigate(isShiftWorker ? '/shifts' : '/timesheets')}>
      <div className="dd2-card-header">
        <svg className="dd2-card-hicon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        <h2 className="dd2-card-title">Attendance Overview</h2>
        {attendanceScore !== null && (
          <span className="dd2-card-count" style={{ background: attendanceScore >= 80 ? '#43a047' : attendanceScore >= 50 ? '#ff9800' : '#e53935', color: '#fff' }}>
            {attendanceScore}%
          </span>
        )}
      </div>
      <div className="dd2-card-body">
        {isShiftWorker ? (
          <>
            <div className="dd2-att-14-grid">
              <div className="dd2-att-week-row">
                <span className="dd2-att-week-label">Last week</span>
                <div className="dd2-att-week-squares">
                  {attendanceDays.slice(0, 7).map((d, i) => (
                    <div key={i} className="dd2-att-sq-col">
                      <div className={`dd2-att-sq dd2-att-sq-${d.status}`} title={`${d.date} — ${d.status.replace('_', ' ')}`} />
                      <span className="dd2-att-sq-label">{['M', 'T', 'W', 'T', 'F', 'S', 'S'][i]}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="dd2-att-week-row">
                <span className="dd2-att-week-label">This week</span>
                <div className="dd2-att-week-squares">
                  {attendanceDays.slice(7, 14).map((d, i) => (
                    <div key={i} className="dd2-att-sq-col">
                      <div className={`dd2-att-sq dd2-att-sq-${d.status}`} title={`${d.date} — ${d.status.replace('_', ' ')}`} />
                      <span className="dd2-att-sq-label">{['M', 'T', 'W', 'T', 'F', 'S', 'S'][i]}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="dd2-att-legend">
              <span className="dd2-att-legend-item"><span className="dd2-att-dot" style={{ background: '#43a047' }} />{attendancePresent} Present</span>
              <span className="dd2-att-legend-item"><span className="dd2-att-dot" style={{ background: '#ff9800' }} />{attendanceLate} Late</span>
              <span className="dd2-att-legend-item"><span className="dd2-att-dot" style={{ background: '#e53935' }} />{attendanceAbsent} Absent</span>
              <span className="dd2-att-legend-item"><span className="dd2-att-dot" style={{ background: '#7e57c2' }} />{attendanceLeave} On Leave</span>
            </div>
          </>
        ) : (
          <>
            <div className="dd2-att-14-grid">
              {['2 weeks ago', 'Last week', 'This week'].map((label, wk) => (
                <div key={wk} className="dd2-att-week-row">
                  <span className="dd2-att-week-label">{label}</span>
                  <div className="dd2-att-week-squares">
                    {attendanceDays.slice(wk * 7, wk * 7 + 7).map((d, i) => (
                      <div key={i} className="dd2-att-sq-col">
                        <div className={`dd2-att-sq dd2-att-sq-${d.status}`} title={`${new Date(d.date + 'T00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} — ${d.status.replace('_', ' ')}`} />
                        <span className="dd2-att-sq-label">{['M', 'T', 'W', 'T', 'F', 'S', 'S'][i]}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="dd2-att-legend">
              <span className="dd2-att-legend-item"><span className="dd2-att-dot" style={{ background: '#43a047' }} />{attendancePresent} Approved</span>
              <span className="dd2-att-legend-item"><span className="dd2-att-dot" style={{ background: '#1565c0' }} />{attendanceSubmitted} Submitted</span>
              <span className="dd2-att-legend-item"><span className="dd2-att-dot" style={{ background: '#7e57c2' }} />{attendanceLeave} Leave</span>
              <span className="dd2-att-legend-item"><span className="dd2-att-dot" style={{ background: '#e53935' }} />{attendanceAbsent} Missing</span>
            </div>
          </>
        )}
      </div>
    </section>
  )})

  allCards.push({ id: 'notifications', el: (
    <section className="dd2-card" onClick={() => navigate('/notifications')}>
      <div className="dd2-card-header">
        <svg className="dd2-card-hicon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
        <h2 className="dd2-card-title">My Notifications</h2>
        {pendingCount > 0 && <span className="dd2-card-count dd2-card-count-alert">{pendingCount} pending</span>}
      </div>
      <div className="dd2-card-body">
        {recentNotifications.length === 0 ? (
          <p className="dd2-empty">No recent notifications</p>
        ) : (
          <ul className="dd2-item-list">
            {recentNotifications.map(n => {
              const isPending = n.status === 'Pending'
              const typeColor = n.record_type === 'leave' ? '#43a047' : n.record_type === 'expense' ? '#f57c00' : n.record_type === 'timesheet' ? '#1565c0' : n.record_type === 'shift' ? '#e65100' : 'var(--text-muted)'
              const desc = n.task_description || n.action || 'Notification'
              const who = n.emp_display_name ? ` · ${n.emp_display_name}` : ''
              return (
                <li key={n.id} className={`dd2-item ${isPending ? 'dd2-item-unread' : ''}`}>
                  <span className="dd2-notif-indicator" style={{ background: typeColor }} />
                  <div className="dd2-item-content">
                    <span className="dd2-item-title">{desc}</span>
                    <span className="dd2-item-sub">{isPending ? 'Pending' : n.approval_status || 'Complete'}{who}</span>
                  </div>
                  <span className="dd2-item-time">{new Date(n.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                </li>
              )
            })}
          </ul>
        )}
        <div className="dd2-card-link">View all notifications →</div>
      </div>
    </section>
  )})

  allCards.push({ id: 'reminders', el: (
    <section className="dd2-card" onClick={() => navigate('/notifications')}>
      <div className="dd2-card-header">
        <svg className="dd2-card-hicon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <h2 className="dd2-card-title">Reminders &amp; Actions</h2>
        {reminders.length > 0 && <span className="dd2-card-count">{reminders.length}</span>}
      </div>
      <div className="dd2-card-body">
        {reminders.length === 0 ? (
          <p className="dd2-empty">All caught up — nothing pending</p>
        ) : (
          <ul className="dd2-item-list">
            {reminders.map(r => (
              <li key={r.id} className="dd2-item" onClick={(ev) => { if (r.navigateTo) { ev.stopPropagation(); navigate(r.navigateTo) } }}>
                <span className={`dd2-reminder-icon dd2-reminder-${r.icon}`}>
                  {r.icon === 'shift' ? '⏰' : r.icon === 'meeting' ? '👥' : r.icon === 'leave' ? '🏖' : r.icon === 'survey' ? '📋' : r.icon === 'elearning' ? '📚' : '📌'}
                </span>
                <div className="dd2-item-content">
                  <span className="dd2-item-title">{r.title}</span>
                  <span className="dd2-item-sub">{r.subtitle}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )})

  if (features.performance) {
    allCards.push({ id: 'meetings', el: (
      <section className="dd2-card" onClick={() => navigate('/one-to-ones')}>
        <div className="dd2-card-header">
          <svg className="dd2-card-hicon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          <h2 className="dd2-card-title">1:1 Meetings</h2>
        </div>
        <div className="dd2-card-body">
          <div className="dd2-meeting-donut-row">
            <div className="dd2-meeting-donut-wrap">
              <DonutChart segments={[{ value: completedOneToOnes, color: '#43a047', label: 'Completed' }, { value: pendingOneToOnes, color: '#ff9800', label: 'Pending' }]} size={80} />
              <div className="dd2-meeting-donut-center">
                <span className="dd2-meeting-donut-num">{meetingTotal}</span>
                <span className="dd2-meeting-donut-label">total</span>
              </div>
            </div>
            <div className="dd2-meeting-donut-legend">
              <div className="dd2-meeting-legend-row"><span className="dd2-att-dot" style={{ background: '#43a047' }} /><span>{completedOneToOnes} Completed</span></div>
              <div className="dd2-meeting-legend-row"><span className="dd2-att-dot" style={{ background: '#ff9800' }} /><span>{pendingOneToOnes} Pending</span></div>
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
    )})
  }

  if (features.leave || features.expenses) {
    allCards.push({ id: 'leave', el: (
      <section className="dd2-card">
        <div className="dd2-card-header" onClick={() => navigate('/leave')}>
          <svg className="dd2-card-hicon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          <h2 className="dd2-card-title">Leave & Expenses</h2>
        </div>
        <div className="dd2-card-body">
          {features.leave && (
            <>
              {upcomingLeave.length === 0 ? (
                <p className="dd2-empty" onClick={() => navigate('/leave')}>No upcoming leave planned</p>
              ) : (
                <ul className="dd2-item-list" onClick={() => navigate('/leave')}>
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
            </>
          )}
          {features.expenses && (
            <div className="dd2-card-expense-summary" onClick={() => navigate('/expenses')}>
              <div className="dd2-expense-row">
                <span className="dd2-expense-label">Expense Total</span>
                <span className="dd2-expense-value">&pound;{expenseTotal.toFixed(2)}</span>
              </div>
              {lastExpense && (
                <div className="dd2-expense-row dd2-expense-row-sub">
                  <span className="dd2-expense-label">Last submitted</span>
                  <span className="dd2-expense-value">{new Date(lastExpense.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    )})
  }

  allCards.push({ id: 'expenses', el: (
    <section className="dd2-card" onClick={() => navigate('/payslips')}>
      <div className="dd2-card-header">
        <svg className="dd2-card-hicon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        <h2 className="dd2-card-title">My Pay</h2>
        <button className="dd2-pay-toggle" title={payHidden ? 'Show amount' : 'Hide amount'} onClick={(ev) => { ev.stopPropagation(); setPayHidden(h => { const v = !h; try { localStorage.setItem('inflowhr-dd2-hide-pay', v ? '1' : '0') } catch { /* empty */ }; return v }) }}>
          {payHidden ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          )}
        </button>
      </div>
      <div className="dd2-card-body">
        <div className="dd2-pay-rows">
          <div className="dd2-pay-row">
            <span className="dd2-pay-label">Last payslip</span>
            <div className="dd2-pay-value-wrap">
              {lastPayNet !== null ? (
                <>
                  <span className="dd2-pay-amount">{payHidden ? '••••••' : `£${lastPayNet.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</span>
                  {lastPayPeriod && <span className="dd2-pay-date">{lastPayPeriod}</span>}
                </>
              ) : (
                <span className="dd2-pay-amount dd2-pay-none">No payslips yet</span>
              )}
            </div>
          </div>
          <div className="dd2-pay-row">
            <span className="dd2-pay-label">Next payday</span>
            <div className="dd2-pay-value-wrap">
              {nextPayday ? (
                <span className="dd2-pay-date">{new Date(nextPayday + 'T00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
              ) : (
                <span className="dd2-pay-amount dd2-pay-none">—</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  )})

  if (features.kudos) {
    allCards.push({ id: 'kudos', el: (
      <section className="dd2-card" onClick={() => navigate('/kudos')}>
        <div className="dd2-card-header">
          <svg className="dd2-card-hicon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          <h2 className="dd2-card-title">Kudos</h2>
          <span className="dd2-card-count">{recentKudos.length}</span>
        </div>
        <div className="dd2-card-body">
          {recentKudos.length === 0 ? (
            <p className="dd2-empty">No kudos yet</p>
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
    )})
  }

  allCards.push({ id: 'newsfeed', el: (
    <section className="dd2-card">
      <div className="dd2-card-header" onClick={() => navigate('/notifications', { state: { tab: 'company' } })}>
        <svg className="dd2-card-hicon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 20H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v1"/><path d="M21 12h-8"/><path d="M21 16h-8"/><path d="M21 8h-8"/></svg>
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
                <button className="dd2-page-btn" disabled={newsPage === 0} onClick={(ev) => { ev.stopPropagation(); setNewsPage(p => p - 1) }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
                </button>
                <span className="dd2-page-info">{newsPage + 1} / {newsPages}</span>
                <button className="dd2-page-btn" disabled={newsPage >= newsPages - 1} onClick={(ev) => { ev.stopPropagation(); setNewsPage(p => p + 1) }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )})

  if (features.elearning) {
    allCards.push({ id: 'elearning', el: (
      <section className="dd2-card" onClick={() => navigate('/elearning')}>
        <div className="dd2-card-header">
          <svg className="dd2-card-hicon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c0 1.1 2.7 3 6 3s6-1.9 6-3v-5"/></svg>
          <h2 className="dd2-card-title">E-Learning</h2>
        </div>
        <div className="dd2-card-body">
          <div className="dd2-elearn-stats">
            <div className="dd2-elearn-stat"><span className="dd2-elearn-num dd2-elearn-completed">{elearningCompleted}</span><span className="dd2-elearn-label">Completed</span></div>
            <div className="dd2-elearn-stat"><span className="dd2-elearn-num dd2-elearn-outstanding">{elearningOutstanding}</span><span className="dd2-elearn-label">Outstanding</span></div>
            <div className="dd2-elearn-stat"><span className="dd2-elearn-num dd2-elearn-overdue">{elearningOverdue}</span><span className="dd2-elearn-label">Overdue</span></div>
          </div>
          {elearningOverdue > 0 && (
            <div className="dd2-elearn-alert">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#e53935" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              {elearningOverdue} course{elearningOverdue !== 1 ? 's' : ''} past deadline
            </div>
          )}
        </div>
      </section>
    )})
  }

  if (features.surveys) {
    allCards.push({ id: 'surveys', el: (
      <section className="dd2-card" onClick={() => navigate('/surveys')}>
        <div className="dd2-card-header">
          <svg className="dd2-card-hicon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
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
    )})
  }

  allCards.push({ id: 'birthdays', el: (
    <section className="dd2-card">
      <div className="dd2-card-header">
        <span className="dd2-card-icon">🎂</span>
        <h2 className="dd2-card-title">Birthdays</h2>
        <span className="dd2-card-count">{birthdays.length}</span>
      </div>
      <div className="dd2-card-body">
        {birthdays.length === 0 ? (
          <p className="dd2-empty">No watchlist birthdays in the next 30 days</p>
        ) : (
          <ul className="dd2-item-list">
            {birthdays.slice(0, 4).map(c => {
              const dob = new Date(c.date_of_birth!)
              const bday = new Date(new Date().getFullYear(), dob.getMonth(), dob.getDate())
              if (bday < new Date()) bday.setFullYear(bday.getFullYear() + 1)
              const isToday = toLocalDateStr(bday) === toLocalDateStr()
              return (
                <li key={c.id} className={`dd2-item ${isToday ? 'dd2-item-highlight' : ''}`}>
                  {c.avatar_url ? <img className="dd2-person-circle dd2-person-img" src={c.avatar_url} alt="" /> : <div className="dd2-person-circle">{c.first_name[0]}{c.last_name[0]}</div>}
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
  )})

  allCards.push({ id: 'anniversaries', el: (
    <section className="dd2-card">
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
                {c.avatar_url ? <img className="dd2-person-circle dd2-person-img" src={c.avatar_url} alt="" /> : <div className="dd2-person-circle">{c.first_name[0]}{c.last_name[0]}</div>}
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
  )})

  // Distribute cards into 3 columns — restore from localStorage or round-robin
  const cardIds = allCards.map(c => c.id)
  const cardMap = Object.fromEntries(allCards.map(c => [c.id, c]))

  const [columns, setColumns] = useState<[string[], string[], string[]]>(() => {
    try {
      const saved = localStorage.getItem('inflowhr-dd2-columns')
      if (saved) {
        const parsed = JSON.parse(saved) as [string[], string[], string[]]
        if (Array.isArray(parsed) && parsed.length === 3) return parsed
      }
    } catch { /* empty */ }
    return [[], [], []]
  })

  const resolvedColumns: [string[], string[], string[]] = (() => {
    const flat = [...columns[0], ...columns[1], ...columns[2]]
    const knownIds = new Set(flat.filter(id => cardMap[id]))
    const missing = cardIds.filter(id => !knownIds.has(id))
    const cols: [string[], string[], string[]] = [
      columns[0].filter(id => cardMap[id]),
      columns[1].filter(id => cardMap[id]),
      columns[2].filter(id => cardMap[id]),
    ]
    missing.forEach((id, i) => cols[i % 3].push(id))
    return cols
  })()

  function saveColumns(cols: [string[], string[], string[]]) {
    setColumns(cols)
    try { localStorage.setItem('inflowhr-dd2-columns', JSON.stringify(cols)) } catch { /* empty */ }
  }

  function handleColDrop(col: number, pos: number) {
    if (!dragCard) return
    const newCols: [string[], string[], string[]] = [
      resolvedColumns[0].filter(id => id !== dragCard),
      resolvedColumns[1].filter(id => id !== dragCard),
      resolvedColumns[2].filter(id => id !== dragCard),
    ]
    newCols[col].splice(pos, 0, dragCard)
    saveColumns(newCols)
    setDragCard(null)
    setDropTarget(null)
  }

  return (
    <div className="dd2">
      {/* Header bar: greeting + actions */}
      <header className="dd2-header">
        <div>
          <h1 className="dd2-greeting">{greeting} {firstName}</h1>
          <p className="dd2-date">{dateStr}</p>
        </div>
        <div className="dd2-header-actions">
          <button className="dd2-action-btn" onClick={toggle} title="Toggle theme">
            {dark ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="5"/><g stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></g></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
            )}
          </button>
          <button className="dd2-action-btn" onClick={signOut} title="Sign out">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </button>
        </div>
      </header>

      {/* Full-width profile hero with vineyard background */}
      <section className="dd2-profile-hero" onClick={() => navigate('/profile')}>
        <div className="dd2-profile-bg">
          <img src={heroImages[heroImageIdx]} alt="" />
        </div>
        <div className="dd2-hero-dots" onClick={(e) => e.stopPropagation()}>
          {heroImages.map((_, i) => (
            <button
              key={i}
              className={`dd2-hero-dot${i === heroImageIdx ? ' dd2-hero-dot-active' : ''}`}
              onClick={() => { setHeroImageIdx(i); try { localStorage.setItem('inflowhr-dd2-hero-img', String(i)) } catch { /* empty */ } }}
              aria-label={`Background ${i + 1}`}
            />
          ))}
        </div>
        <div className="dd2-profile-content">
          <div className="dd2-profile-left">
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
              {company?.logo_url && <img className="dd2-profile-company-logo" src={company.logo_url} alt="" />}
            </div>
          </div>
          <div className="dd2-profile-right">
            {empEmail && (
              <div className="dd2-profile-detail">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                <span>{empEmail}</span>
              </div>
            )}
            {empPhone && (
              <div className="dd2-profile-detail">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                <span>{empPhone}</span>
              </div>
            )}
            {tenure && (
              <div className="dd2-profile-detail">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                <span>{tenure.years} year{tenure.years !== 1 ? 's' : ''}, {tenure.days} day{tenure.days !== 1 ? 's' : ''}</span>
              </div>
            )}
            {lastPayNet !== null && (
              <div className="dd2-profile-detail dd2-profile-detail-pay" onClick={(ev) => { ev.stopPropagation(); navigate('/payslips') }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                <span>&pound;{lastPayNet.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{lastPayDate ? ` · ${new Date(lastPayDate + 'T00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}</span>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Shift check-in hero strip — shift workers only */}
      {showHeroCheckin && (
        <div className={`dd2-checkin-strip${ciShiftOvertime ? ' dd2-checkin-overtime' : ciShiftCheckedIn ? (ciOnBreak ? ' dd2-checkin-onbreak' : ' dd2-checkin-active') : ''}`}>
          {ciShiftCheckedIn ? (
            <>
              <div className="dd2-checkin-info">
                <span className={`dd2-checkin-dot${ciOnBreak ? ' dd2-checkin-dot-break' : ciShiftOvertime ? ' dd2-checkin-dot-over' : ''}`} />
                <span className="dd2-checkin-label">
                  {ciOnBreak ? 'On Break' : ciShiftOvertime ? 'Overtime' : 'Checked In'}
                </span>
                <span className="dd2-checkin-time">
                  Started {new Date(activeCheckin!.check_in_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className="dd2-checkin-elapsed">{ciElapsedStr}</span>
              </div>
              <div className="dd2-checkin-countdown">
                {ciCountdown && (
                  ciCountdown.over ? (
                    <span className="dd2-checkin-over-label">+{ciCountdown.hrs}h {ciCountdown.mins}m over</span>
                  ) : (
                    <span className="dd2-checkin-remaining-label">{ciCountdown.hrs}h {ciCountdown.mins}m left</span>
                  )
                )}
              </div>
              <div className="dd2-checkin-actions">
                <button
                  className={`dd2-checkin-btn dd2-checkin-btn-break${ciOnBreak ? ' dd2-checkin-btn-endbreak' : ''}`}
                  onClick={handleHeroBreak}
                  disabled={ciActing}
                >
                  {ciOnBreak ? 'End Break' : 'Break'}
                </button>
                <button
                  className={`dd2-checkin-btn dd2-checkin-btn-out${ciShiftOvertime ? ' dd2-checkin-btn-out-overtime' : ''}`}
                  onClick={handleHeroCheckOut}
                  disabled={ciActing}
                >
                  Check Out
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="dd2-checkin-info">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                <span className="dd2-checkin-label">{heroShift?.template_name}</span>
                <span className="dd2-checkin-time">{heroShift?.start_time?.slice(0, 5)} – {heroShift?.end_time?.slice(0, 5)}</span>
              </div>
              <div className="dd2-checkin-actions">
                <button
                  className="dd2-checkin-btn dd2-checkin-btn-in"
                  onClick={handleHeroCheckIn}
                  disabled={ciActing}
                >
                  Check In
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Summary strip — leave & expenses */}
      <div className="dd2-summary-strip">
        {/* Card 1: Leave Allowance & Remaining */}
        <div className="dd2-summary-card dd2-summary-remaining" onClick={() => navigate('/leave')}>
          <span className="dd2-summary-value">{leaveRemaining ?? '--'}</span>
          <span className="dd2-summary-label">Days Remaining</span>
          <span className="dd2-summary-sub">of {leaveTotal ?? '--'} allowance</span>
        </div>
        {/* Card 2: Leave Status Breakdown */}
        <div className="dd2-summary-card dd2-summary-approved" onClick={() => navigate('/leave')}>
          <span className="dd2-summary-value">{leaveApproved ?? 0}</span>
          <span className="dd2-summary-label">Approved</span>
          <span className="dd2-summary-sub">{leaveDeclined ?? 0} declined · {leavePending ?? 0} pending</span>
        </div>
        {/* Card 3: FY Expenses */}
        <div className="dd2-summary-card dd2-summary-expenses" onClick={() => navigate('/expenses')}>
          <span className="dd2-summary-value">&pound;{expenseFYSubmitted.toFixed(0)}</span>
          <span className="dd2-summary-label">Expenses (FY)</span>
          <span className="dd2-summary-sub">&pound;{expenseFYApproved.toFixed(0)} approved</span>
        </div>
        {/* Card 4: Last Expense */}
        <div className="dd2-summary-card dd2-summary-lastexp" onClick={() => navigate('/expenses')}>
          {lastExpense ? (
            <>
              <span className="dd2-summary-value">&pound;{Number(lastExpense.amount).toFixed(2)}</span>
              <span className="dd2-summary-label">{lastExpense.description || 'Expense'}</span>
              <span className="dd2-summary-sub">{new Date(lastExpense.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · {lastExpense.status}</span>
            </>
          ) : (
            <>
              <span className="dd2-summary-value">--</span>
              <span className="dd2-summary-label">Last Expense</span>
              <span className="dd2-summary-sub">No expenses yet</span>
            </>
          )}
        </div>
      </div>

      {/* Active legal timesheet timers */}
      {ltTimers.length > 0 && features.legal_timesheets && (
        <div className="dd2-lt-timer-bar">
          <div className="dd2-lt-timer-icon" onClick={() => navigate('/legal-timesheets')} style={{ cursor: 'pointer' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2 2" /><path d="M5 3l2 2" /><path d="M19 3l-2 2" /><line x1="12" y1="1" x2="12" y2="3" /></svg>
          </div>
          <div className="dd2-lt-timer-items">
            {ltTimers.map(timer => {
              const elapsed = getLtElapsed(timer)
              return (
                <div key={timer.id} className={`dd2-lt-timer-item ${timer.running ? 'dd2-lt-timer-running' : ''}`}>
                  <span className="dd2-lt-timer-name">{timer.clientName} — {timer.matterName}</span>
                  <span className="dd2-lt-timer-time">{fmtLtElapsed(elapsed)}</span>
                  {timer.running && <span className="dd2-lt-timer-pulse" />}
                  <div className="dd2-lt-timer-controls">
                    <button className="dd2-lt-timer-btn dd2-lt-timer-play" onClick={() => toggleLtTimer(timer.id)}>
                      {timer.running ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="#fff"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="#fff"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                      )}
                    </button>
                    <button className="dd2-lt-timer-btn dd2-lt-timer-log" onClick={() => logLtTimer(timer)}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                    </button>
                    <button className="dd2-lt-timer-btn dd2-lt-timer-stop" onClick={() => stopLtTimer(timer.id)}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
          <span className="dd2-lt-timer-link" onClick={() => navigate('/legal-timesheets')} style={{ cursor: 'pointer' }}>View Timesheets</span>
        </div>
      )}

      {/* 3-column card grid — cards stack vertically, draggable between columns */}
      <div className="dd2-columns">
        {resolvedColumns.map((colCards, colIdx) => (
          <div
            key={colIdx}
            className={`dd2-column${dropTarget?.col === colIdx && dropTarget?.pos === colCards.length ? ' dd2-column-over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDropTarget({ col: colIdx, pos: colCards.length }) }}
            onDrop={(e) => { e.preventDefault(); handleColDrop(colIdx, colCards.length) }}
          >
            {colCards.map((cardId, posIdx) => {
              const card = cardMap[cardId]
              if (!card) return null
              return (
                <div key={cardId}>
                  {dropTarget?.col === colIdx && dropTarget?.pos === posIdx && (
                    <div className="dd2-drop-indicator" />
                  )}
                  <div
                    className={`dd2-drag-wrap${dragCard === cardId ? ' dd2-dragging' : ''}`}
                    draggable
                    onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', cardId); setDragCard(cardId) }}
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; setDropTarget({ col: colIdx, pos: posIdx }) }}
                    onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleColDrop(colIdx, posIdx) }}
                    onDragEnd={() => { setDragCard(null); setDropTarget(null) }}
                  >
                    {card.el}
                  </div>
                </div>
              )
            })}
            {dropTarget?.col === colIdx && dropTarget?.pos === colCards.length && (
              <div className="dd2-drop-indicator" />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
