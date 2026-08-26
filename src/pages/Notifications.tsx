import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'
import { useFeatures } from '../context/FeatureContext'
import { useToast } from '../context/ToastContext'
import { COURSES } from './ELearning'

type Tab = 'company' | 'actions' | 'notifications'

type ReminderType = 'birthday' | 'shift' | 'performance' | 'booking_desk' | 'booking_room' | 'elearning' | 'confirm_booking' | 'confirm_shift'

interface PersonalReminder {
  id: string
  type: ReminderType
  title: string
  subtitle: string
  date: string
  time?: string
  navigateTo?: string
}

interface WorkflowItem {
  id: number
  emp_display_name: string
  step: number
  status: string
  record_type: string
  action: string
  employee_email: string
  assigned_to: string
  approval_id: number | null
  task_description: string | null
  approval_status: string | null
  extra_info: string | null
  created_at: string
}

interface Announcement {
  id: string
  title: string
  body: string
  submitted_by_name: string | null
  published_at: string
}

interface SwapAction {
  id: string
  requesting_employee_id: string
  requester_name: string
  shift_date: string
  shift_name: string
  created_at: string
}


function formatNotifDate(dateStr: string) {
  const d = new Date(dateStr)
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const day = d.getDate()
  const suffix = day === 1 || day === 21 || day === 31 ? 'st' : day === 2 || day === 22 ? 'nd' : day === 3 || day === 23 ? 'rd' : 'th'
  return `${days[d.getDay()]}, ${day}${suffix} ${d.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase()}`
}

function NotifIcon({ type, status }: { type: string; status?: string | null }) {
  if (type === 'Birthday') {
    return (
      <div className="notif-icon notif-icon-birthday">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.5">
          <path d="M2 22h20v-6H2v6zM2 16l2-4h16l2 4" />
          <path d="M12 2c1 2 1 4 0 6M8 4c.5 1 .5 3 0 4M16 4c.5 1 .5 3 0 4" />
          <circle cx="12" cy="10" r="1" fill="#fff" />
          <circle cx="8" cy="10" r="1" fill="#fff" />
          <circle cx="16" cy="10" r="1" fill="#fff" />
        </svg>
      </div>
    )
  }
  if (type === 'Expense' && status === 'Approved') {
    return (
      <div className="notif-icon notif-icon-approved">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5">
          <path d="M20 6L9 17l-5-5" />
        </svg>
      </div>
    )
  }
  if (type === 'Expense' && status === 'Declined') {
    return (
      <div className="notif-icon notif-icon-declined">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </div>
    )
  }
  if (type === 'Leave' && status === 'Approved') {
    return (
      <div className="notif-icon notif-icon-leave-approved">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" />
          <path d="M9 14l2 2 4-4" />
        </svg>
      </div>
    )
  }
  if (type === 'Leave' && status === 'Declined') {
    return (
      <div className="notif-icon notif-icon-leave-declined">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" />
          <line x1="10" y1="12" x2="14" y2="16" /><line x1="14" y1="12" x2="10" y2="16" />
        </svg>
      </div>
    )
  }
  if (type === 'Expense') {
    return (
      <div className="notif-icon notif-icon-expense">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v12M9 9h6M9 15h6" />
        </svg>
      </div>
    )
  }
  if (type === 'Leave') {
    return (
      <div className="notif-icon notif-icon-leave">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      </div>
    )
  }
  if (type === 'Meeting') {
    return (
      <div className="notif-icon notif-icon-meeting">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      </div>
    )
  }
  if (type === 'Shift') {
    return (
      <div className="notif-icon notif-icon-shift">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
          <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
        </svg>
      </div>
    )
  }
  if (type === 'BookingDesk') {
    return (
      <div className="notif-icon notif-icon-booking-desk">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="7" width="20" height="3" rx="1" /><path d="M4 10v7" /><path d="M20 10v7" /><path d="M12 10v4" />
        </svg>
      </div>
    )
  }
  if (type === 'BookingRoom') {
    return (
      <div className="notif-icon notif-icon-booking-room">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 3h18v18H3z" /><path d="M3 9h18" /><path d="M9 3v18" />
        </svg>
      </div>
    )
  }
  if (type === 'ELearning') {
    return (
      <div className="notif-icon notif-icon-elearning">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
        </svg>
      </div>
    )
  }
  if (type === 'Performance') {
    return (
      <div className="notif-icon notif-icon-performance">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      </div>
    )
  }
  if (type === 'ConfirmBooking') {
    return (
      <div className="notif-icon notif-icon-confirm-booking">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5">
          <path d="M20 6L9 17l-5-5" />
        </svg>
      </div>
    )
  }
  if (type === 'ConfirmShift') {
    return (
      <div className="notif-icon notif-icon-confirm-shift">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
          <circle cx="12" cy="12" r="10" /><path d="M9 12l2 2 4-4" />
        </svg>
      </div>
    )
  }
  if (type === 'Skill Validation') {
    return (
      <div className="notif-icon notif-icon-skill-validation">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 12l2 2 4-4" /><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7z" />
        </svg>
      </div>
    )
  }
  if (type === 'Skills Mapping') {
    return (
      <div className="notif-icon notif-icon-skills-mapping">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
        </svg>
      </div>
    )
  }
  return (
    <div className="notif-icon notif-icon-default">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
    </div>
  )
}

