import { useState, useEffect } from 'react'
import { supabase, callRpcDirect } from '../../lib/supabase'
import { useToast } from '../../context/ToastContext'

interface TrialRequest {
  id: string
  full_name: string
  work_email: string
  phone: string
  status: string
  company_name: string | null
  company_id: string | null
  admin_password: string | null
  employee_email: string | null
  employee_password: string | null
  created_at: string
  processed_at: string | null
}

export default function AdminTrialRequests() {
  const { showSuccess, showError } = useToast()
  const [requests, setRequests] = useState<TrialRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [companyNames, setCompanyNames] = useState<Record<string, string>>({})
  const [creating, setCreating] = useState<string | null>(null)

  useEffect(() => { loadRequests() }, [])

  async function loadRequests() {
    setLoading(true)
    const { data } = await supabase
      .from('trial_requests')
      .select('*')
      .order('created_at', { ascending: false })
    setRequests((data as TrialRequest[]) || [])
    setLoading(false)
  }

  async function handleCreate(request: TrialRequest) {
    const name = (companyNames[request.id] || '').trim()
    if (!name) {
      showError('Please enter a company name')
      return
    }
    setCreating(request.id)
    const { error } = await callRpcDirect('create_trial_data', {
      p_request_id: request.id,
      p_company_name: name,
    })
    if (error) {
      showError(error || 'Failed to create trial data')
      setCreating(null)
      return
    }
    showSuccess('Trial company created successfully')
    setCreating(null)
    loadRequests()
  }

  function formatDate(d: string) {
    return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
  }

  function copyText(text: string) {
    navigator.clipboard.writeText(text)
    showSuccess('Copied to clipboard')
  }

  if (loading) return <div className="admin-loading">Loading trial requests...</div>

  if (requests.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 40, color: '#666' }}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>
        </svg>
        <p style={{ marginTop: 12 }}>No trial requests yet</p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {requests.map(r => (
        <div key={r.id} className="trial-request-card">
          <div className="trial-request-header">
            <div>
              <strong>{r.full_name}</strong>
              <span className={`trial-request-status trial-request-status-${r.status}`}>{r.status}</span>
            </div>
            <span className="trial-request-date">{formatDate(r.created_at)}</span>
          </div>

          <div className="trial-request-details">
            <div className="trial-request-field">
              <span className="trial-request-label">Email</span>
              <span>{r.work_email}</span>
            </div>
            <div className="trial-request-field">
              <span className="trial-request-label">Phone</span>
              <span>{r.phone}</span>
            </div>
          </div>

          {r.status === 'pending' && (
            <div className="trial-request-actions">
              <input
                type="text"
                placeholder="Enter company name"
                value={companyNames[r.id] || ''}
                onChange={e => setCompanyNames(prev => ({ ...prev, [r.id]: e.target.value }))}
                className="trial-request-input"
              />
              <button
                onClick={() => handleCreate(r)}
                disabled={creating === r.id || !(companyNames[r.id] || '').trim()}
                className="trial-request-create-btn"
              >
                {creating === r.id ? 'Creating...' : 'Create Trial Data'}
              </button>
            </div>
          )}

          {r.status === 'approved' && (
            <div className="trial-request-credentials">
              <div className="trial-request-cred-section">
                <h4>Admin Login</h4>
                <div className="trial-request-cred-row">
                  <span>Email: {r.work_email}</span>
                  <button onClick={() => copyText(r.work_email)} className="trial-request-copy-btn">Copy</button>
                </div>
                <div className="trial-request-cred-row">
                  <span>Password: {r.admin_password}</span>
                  <button onClick={() => copyText(r.admin_password || '')} className="trial-request-copy-btn">Copy</button>
                </div>
              </div>
              <div className="trial-request-cred-section">
                <h4>Employee Test Login (Sarah Mitchell)</h4>
                <div className="trial-request-cred-row">
                  <span>Email: {r.employee_email}</span>
                  <button onClick={() => copyText(r.employee_email || '')} className="trial-request-copy-btn">Copy</button>
                </div>
                <div className="trial-request-cred-row">
                  <span>Password: {r.employee_password}</span>
                  <button onClick={() => copyText(r.employee_password || '')} className="trial-request-copy-btn">Copy</button>
                </div>
              </div>
              <div className="trial-request-cred-row" style={{ marginTop: 8 }}>
                <span>Company: {r.company_name}</span>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
