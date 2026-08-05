import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { formatDate } from '../lib/formatters'

const LOCATIONS = ['Head Office', 'Home', 'Customer Site', 'Event', 'Unassigned']
const ROLES = ['IT', 'Engineering', 'Design', 'HR', 'Finance', 'Marketing', 'Sales', 'Operations', 'Management', 'Unassigned']

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

export default function NewTimesheet() {
  const navigate = useNavigate()
  const { t } = useLanguage()
  const { employeeId, employeeName, employeeEmail, companyUser } = useAuth()
  const { showError } = useToast()
  const [location, setLocation] = useState(LOCATIONS[0])
  const [customLocation, setCustomLocation] = useState('')
  const [customer, setCustomer] = useState('')
  const [role, setRole] = useState(ROLES[0])
  const [customRole, setCustomRole] = useState('')
  const [startDate, setStartDate] = useState(todayStr())
  const [endDate, setEndDate] = useState(todayStr())
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('17:00')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const effectiveLocation = location === 'Custom' ? customLocation : location
  const effectiveRole = role === 'Custom' ? customRole : role

  function handleStartDateChange(val: string) {
    setStartDate(val)
    if (endDate < val) setEndDate(val)
  }

  async function handleSave(asDraft: boolean) {
    if (!effectiveLocation.trim()) {
      setError(t('timesheets.error_location'))
      return
    }
    if (!effectiveRole.trim()) {
      setError(t('timesheets.error_role'))
      return
    }
    if (endDate < startDate) {
      setError(t('timesheets.error_end_before_start'))
      return
    }
    if (endTime <= startTime) {
      setError(t('timesheets.error_times'))
      return
    }

    setSubmitting(true)
    setError(null)

    const status = asDraft ? 'draft' : 'pending'
    const dateRange = startDate === endDate
      ? formatDate(startDate)
      : `${formatDate(startDate)} – ${formatDate(endDate)}`

    const { data, error: err } = await supabase
      .from('timesheets')
      .insert({
        employee_id: employeeId,
        location: effectiveLocation.trim(),
        customer: customer.trim() || null,
        role: effectiveRole.trim(),
        date: startDate,
        end_date: endDate,
        start_time: startTime,
        end_time: endTime,
        status,
        submitted_at: asDraft ? null : new Date().toISOString(),
        company_id: companyUser?.company_id,
      })
      .select('id')
      .single()

    if (err) {
      setError(err.message)
      setSubmitting(false)
      return
    }

    if (!asDraft && data) {
      let managerEmail = employeeEmail
      const { data: empRow } = await supabase
        .from('employees')
        .select('manager_id')
        .eq('id', employeeId)
        .single()
      if (empRow?.manager_id) {
        const { data: mgr } = await supabase
          .from('employees')
          .select('email')
          .eq('id', empRow.manager_id)
          .single()
        if (mgr?.email) managerEmail = mgr.email
      }

      const { error: wfError1 } = await supabase.from('workflow_tracker').insert({
        emp_display_name: employeeName,
        step: 1,
        status: 'Pending',
        record_type: 'Timesheet',
        action: 'Timesheet submitted for approval',
        employee_email: employeeEmail,
        assigned_to: managerEmail,
        approval_id: data.id,
        reminder_count: 1,
        task_description: `Timesheet - ${dateRange} ${startTime}-${endTime} (${effectiveRole})`,
        company_id: companyUser?.company_id,
      })
      if (wfError1) showError('Failed to create workflow tracker: ' + wfError1.message)

      const { error: wfError2 } = await supabase.from('workflow_tracker').insert({
        emp_display_name: employeeName,
        step: 1,
        status: 'Complete',
        record_type: 'Timesheet',
        action: 'Timesheet submitted',
        employee_email: employeeEmail,
        assigned_to: employeeEmail,
        approval_id: data.id,
        reminder_count: 1,
        task_description: `${t('timesheets.submitted_notification')} ${dateRange} ${startTime}-${endTime} (${effectiveRole})`,
        approval_status: 'Submitted',
        company_id: companyUser?.company_id,
      })
      if (wfError2) showError('Failed to create workflow tracker: ' + wfError2.message)
    }

    window.dispatchEvent(new Event('notifications-updated'))

    navigate('/timesheets')
  }

  return (
    <div className="feature-page new-leave-page">
      <header className="new-leave-header" style={{ background: 'linear-gradient(135deg, #1565c0, #1565c0dd)' }}>
        <button className="new-claim-back" onClick={() => navigate('/timesheets')}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 className="new-claim-title">{t('timesheets.new_title')}</h1>
      </header>

      <div className="ts-form">
        <div className="ts-form-group">
          <label className="ts-form-label">{t('timesheets.location')}</label>
          <select className="ts-form-input" value={location} onChange={e => setLocation(e.target.value)}>
            {LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}
            <option value="Custom">{t('timesheets.custom')}</option>
          </select>
          {location === 'Custom' && (
            <input
              className="ts-form-input"
              style={{ marginTop: 6 }}
              placeholder={t('timesheets.custom_location_placeholder')}
              value={customLocation}
              onChange={e => setCustomLocation(e.target.value)}
            />
          )}
        </div>

        <div className="ts-form-group">
          <label className="ts-form-label">{t('timesheets.customer')}</label>
          <input
            className="ts-form-input"
            placeholder={t('timesheets.customer_placeholder')}
            value={customer}
            onChange={e => setCustomer(e.target.value)}
          />
        </div>

        <div className="ts-form-group">
          <label className="ts-form-label">{t('timesheets.role')}</label>
          <select className="ts-form-input" value={role} onChange={e => setRole(e.target.value)}>
            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            <option value="Custom">{t('timesheets.custom')}</option>
          </select>
          {role === 'Custom' && (
            <input
              className="ts-form-input"
              style={{ marginTop: 6 }}
              placeholder={t('timesheets.custom_role_placeholder')}
              value={customRole}
              onChange={e => setCustomRole(e.target.value)}
            />
          )}
        </div>

        <div className="ts-form-row">
          <div className="ts-form-group">
            <label className="ts-form-label">{t('timesheets.start_date')}</label>
            <input type="date" className="ts-form-input" value={startDate} onChange={e => handleStartDateChange(e.target.value)} />
          </div>
          <div className="ts-form-group">
            <label className="ts-form-label">{t('timesheets.end_date')}</label>
            <input type="date" className="ts-form-input" value={endDate} min={startDate} onChange={e => setEndDate(e.target.value)} />
          </div>
        </div>

        <div className="ts-form-row">
          <div className="ts-form-group">
            <label className="ts-form-label">{t('timesheets.start_time')}</label>
            <input type="time" className="ts-form-input" value={startTime} onChange={e => setStartTime(e.target.value)} />
          </div>
          <div className="ts-form-group">
            <label className="ts-form-label">{t('timesheets.end_time')}</label>
            <input type="time" className="ts-form-input" value={endTime} onChange={e => setEndTime(e.target.value)} />
          </div>
        </div>

        {error && <p className="form-error">{error}</p>}

        <div className="ts-form-actions">
          <button
            className="ts-btn ts-btn-draft"
            onClick={() => handleSave(true)}
            disabled={submitting}
          >
            {submitting ? t('timesheets.saving') : t('timesheets.save_draft')}
          </button>
          <button
            className="ts-btn ts-btn-submit"
            onClick={() => handleSave(false)}
            disabled={submitting}
          >
            {submitting ? t('timesheets.submitting') : t('timesheets.submit')}
          </button>
        </div>
      </div>
    </div>
  )
}
