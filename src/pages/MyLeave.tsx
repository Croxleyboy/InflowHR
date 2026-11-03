import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { getManagerEmail } from '../lib/workflow'
import { getFYRange } from '../lib/formatters'

interface LeaveBalance {
  leave_type_id: number
  total_allowance: number
  used: number
  pending: number
  carried_over: number
  lieu_days: number
  leave_type_name: string
  colour: string
}

interface OtherLeaveType {
  leave_type_id: number
  name: string
  colour: string
  approved: number
  pending: number
}

export default function MyLeave() {
  const navigate = useNavigate()
  const { t } = useLanguage()
  const { employeeId: EMPLOYEE_ID, employeeName: EMPLOYEE_NAME, employeeEmail: EMPLOYEE_EMAIL, companyUser } = useAuth()
  const { showError } = useToast()
  const [balances, setBalances] = useState<LeaveBalance[]>([])
  const [otherTypes, setOtherTypes] = useState<OtherLeaveType[]>([])
  const [loading, setLoading] = useState(true)
  const [imOffState, setImOffState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [isZeroHours, setIsZeroHours] = useState(false)
  const [zhHolidayMethod, setZhHolidayMethod] = useState<'accrual' | 'rolled_up'>('rolled_up')
  const [zhAccrualRate, setZhAccrualRate] = useState(12.07)

  const loadData = useCallback(async () => {
    if (!EMPLOYEE_ID) return
    setLoading(true)
    const { data: co } = await supabase.from('companies').select('fy_start_month').eq('id', companyUser?.company_id).single()
    const { fyYear, fyStart, fyEnd } = getFYRange(co?.fy_start_month || 4)

    const { data: empData } = await supabase.from('employees').select('employment_category, contract_type').eq('id', EMPLOYEE_ID).single()
    const zh = empData?.employment_category === 'shift_worker' && empData?.contract_type === 'Zero hours shift worker'
    setIsZeroHours(zh)
    if (zh && companyUser?.company_id) {
      const { data: wts } = await supabase.from('worker_type_settings').select('holiday_pay_method, holiday_accrual_rate').eq('company_id', companyUser.company_id).eq('worker_type', 'zero_hours').maybeSingle()
      setZhHolidayMethod((wts?.holiday_pay_method as 'accrual' | 'rolled_up') || 'rolled_up')
      setZhAccrualRate(wts?.holiday_accrual_rate ?? 12.07)
    }

    const [balRes, allReqRes] = await Promise.all([
      supabase
        .from('leave_balances')
        .select('leave_type_id, total_allowance, used, carried_over, lieu_days')
        .eq('employee_id', EMPLOYEE_ID)
        .eq('company_id', companyUser?.company_id)
        .eq('year', fyYear),
      supabase
        .from('leave_requests')
        .select('leave_type_id, days_requested, status')
        .eq('employee_id', EMPLOYEE_ID)
        .eq('company_id', companyUser?.company_id)
        .in('status', ['approved', 'pending'])
        .gte('start_date', fyStart)
        .lte('start_date', fyEnd),
    ])

    const approvedByType = new Map<number, number>()
    const pendingByType = new Map<number, number>()
    for (const r of allReqRes.data || []) {
      const days = Number(r.days_requested)
      if (r.status === 'approved') {
        approvedByType.set(r.leave_type_id, (approvedByType.get(r.leave_type_id) || 0) + days)
      } else {
        pendingByType.set(r.leave_type_id, (pendingByType.get(r.leave_type_id) || 0) + days)
      }
    }

    const balanceTypeIds = new Set<number>()
    if (balRes.data && balRes.data.length > 0) {
      const typeIds = balRes.data.map((b: any) => b.leave_type_id)
      typeIds.forEach((id: number) => balanceTypeIds.add(id))
      const { data: types } = await supabase.from('leave_types').select('id, name, colour').in('id', typeIds)
      const typeMap = new Map((types || []).map((lt: any) => [lt.id, lt]))
      const merged: LeaveBalance[] = balRes.data.map((b: any) => {
        const lt = typeMap.get(b.leave_type_id) || { name: 'Leave', colour: '#999' }
        return {
          ...b,
          used: approvedByType.get(b.leave_type_id) || 0,
          pending: pendingByType.get(b.leave_type_id) || 0,
          lieu_days: Number(b.lieu_days) || 0,
          leave_type_name: lt.name,
          colour: lt.colour,
        }
      })
      setBalances(merged)
    } else {
      setBalances([])
    }

    const otherTypeIds = new Set<number>()
    for (const id of approvedByType.keys()) { if (!balanceTypeIds.has(id)) otherTypeIds.add(id) }
    for (const id of pendingByType.keys()) { if (!balanceTypeIds.has(id)) otherTypeIds.add(id) }

    if (otherTypeIds.size > 0) {
      const { data: otherTypesData } = await supabase.from('leave_types').select('id, name, colour').in('id', [...otherTypeIds])
      const others: OtherLeaveType[] = (otherTypesData || []).map((lt: any) => ({
        leave_type_id: lt.id,
        name: lt.name,
        colour: lt.colour,
        approved: approvedByType.get(lt.id) || 0,
        pending: pendingByType.get(lt.id) || 0,
      }))
      setOtherTypes(others)
    } else {
      setOtherTypes([])
    }

    setLoading(false)
  }, [EMPLOYEE_ID])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    const onFocus = () => { if (EMPLOYEE_ID) loadData() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [loadData, EMPLOYEE_ID])

  const primary = balances.find(b => b.leave_type_name === 'Annual Leave')
  const basAllowance = primary ? primary.total_allowance : 0
  const primaryLieu = primary ? (primary.lieu_days || 0) : 0
  const primaryCarried = primary ? (primary.carried_over || 0) : 0
  const primaryPending = primary ? primary.pending : 0
  const totalEntitlement = basAllowance + primaryLieu + primaryCarried
  const totalUsed = primary ? primary.used : 0
  const remaining = totalEntitlement - totalUsed
  const usedPct = totalEntitlement > 0 ? (totalUsed / totalEntitlement) * 100 : 0
  const pendingPct = totalEntitlement > 0 ? (primaryPending / totalEntitlement) * 100 : 0
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

    const now = new Date()
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const { data: todayLeave } = await supabase
      .from('leave_requests')
      .select('id')
      .eq('employee_id', EMPLOYEE_ID)
      .eq('company_id', companyUser?.company_id)
      .eq('status', 'approved')
      .lte('start_date', todayStr)
      .gte('end_date', todayStr)
      .limit(1)

    if (!todayLeave || todayLeave.length === 0) {
      showError(t('my_leave.im_off_no_leave'))
      setImOffState('idle')
      return
    }

    const managerEmail = await getManagerEmail(EMPLOYEE_ID, EMPLOYEE_EMAIL, 'leave')

    const { error: wfError } = await supabase.from('workflow_tracker').insert({
      emp_display_name: EMPLOYEE_NAME,
      step: 1,
      status: 'Complete',
      record_type: 'Notification',
      action: "I'm Off notification",
      employee_email: EMPLOYEE_EMAIL,
      assigned_to: managerEmail,
      approval_id: null,
      reminder_count: 0,
      task_description: `${EMPLOYEE_NAME} is now off and away from the office.`,
      approval_status: null,
      company_id: companyUser?.company_id,
    })
    if (wfError) showError('Failed to create workflow tracker: ' + wfError.message)

    const { error: notifError } = await supabase.from('notifications').insert({
      employee_id: EMPLOYEE_ID,
      title: `${EMPLOYEE_NAME} is Off`,
      message: `${EMPLOYEE_NAME} has marked themselves as away. They will not be available.`,
      type: 'info',
      link: '/leave',
      is_read: false,
      company_id: companyUser?.company_id,
    })
    if (notifError) showError('Failed to create notification: ' + notifError.message)

    window.dispatchEvent(new Event('notifications-updated'))
    setImOffState('sent')
    setTimeout(() => setImOffState('idle'), 3000)
  }

  const fmt = (v: number) => isZeroHours ? v.toFixed(1) : String(v)

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

      {isZeroHours && zhHolidayMethod === 'rolled_up' && (
        <div style={{ margin: '0 0 16px', padding: 16, background: '#f0f9ff', borderRadius: 10, border: '1px solid #bfdbfe' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>Holiday Pay — Rolled Up</span>
            <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: '#dbeafe', color: '#1e40af', fontWeight: 600 }}>UK Statutory</span>
          </div>
          <p style={{ fontSize: 13, color: '#374151', margin: 0, lineHeight: 1.5 }}>
            Your holiday pay is included as a {zhAccrualRate}% uplift on each payslip. You can still book time off for record-keeping — see your payslips for holiday pay details.
          </p>
        </div>
      )}

      <div className="ml-annual-card">
        <div className="ml-annual-top">
          <div className="ml-ring-wrap">
            <svg viewBox="0 0 120 120" className="ml-ring">
              <circle cx="60" cy="60" r="52" fill="none" stroke="var(--ml-ring-track)" strokeWidth="10" />
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
            <div className="ml-ring-center">
              <span className="ml-ring-value">{fmt(remaining)}</span>
              <span className="ml-ring-label">{isZeroHours ? 'hrs left' : t('my_leave.remaining')}</span>
            </div>
          </div>

          <div className="ml-annual-stats">
            <div className="ml-annual-title-row">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#43a047" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              <span className="ml-annual-label">{isZeroHours ? 'Accrued Hours' : translateLeaveType('Annual Leave')}</span>
            </div>
            <div className="ml-stat-grid">
              <div className="ml-stat-item">
                <span className="ml-stat-num">{fmt(totalEntitlement)}</span>
                <span className="ml-stat-desc">{isZeroHours ? 'Accrued' : t('my_leave.entitlement')}</span>
              </div>
              <div className="ml-stat-item">
                <span className="ml-stat-num ml-stat-used">{fmt(totalUsed)}</span>
                <span className="ml-stat-desc">{isZeroHours ? 'Used (hrs)' : t('my_leave.used')}</span>
              </div>
              {primaryPending > 0 && (
                <div className="ml-stat-item">
                  <span className="ml-stat-num ml-stat-pending">{fmt(primaryPending)}</span>
                  <span className="ml-stat-desc">{isZeroHours ? 'Pending (hrs)' : t('my_leave.pending_days')}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {(primaryCarried > 0 || primaryLieu > 0) && (
          <div className="ml-annual-breakdown">
            <span className="ml-breakdown-item">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#43a047" strokeWidth="2.5"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
              {basAllowance} base
            </span>
            {primaryCarried > 0 && (
              <span className="ml-breakdown-item">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0891b2" strokeWidth="2.5"><path d="M17 3L21 7L17 11" /><path d="M3 13V11a4 4 0 014-4h14" /></svg>
                {primaryCarried} carried over
              </span>
            )}
            {primaryLieu > 0 && (
              <span className="ml-breakdown-item">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                {primaryLieu} lieu
              </span>
            )}
          </div>
        )}
      </div>

      {otherTypes.length > 0 && (
        <div className="ml-other-types">
          <h3 className="ml-section-title">Other Leave This Year</h3>
          <div className="ml-other-grid">
            {otherTypes.map(lt => (
              <div key={lt.leave_type_id} className="ml-other-card" style={{ '--ml-type-color': lt.colour } as React.CSSProperties}>
                <div className="ml-other-icon" style={{ background: lt.colour }}>
                  {lt.name === 'Sick Leave' ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                    </svg>
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="3" y1="10" x2="21" y2="10" />
                    </svg>
                  )}
                </div>
                <div className="ml-other-info">
                  <span className="ml-other-name">{translateLeaveType(lt.name)}</span>
                  <div className="ml-other-counts">
                    <span className="ml-other-approved">{lt.approved} day{lt.approved !== 1 ? 's' : ''} taken</span>
                    {lt.pending > 0 && (
                      <span className="ml-other-pending">{lt.pending} pending</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {balances.filter(b => b.leave_type_name !== 'Annual Leave' && (b.used > 0 || b.pending > 0)).length > 0 && (
        <div className="ml-other-types">
          {!otherTypes.length && <h3 className="ml-section-title">Other Leave This Year</h3>}
          <div className="ml-other-grid">
            {balances.filter(b => b.leave_type_name !== 'Annual Leave' && (b.used > 0 || b.pending > 0)).map(b => {
              const effectiveTotal = b.total_allowance + (b.carried_over || 0) + (b.lieu_days || 0)
              return (
                <div key={b.leave_type_id} className="ml-other-card" style={{ '--ml-type-color': b.colour } as React.CSSProperties}>
                  <div className="ml-other-icon" style={{ background: b.colour }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="3" y1="10" x2="21" y2="10" />
                    </svg>
                  </div>
                  <div className="ml-other-info">
                    <span className="ml-other-name">{translateLeaveType(b.leave_type_name)}</span>
                    <div className="ml-other-counts">
                      <span className="ml-other-approved">{b.used} of {effectiveTotal} used</span>
                      {b.pending > 0 && (
                        <span className="ml-other-pending">{b.pending} pending</span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
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
