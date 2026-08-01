import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'

interface LeaveBalance {
  leave_type_id: number
  total_allowance: number
  used: number
  carried_over: number
  leave_type_name: string
  colour: string
}

export default function MyLeave() {
  const navigate = useNavigate()
  const { t } = useLanguage()
  const { employeeId: EMPLOYEE_ID, employeeName: EMPLOYEE_NAME, employeeEmail: EMPLOYEE_EMAIL, companyUser } = useAuth()
  const [balances, setBalances] = useState<LeaveBalance[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [imOffState, setImOffState] = useState<'idle' | 'sending' | 'sent'>('idle')

  const loadData = useCallback(async () => {
    if (!EMPLOYEE_ID) return
    setLoading(true)
    const [balRes, pendReqRes, approvedReqRes] = await Promise.all([
      supabase
        .from('leave_balances')
        .select('leave_type_id, total_allowance, used, carried_over')
        .eq('employee_id', EMPLOYEE_ID)
        .eq('year', new Date().getFullYear()),
      supabase
        .from('leave_requests')
        .select('days_requested')
        .eq('employee_id', EMPLOYEE_ID)
        .eq('status', 'pending'),
      supabase
        .from('leave_requests')
        .select('days_requested')
        .eq('employee_id', EMPLOYEE_ID)
        .eq('status', 'approved'),
    ])

    const approvedDays = (approvedReqRes.data || []).reduce((s: number, r: any) => s + Number(r.days_requested), 0)
    const pendingDays = (pendReqRes.data || []).reduce((s: number, r: any) => s + Number(r.days_requested), 0)

    if (balRes.data && balRes.data.length > 0) {
      const typeIds = balRes.data.map((b: any) => b.leave_type_id)
      const { data: types } = await supabase
        .from('leave_types')
        .select('id, name, colour')
        .in('id', typeIds)

      const typeMap = new Map((types || []).map((lt: any) => [lt.id, lt]))
      const merged: LeaveBalance[] = balRes.data.map((b: any) => {
        const lt = typeMap.get(b.leave_type_id) || { name: 'Leave', colour: '#999' }
        return { ...b, used: lt.name === 'Annual Leave' ? approvedDays : b.used, leave_type_name: lt.name, colour: lt.colour }
      })
      setBalances(merged)
    }

    setPendingCount(pendingDays)
    setLoading(false)
  }, [EMPLOYEE_ID])

  useEffect(() => { loadData() }, [loadData])

  const primary = balances.find(b => b.leave_type_name === 'Annual Leave')
  const totalEntitlement = primary ? primary.total_allowance : 0
  const totalUsed = primary ? primary.used : 0
  const remaining = totalEntitlement - totalUsed
  const usedPct = totalEntitlement > 0 ? (totalUsed / totalEntitlement) * 100 : 0
  const pendingPct = totalEntitlement > 0 ? (pendingCount / totalEntitlement) * 100 : 0
  const circumference = 2 * Math.PI * 52

  function translateLeaveType(name: string): string {
    const keyMap: Record<string, string> = {
      'Annual Leave': 'my_leave.annual_leave',
      'Sick Leave': 'my_leave.sick_leave',
      'Compassionate Leave': 'my_leave.compassionate_leave',
      'Parental Leave': 'my_leave.parental_leave',
      'Jury Duty': 'my_leave.jury_duty',
      'Bereavement': 'my_leave.bereavement',
      'Exam Leave': 'my_leave.exam_leave',
      'Carers Leave': 'my_leave.carers_leave',
      'Career Break': 'my_leave.career_break',
      'Lieu Days': 'my_leave.lieu_days',
    }
    return keyMap[name] ? t(keyMap[name]) : name
  }

  async function handleImOff() {
    setImOffState('sending')

    await supabase.from('workflow_tracker').insert({
      emp_display_name: EMPLOYEE_NAME,
      step: 1,
      status: 'Complete',
      record_type: 'Notification',
      action: "I'm Off notification",
      employee_email: EMPLOYEE_EMAIL,
      assigned_to: EMPLOYEE_EMAIL,
      approval_id: null,
      reminder_count: 0,
      task_description: `${EMPLOYEE_NAME} is now off and away from the office.`,
      approval_status: null,
      company_id: companyUser?.company_id,
    })

    await supabase.from('notifications').insert({
      employee_id: EMPLOYEE_ID,
      title: `${EMPLOYEE_NAME} is Off`,
      message: `${EMPLOYEE_NAME} has marked themselves as away. They will not be available.`,
      type: 'info',
      link: '/leave',
      is_read: false,
      company_id: companyUser?.company_id,
    })

    window.dispatchEvent(new Event('notifications-updated'))
    setImOffState('sent')
    setTimeout(() => setImOffState('idle'), 3000)
  }

  if (loading) {
    return (
      <div className="feature-page">
        <p className="claims-empty">{t('common.loading')}</p>
      </div>
    )
  }

  return (
    <div className="feature-page my-leave-page">
      <header className="my-leave-header">
        <button className="new-claim-back" onClick={() => navigate('/')}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 className="new-claim-title">{t('my_leave.title')}</h1>
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          <button className="feature-refresh" onClick={loadData}>
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
              <circle cx="16" cy="16" r="14" stroke="#fff" strokeWidth="2" />
              <path d="M22 14a6.5 6.5 0 0 0-11.3-1.5M10 18a6.5 6.5 0 0 0 11.3 1.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
              <path d="M22 10v4h-4M10 22v-4h4" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button className="my-leave-add-btn" onClick={() => navigate('/leave/new')}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>
      </header>

      <div className="my-leave-summary">
        <div className="my-leave-ring-wrap">
          <svg viewBox="0 0 120 120" className="my-leave-ring">
            <circle cx="60" cy="60" r="52" fill="none" stroke="#e0e0e0" strokeWidth="10" />
            <circle
              cx="60" cy="60" r="52"
              fill="none"
              stroke="#43a047"
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={`${(usedPct / 100) * circumference} ${circumference}`}
              transform="rotate(-90 60 60)"
            />
            {pendingPct > 0 && (
              <circle
                cx="60" cy="60" r="52"
                fill="none"
                stroke="#ff9800"
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray={`${(pendingPct / 100) * circumference} ${circumference}`}
                strokeDashoffset={`${-(usedPct / 100) * circumference}`}
                transform="rotate(-90 60 60)"
              />
            )}
          </svg>
          <div className="my-leave-ring-center">
            <span className="my-leave-ring-value">{remaining}</span>
            <span className="my-leave-ring-label">{t('my_leave.remaining')}</span>
          </div>
        </div>

        <div className="my-leave-stats">
          <div className="my-leave-stat">
            <span className="my-leave-stat-value">{totalEntitlement}</span>
            <span className="my-leave-stat-label">{t('my_leave.entitlement')}</span>
          </div>
          <div className="my-leave-stat">
            <span className="my-leave-stat-value">{totalUsed}</span>
            <span className="my-leave-stat-label">{t('my_leave.used')}</span>
          </div>
          <div className="my-leave-stat">
            <span className="my-leave-stat-value my-leave-stat-pending">{pendingCount}</span>
            <span className="my-leave-stat-label">{t('my_leave.pending_days')}</span>
          </div>
        </div>
      </div>

      {balances.length > 0 && (
        <div className="my-leave-balances">
          {balances.map(b => {
            const rem = b.total_allowance - b.used
            const pct = b.total_allowance > 0 ? (b.used / b.total_allowance) * 100 : 0
            return (
              <div key={b.leave_type_id} className="my-leave-balance-row">
                <div className="my-leave-balance-info">
                  <span className="my-leave-balance-dot" style={{ background: b.colour }} />
                  <span className="my-leave-balance-name">{translateLeaveType(b.leave_type_name)}</span>
                </div>
                <div className="my-leave-balance-bar-wrap">
                  <div className="my-leave-balance-bar">
                    <div className="my-leave-balance-fill" style={{ width: `${pct}%`, background: b.colour }} />
                  </div>
                  <span className="my-leave-balance-count">{rem} {t('my_leave.of')} {b.total_allowance}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="my-leave-cards">
        <button className="my-leave-card" onClick={() => navigate('/leave/new')}>
          <div className="my-leave-card-icon my-leave-card-book">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
              <line x1="12" y1="14" x2="12" y2="18" />
              <line x1="10" y1="16" x2="14" y2="16" />
            </svg>
          </div>
          <div className="my-leave-card-text">
            <span className="my-leave-card-title">{t('my_leave.book_leave')}</span>
            <span className="my-leave-card-desc">{t('my_leave.book_leave_desc')}</span>
          </div>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>

        <button className="my-leave-card" onClick={() => navigate('/leave/history')}>
          <div className="my-leave-card-icon my-leave-card-history">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <div className="my-leave-card-text">
            <span className="my-leave-card-title">{t('my_leave.leave_history')}</span>
            <span className="my-leave-card-desc">{t('my_leave.leave_history_desc')}</span>
          </div>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>

        <button className="my-leave-card" onClick={() => navigate('/leave/calendar')}>
          <div className="my-leave-card-icon my-leave-card-types">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
              <circle cx="8" cy="14" r="1" fill="#fff" />
              <circle cx="12" cy="14" r="1" fill="#fff" />
              <circle cx="16" cy="14" r="1" fill="#fff" />
            </svg>
          </div>
          <div className="my-leave-card-text">
            <span className="my-leave-card-title">{t('my_leave.leave_calendar')}</span>
            <span className="my-leave-card-desc">{t('my_leave.leave_calendar_desc')}</span>
          </div>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      <button
        className={`my-leave-im-off-btn ${imOffState === 'sent' ? 'my-leave-im-off-sent' : ''}`}
        onClick={handleImOff}
        disabled={imOffState !== 'idle'}
      >
        {imOffState === 'idle' && (
          <>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            <span>{t('my_leave.im_off')}</span>
          </>
        )}
        {imOffState === 'sending' && <span>{t('my_leave.im_off_sending')}</span>}
        {imOffState === 'sent' && (
          <>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span>{t('my_leave.im_off_sent')}</span>
          </>
        )}
      </button>

      <p className="my-leave-im-off-hint">{t('my_leave.im_off_desc')}</p>
    </div>
  )
}
