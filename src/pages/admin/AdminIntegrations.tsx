import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'

interface TeamsConfig {
  id: string
  company_id: string
  is_enabled: boolean
  bot_configured: boolean
  azure_tenant_id: string | null
  bot_app_id: string | null
  bot_app_secret_encrypted: string | null
  consent_granted: boolean
  consent_granted_at: string | null
}

export default function AdminIntegrations() {
  const { companyUser } = useAuth()
  const { showSuccess, showError } = useToast()
  const [teamsConfig, setTeamsConfig] = useState<TeamsConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [botUserCount, setBotUserCount] = useState(0)

  const [tenantId, setTenantId] = useState('')
  const [botAppId, setBotAppId] = useState('')
  const [botAppSecret, setBotAppSecret] = useState('')
  const [savingCreds, setSavingCreds] = useState(false)
  const [showSetupGuide, setShowSetupGuide] = useState(false)

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
      setTenantId(data.azure_tenant_id || '')
      setBotAppId(data.bot_app_id || '')
      setBotAppSecret(data.bot_app_secret_encrypted ? '••••••••••••••••' : '')
    } else {
      setTeamsConfig(null)
    }

    const { count } = await supabase
      .from('company_teams_bot_conversations')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
    setBotUserCount(count || 0)

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

  async function saveCredentials() {
    if (!companyId) return
    if (!tenantId.trim() || !botAppId.trim()) {
      showError('Azure Tenant ID and Bot App ID are required')
      return
    }

    setSavingCreds(true)

    const updates: Record<string, unknown> = {
      azure_tenant_id: tenantId.trim(),
      bot_app_id: botAppId.trim(),
      bot_configured: true,
      updated_at: new Date().toISOString(),
    }
    if (botAppSecret && !botAppSecret.startsWith('••')) {
      updates.bot_app_secret_encrypted = botAppSecret.trim()
    }

    if (teamsConfig) {
      const { error } = await supabase
        .from('company_teams_config')
        .update(updates)
        .eq('company_id', companyId)
      if (error) {
        showError('Failed to save credentials: ' + error.message)
        setSavingCreds(false)
        return
      }
    } else {
      const { error } = await supabase
        .from('company_teams_config')
        .insert({ company_id: companyId, is_enabled: true, ...updates })
      if (error) {
        showError('Failed to save credentials: ' + error.message)
        setSavingCreds(false)
        return
      }
    }

    showSuccess('Bot credentials saved')
    await loadConfig()
    setSavingCreds(false)
  }

  function generateManifest() {
    if (!botAppId.trim()) {
      showError('Enter and save the Bot App ID first')
      return
    }

    const manifest = {
      '$schema': 'https://developer.microsoft.com/en-us/json-schemas/teams/v1.16/MicrosoftTeams.schema.json',
      manifestVersion: '1.16',
      version: '1.0.0',
      id: botAppId.trim(),
      developer: {
        name: 'InflowHR',
        websiteUrl: 'https://www.inflowhr.com',
        privacyUrl: 'https://www.inflowhr.com/privacy',
        termsOfUseUrl: 'https://www.inflowhr.com/terms',
      },
      name: { short: 'InflowHR', full: 'InflowHR HR Platform' },
      description: {
        short: 'HR notifications from InflowHR',
        full: 'Receive leave and expense approval notifications directly in Microsoft Teams from your InflowHR HR platform.',
      },
      icons: { outline: 'outline.png', color: 'color.png' },
      accentColor: '#5B5FC7',
      bots: [
        {
          botId: botAppId.trim(),
          scopes: ['personal'],
          supportsFiles: false,
          isNotificationOnly: true,
        },
      ],
      permissions: ['messageTeamMembers'],
      validDomains: ['app.inflowhr.com'],
    }

    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'manifest.json'
    a.click()
    URL.revokeObjectURL(url)
  }

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
  const isBotConfigured = teamsConfig?.bot_configured ?? false

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 12px', borderRadius: 8,
    border: '1px solid #ddd', fontSize: 14, fontFamily: 'monospace',
    background: '#fafafa', boxSizing: 'border-box',
  }

  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: 13, fontWeight: 600, color: '#333', marginBottom: 4,
  }

  const sectionStyle: React.CSSProperties = {
    border: '1px solid #e0e0e0', borderRadius: 8, padding: 16, marginBottom: 16,
  }

  return (
    <div className="admin-section">
      <div className="admin-page-header">
        <h2>Integrations</h2>
        <p>Connect external services to enhance your HR platform</p>
      </div>

      {/* Microsoft Teams Card */}
      <div style={{
        background: '#fff', border: '1px solid #e0e0e0',
        borderRadius: 12, padding: 24, maxWidth: 700,
      }}>
        {/* Card header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 10,
            background: 'linear-gradient(135deg, #5b5fc7, #7b83eb)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
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
              Presence status &amp; automated leave/expense notifications via Teams Bot
            </p>
          </div>
          <label className="admin-toggle-switch">
            <input type="checkbox" checked={isEnabled} onChange={toggleEnabled} disabled={saving} />
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
            <li>Managers receive a Teams message from the InflowHR bot when an employee submits a leave request or expense claim</li>
          </ul>
        </div>

        {isEnabled && (
          <>
            {/* Bot status */}
            <div style={{
              ...sectionStyle,
              border: `1px solid ${isBotConfigured ? '#c8e6c9' : '#fff3e0'}`,
              background: isBotConfigured ? '#e8f5e9' : '#fff8e1',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={isBotConfigured ? '#2e7d32' : '#e65100'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  {isBotConfigured
                    ? <><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></>
                    : <><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></>
                  }
                </svg>
                <span style={{ fontWeight: 700, fontSize: 14, color: isBotConfigured ? '#2e7d32' : '#e65100' }}>
                  {isBotConfigured ? 'Bot configured' : 'Bot setup required'}
                </span>
              </div>
              {isBotConfigured && (
                <p style={{ margin: 0, fontSize: 12, color: '#666' }}>
                  {botUserCount} user{botUserCount !== 1 ? 's' : ''} with the bot installed in Teams
                </p>
              )}
            </div>

            {/* Setup guide toggle */}
            <button
              onClick={() => setShowSetupGuide(!showSetupGuide)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                padding: '12px 16px', borderRadius: 8, border: '1px solid #e0e0e0',
                background: '#fafafa', cursor: 'pointer', fontSize: 14, fontWeight: 600,
                color: '#333', marginBottom: 16, textAlign: 'left',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5b5fc7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                style={{ transform: showSetupGuide ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}>
                <polyline points="9 18 15 12 9 6" />
              </svg>
              Setup Guide
            </button>

            {showSetupGuide && (
              <div style={{ ...sectionStyle, background: '#f8f9ff', borderColor: '#d0d4f0' }}>
                <div style={{ fontSize: 13, lineHeight: 1.8, color: '#444' }}>
                  <p style={{ margin: '0 0 12px', fontWeight: 700, fontSize: 15, color: '#333' }}>
                    How to set up the InflowHR Teams Bot
                  </p>

                  <div style={{ marginBottom: 16 }}>
                    <p style={{ margin: '0 0 4px', fontWeight: 700, color: '#5b5fc7' }}>Step 1: Register a Bot in Azure</p>
                    <ol style={{ margin: '0 0 8px', paddingLeft: 20, lineHeight: 2 }}>
                      <li>Go to the <a href="https://portal.azure.com/#create/Microsoft.AzureBotService" target="_blank" rel="noopener noreferrer" style={{ color: '#5b5fc7' }}>Azure Bot Service</a> in the Azure Portal</li>
                      <li>Click <strong>Create</strong> and choose <strong>Azure Bot</strong></li>
                      <li>Give it a name (e.g. &quot;InflowHR Bot&quot;) and select your subscription</li>
                      <li>Under <strong>Microsoft App ID</strong>, choose <strong>Create new</strong> and select <strong>Single Tenant</strong> (this is required — Multi-Tenant will not work)</li>
                      <li>Once created, go to <strong>Configuration</strong> and verify <strong>Bot Type</strong> shows <strong>SingleTenant</strong></li>
                      <li>Set the <strong>Messaging endpoint</strong> to:<br />
                        <code style={{ background: '#e8e8f0', padding: '2px 8px', borderRadius: 4, fontSize: 12 }}>
                          https://YOUR_SUPABASE_PROJECT.supabase.co/functions/v1/teams-bot-webhook
                        </code>
                      </li>
                      <li>Go to <strong>Channels</strong> and add <strong>Microsoft Teams</strong> — wait until the status shows <strong>Healthy</strong></li>
                    </ol>
                  </div>

                  <div style={{ marginBottom: 16 }}>
                    <p style={{ margin: '0 0 4px', fontWeight: 700, color: '#5b5fc7' }}>Step 2: Add Application Permissions</p>
                    <ol style={{ margin: '0 0 8px', paddingLeft: 20, lineHeight: 2 }}>
                      <li>In Azure Portal, go to <strong>App registrations</strong> and find the bot&apos;s app</li>
                      <li>Go to <strong>API permissions</strong> → <strong>Add a permission</strong> → <strong>Microsoft Graph</strong></li>
                      <li>Select <strong>Application permissions</strong> and add:
                        <ul style={{ listStyle: 'disc', paddingLeft: 20, margin: '4px 0' }}>
                          <li><strong>User.Read.All</strong> — resolve employee emails to Azure AD identities</li>
                          <li><strong>Presence.Read.All</strong> — show real-time availability in the HR Directory</li>
                        </ul>
                      </li>
                      <li>Click <strong>Grant admin consent</strong> for your organisation</li>
                      <li>Go to <strong>Certificates &amp; secrets</strong> → <strong>New client secret</strong> and copy the value</li>
                    </ol>
                  </div>

                  <div style={{ marginBottom: 16 }}>
                    <p style={{ margin: '0 0 4px', fontWeight: 700, color: '#5b5fc7' }}>Step 3: Enter Credentials Below</p>
                    <p style={{ margin: 0 }}>
                      Copy your Azure Tenant ID (from Azure AD → Overview), the Bot&apos;s Application (client) ID,
                      and the client secret into the form below and save.
                    </p>
                  </div>

                  <div style={{ marginBottom: 16 }}>
                    <p style={{ margin: '0 0 4px', fontWeight: 700, color: '#5b5fc7' }}>Step 4: Create &amp; Install the Teams App</p>
                    <ol style={{ margin: '0 0 8px', paddingLeft: 20, lineHeight: 2 }}>
                      <li>Click <strong>Download manifest.json</strong> below to get the Teams app manifest</li>
                      <li>Create a ZIP file containing:
                        <ul style={{ listStyle: 'disc', paddingLeft: 20, margin: '4px 0' }}>
                          <li><strong>manifest.json</strong> (the downloaded file)</li>
                          <li><strong>color.png</strong> — 192×192px app icon (your company logo or the InflowHR logo)</li>
                          <li><strong>outline.png</strong> — 32×32px outline icon (transparent background, white outline)</li>
                        </ul>
                      </li>
                      <li>In <strong>Teams Admin Centre</strong> → <strong>Manage apps</strong> → <strong>Upload new app</strong>, upload the ZIP</li>
                      <li>Set an <strong>App setup policy</strong> to install it for all users, or let users install it themselves from the Teams app store</li>
                      <li><strong>Important:</strong> Each user must open a chat with the bot at least once to register their conversation. Until they do, they will not receive notifications. Once registered, their &quot;users with bot installed&quot; count increases above</li>
                    </ol>
                  </div>

                  <div style={{
                    background: '#e8f0fe', borderRadius: 6, padding: 12, fontSize: 12, color: '#1a56db',
                    border: '1px solid #c6d9f7',
                  }}>
                    <strong>Note:</strong> Each user who has the bot installed will appear in the &quot;users with bot installed&quot; count above.
                    Only users with the bot installed will receive Teams notifications for leave requests and expense claims.
                  </div>
                </div>
              </div>
            )}

            {/* Bot credentials form */}
            <div style={sectionStyle}>
              <p style={{ margin: '0 0 16px', fontWeight: 700, fontSize: 14, color: '#333' }}>Bot Credentials</p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={labelStyle}>Azure Tenant ID</label>
                  <input
                    type="text"
                    value={tenantId}
                    onChange={e => setTenantId(e.target.value)}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Bot Application (Client) ID</label>
                  <input
                    type="text"
                    value={botAppId}
                    onChange={e => setBotAppId(e.target.value)}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Client Secret</label>
                  <input
                    type="password"
                    value={botAppSecret}
                    onChange={e => setBotAppSecret(e.target.value)}
                    placeholder={teamsConfig?.bot_app_secret_encrypted ? 'Secret saved — enter new value to update' : 'Enter client secret'}
                    style={inputStyle}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
                <button
                  onClick={saveCredentials}
                  disabled={savingCreds}
                  style={{
                    background: '#5b5fc7', color: '#fff', border: 'none',
                    borderRadius: 8, padding: '10px 20px', fontSize: 14, fontWeight: 600,
                    cursor: savingCreds ? 'not-allowed' : 'pointer',
                    opacity: savingCreds ? 0.6 : 1,
                  }}
                >
                  {savingCreds ? 'Saving...' : 'Save Credentials'}
                </button>

                <button
                  onClick={generateManifest}
                  style={{
                    background: '#fff', color: '#5b5fc7', border: '1px solid #5b5fc7',
                    borderRadius: 8, padding: '10px 20px', fontSize: 14, fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Download manifest.json
                </button>
              </div>
            </div>

            {/* Permissions summary */}
            <div style={{ marginBottom: 8 }}>
              <p style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 600, color: '#444' }}>
                Application permissions used by the bot
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  {
                    scope: 'User.Read.All',
                    label: 'Read all users\' profiles',
                    why: 'Look up employee emails in your Microsoft 365 directory to resolve Azure AD identities for presence and messaging.',
                  },
                  {
                    scope: 'Presence.Read.All',
                    label: 'Read all users\' presence',
                    why: 'Show real-time availability (Available, Busy, Away, etc.) on employee profiles in the HR Directory.',
                  },
                ].map(p => (
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
                <div style={{
                  display: 'flex', gap: 10, fontSize: 13, lineHeight: 1.5,
                  padding: '10px 12px', background: '#fafafa', borderRadius: 6,
                  border: '1px solid #eee',
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5b5fc7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 2 }}>
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  <div>
                    <div style={{ fontWeight: 600, color: '#333' }}>Bot messaging (personal scope)</div>
                    <div style={{ color: '#777', fontSize: 12 }}>
                      The bot sends one-to-one notifications to managers when leave requests or expense claims need their approval.
                      It can only message users who have the bot installed — no access to existing chats or channels.
                    </div>
                  </div>
                </div>
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
