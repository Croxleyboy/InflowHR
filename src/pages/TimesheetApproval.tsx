import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'
import { formatDate, formatDateTime } from '../lib/formatters'
import { useToast } from '../context/ToastContext'

interface TimesheetRecord {
  id: number
  employee_id: string
  location: string
  customer: string | null
  role: string
  date: string
  start_time: string
  end_time: string
  hours: number
  status: string
  created_at: string
}

interface Employee {
  first_name: string
  last_name: string
  email: string
  avatar_url: string | null
}

export default function TimesheetApproval() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t, tStatus } = useLanguage()
  const { employeeName: APPROVER_NAME, employeeEmail: APPROVER_EMAIL, companyUser } = useAuth()
  const { showError, showSuccess } = useToast()
  const [ts, setTs] = useState<TimesheetRecord | null>(null)
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const fetchData = useCallback(async () => {
    if (!id) return
    setLoading(true)
    const { data } = await supabase.from('timesheets')
      .select('id, employee_id, location, customer, role, date, start_time, end_time, hours, status, created_at')
      .eq('id', id)
      .eq('company_id', companyUser?.company_id)
      .single()

    if (data) {
      const rec = data as TimesheetRecord
      setTs(rec)
      const { data: emp } = await supabase.from('employees')
        .select('first_name, last_name, email, avatar_url')
        .eq('id', rec.employee_id)
        .eq('company_id', companyUser?.company_id)
        .single()
      if (emp) setEmployee(emp as Employee)
    }
    setLoading(false)
  }, [id, companyUser?.company_id])

  useEffect(() => { fetchData() }, [fetchData])

  const empName = employee ? `${employee.first_name} ${employee.last_name}` : ''
  const empInitials = employee ? `${employee.first_name[0]}${employee.last_name[0]}` : ''

  async function handleDecision(approved: boolean) {
    if (!ts || !employee) return
    setProcessing(true)
    const now = new Date().toISOString()

    const { error } = await supabase.from('timesheets').update({
      status: approved ? 'approved' : 'rejected',
    }).eq('id', id).eq('company_id', companyUser?.company_id)
    if (error) { showError('Failed to update timesheet: ' + error.message); setProcessing(false); return }

    const { error: errWf1 } = await supabase.from('workflow_tracker')
      .update({
        status: 'Complete',
        approval_status: approved ? 'Approved' : 'Declined',
        updated_at: now,
        task_description: approved
          ? `Timesheet approved - ${formatDate(ts.date)} ${ts.start_time.slice(0, 5)}-${ts.end_time.slice(0, 5)}`
          : `Timesheet declined - ${formatDate(ts.date)}`,
      })
      .eq('record_type', 'Timesheet')
      .eq('approval_id', ts.id)
      .eq('status', 'Pending')
      .eq('company_id', companyUser?.company_id)
    if (errWf1) { showError('Failed to update workflow: ' + errWf1.message) }

    const { error: errWf2 } = await supabase.from('workflow_tracker').insert({
      emp_display_name: empName,
      step: 2,
      status: 'Complete',
      record_type: 'Timesheet',
      action: approved ? 'Timesheet approved' : 'Timesheet declined',
      employee_email: employee.email,
      assigned_to: employee.email,
      approval_id: ts.id,
      reminder_count: 1,
      task_description: approved
        ? `Your timesheet for ${formatDate(ts.date)} (${Number(ts.hours).toFixed(1)}h) has been approved.`
        : `Your timesheet for ${formatDate(ts.date)} has been declined. Please contact your manager.`,
      approval_status: approved ? 'Approved' : 'Declined',
      company_id: companyUser?.company_id,
    })
    if (errWf2) { showError('Failed to create employee notification: ' + errWf2.message) }

    const { error: errWf3 } = await supabase.from('workflow_tracker').insert({
      emp_display_name: APPROVER_NAME,
      step: 2,
      status: 'Complete',
      record_type: 'Timesheet',
      action: approved ? 'Timesheet approved by manager' : 'Timesheet declined by manager',
      employee_email: APPROVER_EMAIL,
      assigned_to: APPROVER_EMAIL,
      approval_id: ts.id,
      reminder_count: 1,
      task_description: `You ${approved ? 'approved' : 'declined'} timesheet for ${empName} - ${formatDate(ts.date)} (${Number(ts.hours).toFixed(1)}h)`,
      approval_status: approved ? 'Approved' : 'Declined',
      company_id: companyUser?.company_id,
    })
    if (errWf3) { showError('Failed to create manager notification: ' + errWf3.message) }

    showSuccess(approved ? 'Timesheet approved' : 'Timesheet declined')
    window.dispatchEvent(new Event('notifications-updated'))
    navigate('/notifications')
  }

  async function handleManagerDelete() {
    if (!ts) return
    if (!confirm(t('timesheets.confirm_delete'))) return
    setDeleting(true)
    const { error } = await supabase.from('workflow_tracker').delete().eq('record_type', 'Timesheet').eq('approval_id', ts.id).eq('company_id', companyUser?.company_id)
    if (error) { showError('Failed to delete workflow entries: ' + error.message); setDeleting(false); return }
    const { error: error2 } = await supabase.from('timesheets').delete().eq('id', ts.id).eq('company_id', companyUser?.company_id)
    if (error2) { showError('Failed to delete timesheet: ' + error2.message); setDeleting(false); return }
    window.dispatchEvent(new Event('notifications-updated'))
    navigate('/notifications')
  }

  if (loading) return <div className="feature-page"><p className="claims-empty">{t('common.loading')}</p></div>
  if (!ts) return <div className="feature-page"><p className="claims-empty">{t('timesheets.not_found')}</p></div>

  const isActionable = ts.status === 'pending'

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
          <h1 className="leave-approval-title">{t('approval.timesheet_title')}</h1>
          <p className="leave-approval-subtitle">{t('approval.timesheet_subtitle')}</p>
        </div>
        <button className="leave-approval-back" onClick={() => navigate('/notifications')}>
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
            <circle cx="18" cy="18" r="17" stroke="#1565c0" strokeWidth="2" />
            <path d="M21 12l-6 6 6 6" stroke="#1565c0" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </header>

      <div className="leave-approval-card">
        <div className="leave-approval-emp-row">
          {employee?.avatar_url ? <img className="emp-avatar-img" src={employee.avatar_url} alt={empName} /> : <div className="leave-approval-emp-avatar">{empInitials}</div>}
          <div className="leave-approval-emp-info">
            <span className="leave-approval-emp-name">{empName}</span>
            <span className="leave-approval-emp-ref">{t('approval.timesheet_id')} &nbsp; {ts.id}</span>
          </div>
          <span className={`leave-approval-badge status-${ts.status}`}>
            {tStatus(ts.status)}
          </span>
        </div>

        <div className="leave-approval-details">
          <div className="leave-detail-row">
            <span className="leave-detail-label">{t('timesheets.date')}</span>
            <span className="leave-detail-value">{formatDate(ts.date)}</span>
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
          <div className="leave-detail-row">
            <span className="leave-detail-label">{t('approval.approval_date')}</span>
            <span className="leave-detail-value">{formatDateTime(ts.created_at)}</span>
          </div>
        </div>

        {isActionable && (
          <div className="leave-approval-actions">
            <button className="leave-approve-btn" onClick={() => handleDecision(true)} disabled={processing}>
              {processing ? t('approval.processing') : t('approval.approve')}
            </button>
            <button className="leave-decline-btn" onClick={() => handleDecision(false)} disabled={processing}>
              {processing ? t('approval.processing') : t('approval.decline')}
            </button>
          </div>
        )}

        {!isActionable && (
          <div className="leave-approval-decided">
            <span>{t('approval.request_decided')} {tStatus(ts.status)}</span>
          </div>
        )}

        <div className="manager-delete-section">
          <button className="manager-delete-btn" onClick={handleManagerDelete} disabled={deleting}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
            {deleting ? t('approval.deleting') : t('timesheets.delete')}
          </button>
        </div>
      </div>
    </div>
  )
}
