import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useAdminCompany } from '../../context/AdminCompanyContext'
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

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'

const TEAMS_SCOPES = 'openid email profile User.Read User.Read.All Presence.Read.All Chat.ReadWrite ChatMessage.Send offline_access'

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

function isConsentError(err: any): boolean {
  const msg = (err?.message || '').toLowerCase()
  return msg.includes('authorization_requestdenied')
    || msg.includes('insufficient privileges')
    || msg.includes('access denied')
    || msg.includes('forbidden')
    || msg.includes('interaction_required')
    || msg.includes('consent')
    || msg.includes('401')
    || msg.includes('403')
}

export default function AdminTeamsTest() {
  const { session, companyUser } = useAuth()
  const { selectedCompany } = useAdminCompany()

  const [employees, setEmployees] = useState<Employee[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null)
  const [presence, setPresence] = useState<Presence | null>(null)
  const [presenceLoading, setPresenceLoading] = useState(false)
  const [presenceError, setPresenceError] = useState('')
  const [needsConsent, setNeedsConsent] = useState(false)
  const [lastGraphError, setLastGraphError] = useState('')

  const [message, setMessage] = useState('')
  const [sendStatus, setSendStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [sendError, setSendError] = useState('')

  const [isPolling, setIsPolling] = useState(false)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const providerToken = session?.provider_token || null
  const companyDomain = selectedCompany?.domain || ''

  useEffect(() => {
    const cid = selectedCompany?.id || companyUser?.company_id
    if (!cid) return
    supabase.from('employees')
      .select('id, first_name, last_name, email, avatar_url')
      .eq('company_id', cid)
      .eq('is_active', true)
      .order('first_name')
      .then(({ data }) => { if (data) setEmployees(data as Employee[]) })
  }, [selectedCompany?.id, companyUser?.company_id])

  useEffect(() => {
    return () => { if (pollingRef.current) clearInterval(pollingRef.current) }
  }, [])

  async function authoriseTeamsPermissions() {
    await supabase.auth.signOut()
    await supabase.auth.signInWithOAuth({
      provider: 'azure',
      options: {
        scopes: TEAMS_SCOPES,
        redirectTo: window.location.origin + '/admin/teams-test',
        queryParams: { prompt: 'consent' },
      },
    })
  }

  async function graphFetch(endpoint: string, options: { method?: string; body?: string } = {}) {
    if (!providerToken) throw new Error('No Teams token — authorise permissions first')
    const { data: { session: currentSession } } = await supabase.auth.getSession()
    const jwt = currentSession?.access_token
    if (!jwt) throw new Error('No session — please sign in again')

    const res = await fetch(`${SUPABASE_URL}/functions/v1/teams-proxy`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        endpoint,
        method: options.method || 'GET',
        body: options.body ? JSON.parse(options.body) : undefined,
        provider_token: providerToken,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const errMsg = data?.error || `Graph API ${res.status}`
      if (res.status === 401 || res.status === 403 || isConsentError({ message: errMsg })) {
        setNeedsConsent(true)
        setLastGraphError(`${res.status}: ${errMsg}`)
      }
      throw new Error(errMsg)
    }
    return data
  }

  async function fetchPresence(email: string) {
    setPresenceLoading(true)
    setPresenceError('')
    setPresence(null)
    try {
      const data = await graphFetch(`/users/${encodeURIComponent(email)}/presence`)
      setPresence({ availability: data.availability, activity: data.activity })
      setNeedsConsent(false)
    } catch (err: any) {
      setPresenceError(err.message)
      stopPolling()
    } finally {
      setPresenceLoading(false)
    }
  }

  const stopPolling = useCallback(() => {
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null }
    setIsPolling(false)
  }, [])

  function startPolling(email: string) {
    stopPolling()
    fetchPresence(email)
    pollingRef.current = setInterval(() => fetchPresence(email), 15000)
    setIsPolling(true)
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
      } catch (lookupErr: any) {
        throw new Error(`Could not find ${selectedEmployee.email} in Azure AD: ${lookupErr.message}`)
      }

      const isSelfChat = myAzureId === targetId
      let chatId: string

      if (isSelfChat) {
        const existing = await graphFetch(`/users/${myAzureId}/chats?$filter=chatType eq 'oneOnOne'&$expand=members&$top=50`)
        const found = existing.value?.find((c: any) =>
          c.members?.length === 1 ||
          (c.members?.length >= 1 && c.members.every((m: any) => m.userId === myAzureId))
        )
        if (!found) throw new Error('No self-chat found — open a chat with yourself in Teams first, then retry here')
        chatId = found.id
      } else {
        try {
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
          chatId = chatRes.id
        } catch (chatErr: any) {
          if (chatErr.message?.includes('Duplicate') || chatErr.message?.includes('duplicate')) {
            const existing = await graphFetch(`/users/${myAzureId}/chats?$filter=chatType eq 'oneOnOne'&$expand=members&$top=50`)
            const found = existing.value?.find((c: any) =>
              c.members?.some((m: any) => m.userId === targetId && m.userId !== myAzureId)
            )
            if (!found) throw new Error('Could not find existing chat with this user')
            chatId = found.id
          } else {
            throw chatErr
          }
        }
      }

      await graphFetch(`/chats/${chatId}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          body: { content: message.trim() },
        }),
      })

      setSendStatus('sent')
      setMessage('')
      setNeedsConsent(false)
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

      {/* Authorisation status */}
      <div className="teams-test-section">
        <h3 className="teams-test-heading">Authorisation</h3>
        <div className="teams-test-auth-card">
          <div className="teams-test-auth-info">
            {providerToken && !needsConsent ? (
              <div className="teams-test-status teams-test-connected">
                <span className="teams-test-dot" style={{ background: '#2e7d32' }} />
                Azure AD token available
                {companyDomain && <span className="teams-test-domain">{companyDomain}</span>}
              </div>
            ) : (
              <div className="teams-test-status teams-test-disconnected">
                <span className="teams-test-dot" style={{ background: '#c62828' }} />
                {needsConsent
                  ? 'Insufficient permissions — consent required for Chat and Presence scopes'
                  : 'Not connected — Teams permissions not yet authorised'}
              </div>
            )}
            <p className="teams-test-hint" style={{ margin: '8px 0 0' }}>
              {providerToken && !needsConsent
                ? 'If presence or messaging fails, re-authorise to request the additional Teams scopes.'
                : 'Click the button below to authenticate with Graph API scopes (User.Read.All, Presence.Read.All, Chat.ReadWrite, ChatMessage.Send). Azure AD will prompt you to consent to the new permissions.'}
            </p>
          </div>
          <button className="teams-test-auth-btn" onClick={authoriseTeamsPermissions}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            Authorise Teams Permissions
            {companyDomain && <span className="teams-test-auth-domain">for {companyDomain}</span>}
          </button>
        </div>
      </div>

      {/* Consent required banner — shown inline when a Graph call fails */}
      {needsConsent && providerToken && (
        <div className="teams-test-section">
          <div className="teams-test-consent-banner">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <div>
              <strong>Permission denied by Microsoft Graph</strong>
              {lastGraphError && (
                <p style={{ margin: '4px 0 0', fontFamily: 'monospace', fontSize: 12 }}>
                  {lastGraphError}
                </p>
              )}
              <p style={{ margin: '4px 0 0' }}>
                Ensure all permissions have <strong>admin consent granted</strong> in Azure Portal
                (green checkmarks). Then click the Authorise button above to get a fresh token.
              </p>
            </div>
          </div>
        </div>
      )}

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
            {!providerToken || needsConsent ? (
              <p className="teams-test-hint">Authorise Teams permissions above to view presence</p>
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
                  {isPolling ? (
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
            {!providerToken || needsConsent ? (
              <p className="teams-test-hint">Authorise Teams permissions above to send messages</p>
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
