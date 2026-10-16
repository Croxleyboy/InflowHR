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
  employee_email: string | null
  created_at: string
  processed_at: string | null
}

export default function AdminTrialRequests() {
  const { showSuccess, showError } = useToast()
  const [requests, setRequests] = useState<TrialRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [companyNames, setCompanyNames] = useState<Record<string, string>>({})
  const [creating, setCreating] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [oneTimeCredentials, setOneTimeCredentials] = useState<Record<string, { admin_email: string; admin_password: string; employee_email: string; employee_password: string }>>({})


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
    const { data, error } = await callRpcDirect('create_trial_data', {
      p_request_id: request.id,
      p_company_name: name,
    })
    if (error) {
      showError(error || 'Failed to create trial data')
      setCreating(null)
      return
    }
    if (data && typeof data === 'object') {
      const d = data as Record<string, string>
      setOneTimeCredentials(prev => ({ ...prev, [request.id]: {
        admin_email: d.admin_email || request.work_email,
        admin_password: d.admin_password || '',
        employee_email: d.employee_email || '',
        employee_password: d.employee_password || '',
      }}))
    }
    showSuccess('Trial company created — credentials shown below (one-time only)')
    setCreating(null)
    loadRequests()
  }

  async function handleDelete(request: TrialRequest) {
    const label = request.status === 'approved'
      ? `Delete trial request for "${request.full_name}" and their trial company "${request.company_name}"? This cannot be undone.`
      : `Delete trial request from "${request.full_name}"? This cannot be undone.`
    if (!confirm(label)) return
    setDeleting(request.id)
    if (request.status === 'approved' && request.company_id) {
      const { error: companyError } = await callRpcDirect('delete_company_data', { target_company_id: request.company_id })
      if (companyError) {
        showError('Failed to delete trial company: ' + companyError)
        setDeleting(null)
        return
      }
    }
    const { error } = await supabase.from('trial_requests').delete().eq('id', request.id)
    if (error) {
      showError('Failed to delete trial request: ' + error.message)
      setDeleting(null)
      return
    }
    showSuccess('Trial request deleted')
    setDeleting(null)
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span className="trial-request-date">{formatDate(r.created_at)}</span>
              <button
                onClick={() => handleDelete(r)}
                disabled={deleting === r.id}
                className="admin-btn-sm"
                style={{ background: '#e53935', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer', opacity: deleting === r.id ? 0.5 : 1 }}
              >
                {deleting === r.id ? 'Deleting...' : 'Delete'}
              </button>
            </div>
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
              {oneTimeCredentials[r.id] ? (
                <>
                  <div style={{ background: '#fff3e0', border: '1px solid #ffb74d', borderRadius: 6, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: '#e65100' }}>
                    These credentials are shown one time only. Copy them now — they will not be available after you leave this page.
                  </div>
                  <div className="trial-request-cred-section">
                    <h4>Admin Login</h4>
                    <div className="trial-request-cred-row">
                      <span>Email: {oneTimeCredentials[r.id].admin_email}</span>
                      <button onClick={() => copyText(oneTimeCredentials[r.id].admin_email)} className="trial-request-copy-btn">Copy</button>
                    </div>
                    <div className="trial-request-cred-row">
                      <span>Password: {oneTimeCredentials[r.id].admin_password}</span>
                      <button onClick={() => copyText(oneTimeCredentials[r.id].admin_password)} className="trial-request-copy-btn">Copy</button>
                    </div>
                  </div>
                  <div className="trial-request-cred-section">
                    <h4>Employee Test Login (Sarah Mitchell)</h4>
                    <div className="trial-request-cred-row">
                      <span>Email: {oneTimeCredentials[r.id].employee_email}</span>
                      <button onClick={() => copyText(oneTimeCredentials[r.id].employee_email)} className="trial-request-copy-btn">Copy</button>
                    </div>
                    <div className="trial-request-cred-row">
                      <span>Password: {oneTimeCredentials[r.id].employee_password}</span>
                      <button onClick={() => copyText(oneTimeCredentials[r.id].employee_password)} className="trial-request-copy-btn">Copy</button>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="trial-request-cred-section">
                    <h4>Admin Login</h4>
                    <div className="trial-request-cred-row">
                      <span>Email: {r.work_email}</span>
                      <button onClick={() => copyText(r.work_email)} className="trial-request-copy-btn">Copy</button>
                    </div>
                    <div className="trial-request-cred-row" style={{ color: '#999', fontStyle: 'italic' }}>
                      <span>Password was provided at creation time</span>
                    </div>
                  </div>
                  <div className="trial-request-cred-section">
                    <h4>Employee Test Login (Sarah Mitchell)</h4>
                    <div className="trial-request-cred-row">
                      <span>Email: {r.employee_email}</span>
                      <button onClick={() => copyText(r.employee_email || '')} className="trial-request-copy-btn">Copy</button>
                    </div>
                    <div className="trial-request-cred-row" style={{ color: '#999', fontStyle: 'italic' }}>
                      <span>Password was provided at creation time</span>
                    </div>
                  </div>
                </>
              )}
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
