import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { supabase, sendNotificationEmail } from '../../lib/supabase'

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

interface EmailSettings {
  leave_enabled: boolean
  expenses_enabled: boolean
  shifts_enabled: boolean
  kudos_enabled: boolean
  space_booking_enabled: boolean
  performance_reminders_enabled: boolean
  elearning_reminders_enabled: boolean
}

const EMAIL_TOGGLE_LABELS: Record<keyof EmailSettings, { label: string; description: string }> = {
  leave_enabled: { label: 'Leave Confirmations', description: 'Email when leave is approved/declined' },
  expenses_enabled: { label: 'Expense Confirmations', description: 'Email when expenses are approved/declined' },
  shifts_enabled: { label: 'Shift Notifications', description: 'Email when assigned a new shift' },
  kudos_enabled: { label: 'Kudos Received', description: 'Email when kudos is received' },
  space_booking_enabled: { label: 'Booking Confirmations', description: 'Email when desk/room booking is confirmed' },
  performance_reminders_enabled: { label: '1:1 Reminders', description: 'Email before scheduled 1:1 meetings' },
  elearning_reminders_enabled: { label: 'E-Learning Expiry Reminders', description: 'Email before course deadlines' },
}

export default function AdminTeamsTest() {
  const { session } = useAuth()
  const { selectedCompany } = useAdminCompany()

  const [activeTab, setActiveTab] = useState<'teams' | 'email'>('teams')

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
  const pollingActiveRef = useRef(false)
  const pollingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [diagResult, setDiagResult] = useState('')
  const [diagLoading, setDiagLoading] = useState(false)

  const [emailSettings, setEmailSettings] = useState<EmailSettings | null>(null)
  const [emailLoading, setEmailLoading] = useState(false)
  const [emailTestStatus, setEmailTestStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [emailTestError, setEmailTestError] = useState('')
  const [emailTestEmployee, setEmailTestEmployee] = useState<Employee | null>(null)

  const [brevoDiag, setBrevoDiag] = useState<Record<string, any> | null>(null)
  const [brevoDiagLoading, setBrevoDiagLoading] = useState(false)
  const [brevoDiagError, setBrevoDiagError] = useState('')

  const providerToken = session?.provider_token || null
  const companyDomain = selectedCompany?.domain || ''

  useEffect(() => {
    const cid = selectedCompany?.id
    if (!cid) return
    supabase.from('employees')
      .select('id, first_name, last_name, email, avatar_url')
      .eq('company_id', cid)
      .eq('is_active', true)
      .order('first_name')
      .then(({ data }) => { if (data) setEmployees(data as Employee[]) })
  }, [selectedCompany?.id])

  useEffect(() => {
    const cid = selectedCompany?.id
    if (!cid) return
    setEmailLoading(true)
    supabase.from('email_notification_settings')
      .select('*')
      .eq('company_id', cid)
      .single()
      .then(({ data }) => {
        if (data) setEmailSettings(data as unknown as EmailSettings)
        else setEmailSettings(null)
        setEmailLoading(false)
      })
  }, [selectedCompany?.id])

  async function sendTestEmail() {
    if (!emailTestEmployee || !selectedCompany?.id) return
    setEmailTestStatus('sending')
    setEmailTestError('')
    try {
      const notifPayload = {
        employee_id: emailTestEmployee.id,
        title: 'InflowHR Email Test',
        message: `This is a test email sent from the Integration Tests page to verify Brevo email delivery is working for ${selectedCompany.name || 'your company'}.`,
        type: 'info',
        link: '/admin/teams-test',
        is_read: false,
        company_id: selectedCompany.id,
        send_email: true,
      }
      const { data: notifRow, error } = await supabase
        .from('notifications')
        .insert(notifPayload)
        .select('id')
        .single()
      if (error) throw new Error(error.message)
      await sendNotificationEmail({ ...notifPayload, id: notifRow?.id, email_sent: false })
      setEmailTestStatus('sent')
      setTimeout(() => setEmailTestStatus('idle'), 5000)
    } catch (err: any) {
      setEmailTestError(err.message)
      setEmailTestStatus('error')
    }
  }

  async function runBrevoDiagnostics() {
    setBrevoDiagLoading(true)
    setBrevoDiagError('')
    setBrevoDiag(null)
    try {
      const { data: { session: currentSession } } = await supabase.auth.getSession()
      const token = currentSession?.access_token
      if (!token) throw new Error('No session — please sign in again')
      const res = await fetch(`${SUPABASE_URL}/functions/v1/brevo-diagnostics`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setBrevoDiag(data)
    } catch (err: any) {
      setBrevoDiagError(err.message)
    } finally {
      setBrevoDiagLoading(false)
    }
  }

  useEffect(() => {
    return () => { pollingActiveRef.current = false; if (pollingTimerRef.current) clearTimeout(pollingTimerRef.current) }
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

  async function resolveUserId(email: string): Promise<string> {
    const user = await graphFetch(`/users/${encodeURIComponent(email)}`)
    return user.id
  }

  async function fetchPresenceBatch(userIds: string[]): Promise<Record<string, Presence>> {
    const data = await graphFetch('/communications/getPresencesByUserId', {
      method: 'POST',
      body: JSON.stringify({ ids: userIds }),
    })
    const result: Record<string, Presence> = {}
    for (const p of data.value || []) {
      result[p.id] = { availability: p.availability, activity: p.activity }
    }
    return result
  }

  async function runDiagnostics() {
    setDiagLoading(true)
    setDiagResult('')
    const results: string[] = []
    try {
      const me = await graphFetch('/me')
      results.push(`/me: ${me.displayName} (${me.userPrincipalName})`)

      try {
        const myPresence = await graphFetch('/me/presence')
        results.push(`/me/presence (individual): ${myPresence.availability}`)
      } catch (err: any) {
        results.push(`/me/presence (individual): FAILED — ${err.message}`)
      }

      try {
        const batch = await fetchPresenceBatch([me.id])
        const bp = batch[me.id]
        results.push(`/communications/getPresencesByUserId (batch): ${bp?.availability || 'no result'}`)
      } catch (err: any) {
        results.push(`/communications/getPresencesByUserId (batch): FAILED — ${err.message}`)
      }

      if (selectedEmployee) {
        try {
          const targetId = await resolveUserId(selectedEmployee.email)
          results.push(`/users/${selectedEmployee.email}: found (id: ${targetId})`)
          try {
            const batch = await fetchPresenceBatch([targetId])
            const bp = batch[targetId]
            results.push(`batch presence for ${selectedEmployee.email}: ${bp?.availability || 'no result'}`)
          } catch (err: any) {
            results.push(`batch presence for ${selectedEmployee.email}: FAILED — ${err.message}`)
          }
        } catch (err: any) {
          results.push(`/users/${selectedEmployee.email}: FAILED — ${err.message}`)
        }
      }
    } catch (err: any) {
      results.push(`/me: FAILED — ${err.message}`)
    }
    setDiagResult(results.join('\n'))
    setDiagLoading(false)
  }

  async function fetchPresenceOnce(email: string): Promise<boolean> {
    setPresenceLoading(true)
    setPresenceError('')
    try {
      const userId = await resolveUserId(email)
      const batch = await fetchPresenceBatch([userId])
      const p = batch[userId]
      if (p) {
        setPresence(p)
      } else {
        setPresence({ availability: 'PresenceUnknown', activity: 'PresenceUnknown' })
      }
      setNeedsConsent(false)
      return true
    } catch (err: any) {
      setPresenceError(err.message)
      return false
    } finally {
      setPresenceLoading(false)
    }
  }

  function stopPolling() {
    pollingActiveRef.current = false
    if (pollingTimerRef.current) { clearTimeout(pollingTimerRef.current); pollingTimerRef.current = null }
    setIsPolling(false)
  }

  function startPolling(email: string) {
    stopPolling()
    pollingActiveRef.current = true
    setIsPolling(true)
    setPresence(null)

    async function tick() {
      if (!pollingActiveRef.current) return
      const ok = await fetchPresenceOnce(email)
      if (!ok || !pollingActiveRef.current) {
        pollingActiveRef.current = false
        setIsPolling(false)
        return
      }
      pollingTimerRef.current = setTimeout(tick, 15000)
    }
    tick()
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
      <h2 className="admin-page-title">Integration Tests</h2>
      <p className="admin-page-subtitle">Super admin only — test and diagnose third-party integrations</p>

      <div className="admin-tabs" style={{ marginBottom: 24 }}>
        <button className={`admin-tab ${activeTab === 'teams' ? 'active' : ''}`} onClick={() => setActiveTab('teams')}>Microsoft Teams</button>
        <button className={`admin-tab ${activeTab === 'email' ? 'active' : ''}`} onClick={() => setActiveTab('email')}>Email Notifications</button>
      </div>

      {activeTab === 'email' && (
        <>
          {/* Email setup guide */}
          <div className="teams-test-section">
            <h3 className="teams-test-heading">Brevo Email Setup</h3>
            <div className="teams-test-guidance">
              <p>Email notifications are sent via <strong>Brevo</strong> (formerly Sendinblue) through the <code>send-notification-email</code> Supabase Edge Function.</p>

              <h4 style={{ margin: '16px 0 8px' }}>Required Environment Variables</h4>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border-color, #e0e0e0)' }}>
                    <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600 }}>Variable</th>
                    <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600 }}>Description</th>
                    <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600 }}>Where to set</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ borderBottom: '1px solid var(--border-color, #e0e0e0)' }}>
                    <td style={{ padding: '8px 12px' }}><code>BREVO_API_KEY</code></td>
                    <td style={{ padding: '8px 12px' }}>Brevo SMTP API key from your Brevo dashboard</td>
                    <td style={{ padding: '8px 12px' }}>Supabase &rarr; Edge Functions &rarr; Secrets</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid var(--border-color, #e0e0e0)' }}>
                    <td style={{ padding: '8px 12px' }}><code>TITAN_EMAIL</code></td>
                    <td style={{ padding: '8px 12px' }}>Sender email address (defaults to notifications@inflowhr.com)</td>
                    <td style={{ padding: '8px 12px' }}>Supabase &rarr; Edge Functions &rarr; Secrets</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid var(--border-color, #e0e0e0)' }}>
                    <td style={{ padding: '8px 12px' }}><code>APP_URL</code></td>
                    <td style={{ padding: '8px 12px' }}>App URL for email links (defaults to https://app.inflowhr.com)</td>
                    <td style={{ padding: '8px 12px' }}>Supabase &rarr; Edge Functions &rarr; Secrets</td>
                  </tr>
                </tbody>
              </table>

              <h4 style={{ margin: '16px 0 8px' }}>How it works</h4>
              <ol style={{ paddingLeft: 20, fontSize: 13, lineHeight: 1.8, margin: '0 0 12px' }}>
                <li>Company admin enables email toggles on the <strong>Admin &rarr; Notifications &rarr; Email</strong> tab</li>
                <li>When a relevant action occurs (e.g. leave approved), the app checks the company's <code>email_notification_settings</code></li>
                <li>If the toggle is on, a notification is inserted with <code>send_email: true</code></li>
                <li>The <code>send-notification-email</code> Edge Function is called, which sends via Brevo's SMTP API</li>
                <li>The notification record is updated with <code>email_sent: true</code> and a timestamp</li>
              </ol>

              <h4 style={{ margin: '16px 0 8px' }}>Brevo setup checklist</h4>
              <ul style={{ paddingLeft: 20, fontSize: 13, lineHeight: 1.8, margin: 0 }}>
                <li>Create a Brevo account and generate an SMTP API key</li>
                <li>Verify the sender email domain in Brevo (DKIM + SPF records)</li>
                <li>Add the API key to Supabase Edge Function secrets as <code>BREVO_API_KEY</code></li>
                <li>Deploy the <code>send-notification-email</code> Edge Function</li>
                <li>Enable the <code>email_notifications</code> feature for the company in Subscriptions</li>
              </ul>
            </div>
          </div>

          {/* Current company email settings */}
          <div className="teams-test-section">
            <h3 className="teams-test-heading">Company Email Settings — {selectedCompany?.name || 'Select a company'}</h3>
            {emailLoading ? (
              <div className="admin-loading">Loading...</div>
            ) : !emailSettings ? (
              <div className="teams-test-guidance">
                <p style={{ color: '#c62828', fontWeight: 600 }}>No email notification settings found for this company. The admin needs to visit the Email Notifications tab first to create the settings row.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(Object.keys(EMAIL_TOGGLE_LABELS) as (keyof EmailSettings)[]).map(key => {
                  const enabled = emailSettings[key] === true
                  return (
                    <div key={key} style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 16px',
                      background: enabled ? 'var(--card-bg-active, #f0fdf4)' : 'var(--card-bg, #fff)',
                      border: `1px solid ${enabled ? '#43a047' : 'var(--border-color, #e0e0e0)'}`,
                      borderRadius: 8, fontSize: 13,
                    }}>
                      <span style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: enabled ? '#43a047' : '#ccc', flexShrink: 0,
                      }} />
                      <span style={{ fontWeight: 600, minWidth: 180 }}>{EMAIL_TOGGLE_LABELS[key].label}</span>
                      <span style={{ color: 'var(--text-muted, #888)', flex: 1 }}>{EMAIL_TOGGLE_LABELS[key].description}</span>
                      <span style={{
                        fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
                        background: enabled ? '#e8f5e9' : '#f5f5f5',
                        color: enabled ? '#2e7d32' : '#999',
                      }}>{enabled ? 'On' : 'Off'}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Test email send */}
          <div className="teams-test-section">
            <h3 className="teams-test-heading">Send Test Email</h3>
            <div className="teams-test-guidance">
              <p style={{ margin: '0 0 12px' }}>Send a test notification email to an employee to verify the Brevo pipeline is working end-to-end. This bypasses the feature toggle check.</p>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <select
                  style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border-color, #e0e0e0)', fontSize: 13, minWidth: 240 }}
                  value={emailTestEmployee?.id || ''}
                  onChange={e => {
                    const emp = employees.find(em => em.id === e.target.value)
                    setEmailTestEmployee(emp || null)
                  }}
                >
                  <option value="">Select employee...</option>
                  {employees.map(emp => (
                    <option key={emp.id} value={emp.id}>{emp.first_name} {emp.last_name} ({emp.email})</option>
                  ))}
                </select>
                <button
                  className="admin-add-btn"
                  onClick={sendTestEmail}
                  disabled={!emailTestEmployee || emailTestStatus === 'sending'}
                >
                  {emailTestStatus === 'sending' ? 'Sending...' : 'Send Test Email'}
                </button>
                {emailTestStatus === 'sent' && (
                  <span style={{ color: '#2e7d32', fontWeight: 600, fontSize: 13 }}>Test email sent — check inbox</span>
                )}
                {emailTestStatus === 'error' && (
                  <span className="teams-test-error">{emailTestError}</span>
                )}
              </div>
            </div>
          </div>

          {/* Brevo Connection & Diagnostics */}
          <div className="teams-test-section">
            <h3 className="teams-test-heading">Brevo Connection & Diagnostics</h3>
            <div className="teams-test-guidance">
              <p style={{ margin: '0 0 12px' }}>Test the live Brevo SMTP API connection, verify sender/domain authentication, and review delivery statistics.</p>
              <button className="admin-add-btn" onClick={runBrevoDiagnostics} disabled={brevoDiagLoading}>
                {brevoDiagLoading ? 'Running Diagnostics…' : 'Run Brevo Diagnostics'}
              </button>
              {brevoDiagError && (
                <div className="teams-test-error" style={{ marginTop: 12 }}>{brevoDiagError}</div>
              )}
            </div>

            {brevoDiag && (
              <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* API Key Status */}
                <div style={{ padding: 16, borderRadius: 8, border: '1px solid var(--border-color, #e0e0e0)', background: 'var(--card-bg, #fff)' }}>
                  <h4 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>API Key</h4>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                    <span style={{
                      width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                      background: brevoDiag.api_key_set ? '#43a047' : '#c62828',
                    }} />
                    <span style={{ fontWeight: 600 }}>{brevoDiag.api_key_set ? 'Set' : 'Not Set'}</span>
                    {brevoDiag.api_key_prefix && (
                      <code style={{ marginLeft: 8, fontSize: 12, color: 'var(--text-muted, #888)' }}>{brevoDiag.api_key_prefix}</code>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted, #888)', marginTop: 4 }}>
                    Configured sender: <code>{brevoDiag.configured_sender}</code>
                  </div>
                </div>

                {/* Account */}
                {brevoDiag.account && (
                  <div style={{ padding: 16, borderRadius: 8, border: `1px solid ${brevoDiag.account.status === 'ok' ? '#43a047' : '#c62828'}`, background: 'var(--card-bg, #fff)' }}>
                    <h4 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: brevoDiag.account.status === 'ok' ? '#43a047' : '#c62828',
                      }} />
                      Account
                    </h4>
                    {brevoDiag.account.status === 'ok' ? (
                      <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div><strong>Company:</strong> {brevoDiag.account.company_name || '—'}</div>
                        <div><strong>Email:</strong> {brevoDiag.account.email || '—'}</div>
                        <div><strong>Plan:</strong> {brevoDiag.account.plan || '—'}</div>
                        <div><strong>Credits:</strong> {brevoDiag.account.credits_remaining ?? '—'} ({brevoDiag.account.credits_type || '—'})</div>
                      </div>
                    ) : (
                      <div className="teams-test-error">{brevoDiag.account.message || `Error ${brevoDiag.account.code}`}</div>
                    )}
                  </div>
                )}

                {/* Sender Verification */}
                {brevoDiag.sender && (
                  <div style={{ padding: 16, borderRadius: 8, border: `1px solid ${brevoDiag.sender.status === 'ok' ? '#43a047' : brevoDiag.sender.status === 'warning' ? '#d97706' : '#c62828'}`, background: 'var(--card-bg, #fff)' }}>
                    <h4 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: brevoDiag.sender.status === 'ok' ? '#43a047' : brevoDiag.sender.status === 'warning' ? '#d97706' : '#c62828',
                      }} />
                      Sender Verification
                    </h4>
                    {brevoDiag.sender.status === 'error' ? (
                      <div className="teams-test-error">{brevoDiag.sender.message || `Error ${brevoDiag.sender.code}`}</div>
                    ) : (
                      <div style={{ fontSize: 13 }}>
                        <div style={{ marginBottom: 8 }}>
                          <strong>{brevoDiag.sender.configured_email}</strong>
                          {brevoDiag.sender.found_in_brevo ? (
                            <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: brevoDiag.sender.active ? '#e8f5e9' : '#fff3e0', color: brevoDiag.sender.active ? '#2e7d32' : '#e65100' }}>
                              {brevoDiag.sender.active ? 'Active' : 'Inactive'}
                            </span>
                          ) : (
                            <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: '#fce4ec', color: '#c62828' }}>
                              Not Found in Brevo
                            </span>
                          )}
                        </div>
                        {brevoDiag.sender.all_senders?.length > 0 && (
                          <div style={{ marginTop: 8 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted, #888)', marginBottom: 4 }}>All registered senders:</div>
                            {brevoDiag.sender.all_senders.map((s: { email: string; active: boolean; name: string }, i: number) => (
                              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '3px 0' }}>
                                <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.active ? '#43a047' : '#ccc' }} />
                                <span>{s.name} &lt;{s.email}&gt;</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Domain Authentication */}
                {brevoDiag.domain && (
                  <div style={{ padding: 16, borderRadius: 8, border: `1px solid ${brevoDiag.domain.status === 'ok' ? '#43a047' : brevoDiag.domain.status === 'warning' ? '#d97706' : '#c62828'}`, background: 'var(--card-bg, #fff)' }}>
                    <h4 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: brevoDiag.domain.status === 'ok' ? '#43a047' : brevoDiag.domain.status === 'warning' ? '#d97706' : '#c62828',
                      }} />
                      Domain Authentication (DKIM/SPF)
                    </h4>
                    {brevoDiag.domain.status === 'error' ? (
                      <div className="teams-test-error">{brevoDiag.domain.message || `Error ${brevoDiag.domain.code}`}</div>
                    ) : (
                      <div style={{ fontSize: 13 }}>
                        <div>
                          <strong>{brevoDiag.domain.sender_domain}</strong>
                          <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: brevoDiag.domain.authenticated ? '#e8f5e9' : '#fce4ec', color: brevoDiag.domain.authenticated ? '#2e7d32' : '#c62828' }}>
                            {brevoDiag.domain.authenticated ? 'Authenticated' : 'Not Authenticated'}
                          </span>
                          {!brevoDiag.domain.found_in_brevo && (
                            <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: '#fce4ec', color: '#c62828' }}>
                              Domain not registered
                            </span>
                          )}
                        </div>
                        {!brevoDiag.domain.authenticated && brevoDiag.domain.found_in_brevo && (
                          <p style={{ margin: '8px 0 0', fontSize: 12, color: '#c62828' }}>
                            Add DKIM and SPF DNS records for this domain in your DNS provider. Check the Brevo dashboard for the required records.
                          </p>
                        )}
                        {brevoDiag.domain.all_domains?.length > 0 && (
                          <div style={{ marginTop: 8 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted, #888)', marginBottom: 4 }}>All registered domains:</div>
                            {brevoDiag.domain.all_domains.map((d: { domain: string; authenticated: boolean }, i: number) => (
                              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '3px 0' }}>
                                <span style={{ width: 6, height: 6, borderRadius: '50%', background: d.authenticated ? '#43a047' : '#ccc' }} />
                                <span>{d.domain}</span>
                                <span style={{ fontSize: 11, color: d.authenticated ? '#2e7d32' : '#999' }}>{d.authenticated ? 'authenticated' : 'pending'}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* SMTP Delivery Stats */}
                {brevoDiag.smtp_stats && (
                  <div style={{ padding: 16, borderRadius: 8, border: `1px solid ${brevoDiag.smtp_stats.status === 'ok' ? '#43a047' : '#c62828'}`, background: 'var(--card-bg, #fff)' }}>
                    <h4 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: brevoDiag.smtp_stats.status === 'ok' ? '#43a047' : '#c62828',
                      }} />
                      SMTP Delivery Statistics
                    </h4>
                    {brevoDiag.smtp_stats.status === 'ok' ? (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
                        {[
                          { label: 'Requests', value: brevoDiag.smtp_stats.requests, color: '#1565c0' },
                          { label: 'Delivered', value: brevoDiag.smtp_stats.delivered, color: '#2e7d32' },
                          { label: 'Opens', value: brevoDiag.smtp_stats.opens, color: '#6a1b9a' },
                          { label: 'Clicks', value: brevoDiag.smtp_stats.clicks, color: '#00838f' },
                          { label: 'Bounces', value: brevoDiag.smtp_stats.bounces, color: brevoDiag.smtp_stats.bounces > 0 ? '#c62828' : '#999' },
                          { label: 'Blocked', value: brevoDiag.smtp_stats.blocked, color: brevoDiag.smtp_stats.blocked > 0 ? '#c62828' : '#999' },
                          { label: 'Spam Reports', value: brevoDiag.smtp_stats.spam_reports, color: brevoDiag.smtp_stats.spam_reports > 0 ? '#c62828' : '#999' },
                          { label: 'Invalid', value: brevoDiag.smtp_stats.invalid, color: brevoDiag.smtp_stats.invalid > 0 ? '#c62828' : '#999' },
                        ].map(stat => (
                          <div key={stat.label} style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--surface, #f5f5f5)', textAlign: 'center' }}>
                            <div style={{ fontSize: 20, fontWeight: 700, color: stat.color }}>{stat.value?.toLocaleString() ?? 0}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted, #888)', marginTop: 2 }}>{stat.label}</div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="teams-test-error">{brevoDiag.smtp_stats.message || `Error ${brevoDiag.smtp_stats.code}`}</div>
                    )}
                  </div>
                )}

                {/* Recent Events */}
                {brevoDiag.recent_events && (
                  <div style={{ padding: 16, borderRadius: 8, border: '1px solid var(--border-color, #e0e0e0)', background: 'var(--card-bg, #fff)' }}>
                    <h4 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Recent Email Events</h4>
                    {brevoDiag.recent_events.status === 'ok' ? (
                      brevoDiag.recent_events.events?.length > 0 ? (
                        <div style={{ overflowX: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                            <thead>
                              <tr style={{ borderBottom: '2px solid var(--border-color, #e0e0e0)' }}>
                                <th style={{ textAlign: 'left', padding: '6px 10px', fontWeight: 600 }}>Date</th>
                                <th style={{ textAlign: 'left', padding: '6px 10px', fontWeight: 600 }}>Event</th>
                                <th style={{ textAlign: 'left', padding: '6px 10px', fontWeight: 600 }}>Recipient</th>
                                <th style={{ textAlign: 'left', padding: '6px 10px', fontWeight: 600 }}>Subject</th>
                              </tr>
                            </thead>
                            <tbody>
                              {brevoDiag.recent_events.events.map((ev: { date: string; event: string; email: string; subject: string }, i: number) => {
                                const eventColour: Record<string, string> = {
                                  delivered: '#2e7d32', opened: '#6a1b9a', clicked: '#00838f',
                                  bounced: '#c62828', hardBounce: '#c62828', softBounce: '#d97706',
                                  blocked: '#c62828', spam: '#c62828', request: '#1565c0',
                                  deferred: '#d97706', unsubscribed: '#999',
                                }
                                return (
                                  <tr key={i} style={{ borderBottom: '1px solid var(--border-color, #e0e0e0)' }}>
                                    <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>{new Date(ev.date).toLocaleString('en-GB')}</td>
                                    <td style={{ padding: '6px 10px' }}>
                                      <span style={{
                                        fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
                                        background: (eventColour[ev.event] || '#999') + '18',
                                        color: eventColour[ev.event] || '#999',
                                      }}>{ev.event}</span>
                                    </td>
                                    <td style={{ padding: '6px 10px' }}>{ev.email}</td>
                                    <td style={{ padding: '6px 10px', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.subject}</td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p style={{ fontSize: 13, color: 'var(--text-muted, #888)' }}>No recent email events found</p>
                      )
                    ) : (
                      <div className="teams-test-error">{brevoDiag.recent_events.message || `Error ${brevoDiag.recent_events.code}`}</div>
                    )}
                  </div>
                )}

                <div style={{ fontSize: 11, color: 'var(--text-muted, #888)', textAlign: 'right' }}>
                  Diagnostics run at {new Date(brevoDiag.timestamp).toLocaleString('en-GB')}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {activeTab === 'teams' && <>
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

      {/* Token debug — decode the provider token to show actual scopes */}
      {providerToken && (
        <div className="teams-test-section">
          <h3 className="teams-test-heading">Token Debug</h3>
          <div className="teams-test-guidance" style={{ fontSize: 13 }}>
            {(() => {
              try {
                const parts = providerToken.split('.')
                if (parts.length < 2) return <p>Token is not a JWT</p>
                const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
                const scopes = payload.scp || payload.scope || '(none)'
                const audience = payload.aud || '(none)'
                const expires = payload.exp ? new Date(payload.exp * 1000).toLocaleString('en-GB') : '(unknown)'
                return (
                  <>
                    <p><strong>Scopes in token:</strong> <code>{scopes}</code></p>
                    <p><strong>Audience:</strong> <code>{audience}</code></p>
                    <p><strong>Expires:</strong> {expires}</p>
                    <p><strong>Expected scopes:</strong> <code>User.Read User.Read.All Presence.Read.All Chat.ReadWrite ChatMessage.Send</code></p>
                    {typeof scopes === 'string' && !scopes.includes('Presence.Read.All') && (
                      <p style={{ color: '#c62828', fontWeight: 600 }}>
                        Presence.Read.All is NOT in this token — re-authorise to request it.
                      </p>
                    )}
                    {typeof scopes === 'string' && audience !== 'https://graph.microsoft.com' && audience !== '00000003-0000-0000-c000-000000000000' && (
                      <p style={{ color: '#c62828', fontWeight: 600 }}>
                        Token audience is not Graph API — this token may be for a different API.
                      </p>
                    )}
                  </>
                )
              } catch {
                return <p>Could not decode token</p>
              }
            })()}
          </div>
        </div>
      )}

      {/* Diagnostics */}
      {providerToken && (
        <div className="teams-test-section">
          <h3 className="teams-test-heading">API Diagnostics</h3>
          <div className="teams-test-guidance">
            <p style={{ margin: '0 0 8px' }}>Tests each Graph API endpoint individually to isolate which call is failing.</p>
            <button className="admin-add-btn" onClick={runDiagnostics} disabled={diagLoading}>
              {diagLoading ? 'Running…' : 'Run Diagnostics'}
            </button>
            {diagResult && (
              <pre style={{ margin: '12px 0 0', padding: 12, background: 'var(--surface, #f5f5f5)', borderRadius: 6, fontSize: 12, whiteSpace: 'pre-wrap', overflowWrap: 'break-word' }}>
                {diagResult}
              </pre>
            )}
          </div>
        </div>
      )}

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
      </>}
    </div>
  )
}
