import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'

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
      .eq('id', selectedEmployee).single()

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
      await supabase.from('workflow_tracker').insert({
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
    }

    navigate('/one-to-ones')
  }

  const today = new Date().toISOString().split('T')[0]

  return (
    <div className="feature-page">
      <header className="notif-header">
        <button className="leave-approval-back" onClick={() => navigate('/one-to-ones')} style={{ position: 'absolute', right: 16 }}>
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
            <circle cx="18" cy="18" r="17" stroke="#7c3aed" strokeWidth="2" />
            <path d="M21 12l-6 6 6 6" stroke="#7c3aed" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="notif-header-center">
          <h1 className="notif-title">{t('one_to_one.new_title')}</h1>
          <p className="notif-subtitle">{t('one_to_one.new_subtitle')}</p>
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
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="3"><path d="M20 6L9 17l-5-5" /></svg>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="oto-form-row">
          <div className="oto-form-section" style={{ flex: 1 }}>
            <label className="oto-form-label">{t('one_to_one.meeting_date')}</label>
            <input type="date" className="oto-form-input" value={date} min={today} onChange={e => setDate(e.target.value)} />
          </div>
          <div className="oto-form-section" style={{ flex: 1 }}>
            <label className="oto-form-label">{t('one_to_one.meeting_time')}</label>
            <input type="time" className="oto-form-input" value={time} onChange={e => setTime(e.target.value)} />
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
