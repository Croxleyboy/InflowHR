import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'

interface ShiftAssignment {
  id: string
  date: string
  shift_template: {
    name: string
    start_time: string
    end_time: string
    break_minutes: number
    colour: string
  } | null
  rota: {
    name: string
    status: string
  } | null
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  return `${dd}/${mm}/${yyyy} - ${days[d.getDay()]}`
}

function formatTime(time: string): string {
  return time?.slice(0, 5) || ''
}

export default function MyShifts() {
  const navigate = useNavigate()
  const { t } = useLanguage()
  const { employeeId, companyUser } = useAuth()
  const [shifts, setShifts] = useState<ShiftAssignment[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'upcoming' | 'history'>('upcoming')

  const fetchShifts = useCallback(async () => {
    if (!employeeId || !companyUser?.company_id) return
    setLoading(true)
    const { data } = await supabase
      .from('shift_assignments')
      .select('*, shift_template:shift_templates(name, start_time, end_time, break_minutes, colour), rota:rotas(name, status)')
      .eq('employee_id', employeeId)
      .eq('company_id', companyUser.company_id)

    const published = (data || []).filter((s: any) => s.rota?.status === 'published')
    setShifts(published as ShiftAssignment[])
    setLoading(false)
  }, [employeeId, companyUser?.company_id])

  useEffect(() => { fetchShifts() }, [fetchShifts])

  const today = new Date().toISOString().split('T')[0]

  const upcoming = shifts
    .filter(s => s.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))

  const history = shifts
    .filter(s => s.date < today)
    .sort((a, b) => b.date.localeCompare(a.date))

  const displayed = tab === 'upcoming' ? upcoming : history

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
        <button className="feature-back" onClick={() => navigate('/')}>
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
            <circle cx="18" cy="18" r="17" stroke="#c62828" strokeWidth="2" />
            <path d="M21 12l-6 6 6 6" stroke="#c62828" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="feature-header-center">
          <h1 className="feature-title">{t('shifts.title')}</h1>
        </div>
        <button className="feature-refresh" onClick={fetchShifts}>
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="14" stroke="#c62828" strokeWidth="2" />
            <path d="M22 14a6.5 6.5 0 0 0-11.3-1.5M10 18a6.5 6.5 0 0 0 11.3 1.5" stroke="#c62828" strokeWidth="2" strokeLinecap="round" />
            <path d="M22 10v4h-4M10 22v-4h4" stroke="#c62828" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </header>

      <div className="expense-filters" style={{ marginBottom: 16 }}>
        <button
          className={`expense-filter-btn ${tab === 'upcoming' ? 'active' : ''}`}
          onClick={() => setTab('upcoming')}
        >
          {t('shifts.upcoming')}
        </button>
        <button
          className={`expense-filter-btn ${tab === 'history' ? 'active' : ''}`}
          onClick={() => setTab('history')}
        >
          {t('shifts.history')}
        </button>
      </div>

      {displayed.length === 0 ? (
        <p className="claims-empty">
          {tab === 'upcoming' ? t('shifts.no_upcoming') : t('shifts.no_history')}
        </p>
      ) : (
        <div className="claims-list">
          {displayed.map(s => (
            <div key={s.id} className="claim-card" style={{ borderLeft: `4px solid ${s.shift_template?.colour || '#999'}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: s.shift_template?.colour || '#999',
                    display: 'inline-block',
                    flexShrink: 0,
                  }}
                />
                <strong>{s.shift_template?.name || 'Shift'}</strong>
              </div>
              <p style={{ margin: '2px 0', color: 'var(--text-secondary)', fontSize: 14 }}>
                {formatDate(s.date)}
              </p>
              <p style={{ margin: '2px 0', fontSize: 14 }}>
                {formatTime(s.shift_template?.start_time || '')} &ndash; {formatTime(s.shift_template?.end_time || '')}
              </p>
              {s.shift_template?.break_minutes != null && s.shift_template.break_minutes > 0 && (
                <p style={{ margin: '2px 0', fontSize: 13, color: 'var(--text-muted)' }}>
                  {t('shifts.break_label')}: {s.shift_template.break_minutes} {t('shifts.mins')}
                </p>
              )}
              {s.rota?.name && (
                <p style={{ margin: '2px 0', fontSize: 12, color: 'var(--text-muted)' }}>
                  {s.rota.name}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
