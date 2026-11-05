import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { sendFeatureEmail } from '../lib/emailNotifications'
import { sendSlackNotification } from '../lib/slackNotifications'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'
import { formatDateTime, formatCurrency } from '../lib/formatters'
import { useToast } from '../context/ToastContext'

interface Claim {
  id: number
  reference_number: string
  title: string
  status: string
  amount: number
  created_at: string
  submitted_at: string | null
  employee_id: string
}

interface LineItem {
  id: number
  title: string
  expense_type: string
  amount: number
  receipt_url: string | null
}

interface Employee {
  first_name: string
  last_name: string
  email: string
}

export default function ExpenseApproval() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t, tStatus, tExpenseType } = useLanguage()
  const { employeeName: APPROVER_NAME, employeeEmail: APPROVER_EMAIL, companyUser, company } = useAuth()
  const currency = company?.currency || 'GBP'
  const { showError, showSuccess } = useToast()
  const [claim, setClaim] = useState<Claim | null>(null)
  const [items, setItems] = useState<LineItem[]>([])
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [response, setResponse] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [viewingReceipt, setViewingReceipt] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    if (!id) return
    setLoading(true)
    const [claimRes, itemsRes] = await Promise.all([
      supabase.from('expense_claims').select('id, reference_number, title, status, amount, created_at, submitted_at, employee_id').eq('id', id).eq('company_id', companyUser?.company_id).single(),
      supabase.from('expense_line_items').select('id, title, expense_type, amount, receipt_url').eq('expense_claim_id', id).eq('company_id', companyUser?.company_id).order('created_at', { ascending: true }),
    ])
    if (claimRes.data) {
      const c = claimRes.data as Claim
      setClaim(c)
      const { data: emp } = await supabase.from('employees').select('first_name, last_name, email').eq('id', c.employee_id).eq('company_id', companyUser?.company_id).single()
      if (emp) setEmployee(emp as Employee)
    }
    if (itemsRes.data) setItems(itemsRes.data as LineItem[])
    setLoading(false)
  }, [id, companyUser?.company_id])

  useEffect(() => { fetchData() }, [fetchData])

  const totalAmount = items.reduce((s, i) => s + i.amount, 0)
  const empName = employee ? `${employee.first_name} ${employee.last_name}` : ''

  async function handleDecision(approved: boolean) {
    if (!claim || !employee) return
    setProcessing(true)
    const now = new Date().toISOString()
    const newStatus = approved ? 'approved' : 'rejected'

    const { error } = await supabase.from('expense_claims').update({
      status: newStatus,
      approved_at: approved ? now : null,
    }).eq('id', id).eq('company_id', companyUser?.company_id)
    if (error) { showError('Failed to update expense claim: ' + error.message); setProcessing(false); return }

    const { error: errWf1 } = await supabase.from('workflow_tracker')
      .update({
        status: 'Complete',
        approval_status: approved ? 'Approved' : 'Declined',
        updated_at: now,
        task_description: approved
          ? `Expense claim ${claim.reference_number} approved - ${formatCurrency(totalAmount, currency)}`
          : `Expense claim ${claim.reference_number} declined`,
      })
      .eq('record_type', 'Expense')
      .eq('approval_id', claim.id)
      .eq('status', 'Pending')
      .eq('company_id', companyUser?.company_id)
    if (errWf1) { showError('Failed to update workflow: ' + errWf1.message) }

    const happyMessages = [
      'Great news!', 'All sorted!', 'Done and dusted!',
      'You\'re all set!', 'Processed successfully!',
    ]

    const responseNote = response.trim() ? ` — "${response.trim()}"` : ''

    const { error: errWf2 } = await supabase.from('workflow_tracker').insert({
      emp_display_name: empName,
      step: 2,
      status: 'Complete',
      record_type: 'Expense',
      action: approved ? 'Expense claim approved' : 'Expense claim declined',
      employee_email: employee.email,
      assigned_to: employee.email,
      approval_id: claim.id,
      reminder_count: 1,
      task_description: approved
        ? `${happyMessages[Math.floor(Math.random() * happyMessages.length)]} Your expense claim ${claim.reference_number} for ${formatCurrency(totalAmount, currency)} has been approved${responseNote}`
        : `Your expense claim ${claim.reference_number} has been declined. Please contact your manager for details.${responseNote}`,
      approval_status: approved ? 'Approved' : 'Declined',
      company_id: companyUser?.company_id,
    })
    if (errWf2) { showError('Failed to create employee notification: ' + errWf2.message) }

    const { error: errWf3 } = await supabase.from('workflow_tracker').insert({
      emp_display_name: APPROVER_NAME,
      step: 2,
      status: 'Complete',
      record_type: 'Expense',
      action: approved ? 'Expense approved by manager' : 'Expense declined by manager',
      employee_email: APPROVER_EMAIL,
      assigned_to: APPROVER_EMAIL,
      approval_id: claim.id,
      reminder_count: 1,
      task_description: `You ${approved ? 'approved' : 'declined'} expense claim ${claim.reference_number} from ${empName} - ${formatCurrency(totalAmount, currency)}`,
      approval_status: approved ? 'Approved' : 'Declined',
      company_id: companyUser?.company_id,
    })
    if (errWf3) { showError('Failed to create manager notification: ' + errWf3.message) }

    if (companyUser?.company_id) {
      sendFeatureEmail({
        companyId: companyUser.company_id,
        employeeId: claim.employee_id,
        featureKey: 'expenses_enabled',
        title: approved ? 'Expense Claim Approved' : 'Expense Claim Declined',
        message: approved
          ? `Your expense claim ${claim.reference_number} for ${formatCurrency(totalAmount, currency)} has been approved.`
          : `Your expense claim ${claim.reference_number} for ${formatCurrency(totalAmount, currency)} has been declined. Please contact your manager for details.`,
        type: approved ? 'info' : 'alert',
        link: '/expenses',
      })
      try {
        await sendSlackNotification({
          companyId: companyUser.company_id,
          notifyKey: 'notify_expense_claims',
          message: approved
            ? `✅ *Expense Claim Approved*\nExpense claim ${claim.reference_number} for ${formatCurrency(totalAmount, currency)} has been approved.`
            : `❌ *Expense Claim Declined*\nExpense claim ${claim.reference_number} for ${formatCurrency(totalAmount, currency)} has been declined.`,
        })
      } catch { /* notification failure should not block the user */ }
    }

    showSuccess(approved ? 'Expense approved' : 'Expense declined')
    window.dispatchEvent(new Event('notifications-updated'))
    navigate('/notifications')
  }

  async function handleManagerDelete() {
    if (!claim) return
    if (!confirm(`Delete expense claim ${claim.reference_number}? This cannot be undone.`)) return
    setDeleting(true)
    const { error } = await supabase.from('expense_line_items').delete().eq('expense_claim_id', claim.id).eq('company_id', companyUser?.company_id)
    if (error) { showError('Failed to delete line items: ' + error.message); setDeleting(false); return }
    const { error: error2 } = await supabase.from('workflow_tracker').delete().eq('record_type', 'Expense').eq('approval_id', claim.id).eq('company_id', companyUser?.company_id)
    if (error2) { showError('Failed to delete workflow entries: ' + error2.message) }
    const { error: error3 } = await supabase.from('expense_claims').delete().eq('id', claim.id).eq('company_id', companyUser?.company_id)
    if (error3) { showError('Failed to delete expense claim: ' + error3.message); setDeleting(false); return }
    window.dispatchEvent(new Event('notifications-updated'))
    navigate('/notifications')
  }

  if (loading) return <div className="feature-page"><p className="claims-empty">{t('common.loading')}</p></div>
  if (!claim) return <div className="feature-page"><p className="claims-empty">{t('approval.claim_not_found')}</p></div>

  const isActionable = claim.status === 'submitted' || claim.status === 'pending'

  return (
    <div className="feature-page exp-approval-page">
      <header className="exp-approval-header">
        <button className="exp-approval-back" onClick={() => navigate('/notifications')}>
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
            <circle cx="18" cy="18" r="16" stroke="#fff" strokeWidth="2" />
            <path d="M21 12l-6 6 6 6" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <h1 className="exp-approval-title">{t('approval.expense_title')}</h1>
        <button className="exp-approval-refresh" onClick={fetchData}>
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="14" stroke="#c62828" strokeWidth="2" />
            <path d="M22 14a6.5 6.5 0 0 0-11.3-1.5M10 18a6.5 6.5 0 0 0 11.3 1.5" stroke="#c62828" strokeWidth="2" strokeLinecap="round" />
            <path d="M22 10v4h-4M10 22v-4h4" stroke="#c62828" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </header>

      <div className="exp-approval-body">
        <div className="exp-approval-info">
          <div className="exp-approval-info-row">
            <span className="exp-approval-label">{t('approval.claim_reference')}</span>
            <span className="exp-approval-value">{claim.reference_number}</span>
          </div>
          <div className="exp-approval-info-row">
            <span className="exp-approval-label">{t('approval.submitted_by')}</span>
            <span className="exp-approval-value">{empName}</span>
          </div>
          <div className="exp-approval-info-row">
            <span className="exp-approval-label">{t('approval.claim_title')}</span>
            <span className="exp-approval-value">{claim.title}</span>
          </div>
          {claim.submitted_at && (
            <div className="exp-approval-info-row">
              <span className="exp-approval-label">{t('approval.date_submitted')}</span>
              <span className="exp-approval-value">{formatDateTime(claim.submitted_at)}</span>
            </div>
          )}
          <div className="exp-approval-info-row">
            <span className="exp-approval-label">{t('common.status')}</span>
            <span className={`approval-status-badge status-${claim.status}`}>
              {tStatus(claim.status)}
            </span>
          </div>
        </div>

        {items.length > 0 && (
          <div className="exp-approval-items">
            <span className="exp-approval-items-label">{t('approval.line_items')}</span>
            {items.map(item => (
              <div key={item.id} className="exp-approval-item-row">
                <span className="exp-approval-item-title">{item.title}</span>
                <span className="exp-approval-item-type">{tExpenseType(item.expense_type)}</span>
                {item.receipt_url && (
                  <button className="exp-approval-receipt" title={t('common.view_receipt')} onClick={() => setViewingReceipt(item.receipt_url)}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#43a047" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="16" y1="13" x2="8" y2="13" />
                      <line x1="16" y1="17" x2="8" y2="17" />
                    </svg>
                  </button>
                )}
                <span className="exp-approval-item-amount">{formatCurrency(item.amount, currency)}</span>
              </div>
            ))}
          </div>
        )}

        {isActionable && (
          <div className="exp-approval-action-area">
            <div className="exp-approval-buttons">
              <button className="exp-approve-btn" onClick={() => handleDecision(true)} disabled={processing}>
                {processing ? '...' : t('approval.approve')}
              </button>
              <button className="exp-decline-btn" onClick={() => handleDecision(false)} disabled={processing}>
                {processing ? '...' : t('approval.decline')}
              </button>
            </div>
            <textarea
              className="exp-approval-response"
              placeholder={t('approval.response_placeholder')}
              value={response}
              onChange={e => setResponse(e.target.value)}
              rows={4}
            />
          </div>
        )}

        {!isActionable && (
          <div className="approval-decided">
            <span>{t('approval.claim_decided')} {tStatus(claim.status)}</span>
          </div>
        )}

        <div className="exp-approval-total-row">
          <span className="exp-approval-total-label">{t('approval.total_amount')}</span>
          <span className="exp-approval-total-value">{formatCurrency(totalAmount, currency)}</span>
        </div>

        {claim.status !== 'draft' && (
          <div className="manager-delete-section">
            <button className="manager-delete-btn" onClick={handleManagerDelete} disabled={deleting}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              {deleting ? t('approval.deleting') : t('approval.delete_claim')}
            </button>
          </div>
        )}
      </div>

      {viewingReceipt && (
        <div className="receipt-modal-overlay" onClick={() => setViewingReceipt(null)}>
          <div className="receipt-modal" onClick={e => e.stopPropagation()}>
            <button className="receipt-modal-close" onClick={() => setViewingReceipt(null)}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
            <img src={viewingReceipt} alt="Receipt" className="receipt-modal-img" />
          </div>
        </div>
      )}
    </div>
  )
}
