import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'
import { LEAVE_TYPE_KEYS } from '../lib/translations'
import { countWorkingDays } from '../lib/workingDays'

function getBenefitLeaveTypes(): { name: string; translationKey: string }[] {
  try {
    const raw = localStorage.getItem('inflowhr-benefits')
    if (!raw) return []
    const data = JSON.parse(raw)
    const extras: { name: string; translationKey: string }[] = []
    if (data.vacation_options?.includes('buy_leave')) extras.push({ name: 'Buy Additional Leave', translationKey: 'buy_leave' })
    if (data.vacation_options?.includes('sell_leave')) extras.push({ name: 'Sell Unused Leave', translationKey: 'sell_leave' })
    if (data.vacation_options?.includes('carry_over')) extras.push({ name: 'Carry Over Leave', translationKey: 'carry_over' })
    if (data.vacation_options?.includes('compressed_hours')) extras.push({ name: 'Compressed Hours', translationKey: 'compressed_hours' })
    return extras
  } catch { return [] }
}



function todayStr() {
  return new Date().toISOString().split('T')[0]
}

function formatDateDisplay(dateStr: string) {
  const [y, m, d] = dateStr.split('-')
  return `${d}/${m}/${y}`
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00')
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const year = d.getFullYear()
  return `${day}/${month}/${year}`
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
  const MANAGER_EMAIL = EMPLOYEE_EMAIL
  const benefitTypes = useMemo(() => getBenefitLeaveTypes(), [])
  const allLeaveTypes = useMemo(() => [...LEAVE_TYPE_KEYS, ...benefitTypes], [benefitTypes])
  const [leaveType, setLeaveType] = useState(LEAVE_TYPE_KEYS[0].name)
  const [startDate, setStartDate] = useState(todayStr())
  const [endDate, setEndDate] = useState(todayStr())
  const [days, setDays] = useState('1')
  const [halfDay, setHalfDay] = useState(false)
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [leaveTypeIds, setLeaveTypeIds] = useState<Record<string, number>>({})
  const [weekendsAsWorkdays, setWeekendsAsWorkdays] = useState(false)

  useEffect(() => {
    if (!companyUser?.company_id) return
    supabase.from('leave_types')
      .select('id, name')
      .eq('company_id', companyUser.company_id)
      .then(({ data }) => {
        if (data) {
          const map: Record<string, number> = {}
          for (const row of data) map[row.name] = row.id
          setLeaveTypeIds(map)
        }
      })
    supabase.from('companies')
      .select('weekends_as_workdays')
      .eq('id', companyUser.company_id)
      .single()
      .then(({ data }) => {
        if (data?.weekends_as_workdays) setWeekendsAsWorkdays(true)
      })
  }, [companyUser?.company_id])

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
      const NO_DEDUCT_TYPES = ['Sick Leave', 'Jury Duty', 'Lieu Days']
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
    let careerBreakFlag = false
    if (leaveType === 'Career Break') {
      const { data: balances } = await supabase
        .from('leave_balances')
        .select('total_allowance, used')
        .eq('employee_id', EMPLOYEE_ID)
        .eq('year', new Date().getFullYear())
        .limit(1)
        .single()
      if (balances) {
        const remaining = balances.total_allowance - balances.used
        if (daysVal > remaining) careerBreakFlag = true
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

    await supabase.from('workflow_tracker').insert({
      emp_display_name: EMPLOYEE_NAME,
      step: 1,
      status: 'Pending',
      record_type: 'Leave',
      action: 'Leave request submitted for approval',
      employee_email: EMPLOYEE_EMAIL,
      assigned_to: MANAGER_EMAIL,
      approval_id: data.id,
      reminder_count: 1,
      task_description: `${leaveType} - ${formatDate(startDate)}${startDate !== endDate ? ` to ${formatDate(endDate)}` : ''}${halfDay ? ' (Half Day)' : ` (${days} days)`}${flagNote}`,
      company_id: companyUser?.company_id,
    })

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
            <div className="date-input-wrap">
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
              <div className="date-input-wrap">
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
    </div>
  )
}
