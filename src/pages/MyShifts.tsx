import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'
import { useFeatures } from '../context/FeatureContext'
import { useCheckIn } from '../context/CheckInContext'
import { formatTime12 as formatTimeShort } from '../lib/formatters'

interface ShiftTemplate {
  id: string
  name: string
  start_time: string
  end_time: string
  break_minutes?: number
  colour: string
}

interface ShiftAssignment {
  id: string
  date: string
  employee_id: string
  shift_template_id: string
  rota_id?: string
  shift_template: ShiftTemplate | null
  rota: {
    id: string
    name: string
    status: string
    shift_contract_type?: string | null
  } | null
}

interface EmployeeInfo {
  id: string
  first_name: string
  last_name: string
  avatar_url?: string | null
}

interface AvailableTemplate {
  id: string
  name: string
  start_time: string
  end_time: string
  colour: string
}

interface GroupedShift {
  templateId: string
  template: ShiftTemplate
  date: string
  assignments: ShiftAssignment[]
  employees: EmployeeInfo[]
  shiftContractType?: string | null
}

interface CorrectionFlag {
  assignmentId: string
  type: 'late_checkin' | 'early_checkout' | 'no_checkin' | 'no_checkout'
  varianceMins: number
  expectedTime: string
  actualTime: string
  checkinRecordId?: string
  shiftDate: string
  shiftName: string
}

interface ShiftCorrection {
  id: string
  shift_assignment_id: string
  correction_type: string
  status: string
  employee_comment: string | null
  admin_comment: string | null
  shift_date: string
  expected_time: string | null
  actual_time: string | null
  variance_minutes: number
}

type FilterTab = 'only_me' | 'everyone' | 'availability' | 'replacements' | 'tasks'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const CARD_BG_PALETTE = [
  { bg: '#e8f5e9', text: '#2e7d32', border: '#43a047' },
  { bg: '#e3f2fd', text: '#1565c0', border: '#1e88e5' },
  { bg: '#fff3e0', text: '#e65100', border: '#fb8c00' },
  { bg: '#f3e5f5', text: '#7b1fa2', border: '#ab47bc' },
  { bg: '#e0f7fa', text: '#00695c', border: '#00897b' },
  { bg: '#fce4ec', text: '#c62828', border: '#ef5350' },
  { bg: '#fff8e1', text: '#f57f17', border: '#fdd835' },
  { bg: '#ede7f6', text: '#4527a0', border: '#7e57c2' },
  { bg: '#e8eaf6', text: '#283593', border: '#5c6bc0' },
  { bg: '#efebe9', text: '#4e342e', border: '#8d6e63' },
]

const TEMPLATE_COLOR_MAP: Record<string, typeof CARD_BG_PALETTE[0]> = {}
let templateColorIndex = 0

function getCardColor(templateId: string): { bg: string; text: string; border: string } {
  if (TEMPLATE_COLOR_MAP[templateId]) return TEMPLATE_COLOR_MAP[templateId]
  TEMPLATE_COLOR_MAP[templateId] = CARD_BG_PALETTE[templateColorIndex % CARD_BG_PALETTE.length]
  templateColorIndex++
  return TEMPLATE_COLOR_MAP[templateId]
}

function getWeekStart(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

function getWeekDays(weekStart: Date): Date[] {
  const days: Date[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + i)
    days.push(d)
  }
  return days
}

function toDateStr(d: Date): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}



function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
}

function getInitials(first: string, last: string): string {
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase()
}

const AVATAR_COLORS = ['#667eea', '#764ba2', '#f093fb', '#4facfe', '#43e97b', '#fa709a', '#fee140', '#30cfd0']
function avatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

