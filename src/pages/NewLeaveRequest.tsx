import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'
import { LEAVE_TYPE_KEYS } from '../lib/translations'
import { countWorkingDays } from '../lib/workingDays'
import { formatDate, formatDateDisplay, getFYRange } from '../lib/formatters'
import { useToast } from '../context/ToastContext'
import { getManagerEmail } from '../lib/workflow'
import { sendTeamsNotification } from '../lib/teamsNotifications'

const VACATION_OPTION_LEAVE_TYPES: Record<string, { name: string; translationKey: string }> = {
  buy_leave: { name: 'Buy Additional Leave', translationKey: 'buy_leave' },
  sell_leave: { name: 'Sell Unused Leave', translationKey: 'sell_leave' },
  carry_over: { name: 'Carry Over Leave', translationKey: 'carry_over' },
  compressed_hours: { name: 'Compressed Hours', translationKey: 'compressed_hours' },
}



function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function LeaveTypeIcon({ type }: { type: string }) {
  const icons: Record<string, React.ReactNode> = {
    'Annual Leave': (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        <line x1="2" y1="12" x2="22" y2="12" />
      </svg>
    ),
    'Sick Leave': (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      </svg>
    ),
    'Jury Duty': (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    ),
    'Bereavement': (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
    ),
    'Exam Leave': (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
      </svg>
    ),
    'Carers Leave': (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
    'Career Break': (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
      </svg>
    ),
    'Lieu Days': (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  }
  return icons[type] || icons['Annual Leave']
}

const LEAVE_TYPE_COLORS: Record<string, string> = {
  'Annual Leave': '#43a047',
  'Sick Leave': '#e53935',
  'Jury Duty': '#5c6bc0',
  'Bereavement': '#78909c',
  'Exam Leave': '#ff9800',
  'Carers Leave': '#ec407a',
  'Career Break': '#7b1fa2',
  'Lieu Days': '#00897b',
}

export default function NewLeaveRequest() {
  const navigate = useNavigate()
  const { t } = useLanguage()
  const { employeeId: EMPLOYEE_ID, employeeName: EMPLOYEE_NAME, employeeEmail: EMPLOYEE_EMAIL, companyUser } = useAuth()
  const { showError } = useToast()
  const [benefitLeaveTypes, setBenefitLeaveTypes] = useState<{ name: string; translationKey: string }[]>([])
  const allLeaveTypes = [...LEAVE_TYPE_KEYS, ...benefitLeaveTypes]
  const [leaveType, setLeaveType] = useState(LEAVE_TYPE_KEYS[0].name)
  const [startDate, setStartDate] = useState(todayStr())
  const [endDate, setEndDate] = useState(todayStr())
  const [days, setDays] = useState('1')
  const [halfDay, setHalfDay] = useState(false)
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [leaveTypeIds, setLeaveTypeIds] = useState<Record<string, number>>({})
  const [leaveTypeDeducts, setLeaveTypeDeducts] = useState<Record<string, boolean>>({})
  const [weekendsAsWorkdays, setWeekendsAsWorkdays] = useState(false)
  const [leaveBalance, setLeaveBalance] = useState<{ total: number; used: number; pending: number } | null>(null)
  const [employeeLieuDays, setEmployeeLieuDays] = useState(0)
  const [showLieuPopup, setShowLieuPopup] = useState(false)
  const [shiftConflicts, setShiftConflicts] = useState<{ date: string; shiftName: string; startTime: string; endTime: string }[]>([])
  const [shiftConflictDismissed, setShiftConflictDismissed] = useState(false)

  useEffect(() => {
    if (!companyUser?.company_id) return
    supabase.from('leave_types')
      .select('id, name, deducts_from_allowance')
      .eq('company_id', companyUser.company_id)
      .then(({ data }) => {
        if (data) {
          const idMap: Record<string, number> = {}
          const deductMap: Record<string, boolean> = {}
          for (const row of data) {
            idMap[row.name] = row.id
            deductMap[row.name] = row.deducts_from_allowance !== false
          }
          setLeaveTypeIds(idMap)
          setLeaveTypeDeducts(deductMap)
        }
      })
    supabase.from('companies')
      .select('weekends_as_workdays')
      .eq('id', companyUser.company_id)
      .single()
      .then(({ data }) => {
        if (data?.weekends_as_workdays) setWeekendsAsWorkdays(true)
      })
    if (EMPLOYEE_ID) {
      supabase.from('leave_types')
        .select('id')
        .eq('company_id', companyUser.company_id)
        .eq('name', 'Annual Leave')
        .limit(1)
        .single()
        .then(async ({ data: annualType }) => {
          if (!annualType) return
          const { data: co } = await supabase.from('companies').select('fy_start_month').eq('id', companyUser!.company_id).single()
          const { fyYear, fyStart, fyEnd } = getFYRange(co?.fy_start_month || 4)
          const [balRes, pendRes, approvedRes] = await Promise.all([
            supabase.from('leave_balances')
              .select('total_allowance, lieu_days, carried_over')
              .eq('employee_id', EMPLOYEE_ID)
              .eq('company_id', companyUser!.company_id)
              .eq('leave_type_id', annualType.id)
              .eq('year', fyYear)
              .limit(1)
              .single(),
            supabase.from('leave_requests')
              .select('days_requested')
              .eq('employee_id', EMPLOYEE_ID)
              .eq('company_id', companyUser!.company_id)
              .eq('leave_type_id', annualType.id)
              .eq('status', 'pending')
              .gte('start_date', fyStart)
              .lte('start_date', fyEnd),
            supabase.from('leave_requests')
              .select('days_requested')
              .eq('employee_id', EMPLOYEE_ID)
              .eq('company_id', companyUser!.company_id)
              .eq('leave_type_id', annualType.id)
              .eq('status', 'approved')
              .gte('start_date', fyStart)
              .lte('start_date', fyEnd),
          ])
          const lieuVal = Number(balRes.data?.lieu_days) || 0
          setEmployeeLieuDays(lieuVal)
          const carriedVal = Number(balRes.data?.carried_over) || 0
          const total = (balRes.data?.total_allowance || 0) + carriedVal + lieuVal
          const used = (approvedRes.data || []).reduce((s: number, r: { days_requested: number }) => s + Number(r.days_requested), 0)
          const pending = (pendRes.data || []).reduce((s: number, r: { days_requested: number }) => s + Number(r.days_requested), 0)
          setLeaveBalance({ total, used, pending })
        })
    }
    if (EMPLOYEE_ID) {
      supabase.from('benefit_types')
        .select('id')
        .eq('company_id', companyUser.company_id)
        .eq('benefit_key', 'vacation')
        .eq('is_enabled', true)
        .maybeSingle()
        .then(({ data: vacType }) => {
          if (!vacType) return
          supabase.from('benefit_enrollments')
            .select('option_id, benefit_options!inner(option_key)')
            .eq('company_id', companyUser!.company_id)
            .eq('employee_id', EMPLOYEE_ID!)
            .eq('benefit_type_id', vacType.id)
            .not('option_id', 'is', null)
            .then(({ data: enrolled }) => {
              if (!enrolled) return
              const extras: { name: string; translationKey: string }[] = []
              for (const row of enrolled) {
                const opts = (row as { benefit_options?: { option_key: string }[] }).benefit_options
                const optKey = opts?.[0]?.option_key
                if (optKey && VACATION_OPTION_LEAVE_TYPES[optKey]) {
                  extras.push(VACATION_OPTION_LEAVE_TYPES[optKey])
                }
              }
              setBenefitLeaveTypes(extras)
            })
        })
    }
  }, [companyUser?.company_id, EMPLOYEE_ID])

  useEffect(() => {
    if (halfDay) return
    const working = countWorkingDays(startDate, endDate, weekendsAsWorkdays)
    setDays(String(working || 1))
  }, [startDate, endDate, weekendsAsWorkdays, halfDay])

  function handleHalfDayToggle(checked: boolean) {
    setHalfDay(checked)
    if (checked) {
      setEndDate(startDate)
      setDays('0.5')
    }
  }

  function handleStartDateChange(val: string) {
    if (val < todayStr()) return
    setStartDate(val)
    if (endDate < val) setEndDate(val)
    if (halfDay) {
      setEndDate(val)
      setDays('0.5')
    }
  }

  function handleEndDateChange(val: string) {
    if (halfDay) return
    if (val < todayStr()) return
    setEndDate(val)
  }

  useEffect(() => {
    if (!EMPLOYEE_ID || !companyUser?.company_id) return
    setShiftConflictDismissed(false)
    const sd = startDate
    const ed = halfDay ? startDate : endDate
    supabase
      .from('shift_assignments')
      .select('date, shift_templates(name, start_time, end_time), rotas(status)')
      .eq('employee_id', EMPLOYEE_ID)
      .eq('company_id', companyUser.company_id)
      .gte('date', sd)
      .lte('date', ed)
      .then(({ data }) => {
        if (!data) { setShiftConflicts([]); return }
        const conflicts = (data as any[])
          .filter(r => r.rotas?.status === 'published')
          .map(r => ({
            date: r.date,
            shiftName: r.shift_templates?.name || 'Shift',
            startTime: r.shift_templates?.start_time?.slice(0, 5) || '',
            endTime: r.shift_templates?.end_time?.slice(0, 5) || '',
          }))
        setShiftConflicts(conflicts)
      })
  }, [startDate, endDate, halfDay, EMPLOYEE_ID, companyUser?.company_id])

  function translateLeaveType(name: string): string {
    const entry = allLeaveTypes.find(k => k.name === name)
    if (!entry) return name
    const key = LEAVE_TYPE_KEYS.find(k => k.name === name) ? `my_leave.${entry.translationKey}` : `benefits.vac_${entry.translationKey}`
    return t(key)
  }

  async function handleSubmit() {
    if (startDate < todayStr()) {
      setError(t('new_leave.error_past'))
      return
    }
    if (endDate < startDate) {
      setError(t('new_leave.error_dates'))
      return
    }
    if (!days || parseFloat(days) <= 0) {
      setError(t('new_leave.error_days'))
      return
    }

    setSubmitting(true)
    setError(null)

    const { data: existing } = await supabase
      .from('leave_requests')
      .select('id, start_date, end_date, days_requested, status')
      .eq('employee_id', EMPLOYEE_ID)
      .eq('company_id', companyUser?.company_id)
      .in('status', ['pending', 'approved'])
      .lte('start_date', endDate)
      .gte('end_date', startDate)

    if (existing && existing.length > 0) {
      const daysVal = parseFloat(days)
      const canStack = halfDay && daysVal === 0.5 && existing.every(
        e => e.days_requested === 0.5 && e.start_date === startDate && e.end_date === endDate
      )
      const totalOnDate = existing.reduce((sum, e) => sum + Number(e.days_requested), 0)
      if (!canStack || totalOnDate + daysVal > 1) {
        setError(t('new_leave.error_overlap'))
        setSubmitting(false)
        return
      }
    }

    let typeId = leaveTypeIds[leaveType]
    if (!typeId && companyUser?.company_id) {
      const NO_DEDUCT_TYPES = ['Sick Leave', 'Jury Duty', 'Career Break', 'Lieu Days']
      const { data: newType } = await supabase
        .from('leave_types')
        .insert({ name: leaveType, company_id: companyUser.company_id, deducts_from_allowance: !NO_DEDUCT_TYPES.includes(leaveType) })
        .select('id')
        .single()
      if (newType) {
        typeId = newType.id
        setLeaveTypeIds(prev => ({ ...prev, [leaveType]: newType.id }))
      }
    }
    if (!typeId) {
      setError(t('leave.type_not_found'))
      setSubmitting(false)
      return
    }

    const daysVal = parseFloat(days)
    const typeDeducts = leaveTypeDeducts[leaveType] !== false
    let careerBreakFlag = false

    if (leaveType === 'Lieu Days') {
      if (employeeLieuDays <= 0) {
        setShowLieuPopup(true)
        setSubmitting(false)
        return
      }
      if (daysVal > employeeLieuDays) {
        setError(`You only have ${employeeLieuDays} lieu day${employeeLieuDays !== 1 ? 's' : ''} assigned. Please reduce your request or speak to your manager.`)
        setSubmitting(false)
        return
      }
    }

    if (typeDeducts && leaveBalance) {
      const remaining = leaveBalance.total - leaveBalance.used - leaveBalance.pending
      if (daysVal > remaining) {
        if (leaveType === 'Career Break') {
          careerBreakFlag = true
        } else {
          setError(t('new_leave.error_insufficient_balance').replace('{remaining}', String(remaining)))
          setSubmitting(false)
          return
        }
      }
    }

    const { data, error: err } = await supabase
      .from('leave_requests')
      .insert({
        employee_id: EMPLOYEE_ID,
        leave_type_id: typeId,
        start_date: startDate,
        end_date: endDate,
        days_requested: daysVal,
        status: 'pending',
        reason: reason.trim() || null,
        company_id: companyUser?.company_id,
      })
      .select('id')
      .single()

    if (err) {
      setError(err.message)
      setSubmitting(false)
      return
    }

    const flagNote = careerBreakFlag ? ` ⚠️ ${t('leave.career_break_flag')}` : ''
    const managerEmail = await getManagerEmail(EMPLOYEE_ID, EMPLOYEE_EMAIL)

    const taskDesc = `${leaveType} - ${formatDate(startDate)}${startDate !== endDate ? ` to ${formatDate(endDate)}` : ''}${halfDay ? ' (Half Day)' : ` (${days} days)`}${flagNote}`

    const { error: wfError } = await supabase.from('workflow_tracker').insert({
      emp_display_name: EMPLOYEE_NAME,
      step: 1,
      status: 'Pending',
      record_type: 'Leave',
      action: 'Leave request submitted for approval',
      employee_email: EMPLOYEE_EMAIL,
      assigned_to: managerEmail,
      approval_id: data.id,
      reminder_count: 1,
      task_description: taskDesc,
      company_id: companyUser?.company_id,
    })
    if (wfError) showError('Failed to create workflow tracker: ' + wfError.message)

    await supabase.from('workflow_tracker').insert({
      emp_display_name: EMPLOYEE_NAME,
      step: 1,
      status: 'Complete',
      record_type: 'Leave',
      action: 'Leave request submitted',
      employee_email: EMPLOYEE_EMAIL,
      assigned_to: EMPLOYEE_EMAIL,
      approval_id: data.id,
      reminder_count: 1,
      task_description: `Leave request submitted: ${taskDesc}`,
      approval_status: 'Submitted',
      company_id: companyUser?.company_id,
    })

    if (companyUser?.company_id && managerEmail) {
      try {
        await sendTeamsNotification({
          companyId: companyUser.company_id,
          managerEmail,
          employeeName: EMPLOYEE_NAME,
          message: `Leave request needs your approval: ${taskDesc}`,
        })
      } catch { /* notification failure should not block the user */ }
    }

    window.dispatchEvent(new Event('notifications-updated'))
    navigate('/leave')
  }

  const selectedColor = LEAVE_TYPE_COLORS[leaveType] || '#00acc1'

  return (
    <div className="feature-page new-leave-page">
      <header className="new-leave-header" style={{ background: `linear-gradient(135deg, ${selectedColor}, ${selectedColor}dd)` }}>
        <button className="new-claim-back" onClick={() => navigate('/leave')}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 className="new-claim-title">{t('new_leave.title')}</h1>
      </header>

      <div className="new-leave-type-selector">
        <label className="field-label">{t('new_leave.leave_type')}</label>
        <div className="new-leave-type-grid">
          {allLeaveTypes.map(lt => {
            const color = LEAVE_TYPE_COLORS[lt.name] || '#00acc1'
            const isActive = leaveType === lt.name
            return (
              <button
                key={lt.name}
                className={`new-leave-type-chip ${isActive ? 'new-leave-type-active' : ''}`}
                style={isActive ? { background: color, color: '#fff', borderColor: color } : { borderColor: color, color }}
                onClick={() => setLeaveType(lt.name)}
              >
                <LeaveTypeIcon type={lt.name} />
                <span>{translateLeaveType(lt.name)}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="new-leave-form">
        <div className="leave-half-day-toggle">
          <label className="leave-half-day-label">
            <input
              type="checkbox"
              checked={halfDay}
              onChange={e => handleHalfDayToggle(e.target.checked)}
              className="leave-half-day-checkbox"
            />
            <span className="leave-half-day-text">{t('new_leave.half_day')}</span>
          </label>
        </div>

        <div className="date-row">
          <div className="date-field">
            <label className="field-label">{t('new_leave.start_date')}</label>
            <div className="date-input-wrap" onClick={e => { const i = e.currentTarget.querySelector('input'); if (i) try { i.showPicker() } catch {} }}>
              <span className="date-display">{formatDateDisplay(startDate)}</span>
              <input
                type="date"
                value={startDate}
                min={todayStr()}
                onChange={e => handleStartDateChange(e.target.value)}
                className="date-input-hidden"
              />
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5b9bd5" strokeWidth="2" className="date-icon">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </div>
          </div>
          {!halfDay && (
            <div className="date-field">
              <label className="field-label">{t('new_leave.end_date')}</label>
              <div className="date-input-wrap" onClick={e => { const i = e.currentTarget.querySelector('input'); if (i) try { i.showPicker() } catch {} }}>
                <span className="date-display">{formatDateDisplay(endDate)}</span>
                <input
                  type="date"
                  value={endDate}
                  min={todayStr()}
                  onChange={e => handleEndDateChange(e.target.value)}
                  className="date-input-hidden"
                />
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5b9bd5" strokeWidth="2" className="date-icon">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </div>
            </div>
          )}
        </div>

        {!halfDay && (
          <div className="form-field">
            <label className="field-label">{t('new_leave.days_requested')}</label>
            <input
              type="number"
              step="0.5"
              min="0.5"
              value={days}
              readOnly
              className="form-input"
              style={{ background: '#f5f5f5', cursor: 'default' }}
            />
            <span className="leave-days-hint">{t(weekendsAsWorkdays ? 'new_leave.days_hint_holidays' : 'new_leave.days_hint')}</span>
          </div>
        )}

        {halfDay && (
          <div className="leave-half-day-info">
            <span>{t('new_leave.half_day_info')}</span>
          </div>
        )}

        {leaveTypeDeducts[leaveType] === false ? (
          <div className="leave-deduction-info leave-deduction-info-exempt">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2e7d32" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <span>{t('new_leave.does_not_deduct')}</span>
          </div>
        ) : leaveBalance ? (() => {
          const rem = leaveBalance.total - leaveBalance.used - leaveBalance.pending
          const insufficient = rem < parseFloat(days || '0')
          return (
            <div className={`leave-deduction-info ${insufficient ? 'leave-deduction-info-warning' : ''}`}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              <span>
                {t('new_leave.balance_remaining').replace('{remaining}', String(rem)).replace('{total}', String(leaveBalance.total))}
                {leaveBalance.pending > 0 && ` (${leaveBalance.pending} ${t('new_leave.pending_lowercase')})`}
              </span>
            </div>
          )
        })() : null}

        <div className="form-field">
          <label className="field-label">{t('new_leave.reason')}</label>
          <textarea
            placeholder={t('new_leave.reason_placeholder')}
            value={reason}
            onChange={e => setReason(e.target.value)}
            className="form-textarea"
            rows={4}
          />
        </div>

        {shiftConflicts.length > 0 && !shiftConflictDismissed && (
          <div className="leave-shift-conflict-warning">
            <div className="leave-shift-conflict-header">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#e65100" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span>Shift Conflict</span>
            </div>
            <p className="leave-shift-conflict-text">You have shifts assigned on the following dates. If approved, your manager will need to resolve the scheduling conflict.</p>
            <div className="leave-shift-conflict-list">
              {shiftConflicts.map((c, i) => (
                <div key={i} className="leave-shift-conflict-item">
                  <span className="leave-shift-conflict-date">{new Date(c.date + 'T00:00:00').toLocaleDateString('en-GB')}</span>
                  <span className="leave-shift-conflict-shift">{c.shiftName} ({c.startTime}–{c.endTime})</span>
                </div>
              ))}
            </div>
            <button className="leave-shift-conflict-dismiss" onClick={() => setShiftConflictDismissed(true)}>I understand, continue</button>
          </div>
        )}

        {error && <p className="form-error">{error}</p>}

        <button
          className="new-leave-submit-btn"
          style={{ background: `linear-gradient(135deg, ${selectedColor}, ${selectedColor}dd)` }}
          onClick={handleSubmit}
          disabled={submitting}
        >
          {submitting ? t('new_leave.submitting') : t('new_leave.submit')}
        </button>
      </div>

      {showLieuPopup && (
        <div className="modal-overlay" onClick={() => setShowLieuPopup(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()} style={{ maxWidth: 400, textAlign: 'center', padding: 32 }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#e53e3e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ margin: '0 auto 16px' }}>
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <h3 style={{ margin: '0 0 12px', fontSize: 18 }}>No Lieu Days Assigned</h3>
            <p style={{ margin: '0 0 20px', color: '#666', fontSize: 14, lineHeight: 1.5 }}>
              You do not have any registered lieu days. Please speak to your manager or raise an HR request to have lieu days assigned before booking this leave type.
            </p>
            <button className="new-leave-submit-btn" style={{ background: '#7c3aed', width: '100%' }} onClick={() => setShowLieuPopup(false)}>
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
