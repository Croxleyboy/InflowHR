import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { useToast } from '../../context/ToastContext'
import { useFeatures } from '../../context/FeatureContext'

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

interface XeroIntegration {
  id: string
  company_id: string
  sync_status: string
  sync_error: string | null
  last_sync_at: string | null
  payslip_source: 'inflowhr' | 'xero'
  sync_benefits_to_xero: boolean
}

interface SageIntegration {
  id: string
  company_id: string
  sync_status: string
  sync_error: string | null
  last_sync_at: string | null
  last_upload_at: string | null
  last_upload_filename: string | null
  payslip_source: 'inflowhr' | 'sage'
}

interface ModulrIntegration {
  id: string
  company_id: string
  source_account_id: string
  status: string
  status_error: string | null
  connected_at: string | null
}

// ── Official brand logos as inline SVGs ──────────────────────────────────────

function TeamsLogo() {
  return (
    <svg width="36" height="36" viewBox="0 0 2228.833 2073.333" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M1554.637 777.5h575.713c54.391 0 98.483 44.092 98.483 98.483v524.398c0 199.901-162.051 361.952-361.952 361.952h-1.711c-199.901.028-361.975-161.996-362.004-361.897V828.971c0-28.427 23.044-51.471 51.471-51.471z" fill="#5059C9"/>
      <circle cx="1943.75" cy="440.583" r="233.25" fill="#5059C9"/>
      <circle cx="1218.083" cy="336.917" r="336.917" fill="#7B83EB"/>
      <path d="M1667.323 777.5H717.01c-53.743 1.33-96.257 45.931-95.01 99.676v598.105c-7.505 322.519 247.657 590.16 570.167 598.053 322.51-7.893 577.671-275.534 570.167-598.053V877.176c1.245-53.745-41.269-98.346-95.011-99.676z" fill="#7B83EB"/>
      <path d="M1244 777.5v838.145c-.258 38.435-23.549 72.964-59.09 87.598a91.856 91.856 0 01-35.765 7.257H783.86c-5.769-21.09-10.956-42.18-15.562-63.852a631.574 631.574 0 01-16.144-142.042V877.176c-1.246-53.745 41.267-98.346 95.01-99.676H1244z" opacity=".1"/>
      <path d="M1192.167 777.5v889.978a91.802 91.802 0 01-7.257 35.765c-14.634 35.541-49.163 58.832-87.598 59.09H799.315a520.605 520.605 0 01-15.455-63.852 631.574 631.574 0 01-16.144-142.042V877.176c-1.246-53.745 41.267-98.346 95.01-99.676h329.441z" opacity=".2"/>
      <path d="M1192.167 777.5v786.312c-.395 52.223-42.632 94.46-94.855 94.855H768.272a631.574 631.574 0 01-16.144-142.042V877.176c-1.246-53.745 41.267-98.346 95.01-99.676h345.029z" opacity=".2"/>
      <path d="M1140.333 777.5v786.312c-.395 52.223-42.632 94.46-94.855 94.855H768.272a631.574 631.574 0 01-16.144-142.042V877.176c-1.246-53.745 41.267-98.346 95.01-99.676h293.195z" opacity=".2"/>
      <linearGradient id="teams_a" x1="198.099" y1="1683.0726" x2="942.2344" y2="394.2607" gradientUnits="userSpaceOnUse" gradientTransform="matrix(1 0 0 -1 0 2075.333)">
        <stop offset="0" stopColor="#5A62C3"/>
        <stop offset=".5" stopColor="#4D55BD"/>
        <stop offset="1" stopColor="#3940AB"/>
      </linearGradient>
      <path d="M95.01 777.5h950.312c52.473 0 95.01 42.538 95.01 95.01v950.312c0 52.473-42.538 95.01-95.01 95.01H95.01c-52.473 0-95.01-42.538-95.01-95.01V872.51c0-52.472 42.538-95.01 95.01-95.01z" fill="url(#teams_a)"/>
      <path d="M820.211 1100.522H630.17v441.783H536.2v-441.783H348.005v-81.855h472.206v81.855z" fill="#fff"/>
    </svg>
  )
}

function XeroLogo() {
  return (
    <svg width="36" height="36" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
      <circle cx="256" cy="256" r="256" fill="#13B5EA"/>
      <path d="M156.2 256l-72.4-72.7c-4.6-4.6-4.6-12.1 0-16.7 4.6-4.6 12.1-4.6 16.7 0l64 64.3 64-64.3c4.6-4.6 12.1-4.6 16.7 0 4.6 4.6 4.6 12.1 0 16.7L173 256l72.2 72.7c4.6 4.6 4.6 12.1 0 16.7-2.3 2.3-5.3 3.5-8.3 3.5s-6-1.2-8.3-3.5l-64-64.3-64 64.3c-2.3 2.3-5.3 3.5-8.3 3.5s-6-1.2-8.3-3.5c-4.6-4.6-4.6-12.1 0-16.7l72.2-72.7zm134.2-83.4c-6.5 0-11.8-5.3-11.8-11.8s5.3-11.8 11.8-11.8 11.8 5.3 11.8 11.8-5.3 11.8-11.8 11.8zm11.8 35.2v127.8c0 6.5-5.3 11.8-11.8 11.8s-11.8-5.3-11.8-11.8V207.8c0-6.5 5.3-11.8 11.8-11.8s11.8 5.3 11.8 11.8zm116.2 36.3l-50.2 47.7 52.6 56.2c4.5 4.8 4.2 12.3-.6 16.7-2.3 2.1-5.2 3.2-8.1 3.2-3.2 0-6.3-1.3-8.6-3.8l-51.5-55.1-51.1 48.5c-2.3 2.2-5.2 3.3-8.2 3.3-3.1 0-6.3-1.2-8.6-3.7-4.5-4.8-4.3-12.3.5-16.8l52.3-49.7-50.6-54.1c-4.5-4.8-4.2-12.3.6-16.7 4.8-4.5 12.3-4.2 16.7.6l49.5 53 49.1-46.7c4.7-4.5 12.2-4.3 16.8.4 4.5 4.8 4.2 12.3-.6 16.8z" fill="#fff"/>
    </svg>
  )
}

function SageLogo() {
  return (
    <svg width="36" height="36" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
      <rect width="512" height="512" rx="64" fill="#00DC00"/>
      <g fill="#fff">
        <path d="M180.5 305.4c0 18.6-7.1 33.4-21.2 44.5-14.1 11-33.1 16.6-57.1 16.6-21.7 0-40.4-4.4-56.2-13.1v-41.8c13.1 7.2 24.4 12.2 33.8 14.9 9.4 2.8 17.9 4.1 25.4 4.1 9.1 0 16.1-1.7 21.1-5.2 4.9-3.5 7.4-8.4 7.4-14.7 0-4-1.2-7.5-3.5-10.5-2.3-3-5.5-5.8-9.5-8.5-4-2.7-11.9-7.1-23.6-13.3-11.1-5.8-19.6-11.3-25.5-16.6-5.9-5.3-10.6-11.4-14.2-18.4-3.5-7-5.3-15.2-5.3-24.5 0-17.9 6.5-32 19.6-42.3 13.1-10.3 30.8-15.5 53.1-15.5 21 0 41.2 5.1 60.6 15.3l-14.5 34.6c-17.4-9-33-13.5-46.6-13.5-7.8 0-13.8 1.6-18 4.9-4.2 3.3-6.3 7.6-6.3 12.9 0 3.8 1 7.1 3 9.8 2 2.8 5 5.4 9 7.9 4 2.5 12.1 7.1 24.3 13.7 16.6 8.9 28 17.5 34.1 25.8 6.2 8.3 9.1 18.4 9.1 30.3zM268.8 363.2c-7.1 1.3-15 1.9-23.8 1.9-22.1 0-38.5-5.4-49.1-16.3-10.6-10.9-15.9-27-15.9-48.4v-5.2h-1.3c-.4-3.5-.6-7.4-.6-11.8V185.8h42.8v88.6c0 6.5.2 11.2.6 14.3h1.3c0 13.1 2.8 22.7 8.4 28.9 5.6 6.2 14.2 9.3 25.8 9.3 3.5 0 7.6-.5 11.8-1.5v37.8z"/>
        <path d="M416.9 292.8H320c.8 12.3 5 21.6 12.5 28.1 7.5 6.5 17.5 9.7 29.9 9.7 14.2 0 27.4-4.2 39.5-12.5v35.2c-12.7 8.5-29.3 12.7-49.8 12.7-22.6 0-40.2-6.8-52.9-20.3-12.7-13.5-19.1-32.5-19.1-57 0-15.5 2.9-29.2 8.8-41.2 5.8-12 14.1-21.3 24.7-27.8 10.6-6.5 22.7-9.8 36.2-9.8 19.6 0 34.9 6.1 45.8 18.4 10.9 12.3 16.4 29.5 16.4 51.7v13.8zm-39.3-30.8c0-10.2-2.5-18.3-7.5-24.1-5-5.9-11.9-8.8-20.6-8.8-8.5 0-15.7 3.2-21.5 9.5-5.8 6.3-9.5 14.2-11.1 23.4h60.7z"/>
      </g>
    </svg>
  )
}

