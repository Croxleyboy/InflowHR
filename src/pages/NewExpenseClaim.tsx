import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'
import { formatDateDisplay, toLocalDateStr } from '../lib/formatters'

function todayStr() {
  const d = new Date()
  return toLocalDateStr(d)
}

export default function NewExpenseClaim() {
  const navigate = useNavigate()
  const { t } = useLanguage()
  const { employeeId: EMPLOYEE_ID, employeeName, avatarUrl, companyUser } = useAuth()
  const [startDate, setStartDate] = useState(todayStr())
  const [endDate, setEndDate] = useState(todayStr())
  const [costCenter, setCostCenter] = useState('External expenses')
  const [title, setTitle] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCreate() {
    if (!title.trim()) {
      setError(t('new_claim.error_title'))
      return
    }
    setCreating(true)
    setError(null)

    const refNum = `EXP-${Date.now().toString().slice(-6)}`

    const { data, error: err } = await supabase
      .from('expense_claims')
      .insert({
        employee_id: EMPLOYEE_ID,
        reference_number: refNum,
        title: title.trim(),
        amount: 0,
        status: 'draft',
        cost_center: costCenter,
        start_date: startDate,
        end_date: endDate,
        company_id: companyUser?.company_id,
      })
      .select('id')
      .single()

    if (err) {
      setError(err.message)
      setCreating(false)
    } else {
      navigate(`/expenses/${data.id}`)
    }
  }

  return (
    <div className="feature-page new-claim-page">
      <header className="new-claim-header">
        <button className="new-claim-back" onClick={() => navigate('/expenses')}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 className="new-claim-title">{t('new_claim.title')}</h1>
      </header>

      <div className="new-claim-profile">
        <span className="new-claim-name">{employeeName}</span>
        {avatarUrl ? <img className="new-claim-avatar-img" src={avatarUrl} alt={employeeName} /> : <div className="new-claim-avatar">{employeeName.split(' ').map(n => n[0]).join('').toUpperCase()}</div>}
        <span className="new-claim-role">HR Director</span>
      </div>

      <div className="new-claim-form">
        <div className="date-row">
          <div className="date-field">
            <label className="field-label">{t('new_claim.start_date')}</label>
            <div className="date-input-wrap">
              <span className="date-display">{formatDateDisplay(startDate)}</span>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="date-input-hidden"
              />
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5b9bd5" strokeWidth="2" className="date-icon">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </div>
          </div>
          <div className="date-field">
            <label className="field-label">{t('new_claim.end_date')}</label>
            <div className="date-input-wrap">
              <span className="date-display">{formatDateDisplay(endDate)}</span>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="date-input-hidden"
              />
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5b9bd5" strokeWidth="2" className="date-icon">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </div>
          </div>
        </div>

        <div className="form-field">
          <label className="field-label">{t('new_claim.cost_center')}</label>
          <div className="select-wrap">
            <select
              value={costCenter}
              onChange={e => setCostCenter(e.target.value)}
              className="form-select"
            >
              <option value="External expenses">{t('cost_center.external')}</option>
              <option value="Internal expenses">{t('cost_center.internal')}</option>
            </select>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5b9bd5" strokeWidth="2.5" className="select-arrow">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>
        </div>

        <div className="form-field">
          <label className="field-label sr-only">{t('new_claim.title_placeholder')}</label>
          <input
            type="text"
            placeholder={t('new_claim.title_placeholder')}
            value={title}
            onChange={e => setTitle(e.target.value)}
            className="form-input"
          />
        </div>

        <p className="form-hint">{t('new_claim.hint')}</p>

        {error && <p className="form-error">{error}</p>}

        <button
          className="create-claim-btn"
          onClick={handleCreate}
          disabled={creating}
        >
          {creating ? t('new_claim.creating') : t('new_claim.create')}
        </button>
      </div>
    </div>
  )
}
