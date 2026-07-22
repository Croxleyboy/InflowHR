import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../context/LanguageContext'
import ExpenseGraph from '../components/ExpenseGraph'

type ClaimStatus = 'draft' | 'pending' | 'submitted' | 'approved' | 'rejected'
type Filter = ClaimStatus | 'all'

interface Claim {
  id: number
  reference_number: string
  title: string
  description: string | null
  amount: number
  status: ClaimStatus
  created_at: string
}

const statusColor: Record<ClaimStatus, string> = {
  draft: '#9e9e9e',
  pending: '#ff9800',
  submitted: '#2196f3',
  approved: '#4caf50',
  rejected: '#f44336',
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr)
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const day = d.getDate()
  const suffix = day === 1 || day === 21 || day === 31 ? 'st' : day === 2 || day === 22 ? 'nd' : day === 3 || day === 23 ? 'rd' : 'th'
  return `${days[d.getDay()]}, ${day}${suffix} ${months[d.getMonth()]}`
}

function formatAmount(n: number) {
  return `£${n.toFixed(2)}`
}

export default function Expenses() {
  const navigate = useNavigate()
  const { t, tStatus } = useLanguage()
  const [filter, setFilter] = useState<Filter>('all')
  const [claims, setClaims] = useState<Claim[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showGraph, setShowGraph] = useState(false)

  const fetchClaims = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('expense_claims')
      .select('id, reference_number, title, description, amount, status, created_at')
      .order('created_at', { ascending: false })

    if (err) {
      setError(err.message)
    } else {
      setClaims(data as Claim[])
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchClaims() }, [fetchClaims])

  const filtered = filter === 'all' ? claims : claims.filter(c => c.status === filter)

  const totalClaims = claims.reduce((s, c) => s + c.amount, 0)
  const approvedTotal = claims.filter(c => c.status === 'approved').reduce((s, c) => s + c.amount, 0)
  const pendingTotal = claims.filter(c => c.status === 'pending').reduce((s, c) => s + c.amount, 0)

  const submittedTotal = claims.filter(c => c.status === 'submitted').reduce((s, c) => s + c.amount, 0)

  const filters: { key: Filter; label: string }[] = [
    { key: 'draft', label: t('expenses.draft') },
    { key: 'submitted', label: t('expenses.submitted') },
    { key: 'pending', label: t('expenses.pending') },
    { key: 'approved', label: t('expenses.approved') },
    { key: 'all', label: t('expenses.all') },
  ]

  return (
    <div className="feature-page expenses-page">
      <header className="feature-header">
        <button className="feature-back" onClick={() => navigate('/')}>
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
            <circle cx="18" cy="18" r="17" stroke="#3d6b99" strokeWidth="2" />
            <path d="M21 12l-6 6 6 6" stroke="#3d6b99" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="feature-header-center">
          <h1 className="feature-title">{t('expenses.title')} <span className="feature-title-accent">{t('expenses.title_accent')}</span></h1>
          <p className="feature-subtitle">{t('expenses.subtitle')}</p>
        </div>
        <button className="expense-graph-btn" onClick={() => setShowGraph(true)} title={t('expenses.graph_title')}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#3d6b99" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="12" width="4" height="9" rx="1" fill="#4caf50" stroke="none" />
            <rect x="10" y="7" width="4" height="14" rx="1" fill="#2196f3" stroke="none" />
            <rect x="17" y="3" width="4" height="18" rx="1" fill="#f44336" stroke="none" />
          </svg>
        </button>
        <button className="feature-refresh" onClick={fetchClaims}>
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="14" stroke="#3d6b99" strokeWidth="2" />
            <path d="M22 14a6.5 6.5 0 0 0-11.3-1.5M10 18a6.5 6.5 0 0 0 11.3 1.5" stroke="#3d6b99" strokeWidth="2" strokeLinecap="round" />
            <path d="M22 10v4h-4M10 22v-4h4" stroke="#3d6b99" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </header>

      <div className="expense-summary">
        <div className="summary-card">
          <span className="summary-label">{t('expenses.total_claims')}</span>
          <span className="summary-value">{formatAmount(totalClaims)}</span>
        </div>
        <div className="summary-card">
          <span className="summary-label">{t('expenses.approved')}</span>
          <span className="summary-value">{formatAmount(approvedTotal)}</span>
        </div>
        <div className="summary-card">
          <span className="summary-label">{t('expenses.pending')}</span>
          <span className="summary-value">{formatAmount(pendingTotal)}</span>
        </div>
      </div>

      <div className="expense-filters">
        {filters.map(f => (
          <button
            key={f.key}
            className={`filter-btn ${filter === f.key ? 'filter-active' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <button className="add-claim-btn" onClick={() => navigate('/expenses/new')}>{t('expenses.add_new')}</button>

      {loading && <p className="claims-empty">{t('expenses.loading')}</p>}
      {error && <p className="claims-empty" style={{ color: '#f44336' }}>Error: {error}</p>}

      <div className="claims-list">
        {!loading && !error && filtered.length === 0 && (
          <p className="claims-empty">{t('expenses.no_claims')}</p>
        )}
        {filtered.map(claim => (
          <button key={claim.id} className="claim-row" onClick={() => navigate(`/expenses/${claim.id}`)}>
            <div className="claim-date-col">
              <span className="claim-date">{formatDate(claim.created_at)}</span>
              <span className="claim-id">ID: {claim.id}</span>
            </div>
            <div className="claim-detail-col">
              <span className="claim-desc">{claim.title}</span>
              <div className="claim-amount-row">
                <span className="claim-amount">{formatAmount(claim.amount)}</span>
                <span className="claim-status">
                  <span className="status-dot" style={{ background: statusColor[claim.status] }} />
                  {tStatus(claim.status)}
                </span>
              </div>
            </div>
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none" className="claim-arrow">
              <path d="M12 6l10 10-10 10" stroke="#3d6b99" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ))}
      </div>

      {showGraph && <ExpenseGraph onClose={() => setShowGraph(false)} />}
    </div>
  )
}
