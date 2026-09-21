import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { formatDateTime } from '../../lib/formatters'

interface TeamsConfig {
  id: string
  company_id: string
  is_enabled: boolean
  consent_granted: boolean
  consent_granted_by: string | null
  consent_granted_at: string | null
}

const TEAMS_SCOPES = 'openid email profile User.Read User.Read.All Presence.Read.All Chat.ReadWrite ChatMessage.Send offline_access'

const PERMISSION_EXPLANATIONS = [
  {
    scope: 'User.Read.All',
    label: 'Read all users’ profiles',
    why: 'Look up colleagues in your Microsoft 365 directory so presence status can be matched to employees.',
  },
  {
    scope: 'Presence.Read.All',
    label: 'Read all users’ presence',
    why: 'Show real-time availability (Available, Busy, Away, etc.) on employee profiles in the HR Directory.',
  },
  {
    scope: 'Chat.ReadWrite',
    label: 'Read and create chats',
    why: 'Find or create a one-to-one chat with a manager to deliver leave request notifications.',
  },
  {
    scope: 'ChatMessage.Send',
    label: 'Send chat messages',
    why: 'Send the actual notification message to the manager when an employee submits a leave request.',
  },
]

export default function AdminIntegrations() {
  const { companyUser, session } = useAuth()
  const { showSuccess, showError } = useToast()
  const [teamsConfig, setTeamsConfig] = useState<TeamsConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [consentLoading, setConsentLoading] = useState(false)
  const [consentorName, setConsentorName] = useState<string | null>(null)

  const companyId = companyUser?.company_id

  async function loadConfig() {
    if (!companyId) return
    setLoading(true)

    const { data } = await supabase
      .from('company_teams_config')
      .select('*')
      .eq('company_id', companyId)
      .maybeSingle()

    if (data) {
      setTeamsConfig(data as TeamsConfig)
      if (data.consent_granted_by) {
        const { data: profile } = await supabase
          .from('onboarding')
          .select('display_name')
          .eq('user_email', (await supabase.auth.getUser()).data.user?.email || '')
          .eq('company_id', companyId)
          .maybeSingle()
        setConsentorName(profile?.display_name || 'An administrator')
      }
    } else {
      setTeamsConfig(null)
    }
    setLoading(false)
  }

  useEffect(() => { loadConfig() }, [companyId])

  async function toggleEnabled() {
    if (!companyId) return
    setSaving(true)

    const newEnabled = !teamsConfig?.is_enabled

    if (teamsConfig) {
      const { error } = await supabase
        .from('company_teams_config')
        .update({ is_enabled: newEnabled, updated_at: new Date().toISOString() })
        .eq('company_id', companyId)
      if (error) {
        showError('Failed to update: ' + error.message)
        setSaving(false)
        return
      }
    } else {
      const { error } = await supabase
        .from('company_teams_config')
        .insert({ company_id: companyId, is_enabled: newEnabled })
      if (error) {
        showError('Failed to save: ' + error.message)
        setSaving(false)
        return
      }
    }

    showSuccess(`Teams integration ${newEnabled ? 'enabled' : 'disabled'}`)
    await loadConfig()
    setSaving(false)
  }

  async function authoriseConsent() {
    if (!companyId || !session) return
    setConsentLoading(true)

    await supabase.auth.signOut()

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'azure',
      options: {
        scopes: TEAMS_SCOPES,
        queryParams: { prompt: 'consent' },
        redirectTo: window.location.origin + '/admin/integrations',
      },
    })

    if (error) {
      showError('Consent flow failed: ' + error.message)
      setConsentLoading(false)
    }
  }

  useEffect(() => {
    if (!companyId || !session) return
    const providerToken = session.provider_token
    if (!providerToken) return

    try {
      const payload = JSON.parse(atob(providerToken.split('.')[1]))
      const scopes: string = payload.scp || ''
      const hasPresence = scopes.toLowerCase().includes('presence.read.all')
      const hasChat = scopes.toLowerCase().includes('chat.readwrite')

      if (hasPresence && hasChat && teamsConfig && !teamsConfig.consent_granted) {
        supabase
          .from('company_teams_config')
          .update({
            consent_granted: true,
            consent_granted_by: session.user.id,
            consent_granted_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('company_id', companyId)
          .then(() => loadConfig())
      }
    } catch {
      // token decode failed — not a blocking error
    }
  }, [session, companyId, teamsConfig?.consent_granted])

  if (loading) {
    return (
      <div className="admin-section">
        <div className="admin-page-header">
          <h2>Integrations</h2>
        </div>
        <div className="admin-loading">Loading...</div>
      </div>
    )
  }

  const isEnabled = teamsConfig?.is_enabled ?? false
  const hasConsent = teamsConfig?.consent_granted ?? false

  return (
    <div className="admin-section">
      <div className="admin-page-header">
        <h2>Integrations</h2>
        <p>Connect external services to enhance your HR platform</p>
      </div>

      {/* Microsoft Teams Card */}
      <div style={{
        background: '#fff',
        border: '1px solid #e0e0e0',
        borderRadius: 12,
        padding: 24,
        maxWidth: 640,
      }}>
        {/* Card header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 10,
            background: 'linear-gradient(135deg, #5b5fc7, #7b83eb)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#1a1a2e' }}>Microsoft Teams</h3>
            <p style={{ margin: '2px 0 0', fontSize: 13, color: '#8b8fa3' }}>
              Presence status &amp; automated notifications
            </p>
          </div>
          <label className="admin-toggle-switch">
            <input
              type="checkbox"
              checked={isEnabled}
              onChange={toggleEnabled}
              disabled={saving}
            />
            <span className="admin-toggle-slider" />
          </label>
        </div>

        {/* Description */}
        <div style={{
          background: '#f8f9fa', borderRadius: 8, padding: 16, marginBottom: 20,
          fontSize: 13, lineHeight: 1.6, color: '#444',
        }}>
          <p style={{ margin: '0 0 8px', fontWeight: 600 }}>When enabled:</p>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            <li>Employee presence status (Available, Busy, Away, etc.) appears in the HR Directory</li>
            <li>Managers receive a Teams message when an employee submits a leave request</li>
          </ul>
        </div>

        {/* Status */}
        {isEnabled && (
          <>
            {/* Consent section */}
            <div style={{
              border: `1px solid ${hasConsent ? '#c8e6c9' : '#fff3e0'}`,
              background: hasConsent ? '#e8f5e9' : '#fff8e1',
              borderRadius: 8,
              padding: 16,
              marginBottom: 20,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={hasConsent ? '#2e7d32' : '#e65100'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  {hasConsent
                    ? <><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></>
                    : <><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></>
                  }
                </svg>
                <span style={{ fontWeight: 700, fontSize: 14, color: hasConsent ? '#2e7d32' : '#e65100' }}>
                  {hasConsent ? 'Microsoft permissions granted' : 'Microsoft permissions required'}
                </span>
              </div>

              {hasConsent ? (
                <p style={{ margin: 0, fontSize: 12, color: '#666' }}>
                  Consent granted {teamsConfig?.consent_granted_at ? `on ${formatDateTime(teamsConfig.consent_granted_at)}` : ''}
                  {consentorName ? ` by ${consentorName}` : ''}
                </p>
              ) : (
                <>
                  <p style={{ margin: '0 0 12px', fontSize: 13, color: '#555' }}>
                    To use Teams features, a company administrator must authorise the following Microsoft permissions.
                    This opens a Microsoft login window where you grant consent for your organisation.
                  </p>
                  <button
                    onClick={authoriseConsent}
                    disabled={consentLoading}
                    style={{
                      background: '#5b5fc7',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 8,
                      padding: '10px 20px',
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: consentLoading ? 'not-allowed' : 'pointer',
                      opacity: consentLoading ? 0.6 : 1,
                    }}
                  >
                    {consentLoading ? 'Redirecting...' : 'Authorise Microsoft Permissions'}
                  </button>
                </>
              )}
            </div>

            {/* Permission details */}
            <div style={{ marginBottom: 8 }}>
              <p style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 600, color: '#444' }}>Permissions requested</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {PERMISSION_EXPLANATIONS.map(p => (
                  <div key={p.scope} style={{
                    display: 'flex', gap: 10, fontSize: 13, lineHeight: 1.5,
                    padding: '10px 12px', background: '#fafafa', borderRadius: 6,
                    border: '1px solid #eee',
                  }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5b5fc7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 2 }}>
                      <rect x="3" y="11" width="18" height="11" rx="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                    <div>
                      <div style={{ fontWeight: 600, color: '#333' }}>{p.label}</div>
                      <div style={{ color: '#777', fontSize: 12 }}>{p.why}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {!isEnabled && (
          <p style={{ margin: 0, fontSize: 13, color: '#999', fontStyle: 'italic' }}>
            Switch on to configure Microsoft Teams integration for your company.
          </p>
        )}
      </div>
    </div>
  )
}
