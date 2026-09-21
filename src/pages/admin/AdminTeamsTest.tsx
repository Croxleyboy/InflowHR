import { useState, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'

interface Employee {
  id: string
  first_name: string
  last_name: string
  email: string
  avatar_url: string | null
}

interface Presence {
  availability: string
  activity: string
}

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'

const TEAMS_SCOPES = 'openid email profile User.Read Presence.Read.All Chat.ReadWrite ChatMessage.Send offline_access'

const PRESENCE_COLOURS: Record<string, string> = {
  Available: '#2e7d32',
  Busy: '#c62828',
  DoNotDisturb: '#c62828',
  Away: '#d97706',
  BeRightBack: '#d97706',
  Offline: '#9e9e9e',
  PresenceUnknown: '#9e9e9e',
}

const PRESENCE_LABELS: Record<string, string> = {
  Available: 'Available',
  Busy: 'Busy',
  DoNotDisturb: 'Do Not Disturb',
  Away: 'Away',
  BeRightBack: 'Be Right Back',
  Offline: 'Offline',
  PresenceUnknown: 'Unknown',
  InACall: 'In a Call',
  InAMeeting: 'In a Meeting',
  Presenting: 'Presenting',
  InAConferenceCall: 'In a Conference Call',
  OutOfOffice: 'Out of Office',
  UrgentInterruptionsOnly: 'Urgent Only',
}

export default function AdminTeamsTest() {
  const { session, companyUser } = useAuth()

  const [employees, setEmployees] = useState<Employee[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null)
  const [presence, setPresence] = useState<Presence | null>(null)
  const [presenceLoading, setPresenceLoading] = useState(false)
  const [presenceError, setPresenceError] = useState('')

  const [message, setMessage] = useState('')
  const [sendStatus, setSendStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [sendError, setSendError] = useState('')

  const [pollingId, setPollingId] = useState<ReturnType<typeof setInterval> | null>(null)

  const providerToken = session?.provider_token || null

  useEffect(() => {
    if (!companyUser?.company_id) return
    supabase.from('employees')
      .select('id, first_name, last_name, email, avatar_url')
      .eq('company_id', companyUser.company_id)
      .eq('is_active', true)
      .order('first_name')
      .then(({ data }) => { if (data) setEmployees(data as Employee[]) })
  }, [companyUser?.company_id])

  useEffect(() => {
    return () => { if (pollingId) clearInterval(pollingId) }
  }, [pollingId])

  async function connectTeams() {
    await supabase.auth.signInWithOAuth({
      provider: 'azure',
      options: {
        scopes: TEAMS_SCOPES,
        redirectTo: window.location.origin + '/admin/teams-test',
        queryParams: { prompt: 'consent' },
      },
    })
  }

  async function graphFetch(endpoint: string, options: RequestInit = {}) {
    if (!providerToken) throw new Error('No Teams token — connect first')
    const res = await fetch(`${GRAPH_BASE}${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${providerToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body?.error?.message || `Graph API ${res.status}`)
    }
    return res.json()
  }

  async function fetchPresence(email: string) {
    setPresenceLoading(true)
    setPresenceError('')
    setPresence(null)
    try {
      const data = await graphFetch(`/users/${encodeURIComponent(email)}/presence`)
      setPresence({ availability: data.availability, activity: data.activity })
    } catch (err: any) {
      setPresenceError(err.message)
    } finally {
      setPresenceLoading(false)
    }
  }

  function startPolling(email: string) {
    if (pollingId) clearInterval(pollingId)
    fetchPresence(email)
    const id = setInterval(() => fetchPresence(email), 15000)
    setPollingId(id)
  }

  function stopPolling() {
    if (pollingId) { clearInterval(pollingId); setPollingId(null) }
  }

  function selectEmployee(emp: Employee) {
    stopPolling()
    setSelectedEmployee(emp)
    setPresence(null)
    setPresenceError('')
    setSendStatus('idle')
    setSendError('')
    setMessage('')
    if (providerToken) startPolling(emp.email)
  }

  async function sendTeamsMessage() {
    if (!selectedEmployee || !message.trim()) return
    setSendStatus('sending')
    setSendError('')
    try {
      const meRes = await graphFetch('/me')
      const myAzureId = meRes.id

      let targetId: string
      try {
        const userRes = await graphFetch(`/users/${encodeURIComponent(selectedEmployee.email)}`)
        targetId = userRes.id
      } catch {
        throw new Error(`Could not find ${selectedEmployee.email} in Azure AD`)
      }

      const chatRes = await graphFetch('/chats', {
        method: 'POST',
        body: JSON.stringify({
          chatType: 'oneOnOne',
          members: [
            {
              '@odata.type': '#microsoft.graph.aadUserConversationMember',
              roles: ['owner'],
              'user@odata.bind': `${GRAPH_BASE}/users('${myAzureId}')`,
            },
            {
              '@odata.type': '#microsoft.graph.aadUserConversationMember',
              roles: ['owner'],
              'user@odata.bind': `${GRAPH_BASE}/users('${targetId}')`,
            },
          ],
        }),
      })

      await graphFetch(`/chats/${chatRes.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          body: { content: message.trim() },
        }),
      })

      setSendStatus('sent')
      setMessage('')
      setTimeout(() => setSendStatus('idle'), 4000)
    } catch (err: any) {
      setSendError(err.message)
      setSendStatus('error')
    }
  }

  const filteredEmployees = employees.filter(emp => {
    if (!searchTerm.trim()) return true
    const term = searchTerm.toLowerCase()
    return `${emp.first_name} ${emp.last_name}`.toLowerCase().includes(term)
      || emp.email.toLowerCase().includes(term)
  })

  const initials = (emp: Employee) =>
    `${emp.first_name[0] || ''}${emp.last_name[0] || ''}`.toUpperCase()

  return (
    <div className="admin-page" style={{ maxWidth: 900 }}>
      <h2 className="admin-page-title">Teams Integration Test</h2>
      <p className="admin-page-subtitle">Super admin only — test Microsoft Teams presence and messaging via Graph API</p>

      {/* Connection status */}
      <div className="teams-test-section">
        <h3 className="teams-test-heading">Connection</h3>
        {providerToken ? (
          <div className="teams-test-status teams-test-connected">
            <span className="teams-test-dot" style={{ background: '#2e7d32' }} />
            Connected — Azure AD token available
          </div>
        ) : (
          <div className="teams-test-status teams-test-disconnected">
            <span className="teams-test-dot" style={{ background: '#c62828' }} />
            Not connected — token missing or expired
            <button className="admin-add-btn" style={{ marginLeft: 16 }} onClick={connectTeams}>
              Connect to Teams
            </button>
          </div>
        )}
        <p className="teams-test-hint">
          Clicking "Connect to Teams" re-authenticates with additional Graph API scopes
          (Presence.Read.All, Chat.ReadWrite, ChatMessage.Send). Azure AD will prompt you to
          consent to the new permissions.
        </p>
      </div>

      {/* Person picker */}
      <div className="teams-test-section">
        <h3 className="teams-test-heading">Select Employee</h3>
        <div className="teams-test-search">
          <svg className="teams-test-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            className="teams-test-search-input"
            placeholder="Search by name or email…"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
          {searchTerm && (
            <button className="teams-test-search-clear" onClick={() => setSearchTerm('')} title="Clear search">
              &times;
            </button>
          )}
        </div>
        <div className="teams-test-employee-grid">
          {filteredEmployees.map(emp => (
            <button
              key={emp.id}
              className={`teams-test-emp-card ${selectedEmployee?.id === emp.id ? 'teams-test-emp-selected' : ''}`}
              onClick={() => selectEmployee(emp)}
            >
              {emp.avatar_url ? (
                <img className="teams-test-emp-avatar" src={emp.avatar_url} alt="" />
              ) : (
                <div className="teams-test-emp-avatar teams-test-emp-initials">{initials(emp)}</div>
              )}
              <div className="teams-test-emp-info">
                <span className="teams-test-emp-name">{emp.first_name} {emp.last_name}</span>
                <span className="teams-test-emp-email">{emp.email}</span>
              </div>
            </button>
          ))}
          {filteredEmployees.length === 0 && (
            <p className="dd2-empty">{employees.length === 0 ? 'No employees found' : 'No matches — try a different search'}</p>
          )}
        </div>
      </div>

      {/* Presence + Messaging panels */}
      {selectedEmployee && (
        <div className="teams-test-panels">
          {/* Presence panel */}
          <div className="teams-test-section teams-test-panel">
            <h3 className="teams-test-heading">
              Presence — {selectedEmployee.first_name} {selectedEmployee.last_name}
            </h3>
            {!providerToken ? (
              <p className="teams-test-hint">Connect to Teams first to view presence</p>
            ) : presenceLoading && !presence ? (
              <p className="teams-test-hint">Loading…</p>
            ) : presenceError ? (
              <div className="teams-test-error">{presenceError}</div>
            ) : presence ? (
              <div className="teams-test-presence">
                <span
                  className="teams-test-presence-dot"
                  style={{ background: PRESENCE_COLOURS[presence.availability] || '#9e9e9e' }}
                />
                <div className="teams-test-presence-info">
                  <span className="teams-test-presence-status">
                    {PRESENCE_LABELS[presence.availability] || presence.availability}
                  </span>
                  <span className="teams-test-presence-activity">
                    {PRESENCE_LABELS[presence.activity] || presence.activity}
                  </span>
                </div>
                <div className="teams-test-presence-actions">
                  {pollingId ? (
                    <button className="admin-add-btn" onClick={stopPolling}>Stop Polling</button>
                  ) : (
                    <button className="admin-add-btn" onClick={() => startPolling(selectedEmployee.email)}>
                      Start Polling (15s)
                    </button>
                  )}
                </div>
              </div>
            ) : null}
          </div>

          {/* Message panel */}
          <div className="teams-test-section teams-test-panel">
            <h3 className="teams-test-heading">
              Send Message — {selectedEmployee.first_name} {selectedEmployee.last_name}
            </h3>
            {!providerToken ? (
              <p className="teams-test-hint">Connect to Teams first to send messages</p>
            ) : (
              <>
                <textarea
                  className="teams-test-textarea"
                  rows={4}
                  placeholder="Type a message to send via Teams…"
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                />
                <div className="teams-test-send-row">
                  <button
                    className="admin-add-btn"
                    onClick={sendTeamsMessage}
                    disabled={sendStatus === 'sending' || !message.trim()}
                  >
                    {sendStatus === 'sending' ? 'Sending…' : 'Send via Teams'}
                  </button>
                  {sendStatus === 'sent' && (
                    <span className="teams-test-success">Message sent — check their Teams client</span>
                  )}
                  {sendStatus === 'error' && (
                    <span className="teams-test-error">{sendError}</span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Incremental consent guidance */}
      <div className="teams-test-section">
        <h3 className="teams-test-heading">Retrospective Consent for Existing Customers</h3>
        <div className="teams-test-guidance">
          <p>
            Existing SSO customers have only consented to <code>openid email profile</code>.
            To add Teams integration, they need to consent to the additional Graph API permissions.
            Azure AD supports <strong>incremental consent</strong> — it will prompt only for the
            new permissions they haven't yet approved.
          </p>
          <h4>Recommended flow</h4>
          <ol>
            <li>Add a <strong>"Microsoft Teams"</strong> add-on in company subscriptions/features</li>
            <li>When a company admin enables the add-on, trigger a re-authentication with the extended scopes</li>
            <li>Azure AD shows a consent screen for <em>only the new permissions</em> (Presence, Chat)</li>
            <li>Once the admin consents, the organisation's users inherit the delegated permissions</li>
            <li>Store a <code>teams_connected</code> flag on the company record</li>
          </ol>
          <p>
            The key parameter is <code>prompt: 'consent'</code> in the OAuth options, which forces
            Azure AD to re-show the consent screen even if the user is already signed in. For
            admin consent (applying to all users in the org), add
            <code>prompt: 'admin_consent'</code> instead.
          </p>
        </div>
      </div>
    </div>
  )
}
