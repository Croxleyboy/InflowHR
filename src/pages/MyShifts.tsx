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

const PASTEL_MAP: Record<string, { bg: string; text: string }> = {}
function getPastel(colour: string): { bg: string; text: string } {
  if (PASTEL_MAP[colour]) return PASTEL_MAP[colour]
  const hex = colour.replace('#', '')
  const r = parseInt(hex.substring(0, 2), 16)
  const g = parseInt(hex.substring(2, 4), 16)
  const b = parseInt(hex.substring(4, 6), 16)
  const bg = `rgba(${r}, ${g}, ${b}, 0.18)`
  const text = `rgb(${Math.max(0, r - 40)}, ${Math.max(0, g - 40)}, ${Math.max(0, b - 40)})`
  PASTEL_MAP[colour] = { bg, text }
  return PASTEL_MAP[colour]
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
    const { data } = await supabase
      .from('shift_assignments')
      .select('*, shift_template:shift_templates(id, name, start_time, end_time, break_minutes, colour), rota:rotas(id, name, status)')
      .eq('employee_id', employeeId)
      .eq('company_id', companyUser.company_id)

    const published = (data || []).filter((s: any) => s.rota?.status === 'published' || s.rota?.status === 'draft')
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
      <div className="my-schedule">
        <p className="claims-empty">{t('common.loading')}</p>
      </div>
    )
  }

  return (
    <div className="my-schedule">
      <header className="schedule-header">
        <button className="feature-back" onClick={() => navigate('/')}>
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
            <circle cx="18" cy="18" r="17" stroke="#c62828" strokeWidth="2" />
            <path d="M21 12l-6 6 6 6" stroke="#c62828" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="feature-header-center">
          <h1 className="feature-title">{t('shifts.title')}</h1>
        </div>
        <button className="feature-refresh" onClick={handleRefresh}>
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="14" stroke="#c62828" strokeWidth="2" />
            <path d="M22 14a6.5 6.5 0 0 0-11.3-1.5M10 18a6.5 6.5 0 0 0 11.3 1.5" stroke="#c62828" strokeWidth="2" strokeLinecap="round" />
            <path d="M22 10v4h-4M10 22v-4h4" stroke="#c62828" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
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
      <div className="schedule-filters">
        {([
          { key: 'only_me' as FilterTab, label: 'Only me' },
          { key: 'everyone' as FilterTab, label: 'Everyone' },
          { key: 'availability' as FilterTab, label: 'Availability' },
          { key: 'replacements' as FilterTab, label: 'Replacements' },
        ]).map(f => (
          <button
            key={f.key}
            className={`schedule-filter-btn${filter === f.key ? ' schedule-filter-active' : ''}`}
            onClick={() => { setFilter(f.key); if (f.key === 'availability') navigate('/shifts/availability') }}
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
                    const colour = g.template.colour || '#999'
                    const pastel = getPastel(colour)
                    const showCount = Math.min(g.employees.length, 3)
                    const extra = g.employees.length - showCount

                    return (
                      <div
                        key={`${g.date}-${g.templateId}`}
                        className="sc-block"
                        style={{ background: pastel.bg, borderLeftColor: colour }}
                      >
                        <div className="sc-block-top">
                          <div className="sc-block-info">
                            <div className="sc-block-name" style={{ color: pastel.text }}>{g.template.name}</div>
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
                        {g.template.break_minutes != null && g.template.break_minutes > 0 && (
                          <div className="sc-block-meta">{t('shifts.break_label')}: {g.template.break_minutes} {t('shifts.mins')}</div>
                        )}
                        <div className="sc-block-footer">
                          <span className="sc-block-count">{g.employees.length} assigned</span>
                          <button className="sc-block-swap" onClick={() => navigate('/shifts/swap')}>{t('shifts.request_swap')}</button>
                        </div>
                      </div>
                    )
                  })
                ) : (
                  myShiftsForDay.map(s => {
                    const colour = s.shift_template?.colour || '#999'
                    const pastel = getPastel(colour)
                    const canEdit = s.rota?.status === 'draft'
                    const isEditing = editingId === s.id

                    return (
                      <div
                        key={s.id}
                        className="sc-block"
                        style={{ background: pastel.bg, borderLeftColor: colour }}
                      >
                        <div className="sc-block-top">
                          <div className="sc-block-info">
                            <div className="sc-block-name" style={{ color: pastel.text }}>{s.shift_template?.name || 'Shift'}</div>
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
                        {s.shift_template?.break_minutes != null && s.shift_template.break_minutes > 0 && (
                          <div className="sc-block-meta">{t('shifts.break_label')}: {s.shift_template.break_minutes} {t('shifts.mins')}</div>
                        )}
                        {s.rota?.name && <div className="sc-block-meta">{s.rota.name}</div>}

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
