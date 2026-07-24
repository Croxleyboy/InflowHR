import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'
import NewExpenseItem from './NewExpenseItem'

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
}

function formatDateTime(dateStr: string) {
  const d = new Date(dateStr)
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const year = d.getFullYear()
  const hours = String(d.getHours()).padStart(2, '0')
  const mins = String(d.getMinutes()).padStart(2, '0')
  return `${day}/${month}/${year} ${hours}:${mins}`
}

export default function ExpenseDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t, tStatus, tExpenseType } = useLanguage()
  const { employeeName: HARDCODED_EMPLOYEE_NAME, employeeEmail: HARDCODED_EMPLOYEE_EMAIL } = useAuth()
  const HARDCODED_MANAGER_EMAIL = HARDCODED_EMPLOYEE_EMAIL
  const [claim, setClaim] = useState<Claim | null>(null)
  const [items, setItems] = useState<LineItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showNewItem, setShowNewItem] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const fetchData = useCallback(async () => {
    if (!id) return
    setLoading(true)
    const [claimRes, itemsRes] = await Promise.all([
      supabase.from('expense_claims').select('id, reference_number, title, status, amount, created_at').eq('id', id).single(),
      supabase.from('expense_line_items').select('id, title, expense_type, amount, date_of_purchase, description').eq('expense_claim_id', id).order('created_at', { ascending: true }),
    ])
    if (claimRes.data) setClaim(claimRes.data as Claim)
    if (itemsRes.data) setItems(itemsRes.data as LineItem[])
    setLoading(false)
  }, [id])

  useEffect(() => { fetchData() }, [fetchData])

  const totalAmount = items.reduce((s, i) => s + i.amount, 0)

  const allItemsValid = items.length > 0 && items.every(i => i.title && i.amount > 0)

  async function handleDeleteItem(itemId: number) {
    if (!confirm('Delete this line item?')) return
    await supabase.from('expense_line_items').delete().eq('id', itemId)
    const remaining = items.filter(i => i.id !== itemId)
    setItems(remaining)
    const newTotal = remaining.reduce((s, i) => s + i.amount, 0)
    await supabase.from('expense_claims').update({ amount: newTotal }).eq('id', id)
    setClaim(prev => prev ? { ...prev, amount: newTotal } : prev)
  }

  async function handleDelete() {
    if (!confirm('Delete this expense claim and all its items?')) return
    setDeleting(true)
    await supabase.from('expense_line_items').delete().eq('expense_claim_id', id)
    await supabase.from('expense_claims').delete().eq('id', id)
    navigate('/expenses')
  }

  async function handleSubmit() {
    if (!allItemsValid || !claim) return
    setSubmitting(true)
    const now = new Date().toISOString()

    await supabase.from('expense_claims').update({
      status: 'submitted',
      amount: totalAmount,
      submitted_at: now,
    }).eq('id', id)

    await supabase.from('workflow_tracker').insert({
      emp_display_name: HARDCODED_EMPLOYEE_NAME,
      step: 1,
      status: 'Pending',
      record_type: 'Expense',
      action: 'Expense claim submitted for approval',
      employee_email: HARDCODED_EMPLOYEE_EMAIL,
      assigned_to: HARDCODED_MANAGER_EMAIL,
      approval_id: claim.id,
      reminder_count: 1,
      task_description: `Expense claim ${claim.reference_number} - ${claim.title} - £${totalAmount.toFixed(2)}`,
    })

    navigate('/expenses')
  }

  async function handleItemAdded() {
    setShowNewItem(false)
    const { data } = await supabase.from('expense_line_items').select('id, title, expense_type, amount, date_of_purchase, description').eq('expense_claim_id', id).order('created_at', { ascending: true })
    if (data) setItems(data as LineItem[])
    const newTotal = (data as LineItem[] || []).reduce((s, i) => s + i.amount, 0)
    await supabase.from('expense_claims').update({ amount: newTotal }).eq('id', id)
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
            <span className="detail-meta-value detail-status">{tStatus(claim.status)}</span>
          </div>
          <div className="detail-meta-row">
            <span className="detail-meta-label">{t('expense_detail.reference')}</span>
            <span className="detail-meta-value">{claim.reference_number}</span>
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
          <span className="line-item-total">£{totalAmount.toFixed(2)}</span>
        </button>
      ) : (
        <div className="add-line-item-btn" style={{ cursor: 'default' }}>
          <span>{t('expense_detail.line_items')}</span>
          <span className="line-item-total">£{totalAmount.toFixed(2)}</span>
        </div>
      )}

      <div className="line-items-list">
        {items.map(item => (
          <div key={item.id} className="line-item-row">
            <div className="line-item-info">
              <span className="line-item-title">{item.title}</span>
              <span className="line-item-type">{tExpenseType(item.expense_type)}</span>
            </div>
            <span className="line-item-amount">£{item.amount.toFixed(2)}</span>
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
    </div>
  )
}
