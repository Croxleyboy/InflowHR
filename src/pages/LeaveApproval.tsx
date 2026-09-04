import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase, sendNotificationEmail } from '../lib/supabase'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'
import { formatDate, formatDateTime } from '../lib/formatters'
import { useToast } from '../context/ToastContext'

interface LeaveRequest {
  id: number
  employee_id: string
  leave_type_id: number
  start_date: string
  end_date: string
  days_requested: number
  status: string
  reason: string | null
  created_at: string
}

interface Employee {
  first_name: string
  last_name: string
  email: string
  avatar_url: string | null
}

interface LeaveType {
  name: string
  deducts_from_allowance: boolean | null
}

const happyLeaveMessages = [
  'Have a wonderful time off! 🌴',
  'Enjoy your well-deserved break! ☀️',
  'Relax and recharge! 🎉',
  'Happy holidays, enjoy every moment! 🏖️',
  'Time to unwind — you\'ve earned it! 🎊',
]

export default function LeaveApproval() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t, tStatus } = useLanguage()
  const { employeeName: APPROVER_NAME, employeeEmail: APPROVER_EMAIL, companyUser } = useAuth()
  const { showError, showSuccess } = useToast()
  const [request, setRequest] = useState<LeaveRequest | null>(null)
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [leaveType, setLeaveType] = useState<LeaveType | null>(null)
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const fetchData = useCallback(async () => {
    if (!id) return
    setLoading(true)
    const { data: req } = await supabase.from('leave_requests')
      .select('id, employee_id, leave_type_id, start_date, end_date, days_requested, status, reason, created_at')
      .eq('id', id)
      .eq('company_id', companyUser?.company_id)
      .single()

    if (req) {
      const r = req as LeaveRequest
      setRequest(r)
      const [empRes, typeRes] = await Promise.all([
        supabase.from('employees').select('first_name, last_name, email, avatar_url').eq('id', r.employee_id).eq('company_id', companyUser?.company_id).single(),
        supabase.from('leave_types').select('name, deducts_from_allowance').eq('id', r.leave_type_id).eq('company_id', companyUser?.company_id).single(),
      ])
      if (empRes.data) setEmployee(empRes.data as Employee)
      if (typeRes.data) setLeaveType(typeRes.data as LeaveType)
    }
    setLoading(false)
  }, [id, companyUser?.company_id])

  useEffect(() => { fetchData() }, [fetchData])

  const empName = employee ? `${employee.first_name} ${employee.last_name}` : ''
  const empInitials = employee ? `${employee.first_name[0]}${employee.last_name[0]}` : ''
  const typeName = leaveType?.name || 'Leave'

  async function handleDecision(approved: boolean) {
    if (!request || !employee) return
    setProcessing(true)
    const now = new Date().toISOString()

    const { error } = await supabase.from('leave_requests').update({
      status: approved ? 'approved' : 'rejected',
      approved_at: approved ? now : null,
    }).eq('id', id).eq('company_id', companyUser?.company_id)
    if (error) { showError('Failed to update leave request: ' + error.message); setProcessing(false); return }

    if (approved && leaveType?.deducts_from_allowance !== false) {
      const year = new Date(request.start_date).getFullYear()
      const { data: balance } = await supabase
        .from('leave_balances')
        .select('id, used')
        .eq('employee_id', request.employee_id)
        .eq('company_id', companyUser?.company_id)
        .eq('year', year)
        .limit(1)
        .single()
      if (balance) {
        const { error: errBal } = await supabase.from('leave_balances')
          .update({ used: balance.used + request.days_requested })
          .eq('id', balance.id)
          .eq('company_id', companyUser?.company_id)
        if (errBal) { showError('Failed to update leave balance: ' + errBal.message) }
      }
    }

    const deductNote = leaveType?.deducts_from_allowance === false
      ? ` ${t('approval.does_not_reduce')}`
      : ''

    const { error: errWf1 } = await supabase.from('workflow_tracker')
      .update({
        status: 'Complete',
        approval_status: approved ? 'Approved' : 'Declined',
        updated_at: now,
        task_description: approved
          ? `${typeName} approved - ${formatDate(request.start_date)} to ${formatDate(request.end_date)}${deductNote}`
          : `${typeName} declined`,
      })
      .eq('record_type', 'Leave')
      .eq('approval_id', request.id)
      .eq('status', 'Pending')
      .eq('company_id', companyUser?.company_id)
    if (errWf1) { showError('Failed to update workflow: ' + errWf1.message) }

    const happyMsg = happyLeaveMessages[Math.floor(Math.random() * happyLeaveMessages.length)]

    const { error: errWf2 } = await supabase.from('workflow_tracker').insert({
      emp_display_name: empName,
      step: 2,
      status: 'Complete',
      record_type: 'Leave',
      action: approved ? 'Leave approved' : 'Leave declined',
      employee_email: employee.email,
      assigned_to: employee.email,
      approval_id: request.id,
      reminder_count: 1,
      task_description: approved
        ? `Your ${typeName} from ${formatDate(request.start_date)} to ${formatDate(request.end_date)} has been approved. ${happyMsg}${deductNote}`
        : `Your ${typeName} request from ${formatDate(request.start_date)} to ${formatDate(request.end_date)} has been declined. Please contact your manager.`,
      approval_status: approved ? 'Approved' : 'Declined',
      company_id: companyUser?.company_id,
    })
    if (errWf2) { showError('Failed to create employee notification: ' + errWf2.message) }

    const { error: errWf3 } = await supabase.from('workflow_tracker').insert({
      emp_display_name: APPROVER_NAME,
      step: 2,
      status: 'Complete',
      record_type: 'Leave',
      action: approved ? 'Leave approved by manager' : 'Leave declined by manager',
      employee_email: APPROVER_EMAIL,
      assigned_to: APPROVER_EMAIL,
      approval_id: request.id,
      reminder_count: 1,
      task_description: `You ${approved ? 'approved' : 'declined'} ${typeName} for ${empName} - ${formatDate(request.start_date)} to ${formatDate(request.end_date)}${deductNote}`,
      approval_status: approved ? 'Approved' : 'Declined',
      company_id: companyUser?.company_id,
    })
    if (errWf3) { showError('Failed to create manager notification: ' + errWf3.message) }

    const notifPayload = {
      employee_id: request.employee_id,
      title: approved ? `${typeName} Approved` : `${typeName} Declined`,
      message: approved
        ? `Your ${typeName} from ${formatDate(request.start_date)} to ${formatDate(request.end_date)} (${request.days_requested} days) has been approved.${deductNote}`
        : `Your ${typeName} request from ${formatDate(request.start_date)} to ${formatDate(request.end_date)} has been declined. Please contact your manager.`,
      type: approved ? 'info' : 'alert',
      link: '/leave',
      is_read: false,
      company_id: companyUser?.company_id,
      send_email: true,
    }
    const { data: notifRow } = await supabase.from('notifications').insert(notifPayload).select().single()
    if (notifRow) sendNotificationEmail(notifRow)

    showSuccess(approved ? 'Leave request approved' : 'Leave request declined')
    window.dispatchEvent(new Event('notifications-updated'))
    navigate('/notifications')
  }

  async function handleManagerDelete() {
    if (!request) return
    if (!confirm(`Delete this leave request? This cannot be undone.`)) return
    setDeleting(true)
    const { error } = await supabase.from('workflow_tracker').delete().eq('record_type', 'Leave').eq('approval_id', request.id).eq('company_id', companyUser?.company_id)
    if (error) { showError('Failed to delete workflow entries: ' + error.message); setDeleting(false); return }
    const { error: error2 } = await supabase.from('leave_requests').delete().eq('id', request.id).eq('company_id', companyUser?.company_id)
    if (error2) { showError('Failed to delete leave request: ' + error2.message); setDeleting(false); return }
    window.dispatchEvent(new Event('notifications-updated'))
    navigate('/notifications')
  }

  if (loading) return <div className="feature-page"><p className="claims-empty">{t('common.loading')}</p></div>
  if (!request) return <div className="feature-page"><p className="claims-empty">{t('approval.request_not_found')}</p></div>

  const isActionable = request.status === 'pending'

  return (
    <div className="feature-page leave-approval-page">
      <header className="leave-approval-header">
        <div className="leave-approval-avatar">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#3d6b99" strokeWidth="1.5">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </div>
        <div className="leave-approval-header-center">
          <h1 className="leave-approval-title">{t('approval.leave_title')}</h1>
          <p className="leave-approval-subtitle">{t('approval.employee_request')}</p>
        </div>
        <button className="leave-approval-back" onClick={() => navigate('/notifications')}>
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
            <circle cx="18" cy="18" r="17" stroke="#43a047" strokeWidth="2" />
            <path d="M21 12l-6 6 6 6" stroke="#43a047" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </header>

      <div className="leave-approval-card">
        <div className="leave-approval-emp-row">
          {employee?.avatar_url ? <img className="emp-avatar-img" src={employee.avatar_url} alt={empName} /> : <div className="leave-approval-emp-avatar">{empInitials}</div>}
          <div className="leave-approval-emp-info">
            <span className="leave-approval-emp-name">{empName}</span>
            <span className="leave-approval-emp-ref">{t('approval.request_id')} &nbsp; {request.id}</span>
          </div>
          <span className={`leave-approval-badge status-${request.status}`}>
            {tStatus(request.status)}
          </span>
        </div>

        <div className="leave-approval-details">
          <div className="leave-detail-row">
            <span className="leave-detail-label">{t('approval.leave_type')}</span>
            <span className="leave-detail-value">{typeName}</span>
          </div>
          <div className="leave-detail-row">
            <span className="leave-detail-label">{t('approval.from')}</span>
            <span className="leave-detail-value">{formatDate(request.start_date)}</span>
          </div>
          <div className="leave-detail-row">
            <span className="leave-detail-label">{t('approval.to')}</span>
            <span className="leave-detail-value">{formatDate(request.end_date)}</span>
          </div>
          <div className="leave-detail-row">
            <span className="leave-detail-label">{t('approval.days_off')}</span>
            <span className="leave-detail-value">{request.days_requested}</span>
          </div>
          <div className="leave-detail-row leave-detail-desc">
            <span className="leave-detail-label">{t('approval.leave_description')}</span>
          </div>
          <div className="leave-detail-desc-body">
            {request.reason || ''}
          </div>
          <div className="leave-detail-row">
            <span className="leave-detail-label">{t('approval.approval_date')}</span>
            <span className="leave-detail-value">{formatDateTime(request.created_at)}</span>
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
            <span>{t('approval.request_decided')} {tStatus(request.status)}</span>
          </div>
        )}

        <div className="manager-delete-section">
          <button className="manager-delete-btn" onClick={handleManagerDelete} disabled={deleting}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
            {deleting ? t('approval.deleting') : t('approval.delete_request')}
          </button>
        </div>
      </div>
    </div>
  )
}