export default function Notifications() {
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useLanguage()
  const { employeeId: HARDCODED_EMPLOYEE_ID, employeeEmail: HARDCODED_EMAIL, companyUser, isSuperAdmin, canPostNotifications: canPost } = useAuth()
  const { features } = useFeatures()
  const { showError, showSuccess } = useToast()
  const locState = location.state as { tab?: Tab; expandReminders?: boolean } | null
  const initialTab = locState?.tab || 'actions'
  const [tab, setTab] = useState<Tab>(initialTab)
  const [actions, setActions] = useState<WorkflowItem[]>([])
  const [skillActionItem, setSkillActionItem] = useState<WorkflowItem | null>(null)
  const [myNotifs, setMyNotifs] = useState<WorkflowItem[]>([])
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)
  const [swapActions, setSwapActions] = useState<SwapAction[]>([])
  const [expenseReceipts, setExpenseReceipts] = useState<Set<number>>(new Set())
  const [reminders, setReminders] = useState<PersonalReminder[]>([])
  const [remindersExpanded, setRemindersExpanded] = useState(locState?.expandReminders || false)
  const [notifSearch, setNotifSearch] = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    const companyId = companyUser?.company_id || ''
    const [actionsRes, notifsRes, announcementsRes] = await Promise.all([
      supabase.from('workflow_tracker')
        .select('*')
        .ilike('assigned_to', `%${HARDCODED_EMAIL}%`)
        .eq('status', 'Pending')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false }),
      supabase.from('workflow_tracker')
        .select('*')
        .or(`assigned_to.ilike.%${HARDCODED_EMAIL}%,employee_email.ilike.%${HARDCODED_EMAIL}%`)
        .eq('status', 'Complete')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(20),
      supabase.from('announcements')
        .select('id, title, body, submitted_by_name, published_at')
        .eq('company_id', companyUser?.company_id || '')
        .order('published_at', { ascending: false })
        .limit(20),
    ])
    if (actionsRes.data) setActions(actionsRes.data as WorkflowItem[])
    if (notifsRes.data) setMyNotifs(notifsRes.data as WorkflowItem[])
    if (announcementsRes.data) setAnnouncements(announcementsRes.data as Announcement[])

    if (HARDCODED_EMPLOYEE_ID && companyUser?.company_id) {
      const { data: swapData } = await supabase
        .from('shift_swap_requests')
        .select('id, requesting_employee_id, created_at, shift_assignment:shift_assignments(date, shift_template:shift_templates(name))')
        .eq('target_employee_id', HARDCODED_EMPLOYEE_ID)
        .eq('company_id', companyUser.company_id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })

      if (swapData) {
        const empIds = [...new Set(swapData.map((s: any) => s.requesting_employee_id))]
        const { data: empNames } = await supabase
          .from('employees')
          .select('id, first_name, last_name')
          .in('id', empIds)
          .eq('company_id', companyUser?.company_id)
        const nameMap: Record<string, string> = {}
        ;(empNames || []).forEach((e: any) => { nameMap[e.id] = `${e.first_name} ${e.last_name}` })

        setSwapActions(swapData.map((s: any) => ({
          id: s.id,
          requesting_employee_id: s.requesting_employee_id,
          requester_name: nameMap[s.requesting_employee_id] || '—',
          shift_date: s.shift_assignment?.date || '',
          shift_name: s.shift_assignment?.shift_template?.name || 'Shift',
          created_at: s.created_at,
        })))
      }
    }

    const allItems = [...(actionsRes.data || []), ...(notifsRes.data || [])] as WorkflowItem[]
    const expenseIds = allItems
      .filter(i => i.record_type === 'Expense' && i.approval_id)
      .map(i => i.approval_id as number)
    const uniqueExpenseIds = [...new Set(expenseIds)]
    if (uniqueExpenseIds.length > 0) {
      const { data: receiptRows } = await supabase
        .from('expense_line_items')
        .select('expense_claim_id')
        .in('expense_claim_id', uniqueExpenseIds)
        .eq('company_id', companyUser?.company_id)
        .not('receipt_url', 'is', null)
      if (receiptRows) setExpenseReceipts(new Set(receiptRows.map((r: { expense_claim_id: number }) => r.expense_claim_id)))
    }

    // ── Personal reminders ──
    const personalReminders: PersonalReminder[] = []
    const todayDate = new Date()
    const todayStr = todayDate.toISOString().split('T')[0]
    const weekAhead = new Date(todayDate)
    weekAhead.setDate(weekAhead.getDate() + 7)
    const weekAheadStr = weekAhead.toISOString().split('T')[0]

    // Birthdays — colleagues with birthday in next 7 days
    if (HARDCODED_EMPLOYEE_ID && companyId) {
      const { data: colleagues } = await supabase
        .from('employees')
        .select('id, first_name, last_name, date_of_birth')
        .eq('company_id', companyId)
        .eq('is_active', true)
        .not('date_of_birth', 'is', null)

      if (colleagues) {
        const thisYear = todayDate.getFullYear()
        colleagues.forEach((c: { id: string; first_name: string; last_name: string; date_of_birth: string | null }) => {
          if (!c.date_of_birth || c.id === HARDCODED_EMPLOYEE_ID) return
          const dob = new Date(c.date_of_birth)
          const birthdayThisYear = new Date(thisYear, dob.getMonth(), dob.getDate())
          if (birthdayThisYear < todayDate) birthdayThisYear.setFullYear(thisYear + 1)
          const diffDays = Math.floor((birthdayThisYear.getTime() - todayDate.getTime()) / 86400000)
          if (diffDays >= 0 && diffDays <= 7) {
            const dateStr = birthdayThisYear.toISOString().split('T')[0]
            personalReminders.push({
              id: `bday-${c.id}`,
              type: 'birthday',
              title: diffDays === 0
                ? `It's ${c.first_name} ${c.last_name}'s birthday today!`
                : `${c.first_name} ${c.last_name}'s birthday in ${diffDays} day${diffDays > 1 ? 's' : ''}`,
              subtitle: `${new Date(dateStr).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}`,
              date: dateStr,
            })
          }
        })
      }
    }

    // Upcoming shifts — next 7 days
    if (HARDCODED_EMPLOYEE_ID && companyId) {
      const { data: upcomingShifts } = await supabase
        .from('shift_assignments')
        .select('id, date, shift_template:shift_templates(name, start_time, end_time), rota:rotas(name, status)')
        .eq('employee_id', HARDCODED_EMPLOYEE_ID)
        .eq('company_id', companyId)
        .gte('date', todayStr)
        .lte('date', weekAheadStr)

      if (upcomingShifts) {
        upcomingShifts
          .filter((s: any) => s.rota?.status === 'published')
          .forEach((s: any) => {
            const shiftName = s.shift_template?.name || 'Shift'
            const startTime = s.shift_template?.start_time?.slice(0, 5) || ''
            const endTime = s.shift_template?.end_time?.slice(0, 5) || ''
            const dateLabel = new Date(s.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
            personalReminders.push({
              id: `shift-${s.id}`,
              type: 'shift',
              title: `Upcoming shift: ${shiftName}`,
              subtitle: `${dateLabel}${startTime ? ` · ${startTime} – ${endTime}` : ''}`,
              date: s.date,
              navigateTo: '/shifts',
            })
          })
      }
    }

    // Performance meetings — upcoming one-to-ones in next 14 days
    if (HARDCODED_EMPLOYEE_ID && companyId) {
      const twoWeeksAhead = new Date(todayDate)
      twoWeeksAhead.setDate(twoWeeksAhead.getDate() + 14)
      const { data: meetings } = await supabase
        .from('one_to_one_meetings')
        .select('id, scheduled_date, scheduled_time, status, manager_id, employee_id')
        .eq('company_id', companyId)
        .or(`manager_id.eq.${HARDCODED_EMPLOYEE_ID},employee_id.eq.${HARDCODED_EMPLOYEE_ID}`)
        .in('status', ['pending', 'accepted'])
        .gte('scheduled_date', todayStr)
        .lte('scheduled_date', twoWeeksAhead.toISOString().split('T')[0])

      if (meetings && meetings.length > 0) {
        const otherIds = [...new Set(meetings.map((m: any) => m.manager_id === HARDCODED_EMPLOYEE_ID ? m.employee_id : m.manager_id))]
        const { data: empNames } = await supabase
          .from('employees')
          .select('id, first_name, last_name')
          .in('id', otherIds)
          .eq('company_id', companyId)
        const nameMap: Record<string, string> = {}
        ;(empNames || []).forEach((e: any) => { nameMap[e.id] = `${e.first_name} ${e.last_name}` })

        meetings.forEach((m: any) => {
          const otherId = m.manager_id === HARDCODED_EMPLOYEE_ID ? m.employee_id : m.manager_id
          const otherName = nameMap[otherId] || 'colleague'
          const dateLabel = new Date(m.scheduled_date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
          personalReminders.push({
            id: `perf-${m.id}`,
            type: 'performance',
            title: `1-to-1 meeting with ${otherName}`,
            subtitle: `${dateLabel}${m.scheduled_time ? ` at ${m.scheduled_time.slice(0, 5)}` : ''} · ${m.status}`,
            date: m.scheduled_date,
            time: m.scheduled_time?.slice(0, 5) || undefined,
            navigateTo: `/one-to-ones/${m.id}`,
          })
        })
      }
    }

    // Space bookings — upcoming confirmed desk & room bookings
    if (HARDCODED_EMPLOYEE_ID && companyId) {
      const { data: upcomingBookings } = await supabase
        .from('space_bookings')
        .select('id, booking_date, start_time, end_time, title, status, space:spaces(name, space_type)')
        .eq('employee_id', HARDCODED_EMPLOYEE_ID)
        .eq('company_id', companyId)
        .gte('booking_date', todayStr)
        .lte('booking_date', weekAheadStr)
        .in('status', ['confirmed', 'checked_in'])

      if (upcomingBookings) {
        upcomingBookings.forEach((b: any) => {
          const spaceName = b.space?.name || 'Space'
          const spaceType = b.space?.space_type || 'desk'
          const dateLabel = new Date(b.booking_date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
          const timeStr = b.start_time && b.end_time ? ` · ${b.start_time.slice(0, 5)} – ${b.end_time.slice(0, 5)}` : ''
          personalReminders.push({
            id: `booking-${b.id}`,
            type: spaceType === 'room' ? 'booking_room' : 'booking_desk',
            title: `${spaceType === 'room' ? 'Room' : 'Desk'} booking: ${spaceName}`,
            subtitle: `${dateLabel}${timeStr}${b.title ? ` · ${b.title}` : ''}`,
            date: b.booking_date,
            navigateTo: '/space-booking',
          })
        })
      }
    }

    // E-learning — courses with deadlines expiring in next 30 days
    if (features.elearning) {
      const elearningKey = 'inflowhr-elearning'
      try {
        const raw = localStorage.getItem(elearningKey)
        const progress = raw ? JSON.parse(raw) : { completed: [] }
        const completedSet = new Set(progress.completed || [])
        const thirtyDaysAhead = new Date(todayDate)
        thirtyDaysAhead.setDate(thirtyDaysAhead.getDate() + 30)

        COURSES.forEach(course => {
          if (!course.deadline || completedSet.has(course.id)) return
          const deadlineDate = new Date(course.deadline)
          if (deadlineDate >= todayDate && deadlineDate <= thirtyDaysAhead) {
            const daysLeft = Math.floor((deadlineDate.getTime() - todayDate.getTime()) / 86400000)
            personalReminders.push({
              id: `elearn-${course.id}`,
              type: 'elearning',
              title: daysLeft <= 7
                ? `Course expiring soon: ${course.id.replace(/^[a-z]+-/, '').replace(/-/g, ' ')}`
                : `Course deadline approaching`,
              subtitle: `Due ${deadlineDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} (${daysLeft} day${daysLeft !== 1 ? 's' : ''} left) · ${course.duration}`,
              date: course.deadline,
              navigateTo: `/elearning?course=${course.id}`,
            })
          }
        })
      } catch {}
    }

    // Booking confirmations — bookings confirmed in last 3 days
    if (HARDCODED_EMPLOYEE_ID && companyId) {
      const threeDaysAgo = new Date(todayDate)
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)
      const { data: recentBookings } = await supabase
        .from('space_bookings')
        .select('id, booking_date, start_time, end_time, status, created_at, space:spaces(name, space_type)')
        .eq('employee_id', HARDCODED_EMPLOYEE_ID)
        .eq('company_id', companyId)
        .eq('status', 'confirmed')
        .gte('created_at', threeDaysAgo.toISOString())
        .order('created_at', { ascending: false })
        .limit(5)

      if (recentBookings) {
        recentBookings.forEach((b: any) => {
          if (personalReminders.some(r => r.id === `booking-${b.id}`)) return
          const spaceName = b.space?.name || 'Space'
          const spaceType = b.space?.space_type || 'desk'
          const dateLabel = new Date(b.booking_date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
          personalReminders.push({
            id: `confirm-booking-${b.id}`,
            type: 'confirm_booking',
            title: `${spaceType === 'room' ? 'Room' : 'Desk'} booking confirmed`,
            subtitle: `${spaceName} · ${dateLabel}${b.start_time ? ` · ${b.start_time.slice(0, 5)} – ${b.end_time?.slice(0, 5)}` : ''}`,
            date: b.created_at,
            navigateTo: '/space-booking',
          })
        })
      }
    }

    // Shift confirmations — shifts assigned in last 3 days
    if (HARDCODED_EMPLOYEE_ID && companyId) {
      const threeDaysAgo = new Date(todayDate)
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)
      const { data: recentShifts } = await supabase
        .from('shift_assignments')
        .select('id, date, created_at, shift_template:shift_templates(name, start_time, end_time), rota:rotas(name, status)')
        .eq('employee_id', HARDCODED_EMPLOYEE_ID)
        .eq('company_id', companyId)
        .gte('created_at', threeDaysAgo.toISOString())
        .order('created_at', { ascending: false })
        .limit(5)

      if (recentShifts) {
        recentShifts
          .filter((s: any) => s.rota?.status === 'published')
          .forEach((s: any) => {
            if (personalReminders.some(r => r.id === `shift-${s.id}`)) return
            const shiftName = s.shift_template?.name || 'Shift'
            const dateLabel = new Date(s.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
            personalReminders.push({
              id: `confirm-shift-${s.id}`,
              type: 'confirm_shift',
              title: `Shift registered: ${shiftName}`,
              subtitle: `${dateLabel} · ${s.rota?.name || 'Rota'}`,
              date: s.created_at,
              navigateTo: '/shifts',
            })
          })
      }
    }

    const currentTime = `${String(todayDate.getHours()).padStart(2, '0')}:${String(todayDate.getMinutes()).padStart(2, '0')}`
    const activeReminders = personalReminders.filter(r => {
      if (r.type === 'confirm_booking' || r.type === 'confirm_shift') return true
      if (r.date > todayStr) return true
      if (r.date === todayStr) {
        if (r.time) return r.time >= currentTime
        return true
      }
      return false
    })
    activeReminders.sort((a, b) => a.date.localeCompare(b.date))
    setReminders(activeReminders)

    setLoading(false)
  }, [HARDCODED_EMPLOYEE_ID, HARDCODED_EMAIL, companyUser?.company_id, features.elearning])

  useEffect(() => {
    if (!HARDCODED_EMAIL) return
    fetchData()
  }, [fetchData, HARDCODED_EMAIL])

  const pendingCount = actions.length + swapActions.length

  function handleActionClick(item: WorkflowItem) {
    if (item.record_type === 'Meeting') {
      if (item.approval_id) {
        navigate(`/one-to-ones/${item.approval_id}`)
      } else {
        navigate('/one-to-ones')
      }
      return
    }
    if (item.record_type === 'Skills Mapping') {
      navigate('/my-profile')
      return
    }
    if (item.record_type === 'Skill Validation') {
      setSkillActionItem(item)
      return
    }
    if (!item.approval_id) {
      alert('This action has no linked record. Please re-seed demo data to fix.')
      return
    }
    if (item.record_type === 'Expense') {
      navigate(`/approve/expense/${item.approval_id}`)
    } else if (item.record_type === 'Leave') {
      navigate(`/approve/leave/${item.approval_id}`)
    } else if (item.record_type === 'Timesheet') {
      navigate(`/approve/timesheet/${item.approval_id}`)
    }
  }

  async function handleSkillValidation(item: WorkflowItem, approve: boolean) {
    const esId = item.extra_info || ''
    if (esId) {
      await supabase.from('employee_skills').update({ status: approve ? 'validated' : 'rejected' }).eq('id', esId)
      await supabase.from('skill_validations').update({ status: approve ? 'approved' : 'rejected', validated_at: new Date().toISOString() }).eq('employee_skill_id', esId)
    }
    await supabase.from('workflow_tracker').update({ status: 'Complete', approval_status: approve ? 'Approved' : 'Declined' }).eq('id', item.id)
    showSuccess(approve ? 'Skill validated' : 'Skill validation rejected')
    setSkillActionItem(null)
    setActions(prev => prev.filter(a => a.id !== item.id))
    window.dispatchEvent(new Event('notifications-updated'))
  }

  function getActionTitle(item: WorkflowItem) {
    if (item.record_type === 'Expense') return t('notifications.expense_review')
    if (item.record_type === 'Leave') {
      const desc = item.task_description || ''
      const leaveType = desc.split(' - ')[0] || 'Leave'
      return `${leaveType} ${t('notifications.leave_approval')}`
    }
    if (item.record_type === 'Timesheet') return t('notifications.timesheet_review')
    if (item.record_type === 'Meeting') return t('notifications.meeting_scheduled')
    if (item.record_type === 'Skill Validation') return 'Skill Validation Request'
    if (item.record_type === 'Skills Mapping') return 'Complete Skills Passport'
    return item.action
  }

  async function handleDeleteSubmission(item: WorkflowItem) {
    if (!item.approval_id) return
    const label = item.record_type === 'Expense' ? 'expense claim' : 'leave request'
    if (!confirm(`Delete this ${label}? This cannot be undone.`)) return

    if (item.record_type === 'Expense') {
      const { error: e1 } = await supabase.from('expense_line_items').delete().eq('expense_claim_id', item.approval_id).eq('company_id', companyUser?.company_id)
      if (e1) { showError('Failed to delete expense items: ' + e1.message); return }
      await supabase.from('workflow_tracker').delete().eq('record_type', 'Expense').eq('approval_id', item.approval_id).eq('company_id', companyUser?.company_id)
      const { error: e3 } = await supabase.from('expense_claims').delete().eq('id', item.approval_id).eq('company_id', companyUser?.company_id)
      if (e3) { showError('Failed to delete expense: ' + e3.message); return }
    } else if (item.record_type === 'Leave') {
      await supabase.from('workflow_tracker').delete().eq('record_type', 'Leave').eq('approval_id', item.approval_id).eq('company_id', companyUser?.company_id)
      const { error: e2 } = await supabase.from('leave_requests').delete().eq('id', item.approval_id).eq('company_id', companyUser?.company_id)
      if (e2) { showError('Failed to delete leave request: ' + e2.message); return }
    } else if (item.record_type === 'Timesheet') {
      await supabase.from('workflow_tracker').delete().eq('record_type', 'Timesheet').eq('approval_id', item.approval_id).eq('company_id', companyUser?.company_id)
      const { error: e2 } = await supabase.from('timesheets').delete().eq('id', item.approval_id).eq('company_id', companyUser?.company_id)
      if (e2) { showError('Failed to delete timesheet: ' + e2.message); return }
    }

    window.dispatchEvent(new Event('notifications-updated'))
    setMyNotifs(prev => prev.filter(n => !(n.record_type === item.record_type && n.approval_id === item.approval_id)))
  }

  function getNotifTitle(item: WorkflowItem) {
    if (item.record_type === 'Birthday') return t('notifications.happy_birthday')
    if (item.approval_status === 'Approved') {
      if (item.record_type === 'Expense') return t('notifications.expense_approved')
      if (item.record_type === 'Leave') return t('notifications.leave_approved')
      if (item.record_type === 'Skill Validation') return 'Skill Validated'
    }
    if (item.approval_status === 'Declined') {
      if (item.record_type === 'Expense') return t('notifications.expense_declined')
      if (item.record_type === 'Leave') return t('notifications.leave_declined')
      if (item.record_type === 'Skill Validation') return 'Skill Validation Rejected'
    }
    return item.action
  }

  return (
    <div className="feature-page notifications-page">
      <header className="notif-header">
        {tab === 'company' && (isSuperAdmin || companyUser?.role === 'admin' || canPost) && (
          <button className="notif-add-btn" onClick={() => navigate('/notifications/create')}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#1565c0" strokeWidth="3" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        )}
        <div className="notif-header-center">
          <h1 className="notif-title">{tab === 'company' ? t('notifications.company_title') : t('notifications.title')}</h1>
        </div>
        <button className="feature-refresh" onClick={fetchData}>
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="14" stroke="#3d6b99" strokeWidth="2" />
            <path d="M22 14a6.5 6.5 0 0 0-11.3-1.5M10 18a6.5 6.5 0 0 0 11.3 1.5" stroke="#3d6b99" strokeWidth="2" strokeLinecap="round" />
            <path d="M22 10v4h-4M10 22v-4h4" stroke="#3d6b99" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </header>

      <div className="notif-tabs">
        <button className={`notif-tab ${tab === 'company' ? 'notif-tab-active' : ''}`} onClick={() => setTab('company')}>
          {t('notifications.company')}
        </button>
        <button className={`notif-tab ${tab === 'actions' ? 'notif-tab-active' : ''}`} onClick={() => setTab('actions')}>
          {t('notifications.my_actions')} {pendingCount > 0 && <span className="notif-tab-badge">{pendingCount}</span>}
        </button>
        <button className={`notif-tab ${tab === 'notifications' ? 'notif-tab-active' : ''}`} onClick={() => setTab('notifications')}>
          {t('notifications.my_notifications')}
        </button>
      </div>

      {loading && <p className="claims-empty">{t('common.loading')}</p>}

      {!loading && tab === 'company' && (
        <div className="notif-list">
          <div className="notif-upcoming-leave">
            <div className="upcoming-leave-icon">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#d4a017" strokeWidth="1.5">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </div>
            <div className="upcoming-leave-info">
              <span className="upcoming-leave-title">{t('notifications.upcoming_leave')}</span>
              <span className="upcoming-leave-sub">{t('notifications.no_upcoming')}</span>
            </div>
            <button className="upcoming-leave-btn" onClick={() => navigate('/leave')}>{t('notifications.book_time_off')}</button>
          </div>

          {announcements.length === 0 && <p className="claims-empty">{t('notifications.no_announcements')}</p>}
          {announcements.map(a => (
            <div key={a.id} className="company-notif-card">
              <div className="company-notif-icon">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="11" fill="#fff3e0" />
                  <path d="M6 12l6-4v8l-6-4z" fill="#e65100" />
                  <rect x="12" y="9" width="6" height="6" rx="1" fill="#e65100" />
                  <line x1="18" y1="8" x2="20" y2="6" stroke="#e65100" strokeWidth="1.5" strokeLinecap="round" />
                  <line x1="18" y1="12" x2="21" y2="12" stroke="#e65100" strokeWidth="1.5" strokeLinecap="round" />
                  <line x1="18" y1="16" x2="20" y2="18" stroke="#e65100" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </div>
              <div className="company-notif-content">
                <span className="company-notif-title">{a.title}</span>
                <span className="company-notif-body">{a.body}</span>
                <div className="company-notif-footer">
                  <span className="company-notif-by">{t('common.submitted_by')}: &nbsp; <strong>{a.submitted_by_name || 'System'}</strong></span>
                  <span className="company-notif-date">{formatNotifDate(a.published_at)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && tab === 'actions' && (
        <div className="notif-list">
          <div className="notif-upcoming-leave">
            <div className="upcoming-leave-icon">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#d4a017" strokeWidth="1.5">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </div>
            <div className="upcoming-leave-info">
              <span className="upcoming-leave-title">{t('notifications.upcoming_leave')}</span>
              <span className="upcoming-leave-sub">{t('notifications.no_upcoming')}</span>
            </div>
            <button className="upcoming-leave-btn" onClick={() => navigate('/leave')}>{t('notifications.book_time_off')}</button>
          </div>

          {actions.length === 0 && swapActions.length === 0 && <p className="claims-empty">{t('notifications.no_actions')}</p>}
          {swapActions.map(swap => (
            <button key={`swap-${swap.id}`} className="notif-action-card" onClick={() => navigate('/shifts/swap', { state: { tab: 'incoming' } })}>
              <div className="notif-action-bar bar-orange" />
              <div className="notif-icon notif-icon-swap">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
                  <path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>
                  <path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
                </svg>
              </div>
              <div className="notif-action-content">
                <span className="notif-action-title">{t('shifts.swap_request_received')}</span>
                <div className="notif-action-meta">
                  <span className="notif-action-label" style={{ color: '#e65100' }}>{t('common.action')}</span>
                  <span className="notif-action-date">{t('notifications.created')} {formatNotifDate(swap.created_at)}</span>
                </div>
                <div className="notif-action-detail">
                  <span className="notif-action-type">{swap.shift_name} — {swap.shift_date}</span>
                  <span className="notif-action-for">{t('notifications.swap_action')} {swap.requester_name}</span>
                </div>
              </div>
              <svg width="28" height="28" viewBox="0 0 32 32" fill="none" className="notif-action-arrow">
                <path d="M12 6l10 10-10 10" stroke="#e65100" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ))}
          {actions.map(item => (
            <button key={item.id} className="notif-action-card" onClick={() => handleActionClick(item)}>
              <div className={`notif-action-bar ${item.record_type === 'Expense' ? 'bar-blue' : item.record_type === 'Leave' ? 'bar-red' : item.record_type === 'Meeting' ? 'bar-purple' : item.record_type === 'Skill Validation' ? 'bar-purple' : item.record_type === 'Skills Mapping' ? 'bar-blue' : 'bar-grey'}`} />
              <NotifIcon type={item.record_type} />
              <div className="notif-action-content">
                <span className="notif-action-title">{getActionTitle(item)}</span>
                <div className="notif-action-meta">
                  <span className="notif-action-label" style={{ color: item.record_type === 'Leave' ? '#e53935' : '#43a047' }}>{t('common.action')}</span>
                  <span className="notif-action-date">{t('notifications.created')} {formatNotifDate(item.created_at)}</span>
                </div>
                <div className="notif-action-detail">
                  <span className="notif-action-type">{item.record_type === 'Expense' ? t('dashboard.expenses') : item.record_type === 'Meeting' ? t('one_to_one.page_subtitle') : item.record_type}</span>
                  {item.task_description && <span className="notif-action-amount">{item.task_description.split(' - ').pop()}</span>}
                  {item.record_type === 'Expense' && item.approval_id && expenseReceipts.has(item.approval_id) && (
                    <span className="notif-receipt-indicator" title={t('common.has_receipts')}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#43a047" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
                    </span>
                  )}
                  <span className="notif-action-for">{t('notifications.for')} {item.emp_display_name}</span>
                  {item.approval_id && <span className="notif-action-id">{item.approval_id}</span>}
                </div>
              </div>
              <svg width="28" height="28" viewBox="0 0 32 32" fill="none" className="notif-action-arrow">
                <path d="M12 6l10 10-10 10" stroke={item.record_type === 'Leave' ? '#43a047' : item.record_type === 'Timesheet' ? '#1565c0' : item.record_type === 'Meeting' || item.record_type === 'Skill Validation' ? '#7c3aed' : item.record_type === 'Skills Mapping' ? '#0891b2' : '#c62828'} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ))}
        </div>
      )}

      {skillActionItem && (
        <div className="my-profile-modal-overlay" onClick={() => setSkillActionItem(null)}>
          <div className="my-profile-cr-modal" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
            <div className="my-profile-modal-header" style={{ background: '#6d28d9', justifyContent: 'space-between', padding: '14px 20px' }}>
              <span className="my-profile-modal-dept" style={{ fontSize: 16 }}>Skill Validation</span>
              <button onClick={() => setSkillActionItem(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div style={{ padding: 20 }}>
              <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>{skillActionItem.emp_display_name}</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>{skillActionItem.task_description}</div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => handleSkillValidation(skillActionItem, true)} style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: 'none', background: '#16a34a', color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>Approve</button>
                <button onClick={() => handleSkillValidation(skillActionItem, false)} style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: 'none', background: '#dc2626', color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>Reject</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {!loading && tab === 'notifications' && (
        <div className="notif-list">
          {reminders.length > 0 && (
            <div className="notif-reminders-collapsible">
              <button className="notif-reminders-toggle" onClick={() => setRemindersExpanded(prev => !prev)}>
                <h3 className="notif-section-heading" style={{ margin: 0 }}>{t('notifications.reminders')} ({reminders.length})</h3>
                <svg
                  width="20" height="20" viewBox="0 0 24 24" fill="none"
                  className={`notif-reminders-arrow ${remindersExpanded ? 'notif-reminders-arrow-open' : ''}`}
                >
                  <path d="M6 9l6 6 6-6" stroke="#666" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {remindersExpanded && (
                <div className="notif-reminders-body">
                  {reminders.map(r => {
                    const daysUntil = Math.floor((new Date(r.date).getTime() - Date.now()) / 86400000)
                    const urgent = daysUntil <= 2 && daysUntil >= 0 && r.type !== 'confirm_booking' && r.type !== 'confirm_shift'
                    return (
                    <div
                      key={r.id}
                      className={`notif-card notif-reminder-card ${r.navigateTo ? 'notif-card-clickable' : ''} ${urgent ? 'notif-reminder-urgent' : ''}`}
                      onClick={() => r.navigateTo && navigate(r.navigateTo)}
                    >
                      <NotifIcon
                        type={
                          r.type === 'birthday' ? 'Birthday'
                            : r.type === 'shift' ? 'Shift'
                            : r.type === 'performance' ? 'Performance'
                            : r.type === 'booking_desk' ? 'BookingDesk'
                            : r.type === 'booking_room' ? 'BookingRoom'
                            : r.type === 'elearning' ? 'ELearning'
                            : r.type === 'confirm_booking' ? 'ConfirmBooking'
                            : r.type === 'confirm_shift' ? 'ConfirmShift'
                            : 'default'
                        }
                      />
                      <div className="notif-card-content">
                        <span className="notif-card-title">{r.title}</span>
                        <span className="notif-card-sub">{r.subtitle}</span>
                      </div>
                      {r.navigateTo && (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="notif-reminder-arrow">
                          <path d="M9 6l6 6-6 6" stroke="#999" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {myNotifs.length > 0 && (
            <>
              {reminders.length > 0 && (
                <h3 className="notif-section-heading">{t('notifications.history')}</h3>
              )}
              <div className="notif-search-bar">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input
                  className="notif-search-input"
                  placeholder={t('notifications.search_placeholder')}
                  value={notifSearch}
                  onChange={e => setNotifSearch(e.target.value)}
                />
                {notifSearch && (
                  <button className="notif-search-clear" onClick={() => setNotifSearch('')}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                )}
              </div>
            </>
          )}

          {myNotifs.length === 0 && reminders.length === 0 && <p className="claims-empty">{t('notifications.no_notifs')}</p>}
          {myNotifs.filter(n => {
            if (!notifSearch) return true
            const q = notifSearch.toLowerCase()
            return (n.action || '').toLowerCase().includes(q)
              || (n.task_description || '').toLowerCase().includes(q)
              || (n.record_type || '').toLowerCase().includes(q)
              || (n.approval_status || '').toLowerCase().includes(q)
              || (n.emp_display_name || '').toLowerCase().includes(q)
          }).map(n => (
            <div key={n.id} className="notif-card">
              <NotifIcon type={n.record_type} status={n.approval_status} />
              <div className="notif-card-content">
                <span className="notif-card-title">{getNotifTitle(n)}</span>
                <span className="notif-card-sub">{n.task_description}{n.record_type === 'Expense' && n.approval_id && expenseReceipts.has(n.approval_id) && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#43a047" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 6, verticalAlign: 'middle' }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
                )}</span>
                <span className="notif-card-date">{formatNotifDate(n.created_at)}</span>
              </div>
              {(n.record_type === 'Expense' || n.record_type === 'Leave') && n.approval_id && (
                <button className="notif-delete-btn" onClick={() => handleDeleteSubmission(n)} title={t('common.delete')}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#c62828" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
