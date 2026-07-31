import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'
import { useFeatures } from '../context/FeatureContext'

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
  shift_template: ShiftTemplate | null
  rota: {
    id: string
    name: string
    status: string
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
}

type FilterTab = 'only_me' | 'everyone' | 'availability' | 'replacements'

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

function formatTimeShort(time: string): string {
  if (!time) return ''
  const [hh, mm] = time.split(':').map(Number)
  const ampm = hh >= 12 ? 'pm' : 'am'
  const h = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh
  return mm === 0 ? `${h}${ampm}` : `${h}:${String(mm).padStart(2, '0')}${ampm}`
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
  const { employeeId, companyUser } = useAuth()
  const { features } = useFeatures()
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
    const { data: rawCheck } = await supabase
      .from('shift_assignments')
      .select('id, date, employee_id, rota_id, shift_template_id')
      .eq('employee_id', employeeId)
      .eq('company_id', companyUser.company_id)
    console.log('[MyShifts] RAW rows (no joins):', rawCheck?.length, rawCheck?.map((r: any) => ({ date: r.date, rota: r.rota_id, tpl: r.shift_template_id })))

    const { data, error } = await supabase
      .from('shift_assignments')
      .select('*, shift_template:shift_templates(id, name, start_time, end_time, break_minutes, colour), rota:rotas(id, name, status)')
      .eq('employee_id', employeeId)
      .eq('company_id', companyUser.company_id)

    if (error) console.error('[MyShifts] fetch error:', error)
    console.log('[MyShifts] with joins count:', data?.length, 'employeeId:', employeeId)
    if (data) {
      console.log('[MyShifts] all dates:', data.map((s: any) => `${s.date} rota=${s.rota?.name}(${s.rota?.status}) tpl=${s.shift_template?.name}`))
    }
    const published = (data || []).filter((s: any) => s.rota?.status === 'published' || s.rota?.status === 'draft')
    console.log('[MyShifts] after rota filter:', published.length, 'dates:', published.map((s: any) => s.date))
    setShifts(published as ShiftAssignment[])
    setLoading(false)
  }, [employeeId, companyUser?.company_id])

  const fetchAllShifts = useCallback(async () => {
    if (!companyUser?.company_id) return
    const [shiftRes, empRes] = await Promise.all([
      supabase
        .from('shift_assignments')
        .select('*, shift_template:shift_templates(id, name, start_time, end_time, break_minutes, colour), rota:rotas(id, name, status)')
        .eq('company_id', companyUser.company_id),
      supabase
        .from('employees')
        .select('id, first_name, last_name, avatar_url')
        .eq('company_id', companyUser.company_id)
        .eq('is_active', true),
    ])

    const published = (shiftRes.data || []).filter((s: any) => s.rota?.status === 'published' || s.rota?.status === 'draft')
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

  useEffect(() => {
    fetchMyShifts()
    fetchTemplates()
  }, [fetchMyShifts, fetchTemplates])

  useEffect(() => {
    if (filter === 'everyone') fetchAllShifts()
  }, [filter, fetchAllShifts])

  const handleRefresh = useCallback(() => {
    fetchMyShifts()
    if (filter === 'everyone') fetchAllShifts()
    fetchTemplates()
  }, [fetchMyShifts, fetchAllShifts, fetchTemplates, filter])

  const activeShifts = filter === 'everyone' ? allShifts : shifts

  const groupedByDate = useMemo(() => {
    const map: Record<string, GroupedShift[]> = {}
    for (const day of weekDays) map[toDateStr(day)] = []

    const byDateTemplate: Record<string, { assignments: ShiftAssignment[]; template: ShiftTemplate }> = {}
    for (const s of activeShifts) {
      if (!s.shift_template) continue
      const key = `${s.date}|${s.shift_template.id}`
      if (!byDateTemplate[key]) {
        byDateTemplate[key] = { assignments: [], template: s.shift_template }
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
        ]).map(f => (
          <button
            key={f.key}
            className={`shifts-tab${filter === f.key ? ' shifts-tab-active' : ''}`}
            onClick={() => { setFilter(f.key); if (f.key === 'availability') navigate('/shifts/availability'); if (f.key === 'replacements') navigate('/shifts/swap') }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Shift List */}
      <div className="schedule-shift-list">
        {filter === 'replacements' ? (
          <div className="schedule-no-shift" style={{ textAlign: 'center', padding: '32px 0' }}>
            <p>No replacement requests at this time.</p>
          </div>
        ) : (
          weekDays.map(day => {
            const dateStr = toDateStr(day)
            const dayNum = String(day.getDate()).padStart(2, '0')
            const dayName = DAY_LABELS[day.getDay()]
            const isToday = isSameDay(day, today)

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
                        className="sc-block"
                        style={{ background: cardColor.bg, borderLeftColor: cardColor.border }}
                      >
                        <div className="sc-block-top">
                          <div className="sc-block-info">
                            <div className="sc-block-name" style={{ color: cardColor.text }}>{g.template.name}</div>
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
                          <button className="sc-block-swap" onClick={() => navigate('/shifts/swap')}>{t('shifts.request_swap')}</button>
                        </div>
                      </div>
                    )
                  })
                ) : (
                  myShiftsForDay.map(s => {
                    const cardColor = getCardColor(s.shift_template?.id || s.id)
                    const canEdit = s.rota?.status === 'draft'
                    const isEditing = editingId === s.id

                    return (
                      <div
                        key={s.id}
                        className="sc-block"
                        style={{ background: cardColor.bg, borderLeftColor: cardColor.border }}
                      >
                        <div className="sc-block-top">
                          <div className="sc-block-info">
                            <div className="sc-block-name" style={{ color: cardColor.text }}>{s.shift_template?.name || 'Shift'}</div>
                            <div className="sc-block-time">
                              {formatTimeShort(s.shift_template?.start_time || '')} - {formatTimeShort(s.shift_template?.end_time || '')}
                            </div>
                          </div>
                          <div className="sc-block-actions">
                            <button className="sc-block-swap" onClick={() => navigate('/shifts/swap')}>{t('shifts.request_swap')}</button>
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
                <div className="sc-popup-title">{popupShift.template.name}</div>
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
