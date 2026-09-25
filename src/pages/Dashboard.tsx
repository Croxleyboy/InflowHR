import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTheme } from '../context/ThemeContext'
import { useFeatures } from '../context/FeatureContext'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'
import { useCheckIn } from '../context/CheckInContext'
import { supabase } from '../lib/supabase'
import { toLocalDateStr } from '../lib/formatters'
import Chevron from '../components/Chevron'
import { COURSES } from './ELearning'
import DashboardDetailed from './DashboardDetailed'

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

const INFO_CARD_KEYS = [
  'checkin', 'leave', 'expenses', 'documents', 'profile',
  'payslips', 'kudos', 'performance', 'elearning', 'benefits',
  'timesheets', 'shifts', 'space_booking', 'legal_timesheets',
  'asset_management', 'skills_passport',
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
  const { signOut, employeeId, employeeName, employeeEmail, company, avatarUrl, companyUser } = useAuth()
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
  const initials = employeeName.split(' ').map(n => n[0]).join('').toUpperCase() || '?'

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

  const [dashPref, setDashPref] = useState(localStorage.getItem('inflowhr-dashboard-layout') || 'cards')
  useEffect(() => {
    const handler = () => setDashPref(localStorage.getItem('inflowhr-dashboard-layout') || 'cards')
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [])

  useEffect(() => {
    if (companyUser?.company_id) {
      supabase.from('announcements')
        .select('title, body')
        .eq('company_id', companyUser.company_id)
        .order('published_at', { ascending: false })
        .limit(1)
        .single()
        .then(({ data }) => { if (data) setLatest(data as LatestAnnouncement) })
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
          try {
            const raw = localStorage.getItem('inflowhr-elearning')
            const progress = raw ? JSON.parse(raw) : { completed: [] }
            const completedSet = new Set(progress.completed || [])
            const thirtyDaysAhead = new Date(now); thirtyDaysAhead.setDate(thirtyDaysAhead.getDate() + 30)
            COURSES.forEach(course => {
              if (!course.deadline || completedSet.has(course.id)) return
              const dl = new Date(course.deadline)
              if (dl >= now && dl <= thirtyDaysAhead) count++
            })
          } catch {}
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
    }
  }, [employeeId, employeeEmail, companyUser?.company_id, features.elearning])

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
        return (
          <button key={key} className="info-card" onClick={() => navigate(activeCheckin?.source === 'shifts' ? '/shifts/checkin' : '/timesheets/checkin')}>
            <div className="info-card-head">
              <span className="info-card-title">Today's Status</span>
              <span className="info-card-icon" style={{ background: '#e8f5e9' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#43a047" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </span>
            </div>
            <div className="info-card-body">
              <span className="info-card-value">{isActive ? `Checked In` : 'Not Clocked In'}</span>
              {isActive ? (
                <div className={`info-card-status info-card-status-ok`}><span className="info-card-dot" />{elapsed} elapsed</div>
              ) : (
                <span className="info-card-sub">Tap to clock in</span>
              )}
            </div>
          </button>
        )
      }
      case 'leave':
        return (
          <button key={key} className="info-card" onClick={() => navigate('/leave')}>
            <div className="info-card-head">
              <span className="info-card-title">Leave Balance</span>
              <span className="info-card-icon" style={{ background: '#e8f5e9' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#43a047" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              </span>
            </div>
            <div className="info-card-body">
              <span className="info-card-value">{leaveRemaining !== null ? leaveRemaining : '--'} <span className="info-card-value-unit">days remaining</span></span>
              {leavePending !== null && leavePending > 0 && (
                <div className="info-card-status info-card-status-pending"><span className="info-card-dot" />{leavePending} request{leavePending !== 1 ? 's' : ''} pending</div>
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
              <span className="info-card-value">&pound;{lastExpense !== null ? lastExpense.toFixed(2) : '--'}</span>
              <span className="info-card-sub">Last approved claim</span>
              {pendingExpense !== null && (
                <div className="info-card-status info-card-status-pending"><span className="info-card-dot" />&pound;{pendingExpense.toFixed(2)} pending</div>
              )}
            </div>
          </button>
        )
      case 'documents':
        return (
          <button key={key} className="info-card" onClick={() => navigate('/my-profile')}>
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
              <span className="info-card-value">View Payslips</span>
              <span className="info-card-sub">Salary & payment history</span>
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
              {pendingOneToOnes > 0 ? (
                <>
                  <span className="info-card-value">{pendingOneToOnes} <span className="info-card-value-unit">pending</span></span>
                  <div className="info-card-status info-card-status-pending"><span className="info-card-dot" />Upcoming meetings</div>
                </>
              ) : (
                <>
                  <span className="info-card-value">1:1 Meetings</span>
                  <span className="info-card-sub">Schedule & review meetings</span>
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
              <span className="info-card-value">E-Learning</span>
              <span className="info-card-sub">Courses & training</span>
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
              <span className="info-card-value">Benefits</span>
              <span className="info-card-sub">Your company benefits</span>
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
              <span className="info-card-value">Timesheets</span>
              <span className="info-card-sub">Log & view hours</span>
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
              <span className="info-card-value">My Shifts</span>
              <span className="info-card-sub">View rota & availability</span>
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
              <span className="info-card-value">Book a Space</span>
              <span className="info-card-sub">Meeting rooms & desks</span>
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
              <span className="info-card-value">Legal Timesheets</span>
              <span className="info-card-sub">Billable hours & matters</span>
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
              <span className="info-card-value">My Assets</span>
              <span className="info-card-sub">Company equipment assigned to you</span>
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
              <span className="info-card-value">Skills Passport</span>
              <span className="info-card-sub">Your skills & endorsements</span>
            </div>
          </button>
        )
      default:
        return null
    }
  }

  if (isDesktop && dashPref === 'detailed') {
    return <DashboardDetailed />
  }

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
          {company?.logo_url ? (
            <img className="company-logo-img" src={company.logo_url} alt={company.name} />
          ) : (
            <span className="logo-text">InflowHR</span>
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

      {dashMode === 'info' ? (
        <div className="info-card-grid">
          {infoCardOrder.map(key => renderInfoCard(key))}
        </div>
      ) : (
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
        </div>
      )}

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
