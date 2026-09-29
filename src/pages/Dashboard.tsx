import { useState, useEffect, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTheme } from '../context/ThemeContext'
import { useFeatures } from '../context/FeatureContext'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'
import { useCheckIn } from '../context/CheckInContext'
import { supabase } from '../lib/supabase'
import { toLocalDateStr } from '../lib/formatters'
import Chevron from '../components/Chevron'
import DashboardDetailed from './DashboardDetailed'

function getDateString(lang: string) {
  const d = new Date()
  const enDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const deDays = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
  const enMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const deMonths = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']
  const days = lang === 'de' ? deDays : enDays
  const months = lang === 'de' ? deMonths : enMonths
  const day = d.getDate()
  return `${days[d.getDay()]} ${day} ${months[d.getMonth()]}`
}

interface LatestAnnouncement {
  title: string
  body: string
  published_at?: string
  priority?: 'low' | 'medium' | 'high'
}

interface DashTask {
  id: number
  record_type: string
  action: string
  task_description: string | null
  approval_status: string | null
  created_at: string
}

interface OpenShift {
  id: string
  date: string
  shift_template: { name: string; start_time: string; end_time: string }[] | null
}

const INFO_CARD_KEYS = [
  'checkin', 'leave', 'expenses', 'documents', 'profile',
  'payslips', 'kudos', 'performance', 'elearning', 'benefits',
  'timesheets', 'shifts', 'space_booking', 'legal_timesheets',
  'asset_management', 'skills_passport', 'surveys', 'notifications',
] as const

type InfoCardKey = typeof INFO_CARD_KEYS[number]

const INFO_CARD_FEATURE_MAP: Record<string, string | null> = {
  checkin: null,
  leave: 'leave',
  expenses: 'expenses',
  documents: 'profile',
  profile: 'profile',
  payslips: 'payslips',
  kudos: 'kudos',
  performance: 'performance',
  elearning: 'elearning',
  benefits: 'benefits',
  timesheets: 'timesheets',
  shifts: 'shifts',
  space_booking: 'space_booking',
  legal_timesheets: 'legal_timesheets',
  asset_management: 'asset_management',
  skills_passport: 'skills_passport',
  surveys: 'surveys',
  notifications: null,
}

function getInfoCardOrder(): InfoCardKey[] {
  try {
    const stored = localStorage.getItem('inflowhr-info-card-order')
    if (stored) {
      const parsed = JSON.parse(stored) as string[]
      const valid = parsed.filter(k => (INFO_CARD_KEYS as readonly string[]).includes(k)) as InfoCardKey[]
      const missing = INFO_CARD_KEYS.filter(k => !valid.includes(k))
      return [...valid, ...missing]
    }
  } catch { /* empty */ }
  return [...INFO_CARD_KEYS]
}

function getInfoCardHidden(): Set<string> {
  try {
    const stored = localStorage.getItem('inflowhr-info-card-hidden')
    if (stored) return new Set(JSON.parse(stored))
  } catch { /* empty */ }
  return new Set()
}

