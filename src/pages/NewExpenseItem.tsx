import { useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../context/LanguageContext'
import { EXPENSE_TYPE_KEYS } from '../lib/translations'

interface Props {
  claimId: number
  claimRef: string
  onClose: () => void
  onSaved: () => void
}

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

function formatDateDisplay(dateStr: string) {
  const [y, m, d] = dateStr.split('-')
  return `${d}/${m}/${y}`
}

export default function NewExpenseItem({ claimId, claimRef, onClose, onSaved }: Props) {
  const { t, tExpenseType } = useLanguage()
  const [title, setTitle] = useState('')
  const [expenseType, setExpenseType] = useState(EXPENSE_TYPE_KEYS[0])
  const [description, setDescription] = useState('')
  const [dateOfPurchase, setDateOfPurchase] = useState(todayStr())
  const [amount, setAmount] = useState('')
  const [mileageFrom, setMileageFrom] = useState('')
  const [mileageTo, setMileageTo] = useState('')
  const [totalMiles, setTotalMiles] = useState('')
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null)
  const [receiptData, setReceiptData] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const canSubmit = title.trim().length > 0 && description.trim().length > 0 && !!amount && parseFloat(amount) > 0

  function handleReceiptCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      setReceiptPreview(result)
      setReceiptData(result)
    }
    reader.readAsDataURL(file)
  }

  async function handleSubmit() {
    if (!title.trim()) { setError(t('new_item.error_title')); return }
    if (!description.trim()) { setError(t('new_item.error_description')); return }
    if (!amount || parseFloat(amount) <= 0) { setError(t('new_item.error_cost')); return }

    setSaving(true)
    setError(null)

    const { error: err } = await supabase.from('expense_line_items').insert({
      expense_claim_id: claimId,
      title: title.trim(),
      expense_type: expenseType,
      description: description.trim() || null,
      date_of_purchase: dateOfPurchase,
      amount: parseFloat(amount),
      mileage_from: mileageFrom.trim() || null,
      mileage_to: mileageTo.trim() || null,
      total_miles: totalMiles ? parseFloat(totalMiles) : null,
      receipt_url: receiptData,
    })

    if (err) {
      setError(err.message)
      setSaving(false)
    } else {
      onSaved()
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet" onClick={e => e.stopPropagation()}>
        <header className="new-claim-header" style={{ margin: '0 -16px', borderRadius: '0 0 16px 16px' }}>
          <button className="new-claim-back" onClick={onClose}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <h1 className="new-claim-title" style={{ fontSize: 18 }}>{t('new_item.title')}</h1>
            <span style={{ fontSize: 13, color: '#b0cfe0' }}>{claimRef}</span>
          </div>
          <div style={{ width: 24 }} />
        </header>

        <div className="modal-body">
          <input
            type="text"
            placeholder={t('new_item.title_placeholder')}
            value={title}
            onChange={e => setTitle(e.target.value)}
            className="form-input"
          />

          <div className="form-field">
            <label className="field-label" style={{ color: '#3d6b99' }}>{t('new_item.expense_type')}</label>
            <div className="select-wrap">
              <select value={expenseType} onChange={e => setExpenseType(e.target.value)} className="form-select">
                {EXPENSE_TYPE_KEYS.map(tp => <option key={tp} value={tp}>{tExpenseType(tp)}</option>)}
              </select>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5b9bd5" strokeWidth="2.5" className="select-arrow">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>
          </div>

          <textarea
            placeholder={t('new_item.description_placeholder')}
            value={description}
            onChange={e => setDescription(e.target.value)}
            className="form-textarea"
            rows={3}
          />

          <div className="date-mileage-row">
            <div className="date-field" style={{ flex: 2 }}>
              <label className="field-label" style={{ color: '#3d6b99' }}>{t('new_item.date_of_purchase')}</label>
              <div className="date-input-wrap">
                <span className="date-display">{formatDateDisplay(dateOfPurchase)}</span>
                <input type="date" value={dateOfPurchase} onChange={e => setDateOfPurchase(e.target.value)} className="date-input-hidden" />
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5b9bd5" strokeWidth="2" className="date-icon">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <label className="field-label" style={{ color: '#3d6b99' }}>{t('new_item.mileage_from')}</label>
              <input
                type="number"
                inputMode="numeric"
                value={mileageFrom}
                onChange={e => setMileageFrom(e.target.value)}
                className="form-input form-input-sm"
                placeholder="0"
              />
            </div>
          </div>

          <div className="receipt-mileage-row">
            <div className="receipt-capture" onClick={() => fileRef.current?.click()}>
              {receiptPreview ? (
                <img src={receiptPreview} alt="Receipt" className="receipt-preview-img" />
              ) : (
                <>
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.5">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                  <span className="receipt-label">{t('new_item.snap_receipt')}</span>
                </>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleReceiptCapture}
                style={{ display: 'none' }}
              />
            </div>

            <div className="mileage-right">
              <div>
                <label className="field-label" style={{ color: '#3d6b99' }}>{t('new_item.mileage_to')}</label>
                <input
                  type="number"
                  inputMode="numeric"
                  value={mileageTo}
                  onChange={e => setMileageTo(e.target.value)}
                  className="form-input form-input-sm"
                  placeholder="0"
                />
              </div>
              <div>
                <label className="field-label" style={{ color: '#3d6b99' }}>{t('new_item.total_miles')}</label>
                <input
                  type="number"
                  inputMode="numeric"
                  value={totalMiles}
                  onChange={e => setTotalMiles(e.target.value)}
                  className="form-input form-input-sm"
                  placeholder="0"
                />
              </div>
            </div>
          </div>

          {error && <p className="form-error">{error}</p>}

          <div className="submit-cost-row">
            <button className="submit-expenses-btn" onClick={handleSubmit} disabled={saving || !canSubmit}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                <polyline points="17 21 17 13 7 13 7 21" />
                <polyline points="7 3 7 8 15 8" />
              </svg>
              <span>{saving ? t('new_item.saving') : t('new_item.submit')}</span>
            </button>
            <span className="total-cost-label">{t('new_item.total_cost')}</span>
            <span className="total-cost-currency">£</span>
            <input
              type="number"
              step="0.01"
              placeholder="0.00"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              className="form-input total-cost-input"
            />
          </div>
        </div>
      </div>
    </div>
  )
}