export default function MyShifts() {
  const navigate = useNavigate()
  const { t } = useLanguage()
  const { employeeId, companyUser, employmentCategory } = useAuth()
  const { features } = useFeatures()
  const { settings: ciSettings, activeCheckin, activeBreak, checkOut, startBreak, endBreak } = useCheckIn()
  const shiftsEnabled = features.shifts

  const [shifts, setShifts] = useState<ShiftAssignment[]>([])
  const [allShifts, setAllShifts] = useState<ShiftAssignment[]>([])
  const [employeeMap, setEmployeeMap] = useState<Record<string, EmployeeInfo>>({})
  const [templates, setTemplates] = useState<AvailableTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterTab>('only_me')
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()))
  const [editingId, setEditingId] = useState<string | null>(null)
  const [popupShift, setPopupShift] = useState<GroupedShift | null>(null)
  const [correctionFlags, setCorrectionFlags] = useState<CorrectionFlag[]>([])
  const [corrections, setCorrections] = useState<ShiftCorrection[]>([])
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState<string | null>(null)
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({})
  const [groupPages, setGroupPages] = useState<Record<string, number>>({})
  const GROUP_PAGE_SIZE = 5
  const [checkinRecords, setCheckinRecords] = useState<{ id: string; shift_assignment_id: string; check_in_at: string; check_out_at: string | null; status: string }[]>([])
  const [contractType, setContractType] = useState<string | null>(null)
  const [weeklyHours, setWeeklyHours] = useState<number | null>(null)

  const today = useMemo(() => new Date(), [])
  const weekDays = useMemo(() => getWeekDays(weekStart), [weekStart])

  const weekEnd = useMemo(() => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + 6)
    return d
  }, [weekStart])

  const monthLabel = useMemo(() => {
    const startMonth = MONTH_NAMES[weekStart.getMonth()]
    const startDay = weekStart.getDate()
    const endDay = weekEnd.getDate()
    if (weekStart.getMonth() === weekEnd.getMonth()) {
      return `${startMonth} ${startDay}-${endDay}`
    }
    const endMonth = MONTH_NAMES[weekEnd.getMonth()]
    return `${startMonth} ${startDay} - ${endMonth} ${endDay}`
  }, [weekStart, weekEnd])

  const fetchMyShifts = useCallback(async () => {
    if (!employeeId || !companyUser?.company_id) return
    setLoading(true)
    const [assignRes, rotaRes] = await Promise.all([
      supabase
        .from('shift_assignments')
        .select('*, shift_template:shift_templates(id, name, start_time, end_time, break_minutes, colour)')
        .eq('employee_id', employeeId)
        .eq('company_id', companyUser.company_id),
      supabase
        .from('rotas')
        .select('id, name, status')
        .eq('company_id', companyUser.company_id)
        .eq('status', 'published'),
    ])
    const publishedRotaIds = new Set((rotaRes.data || []).map((r: any) => r.id))
    const rotaMap: Record<string, { id: string; name: string; status: string }> = {}
    ;(rotaRes.data || []).forEach((r: any) => { rotaMap[r.id] = r })
    const published = (assignRes.data || [])
      .filter((s: any) => publishedRotaIds.has(s.rota_id))
      .map((s: any) => ({ ...s, rota: rotaMap[s.rota_id] || null }))
    setShifts(published as ShiftAssignment[])
    setLoading(false)
  }, [employeeId, companyUser?.company_id])

  const fetchAllShifts = useCallback(async () => {
    if (!companyUser?.company_id) return
    const [shiftRes, empRes, rotaRes] = await Promise.all([
      supabase
        .from('shift_assignments')
        .select('*, shift_template:shift_templates(id, name, start_time, end_time, break_minutes, colour)')
        .eq('company_id', companyUser.company_id),
      supabase
        .from('employees')
        .select('id, first_name, last_name, avatar_url')
        .eq('company_id', companyUser.company_id)
        .eq('is_active', true),
      supabase
        .from('rotas')
        .select('id, name, status, shift_contract_type')
        .eq('company_id', companyUser.company_id)
        .eq('status', 'published'),
    ])
    const publishedRotaIds = new Set((rotaRes.data || []).map((r: any) => r.id))
    const rotaMap: Record<string, { id: string; name: string; status: string; shift_contract_type?: string | null }> = {}
    ;(rotaRes.data || []).forEach((r: any) => { rotaMap[r.id] = r })
    const published = (shiftRes.data || [])
      .filter((s: any) => publishedRotaIds.has(s.rota_id))
      .map((s: any) => ({ ...s, rota: rotaMap[s.rota_id] || null }))
    setAllShifts(published as ShiftAssignment[])

    const map: Record<string, EmployeeInfo> = {}
    ;(empRes.data || []).forEach((e: any) => { map[e.id] = e })
    setEmployeeMap(map)
  }, [companyUser?.company_id])

  const fetchTemplates = useCallback(async () => {
    if (!companyUser?.company_id) return
    const { data } = await supabase
      .from('shift_templates')
      .select('id, name, start_time, end_time, colour')
      .eq('company_id', companyUser.company_id)
      .eq('is_active', true)
    setTemplates((data || []) as AvailableTemplate[])
  }, [companyUser?.company_id])

  const fetchCorrections = useCallback(async () => {
    if (!employeeId || !companyUser?.company_id) return
    const [ciRes, scRes] = await Promise.all([
      supabase
        .from('checkin_records')
        .select('id, shift_assignment_id, check_in_at, check_out_at, status')
        .eq('company_id', companyUser.company_id)
        .eq('employee_id', employeeId)
        .eq('source', 'shifts'),
      supabase
        .from('shift_corrections')
        .select('id, shift_assignment_id, correction_type, status, employee_comment, admin_comment, shift_date, expected_time, actual_time, variance_minutes')
        .eq('company_id', companyUser.company_id)
        .eq('employee_id', employeeId),
    ])
    const checkins = (ciRes.data || []) as { id: string; shift_assignment_id: string; check_in_at: string; check_out_at: string | null; status: string }[]
    setCheckinRecords(checkins)
    const ciMap: Record<string, typeof checkins[0]> = {}
    for (const c of checkins) {
      if (c.shift_assignment_id) ciMap[c.shift_assignment_id] = c
    }

    const flags: CorrectionFlag[] = []
    const existingCorrections = new Set((scRes.data || []).map((sc: any) => `${sc.shift_assignment_id}|${sc.correction_type}`))

    for (const s of shifts) {
      if (!s.shift_template) continue
      const shiftDate = new Date(s.date + 'T00:00:00')
      const now = new Date()
      if (shiftDate > now) continue

      const ci = ciMap[s.id]
      const expectedStart = new Date(`${s.date}T${s.shift_template.start_time}`)
      const expectedEnd = new Date(`${s.date}T${s.shift_template.end_time}`)

      if (!ci) {
        if (!existingCorrections.has(`${s.id}|no_checkin`)) {
          flags.push({
            assignmentId: s.id, type: 'no_checkin', varianceMins: 0,
            expectedTime: s.shift_template.start_time, actualTime: '-',
            shiftDate: s.date, shiftName: s.shift_template.name,
          })
        }
        continue
      }

      const actualStart = new Date(ci.check_in_at)
      const lateMins = Math.round((actualStart.getTime() - expectedStart.getTime()) / 60000)
      if (lateMins > 15 && !existingCorrections.has(`${s.id}|late_checkin`)) {
        flags.push({
          assignmentId: s.id, type: 'late_checkin', varianceMins: lateMins,
          expectedTime: s.shift_template.start_time,
          actualTime: actualStart.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
          checkinRecordId: ci.id, shiftDate: s.date, shiftName: s.shift_template.name,
        })
      }

      if (!ci.check_out_at && (ci.status === 'checked_in' || ci.status === 'auto_closed')) {
        if (!existingCorrections.has(`${s.id}|no_checkout`)) {
          flags.push({
            assignmentId: s.id, type: 'no_checkout', varianceMins: 0,
            expectedTime: s.shift_template.end_time, actualTime: '-',
            checkinRecordId: ci.id, shiftDate: s.date, shiftName: s.shift_template.name,
          })
        }
      } else if (ci.check_out_at) {
        const actualEnd = new Date(ci.check_out_at)
        const earlyMins = Math.round((expectedEnd.getTime() - actualEnd.getTime()) / 60000)
        if (earlyMins > 10 && !existingCorrections.has(`${s.id}|early_checkout`)) {
          flags.push({
            assignmentId: s.id, type: 'early_checkout', varianceMins: earlyMins,
            expectedTime: s.shift_template.end_time,
            actualTime: actualEnd.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
            checkinRecordId: ci.id, shiftDate: s.date, shiftName: s.shift_template.name,
          })
        }
      }
    }

    setCorrectionFlags(flags)
    setCorrections((scRes.data || []) as ShiftCorrection[])
  }, [employeeId, companyUser?.company_id, shifts])

  useEffect(() => {
    fetchMyShifts()
    fetchTemplates()
  }, [fetchMyShifts, fetchTemplates])

  useEffect(() => {
    if (shifts.length > 0) fetchCorrections()
  }, [shifts, fetchCorrections])

  useEffect(() => {
    if (filter === 'everyone') fetchAllShifts()
  }, [filter, fetchAllShifts])

  // Fetch employee contract_type and weekly_hours for weekly hours card
  useEffect(() => {
    if (!employeeId || !companyUser?.company_id) return
    supabase
      .from('employees')
      .select('contract_type, weekly_hours')
      .eq('id', employeeId)
      .eq('company_id', companyUser.company_id)
      .single()
      .then(({ data }) => {
        if (data) {
          setContractType(data.contract_type || null)
          setWeeklyHours(data.weekly_hours ?? null)
        }
      })
  }, [employeeId, companyUser?.company_id])

  // Calculate weekly hours from checkin records
  const weeklyHoursSummary = useMemo(() => {
    if (employmentCategory !== 'shift_worker') return null

    const isZeroHours = contractType === 'Zero hours shift worker'
    const now = new Date()
    const monday = getWeekStart(now)
    const endOfRange = new Date(monday)
    if (isZeroHours) {
      // Mon-Sun for zero hours
      endOfRange.setDate(endOfRange.getDate() + 6)
      endOfRange.setHours(23, 59, 59, 999)
    } else {
      // Mon-Fri for contracted
      endOfRange.setDate(endOfRange.getDate() + 4)
      endOfRange.setHours(23, 59, 59, 999)
    }

    let totalMs = 0
    let shiftCount = 0
    for (const rec of checkinRecords) {
      if (!rec.check_in_at || !rec.check_out_at) continue
      const checkIn = new Date(rec.check_in_at)
      if (checkIn < monday || checkIn > endOfRange) continue
      const checkOut = new Date(rec.check_out_at)
      totalMs += checkOut.getTime() - checkIn.getTime()
      shiftCount++
    }
    const totalHours = totalMs / (1000 * 60 * 60)

    return {
      totalHours,
      shiftCount,
      isZeroHours,
      contracted: weeklyHours,
      percentage: weeklyHours && weeklyHours > 0 ? Math.min(100, (totalHours / weeklyHours) * 100) : 0,
    }
  }, [checkinRecords, employmentCategory, contractType, weeklyHours])

  const handleRefresh = useCallback(() => {
    fetchMyShifts()
    if (filter === 'everyone') fetchAllShifts()
    fetchTemplates()
    fetchCorrections()
  }, [fetchMyShifts, fetchAllShifts, fetchTemplates, fetchCorrections, filter])

  const activeShifts = filter === 'everyone' ? allShifts : shifts

  const groupedByDate = useMemo(() => {
    const map: Record<string, GroupedShift[]> = {}
    for (const day of weekDays) map[toDateStr(day)] = []

    const byDateTemplate: Record<string, { assignments: ShiftAssignment[]; template: ShiftTemplate; shiftContractType?: string | null }> = {}
    for (const s of activeShifts) {
      if (!s.shift_template) continue
      const key = `${s.date}|${s.shift_template.id}`
      if (!byDateTemplate[key]) {
        byDateTemplate[key] = { assignments: [], template: s.shift_template, shiftContractType: s.rota?.shift_contract_type }
      }
      byDateTemplate[key].assignments.push(s)
    }

    for (const [key, group] of Object.entries(byDateTemplate)) {
      const [date] = key.split('|')
      if (!map[date]) continue
      const employees = group.assignments.map(a => {
        const emp = employeeMap[a.employee_id]
        return emp || { id: a.employee_id, first_name: '?', last_name: '' }
      })
      map[date].push({
        templateId: group.template.id,
        template: group.template,
        date,
        assignments: group.assignments,
        employees,
        shiftContractType: group.shiftContractType,
      })
    }

    return map
  }, [activeShifts, weekDays, employeeMap])

  const daysWithShifts = useMemo(() => {
    const set = new Set<string>()
    for (const s of activeShifts) set.add(s.date)
    return set
  }, [activeShifts])

  const prevWeek = () => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() - 7)
    setWeekStart(d)
  }
  const nextWeek = () => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + 7)
    setWeekStart(d)
  }
  const goToToday = () => setWeekStart(getWeekStart(new Date()))

  const handleEditTemplate = async (assignmentId: string, newTemplateId: string) => {
    await supabase
      .from('shift_assignments')
      .update({ shift_template_id: newTemplateId })
      .eq('id', assignmentId)
      .eq('company_id', companyUser?.company_id)
    setEditingId(null)
    fetchMyShifts()
    if (filter === 'everyone') fetchAllShifts()
  }

  if (!shiftsEnabled) {
    return (
      <div className="feature-page">
        <p className="claims-empty">Shifts feature is not enabled.</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="shifts-page">
        <p className="claims-empty">{t('common.loading')}</p>
      </div>
    )
  }

  return (
    <div className="shifts-page">
      <header className="shifts-header">
        <button className="shifts-header-back" onClick={() => navigate('/')}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <div className="shifts-header-center">
          <h1 className="shifts-header-title">{t('shifts.title')}</h1>
        </div>
        <button className="shifts-header-refresh" onClick={handleRefresh}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round">
            <path d="M21 12a9 9 0 0 1-15.36 6.36" /><path d="M3 12a9 9 0 0 1 15.36-6.36" />
            <polyline points="21 3 21 9 15 9" /><polyline points="3 21 3 15 9 15" />
          </svg>
        </button>
      </header>

      {/* Calendar Strip */}
      <div className="schedule-cal-strip">
        <div className="schedule-cal-nav">
          <button onClick={prevWeek} aria-label="Previous week">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M12 15l-5-5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <button className="schedule-cal-month" onClick={goToToday}>{monthLabel}</button>
          <button onClick={nextWeek} aria-label="Next week">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M8 5l5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </div>
        <div className="schedule-cal-days">
          {weekDays.map(day => {
            const dateStr = toDateStr(day)
            const isToday = isSameDay(day, today)
            const hasShift = daysWithShifts.has(dateStr)
            return (
              <div key={dateStr} className={`schedule-cal-day${isToday ? ' schedule-cal-today' : ''}${hasShift ? ' schedule-cal-has-shift' : ''}`}>
                <span className="schedule-cal-letter">{DAY_LETTERS[day.getDay()]}</span>
                <span className="schedule-cal-number">{day.getDate()}</span>
                {hasShift && <span className="schedule-cal-dot" />}
              </div>
            )
          })}
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="shifts-tabs">
        {([
          { key: 'only_me' as FilterTab, label: t('shifts.only_me') },
          { key: 'everyone' as FilterTab, label: t('shifts.everyone') },
          { key: 'availability' as FilterTab, label: t('shifts.availability') },
          { key: 'replacements' as FilterTab, label: t('shifts.replacements') },
          { key: 'tasks' as FilterTab, label: 'Actions' },
        ]).map(f => (
          <button
            key={f.key}
            className={`shifts-tab${filter === f.key ? ' shifts-tab-active' : ''}`}
            onClick={() => { setFilter(f.key); if (f.key === 'tasks') setGroupPages({}); if (f.key === 'availability') navigate('/shifts/availability'); if (f.key === 'replacements') navigate('/shifts/swap') }}
          >
            {f.label}
            {f.key === 'tasks' && (correctionFlags.length + corrections.filter(c => c.status === 'declined').length) > 0 && (
              <span className="shifts-tab-badge">{correctionFlags.length + corrections.filter(c => c.status === 'declined').length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Check-in banner */}
      {ciSettings?.shifts_checkin_enabled && (() => {
        if (activeCheckin && activeCheckin.source === 'shifts') {
          const mins = Math.floor((Date.now() - new Date(activeCheckin.check_in_at).getTime()) / 60000)
          const h = Math.floor(mins / 60); const m = mins % 60
          const onBreak = !!activeBreak
          return (
            <div
              className={`dash-checkin-banner${onBreak ? ' dash-checkin-break' : ''}`}
              style={{ margin: '8px 16px 0', background: onBreak ? '#d97706' : '#e65100' }}
              onClick={() => navigate('/shifts/checkin')}
            >
              <div className="dash-checkin-banner-info">
                <span className={`dash-checkin-dot${onBreak ? ' dash-checkin-dot-break' : ''}`} />
                <span className="dash-checkin-banner-text">
                  Shift · {onBreak ? 'Break' : 'In'} {new Date(activeCheckin.check_in_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} ({h}h{m > 0 ? ` ${m}m` : ''})
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
        }
        if (activeCheckin && activeCheckin.source === 'timesheets') {
          return (
            <div
              className="dash-checkin-banner"
              style={{ margin: '8px 16px 0', background: '#78909c', cursor: 'default', opacity: 0.7 }}
            >
              <div className="dash-checkin-banner-info">
                <span className="dash-checkin-banner-text">Check out of timesheets to check in to a shift</span>
              </div>
            </div>
          )
        }
        const todayStr = new Date().toISOString().slice(0, 10)
        const now = new Date()
        const nowMins = now.getHours() * 60 + now.getMinutes()
        const hasUpcomingShift = shifts.some(s => {
          if (s.date !== todayStr || s.employee_id !== employeeId) return false
          const end = s.shift_template?.end_time
          if (!end) return false
          const [eh, em] = end.split(':').map(Number)
          return eh * 60 + em > nowMins
        })
        if (!hasUpcomingShift) return null
        return (
          <button
            className="dash-checkin-banner"
            style={{ margin: '8px 16px 0', background: '#e65100', border: 'none', cursor: 'pointer', width: 'calc(100% - 32px)' }}
            onClick={() => navigate('/shifts/checkin')}
          >
            <div className="dash-checkin-banner-info">
              <span className="dash-checkin-banner-text">Check In to your shift</span>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
          </button>
        )
      })()}

      {/* Weekly Hours Summary */}
      {weeklyHoursSummary && (
        <div style={{
          margin: '8px 16px 0',
          padding: '10px 14px',
          borderRadius: 10,
          background: '#f5f5f5',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          fontSize: 13,
          color: '#333',
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, marginBottom: weeklyHoursSummary.isZeroHours ? 0 : 4, fontSize: 12, color: '#666' }}>
              {weeklyHoursSummary.isZeroHours ? 'This Week (Mon–Sun)' : 'This Week (Mon–Fri)'}
            </div>
            {weeklyHoursSummary.isZeroHours ? (
              <span style={{ fontWeight: 500 }}>
                {weeklyHoursSummary.totalHours.toFixed(1)} hrs recorded across {weeklyHoursSummary.shiftCount} shift{weeklyHoursSummary.shiftCount !== 1 ? 's' : ''}
              </span>
            ) : (
              <>
                <span style={{ fontWeight: 500 }}>
                  {weeklyHoursSummary.totalHours.toFixed(1)} hrs recorded / {weeklyHoursSummary.contracted != null ? `${weeklyHoursSummary.contracted} contracted hrs` : 'contracted hrs not set'}
                </span>
                <div style={{
                  marginTop: 4,
                  height: 6,
                  borderRadius: 3,
                  background: '#ddd',
                  overflow: 'hidden',
                }}>
                  <div style={{
                    height: '100%',
                    width: `${weeklyHoursSummary.percentage}%`,
                    borderRadius: 3,
                    background: weeklyHoursSummary.percentage >= 100 ? '#43a047' : '#1e88e5',
                    transition: 'width 0.3s ease',
                  }} />
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Shift List */}
      <div className="schedule-shift-list">
        {filter === 'tasks' ? (() => {
          const declined = corrections.filter(c => c.status === 'declined')
          const submitted = corrections.filter(c => c.status === 'submitted' || c.status === 'approved')
          const totalItems = correctionFlags.length + declined.length + submitted.length

          const flagLabels: Record<string, string> = {
            late_checkin: 'Late Check-in', early_checkout: 'Early Check-out',
            no_checkin: 'No Check-in', no_checkout: 'No Check-out',
          }

          const toggleGroup = (key: string) => setExpandedGroups(prev => ({ ...prev, [key]: !prev[key] }))
          const getPage = (key: string) => groupPages[key] || 0
          const setPage = (key: string, page: number) => setGroupPages(prev => ({ ...prev, [key]: page }))

          const renderPagination = (key: string, total: number) => {
            const totalPages = Math.ceil(total / GROUP_PAGE_SIZE)
            if (totalPages <= 1) return null
            const page = Math.min(getPage(key), totalPages - 1)
            return (
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, padding: '8px 0 4px' }}>
                <button className="admin-btn" style={{ fontSize: 12, padding: '4px 10px' }} disabled={page === 0} onClick={() => setPage(key, page - 1)}>Previous</button>
                <span style={{ fontSize: 12, color: '#666' }}>Page {page + 1} of {totalPages}</span>
                <button className="admin-btn" style={{ fontSize: 12, padding: '4px 10px' }} disabled={page >= totalPages - 1} onClick={() => setPage(key, page + 1)}>Next</button>
              </div>
            )
          }

          return (
          <div className="sc-tasks-container">
            {totalItems === 0 && (
              <div className="schedule-no-shift" style={{ textAlign: 'center', padding: '32px 0' }}>
                <p>No shift actions at this time.</p>
              </div>
            )}

            {/* Corrections Required */}
            {correctionFlags.length > 0 && (() => {
              const isOpen = !!expandedGroups['required']
              const page = Math.min(getPage('required'), Math.max(0, Math.ceil(correctionFlags.length / GROUP_PAGE_SIZE) - 1))
              const pageFlags = isOpen ? correctionFlags.slice(page * GROUP_PAGE_SIZE, (page + 1) * GROUP_PAGE_SIZE) : []
              const latestFlag = correctionFlags[0]
              const latestDate = new Date(latestFlag.shiftDate + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
              return (
                <div className="sc-group">
                  <button className="sc-group-header sc-group-header-warning" onClick={() => toggleGroup('required')}>
                    <div className="sc-group-title">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}><path d="M9 18l6-6-6-6"/></svg>
                      <span>Corrections Required</span>
                      <span className="sc-group-badge">{correctionFlags.length}</span>
                    </div>
                    {!isOpen && <span className="sc-group-preview">{flagLabels[latestFlag.type]} · {latestFlag.shiftName} · {latestDate}</span>}
                  </button>
                  {isOpen && (
                    <div className="sc-group-body">
                      {pageFlags.map(flag => {
                        const flagKey = `${flag.assignmentId}|${flag.type}`
                        const fmtDate = new Date(flag.shiftDate + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                        return (
                          <div key={flagKey} className="sc-task-card sc-task-card-pending">
                            <div className="sc-task-card-header">
                              <span className="sc-task-type-badge">{flagLabels[flag.type]}</span>
                              <span className="sc-task-date">{fmtDate}</span>
                            </div>
                            <div className="sc-task-card-body">
                              <div className="sc-task-detail"><strong>{flag.shiftName}</strong></div>
                              <div className="sc-task-detail">
                                Expected: {flag.expectedTime} · Actual: {flag.actualTime}
                                {flag.varianceMins > 0 && ` (${flag.varianceMins} mins)`}
                              </div>
                              <textarea
                                className="sc-task-comment"
                                placeholder="Add your comment..."
                                value={commentDrafts[flagKey] || ''}
                                onChange={e => setCommentDrafts(prev => ({ ...prev, [flagKey]: e.target.value }))}
                                rows={2}
                              />
                              <button
                                className="sc-task-submit"
                                disabled={!commentDrafts[flagKey]?.trim() || submitting === flagKey}
                                onClick={async () => {
                                  if (!companyUser?.company_id || !employeeId) return
                                  setSubmitting(flagKey)
                                  const { error } = await supabase.from('shift_corrections').upsert({
                                    company_id: companyUser.company_id,
                                    employee_id: employeeId,
                                    shift_assignment_id: flag.assignmentId,
                                    checkin_record_id: flag.checkinRecordId || null,
                                    correction_type: flag.type,
                                    shift_date: flag.shiftDate,
                                    expected_time: flag.expectedTime,
                                    actual_time: flag.actualTime,
                                    variance_minutes: flag.varianceMins,
                                    employee_comment: commentDrafts[flagKey]?.trim(),
                                    status: 'submitted',
                                  }, { onConflict: 'company_id,shift_assignment_id,correction_type' })
                                  setSubmitting(null)
                                  if (error) {
                                    alert('Failed to submit correction: ' + error.message)
                                    return
                                  }
                                  setCommentDrafts(prev => { const n = { ...prev }; delete n[flagKey]; return n })
                                  fetchCorrections()
                                }}
                              >
                                {submitting === flagKey ? 'Submitting...' : 'Submit'}
                              </button>
                            </div>
                          </div>
                        )
                      })}
                      {renderPagination('required', correctionFlags.length)}
                    </div>
                  )}
                </div>
              )
            })()}

            {/* Declined — Action Required */}
            {declined.length > 0 && (() => {
              const isOpen = !!expandedGroups['declined']
              const page = Math.min(getPage('declined'), Math.max(0, Math.ceil(declined.length / GROUP_PAGE_SIZE) - 1))
              const pageDeclined = isOpen ? declined.slice(page * GROUP_PAGE_SIZE, (page + 1) * GROUP_PAGE_SIZE) : []
              const latest = declined[0]
              const latestDate = new Date(latest.shift_date + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
              return (
                <div className="sc-group">
                  <button className="sc-group-header sc-group-header-danger" onClick={() => toggleGroup('declined')}>
                    <div className="sc-group-title">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}><path d="M9 18l6-6-6-6"/></svg>
                      <span>Declined — Action Required</span>
                      <span className="sc-group-badge sc-group-badge-danger">{declined.length}</span>
                    </div>
                    {!isOpen && <span className="sc-group-preview">{flagLabels[latest.correction_type] || latest.correction_type} · {latestDate}</span>}
                  </button>
                  {isOpen && (
                    <div className="sc-group-body">
                      {pageDeclined.map(sc => {
                        const fmtDate = new Date(sc.shift_date + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                        return (
                          <div key={sc.id} className="sc-task-card sc-task-card-declined">
                            <div className="sc-task-card-header">
                              <span className="sc-task-type-badge sc-task-badge-declined">{flagLabels[sc.correction_type] || sc.correction_type}</span>
                              <span className="sc-task-date">{fmtDate}</span>
                            </div>
                            <div className="sc-task-card-body">
                              <div className="sc-task-detail">
                                Expected: {sc.expected_time || '-'} · Actual: {sc.actual_time || '-'}
                                {sc.variance_minutes > 0 && ` (${sc.variance_minutes} mins)`}
                              </div>
                              {sc.admin_comment && <div className="sc-task-admin-msg">Admin: {sc.admin_comment}</div>}
                              <div className="sc-task-admin-msg" style={{ color: '#dc2626' }}>Please speak to your shift manager regarding this shift.</div>
                            </div>
                          </div>
                        )
                      })}
                      {renderPagination('declined', declined.length)}
                    </div>
                  )}
                </div>
              )
            })()}

            {/* Submitted Corrections */}
            {submitted.length > 0 && (() => {
              const isOpen = !!expandedGroups['submitted']
              const page = Math.min(getPage('submitted'), Math.max(0, Math.ceil(submitted.length / GROUP_PAGE_SIZE) - 1))
              const pageSubmitted = isOpen ? submitted.slice(page * GROUP_PAGE_SIZE, (page + 1) * GROUP_PAGE_SIZE) : []
              const latest = submitted[0]
              const latestDate = new Date(latest.shift_date + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
              const statusLabel = latest.status.charAt(0).toUpperCase() + latest.status.slice(1)
              return (
                <div className="sc-group">
                  <button className="sc-group-header" onClick={() => toggleGroup('submitted')}>
                    <div className="sc-group-title">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}><path d="M9 18l6-6-6-6"/></svg>
                      <span>Submitted Corrections</span>
                      <span className="sc-group-badge sc-group-badge-neutral">{submitted.length}</span>
                    </div>
                    {!isOpen && <span className="sc-group-preview">{flagLabels[latest.correction_type] || latest.correction_type} · {statusLabel} · {latestDate}</span>}
                  </button>
                  {isOpen && (
                    <div className="sc-group-body">
                      {pageSubmitted.map(sc => {
                        const statusColors: Record<string, { bg: string; color: string }> = {
                          submitted: { bg: '#fff3e0', color: '#e65100' },
                          approved: { bg: '#e8f5e9', color: '#2e7d32' },
                        }
                        const st = statusColors[sc.status] || { bg: '#f5f5f5', color: '#666' }
                        const fmtDate = new Date(sc.shift_date + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                        return (
                          <div key={sc.id} className="sc-task-card">
                            <div className="sc-task-card-header">
                              <span className="sc-task-type-badge">{flagLabels[sc.correction_type] || sc.correction_type}</span>
                              <span className="sc-task-status" style={{ background: st.bg, color: st.color }}>{sc.status.charAt(0).toUpperCase() + sc.status.slice(1)}</span>
                              <span className="sc-task-date">{fmtDate}</span>
                            </div>
                            <div className="sc-task-card-body">
                              <div className="sc-task-detail">
                                Expected: {sc.expected_time || '-'} · Actual: {sc.actual_time || '-'}
                              </div>
                              {sc.employee_comment && <div className="sc-task-detail" style={{ fontStyle: 'italic' }}>"{sc.employee_comment}"</div>}
                              {sc.admin_comment && <div className="sc-task-admin-msg">Admin: {sc.admin_comment}</div>}
                            </div>
                          </div>
                        )
                      })}
                      {renderPagination('submitted', submitted.length)}
                    </div>
                  )}
                </div>
              )
            })()}
          </div>
          )
        })() : filter === 'replacements' ? (
          <div className="schedule-no-shift" style={{ textAlign: 'center', padding: '32px 0' }}>
            <p>No replacement requests at this time.</p>
          </div>
        ) : (
          weekDays.map(day => {
            const dateStr = toDateStr(day)
            const dayNum = String(day.getDate()).padStart(2, '0')
            const dayName = DAY_LABELS[day.getDay()]
            const isToday = isSameDay(day, today)
            const isPast = day < today && !isToday

            const groups = filter === 'everyone'
              ? (groupedByDate[dateStr] || [])
              : []

            const myShiftsForDay = filter === 'only_me'
              ? (shifts.filter(s => s.date === dateStr))
              : []

            const hasContent = filter === 'everyone' ? groups.length > 0 : myShiftsForDay.length > 0

            return (
              <div key={dateStr} className="schedule-day-group">
                <div className={`schedule-day-label${isToday ? ' schedule-day-today' : ''}`}>
                  <span className="schedule-day-num">{dayNum}</span>
                  <span className="schedule-day-name">{dayName}</span>
                  {isToday && <span className="schedule-day-badge">Today</span>}
                  {isPast && hasContent && <span className="schedule-day-badge" style={{ background: '#90a4ae' }}>Completed</span>}
                </div>

                {!hasContent ? (
                  <div className="schedule-no-shift">No shift</div>
                ) : filter === 'everyone' ? (
                  groups.map(g => {
                    const cardColor = getCardColor(g.templateId)
                    const showCount = Math.min(g.employees.length, 3)
                    const extra = g.employees.length - showCount

                    return (
                      <div
                        key={`${g.date}-${g.templateId}`}
                        className={`sc-block${isPast ? ' sc-block-past' : ''}`}
                        style={{ background: cardColor.bg, borderLeftColor: cardColor.border }}
                      >
                        <div className="sc-block-top">
                          <div className="sc-block-info">
                            <div className="sc-block-name" style={{ color: cardColor.text }}>
                              {g.template.name}
                              {g.shiftContractType && (
                                <span style={{
                                  marginLeft: 8,
                                  fontSize: 10,
                                  fontWeight: 600,
                                  padding: '2px 7px',
                                  borderRadius: 6,
                                  background: g.shiftContractType === 'Zero hours shift worker' ? '#fff3e0' : '#e3f2fd',
                                  color: g.shiftContractType === 'Zero hours shift worker' ? '#e65100' : '#1565c0',
                                  verticalAlign: 'middle',
                                  whiteSpace: 'nowrap',
                                }}>
                                  {g.shiftContractType === 'Zero hours shift worker' ? 'Zero Hours' : 'Employed'}
                                </span>
                              )}
                            </div>
                            <div className="sc-block-time">{formatTimeShort(g.template.start_time)} - {formatTimeShort(g.template.end_time)}</div>
                          </div>
                          <div className="sc-avatars" onClick={() => setPopupShift(g)}>
                            {g.employees.slice(0, showCount).map((emp, i) => (
                              <div
                                key={emp.id}
                                className="sc-avatar"
                                style={{ backgroundColor: avatarColor(emp.first_name + emp.last_name), zIndex: showCount - i, marginLeft: i > 0 ? -10 : 0 }}
                                title={`${emp.first_name} ${emp.last_name}`}
                              >
                                {emp.avatar_url
                                  ? <img src={emp.avatar_url} alt="" className="sc-avatar-img" />
                                  : getInitials(emp.first_name, emp.last_name)}
                              </div>
                            ))}
                            {extra > 0 && (
                              <div className="sc-avatar sc-avatar-more" style={{ marginLeft: -10, zIndex: 0 }}>+{extra}</div>
                            )}
                          </div>
                        </div>
                        <div className="sc-block-footer">
                          <span className="sc-block-count">
                            {g.employees.length} assigned
                            {g.template.break_minutes != null && g.template.break_minutes > 0 && ` · ${g.template.break_minutes}m break`}
                          </span>
                          {!isPast && <button className="sc-block-swap" onClick={() => navigate('/shifts/swap')}>{t('shifts.request_swap')}</button>}
                        </div>
                      </div>
                    )
                  })
                ) : (
                  myShiftsForDay.map(s => {
                    const cardColor = getCardColor(s.shift_template?.id || s.id)
                    const canEdit = s.rota?.status === 'draft'
                    const isEditing = editingId === s.id
                    const hasFlag = correctionFlags.some(f => f.assignmentId === s.id)

                    return (
                      <div
                        key={s.id}
                        className={`sc-block${isPast ? ' sc-block-past' : ''}`}
                        style={{ background: cardColor.bg, borderLeftColor: cardColor.border }}
                      >
                        <div className="sc-block-top">
                          <div className="sc-block-info">
                            <div className="sc-block-name" style={{ color: cardColor.text }}>
                              {s.shift_template?.name || 'Shift'}
                              {hasFlag && (
                                <span className="sc-correction-flag" title="Time correction required" onClick={() => setFilter('tasks')}>
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 9v4m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" stroke="#dc2626" strokeWidth="2.5" strokeLinecap="round"/></svg>
                                </span>
                              )}
                            </div>
                            <div className="sc-block-time">
                              {formatTimeShort(s.shift_template?.start_time || '')} - {formatTimeShort(s.shift_template?.end_time || '')}
                            </div>
                          </div>
                          <div className="sc-block-actions">
                            {!isPast && <button className="sc-block-swap" onClick={() => navigate('/shifts/swap')}>{t('shifts.request_swap')}</button>}
                            {canEdit && (
                              <button className="sc-block-edit" onClick={() => setEditingId(isEditing ? null : s.id)}>
                                {isEditing ? 'Cancel' : 'Edit'}
                              </button>
                            )}
                          </div>
                        </div>
                        {(s.shift_template?.break_minutes || s.rota?.name) && (
                          <div className="sc-block-meta">
                            {s.rota?.name}{s.rota?.name && s.shift_template?.break_minutes ? ' · ' : ''}{s.shift_template?.break_minutes ? `${s.shift_template.break_minutes}m break` : ''}
                          </div>
                        )}

                        {isEditing && (
                          <div className="schedule-edit-dropdown">
                            <label>Change shift template:</label>
                            <select
                              value={s.shift_template?.id || ''}
                              onChange={e => handleEditTemplate(s.id, e.target.value)}
                            >
                              <option value="" disabled>Select template...</option>
                              {templates.map(tmpl => (
                                <option key={tmpl.id} value={tmpl.id}>
                                  {tmpl.name} ({formatTimeShort(tmpl.start_time)} - {formatTimeShort(tmpl.end_time)})
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Popup: everyone on this shift */}
      {popupShift && (
        <div className="sc-popup-overlay" onClick={() => setPopupShift(null)}>
          <div className="sc-popup" onClick={e => e.stopPropagation()}>
            <div className="sc-popup-header">
              <div>
                <div className="sc-popup-title">
                  {popupShift.template.name}
                  {popupShift.shiftContractType && (
                    <span style={{
                      marginLeft: 8,
                      fontSize: 11,
                      fontWeight: 600,
                      padding: '2px 8px',
                      borderRadius: 6,
                      background: popupShift.shiftContractType === 'Zero hours shift worker' ? '#fff3e0' : '#e3f2fd',
                      color: popupShift.shiftContractType === 'Zero hours shift worker' ? '#e65100' : '#1565c0',
                      verticalAlign: 'middle',
                    }}>
                      {popupShift.shiftContractType === 'Zero hours shift worker' ? 'Zero Hours' : 'Employed'}
                    </span>
                  )}
                </div>
                <div className="sc-popup-time">
                  {formatTimeShort(popupShift.template.start_time)} - {formatTimeShort(popupShift.template.end_time)}
                </div>
              </div>
              <button className="sc-popup-close" onClick={() => setPopupShift(null)}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M15 5L5 15M5 5l10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
              </button>
            </div>
            <div className="sc-popup-list">
              {popupShift.employees.map(emp => (
                <div key={emp.id} className="sc-popup-person">
                  <div className="sc-popup-avatar" style={{ backgroundColor: avatarColor(emp.first_name + emp.last_name) }}>
                    {emp.avatar_url
                      ? <img src={emp.avatar_url} alt="" className="sc-avatar-img" />
                      : getInitials(emp.first_name, emp.last_name)}
                  </div>
                  <span className="sc-popup-name">{emp.first_name} {emp.last_name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
