import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'
import NewExpenseItem from './NewExpenseItem'
import { formatDateTime, formatCurrency } from '../lib/formatters'
import { useToast } from '../context/ToastContext'
import { getManagerEmail } from '../lib/workflow'
import { sendTeamsNotification } from '../lib/teamsNotifications'

interface Claim {
  id: number
  reference_number: string
  title: string
  status: string
  amount: number
  created_at: string
}

interface LineItem {
  id: number
  title: string
  expense_type: string
  amount: number
  date_of_purchase: string
  description: string | null
  receipt_url: string | null
}

export default function ExpenseDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t, tStatus, tExpenseType } = useLanguage()
  const { employeeId, employeeName: HARDCODED_EMPLOYEE_NAME, employeeEmail: HARDCODED_EMPLOYEE_EMAIL, companyUser, company } = useAuth()
  const currency = company?.currency || 'GBP'
  const { showError, showSuccess } = useToast()
  const [claim, setClaim] = useState<Claim | null>(null)
  const [items, setItems] = useState<LineItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showNewItem, setShowNewItem] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [viewingReceipt, setViewingReceipt] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    if (!id) return
    setLoading(true)
    const [claimRes, itemsRes] = await Promise.all([
      supabase.from('expense_claims').select('id, reference_number, title, status, amount, created_at').eq('id', id).eq('company_id', companyUser?.company_id).single(),
      supabase.from('expense_line_items').select('id, title, expense_type, amount, date_of_purchase, description, receipt_url').eq('expense_claim_id', id).eq('company_id', companyUser?.company_id).order('created_at', { ascending: true }),
    ])
    if (claimRes.data) setClaim(claimRes.data as Claim)
    if (itemsRes.data) setItems(itemsRes.data as LineItem[])
    setLoading(false)
  }, [id, companyUser?.company_id])

  useEffect(() => { fetchData() }, [fetchData])

  const totalAmount = items.reduce((s, i) => s + i.amount, 0)

  const allItemsValid = items.length > 0 && items.every(i => i.title && i.amount > 0)

  async function handleDeleteItem(itemId: number) {
    if (!confirm('Delete this line item?')) return
    const { error } = await supabase.from('expense_line_items').delete().eq('id', itemId).eq('company_id', companyUser?.company_id)
    if (error) { showError('Failed to delete line item: ' + error.message); return }
    const remaining = items.filter(i => i.id !== itemId)
    setItems(remaining)
    const newTotal = remaining.reduce((s, i) => s + i.amount, 0)
    const { error: error2 } = await supabase.from('expense_claims').update({ amount: newTotal }).eq('id', id).eq('company_id', companyUser?.company_id)
    if (error2) { showError('Failed to update claim total: ' + error2.message) }
    setClaim(prev => prev ? { ...prev, amount: newTotal } : prev)
  }

  async function handleDelete() {
    if (!confirm('Delete this expense claim and all its items?')) return
    setDeleting(true)
    const { error } = await supabase.from('expense_line_items').delete().eq('expense_claim_id', id).eq('company_id', companyUser?.company_id)
    if (error) { showError('Failed to delete line items: ' + error.message); setDeleting(false); return }
    const { error: error2 } = await supabase.from('expense_claims').delete().eq('id', id).eq('company_id', companyUser?.company_id)
    if (error2) { showError('Failed to delete expense claim: ' + error2.message); setDeleting(false); return }
    navigate('/expenses')
  }

  async function handleSubmit() {
    if (!allItemsValid || !claim) return
    setSubmitting(true)
    const now = new Date().toISOString()

    const { error } = await supabase.from('expense_claims').update({
      status: 'submitted',
      amount: totalAmount,
      submitted_at: now,
    }).eq('id', id).eq('company_id', companyUser?.company_id)
    if (error) { showError('Failed to submit expense claim: ' + error.message); setSubmitting(false); return }

    const managerEmail = await getManagerEmail(employeeId, HARDCODED_EMPLOYEE_EMAIL, 'expenses')

    const { error: error2 } = await supabase.from('workflow_tracker').insert({
      emp_display_name: HARDCODED_EMPLOYEE_NAME,
      step: 1,
      status: 'Pending',
      record_type: 'Expense',
      action: 'Expense claim submitted for approval',
      employee_email: HARDCODED_EMPLOYEE_EMAIL,
      assigned_to: managerEmail,
      approval_id: claim.id,
      reminder_count: 1,
      task_description: `Expense claim ${claim.reference_number} - ${claim.title} - ${formatCurrency(totalAmount, currency)}`,
      company_id: companyUser?.company_id,
    })
    if (error2) { showError('Failed to create workflow entry: ' + error2.message); setSubmitting(false); return }

    await supabase.from('workflow_tracker').insert({
      emp_display_name: HARDCODED_EMPLOYEE_NAME,
      step: 1,
      status: 'Complete',
      record_type: 'Expense',
      action: 'Expense claim submitted',
      employee_email: HARDCODED_EMPLOYEE_EMAIL,
      assigned_to: HARDCODED_EMPLOYEE_EMAIL,
      approval_id: claim.id,
      reminder_count: 1,
      task_description: `Expense claim submitted: ${claim.reference_number} - ${claim.title} - ${formatCurrency(totalAmount, currency)}`,
      approval_status: 'Submitted',
      company_id: companyUser?.company_id,
    })

    if (companyUser?.company_id && managerEmail) {
      try {
        await sendTeamsNotification({
          companyId: companyUser.company_id,
          managerEmail,
          employeeName: HARDCODED_EMPLOYEE_NAME,
          message: `Expense claim needs your approval: ${claim.reference_number} - ${claim.title} - ${formatCurrency(totalAmount, currency)}`,
        })
      } catch { /* notification failure should not block the user */ }
    }

    showSuccess('Expense claim submitted')
    window.dispatchEvent(new Event('notifications-updated'))
    navigate('/expenses')
  }

  async function handleItemAdded() {
    setShowNewItem(false)
    const { data } = await supabase.from('expense_line_items').select('id, title, expense_type, amount, date_of_purchase, description, receipt_url').eq('expense_claim_id', id).eq('company_id', companyUser?.company_id).order('created_at', { ascending: true })
    if (data) setItems(data as LineItem[])
    const newTotal = (data as LineItem[] || []).reduce((s, i) => s + i.amount, 0)
    const { error } = await supabase.from('expense_claims').update({ amount: newTotal }).eq('id', id).eq('company_id', companyUser?.company_id)
    if (error) { showError('Failed to update claim total: ' + error.message) }
    setClaim(prev => prev ? { ...prev, amount: newTotal } : prev)
  }

  if (loading) return <div className="feature-page"><p className="claims-empty">{t('common.loading')}</p></div>
  if (!claim) return <div className="feature-page"><p className="claims-empty">{t('expense_detail.claim_not_found')}</p></div>

  const isEditable = claim.status === 'draft'

  return (
    <div className="feature-page expense-detail-page">
      <header className="new-claim-header">
        <button className="new-claim-back" onClick={() => navigate('/expenses')}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 className="new-claim-title">{t('expense_detail.title')}</h1>
        <button className="feature-refresh" onClick={fetchData} style={{ marginLeft: 'auto' }}>
          <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="14" stroke="#fff" strokeWidth="2" />
            <path d="M22 14a6.5 6.5 0 0 0-11.3-1.5M10 18a6.5 6.5 0 0 0 11.3 1.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
            <path d="M22 10v4h-4M10 22v-4h4" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </header>

      <div className="detail-title-bar">
        <span className="detail-claim-title">{claim.title}</span>
      </div>

      <div className="detail-meta">
        <div className="detail-meta-left">
          <div className="detail-meta-row">
            <span className="detail-meta-label">{t('expense_detail.status')}</span>
            <span className={`detail-meta-value detail-status detail-status-${claim.status}`}>{tStatus(claim.status)}</span>
          </div>
          <div className="detail-meta-row">
            <span className="detail-meta-label">{t('expense_detail.reference')}</span>
            <span className="detail-meta-value detail-meta-reference">{claim.reference_number}</span>
          </div>
        </div>
        <div className="detail-meta-right">
          <div className="detail-meta-row">
            <span className="detail-meta-label">{t('expense_detail.created')}</span>
            <span className="detail-meta-value">{formatDateTime(claim.created_at)}</span>
          </div>
        </div>
        {isEditable && (
          <button className="detail-delete" onClick={handleDelete} disabled={deleting}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
        )}
      </div>

      {isEditable ? (
        <button className="add-line-item-btn" onClick={() => setShowNewItem(true)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#c62828" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <span>{t('expense_detail.add_line')}</span>
          <span className="line-item-total">{formatCurrency(totalAmount, currency)}</span>
        </button>
      ) : (
        <div className="add-line-item-btn" style={{ cursor: 'default' }}>
          <span>{t('expense_detail.line_items')}</span>
          <span className="line-item-total">{formatCurrency(totalAmount, currency)}</span>
        </div>
      )}

      <div className="line-items-list">
        {items.map(item => (
          <div key={item.id} className="line-item-row">
            <div className="line-item-info">
              <span className="line-item-title">{item.title}</span>
              <span className="line-item-type">{tExpenseType(item.expense_type)}</span>
            </div>
            {item.receipt_url && (
              <button className="line-item-receipt" title={t('common.view_receipt')} onClick={() => setViewingReceipt(item.receipt_url)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#43a047" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                </svg>
              </button>
            )}
            <span className="line-item-amount">{formatCurrency(item.amount, currency)}</span>
            {isEditable && (
              <button className="line-item-delete" onClick={() => handleDeleteItem(item.id)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#c62828" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
            )}
          </div>
        ))}
      </div>

      {isEditable && (
        <button
          className="submit-claim-btn"
          onClick={handleSubmit}
          disabled={submitting || !allItemsValid}
          title={!allItemsValid ? 'Add at least one line item with a title, description, and value' : ''}
        >
          {submitting ? t('expense_detail.submitting') : t('expense_detail.submit')}
        </button>
      )}

      {showNewItem && (
        <NewExpenseItem
          claimId={claim.id}
          claimRef={claim.reference_number}
          onClose={() => setShowNewItem(false)}
          onSaved={handleItemAdded}
        />
      )}

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
