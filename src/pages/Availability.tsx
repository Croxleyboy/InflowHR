import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

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
    is_available: true,
    available_from: '09:00',
    available_to: '17:00',
    recurring: true,
  }))
}

export default function Availability() {
  const navigate = useNavigate()
  const { t } = useLanguage()
  const { employeeId, companyUser } = useAuth()
  const [days, setDays] = useState<DayAvailability[]>(defaultDays())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const fetchAvailability = useCallback(async () => {
    if (!employeeId || !companyUser?.company_id) return
    setLoading(true)

    const { data } = await supabase
      .from('employee_availability')
      .select('day_of_week, is_available, available_from, available_to, recurring')
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
              available_from: (existing.available_from || '09:00').slice(0, 5),
              available_to: (existing.available_to || '17:00').slice(0, 5),
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

  async function handleSave() {
    if (!employeeId || !companyUser?.company_id) return
    setSaving(true)

    const rows = days.map(d => ({
      employee_id: employeeId,
      company_id: companyUser.company_id,
      day_of_week: d.day_of_week,
      is_available: d.is_available,
      available_from: d.available_from,
      available_to: d.available_to,
      recurring: d.recurring,
    }))

    await supabase
      .from('employee_availability')
      .upsert(rows, { onConflict: 'employee_id,day_of_week' })

    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  if (loading) {
    return (
      <div className="feature-page">
        <p className="claims-empty">{t('common.loading')}</p>
      </div>
    )
  }

  return (
    <div className="feature-page">
      <header className="feature-header">
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

      <div className="claims-list">
        {days.map((d, i) => (
          <div key={d.day_of_week} className="claim-card" style={{ borderLeft: `4px solid ${d.is_available ? '#4caf50' : '#9e9e9e'}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <strong style={{ fontSize: 15 }}>{DAY_NAMES[i]}</strong>
              <button
                onClick={() => updateDay(i, { is_available: !d.is_available })}
                style={{
                  padding: '4px 14px',
                  borderRadius: 20,
                  border: 'none',
                  fontSize: 12,
                  fontWeight: 700,
                  color: '#fff',
                  background: d.is_available ? '#4caf50' : '#9e9e9e',
                  cursor: 'pointer',
                }}
              >
                {d.is_available ? t('shifts.available') : t('shifts.unavailable')}
              </button>
            </div>

            {d.is_available && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <label style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('shifts.from')}</label>
                  <input
                    type="time"
                    value={d.available_from}
                    onChange={e => updateDay(i, { available_from: e.target.value })}
                    style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border-color, #ddd)', fontSize: 14 }}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <label style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('shifts.to')}</label>
                  <input
                    type="time"
                    value={d.available_to}
                    onChange={e => updateDay(i, { available_to: e.target.value })}
                    style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border-color, #ddd)', fontSize: 14 }}
                  />
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-muted)', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={d.recurring}
                    onChange={e => updateDay(i, { recurring: e.target.checked })}
                  />
                  {t('shifts.recurring')}
                </label>
              </div>
            )}
          </div>
        ))}
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        style={{
          width: '100%',
          marginTop: 20,
          padding: 14,
          borderRadius: 12,
          border: 'none',
          background: saved ? '#4caf50' : '#c62828',
          color: '#fff',
          fontWeight: 700,
          fontSize: 16,
          cursor: saving ? 'not-allowed' : 'pointer',
        }}
      >
        {saving ? t('shifts.saving') : saved ? t('shifts.saved') : t('shifts.save_availability')}
      </button>
    </div>
  )
}