export default function Dashboard() {
  const { dark, toggle } = useTheme()
  const { features, dashboardStyle } = useFeatures()
  const { t, lang } = useLanguage()
  const { signOut, employeeId, employeeName, employeeEmail, avatarUrl, company, companyUser, workPatternType, isSuperAdmin } = useAuth()
  const navigate = useNavigate()
  const { activeCheckin, activeBreak, checkOut, startBreak, endBreak, settings: ciSettings } = useCheckIn()
  const [latest, setLatest] = useState<LatestAnnouncement | null>(null)
  const [kudosUnread, setKudosUnread] = useState(0)
  const [pendingOneToOnes, setPendingOneToOnes] = useState(0)
  const [lastExpense, setLastExpense] = useState<number | null>(null)
  const [lastExpenseHasReceipt, setLastExpenseHasReceipt] = useState(false)
  const [pendingExpense, setPendingExpense] = useState<number | null>(null)
  const [leaveRemaining, setLeaveRemaining] = useState<number | null>(null)
  const [leavePending, setLeavePending] = useState<number | null>(null)
  const [reminderCount, setReminderCount] = useState(0)
  const [docCount, setDocCount] = useState(0)
  const [docMissing, setDocMissing] = useState(0)
  const [cardsExpanded, setCardsExpanded] = useState(false)
  const [latestTasks, setLatestTasks] = useState<DashTask[]>([])
  const [openShifts, setOpenShifts] = useState<OpenShift[]>([])
  const [announcements, setAnnouncements] = useState<LatestAnnouncement[]>([])
  const [nextBooking, setNextBooking] = useState<{ space_name: string; booking_date: string; start_time: string | null } | null>(null)
  const [nextShift, setNextShift] = useState<{ date: string; shift_name: string; start_time: string; end_time: string } | null>(null)
  const [latestLegalTs, setLatestLegalTs] = useState<{ date: string; duration_hrs: number; status: string } | null>(null)
  const [latestAsset, setLatestAsset] = useState<{ asset_name: string; asset_type: string } | null>(null)
  const [latestSkill, setLatestSkill] = useState<{ name: string; kind: string } | null>(null)
  const [latestNotif, setLatestNotif] = useState<{ title: string; created_at: string } | null>(null)
  const [surveyOutstanding, setSurveyOutstanding] = useState(0)
  const [surveyCompleted, setSurveyCompleted] = useState(0)
  const [nextElearning, setNextElearning] = useState<{ title: string; deadline: string } | null>(null)
  const [nextMeeting, setNextMeeting] = useState<{ scheduled_date: string; scheduled_time: string; label: string } | null>(null)
  const [latestBenefit, setLatestBenefit] = useState<{ name: string } | null>(null)
  const [onLeaveToday, setOnLeaveToday] = useState(false)
  const [weatherIcon, setWeatherIcon] = useState<{ code: number; temp: number } | null>(null)
  const [, setNextLeaveDate] = useState<{ date: string; status: string } | null>(null)
  const [lastPayslip, setLastPayslip] = useState<{ net_pay: number; month: string } | null>(null)
  const [lastKudos, setLastKudos] = useState<{ message: string; from_name: string } | null>(null)
  const [tsHoursThisWeek, setTsHoursThisWeek] = useState<number | null>(null)
  const [tsExpectedHours] = useState(37.5)
  const [lastTimesheet, setLastTimesheet] = useState<{ date: string; hours: number } | null>(null)
  const [workPatternDays, setWorkPatternDays] = useState<boolean[] | null>(null)
  const [lastShiftWorked, setLastShiftWorked] = useState<{ date: string; hours: number } | null>(null)
  const [dashMode, setDashMode] = useState(localStorage.getItem('inflowhr-dashboard-mode') || 'simple')
  useEffect(() => {
    const handler = () => setDashMode(localStorage.getItem('inflowhr-dashboard-mode') || 'simple')
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [])
  const infoCardOrder = getInfoCardOrder()
  const infoCardHidden = getInfoCardHidden()

  const [isDesktop, setIsDesktop] = useState(window.innerWidth >= 768)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  useEffect(() => {
    if (!companyUser?.employee_id || !companyUser?.company_id) return
    let cancelled = false
    supabase.from('employee_consents')
      .select('consent_type, withdrawn_at')
      .eq('employee_id', companyUser.employee_id)
      .eq('company_id', companyUser.company_id)
      .eq('consent_type', 'geolocation')
      .is('withdrawn_at', null)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        if (!data) { setWeatherIcon(null); return }
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            if (cancelled) return
            const { latitude, longitude } = pos.coords
            fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=weather_code,temperature_2m&timezone=auto`)
              .then(r => r.json())
              .then(d => {
                if (!cancelled && d.current) {
                  setWeatherIcon({ code: d.current.weather_code, temp: Math.round(d.current.temperature_2m) })
                }
              })
              .catch(() => {})
          },
          () => { if (!cancelled) setWeatherIcon(null) },
          { timeout: 5000 }
        )
      })
    return () => { cancelled = true }
  }, [companyUser?.employee_id, companyUser?.company_id])

  const [quickMenuOpen, setQuickMenuOpen] = useState(false)

  const [dashPref, setDashPref] = useState(localStorage.getItem('inflowhr-dashboard-layout') || 'cards')
  useEffect(() => {
    const handler = () => setDashPref(localStorage.getItem('inflowhr-dashboard-layout') || 'cards')
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [])

  useEffect(() => {
    if (companyUser?.company_id) {
      supabase.from('announcements')
        .select('title, body, published_at, priority')
        .eq('company_id', companyUser.company_id)
        .order('published_at', { ascending: false })
        .limit(1)
        .single()
        .then(({ data }) => { if (data) setLatest(data as LatestAnnouncement) })

      supabase.from('announcements')
        .select('title, body, published_at, priority')
        .eq('company_id', companyUser.company_id)
        .order('published_at', { ascending: false })
        .limit(1)
        .then(({ data }) => { if (data) setAnnouncements(data as LatestAnnouncement[]) })
    }

    if (employeeId && companyUser?.company_id) {
      const lastSeen = localStorage.getItem('inflowhr-kudos-seen') || '1970-01-01'
      supabase.from('kudos')
        .select('id', { count: 'exact', head: true })
        .eq('to_employee_id', employeeId)
        .eq('company_id', companyUser.company_id)
        .gt('created_at', lastSeen)
        .then(({ count }) => { if (count && count > 0) setKudosUnread(count) })

      const today = toLocalDateStr()

      ;(async () => {
        const { data: empRow } = await supabase.from('employees').select('work_pattern_id').eq('id', employeeId).maybeSingle()
        if (empRow?.work_pattern_id) {
          const { data: wp } = await supabase.from('work_patterns').select('days, pattern_type').eq('id', empRow.work_pattern_id).maybeSingle()
          if (wp) { setWorkPatternDays(wp.days) }
        }
      })()

      supabase.from('one_to_one_meetings')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyUser.company_id)
        .eq('status', 'pending')
        .gte('scheduled_date', today)
        .or(`manager_id.eq.${employeeId},employee_id.eq.${employeeId}`)
        .then(({ count }) => { if (count && count > 0) setPendingOneToOnes(count) })

      // Count open reminders — must match what Notifications page shows
      ;(async () => {
        let count = 0
        const now = new Date()
        const weekAhead = new Date(now); weekAhead.setDate(weekAhead.getDate() + 7)
        const weekAheadStr = toLocalDateStr(weekAhead)

        let watchlistIds: string[] = []
        try { watchlistIds = JSON.parse(localStorage.getItem('inflowhr-kudos-watchlist') || '[]') } catch { /* empty */ }

        if (watchlistIds.length > 0) {
          const { data: colleagues } = await supabase.from('employees')
            .select('id, date_of_birth').eq('company_id', companyUser.company_id).eq('is_active', true).not('date_of_birth', 'is', null)
          if (colleagues) {
            const yr = now.getFullYear()
            colleagues.forEach((c: any) => {
              if (!c.date_of_birth || c.id === employeeId || !watchlistIds.includes(c.id)) return
              const dob = new Date(c.date_of_birth)
              const bday = new Date(yr, dob.getMonth(), dob.getDate())
              if (bday < now) bday.setFullYear(yr + 1)
              if (Math.floor((bday.getTime() - now.getTime()) / 86400000) <= 30) count++
            })
          }
        }

        const { count: shiftCount } = await supabase.from('shift_assignments')
          .select('id', { count: 'exact', head: true })
          .eq('employee_id', employeeId).eq('company_id', companyUser.company_id)
          .gte('date', today).lte('date', weekAheadStr)
        count += shiftCount || 0

        const { count: bookingCount } = await supabase.from('space_bookings')
          .select('id', { count: 'exact', head: true })
          .eq('employee_id', employeeId).eq('company_id', companyUser.company_id)
          .gte('booking_date', today).lte('booking_date', weekAheadStr)
        count += bookingCount || 0

        // 1:1 meetings in next 14 days — exclude past-time meetings for today
        const twoWeeksAhead = new Date(now); twoWeeksAhead.setDate(twoWeeksAhead.getDate() + 14)
        const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
        const { data: upcomingMeetings } = await supabase.from('one_to_one_meetings')
          .select('id, scheduled_date, scheduled_time')
          .eq('company_id', companyUser.company_id)
          .in('status', ['pending', 'accepted'])
          .gte('scheduled_date', today)
          .lte('scheduled_date', toLocalDateStr(twoWeeksAhead))
          .or(`manager_id.eq.${employeeId},employee_id.eq.${employeeId}`)
        if (upcomingMeetings) {
          count += upcomingMeetings.filter((m: any) => {
            if (m.scheduled_date > today) return true
            return m.scheduled_time?.slice(0, 5) >= currentTime
          }).length
        }

        // Booking confirmations in last 3 days — exclude those already counted as upcoming
        const threeDaysAgo = new Date(now); threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)
        const { data: confirmBookings } = await supabase.from('space_bookings')
          .select('id, booking_date')
          .eq('employee_id', employeeId).eq('company_id', companyUser.company_id)
          .eq('status', 'confirmed')
          .gte('created_at', threeDaysAgo.toISOString())
          .limit(10)
        if (confirmBookings) {
          count += confirmBookings.filter((b: any) =>
            !(b.booking_date >= today && b.booking_date <= weekAheadStr)
          ).length
        }

        // Shift confirmations in last 3 days — exclude those already counted as upcoming
        const { data: recentShifts } = await supabase.from('shift_assignments')
          .select('id, date, rota:rotas(status)')
          .eq('employee_id', employeeId).eq('company_id', companyUser.company_id)
          .gte('created_at', threeDaysAgo.toISOString())
          .limit(10)
        if (recentShifts) {
          count += recentShifts.filter((s: any) =>
            s.rota?.status === 'published' && !(s.date >= today && s.date <= weekAheadStr)
          ).length
        }

        if (features.elearning) {
          const [enabledRes, completedRes, empDeptRes] = await Promise.all([
            supabase.from('company_elearning_courses').select('course_id, target_departments').eq('company_id', companyUser.company_id).eq('is_enabled', true),
            supabase.from('elearning_completions').select('course_id').eq('employee_id', employeeId).eq('company_id', companyUser.company_id),
            supabase.from('employees').select('department').eq('id', employeeId).maybeSingle(),
          ])
          const myDept = (empDeptRes.data as any)?.department || ''
          const enabledIds = (enabledRes.data || []).filter((r: any) => { const d: string[] = r.target_departments || []; return d.length === 0 || d.includes(myDept) }).map((r: any) => r.course_id)
          const completedIds = new Set((completedRes.data || []).map((r: any) => r.course_id))
          const outstandingIds = enabledIds.filter((id: string) => !completedIds.has(id))
          count += outstandingIds.length
        }

        setReminderCount(count)
      })()

      supabase.from('expense_claims')
        .select('id, amount, status')
        .eq('employee_id', employeeId)
        .eq('company_id', companyUser.company_id)
        .eq('status', 'approved')
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
        .then(({ data }) => {
          if (data) {
            setLastExpense(data.amount)
            supabase.from('expense_line_items')
              .select('id', { count: 'exact', head: true })
              .eq('expense_claim_id', data.id)
              .not('receipt_url', 'is', null)
              .then(({ count }) => setLastExpenseHasReceipt((count || 0) > 0))
          }
        })

      supabase.from('expense_claims')
        .select('amount')
        .eq('employee_id', employeeId)
        .eq('company_id', companyUser.company_id)
        .in('status', ['pending', 'submitted'])
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
        .then(({ data }) => { if (data) setPendingExpense(data.amount) })

      supabase.from('leave_types')
        .select('id, name')
        .eq('company_id', companyUser.company_id)
        .eq('name', 'Annual Leave')
        .limit(1)
        .single()
        .then(async ({ data: annualType }) => {
          if (!annualType) return
          const { data: balRow } = await supabase.from('leave_balances')
            .select('total_allowance, lieu_days')
            .eq('employee_id', employeeId)
            .eq('company_id', companyUser.company_id)
            .eq('leave_type_id', annualType.id)
            .eq('year', new Date().getFullYear())
            .limit(1)
            .single()
          if (!balRow) return
          const yearStart = `${new Date().getFullYear()}-01-01`
          const yearEnd = `${new Date().getFullYear()}-12-31`
          const [approvedRes, pendingRes] = await Promise.all([
            supabase.from('leave_requests')
              .select('days_requested')
              .eq('employee_id', employeeId)
              .eq('company_id', companyUser.company_id)
              .eq('leave_type_id', annualType.id)
              .eq('status', 'approved')
              .gte('start_date', yearStart)
              .lte('start_date', yearEnd),
            supabase.from('leave_requests')
              .select('days_requested')
              .eq('employee_id', employeeId)
              .eq('company_id', companyUser.company_id)
              .eq('leave_type_id', annualType.id)
              .eq('status', 'pending')
              .gte('start_date', yearStart)
              .lte('start_date', yearEnd),
          ])
          const approvedDays = (approvedRes.data || []).reduce((s: number, r: any) => s + Number(r.days_requested), 0)
          const pendingDays = (pendingRes.data || []).reduce((s: number, r: any) => s + Number(r.days_requested), 0)
          setLeaveRemaining(balRow.total_allowance + (Number(balRow.lieu_days) || 0) - approvedDays)
          setLeavePending(pendingDays)
        })

      supabase.from('employee_documents')
        .select('id, category, expiry_date', { count: 'exact' })
        .eq('employee_id', employeeId)
        .eq('company_id', companyUser.company_id)
        .eq('visible_to_employee', true)
        .then(({ data, count }) => {
          setDocCount(count || 0)
          if (data) {
            const now = new Date()
            const missing = data.filter((d: any) => {
              if (d.category !== 'right_to_work' || !d.expiry_date) return false
              return new Date(d.expiry_date) < now
            }).length
            setDocMissing(missing)
          }
        })

      supabase.from('workflow_tracker')
        .select('id, record_type, action, task_description, approval_status, created_at')
        .ilike('assigned_to', `%${employeeEmail}%`)
        .eq('status', 'Pending')
        .eq('company_id', companyUser.company_id)
        .order('created_at', { ascending: false })
        .limit(3)
        .then(({ data }) => { if (data) setLatestTasks(data as DashTask[]) })

      const todayDate = toLocalDateStr()

      supabase.from('space_bookings')
        .select('booking_date, start_time, space:spaces(name)')
        .eq('employee_id', employeeId)
        .eq('company_id', companyUser.company_id)
        .eq('status', 'confirmed')
        .gte('booking_date', todayDate)
        .order('booking_date', { ascending: true })
        .limit(1)
        .maybeSingle()
        .then(({ data }) => {
          if (data) setNextBooking({ space_name: (data.space as any)?.name || 'Space', booking_date: data.booking_date, start_time: data.start_time })
        })

      supabase.from('shift_assignments')
        .select('date, shift_template:shift_templates(name, start_time, end_time)')
        .eq('employee_id', employeeId)
        .eq('company_id', companyUser.company_id)
        .gte('date', todayDate)
        .order('date', { ascending: true })
        .limit(1)
        .maybeSingle()
        .then(({ data }) => {
          if (data) {
            const tpl = data.shift_template as any
            setNextShift({ date: data.date, shift_name: tpl?.name || 'Shift', start_time: tpl?.start_time || '', end_time: tpl?.end_time || '' })
          }
        })

      supabase.from('legal_timesheet_entries')
        .select('date, duration_hrs, status')
        .eq('employee_id', employeeId)
        .eq('company_id', companyUser.company_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
        .then(({ data }) => { if (data) setLatestLegalTs(data as any) })

      supabase.from('company_assets')
        .select('asset_name, asset_type')
        .eq('assigned_to', employeeId)
        .eq('company_id', companyUser.company_id)
        .eq('status', 'Assigned')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
        .then(({ data }) => { if (data) setLatestAsset(data as any) })

      ;(async () => {
        const { data: sk } = await supabase.from('employee_skills')
          .select('skill:skills(name)')
          .eq('employee_id', employeeId)
          .eq('company_id', companyUser.company_id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (sk) { setLatestSkill({ name: (sk.skill as any)?.name || 'Skill', kind: 'skill' }); return }
        const { data: lang } = await supabase.from('employee_languages')
          .select('language')
          .eq('employee_id', employeeId)
          .eq('company_id', companyUser.company_id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (lang) setLatestSkill({ name: lang.language, kind: 'language' })
      })()

      supabase.from('notifications')
        .select('title, created_at')
        .eq('employee_id', employeeId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
        .then(({ data }) => { if (data) setLatestNotif(data as any) })

      supabase.from('survey_responses')
        .select('id, status', { count: 'exact' })
        .eq('company_id', companyUser.company_id)
        .eq('employee_id', employeeId)
        .then(({ data }) => {
          const rows = data || []
          setSurveyOutstanding(rows.filter((r: any) => r.status === 'pending').length)
          setSurveyCompleted(rows.filter((r: any) => r.status === 'completed').length)
        })

      ;(async () => {
        const [enabledRes, completedRes, empDeptRes] = await Promise.all([
          supabase.from('company_elearning_courses').select('course_id, target_departments').eq('company_id', companyUser.company_id).eq('is_enabled', true),
          supabase.from('elearning_completions').select('course_id').eq('employee_id', employeeId).eq('company_id', companyUser.company_id),
          supabase.from('employees').select('department').eq('id', employeeId).maybeSingle(),
        ])
        const myDept = (empDeptRes.data as any)?.department || ''
        const enabledIds = (enabledRes.data || []).filter((r: any) => { const d: string[] = r.target_departments || []; return d.length === 0 || d.includes(myDept) }).map((r: any) => r.course_id)
        const completedIds = new Set((completedRes.data || []).map((r: any) => r.course_id))
        const outstandingIds = enabledIds.filter((id: string) => !completedIds.has(id))
        if (outstandingIds.length > 0) {
          const { data: courses } = await supabase.from('elearning_courses').select('id, title, deadline').in('id', outstandingIds)
          if (courses && courses.length > 0) {
            const withDeadline = courses.filter((c: any) => c.deadline).sort((a: any, b: any) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime())
            const next = withDeadline.length > 0 ? withDeadline[0] : courses[0]
            setNextElearning({ title: next.title, deadline: next.deadline })
          }
        }
      })()

      ;(async () => {
        const { data: upcoming } = await supabase.from('one_to_one_meetings')
          .select('scheduled_date, scheduled_time')
          .eq('company_id', companyUser.company_id)
          .in('status', ['pending', 'accepted'])
          .gte('scheduled_date', todayDate)
          .or(`manager_id.eq.${employeeId},employee_id.eq.${employeeId}`)
          .order('scheduled_date', { ascending: true })
          .limit(1)
          .maybeSingle()
        if (upcoming) { setNextMeeting({ ...upcoming, label: 'Next' }); return }
        const { data: last } = await supabase.from('one_to_one_meetings')
          .select('scheduled_date, scheduled_time')
          .eq('company_id', companyUser.company_id)
          .eq('status', 'completed')
          .or(`manager_id.eq.${employeeId},employee_id.eq.${employeeId}`)
          .order('scheduled_date', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (last) setNextMeeting({ ...last, label: 'Last' })
      })()

      supabase.from('benefit_enrollments')
        .select('benefit_type:benefit_types(name)')
        .eq('employee_id', employeeId)
        .eq('company_id', companyUser.company_id)
        .order('enrolled_at', { ascending: false })
        .limit(1)
        .maybeSingle()
        .then(({ data }) => {
          if (data) setLatestBenefit({ name: (data.benefit_type as any)?.name || 'Benefit' })
        })

      if (features.shifts) {
        supabase.from('shift_assignments')
          .select('id, date, shift_template:shift_templates(name, start_time, end_time)')
          .eq('company_id', companyUser.company_id)
          .is('employee_id', null)
          .gte('date', todayDate)
          .order('date', { ascending: true })
          .limit(3)
          .then(({ data }) => { if (data) setOpenShifts(data as OpenShift[]) })
      }

      supabase.from('leave_requests')
        .select('start_date, status')
        .eq('employee_id', employeeId)
        .eq('company_id', companyUser.company_id)
        .in('status', ['approved', 'pending'])
        .gte('start_date', todayDate)
        .order('start_date', { ascending: true })
        .limit(1)
        .maybeSingle()
        .then(({ data }) => { if (data) setNextLeaveDate({ date: data.start_date, status: data.status }) })

      supabase.from('leave_requests')
        .select('id')
        .eq('employee_id', employeeId)
        .eq('company_id', companyUser.company_id)
        .eq('status', 'approved')
        .lte('start_date', todayDate)
        .gte('end_date', todayDate)
        .limit(1)
        .maybeSingle()
        .then(({ data }) => { setOnLeaveToday(!!data) })

      supabase.from('payslips')
        .select('net_pay, pay_period_end')
        .eq('employee_id', employeeId)
        .eq('company_id', companyUser.company_id)
        .order('payment_date', { ascending: false })
        .limit(1)
        .maybeSingle()
        .then(({ data }) => {
          if (data) setLastPayslip({
            net_pay: data.net_pay,
            month: new Date(data.pay_period_end + 'T00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
          })
        })

      supabase.from('kudos')
        .select('message, from_employee:employees!kudos_from_employee_id_fkey(first_name)')
        .eq('to_employee_id', employeeId)
        .eq('company_id', companyUser.company_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
        .then(({ data }) => {
          if (data) setLastKudos({ message: data.message || '', from_name: (data.from_employee as any)?.first_name || '' })
        })

      ;(async () => {
        const now = new Date()
        const dayOfWeek = now.getDay()
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
        const monday = new Date(now)
        monday.setDate(now.getDate() + mondayOffset)
        const sunday = new Date(monday)
        sunday.setDate(monday.getDate() + 6)
        const { data: tsEntries } = await supabase.from('timesheet_entries')
          .select('hours')
          .eq('employee_id', employeeId)
          .eq('company_id', companyUser.company_id)
          .gte('date', toLocalDateStr(monday))
          .lte('date', toLocalDateStr(sunday))
        if (tsEntries) {
          const total = tsEntries.reduce((s: number, e: any) => s + Number(e.hours || 0), 0)
          setTsHoursThisWeek(total)
        }

        const { data: lastTs } = await supabase.from('timesheets')
          .select('date, hours')
          .eq('employee_id', employeeId)
          .eq('company_id', companyUser.company_id)
          .in('status', ['pending', 'approved'])
          .order('date', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (lastTs) setLastTimesheet({ date: lastTs.date, hours: Number(lastTs.hours || 0) })
      })()

      supabase.from('shift_assignments')
        .select('date, shift_template:shift_templates(start_time, end_time)')
        .eq('employee_id', employeeId)
        .eq('company_id', companyUser.company_id)
        .lt('date', todayDate)
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle()
        .then(({ data }) => {
          if (data) {
            const tpl = data.shift_template as any
            const st = tpl?.start_time, et = tpl?.end_time
            let hrs = 0
            if (st && et) {
              const [sh, sm] = st.split(':').map(Number)
              const [eh, em] = et.split(':').map(Number)
              hrs = Math.max(0, (eh * 60 + em - sh * 60 - sm) / 60)
            }
            setLastShiftWorked({ date: data.date, hours: Math.round(hrs * 10) / 10 })
          }
        })
    }
  }, [employeeId, employeeEmail, companyUser?.company_id, features.elearning])

  function getWeatherSvg(code: number): ReactNode {
    if (code === 0 || code === 1) return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
    if (code === 2) return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v2"/><path d="M4.93 4.93l1.41 1.41"/><path d="M20 12h2"/><path d="M19.07 4.93l-1.41 1.41"/><path d="M15.95 13.76a4 4 0 1 0-7.45-1.52"/><path d="M17.5 19H9a5 5 0 1 1 .9-9.93"/></svg>
    if (code === 3) return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z"/></svg>
    if (code >= 51 && code <= 67 || code >= 80 && code <= 82) return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z"/><line x1="8" y1="19" x2="8" y2="22"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="16" y1="19" x2="16" y2="22"/></svg>
    if (code >= 71 && code <= 77 || code >= 85 && code <= 86) return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z"/><path d="M8 15h.01"/><path d="M8 19h.01"/><path d="M12 17h.01"/><path d="M12 21h.01"/><path d="M16 15h.01"/><path d="M16 19h.01"/></svg>
    if (code >= 95) return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#eab308" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z"/><path d="M13 11l-4 6h6l-4 6"/></svg>
    if (code >= 45 && code <= 48) return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z"/><line x1="4" y1="14" x2="20" y2="14" opacity="0.4"/><line x1="6" y1="18" x2="18" y2="18" opacity="0.4"/></svg>
    return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z"/></svg>
  }

  const h = new Date().getHours()
  const greeting = h < 12 ? t('dashboard.greeting_morning') : h < 18 ? t('dashboard.greeting_afternoon') : t('dashboard.greeting_evening')

  const checkinEnabled = ciSettings?.timesheets_checkin_enabled || ciSettings?.shifts_checkin_enabled

  function renderInfoCard(key: InfoCardKey) {
    const featureKey = INFO_CARD_FEATURE_MAP[key]
    if (featureKey && !(features as any)[featureKey]) return null
    if (key === 'checkin' && !checkinEnabled) return null
    if (infoCardHidden.has(key)) return null

    switch (key) {
      case 'checkin': {
        const isActive = !!activeCheckin
        const mins = isActive ? Math.floor((Date.now() - new Date(activeCheckin!.check_in_at).getTime()) / 60000) : 0
        const elapsed = isActive ? `${Math.floor(mins / 60)}h${mins % 60 > 0 ? ` ${mins % 60}m` : ''}` : ''
        const todayShift = nextShift && nextShift.date === toLocalDateStr() ? nextShift : null
        const todayDow = (new Date().getDay() + 6) % 7
        const isContractedDay = !workPatternDays || workPatternType === 'variable' || workPatternDays[todayDow]
        const statusLabel = isActive ? 'Checked In' : onLeaveToday ? 'On Leave' : !isContractedDay ? 'Not Working' : todayShift ? 'On Shift' : 'At Work'
        const statusColor = onLeaveToday ? '#e53935' : !isContractedDay ? '#7e57c2' : todayShift ? '#e65100' : '#43a047'
        const iconBg = onLeaveToday ? '#ffebee' : !isContractedDay ? '#ede7f6' : todayShift ? '#fff3e0' : '#e8f5e9'
        return (
          <div key={key} className="info-card" style={{ cursor: 'default' }}>
            <div className="info-card-head">
              <span className="info-card-title">Today's Status</span>
              <span className="info-card-icon" style={{ background: weatherIcon ? '#f0f9ff' : iconBg }}>
                {weatherIcon ? getWeatherSvg(weatherIcon.code) : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={statusColor} strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
              </span>
            </div>
            <div className="info-card-body">
              <span className="info-card-value info-card-status-value" style={{ color: statusColor }}>
                {statusLabel}{weatherIcon ? <span className="info-card-temp"> · {weatherIcon.temp}°C</span> : ''}
              </span>
              {isActive ? (
                <div className="info-card-status info-card-status-ok"><span className="info-card-dot" />{elapsed} elapsed</div>
              ) : todayShift ? (
                <span className="info-card-sub" style={{ color: '#e65100' }}>{todayShift.start_time?.slice(0, 5)}–{todayShift.end_time?.slice(0, 5)}</span>
              ) : onLeaveToday ? (
                <span className="info-card-sub" style={{ color: '#e53935' }}>Approved leave today</span>
              ) : !isContractedDay ? (
                <span className="info-card-sub" style={{ color: '#7e57c2' }}>Not a working day</span>
              ) : checkinEnabled ? (
                <span className="info-card-sub">Check in via Timesheets</span>
              ) : (
                <span className="info-card-sub">No leave booked</span>
              )}
            </div>
          </div>
        )
      }
      case 'leave':
        return (
          <button key={key} className="info-card" onClick={() => navigate('/leave')}>
            <div className="info-card-head">
              <span className="info-card-title">Leave & Balance</span>
              <span className="info-card-icon" style={{ background: '#e8f5e9' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#43a047" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              </span>
            </div>
            <div className="info-card-body">
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontSize: 28, fontWeight: 800, color: '#1565c0', lineHeight: 1 }}>{leaveRemaining !== null ? leaveRemaining : '--'}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#546e7a' }}>days remaining</span>
              </div>
              {leavePending !== null && leavePending > 0 && (
                <span style={{ fontSize: 12, fontWeight: 600, color: '#e65100', marginTop: 4, display: 'block' }}>{leavePending} pending request{leavePending !== 1 ? 's' : ''}</span>
              )}
            </div>
          </button>
        )
      case 'expenses':
        return (
          <button key={key} className="info-card" onClick={() => navigate('/expenses')}>
            <div className="info-card-head">
              <span className="info-card-title">Expenses</span>
              <span className="info-card-icon" style={{ background: '#ffebee' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e53935" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
              </span>
            </div>
            <div className="info-card-body">
              {pendingExpense !== null ? (
                <>
                  <span className="info-card-value">&pound;{pendingExpense.toFixed(2)}</span>
                  <div className="info-card-status info-card-status-pending"><span className="info-card-dot" />Claim pending approval</div>
                </>
              ) : lastExpense !== null ? (
                <>
                  <span className="info-card-value">&pound;{lastExpense.toFixed(2)}</span>
                  <div className="info-card-status info-card-status-ok"><span className="info-card-dot" />Last claim approved</div>
                </>
              ) : (
                <>
                  <span className="info-card-value">Expenses</span>
                  <span className="info-card-sub">Submit & track claims</span>
                </>
              )}
            </div>
          </button>
        )
      case 'documents':
        return (
          <button key={key} className="info-card" onClick={() => navigate('/my-profile', { state: { tab: 'job', scrollTo: 'documents' } })}>
            <div className="info-card-head">
              <span className="info-card-title">Documents</span>
              <span className="info-card-icon" style={{ background: '#e3f2fd' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1565c0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
              </span>
            </div>
            <div className="info-card-body">
              <span className="info-card-value">{docCount} <span className="info-card-value-unit">uploaded</span></span>
              {docMissing > 0 ? (
                <div className="info-card-status info-card-status-warn"><span className="info-card-dot" />{docMissing} document{docMissing !== 1 ? 's' : ''} expired</div>
              ) : docCount > 0 ? (
                <div className="info-card-status info-card-status-ok"><span className="info-card-dot" />All documents valid</div>
              ) : (
                <span className="info-card-sub">No documents uploaded</span>
              )}
            </div>
          </button>
        )
      case 'profile':
        return (
          <button key={key} className="info-card" onClick={() => navigate('/my-profile')}>
            <div className="info-card-head">
              <span className="info-card-title">My Profile</span>
              <span className="info-card-icon" style={{ background: '#f3e5f5' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7b1fa2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              </span>
            </div>
            <div className="info-card-body">
              <span className="info-card-value">View Profile</span>
              <span className="info-card-sub">Personal details & settings</span>
            </div>
          </button>
        )
      case 'payslips':
        return (
          <button key={key} className="info-card" onClick={() => navigate('/payslips')}>
            <div className="info-card-head">
              <span className="info-card-title">Payslips</span>
              <span className="info-card-icon" style={{ background: '#e8eaf6' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#303f9f" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
              </span>
            </div>
            <div className="info-card-body">
              {lastPayslip ? (
                <>
                  <span className="info-card-value" style={{ color: '#303f9f' }}>&pound;{Math.round(lastPayslip.net_pay)}</span>
                  <span className="info-card-sub" style={{ color: '#303f9f' }}>{lastPayslip.month}</span>
                </>
              ) : (
                <>
                  <span className="info-card-value">Payslips</span>
                  <span className="info-card-sub">Salary & payment history</span>
                </>
              )}
            </div>
          </button>
        )
      case 'kudos':
        return (
          <button key={key} className="info-card" onClick={() => navigate('/kudos')}>
            <div className="info-card-head">
              <span className="info-card-title">Kudos</span>
              <span className="info-card-icon" style={{ background: '#eceff1' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#546e7a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
              </span>
            </div>
            <div className="info-card-body">
              {kudosUnread > 0 ? (
                <>
                  <span className="info-card-value">{kudosUnread} <span className="info-card-value-unit">new</span></span>
                  <div className="info-card-status info-card-status-ok"><span className="info-card-dot" />Unread recognitions</div>
                </>
              ) : lastKudos ? (
                <>
                  <span className="info-card-value" style={{ fontSize: 13, color: '#546e7a' }}>{lastKudos.message.length > 35 ? lastKudos.message.slice(0, 35) + '…' : lastKudos.message || 'Recognition received'}</span>
                  {lastKudos.from_name && <span className="info-card-sub">From {lastKudos.from_name}</span>}
                </>
              ) : (
                <>
                  <span className="info-card-value">Kudos</span>
                  <span className="info-card-sub">Give & receive recognition</span>
                </>
              )}
            </div>
          </button>
        )
      case 'performance':
        return (
          <button key={key} className="info-card" onClick={() => navigate('/one-to-ones')}>
            <div className="info-card-head">
              <span className="info-card-title">1:1 Meetings</span>
              <span className="info-card-icon" style={{ background: '#fce4ec' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#c2185b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              </span>
            </div>
            <div className="info-card-body">
              {nextMeeting ? (
                <>
                  <span className="info-card-value">{nextMeeting.label}</span>
                  <span className="info-card-sub" style={nextMeeting.label === 'Next' ? { color: '#1565c0', fontWeight: 600 } : undefined}>{new Date(nextMeeting.scheduled_date + 'T00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} at {nextMeeting.scheduled_time?.slice(0, 5)}</span>
                </>
              ) : (
                <>
                  <span className="info-card-value">1:1 Meetings</span>
                  <span className="info-card-sub">No meetings scheduled</span>
                </>
              )}
            </div>
          </button>
        )
      case 'elearning':
        return (
          <button key={key} className="info-card" onClick={() => navigate('/elearning')}>
            <div className="info-card-head">
              <span className="info-card-title">E-Learning</span>
              <span className="info-card-icon" style={{ background: '#fff9c4' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f9a825" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c0 1.1 2.7 3 6 3s6-1.9 6-3v-5"/></svg>
              </span>
            </div>
            <div className="info-card-body">
              {nextElearning ? (
                <>
                  <span className="info-card-value" style={{ fontSize: 14 }}>{nextElearning.title}</span>
                  {nextElearning.deadline ? (
                    <div className="info-card-status info-card-status-warn"><span className="info-card-dot" />Due {new Date(nextElearning.deadline).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</div>
                  ) : (
                    <span className="info-card-sub" style={{ color: '#f9a825' }}>Required</span>
                  )}
                </>
              ) : (
                <>
                  <span className="info-card-value" style={{ fontSize: 14, color: '#43a047' }}>No courses outstanding</span>
                  <span className="info-card-sub">All up to date</span>
                </>
              )}
            </div>
          </button>
        )
      case 'benefits':
        return (
          <button key={key} className="info-card" onClick={() => navigate('/benefits')}>
            <div className="info-card-head">
              <span className="info-card-title">Benefits</span>
              <span className="info-card-icon" style={{ background: '#e0f7fa' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00897b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>
              </span>
            </div>
            <div className="info-card-body">
              {latestBenefit ? (
                <>
                  <span className="info-card-value" style={{ fontSize: 14 }}>{latestBenefit.name}</span>
                  <div className="info-card-status info-card-status-ok"><span className="info-card-dot" />Subscribed</div>
                </>
              ) : (
                <>
                  <span className="info-card-value">Benefits</span>
                  <span className="info-card-sub">No subscriptions</span>
                </>
              )}
            </div>
          </button>
        )
      case 'timesheets':
        return (
          <button key={key} className="info-card" onClick={() => navigate('/timesheets')}>
            <div className="info-card-head">
              <span className="info-card-title">Timesheets</span>
              <span className="info-card-icon" style={{ background: '#e3f2fd' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1565c0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              </span>
            </div>
            <div className="info-card-body">
              {tsHoursThisWeek !== null || lastTimesheet ? (
                <>
                  {tsHoursThisWeek !== null ? (
                    <span className="info-card-value" style={{ color: tsExpectedHours - tsHoursThisWeek > 0 ? '#e65100' : '#43a047' }}>{Math.max(0, tsExpectedHours - tsHoursThisWeek).toFixed(1)}h <span className="info-card-value-unit">to book</span></span>
                  ) : lastTimesheet ? (
                    <span className="info-card-value" style={{ color: '#1565c0' }}>{lastTimesheet.hours}h</span>
                  ) : null}
                  {lastTimesheet ? (
                    <span className="info-card-sub" style={{ color: '#1565c0' }}>Last: {new Date(lastTimesheet.date + 'T00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ({lastTimesheet.hours}h)</span>
                  ) : (
                    <span className="info-card-sub">{tsHoursThisWeek!.toFixed(1)}h logged this week</span>
                  )}
                </>
              ) : (
                <>
                  <span className="info-card-value">Timesheets</span>
                  <span className="info-card-sub">Log & view hours</span>
                </>
              )}
            </div>
          </button>
        )
      case 'shifts':
        return (
          <button key={key} className="info-card" onClick={() => navigate('/shifts')}>
            <div className="info-card-head">
              <span className="info-card-title">My Shifts</span>
              <span className="info-card-icon" style={{ background: '#fff3e0' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e65100" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/></svg>
              </span>
            </div>
            <div className="info-card-body">
              {nextShift ? (
                <>
                  <span className="info-card-value" style={{ fontSize: 14, color: '#e65100' }}>{nextShift.shift_name}</span>
                  {lastShiftWorked ? (
                    <span className="info-card-sub" style={{ color: '#e65100' }}>Last: {new Date(lastShiftWorked.date + 'T00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ({lastShiftWorked.hours}h)</span>
                  ) : (
                    <span className="info-card-sub">{new Date(nextShift.date + 'T00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} {nextShift.start_time?.slice(0, 5)}–{nextShift.end_time?.slice(0, 5)}</span>
                  )}
                </>
              ) : (
                <>
                  <span className="info-card-value">My Shifts</span>
                  <span className="info-card-sub">No upcoming shifts</span>
                </>
              )}
            </div>
          </button>
        )
      case 'space_booking':
        return (
          <button key={key} className="info-card" onClick={() => navigate('/space-booking')}>
            <div className="info-card-head">
              <span className="info-card-title">Space Booking</span>
              <span className="info-card-icon" style={{ background: '#eceff1' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#455a64" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
              </span>
            </div>
            <div className="info-card-body">
              {nextBooking ? (
                <>
                  <span className="info-card-value" style={{ fontSize: 14, color: '#2e7d32' }}>{nextBooking.space_name}</span>
                  <span className="info-card-sub">{new Date(nextBooking.booking_date + 'T00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}{nextBooking.start_time ? ` at ${nextBooking.start_time.slice(0, 5)}` : ''}</span>
                </>
              ) : (
                <>
                  <span className="info-card-value">No spaces booked</span>
                  <span className="info-card-sub">Tap to book a room or desk</span>
                </>
              )}
            </div>
          </button>
        )
      case 'legal_timesheets':
        return (
          <button key={key} className="info-card" onClick={() => navigate('/legal-timesheets')}>
            <div className="info-card-head">
              <span className="info-card-title">Legal Timesheets</span>
              <span className="info-card-icon" style={{ background: '#e0f2f1' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00695c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
              </span>
            </div>
            <div className="info-card-body">
              {latestLegalTs ? (
                <>
                  <span className="info-card-value" style={{ fontSize: 14 }}>{Number(latestLegalTs.duration_hrs).toFixed(2)}h — {latestLegalTs.status}</span>
                  <span className="info-card-sub">{new Date(latestLegalTs.date + 'T00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                </>
              ) : (
                <>
                  <span className="info-card-value">Legal Timesheets</span>
                  <span className="info-card-sub">No entries yet</span>
                </>
              )}
            </div>
          </button>
        )
      case 'asset_management':
        return (
          <button key={key} className="info-card" onClick={() => navigate('/my-profile')}>
            <div className="info-card-head">
              <span className="info-card-title">My Assets</span>
              <span className="info-card-icon" style={{ background: '#e8eaf6' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3949ab" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 7V5a4 4 0 0 0-8 0v2"/></svg>
              </span>
            </div>
            <div className="info-card-body">
              {latestAsset ? (
                <>
                  <span className="info-card-value" style={{ fontSize: 14, color: '#3949ab' }}>{latestAsset.asset_name}</span>
                  <span className="info-card-sub" style={{ color: '#5c6bc0' }}>{latestAsset.asset_type}</span>
                </>
              ) : (
                <>
                  <span className="info-card-value">My Assets</span>
                  <span className="info-card-sub">No assets assigned</span>
                </>
              )}
            </div>
          </button>
        )
      case 'skills_passport':
        return (
          <button key={key} className="info-card" onClick={() => navigate('/skills-passport')}>
            <div className="info-card-head">
              <span className="info-card-title">Skills Passport</span>
              <span className="info-card-icon" style={{ background: '#fce4ec' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ad1457" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
              </span>
            </div>
            <div className="info-card-body">
              {latestSkill ? (
                <>
                  <span className="info-card-value" style={{ fontSize: 14, color: '#ad1457' }}>{latestSkill.name}</span>
                  <span className="info-card-sub">Latest {latestSkill.kind}</span>
                </>
              ) : (
                <>
                  <span className="info-card-value">Skills Passport</span>
                  <span className="info-card-sub">Add your skills</span>
                </>
              )}
            </div>
          </button>
        )
      case 'surveys':
        return (
          <button key={key} className="info-card" onClick={() => navigate('/surveys')}>
            <div className="info-card-head">
              <span className="info-card-title">Surveys</span>
              <span className="info-card-icon" style={{ background: '#ede9fe' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6d28d9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
              </span>
            </div>
            <div className="info-card-body">
              {surveyOutstanding > 0 ? (
                <>
                  <span className="info-card-value" style={{ color: '#6d28d9' }}>{surveyOutstanding} outstanding</span>
                  <span className="info-card-sub">{surveyCompleted} completed</span>
                </>
              ) : (
                <>
                  <span className="info-card-value" style={{ color: '#6d28d9' }}>{surveyCompleted > 0 ? `${surveyCompleted} completed` : 'Surveys'}</span>
                  <span className="info-card-sub">{surveyCompleted > 0 ? 'All caught up!' : 'No surveys assigned'}</span>
                </>
              )}
            </div>
          </button>
        )
      case 'notifications':
        return (
          <button key={key} className="info-card" onClick={() => navigate('/notifications')}>
            <div className="info-card-head">
              <span className="info-card-title">My Notifications</span>
              <span className="info-card-icon" style={{ background: '#e3f2fd' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1565c0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
              </span>
            </div>
            <div className="info-card-body">
              {latestNotif ? (
                <>
                  <span className="info-card-value" style={{ fontSize: 13, color: '#1565c0' }}>{latestNotif.title.length > 28 ? latestNotif.title.slice(0, 28) + '…' : latestNotif.title}</span>
                  <span className="info-card-sub">{new Date(latestNotif.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                </>
              ) : (
                <>
                  <span className="info-card-value">Notifications</span>
                  <span className="info-card-sub">No notifications yet</span>
                </>
              )}
            </div>
          </button>
        )
      default:
        return null
    }
  }

  const isShiftWorker = workPatternType === 'variable'
  const quickMenuItems: { label: string; path: string; icon: ReactNode }[] = (() => {
    const items: { label: string; path: string; icon: ReactNode; featureKey: string | null; pattern?: 'fixed' | 'variable' }[] = [
      { label: 'My Profile', path: '/my-profile', featureKey: null, icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> },
      { label: 'Leave', path: '/leave', featureKey: 'leave', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> },
      { label: 'Expenses', path: '/expenses', featureKey: 'expenses', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> },
      { label: 'Payslips', path: '/payslips', featureKey: 'payslips', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg> },
      { label: 'Timesheets', path: '/timesheets', featureKey: 'timesheets', pattern: 'fixed', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg> },
      { label: 'Shifts & Rotas', path: '/shifts', featureKey: 'shifts', pattern: 'variable', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg> },
      { label: 'Performance', path: '/one-to-ones', featureKey: 'performance', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg> },
      { label: 'E-Learning', path: '/elearning', featureKey: 'elearning', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg> },
      { label: 'Kudos', path: '/kudos', featureKey: 'kudos', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> },
      { label: 'Benefits', path: '/benefits', featureKey: 'benefits', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"/></svg> },
      { label: 'Space Booking', path: '/space-booking', featureKey: 'space_booking', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg> },
      { label: 'Legal Timesheets', path: '/legal-timesheets', featureKey: 'legal_timesheets', pattern: 'fixed', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> },
      { label: 'Skills Passport', path: '/skills-passport', featureKey: 'skills_passport', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg> },
      { label: 'Surveys', path: '/surveys', featureKey: 'surveys', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg> },
      { label: 'Notifications', path: '/notifications', featureKey: null, icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg> },
      { label: 'Directory', path: '/directory', featureKey: null, icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> },
      { label: 'Settings', path: '/settings', featureKey: null, icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> },
    ]
    return items.filter(i => {
      if (i.featureKey && !(features as any)[i.featureKey]) return false
      if (!isSuperAdmin && i.pattern === 'variable' && !isShiftWorker) return false
      if (!isSuperAdmin && i.pattern === 'fixed' && isShiftWorker) return false
      return true
    })
  })()

  if (isDesktop && dashPref === 'detailed') {
    return <DashboardDetailed />
  }

  return (
    <div className={`dashboard${dashMode === 'plain' ? ' plain-simple' : ''}`} onClick={() => quickMenuOpen && setQuickMenuOpen(false)}>
      <header className="dash-header">
        <div className="header-avatar" onClick={() => navigate('/my-profile')}>
          {avatarUrl ? (
            <img className="header-avatar-img" src={avatarUrl} alt={employeeName || ''} />
          ) : (
            <span className="header-avatar-initials">{(employeeName || '').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}</span>
          )}
        </div>
        <div className="header-center">
          {company?.logo_url ? (
            <img className="company-logo-img" src={company.logo_url} alt={company.name} />
          ) : (
            <span className="logo-text">InflowHR</span>
          )}
          <p className="header-date">{getDateString(lang)}</p>
        </div>
        <div style={{ position: 'relative' }}>
          <button
            className="dash-quick-menu-btn"
            onClick={(e) => { e.stopPropagation(); setQuickMenuOpen(v => !v) }}
            aria-label="Quick navigation"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          {quickMenuOpen && (
            <div className="dash-quick-menu dash-quick-menu-right" onClick={(e) => e.stopPropagation()}>
              {quickMenuItems.map(item => (
                <button
                  key={item.path}
                  className="dash-quick-menu-item"
                  onClick={() => { setQuickMenuOpen(false); navigate(item.path) }}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      {activeCheckin && (() => {
        const mins = Math.floor((Date.now() - new Date(activeCheckin.check_in_at).getTime()) / 60000)
        const h = Math.floor(mins / 60); const m = mins % 60
        const onBreak = !!activeBreak
        const isShift = activeCheckin.source === 'shifts'
        const sourceLabel = isShift ? 'Shift' : 'Timesheet'
        const bannerBg = isShift ? (onBreak ? '#d97706' : '#e65100') : undefined
        return (
          <div
            className={`dash-checkin-banner${onBreak && !isShift ? ' dash-checkin-break' : ''}`}
            style={bannerBg ? { background: bannerBg } : undefined}
            onClick={() => navigate(isShift ? '/shifts/checkin' : '/timesheets/checkin')}
          >
            <div className="dash-checkin-banner-info">
              <span className={`dash-checkin-dot${onBreak ? ' dash-checkin-dot-break' : ''}`} />
              <span className="dash-checkin-banner-text">
                {sourceLabel} · {onBreak ? 'Break' : 'In'} {new Date(activeCheckin.check_in_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} ({h}h{m > 0 ? ` ${m}m` : ''})
              </span>
            </div>
            <div className="dash-checkin-banner-actions">
              {onBreak ? (
                <>
                  <button className="dash-checkout-btn dash-end-break-btn" onClick={async (e) => { e.stopPropagation(); const r = await endBreak(); if (!r.ok) alert(r.error) }}>End Break</button>
                  <button className="dash-checkout-btn" onClick={async (e) => { e.stopPropagation(); const r = await checkOut(); if (!r.ok) alert(r.error) }}>Out</button>
                </>
              ) : (
                <>
                  <button className="dash-checkout-btn dash-break-btn" onClick={async (e) => { e.stopPropagation(); const r = await startBreak('lunch'); if (!r.ok) alert(r.error) }}>Break</button>
                  <button className="dash-checkout-btn" onClick={async (e) => { e.stopPropagation(); const r = await checkOut(); if (!r.ok) alert(r.error) }}>Out</button>
                </>
              )}
            </div>
          </div>
        )
      })()}

      {!activeCheckin && (ciSettings?.timesheets_checkin_enabled || ciSettings?.shifts_checkin_enabled) && (() => {
        const tsOn = ciSettings?.timesheets_checkin_enabled
        const shiftOn = ciSettings?.shifts_checkin_enabled
        const clockIcon = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" style={{ flexShrink: 0 }}><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        if (tsOn && shiftOn) {
          return (
            <div className="dash-checkin-banner" style={{ background: '#64748b' }}>
              <div className="dash-checkin-banner-info">
                {clockIcon}
              </div>
              <div className="dash-checkin-banner-actions">
                <button className="dash-checkout-btn" onClick={() => navigate('/timesheets/checkin')}>Timesheet</button>
                <button className="dash-checkout-btn" style={{ background: 'rgba(230,81,0,0.6)' }} onClick={() => navigate('/shifts/checkin')}>Shift</button>
                {reminderCount > 0 && (
                  <button className="dash-reminder-pill" onClick={() => navigate('/notifications', { state: { tab: 'notifications', expandReminders: true } })}>
                    {reminderCount} reminder{reminderCount !== 1 ? 's' : ''}
                  </button>
                )}
              </div>
            </div>
          )
        }
        const shiftOnly = !tsOn && shiftOn
        return (
          <div className="dash-checkin-banner" style={{ background: shiftOnly ? '#e65100' : '#64748b', cursor: 'pointer' }}
            onClick={() => navigate(shiftOnly ? '/shifts/checkin' : '/timesheets/checkin')}>
            <div className="dash-checkin-banner-info">
              {clockIcon}
              <span className="dash-checkin-banner-text">{shiftOnly ? 'Shift' : 'Timesheet'}</span>
            </div>
            <div className="dash-checkin-banner-actions">
              {reminderCount > 0 && (
                <button className="dash-reminder-pill" onClick={(e) => { e.stopPropagation(); navigate('/notifications', { state: { tab: 'notifications', expandReminders: true } }) }}>
                  {reminderCount} reminder{reminderCount !== 1 ? 's' : ''}
                </button>
              )}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M9 18l6-6-6-6"/></svg>
            </div>
          </div>
        )
      })()}

      {(() => {
        const checkinEnabled = !activeCheckin && (ciSettings?.timesheets_checkin_enabled || ciSettings?.shifts_checkin_enabled)
        const showReminderStandalone = reminderCount > 0 && !checkinEnabled
        const themeLogoutIcons = (
          <span className="dash-desktop-only">
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
          </span>
        )

        if (!checkinEnabled && !activeCheckin) {
          return (
            <>
              <div className="greeting-row">
                <h2 className="greeting">{greeting} {'\u{1F44B}'} <span style={{ whiteSpace: 'nowrap' }}>{employeeName}</span></h2>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {showReminderStandalone && (
                    <button className="dash-reminder-pill" onClick={() => navigate('/notifications', { state: { tab: 'notifications', expandReminders: true } })}>
                      {reminderCount} reminder{reminderCount !== 1 ? 's' : ''}
                    </button>
                  )}
                  {themeLogoutIcons}
                </div>
              </div>
            </>
          )
        }

        return (
          <>
            {showReminderStandalone && (
              <div className="dash-status-bar">
                <button className="dash-reminder-pill" onClick={() => navigate('/notifications', { state: { tab: 'notifications', expandReminders: true } })}>
                  {reminderCount} reminder{reminderCount !== 1 ? 's' : ''}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
                </button>
              </div>
            )}
            <div className="greeting-row">
              <h2 className="greeting">{greeting} {'\u{1F44B}'} <span style={{ whiteSpace: 'nowrap' }}>{employeeName}</span></h2>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {themeLogoutIcons}
              </div>
            </div>
          </>
        )
      })()}

      {dashMode === 'info' ? (() => {
        const visibleCards = infoCardOrder.map(key => renderInfoCard(key)).filter(Boolean)
        const hasMore = visibleCards.length > 4
        const displayCards = cardsExpanded ? visibleCards : visibleCards.slice(0, 4)
        return (
          <>
            <div className="info-card-grid">
              {displayCards}
            </div>
            {hasMore && (
              <button className="info-cards-expand" onClick={() => setCardsExpanded(v => !v)}>
                <span>{cardsExpanded ? 'Show less' : `Show all (${visibleCards.length})`}</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: cardsExpanded ? 'rotate(180deg)' : undefined, transition: 'transform 0.2s' }}><path d="M6 9l6 6 6-6"/></svg>
              </button>
            )}

            {features.surveys && surveyOutstanding > 0 && (
              <div className="dash-survey-reminder" onClick={() => navigate('/surveys')}>
                <div className="dash-survey-reminder-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                </div>
                <div className="dash-survey-reminder-text">
                  <strong>You have {surveyOutstanding} outstanding survey{surveyOutstanding !== 1 ? 's' : ''}</strong>
                  <span>Please complete your assigned surveys</span>
                </div>
                <span className="dash-survey-reminder-badge">{surveyOutstanding}</span>
                <svg className="dash-survey-reminder-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>
              </div>
            )}

            {announcements.length > 0 && (
              <div className="info-section">
                <div className="info-section-card">
                  <div className="info-section-head">
                    <span className="info-section-title">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
                      Company Announcements
                    </span>
                    <button className="info-section-viewall" onClick={() => navigate('/notifications', { state: { tab: 'company' } })}>View All <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg></button>
                  </div>
                  <button className="info-card-announce-item" onClick={() => navigate('/notifications', { state: { tab: 'company' } })}>
                    <span className="info-card-announce-row">
                      <span className="info-card-announce-title">{announcements[0].title}</span>
                      {announcements[0].priority && <span className={`info-card-announce-priority info-card-announce-priority--${announcements[0].priority}`}>{announcements[0].priority === 'high' ? 'High' : announcements[0].priority === 'medium' ? 'Medium' : 'Low'}</span>}
                    </span>
                    <span className="info-card-announce-text">{announcements[0].body?.length > 80 ? announcements[0].body.slice(0, 80) + '...' : announcements[0].body}</span>
                    {announcements[0].published_at && <span className="info-card-announce-date"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> {new Date(announcements[0].published_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>}
                  </button>
                </div>
              </div>
            )}

            {latestTasks.length > 0 && (
              <div className="info-section">
                <div className="info-section-card">
                  <div className="info-section-head">
                    <span className="info-section-title">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                      My Tasks
                    </span>
                    <button className="info-section-viewall" onClick={() => navigate('/notifications')}>View All <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg></button>
                  </div>
                  {latestTasks.map(t => {
                    const nav = t.record_type === 'Leave' ? '/leave' : t.record_type === 'Expense' ? '/expenses' : t.record_type === 'Timesheet' ? '/timesheets' : t.record_type === 'Meeting Reminder' ? '/one-to-ones' : '/notifications'
                    const label = t.record_type === 'Leave' ? (t.task_description?.split(' - ')[0] || 'Leave') + ' Request'
                      : t.record_type === 'Expense' ? 'Expense Claim'
                      : t.record_type === 'Timesheet' ? 'Timesheet Review'
                      : t.record_type === 'Conflict' ? 'Leave/Shift Conflict'
                      : t.record_type === 'Missed Check-In' ? 'Missed Check-In'
                      : t.record_type === 'Meeting Reminder' ? '1:1 Meeting — Tomorrow'
                      : t.action
                    const detail = t.record_type === 'Leave' ? t.task_description?.split(' - ').slice(1).join(' - ')
                      : t.record_type === 'Expense' ? t.task_description
                      : t.record_type === 'Conflict' ? t.task_description
                      : t.record_type === 'Missed Check-In' ? t.task_description
                      : t.record_type === 'Meeting Reminder' ? t.task_description
                      : null
                    return (
                      <button key={t.id} className="info-card-task-line" onClick={() => navigate(nav)}>
                        <span className="info-card-task-line-text">
                          <span className="task-status-dot" />
                          {label}
                        </span>
                        {detail && <span className="info-card-task-line-detail">{detail}</span>}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {features.shifts && openShifts.length > 0 && (
              <div className="info-section">
                <div className="info-section-card">
                  <div className="info-section-head">
                    <span className="info-section-title">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#e65100" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                      Open Shifts
                      <span className="info-section-badge">{openShifts.length}</span>
                    </span>
                    <button className="info-section-viewall" onClick={() => navigate('/shifts')}>View All <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg></button>
                  </div>
                  {openShifts.map(s => {
                    const d = new Date(s.date + 'T00:00:00')
                    return (
                      <button key={s.id} className="info-card-shift-item" onClick={() => navigate('/shifts')}>
                        <div className="info-card-shift-date">
                          <span className="info-card-shift-day">{d.getDate()}</span>
                          <span className="info-card-shift-month">{d.toLocaleDateString('en-GB', { month: 'short' }).toUpperCase()}</span>
                        </div>
                        <div className="info-card-shift-details">
                          <span className="info-card-shift-time">{s.shift_template?.[0]?.start_time?.slice(0, 5) || '--:--'} – {s.shift_template?.[0]?.end_time?.slice(0, 5) || '--:--'}</span>
                          <span className="info-card-shift-role">{s.shift_template?.[0]?.name || 'Open Shift'}</span>
                        </div>
                        <span className="info-card-shift-badge">Available</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        )
      })() : (
        <div className={`card-grid${dashboardStyle === 'slim' ? ' card-grid-slim' : ''}`}>
          {features.expenses && (
            <button className="dash-card card-expenses" onClick={() => navigate('/expenses')}>
              <div className="card-content">
                <span className="card-label">{t('dashboard.expenses')}</span>
                <span className="card-value">&pound;{lastExpense !== null ? lastExpense.toFixed(2) : '--'}{lastExpenseHasReceipt && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#43a047" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 4, verticalAlign: 'middle' }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>}</span>
                <span className="card-sub">{t('dashboard.last_claim')}</span>
                {pendingExpense !== null && (
                  <span className="card-sub card-expense-pending">&pound;{pendingExpense.toFixed(2)} {t('dashboard.pending')}</span>
                )}
              </div>
              <Chevron color="#c62828" />
            </button>
          )}
          {features.leave && (
            <button className="dash-card card-leave" onClick={() => navigate('/leave')}>
              <div className="card-content">
                <span className="card-label">{t('dashboard.leave_remaining')}</span>
                <span className="card-value card-value-large">{leaveRemaining !== null ? leaveRemaining : '--'} <span className="card-value-unit">{t('dashboard.days')}</span></span>
                {leavePending !== null && leavePending > 0 && (
                  <span className="card-sub card-leave-pending">{leavePending} {t('dashboard.days_pending')}</span>
                )}
              </div>
              <Chevron color="#2e7d32" />
            </button>
          )}
          {features.profile && (
            <button className="dash-card card-profile" onClick={() => navigate('/my-profile')}>
              <div className="card-content">
                <span className="card-label">{t('dashboard.my_profile')}</span>
              </div>
              <Chevron color="#7b1fa2" />
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
              <Chevron color="#546e7a" />
            </button>
          )}
          {features.benefits && (
            <button className="dash-card card-benefits" onClick={() => navigate('/benefits')}>
              <div className="card-content">
                <span className="card-label">{t('dashboard.benefits')}</span>
              </div>
              <Chevron color="#80deea" />
            </button>
          )}
          {features.elearning && (
            <button className="dash-card card-elearning" onClick={() => navigate('/elearning')}>
              <div className="card-content">
                <span className="card-label">{t('dashboard.elearning')}</span>
              </div>
              <Chevron color="#f9a825" />
            </button>
          )}
          {features.performance && (
            <button className="dash-card card-performance" onClick={() => navigate('/one-to-ones')}>
              <div className="card-content">
                <span className="card-label">{t('one_to_one.nav_label')}</span>
              </div>
              {pendingOneToOnes > 0 && <span className="kudos-unread-badge">{pendingOneToOnes}</span>}
              <Chevron color="#ad1457" />
            </button>
          )}
          {features.timesheets && (
            <button className="dash-card card-timesheets" onClick={() => navigate('/timesheets')}>
              <div className="card-content">
                <span className="card-label">{t('dashboard.timesheets')}</span>
              </div>
              <Chevron color="#1565c0" />
            </button>
          )}
          {features.shifts && (
            <button className="dash-card card-shifts" onClick={() => navigate('/shifts')}>
              <div className="card-content">
                <span className="card-label">{t('dashboard.shifts')}</span>
              </div>
              <Chevron color="#e65100" />
            </button>
          )}
          {features.space_booking && (
            <button className="dash-card card-space-booking" onClick={() => navigate('/space-booking')}>
              <div className="card-content">
                <span className="card-label">{t('dashboard.space_booking')}</span>
              </div>
              <Chevron color="#263238" />
            </button>
          )}
          {features.legal_timesheets && (
            <button className="dash-card card-legal-ts" onClick={() => navigate('/legal-timesheets')}>
              <div className="card-content">
                <span className="card-label">{t('dashboard.legal_timesheets')}</span>
              </div>
              <Chevron color="#00695c" />
            </button>
          )}
          {features.surveys && (
            <button className="dash-card card-surveys" onClick={() => navigate('/surveys')}>
              <div className="card-content">
                <span className="card-label">Surveys</span>
              </div>
              <Chevron color="#6d28d9" />
            </button>
          )}
        </div>
      )}

      {dashMode !== 'info' && latest && (
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