function ModulrLogo() {
  return (
    <svg width="36" height="36" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
      <rect width="512" height="512" rx="64" fill="#1A1A2E"/>
      <g fill="#00D4AA">
        <rect x="80" y="200" width="60" height="180" rx="8"/>
        <rect x="170" y="140" width="60" height="240" rx="8"/>
        <rect x="260" y="170" width="60" height="210" rx="8"/>
        <rect x="350" y="120" width="60" height="260" rx="8"/>
      </g>
      <text x="256" y="440" textAnchor="middle" fill="#fff" fontSize="48" fontWeight="700" fontFamily="system-ui">modulr</text>
    </svg>
  )
}

// ── Main Component ──────────────────────────────────────────────────────────

export default function AdminIntegrations() {
  const { session, isSuperAdmin, companyUser } = useAuth()
  const canDisconnect = isSuperAdmin || companyUser?.role === 'admin'
  const { selectedCompanyId } = useAdminCompany()
  const { showSuccess, showError } = useToast()
  const { features } = useFeatures()

  // Teams state
  const [teamsConfig, setTeamsConfig] = useState<TeamsConfig | null>(null)
  const [teamsExpanded, setTeamsExpanded] = useState(false)
  const [tenantId, setTenantId] = useState('')
  const [botAppId, setBotAppId] = useState('')
  const [botAppSecret, setBotAppSecret] = useState('')
  const [savingCreds, setSavingCreds] = useState(false)
  const [botUserCount, setBotUserCount] = useState(0)
  const [showSetupGuide, setShowSetupGuide] = useState(false)

  // Xero state
  const [xeroIntegration, setXeroIntegration] = useState<XeroIntegration | null>(null)
  const [xeroExpanded, setXeroExpanded] = useState(false)
  const [xeroConnecting, setXeroConnecting] = useState(false)
  const [xeroEmpSync, setXeroEmpSync] = useState<{ total: number; linked: number; unlinked: string[] } | null>(null)
  const [xeroSyncing, setXeroSyncing] = useState(false)

  // Sage state
  const [sageIntegration, setSageIntegration] = useState<SageIntegration | null>(null)
  const [sageExpanded, setSageExpanded] = useState(false)

  // Modulr state
  const [modulrIntegration, setModulrIntegration] = useState<ModulrIntegration | null>(null)
  const [modulrExpanded, setModulrExpanded] = useState(false)

  // AI Help Agent state
  const [aiHelpEnabled, setAiHelpEnabled] = useState(false)
  const [aiHelpExpanded, setAiHelpExpanded] = useState(false)
  const [aiHelpStats, setAiHelpStats] = useState<{ total: number; today: number } | null>(null)
  const [modulrApiKey, setModulrApiKey] = useState('')
  const [modulrHmacSecret, setModulrHmacSecret] = useState('')
  const [modulrSourceAccountId, setModulrSourceAccountId] = useState('')
  const [modulrShowSecret, setModulrShowSecret] = useState(false)
  const [modulrConnecting, setModulrConnecting] = useState(false)
  const [showModulrModal, setShowModulrModal] = useState(false)

  // OpenAI platform config (super admin only)
  const [openaiKey, setOpenaiKey] = useState('')
  const [openaiKeyPreview, setOpenaiKeyPreview] = useState<string | null>(null)
  const [openaiKeyUpdatedAt, setOpenaiKeyUpdatedAt] = useState<string | null>(null)
  const [openaiHasDbKey, setOpenaiHasDbKey] = useState(false)
  const [openaiHasEnvKey, setOpenaiHasEnvKey] = useState(false)
  const [openaiShowKey, setOpenaiShowKey] = useState(false)
  const [openaiSaving, setOpenaiSaving] = useState(false)
  const [openaiTesting, setOpenaiTesting] = useState(false)
  const [openaiTestResult, setOpenaiTestResult] = useState<{ connected: boolean; model_available?: boolean; model?: string; error?: string } | null>(null)
  const [openaiExpanded, setOpenaiExpanded] = useState(false)
  const [openaiPlatformStats, setOpenaiPlatformStats] = useState<{ total: number; today: number; companies: number } | null>(null)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [teamsSubscribed, setTeamsSubscribed] = useState(false)

  const companyId = selectedCompanyId

  const otherPayrollActive = (provider: 'xero' | 'sage') => {
    if (provider === 'xero') return sageIntegration?.sync_status === 'connected'
    return xeroIntegration?.sync_status === 'connected'
  }

  // ── Data loading ──────────────────────────────────────────────────────────

  async function loadAll() {
    if (!companyId) return
    setLoading(true)

    const [teamsRes, teamsBotRes, xeroRes, sageRes, modulrRes, featuresRes] = await Promise.all([
      supabase.from('company_teams_config').select('*').eq('company_id', companyId).maybeSingle(),
      supabase.from('company_teams_bot_conversations').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
      supabase.from('xero_integrations').select('id, company_id, sync_status, sync_error, last_sync_at, payslip_source, sync_benefits_to_xero').eq('company_id', companyId).maybeSingle(),
      supabase.from('sage_integrations').select('id, company_id, sync_status, sync_error, last_sync_at, last_upload_at, last_upload_filename, payslip_source').eq('company_id', companyId).maybeSingle(),
      supabase.from('modulr_integrations').select('id, company_id, source_account_id, status, status_error, connected_at').eq('company_id', companyId).maybeSingle(),
      supabase.from('company_features').select('feature_key, is_enabled').eq('company_id', companyId),
    ])

    if (featuresRes.data) {
      const fm = new Map(featuresRes.data.map(f => [f.feature_key, f.is_enabled]))
      setTeamsSubscribed(fm.get('teams_integration') === true)
      setAiHelpEnabled(fm.get('ai_help_agent') === true)
    } else {
      setTeamsSubscribed(false)
      setAiHelpEnabled(false)
    }

    const today = new Date().toISOString().slice(0, 10)
    const [aiTotalRes, aiTodayRes] = await Promise.all([
      supabase.from('help_search_logs').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('ai_generated', true),
      supabase.from('help_search_logs').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('ai_generated', true).gte('created_at', today),
    ])
    setAiHelpStats({ total: aiTotalRes.count || 0, today: aiTodayRes.count || 0 })

    if (isSuperAdmin) {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
      try {
        const keyStatusRes = await fetch(`${supabaseUrl}/functions/v1/test-openai-connection`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session!.access_token}` },
          body: JSON.stringify({ action: 'get_key_status' }),
        })
        if (keyStatusRes.ok) {
          const ks = await keyStatusRes.json()
          setOpenaiHasDbKey(ks.has_db_key)
          setOpenaiHasEnvKey(ks.has_env_key)
          setOpenaiKeyPreview(ks.key_preview)
          setOpenaiKeyUpdatedAt(ks.updated_at)
        }
      } catch { /* edge function not deployed yet */ }

      const [aiPlatformTotal, aiPlatformToday] = await Promise.all([
        supabase.from('ai_help_usage').select('query_count', { count: 'exact' }),
        supabase.from('ai_help_usage').select('query_count').eq('query_date', today),
      ])
      const totalQueries = (aiPlatformTotal.data || []).reduce((sum, r) => sum + (r.query_count || 0), 0)
      const todayQueries = (aiPlatformToday.data || []).reduce((sum, r) => sum + (r.query_count || 0), 0)
      const { count: companyCount } = await supabase.from('company_features')
        .select('id', { count: 'exact', head: true }).eq('feature_key', 'ai_help_agent').eq('is_enabled', true)
      setOpenaiPlatformStats({ total: totalQueries, today: todayQueries, companies: companyCount || 0 })
    }

    if (teamsRes.data) {
      const t = teamsRes.data as TeamsConfig
      setTeamsConfig(t)
      setTenantId(t.azure_tenant_id || '')
      setBotAppId(t.bot_app_id || '')
      setBotAppSecret(t.bot_app_secret_encrypted ? '••••••••••••••••' : '')
    } else {
      setTeamsConfig(null)
    }
    setBotUserCount(teamsBotRes.count || 0)

    setXeroIntegration(xeroRes.data as XeroIntegration | null)
    const sage = sageRes.data as SageIntegration | null
    setSageIntegration(sage)
    setModulrIntegration(modulrRes.data as ModulrIntegration | null)

    // Load Xero employee sync status
    if (xeroRes.data && (xeroRes.data as XeroIntegration).sync_status === 'connected') {
      const { data: emps } = await supabase
        .from('employees')
        .select('first_name, last_name, email, xero_employee_id')
        .eq('company_id', companyId)
        .eq('is_active', true)
      if (emps) {
        const linked = emps.filter(e => e.xero_employee_id).length
        const unlinked = emps.filter(e => !e.xero_employee_id).map(e => `${e.first_name} ${e.last_name}`)
        setXeroEmpSync({ total: emps.length, linked, unlinked })
      }
    } else {
      setXeroEmpSync(null)
    }

    setLoading(false)
  }

  useEffect(() => {
    setTeamsExpanded(false)
    setXeroExpanded(false)
    setSageExpanded(false)
    setModulrExpanded(false)
    setAiHelpExpanded(false)
    loadAll()
  }, [companyId])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const xeroParam = params.get('xero')
    if (xeroParam === 'connected') {
      showSuccess('Connected to Xero successfully')
      window.history.replaceState({}, '', window.location.pathname)
      setXeroExpanded(true)
      loadAll()
    } else if (xeroParam === 'error') {
      const reason = params.get('reason') || 'unknown'
      showError(`Xero connection failed: ${reason}`)
      window.history.replaceState({}, '', window.location.pathname)
      setXeroExpanded(true)
    }
  }, [])

  // ── Teams handlers ────────────────────────────────────────────────────────

  async function toggleTeams() {
    if (!companyId || !teamsSubscribed) return
    setSaving(true)
    const newEnabled = !teamsConfig?.is_enabled
    if (teamsConfig) {
      const { error } = await supabase.from('company_teams_config').update({ is_enabled: newEnabled, updated_at: new Date().toISOString() }).eq('company_id', companyId)
      if (error) { showError('Failed to update: ' + error.message); setSaving(false); return }
    } else {
      const { error } = await supabase.from('company_teams_config').insert({ company_id: companyId, is_enabled: newEnabled })
      if (error) { showError('Failed to save: ' + error.message); setSaving(false); return }
    }
    showSuccess(`Teams integration ${newEnabled ? 'enabled' : 'disabled'}`)
    await loadAll()
    setSaving(false)
  }

  async function saveTeamsCreds() {
    if (!companyId) return
    if (!tenantId.trim() || !botAppId.trim()) { showError('Azure Tenant ID and Bot App ID are required'); return }
    setSavingCreds(true)
    const updates: Record<string, unknown> = {
      azure_tenant_id: tenantId.trim(), bot_app_id: botAppId.trim(),
      bot_configured: true, updated_at: new Date().toISOString(),
    }
    if (botAppSecret && !botAppSecret.startsWith('••')) updates.bot_app_secret_encrypted = botAppSecret.trim()
    if (teamsConfig) {
      const { error } = await supabase.from('company_teams_config').update(updates).eq('company_id', companyId)
      if (error) { showError('Failed to save: ' + error.message); setSavingCreds(false); return }
    } else {
      const { error } = await supabase.from('company_teams_config').insert({ company_id: companyId, is_enabled: true, ...updates })
      if (error) { showError('Failed to save: ' + error.message); setSavingCreds(false); return }
    }
    showSuccess('Bot credentials saved')
    await loadAll()
    setSavingCreds(false)
  }

  function generateManifest() {
    if (!botAppId.trim()) { showError('Enter and save the Bot App ID first'); return }
    const manifest = {
      '$schema': 'https://developer.microsoft.com/en-us/json-schemas/teams/v1.16/MicrosoftTeams.schema.json',
      manifestVersion: '1.16', version: '1.0.0', id: botAppId.trim(),
      developer: { name: 'InflowHR', websiteUrl: 'https://www.inflowhr.com', privacyUrl: 'https://www.inflowhr.com/privacy', termsOfUseUrl: 'https://www.inflowhr.com/terms' },
      name: { short: 'InflowHR', full: 'InflowHR HR Platform' },
      description: { short: 'HR notifications from InflowHR', full: 'Receive leave and expense approval notifications directly in Microsoft Teams from your InflowHR HR platform.' },
      icons: { outline: 'outline.png', color: 'color.png' }, accentColor: '#5B5FC7',
      bots: [{ botId: botAppId.trim(), scopes: ['personal'], supportsFiles: false, isNotificationOnly: true }],
      permissions: ['messageTeamMembers'], validDomains: ['app.inflowhr.com'],
    }
    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'manifest.json'; a.click()
    URL.revokeObjectURL(url)
  }

  // ── Xero handlers ─────────────────────────────────────────────────────────

  async function callEdgeFunction(fnName: string, body: Record<string, unknown> = {}) {
    if (!session) { showError('Not authenticated'); return null }
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    const res = await fetch(`${supabaseUrl}/functions/v1/${fnName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ company_id: companyId, ...body }),
    })
    const data = await res.json()
    if (!res.ok) { showError(data.error || 'Request failed'); return null }
    return data
  }

  async function connectXero() {
    if (otherPayrollActive('xero')) {
      showError('Another payroll provider (Sage) is already connected. Disconnect it first on this page.')
      return
    }
    setXeroConnecting(true)
    const result = await callEdgeFunction('xero-connect')
    setXeroConnecting(false)
    if (result?.url) window.location.href = result.url
  }

  async function syncXeroEmployees() {
    setXeroSyncing(true)
    const result = await callEdgeFunction('xero-sync-employees')
    setXeroSyncing(false)
    if (result) {
      if (result.matched > 0) {
        showSuccess(`Linked ${result.matched} employee(s) to Xero by email`)
      } else if (result.unmatched > 0) {
        showError(`No new matches found — ${result.unmatched} Xero employee(s) have no matching email in InflowHR`)
      } else {
        showSuccess('All employees already linked')
      }
      loadAll()
    }
  }

  async function disconnectXero() {
    if (!confirm('Disconnect from Xero? This will remove the integration and delete all Xero payslip data.')) return
    if (!companyId) return
    await supabase.from('payslips').delete().eq('company_id', companyId).eq('source', 'xero')
    const { error } = await supabase.from('xero_integrations').delete().eq('company_id', companyId)
    if (error) { showError('Failed to disconnect Xero: ' + error.message); return }
    const { data: check } = await supabase.from('xero_integrations').select('id').eq('company_id', companyId).maybeSingle()
    if (check) { showError('Failed to disconnect Xero — you may not have permission. Please ask a company admin.'); return }
    setXeroIntegration(null)
    showSuccess('Xero disconnected')
    loadAll()
  }

  async function toggleSyncBenefits() {
    if (!companyId || !xeroIntegration) return
    const newVal = !xeroIntegration.sync_benefits_to_xero
    const { error } = await supabase.from('xero_integrations').update({ sync_benefits_to_xero: newVal }).eq('company_id', companyId)
    if (error) { showError('Failed to update setting: ' + error.message); return }
    setXeroIntegration({ ...xeroIntegration, sync_benefits_to_xero: newVal })
    showSuccess(newVal ? 'Benefit sync to Xero enabled' : 'Benefit sync to Xero disabled')
  }

  // ── Sage handlers ─────────────────────────────────────────────────────────

  async function enableSage() {
    if (!companyId) return
    if (otherPayrollActive('sage')) {
      showError('Another payroll provider (Xero) is already connected. Disconnect it first on this page.')
      return
    }
    const { error } = await supabase.from('sage_integrations').upsert({
      company_id: companyId,
      sync_status: 'connected',
      payslip_source: 'sage',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'company_id' })
    if (error) { showError('Failed to enable: ' + error.message); return }
    showSuccess('Sage Payroll enabled — upload payslips from the Payroll page')
    loadAll()
  }

  async function disconnectSage() {
    if (!confirm('Disconnect from Sage? This will remove the integration and delete all Sage payslip data.')) return
    if (!companyId) return
    await supabase.from('payslips').delete().eq('company_id', companyId).eq('source', 'sage')
    const { error } = await supabase.from('sage_integrations').delete().eq('company_id', companyId)
    if (error) { showError('Failed to disconnect Sage: ' + error.message); return }
    const { data: check } = await supabase.from('sage_integrations').select('id').eq('company_id', companyId).maybeSingle()
    if (check) { showError('Failed to disconnect Sage — you may not have permission. Please ask a company admin.'); return }
    setSageIntegration(null)
    showSuccess('Sage disconnected')
    loadAll()
  }

  // ── Modulr handlers ───────────────────────────────────────────────────────

  async function connectModulr() {
    if (!companyId || !modulrApiKey.trim() || !modulrHmacSecret.trim() || !modulrSourceAccountId.trim()) {
      showError('All fields are required')
      return
    }
    setModulrConnecting(true)
    const result = await callEdgeFunction('modulr-connect', {
      api_key: modulrApiKey.trim(),
      hmac_secret: modulrHmacSecret.trim(),
      source_account_id: modulrSourceAccountId.trim(),
    })
    setModulrConnecting(false)
    if (result) {
      if (result.status === 'connected') {
        showSuccess('Modulr connected successfully')
        setShowModulrModal(false)
        setModulrApiKey('')
        setModulrHmacSecret('')
        setModulrSourceAccountId('')
      } else if (result.status === 'ip_whitelist_pending') {
        showError(result.error || 'IP Whitelist pending — add our static IP to your Modulr portal')
      } else {
        showError(result.error || 'Connection failed')
      }
      loadAll()
    }
  }

  async function disconnectModulr() {
    if (!confirm('Disconnect Modulr? This will remove the integration credentials.')) return
    if (!companyId) return
    const { error } = await supabase.from('modulr_integrations').delete().eq('company_id', companyId)
    if (error) { showError('Failed to disconnect Modulr: ' + error.message); return }
    const { data: check } = await supabase.from('modulr_integrations').select('id').eq('company_id', companyId).maybeSingle()
    if (check) { showError('Failed to disconnect Modulr — you may not have permission. Please ask a company admin.'); return }
    setModulrIntegration(null)
    showSuccess('Modulr disconnected')
    loadAll()
  }

  // ── AI Help Agent handlers ─────────────────────────────────────────────────

  async function toggleAiHelp() {
    if (!companyId) return
    setSaving(true)
    const newState = !aiHelpEnabled
    await supabase.from('company_features').upsert(
      { company_id: companyId, feature_key: 'ai_help_agent', is_enabled: newState },
      { onConflict: 'company_id,feature_key' },
    )
    setAiHelpEnabled(newState)
    setSaving(false)
    showSuccess(newState ? 'AI Help Agent enabled' : 'AI Help Agent disabled')
  }

  // ── OpenAI platform handlers (super admin) ─────────────────────────────────

  async function saveOpenaiKey() {
    if (!session || !openaiKey.trim()) return
    setOpenaiSaving(true)
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/test-openai-connection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ action: 'save_key', api_key: openaiKey.trim() }),
      })
      const data = await res.json()
      if (res.ok) {
        showSuccess('OpenAI API key saved')
        setOpenaiKey('')
        setOpenaiHasDbKey(true)
        setOpenaiKeyPreview(`sk-...${openaiKey.trim().slice(-4)}`)
        setOpenaiKeyUpdatedAt(new Date().toISOString())
      } else {
        showError(data.error || 'Failed to save key')
      }
    } catch {
      showError('Failed to save key')
    }
    setOpenaiSaving(false)
  }

  async function testOpenaiConnection() {
    if (!session) return
    setOpenaiTesting(true)
    setOpenaiTestResult(null)
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/test-openai-connection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ action: 'test', api_key: openaiKey.trim() || undefined }),
      })
      const data = await res.json()
      setOpenaiTestResult(data)
      if (data.connected) showSuccess('OpenAI connection verified — GPT-4o Mini available')
      else showError(data.error || 'Connection test failed')
    } catch {
      showError('Connection test failed')
    }
    setOpenaiTesting(false)
  }

  async function deleteOpenaiKey() {
    if (!session || !confirm('Remove the saved OpenAI API key? The AI Help Agent will stop working unless an environment variable is set.')) return
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/test-openai-connection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ action: 'delete_key' }),
      })
      if (res.ok) {
        showSuccess('API key removed')
        setOpenaiHasDbKey(false)
        setOpenaiKeyPreview(null)
        setOpenaiKeyUpdatedAt(null)
        setOpenaiTestResult(null)
      }
    } catch {
      showError('Failed to remove key')
    }
  }

  // ── Shared styles ─────────────────────────────────────────────────────────

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 12px', borderRadius: 8,
    border: '1px solid var(--border, #ddd)', fontSize: 14, fontFamily: 'monospace',
    background: 'var(--bg, #fafafa)', color: 'var(--text, #1a1a2e)', boxSizing: 'border-box',
  }
  const labelStyle: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text, #333)', marginBottom: 4 }
  const sectionStyle: React.CSSProperties = { border: '1px solid var(--border, #e0e0e0)', borderRadius: 8, padding: 16, marginBottom: 16 }

  function statusBadge(status: string) {
    if (status === 'connected') return <span className="admin-badge admin-badge-approved">Connected</span>
    if (status === 'error') return <span className="admin-badge admin-badge-rejected">Error</span>
    if (status === 'syncing') return <span className="admin-badge admin-badge-pending">Syncing</span>
    if (status === 'ip_whitelist_pending') return <span className="admin-badge admin-badge-pending">IP Whitelist Pending</span>
    return <span className="admin-badge" style={{ background: 'var(--bg, #f1f5f9)', color: 'var(--text-muted, #64748b)' }}>Not Connected</span>
  }

  if (loading) {
    return (
      <div className="admin-section">
        <div className="admin-page-header"><h2>Integrations</h2></div>
        <div className="admin-loading">Loading...</div>
      </div>
    )
  }

  const teamsEnabled = teamsConfig?.is_enabled ?? false
  const isBotConfigured = teamsConfig?.bot_configured ?? false

  const cardStyle = (subscribed: boolean): React.CSSProperties => ({
    background: 'var(--bg-card, #fff)', border: '1px solid var(--border, #e0e0e0)',
    borderRadius: 12, padding: 24, marginBottom: 16,
    opacity: subscribed ? 1 : 0.55, pointerEvents: subscribed ? 'auto' : 'none',
    position: 'relative',
  })

  const chevronStyle = (expanded: boolean): React.CSSProperties => ({
    width: 20, height: 20, transform: expanded ? 'rotate(90deg)' : 'none',
    transition: 'transform 0.2s', cursor: 'pointer', flexShrink: 0,
  })

  return (
    <div className="admin-section">
      <div className="admin-page-header">
        <h2>Integrations</h2>
        <p>Connect external services to enhance your HR platform</p>
      </div>

      <div style={{ maxWidth: 740 }}>

        {/* ── Microsoft Teams Card ── */}
        <div style={cardStyle(teamsSubscribed)}>
          {!teamsSubscribed && (
            <div style={{ position: 'absolute', top: 12, right: 16, background: '#6366f1', color: '#fff', fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, pointerEvents: 'auto' }}>
              Pack B subscription required
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, cursor: teamsSubscribed ? 'pointer' : 'default' }}
            onClick={() => teamsSubscribed && setTeamsExpanded(!teamsExpanded)}>
            <TeamsLogo />
            <div style={{ flex: 1 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--text, #1a1a2e)' }}>Microsoft Teams</h3>
              <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--text-muted, #8b8fa3)' }}>
                Presence status &amp; automated leave/expense notifications
              </p>
            </div>
            {teamsSubscribed && statusBadge(teamsEnabled ? (isBotConfigured ? 'connected' : 'not_connected') : 'not_connected')}
            {teamsSubscribed && (
              <label className="admin-toggle-switch" onClick={e => e.stopPropagation()}>
                <input type="checkbox" checked={teamsEnabled} onChange={toggleTeams} disabled={saving} />
                <span className="admin-toggle-slider" />
              </label>
            )}
            {teamsSubscribed && (
              <svg viewBox="0 0 24 24" fill="none" stroke="var(--text-muted, #64748b)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={chevronStyle(teamsExpanded)}>
                <polyline points="9 18 15 12 9 6" />
              </svg>
            )}
          </div>

          {teamsExpanded && teamsEnabled && (
            <div style={{ marginTop: 20 }}>
              <div style={{
                ...sectionStyle,
                border: `1px solid ${isBotConfigured ? '#c8e6c9' : '#fff3e0'}`,
                background: isBotConfigured ? 'rgba(232,245,233,.5)' : 'rgba(255,248,225,.5)',
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
                {isBotConfigured && <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted, #666)' }}>{botUserCount} user{botUserCount !== 1 ? 's' : ''} with the bot installed</p>}
              </div>

              <button onClick={() => setShowSetupGuide(!showSetupGuide)} style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                padding: '12px 16px', borderRadius: 8, border: '1px solid var(--border, #e0e0e0)',
                background: 'var(--bg, #fafafa)', cursor: 'pointer', fontSize: 14, fontWeight: 600,
                color: 'var(--text, #333)', marginBottom: 16, textAlign: 'left',
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5b5fc7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  style={{ transform: showSetupGuide ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}>
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                Setup Guide
              </button>

              {showSetupGuide && (
                <div style={{ ...sectionStyle, background: 'rgba(248,249,255,.5)', borderColor: '#d0d4f0' }}>
                  <div style={{ fontSize: 13, lineHeight: 1.8, color: 'var(--text, #444)' }}>
                    <p style={{ margin: '0 0 12px', fontWeight: 700, fontSize: 15 }}>How to set up the InflowHR Teams Bot</p>
                    <div style={{ marginBottom: 16 }}>
                      <p style={{ margin: '0 0 4px', fontWeight: 700, color: '#5b5fc7' }}>Step 1: Register a Bot in Azure</p>
                      <ol style={{ margin: '0 0 8px', paddingLeft: 20, lineHeight: 2 }}>
                        <li>Go to the <a href="https://portal.azure.com/#create/Microsoft.AzureBotService" target="_blank" rel="noopener noreferrer" style={{ color: '#5b5fc7' }}>Azure Bot Service</a></li>
                        <li>Create an <strong>Azure Bot</strong>, choose <strong>Single Tenant</strong></li>
                        <li>Set messaging endpoint to your Supabase edge function URL</li>
                        <li>Add <strong>Microsoft Teams</strong> channel</li>
                      </ol>
                    </div>
                    <div style={{ marginBottom: 16 }}>
                      <p style={{ margin: '0 0 4px', fontWeight: 700, color: '#5b5fc7' }}>Step 2: Add Permissions</p>
                      <ol style={{ margin: '0 0 8px', paddingLeft: 20, lineHeight: 2 }}>
                        <li>Add <strong>User.Read.All</strong> and <strong>Presence.Read.All</strong> application permissions</li>
                        <li>Grant admin consent, then create a client secret</li>
                      </ol>
                    </div>
                    <div style={{ marginBottom: 16 }}>
                      <p style={{ margin: '0 0 4px', fontWeight: 700, color: '#5b5fc7' }}>Step 3: Enter Credentials Below</p>
                    </div>
                    <div>
                      <p style={{ margin: '0 0 4px', fontWeight: 700, color: '#5b5fc7' }}>Step 4: Download &amp; Install the Teams App</p>
                      <p style={{ margin: 0, fontSize: 12 }}>Download the manifest, create a ZIP with icons, upload to Teams Admin Centre.</p>
                    </div>
                  </div>
                </div>
              )}

              <div style={sectionStyle}>
                <p style={{ margin: '0 0 16px', fontWeight: 700, fontSize: 14, color: 'var(--text, #333)' }}>Bot Credentials</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div><label style={labelStyle}>Azure Tenant ID</label><input type="text" value={tenantId} onChange={e => setTenantId(e.target.value)} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" style={inputStyle} /></div>
                  <div><label style={labelStyle}>Bot Application (Client) ID</label><input type="text" value={botAppId} onChange={e => setBotAppId(e.target.value)} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" style={inputStyle} /></div>
                  <div><label style={labelStyle}>Client Secret</label><input type="password" value={botAppSecret} onChange={e => setBotAppSecret(e.target.value)} placeholder={teamsConfig?.bot_app_secret_encrypted ? 'Secret saved — enter new to update' : 'Enter client secret'} style={inputStyle} /></div>
                </div>
                <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
                  <button onClick={saveTeamsCreds} disabled={savingCreds} style={{ background: '#5b5fc7', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: savingCreds ? 'not-allowed' : 'pointer', opacity: savingCreds ? 0.6 : 1 }}>
                    {savingCreds ? 'Saving...' : 'Save Credentials'}
                  </button>
                  <button onClick={generateManifest} style={{ background: 'var(--bg-card, #fff)', color: '#5b5fc7', border: '1px solid #5b5fc7', borderRadius: 8, padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                    Download manifest.json
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Xero Card ── */}
        <div style={cardStyle(true)}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer' }}
            onClick={() => setXeroExpanded(!xeroExpanded)}>
            <XeroLogo />
            <div style={{ flex: 1 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--text, #1a1a2e)' }}>Xero Payroll</h3>
              <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--text-muted, #8b8fa3)' }}>
                Sync payslip data from Xero Payroll UK
              </p>
            </div>
            {statusBadge(xeroIntegration?.sync_status || 'not_connected')}
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--text-muted, #64748b)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={chevronStyle(xeroExpanded)}>
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </div>

          {xeroExpanded && (
            <div style={{ marginTop: 20 }}>
              {xeroIntegration?.sync_status === 'connected' && (
                <>
                  <div style={{ ...sectionStyle, background: 'rgba(232,245,233,.5)', borderColor: '#a5d6a7' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                      <div>
                        <strong style={{ fontSize: 13, color: '#2e7d32' }}>Connected to Xero</strong>
                        {xeroIntegration.last_sync_at && (
                          <p style={{ margin: '2px 0 0', fontSize: 12, color: '#4caf50' }}>
                            Last synced: {new Date(xeroIntegration.last_sync_at).toLocaleString('en-GB')}
                          </p>
                        )}
                      </div>
                      {canDisconnect && <button className="admin-btn" onClick={disconnectXero}>Disconnect</button>}
                    </div>
                  </div>

                  {xeroEmpSync && (
                    <div style={{ ...sectionStyle, background: 'rgba(232,242,255,.5)', borderColor: '#90caf9' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                        <div>
                          <strong style={{ fontSize: 13, color: '#1565c0' }}>
                            Employee Linking: {xeroEmpSync.linked}/{xeroEmpSync.total} linked to Xero
                          </strong>
                          {xeroEmpSync.unlinked.length > 0 && (
                            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#1976d2' }}>
                              Not linked: {xeroEmpSync.unlinked.join(', ')}
                            </p>
                          )}
                          <p style={{ margin: '2px 0 0', fontSize: 11, color: '#64b5f6' }}>
                            Employees are matched by email address
                          </p>
                        </div>
                        <button className="admin-btn" onClick={syncXeroEmployees} disabled={xeroSyncing} style={{ fontSize: 13 }}>
                          {xeroSyncing ? 'Syncing...' : 'Re-sync Employees'}
                        </button>
                      </div>
                    </div>
                  )}

                  <div style={{ ...sectionStyle, background: 'rgba(248,249,255,.5)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                      <div>
                        <strong style={{ fontSize: 13, color: 'var(--text, #333)' }}>Sync Benefits to Xero</strong>
                        <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted, #6b7280)' }}>
                          When enabled, benefit enrollment changes are included as adjustment lines when pushing payroll to Xero.
                        </p>
                      </div>
                      <label className="admin-toggle">
                        <input type="checkbox" checked={xeroIntegration?.sync_benefits_to_xero ?? false} onChange={toggleSyncBenefits} />
                        <span className="admin-toggle-slider" />
                      </label>
                    </div>
                  </div>
                </>
              )}

              {xeroIntegration?.sync_status === 'error' && (
                <div style={{ ...sectionStyle, background: 'rgba(255,235,238,.5)', borderColor: '#ef9a9a' }}>
                  <strong style={{ fontSize: 13, color: '#c62828' }}>Connection Error</strong>
                  {xeroIntegration.sync_error && <p style={{ margin: '4px 0 0', fontSize: 12, color: '#c62828' }}>{xeroIntegration.sync_error}</p>}
                  <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                    <button className="admin-btn admin-btn-primary" onClick={connectXero} disabled={xeroConnecting}>{xeroConnecting ? 'Redirecting...' : 'Reconnect'}</button>
                    {canDisconnect && <button className="admin-btn" onClick={disconnectXero}>Remove</button>}
                  </div>
                </div>
              )}

              {(!xeroIntegration || xeroIntegration.sync_status === 'not_connected') && (
                <div style={{ ...sectionStyle, textAlign: 'center', padding: 24 }}>
                  {otherPayrollActive('xero') && (
                    <p style={{ margin: '0 0 12px', fontSize: 13, color: '#dc2626', fontWeight: 600 }}>
                      Sage is currently connected. Disconnect Sage before connecting Xero.
                    </p>
                  )}
                  <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text, #1a1a2e)' }}>
                    Click below to authorise InflowHR to access your Xero payroll data. You will be redirected to Xero to sign in.
                  </p>
                  <button className="admin-btn admin-btn-primary" onClick={connectXero}
                    disabled={xeroConnecting || otherPayrollActive('xero')}
                    style={{ fontSize: 14, padding: '10px 24px' }}>
                    {xeroConnecting ? 'Redirecting to Xero...' : 'Connect to Xero'}
                  </button>
                </div>
              )}

              <div style={{ ...sectionStyle, background: 'rgba(248,249,255,.5)' }}>
                <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: 'var(--text, #333)' }}>How it works</p>
                <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.8, color: 'var(--text, #444)' }}>
                  <li>OAuth 2.0 connection — InflowHR never stores your Xero password</li>
                  <li>Read-only access to payroll data (pay runs, payslips, employee records)</li>
                  <li>Payslips are matched to InflowHR employees by email address</li>
                  <li>Sync payslips on demand from the Payroll page once connected</li>
                  <li>Only one external payroll provider can be active at a time</li>
                </ul>
              </div>
            </div>
          )}
        </div>

        {/* ── Sage Card ── */}
        <div style={cardStyle(true)}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer' }}
            onClick={() => setSageExpanded(!sageExpanded)}>
            <SageLogo />
            <div style={{ flex: 1 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--text, #1a1a2e)' }}>Sage Payroll</h3>
              <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--text-muted, #8b8fa3)' }}>
                Import payslip PDFs exported from Sage Payroll
              </p>
            </div>
            {statusBadge(sageIntegration?.sync_status || 'not_connected')}
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--text-muted, #64748b)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={chevronStyle(sageExpanded)}>
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </div>

          {sageExpanded && (
            <div style={{ marginTop: 20 }}>
              {sageIntegration?.sync_status === 'connected' && (
                <div style={{ ...sectionStyle, background: 'rgba(232,245,233,.5)', borderColor: '#a5d6a7' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                    <div>
                      <strong style={{ fontSize: 13, color: '#2e7d32' }}>Sage Payroll Enabled</strong>
                      {sageIntegration.last_upload_at && (
                        <p style={{ margin: '2px 0 0', fontSize: 12, color: '#4caf50' }}>
                          Last upload: {new Date(sageIntegration.last_upload_at).toLocaleString('en-GB')}
                          {sageIntegration.last_upload_filename && ` — ${sageIntegration.last_upload_filename}`}
                        </p>
                      )}
                    </div>
                    {canDisconnect && <button className="admin-btn" onClick={disconnectSage}>Disconnect</button>}
                  </div>
                </div>
              )}

              {(!sageIntegration || sageIntegration.sync_status === 'not_connected') && (
                <div style={{ marginTop: 0 }}>
                  {otherPayrollActive('sage') && (
                    <div style={{ ...sectionStyle, background: 'rgba(255,248,225,.5)', borderColor: '#ffe0b2' }}>
                      <p style={{ margin: 0, fontSize: 13, color: '#e65100', fontWeight: 600 }}>
                        Xero is currently connected. Disconnect Xero before connecting Sage.
                      </p>
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                    <button className="admin-btn admin-btn-primary" onClick={enableSage}
                      disabled={otherPayrollActive('sage')}
                      style={{ fontSize: 14, padding: '10px 24px', background: '#00a600' }}>
                      Enable Sage Payroll
                    </button>
                  </div>
                </div>
              )}

              <div style={{ ...sectionStyle, background: 'rgba(248,249,255,.5)', marginTop: 16 }}>
                <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: 'var(--text, #333)' }}>How it works</p>
                <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.8, color: 'var(--text, #444)' }}>
                  <li>Your accountant processes payroll in Sage and exports a monthly payslip PDF</li>
                  <li>Upload the PDF on the <strong>Payroll &gt; Sage Pay</strong> tab</li>
                  <li>InflowHR parses the PDF and matches employees by their Employee ID</li>
                  <li>Matched payslips are saved and visible to employees on their Payslips page</li>
                  <li>Only one external payroll provider can be active at a time</li>
                </ul>
              </div>
            </div>
          )}
        </div>

        {/* ── AI Help Agent Card ── */}
        <div style={{ ...cardStyle(true), position: 'relative', opacity: features.ai_help_agent ? 1 : 0.55, pointerEvents: features.ai_help_agent ? 'auto' : 'none' }}>
          {!features.ai_help_agent && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10, pointerEvents: 'auto', borderRadius: 16 }}>
              <span style={{ background: '#00897b', color: '#fff', padding: '8px 20px', borderRadius: 8, fontSize: 14, fontWeight: 600, boxShadow: '0 2px 8px rgba(0,0,0,.15)' }}>
                Requires Pro Integrations (Pack B)
              </span>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer' }}
            onClick={() => setAiHelpExpanded(!aiHelpExpanded)}>
            <svg width="36" height="36" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="256" cy="256" r="256" fill="#7c3aed"/>
              <path d="M256 120c-8 0-14 6-14 14v20c-50 8-88 50-88 102 0 56 46 102 102 102s102-46 102-102c0-52-38-94-88-102v-20c0-8-6-14-14-14zm0 208c-40 0-72-32-72-72s32-72 72-72 72 32 72 72-32 72-72 72z" fill="#fff"/>
              <circle cx="256" cy="256" r="28" fill="#fff"/>
              <path d="M340 160l24-24M172 160l-24-24M340 352l24 24M172 352l-24 24M256 108V80M256 432v-28M380 256h28M104 256h28" stroke="#fff" strokeWidth="16" strokeLinecap="round"/>
            </svg>
            <div style={{ flex: 1 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--text, #1a1a2e)' }}>AI Help Agent</h3>
              <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--text-muted, #8b8fa3)' }}>
                AI-powered answers when FAQ articles cannot match
              </p>
            </div>
            <span className={`admin-badge ${aiHelpEnabled ? 'admin-badge-approved' : ''}`}
              style={!aiHelpEnabled ? { background: 'var(--bg, #f1f5f9)', color: 'var(--text-muted, #64748b)' } : undefined}>
              {aiHelpEnabled ? 'Enabled' : 'Not Enabled'}
            </span>
            <label className="admin-toggle" onClick={e => e.stopPropagation()}>
              <input type="checkbox" checked={aiHelpEnabled} onChange={toggleAiHelp} disabled={saving} />
              <span className="admin-toggle-slider" />
            </label>
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--text-muted, #64748b)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={chevronStyle(aiHelpExpanded)}>
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </div>

          {aiHelpExpanded && (
            <div style={{ marginTop: 20 }}>
              {aiHelpEnabled && aiHelpStats && (
                <div style={{ ...sectionStyle, background: 'rgba(232,245,233,.5)', borderColor: '#a5d6a7' }}>
                  <strong style={{ fontSize: 13, color: '#2e7d32' }}>Usage</strong>
                  <div style={{ display: 'flex', gap: 24, marginTop: 8 }}>
                    <div>
                      <p style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text, #1a1a2e)' }}>{aiHelpStats.total}</p>
                      <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted, #888)' }}>Total AI queries</p>
                    </div>
                    <div>
                      <p style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text, #1a1a2e)' }}>{aiHelpStats.today}</p>
                      <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted, #888)' }}>Today</p>
                    </div>
                  </div>
                </div>
              )}

              <div style={{ ...sectionStyle, background: 'rgba(248,249,255,.5)', marginTop: 16 }}>
                <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: 'var(--text, #333)' }}>How it works</p>
                <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.8, color: 'var(--text, #444)' }}>
                  <li>When an employee's question has no FAQ match, AI generates an answer using your company's help articles as context</li>
                  <li>Answers are grounded in your published help articles only — the AI will not invent policies or information</li>
                  <li>No employee personal data is sent to the AI provider — only the question text and your FAQ content</li>
                  <li>Rate limited to 20 AI queries per employee per day</li>
                  <li>Seamless experience — employees see AI answers in the same chat flow as FAQ results</li>
                  <li>Search analytics track AI vs FAQ responses separately in Admin &gt; Employee Help</li>
                </ul>
              </div>

              <div style={{ ...sectionStyle, background: 'rgba(255,248,225,.5)', borderColor: '#ffe0b2', marginTop: 16 }}>
                <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 600, color: '#e65100' }}>Data Privacy</p>
                <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: 'var(--text, #444)' }}>
                  Only the employee's question and your company's FAQ article content are sent to OpenAI. No employee names, leave balances, payslip data, or any personal information is shared. Data-aware answers (leave balance, next shift, etc.) continue to be resolved locally from your database.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ── Modulr Card ── */}
        <div style={{ ...cardStyle(true), position: 'relative', opacity: features.modulr_integration ? 1 : 0.55, pointerEvents: features.modulr_integration ? 'auto' : 'none' }}>
          {!features.modulr_integration && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10, pointerEvents: 'auto', borderRadius: 16 }}>
              <span style={{ background: '#00897b', color: '#fff', padding: '8px 20px', borderRadius: 8, fontSize: 14, fontWeight: 600, boxShadow: '0 2px 8px rgba(0,0,0,.15)' }}>
                Requires Pro Integrations (Pack B)
              </span>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer' }}
            onClick={() => setModulrExpanded(!modulrExpanded)}>
            <ModulrLogo />
            <div style={{ flex: 1 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--text, #1a1a2e)' }}>Modulr Payments</h3>
              <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--text-muted, #8b8fa3)' }}>
                1-Click Faster Payments for payroll payouts
              </p>
            </div>
            {statusBadge(modulrIntegration?.status || 'not_connected')}
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--text-muted, #64748b)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={chevronStyle(modulrExpanded)}>
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </div>

          {modulrExpanded && (
            <div style={{ marginTop: 20 }}>
              {modulrIntegration?.status === 'connected' && (
                <div style={{ ...sectionStyle, background: 'rgba(232,245,233,.5)', borderColor: '#a5d6a7' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                    <div>
                      <strong style={{ fontSize: 13, color: '#2e7d32' }}>Connected to Modulr</strong>
                      {modulrIntegration.connected_at && (
                        <p style={{ margin: '2px 0 0', fontSize: 12, color: '#4caf50' }}>
                          Connected: {new Date(modulrIntegration.connected_at).toLocaleString('en-GB')}
                        </p>
                      )}
                      <p style={{ margin: '2px 0 0', fontSize: 12, color: '#666' }}>
                        Source Account: {modulrIntegration.source_account_id}
                      </p>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="admin-btn admin-btn-primary" onClick={() => setShowModulrModal(true)}>Reconfigure</button>
                      {canDisconnect && <button className="admin-btn" onClick={disconnectModulr}>Disconnect</button>}
                    </div>
                  </div>
                </div>
              )}

              {modulrIntegration?.status === 'ip_whitelist_pending' && (
                <div style={{ ...sectionStyle, background: 'rgba(255,248,225,.5)', borderColor: '#ffe0b2' }}>
                  <strong style={{ fontSize: 13, color: '#e65100' }}>IP Whitelist Pending</strong>
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: '#e65100' }}>
                    {modulrIntegration.status_error || 'Please add our static IP to your Modulr portal, then click Reconfigure.'}
                  </p>
                  <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                    <button className="admin-btn admin-btn-primary" onClick={() => setShowModulrModal(true)}>Reconfigure</button>
                    {canDisconnect && <button className="admin-btn" onClick={disconnectModulr}>Remove</button>}
                  </div>
                </div>
              )}

              {modulrIntegration?.status === 'error' && (
                <div style={{ ...sectionStyle, background: 'rgba(255,235,238,.5)', borderColor: '#ef9a9a' }}>
                  <strong style={{ fontSize: 13, color: '#c62828' }}>Connection Error</strong>
                  {modulrIntegration.status_error && <p style={{ margin: '4px 0 0', fontSize: 12, color: '#c62828' }}>{modulrIntegration.status_error}</p>}
                  <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                    <button className="admin-btn admin-btn-primary" onClick={() => setShowModulrModal(true)}>Reconfigure</button>
                    {canDisconnect && <button className="admin-btn" onClick={disconnectModulr}>Remove</button>}
                  </div>
                </div>
              )}

              {(!modulrIntegration || modulrIntegration.status === 'not_connected') && (
                <div style={{ ...sectionStyle, textAlign: 'center', padding: 24 }}>
                  <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text, #1a1a2e)' }}>
                    Connect your Modulr account to enable 1-click Faster Payments directly from the Payroll page.
                  </p>
                  <button className="admin-btn admin-btn-primary" onClick={() => setShowModulrModal(true)}
                    style={{ fontSize: 14, padding: '10px 24px' }}>
                    Configure Modulr
                  </button>
                </div>
              )}

              <div style={{ ...sectionStyle, background: 'rgba(248,249,255,.5)', marginTop: 16 }}>
                <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: 'var(--text, #333)' }}>How it works</p>
                <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.8, color: 'var(--text, #444)' }}>
                  <li>Bring-your-own-account — connect using your Modulr API credentials</li>
                  <li>Submit batch Faster Payments for processed pay runs with one click</li>
                  <li>Payments are sent from your Modulr virtual account to employee bank accounts</li>
                  <li>Full audit trail of every payout recorded in InflowHR</li>
                  <li>Works alongside any payroll source (InflowHR, Xero, or Sage)</li>
                </ul>
              </div>
            </div>
          )}
        </div>

      </div>

      {/* ── Modulr Configuration Modal ── */}
      {showModulrModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'var(--bg-card, #fff)', borderRadius: 16, padding: 32, maxWidth: 520, width: '90%', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text, #1a1a2e)' }}>Configure Modulr</h3>
              <button onClick={() => setShowModulrModal(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted, #888)' }}>&times;</button>
            </div>

            <div style={{ ...sectionStyle, background: 'rgba(248,249,255,.5)', marginBottom: 20 }}>
              <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: 'var(--text, #333)' }}>Setup Instructions</p>
              <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.8, color: 'var(--text, #444)' }}>
                <li>Log into your Modulr Portal &rarr; Settings &rarr; API Access</li>
                <li>Generate an API Key &amp; HMAC Secret</li>
                <li>Add our static server egress IP address to your Modulr Allowed IP Whitelist</li>
                <li>Paste your credentials below and click &ldquo;Save &amp; Test Connection&rdquo;</li>
              </ol>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={labelStyle}>API Key</label>
                <input
                  type="text"
                  value={modulrApiKey}
                  onChange={e => setModulrApiKey(e.target.value)}
                  placeholder="Enter your Modulr API Key"
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>HMAC Secret</label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={modulrShowSecret ? 'text' : 'password'}
                    value={modulrHmacSecret}
                    onChange={e => setModulrHmacSecret(e.target.value)}
                    placeholder="Enter your HMAC Secret"
                    style={inputStyle}
                  />
                  <button
                    type="button"
                    onClick={() => setModulrShowSecret(!modulrShowSecret)}
                    style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--text-muted, #888)' }}
                  >
                    {modulrShowSecret ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>
              <div>
                <label style={labelStyle}>Source Account ID</label>
                <input
                  type="text"
                  value={modulrSourceAccountId}
                  onChange={e => setModulrSourceAccountId(e.target.value)}
                  placeholder="Modulr Virtual Account / IBAN ID"
                  style={inputStyle}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 24, justifyContent: 'flex-end' }}>
              <button className="admin-btn" onClick={() => setShowModulrModal(false)}>Cancel</button>
              <button
                className="admin-btn admin-btn-primary"
                onClick={connectModulr}
                disabled={modulrConnecting || !modulrApiKey.trim() || !modulrHmacSecret.trim() || !modulrSourceAccountId.trim()}
                style={{ minWidth: 180 }}
              >
                {modulrConnecting ? 'Testing Connection...' : 'Save & Test Connection'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Super Admin: OpenAI Platform Configuration ── */}
      {isSuperAdmin && (
        <>
          <div style={{ marginTop: 32, marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text, #1a1a2e)' }}>
              Platform Configuration
              <span style={{ fontSize: 12, fontWeight: 500, color: '#7c3aed', marginLeft: 8, padding: '2px 8px', background: 'rgba(124,58,237,.1)', borderRadius: 6 }}>Super Admin</span>
            </h3>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted, #8b8fa3)' }}>
              Platform-wide AI service configuration — applies to all companies
            </p>
          </div>

          <div style={cardStyle(true)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer' }}
              onClick={() => setOpenaiExpanded(!openaiExpanded)}>
              <svg width="36" height="36" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="256" cy="256" r="256" fill="#10a37f"/>
                <path d="M380.3 209.7c7.5-22.1 3.1-46.4-11.5-63.8-22-26.1-60.3-35.5-93.1-22.8-17-18.3-41.2-28.1-66.2-26.8-34.2 1.5-63.7 24.2-74.3 56.6-23.3 4.1-43.2 19.5-52.5 41.2-14 32.4-3.6 70.2 25.1 91.6-7.5 22.1-3.1 46.4 11.5 63.8 22 26.1 60.3 35.5 93.1 22.8 17 18.3 41.2 28.1 66.2 26.8 34.2-1.5 63.7-24.2 74.3-56.6 23.3-4.1 43.2-19.5 52.5-41.2 14-32.4 3.6-70.2-25.1-91.6zm-120.9 216c-18 0-35-7.4-47.4-20.5l2.4-1.4 78.7-45.4c4-2.3 6.5-6.6 6.5-11.3V232.5l33.3 19.2v99.8c0 41-33.3 74.2-73.5 74.2zM134.6 365c-9-15.5-12.3-33.6-9.2-51.2l2.4 1.4 78.7 45.4c4 2.3 8.9 2.3 12.9 0l96.1-55.5v38.5l-83.3 48.1c-35.5 20.5-80.9 8.4-97.6-26.7zM118 196.4c9-15.5 23.3-27 40.3-32.2v93.3c0 4.6 2.5 8.9 6.5 11.3l96.1 55.5-33.3 19.2-83.3-48.1c-35.5-20.5-48.8-65.5-26.3-99zM392.4 268.6l-96.1-55.5 33.3-19.2 83.3 48.1c35.5 20.5 48.8 65.6 26.3 99-9 15.5-23.3 27-40.3 32.2v-93.3c0-4.6-2.5-8.9-6.5-11.3zm33.1-51.2l-2.4-1.4-78.7-45.4c-4-2.3-8.9-2.3-12.9 0l-96.1 55.5v-38.5l83.3-48.1c35.5-20.5 80.9-8.4 97.6 26.7 9 15.5 12.3 33.6 9.2 51.2zM222.6 279.5l-33.3-19.2V160.4c0-41 33.3-74.3 73.5-74.3 18 0 35 7.4 47.4 20.5l-2.4 1.4-78.7 45.4c-4 2.3-6.5 6.6-6.5 11.3v114.8zm18.1-39.8l42.8-24.7 42.8 24.7v49.4l-42.8 24.7-42.8-24.7v-49.4z" fill="#fff"/>
              </svg>
              <div style={{ flex: 1 }}>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--text, #1a1a2e)' }}>OpenAI Configuration</h3>
                <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--text-muted, #8b8fa3)' }}>
                  API key and connection status for the AI Help Agent
                </p>
              </div>
              <span className={`admin-badge ${openaiHasDbKey || openaiHasEnvKey ? 'admin-badge-approved' : ''}`}
                style={!(openaiHasDbKey || openaiHasEnvKey) ? { background: 'var(--bg, #f1f5f9)', color: 'var(--text-muted, #64748b)' } : undefined}>
                {openaiHasDbKey || openaiHasEnvKey ? 'Configured' : 'Not Configured'}
              </span>
              <svg viewBox="0 0 24 24" fill="none" stroke="var(--text-muted, #64748b)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={chevronStyle(openaiExpanded)}>
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </div>

            {openaiExpanded && (
              <div style={{ marginTop: 20 }}>
                {/* Current key status */}
                <div style={{ ...sectionStyle, background: openaiHasDbKey ? 'rgba(232,245,233,.5)' : 'rgba(255,248,225,.5)', borderColor: openaiHasDbKey ? '#a5d6a7' : '#ffe0b2' }}>
                  <strong style={{ fontSize: 13, color: openaiHasDbKey ? '#2e7d32' : '#e65100' }}>API Key Status</strong>
                  <div style={{ marginTop: 8, fontSize: 13, color: 'var(--text, #333)' }}>
                    {openaiHasDbKey && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span>Saved key: <code style={{ background: 'var(--bg, #f5f5f5)', padding: '2px 6px', borderRadius: 4 }}>{openaiKeyPreview}</code></span>
                        {openaiKeyUpdatedAt && (
                          <span style={{ color: 'var(--text-muted, #888)', fontSize: 12 }}>
                            Updated: {new Date(openaiKeyUpdatedAt).toLocaleString('en-GB')}
                          </span>
                        )}
                        <button className="admin-btn" style={{ fontSize: 12, padding: '4px 10px' }} onClick={deleteOpenaiKey}>Remove</button>
                      </div>
                    )}
                    {!openaiHasDbKey && openaiHasEnvKey && (
                      <p style={{ margin: 0 }}>Using environment variable (OPENAI_API_KEY). You can override it by saving a key below.</p>
                    )}
                    {!openaiHasDbKey && !openaiHasEnvKey && (
                      <p style={{ margin: 0 }}>No API key configured. Enter your OpenAI API key below to enable the AI Help Agent.</p>
                    )}
                  </div>
                </div>

                {/* API key input */}
                <div style={{ ...sectionStyle, marginTop: 16 }}>
                  <label style={labelStyle}>OpenAI API Key</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type={openaiShowKey ? 'text' : 'password'}
                      value={openaiKey}
                      onChange={e => setOpenaiKey(e.target.value)}
                      placeholder="sk-..."
                      style={inputStyle}
                    />
                    <button
                      type="button"
                      onClick={() => setOpenaiShowKey(!openaiShowKey)}
                      style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--text-muted, #888)' }}
                    >
                      {openaiShowKey ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--text-muted, #888)' }}>
                    Get your API key from <span style={{ fontWeight: 600 }}>platform.openai.com/api-keys</span>
                  </p>

                  <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
                    <button
                      className="admin-btn admin-btn-primary"
                      onClick={saveOpenaiKey}
                      disabled={openaiSaving || !openaiKey.trim()}
                      style={{ minWidth: 120 }}
                    >
                      {openaiSaving ? 'Saving...' : 'Save Key'}
                    </button>
                    <button
                      className="admin-btn"
                      onClick={testOpenaiConnection}
                      disabled={openaiTesting}
                      style={{ minWidth: 160 }}
                    >
                      {openaiTesting ? 'Testing...' : 'Test Connection'}
                    </button>
                  </div>

                  {/* Test result */}
                  {openaiTestResult && (
                    <div style={{
                      marginTop: 12, padding: 12, borderRadius: 8, fontSize: 13,
                      background: openaiTestResult.connected ? 'rgba(232,245,233,.5)' : 'rgba(255,235,238,.5)',
                      border: `1px solid ${openaiTestResult.connected ? '#a5d6a7' : '#ef9a9a'}`,
                      color: openaiTestResult.connected ? '#2e7d32' : '#c62828',
                    }}>
                      {openaiTestResult.connected ? (
                        <div>
                          <strong>Connection successful</strong>
                          <p style={{ margin: '4px 0 0' }}>
                            Model: {openaiTestResult.model} — {openaiTestResult.model_available ? 'Available' : 'Not available'}
                          </p>
                        </div>
                      ) : (
                        <div>
                          <strong>Connection failed</strong>
                          {openaiTestResult.error && <p style={{ margin: '4px 0 0' }}>{openaiTestResult.error}</p>}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Platform-wide usage stats */}
                {openaiPlatformStats && (
                  <div style={{ ...sectionStyle, background: 'rgba(248,249,255,.5)', marginTop: 16 }}>
                    <strong style={{ fontSize: 13, color: '#7c3aed' }}>Platform Usage (All Companies)</strong>
                    <div style={{ display: 'flex', gap: 24, marginTop: 8, flexWrap: 'wrap' }}>
                      <div>
                        <p style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text, #1a1a2e)' }}>{openaiPlatformStats.total}</p>
                        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted, #888)' }}>Total AI Queries</p>
                      </div>
                      <div>
                        <p style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text, #1a1a2e)' }}>{openaiPlatformStats.today}</p>
                        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted, #888)' }}>Today</p>
                      </div>
                      <div>
                        <p style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text, #1a1a2e)' }}>{openaiPlatformStats.companies}</p>
                        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted, #888)' }}>Companies with AI enabled</p>
                      </div>
                      <div>
                        <p style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text, #1a1a2e)' }}>~${(openaiPlatformStats.total * 0.00015).toFixed(2)}</p>
                        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted, #888)' }}>Estimated cost (all time)</p>
                      </div>
                    </div>
                    <p style={{ margin: '12px 0 0', fontSize: 12, color: 'var(--text-muted, #888)' }}>
                      Cost estimate based on GPT-4o Mini at ~$0.00015/query. For actual billing and remaining budget, check your{' '}
                      <span style={{ fontWeight: 600 }}>platform.openai.com/usage</span> dashboard.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
