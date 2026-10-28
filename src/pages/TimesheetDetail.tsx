import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'
import { formatDate } from '../lib/formatters'
import { useToast } from '../context/ToastContext'
import { getManagerEmail } from '../lib/workflow'

interface TimesheetRecord {
  id: number
  location: string
  customer: string | null
  role: string
  date: string
  end_date: string | null
  start_time: string
  end_time: string
  hours: number
  status: string
  created_at: string
}

export default function TimesheetDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t, tStatus } = useLanguage()
  const { employeeId, employeeName, employeeEmail, companyUser } = useAuth()
  const { showError, showSuccess } = useToast()
  const [ts, setTs] = useState<TimesheetRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const fetchData = useCallback(async () => {
    if (!id) return
    setLoading(true)
    const { data } = await supabase.from('timesheets')
      .select('id, location, customer, role, date, end_date, start_time, end_time, hours, status, created_at')
      .eq('id', id)
      .eq('company_id', companyUser?.company_id)
      .single()
    if (data) setTs(data as TimesheetRecord)
    setLoading(false)
  }, [id, companyUser?.company_id])

  useEffect(() => { fetchData() }, [fetchData])

  async function handleSubmit() {
    if (!ts) return
    setSubmitting(true)
    const { error } = await supabase.from('timesheets').update({
      status: 'pending',
      submitted_at: new Date().toISOString(),
    }).eq('id', ts.id).eq('company_id', companyUser?.company_id)
    if (error) { showError('Failed to submit timesheet: ' + error.message); setSubmitting(false); return }

    const managerEmail = await getManagerEmail(employeeId, employeeEmail, 'timesheets')

    const { error: error2 } = await supabase.from('workflow_tracker').insert({
      emp_display_name: employeeName,
      step: 1,
      status: 'Pending',
      record_type: 'Timesheet',
      action: 'Timesheet submitted for approval',
      employee_email: employeeEmail,
      assigned_to: managerEmail,
      approval_id: ts.id,
      reminder_count: 1,
      task_description: `Timesheet - ${ts.end_date && ts.end_date !== ts.date ? `${formatDate(ts.date)} – ${formatDate(ts.end_date)}` : formatDate(ts.date)} ${ts.start_time.slice(0, 5)}-${ts.end_time.slice(0, 5)} (${ts.role})`,
      company_id: companyUser?.company_id,
    })
    if (error2) { showError('Failed to create workflow entry: ' + error2.message); setSubmitting(false); return }

    await supabase.from('workflow_tracker').insert({
      emp_display_name: employeeName,
      step: 1,
      status: 'Complete',
      record_type: 'Timesheet',
      action: 'Timesheet submitted',
      employee_email: employeeEmail,
      assigned_to: employeeEmail,
      approval_id: ts.id,
      reminder_count: 1,
      task_description: `Timesheet submitted: ${ts.end_date && ts.end_date !== ts.date ? `${formatDate(ts.date)} – ${formatDate(ts.end_date)}` : formatDate(ts.date)} ${ts.start_time.slice(0, 5)}-${ts.end_time.slice(0, 5)} (${ts.role})`,
      approval_status: 'Submitted',
      company_id: companyUser?.company_id,
    })

    showSuccess('Timesheet submitted')
    window.dispatchEvent(new Event('notifications-updated'))
    navigate('/timesheets')
  }

  async function handleDelete() {
    if (!ts) return
    if (!confirm(t('timesheets.confirm_delete'))) return
    const { error } = await supabase.from('workflow_tracker').delete().eq('record_type', 'Timesheet').eq('approval_id', ts.id).eq('company_id', companyUser?.company_id)
    if (error) { showError('Failed to delete workflow entries: ' + error.message); return }
    const { error: error2 } = await supabase.from('timesheets').delete().eq('id', ts.id).eq('company_id', companyUser?.company_id)
    if (error2) { showError('Failed to delete timesheet: ' + error2.message); return }
    window.dispatchEvent(new Event('notifications-updated'))
    navigate('/timesheets')
  }

  if (loading) return <div className="feature-page"><p className="claims-empty">{t('common.loading')}</p></div>
  if (!ts) return <div className="feature-page"><p className="claims-empty">{t('timesheets.not_found')}</p></div>

  return (
    <div className="feature-page leave-approval-page">
      <header className="leave-approval-header">
        <div className="leave-approval-avatar">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#1565c0" strokeWidth="1.5">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </div>
        <div className="leave-approval-header-center">
          <h1 className="leave-approval-title">{t('timesheets.detail_title')}</h1>
          <p className="leave-approval-subtitle">{t('timesheets.detail_subtitle')}</p>
        </div>
        <button className="leave-approval-back" onClick={() => navigate('/timesheets')}>
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
            <circle cx="18" cy="18" r="17" stroke="#1565c0" strokeWidth="2" />
            <path d="M21 12l-6 6 6 6" stroke="#1565c0" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </header>

      <div className="leave-approval-card">
        <div className="leave-approval-details">
          <div className="leave-detail-row">
            <span className="leave-detail-label">{t('timesheets.date')}</span>
            <span className="leave-detail-value">{ts.end_date && ts.end_date !== ts.date ? `${formatDate(ts.date)} – ${formatDate(ts.end_date)}` : formatDate(ts.date)}</span>
          </div>
          <div className="leave-detail-row">
            <span className="leave-detail-label">{t('timesheets.start_time')}</span>
            <span className="leave-detail-value">{ts.start_time.slice(0, 5)}</span>
          </div>
          <div className="leave-detail-row">
            <span className="leave-detail-label">{t('timesheets.end_time')}</span>
            <span className="leave-detail-value">{ts.end_time.slice(0, 5)}</span>
          </div>
          <div className="leave-detail-row">
            <span className="leave-detail-label">{t('timesheets.hours')}</span>
            <span className="leave-detail-value">{Number(ts.hours).toFixed(1)}h</span>
          </div>
          <div className="leave-detail-row">
            <span className="leave-detail-label">{t('timesheets.location')}</span>
            <span className="leave-detail-value">{ts.location}</span>
          </div>
          {ts.customer && (
            <div className="leave-detail-row">
              <span className="leave-detail-label">{t('timesheets.customer')}</span>
              <span className="leave-detail-value">{ts.customer}</span>
            </div>
          )}
          <div className="leave-detail-row">
            <span className="leave-detail-label">{t('timesheets.role')}</span>
            <span className="leave-detail-value">{ts.role}</span>
          </div>
          <div className="leave-detail-row">
            <span className="leave-detail-label">{t('common.status')}</span>
            <span className="leave-detail-value">{tStatus(ts.status)}</span>
          </div>
        </div>

        {ts.status === 'draft' && (
          <div className="leave-approval-actions">
            <button className="leave-approve-btn" onClick={handleSubmit} disabled={submitting}>
              {submitting ? t('timesheets.submitting') : t('timesheets.submit')}
            </button>
          </div>
        )}

        <div className="manager-delete-section">
          <button className="manager-delete-btn" onClick={handleDelete}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
            {t('timesheets.delete')}
          </button>
        </div>
      </div>
    </div>
  )
}
