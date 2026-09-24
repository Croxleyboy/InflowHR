import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { sendFeatureEmail } from '../lib/emailNotifications'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { formatDateDisplay, toLocalDateStr } from '../lib/formatters'

interface DirectReport {
  id: string
  first_name: string
  last_name: string
  job_title: string | null
  avatar_url: string | null
}

export default function NewOneToOne() {
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useLanguage()
  const { employeeId, employeeName, companyUser } = useAuth()
  const { showError } = useToast()
  const preselect = (location.state as { employeeId?: string; employeeName?: string } | null)

  const [reports, setReports] = useState<DirectReport[]>([])
  const [selectedEmployee, setSelectedEmployee] = useState(preselect?.employeeId || '')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('10:00')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!employeeId) return
    supabase.from('employees')
      .select('id, first_name, last_name, job_title, avatar_url')
      .eq('manager_id', employeeId)
      .eq('company_id', companyUser?.company_id)
      .eq('is_active', true)
      .order('first_name')
      .then(({ data }) => { if (data) setReports(data as DirectReport[]) })
  }, [employeeId])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!selectedEmployee) { setError(t('one_to_one.error_select_employee')); return }
    if (!date) { setError(t('one_to_one.error_select_date')); return }
    setSubmitting(true)

    const { data: empData } = await supabase.from('employees')
      .select('first_name, last_name, email')
      .eq('id', selectedEmployee)
      .eq('company_id', companyUser?.company_id).single()

    const { data: insertData, error: insertErr } = await supabase.from('one_to_one_meetings').insert({
      manager_id: employeeId,
      employee_id: selectedEmployee,
      scheduled_date: date,
      scheduled_time: time,
      status: 'pending',
      company_id: companyUser?.company_id,
    }).select('id').single()

    if (insertErr) {
      setError(insertErr.message)
      setSubmitting(false)
      return
    }

    if (empData) {
      const formattedDate = new Date(date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
      const { error: wfError } = await supabase.from('workflow_tracker').insert({
        emp_display_name: `${empData.first_name} ${empData.last_name}`,
        step: 1,
        status: 'Pending',
        record_type: 'Meeting',
        action: '1:1 meeting scheduled',
        employee_email: empData.email,
        assigned_to: empData.email,
        approval_id: insertData?.id || null,
        reminder_count: 1,
        task_description: `${employeeName} has scheduled a 1:1 meeting with you on ${formattedDate} at ${time}`,
        company_id: companyUser?.company_id,
      })
      if (wfError) showError('Failed to create workflow tracker: ' + wfError.message)

      if (companyUser?.company_id) {
        sendFeatureEmail({
          companyId: companyUser.company_id,
          employeeId: selectedEmployee,
          featureKey: 'performance_reminders_enabled',
          title: '1:1 Meeting Scheduled',
          message: `${employeeName} has scheduled a 1:1 meeting with you on ${formattedDate} at ${time}.`,
          type: 'info',
          link: '/one-to-ones',
        })
      }
    }

    window.dispatchEvent(new Event('notifications-updated'))
    navigate('/one-to-ones')
  }

  const today = toLocalDateStr()

  return (
    <div className="oto-page">
      <header className="oto-header">
        <button className="oto-header-back" onClick={() => navigate('/one-to-ones')}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <div className="oto-header-center">
          <h1 className="oto-header-title">{t('one_to_one.new_title')}</h1>
          <p className="oto-header-subtitle">{t('one_to_one.new_subtitle')}</p>
        </div>
      </header>

      <form className="oto-schedule-form" onSubmit={handleSubmit}>
        <div className="oto-form-section">
          <label className="oto-form-label">{t('one_to_one.employee')}</label>
          <div className="oto-employee-grid">
            {reports.map(r => (
              <button
                key={r.id}
                type="button"
                className={`oto-employee-option ${selectedEmployee === r.id ? 'oto-employee-selected' : ''}`}
                onClick={() => setSelectedEmployee(r.id)}
              >
                {r.avatar_url ? <img className="oto-employee-option-avatar-img" src={r.avatar_url} alt={`${r.first_name} ${r.last_name}`} /> : <div className="oto-employee-option-avatar">
                  {r.first_name[0]}{r.last_name[0]}
                </div>}
                <div className="oto-employee-option-info">
                  <span className="oto-employee-option-name">{r.first_name} {r.last_name}</span>
                  <span className="oto-employee-option-role">{r.job_title || ''}</span>
                </div>
                {selectedEmployee === r.id && (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ec407a" strokeWidth="3"><path d="M20 6L9 17l-5-5" /></svg>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="date-row">
          <div className="date-field">
            <label className="field-label">{t('one_to_one.meeting_date')}</label>
            <div className="date-input-wrap" onClick={e => { const i = e.currentTarget.querySelector('input'); if (i) try { i.showPicker() } catch {} }}>
              <span className="date-display">{date ? formatDateDisplay(date) : t('one_to_one.select_date')}</span>
              <input type="date" value={date} min={today} onChange={e => setDate(e.target.value)} className="date-input-hidden" />
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ec407a" strokeWidth="2" className="date-icon">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </div>
          </div>
          <div className="date-field">
            <label className="field-label">{t('one_to_one.meeting_time')}</label>
            <div className="date-input-wrap" onClick={e => { const i = e.currentTarget.querySelector('input'); if (i) try { i.showPicker() } catch {} }}>
              <span className="date-display">{time}</span>
              <input type="time" value={time} onChange={e => setTime(e.target.value)} className="date-input-hidden" />
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ec407a" strokeWidth="2" className="date-icon">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
            </div>
          </div>
        </div>

        {error && <p className="oto-form-error">{error}</p>}

        <button type="submit" className="oto-form-submit" disabled={submitting || !selectedEmployee || !date}>
          {submitting ? t('common.saving') : t('one_to_one.schedule_meeting')}
        </button>
      </form>
    </div>
  )
}
