import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

interface DayAvailability {
  day_of_week: number
  is_available: boolean
  available_from: string
  available_to: string
  recurring: boolean
}

function defaultDays(): DayAvailability[] {
  return DAY_NAMES.map((_, i) => ({
    day_of_week: i,
    is_available: i < 5,
    available_from: '09:00',
    available_to: '17:00',
    recurring: true,
  }))
}

function calcHours(from: string, to: string): string {
  const [fh, fm] = from.split(':').map(Number)
  const [th, tm] = to.split(':').map(Number)
  let h = th - fh + (tm - fm) / 60
  if (h < 0) h += 24
  return h.toFixed(1)
}

export default function Availability() {
  const navigate = useNavigate()
  const { t } = useLanguage()
  const { employeeId, companyUser } = useAuth()
  const [days, setDays] = useState<DayAvailability[]>(defaultDays())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [expandedDay, setExpandedDay] = useState<number | null>(null)

  const fetchAvailability = useCallback(async () => {
    if (!employeeId || !companyUser?.company_id) return
    setLoading(true)
    const { data } = await supabase
      .from('employee_availability')
      .select('day_of_week, is_available, start_time, end_time, recurring')
      .eq('employee_id', employeeId)
      .eq('company_id', companyUser.company_id)
      .order('day_of_week', { ascending: true })

    if (data && data.length > 0) {
      const merged = defaultDays().map(d => {
        const existing = data.find((r: any) => r.day_of_week === d.day_of_week)
        return existing
          ? {
              day_of_week: existing.day_of_week,
              is_available: existing.is_available,
              available_from: (existing.start_time || '09:00').slice(0, 5),
              available_to: (existing.end_time || '17:00').slice(0, 5),
              recurring: existing.recurring ?? true,
            }
          : d
      })
      setDays(merged)
    }
    setLoading(false)
  }, [employeeId, companyUser?.company_id])

  useEffect(() => { fetchAvailability() }, [fetchAvailability])

  function updateDay(index: number, updates: Partial<DayAvailability>) {
    setDays(prev => prev.map((d, i) => (i === index ? { ...d, ...updates } : d)))
    setSaved(false)
  }

  function toggleDay(index: number) {
    updateDay(index, { is_available: !days[index].is_available })
  }

  async function handleSave() {
    if (!employeeId || !companyUser?.company_id) return
    setSaving(true)

    for (const d of days) {
      const row = {
        employee_id: employeeId,
        company_id: companyUser.company_id,
        day_of_week: d.day_of_week,
        is_available: d.is_available,
        start_time: d.available_from,
        end_time: d.available_to,
        recurring: d.recurring,
      }

      const { data: existing } = await supabase
        .from('employee_availability')
        .select('id')
        .eq('employee_id', employeeId)
        .eq('company_id', companyUser.company_id)
        .eq('day_of_week', d.day_of_week)
        .maybeSingle()

      if (existing) {
        await supabase
          .from('employee_availability')
          .update({ is_available: row.is_available, start_time: row.start_time, end_time: row.end_time, recurring: row.recurring })
          .eq('id', existing.id)
      } else {
        await supabase
          .from('employee_availability')
          .insert(row)
      }
    }

    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  const availCount = days.filter(d => d.is_available).length
  const totalHours = days
    .filter(d => d.is_available)
    .reduce((sum, d) => sum + parseFloat(calcHours(d.available_from, d.available_to)), 0)

  if (loading) {
    return (
      <div className="feature-page">
        <p className="claims-empty">{t('common.loading')}</p>
      </div>
    )
  }

  return (
    <div className="avail-page">
      {/* Header */}
      <header className="schedule-header">
        <button className="feature-back" onClick={() => navigate('/shifts')}>
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
            <circle cx="18" cy="18" r="17" stroke="#c62828" strokeWidth="2" />
            <path d="M21 12l-6 6 6 6" stroke="#c62828" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="feature-header-center">
          <h1 className="feature-title">{t('shifts.availability_title')}</h1>
        </div>
        <button className="feature-refresh" onClick={fetchAvailability}>
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="14" stroke="#c62828" strokeWidth="2" />
            <path d="M22 14a6.5 6.5 0 0 0-11.3-1.5M10 18a6.5 6.5 0 0 0 11.3 1.5" stroke="#c62828" strokeWidth="2" strokeLinecap="round" />
            <path d="M22 10v4h-4M10 22v-4h4" stroke="#c62828" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </header>

      {/* Summary Cards */}
      <div className="avail-summary">
        <div className="avail-stat">
          <div className="avail-stat-value avail-stat-green">{availCount}</div>
          <div className="avail-stat-label">Days available</div>
        </div>
        <div className="avail-stat">
          <div className="avail-stat-value avail-stat-blue">{totalHours.toFixed(0)}h</div>
          <div className="avail-stat-label">Weekly hours</div>
        </div>
        <div className="avail-stat">
          <div className="avail-stat-value avail-stat-orange">{7 - availCount}</div>
          <div className="avail-stat-label">Days off</div>
        </div>
      </div>

      {/* Week Overview Strip */}
      <div className="avail-week-strip">
        {days.map((d, i) => (
          <button
            key={i}
            className={`avail-week-day ${d.is_available ? 'avail-week-on' : 'avail-week-off'}`}
            onClick={() => toggleDay(i)}
          >
            <span className="avail-week-letter">{DAY_SHORT[i]}</span>
            <span className={`avail-week-dot ${d.is_available ? 'dot-on' : 'dot-off'}`} />
          </button>
        ))}
      </div>

      {/* Day Cards */}
      <div className="avail-days">
        {days.map((d, i) => {
          const isExpanded = expandedDay === i
          const isWeekend = i >= 5
          return (
            <div
              key={i}
              className={`avail-card ${d.is_available ? 'avail-card-on' : 'avail-card-off'}`}
            >
              <div className="avail-card-header" onClick={() => setExpandedDay(isExpanded ? null : i)}>
                <div className="avail-card-left">
                  <div className={`avail-card-icon ${d.is_available ? 'icon-on' : 'icon-off'}`}>
                    {isWeekend ? (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
                    )}
                  </div>
                  <div>
                    <div className="avail-card-name">{DAY_NAMES[i]}</div>
                    {d.is_available && (
                      <div className="avail-card-hours">{d.available_from} – {d.available_to} ({calcHours(d.available_from, d.available_to)}h)</div>
                    )}
                  </div>
                </div>
                <div className="avail-card-right">
                  <button
                    className={`avail-pill ${d.is_available ? 'avail-pill-on' : 'avail-pill-off'}`}
                    onClick={e => { e.stopPropagation(); toggleDay(i) }}
                  >
                    {d.is_available ? t('shifts.available') : t('shifts.unavailable')}
                  </button>
                  <svg
                    width="16" height="16" viewBox="0 0 16 16" fill="none"
                    className={`avail-chevron ${isExpanded ? 'avail-chevron-open' : ''}`}
                  >
                    <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </div>

              {isExpanded && d.is_available && (
                <div className="avail-card-body">
                  <div className="avail-time-row">
                    <div className="avail-time-field">
                      <label>{t('shifts.from')}</label>
                      <input
                        type="time"
                        value={d.available_from}
                        onChange={e => updateDay(i, { available_from: e.target.value })}
                      />
                    </div>
                    <div className="avail-time-sep">
                      <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M4 10h12M12 6l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </div>
                    <div className="avail-time-field">
                      <label>{t('shifts.to')}</label>
                      <input
                        type="time"
                        value={d.available_to}
                        onChange={e => updateDay(i, { available_to: e.target.value })}
                      />
                    </div>
                  </div>
                  <label className="avail-recurring">
                    <input
                      type="checkbox"
                      checked={d.recurring}
                      onChange={e => updateDay(i, { recurring: e.target.checked })}
                    />
                    <span>{t('shifts.recurring')}</span>
                  </label>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Save Button */}
      <button
        className={`avail-save ${saved ? 'avail-save-done' : ''}`}
        onClick={handleSave}
        disabled={saving}
      >
        {saving ? t('shifts.saving') : saved ? t('shifts.saved') : t('shifts.save_availability')}
      </button>
    </div>
  )
}
