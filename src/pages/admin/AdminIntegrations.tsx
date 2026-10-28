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

interface InflowOnboarderIntegration {
  company_id: string
  api_key_hint: string
  status: string
  status_detail: Record<string, unknown>
  status_checked_at: string | null
  connected_at: string | null
  approver_mode: 'nominated' | 'manager'
  approver_name: string | null
  approver_email: string | null
  licence_manager_name: string | null
  licence_manager_email: string | null
  licence_sku_id: string | null
  licence_sku_name: string | null
  group_name: string | null
  account_domain: string | null
  settings_updated_at: string | null
  offboard_approver_mode: 'same_as_joiner' | 'nominated' | 'manager'
  offboard_approver_name: string | null
  offboard_approver_email: string | null
  mover_approver_mode: 'same_as_joiner' | 'nominated' | 'manager'
  mover_approver_name: string | null
  mover_approver_email: string | null
}

interface IfoLicence {
  skuId: string
  skuPartNumber: string
  name: string
  total: number
  assigned: number
  available: number
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

function InflowOnboarderLogo() {
  return (
    <svg width="36" height="36" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
      <rect width="512" height="512" rx="64" fill="#0078D4"/>
      <path d="M256 100c-86 0-156 70-156 156s70 156 156 156 156-70 156-156S342 100 256 100zm0 280c-68.5 0-124-55.5-124-124s55.5-124 124-124 124 55.5 124 124-55.5 124-124 124z" fill="#fff"/>
      <path d="M256 180c-42 0-76 34-76 76s34 76 76 76 76-34 76-76-34-76-76-76zm0 120c-24.3 0-44-19.7-44-44s19.7-44 44-44 44 19.7 44 44-19.7 44-44 44z" fill="#fff"/>
      <circle cx="256" cy="256" r="20" fill="#fff"/>
      <rect x="248" y="120" width="16" height="40" rx="8" fill="#fff"/>
      <rect x="248" y="352" width="16" height="40" rx="8" fill="#fff"/>
      <rect x="352" y="248" width="40" height="16" rx="8" fill="#fff"/>
      <rect x="120" y="248" width="40" height="16" rx="8" fill="#fff"/>
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
  // InflowOnboarder state
  const [ifoIntegration, setIfoIntegration] = useState<InflowOnboarderIntegration | null>(null)
  const [ifoExpanded, setIfoExpanded] = useState(false)
  const [ifoApiKey, setIfoApiKey] = useState('')
  const [ifoConnecting, setIfoConnecting] = useState(false)
  const [ifoChecking, setIfoChecking] = useState(false)
  const [ifoLastChecked, setIfoLastChecked] = useState<string | null>(null)
  const [showIfoModal, setShowIfoModal] = useState(false)
  const [ifoSettingsOpen, setIfoSettingsOpen] = useState(false)
  const [ifoSettingsSaving, setIfoSettingsSaving] = useState(false)
  const [ifoApproverMode, setIfoApproverMode] = useState<'manager' | 'nominated'>('manager')
  const [ifoApproverName, setIfoApproverName] = useState('')
  const [ifoApproverEmail, setIfoApproverEmail] = useState('')
  const [ifoLicenceManagerName, setIfoLicenceManagerName] = useState('')
  const [ifoLicenceManagerEmail, setIfoLicenceManagerEmail] = useState('')
  const [ifoLicenceSkuId, setIfoLicenceSkuId] = useState('')
  const [ifoLicenceSkuName, setIfoLicenceSkuName] = useState('')
  const [ifoGroupName, setIfoGroupName] = useState('')
  const [ifoAccountDomain, setIfoAccountDomain] = useState('')
  const [ifoLicences, setIfoLicences] = useState<IfoLicence[]>([])
  const [ifoLicencesLoading, setIfoLicencesLoading] = useState(false)
  const [ifoOffboardSettingsOpen, setIfoOffboardSettingsOpen] = useState(false)
  const [ifoMoverSettingsOpen, setIfoMoverSettingsOpen] = useState(false)
  const [identityProvider, setIdentityProvider] = useState<'entra' | 'google_workspace'>('entra')
  const [ifoOffboardApproverMode, setIfoOffboardApproverMode] = useState<'same_as_joiner' | 'nominated' | 'manager'>('same_as_joiner')
  const [ifoOffboardApproverName, setIfoOffboardApproverName] = useState('')
  const [ifoOffboardApproverEmail, setIfoOffboardApproverEmail] = useState('')
  const [ifoMoverApproverMode, setIfoMoverApproverMode] = useState<'same_as_joiner' | 'nominated' | 'manager'>('same_as_joiner')
  const [ifoMoverApproverName, setIfoMoverApproverName] = useState('')
  const [ifoMoverApproverEmail, setIfoMoverApproverEmail] = useState('')
  const [ifoSchedulingAvailable, setIfoSchedulingAvailable] = useState(false)

  const [modulrApiKey, setModulrApiKey] = useState('')
  const [modulrHmacSecret, setModulrHmacSecret] = useState('')
  const [modulrSourceAccountId, setModulrSourceAccountId] = useState('')
  const [modulrShowSecret, setModulrShowSecret] = useState(false)
  const [modulrConnecting, setModulrConnecting] = useState(false)
  const [showModulrModal, setShowModulrModal] = useState(false)

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

    const [teamsRes, teamsBotRes, xeroRes, sageRes, modulrRes, featuresRes, ifoRes, companyRes] = await Promise.all([
      supabase.from('company_teams_config').select('*').eq('company_id', companyId).maybeSingle(),
      supabase.from('company_teams_bot_conversations').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
      supabase.from('xero_integrations').select('id, company_id, sync_status, sync_error, last_sync_at, payslip_source, sync_benefits_to_xero').eq('company_id', companyId).maybeSingle(),
      supabase.from('sage_integrations').select('id, company_id, sync_status, sync_error, last_sync_at, last_upload_at, last_upload_filename, payslip_source').eq('company_id', companyId).maybeSingle(),
      supabase.from('modulr_integrations').select('id, company_id, source_account_id, status, status_error, connected_at').eq('company_id', companyId).maybeSingle(),
      supabase.from('company_features').select('feature_key, is_enabled').eq('company_id', companyId),
      supabase.from('inflowonboarder_integrations').select('company_id, api_key_hint, status, status_detail, status_checked_at, connected_at, approver_mode, approver_name, approver_email, licence_manager_name, licence_manager_email, licence_sku_id, licence_sku_name, group_name, account_domain, settings_updated_at, offboard_approver_mode, offboard_approver_name, offboard_approver_email, mover_approver_mode, mover_approver_name, mover_approver_email, schedule_templates_cache').eq('company_id', companyId).maybeSingle(),
      supabase.from('companies').select('identity_provider').eq('id', companyId).single(),
    ])
    if (companyRes.data?.identity_provider) setIdentityProvider(companyRes.data.identity_provider as 'entra' | 'google_workspace')

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
    const ifoData = ifoRes.data as InflowOnboarderIntegration | null
    setIfoIntegration(ifoData)
    if (ifoData) {
      setIfoApproverMode(ifoData.approver_mode || 'manager')
      setIfoApproverName(ifoData.approver_name || '')
      setIfoApproverEmail(ifoData.approver_email || '')
      setIfoLicenceManagerName(ifoData.licence_manager_name || '')
      setIfoLicenceManagerEmail(ifoData.licence_manager_email || '')
      setIfoLicenceSkuId(ifoData.licence_sku_id || '')
      setIfoLicenceSkuName(ifoData.licence_sku_name || '')
      setIfoGroupName(ifoData.group_name || '')
      setIfoAccountDomain(ifoData.account_domain || '')
      setIfoOffboardApproverMode(ifoData.offboard_approver_mode || 'same_as_joiner')
      setIfoOffboardApproverName(ifoData.offboard_approver_name || '')
      setIfoOffboardApproverEmail(ifoData.offboard_approver_email || '')
      setIfoMoverApproverMode((ifoData as any).mover_approver_mode || 'same_as_joiner')
      setIfoMoverApproverName((ifoData as any).mover_approver_name || '')
      setIfoMoverApproverEmail((ifoData as any).mover_approver_email || '')
      const templates = Array.isArray((ifoData as any).schedule_templates_cache) ? (ifoData as any).schedule_templates_cache : []
      const hasScheduleTemplates = templates.some((t: any) => t.id === 'hr.joiner' || t.templateId === 'hr.joiner') || templates.some((t: any) => t.id === 'hr.leaver' || t.templateId === 'hr.leaver')
      setIfoSchedulingAvailable(hasScheduleTemplates)
    }

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
    setIfoExpanded(false)
    setIfoSettingsOpen(false)
    setIfoLicences([])
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

  // ── InflowOnboarder handlers ───────────────────────────────────────────────

  async function connectInflowOnboarder() {
    if (!companyId || !ifoApiKey.trim()) { showError('API key is required'); return }
    if (!ifoApiKey.trim().startsWith('ifo_')) { showError('Invalid API key format. Keys start with ifo_'); return }
    setIfoConnecting(true)
    const result = await callEdgeFunction('inflowonboarder', { action: 'connect', api_key: ifoApiKey.trim() })
    setIfoConnecting(false)
    if (result) {
      if (result.status === 'connected_ready') {
        showSuccess('InflowOnboarder connected — M365 ready')
      } else if (result.status === 'connected_not_ready') {
        showSuccess('InflowOnboarder connected, but M365 is not fully ready. Check your InflowOnboarder dashboard.')
      } else if (result.status === 'needs_attention') {
        showError(result.error || 'Connection needs attention')
      }
      setShowIfoModal(false)
      setIfoApiKey('')
      loadAll()
    }
  }

  async function checkIfoStatus() {
    if (!companyId) return
    setIfoChecking(true)
    const result = await callEdgeFunction('inflowonboarder', { action: 'check-status' })
    setIfoChecking(false)
    if (result) {
      if (result.status === 'connected_ready') {
        showSuccess('M365 connection healthy')
        setIfoLastChecked(new Date().toISOString())
      } else if (result.status === 'needs_attention') showError('API key revoked or invalid — reconnect with a new key')
      else if (result.unavailable) showError('InflowOnboarder is temporarily unavailable')
      if (result.schedule_templates_available !== undefined) {
        setIfoSchedulingAvailable(result.schedule_templates_available)
      }
      loadAll()
    }
  }

  async function disconnectInflowOnboarder() {
    if (!confirm('Disconnect InflowOnboarder? This will remove the API key. Pending M365 actions on in-progress onboardings will stop working.')) return
    if (!companyId) return
    const result = await callEdgeFunction('inflowonboarder', { action: 'disconnect' })
    if (result) {
      setIfoIntegration(null)
      showSuccess('InflowOnboarder disconnected')
      loadAll()
    }
  }

  async function saveIfoSettings() {
    if (!companyId) return
    if (ifoApproverMode === 'nominated' && (!ifoApproverName.trim() || !ifoApproverEmail.trim())) {
      showError('Nominated joiner approver requires a name and email')
      return
    }
    if (ifoOffboardApproverMode === 'nominated' && (!ifoOffboardApproverName.trim() || !ifoOffboardApproverEmail.trim())) {
      showError('Nominated offboarding approver requires a name and email')
      return
    }
    if (ifoMoverApproverMode === 'nominated' && (!ifoMoverApproverName.trim() || !ifoMoverApproverEmail.trim())) {
      showError('Nominated mover approver requires a name and email')
      return
    }
    setIfoSettingsSaving(true)
    const result = await callEdgeFunction('inflowonboarder', {
      action: 'save-settings',
      approver_mode: ifoApproverMode,
      approver_name: ifoApproverMode === 'nominated' ? ifoApproverName.trim() : null,
      approver_email: ifoApproverMode === 'nominated' ? ifoApproverEmail.trim() : null,
      licence_manager_name: ifoLicenceManagerName.trim() || null,
      licence_manager_email: ifoLicenceManagerEmail.trim() || null,
      licence_sku_id: ifoLicenceSkuId || null,
      licence_sku_name: ifoLicenceSkuName || null,
      group_name: ifoGroupName.trim() || null,
      account_domain: ifoAccountDomain.trim() || null,
      offboard_approver_mode: ifoOffboardApproverMode,
      offboard_approver_name: ifoOffboardApproverMode === 'nominated' ? ifoOffboardApproverName.trim() : null,
      offboard_approver_email: ifoOffboardApproverMode === 'nominated' ? ifoOffboardApproverEmail.trim() : null,
      mover_approver_mode: ifoMoverApproverMode,
      mover_approver_name: ifoMoverApproverMode === 'nominated' ? ifoMoverApproverName.trim() : null,
      mover_approver_email: ifoMoverApproverMode === 'nominated' ? ifoMoverApproverEmail.trim() : null,
    })
    setIfoSettingsSaving(false)
    if (result?.saved) {
      showSuccess('Onboarding settings saved')
      loadAll()
    }
  }

  async function loadIfoLicences() {
    if (!companyId) return
    setIfoLicencesLoading(true)
    const result = await callEdgeFunction('inflowonboarder', { action: 'list-licences' })
    setIfoLicencesLoading(false)
    const licences = result?.result?.licences || (Array.isArray(result?.result) ? result.result : null)
    if (licences) {
      setIfoLicences(licences)
    } else if (result?.status === 'running') {
      showError('Licences are still loading. Try again in a few seconds.')
    } else if (result?.error) {
      showError(result.error)
    } else {
      showError('Could not load licences. Check the API key has the m365.license.list permission.')
    }
  }

  function ifoStatusBadge(status: string) {
    if (status === 'connected_ready') return <span className="admin-badge admin-badge-approved">Connected</span>
    if (status === 'connected_not_ready') return <span className="admin-badge admin-badge-pending">M365 Not Ready</span>
    if (status === 'needs_attention') return <span className="admin-badge admin-badge-rejected">Needs Attention</span>
    return <span className="admin-badge" style={{ background: 'var(--bg, #f1f5f9)', color: 'var(--text-muted, #64748b)' }}>Not Connected</span>
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
                <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.9, color: 'var(--text, #444)' }}>
                  <li><strong>Employee asks a question</strong> — e.g. "How many days leave did I take in December?"</li>
                  <li><strong>FAQ search runs first</strong> — if an article matches, it's shown instantly (free, no AI cost)</li>
                  <li><strong>AI analyses the question</strong> — only the question text and your FAQ articles are sent to the AI. It decides whether to answer from policy or look up personal data</li>
                  <li><strong>Personal data queries run locally</strong> — if the AI identifies it's a personal question (leave, pay, shifts, etc.), the actual data lookup runs entirely inside your Supabase database. No personal data ever leaves the platform</li>
                  <li><strong>Answer appears in chat</strong> — the employee sees the result in the same chat bubble. Seamless experience with no "AI generated" labels</li>
                </ol>
              </div>

              <div style={{ ...sectionStyle, background: 'rgba(248,249,255,.5)', marginTop: 16 }}>
                <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: 'var(--text, #333)' }}>Supported personal data queries</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                  {['Leave balance', 'Leave requests by date', 'Expense claims', 'Upcoming shifts', 'Hours worked', 'Payslip summary', 'My profile & manager', 'Benefits', 'E-learning progress', 'Company holidays'].map(t => (
                    <span key={t} style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 12, fontSize: 12, background: 'rgba(124,58,237,.08)', color: '#7c3aed', fontWeight: 500 }}>{t}</span>
                  ))}
                </div>
              </div>

              <div style={{ ...sectionStyle, background: 'rgba(255,248,225,.5)', borderColor: '#ffe0b2', marginTop: 16 }}>
                <p style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 600, color: '#e65100' }}>🔒 GDPR &amp; Data Privacy</p>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.8, color: 'var(--text, #444)' }}>
                  <li><strong>No personal data leaves the platform</strong> — employee names, leave balances, payslips, shift data and all other personal information stay entirely within your Supabase database in the UK/EU</li>
                  <li><strong>Only the question text and FAQ articles are sent externally</strong> — the AI receives the employee's question and your company's published help articles, nothing else</li>
                  <li><strong>Personal data queries execute locally</strong> — when the AI identifies a personal question, it returns a data tool instruction. The actual database lookup happens inside your platform, not on AI servers</li>
                  <li><strong>Rate limited</strong> — 20 AI queries per employee per day to control costs and usage</li>
                  <li><strong>One API call per question</strong> — same cost whether it's a policy answer or a personal data lookup</li>
                  <li><strong>Search analytics</strong> — track AI vs FAQ responses separately in Admin &gt; Employee Help</li>
                </ul>
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

        {/* ── InflowOnboarder Card ── */}
        {identityProvider === 'google_workspace' ? (
          <div style={{ ...cardStyle(true), opacity: 0.55, pointerEvents: 'none', position: 'relative' }}>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10, borderRadius: 16 }}>
              <span style={{ background: '#f59e0b', color: '#fff', padding: '8px 20px', borderRadius: 8, fontSize: 14, fontWeight: 600, boxShadow: '0 2px 8px rgba(0,0,0,.15)' }}>
                Not available — Google Workspace identity provider
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
              <InflowOnboarderLogo />
              <div>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--text, #1a1a2e)' }}>InflowOnboarder</h3>
                <p style={{ margin: '4px 0 0', fontSize: 13, color: '#888' }}>Microsoft 365 provisioning &amp; licence management</p>
              </div>
            </div>
          </div>
        ) : (
        <div style={{ ...cardStyle(true), position: 'relative', opacity: features.inflowonboarder_integration ? 1 : 0.55, pointerEvents: features.inflowonboarder_integration ? 'auto' : 'none' }}>
          {!features.inflowonboarder_integration && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10, pointerEvents: 'auto', borderRadius: 16 }}>
              <span style={{ background: '#0078D4', color: '#fff', padding: '8px 20px', borderRadius: 8, fontSize: 14, fontWeight: 600, boxShadow: '0 2px 8px rgba(0,0,0,.15)' }}>
                Add-on subscription required
              </span>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer' }}
            onClick={() => setIfoExpanded(!ifoExpanded)}>
            <InflowOnboarderLogo />
            <div style={{ flex: 1 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--text, #1a1a2e)' }}>InflowOnboarder</h3>
              <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--text-muted, #8b8fa3)' }}>
                Automate Microsoft 365 account provisioning during onboarding
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {ifoStatusBadge(ifoIntegration?.status || 'not_connected')}
              {features.m365_scheduling && ifoSchedulingAvailable && ifoIntegration?.status === 'connected_ready' && (
                <span style={{ fontSize: 11, fontWeight: 600, color: '#2e7d32', background: 'rgba(46,125,50,.1)', padding: '3px 10px', borderRadius: 6 }}>Scheduling</span>
              )}
            </div>
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--text-muted, #64748b)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={chevronStyle(ifoExpanded)}>
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </div>

          {ifoExpanded && (
            <div style={{ marginTop: 20 }}>
              {ifoIntegration?.status === 'connected_ready' && features.m365_scheduling && !ifoSchedulingAvailable && (
                <div style={{ ...sectionStyle, background: 'rgba(255,243,224,.6)', borderColor: '#ffcc80', marginBottom: 16 }}>
                  <p style={{ margin: 0, fontSize: 13, color: '#e65100', lineHeight: 1.5 }}>
                    <strong>Scheduling not available</strong> — To schedule joiners and leavers, the InflowOnboarder key needs the &lsquo;Schedule new joiners&rsquo; and &lsquo;Schedule leavers&rsquo; permissions. Create a new key with these scopes (<code style={{ fontSize: 12 }}>m365.joiner, m365.leaver, m365.license.list, hr.joiner, hr.leaver</code>), keep approvals as &lsquo;Approved in this service&rsquo;, and paste it here.
                  </p>
                </div>
              )}
              {ifoIntegration?.status === 'connected_ready' && (
                <div style={{ ...sectionStyle, background: 'rgba(232,245,233,.5)', borderColor: '#a5d6a7' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                    <div>
                      <strong style={{ fontSize: 13, color: '#2e7d32' }}>Connected to InflowOnboarder</strong>
                      {ifoIntegration.connected_at && (
                        <p style={{ margin: '2px 0 0', fontSize: 12, color: '#4caf50' }}>
                          Connected: {new Date(ifoIntegration.connected_at).toLocaleString('en-GB')}
                        </p>
                      )}
                      <p style={{ margin: '2px 0 0', fontSize: 12, color: '#666' }}>
                        API Key: ifo_…{ifoIntegration.api_key_hint}
                      </p>
                      {ifoLastChecked && (
                        <p style={{ margin: '2px 0 0', fontSize: 12, color: '#2e7d32', fontWeight: 600 }}>
                          ✓ Connection verified: {new Date(ifoLastChecked).toLocaleString('en-GB')}
                        </p>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="admin-btn" onClick={checkIfoStatus} disabled={ifoChecking}>
                        {ifoChecking ? 'Checking...' : 'Re-check Status'}
                      </button>
                      <button className="admin-btn admin-btn-primary" onClick={() => setShowIfoModal(true)}>Reconnect</button>
                      {canDisconnect && <button className="admin-btn" onClick={disconnectInflowOnboarder}>Disconnect</button>}
                    </div>
                  </div>
                </div>
              )}

              {ifoIntegration?.status === 'connected_ready' && (
                <div style={{ ...sectionStyle, marginTop: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
                    onClick={() => setIfoSettingsOpen(!ifoSettingsOpen)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <strong style={{ fontSize: 14, color: 'var(--text, #1a1a2e)' }}>Onboarding Settings</strong>
                      {!ifoIntegration.account_domain && (
                        <span style={{ fontSize: 11, color: '#e65100', background: 'rgba(255,152,0,.12)', padding: '2px 8px', borderRadius: 6, fontWeight: 600 }}>
                          Settings incomplete
                        </span>
                      )}
                      {ifoIntegration.settings_updated_at && (
                        <span style={{ fontSize: 11, color: 'var(--text-muted, #888)' }}>
                          Last saved: {new Date(ifoIntegration.settings_updated_at).toLocaleString('en-GB')}
                        </span>
                      )}
                    </div>
                    <svg viewBox="0 0 24 24" fill="none" stroke="var(--text-muted, #64748b)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={chevronStyle(ifoSettingsOpen)}>
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </div>

                  {ifoSettingsOpen && (
                    <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 18 }}>

                      {/* Approver */}
                      <div>
                        <label style={{ ...labelStyle, marginBottom: 8, display: 'block' }}>Provisioning Approver</label>
                        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', color: 'var(--text, #333)' }}>
                            <input type="radio" name="ifo-approver" checked={ifoApproverMode === 'manager'} onChange={() => setIfoApproverMode('manager')} />
                            Joiner&rsquo;s manager
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', color: 'var(--text, #333)' }}>
                            <input type="radio" name="ifo-approver" checked={ifoApproverMode === 'nominated'} onChange={() => setIfoApproverMode('nominated')} />
                            Nominated person
                          </label>
                        </div>
                        {ifoApproverMode === 'nominated' && (
                          <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
                            <input value={ifoApproverName} onChange={e => setIfoApproverName(e.target.value)} placeholder="Approver name" style={{ ...inputStyle, flex: 1, minWidth: 160 }} />
                            <input value={ifoApproverEmail} onChange={e => setIfoApproverEmail(e.target.value)} placeholder="Approver email" style={{ ...inputStyle, flex: 1, minWidth: 200 }} />
                          </div>
                        )}
                        <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text-muted, #888)' }}>
                          This person must approve each M365 provisioning before the account is created.
                        </p>
                      </div>

                      {/* Licence manager */}
                      <div>
                        <label style={{ ...labelStyle, marginBottom: 6, display: 'block' }}>Licence Manager (notified when seats run out)</label>
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                          <input value={ifoLicenceManagerName} onChange={e => setIfoLicenceManagerName(e.target.value)} placeholder="Name" style={{ ...inputStyle, flex: 1, minWidth: 160 }} />
                          <input value={ifoLicenceManagerEmail} onChange={e => setIfoLicenceManagerEmail(e.target.value)} placeholder="Email" style={{ ...inputStyle, flex: 1, minWidth: 200 }} />
                        </div>
                      </div>

                      {/* Licence type */}
                      <div>
                        <label style={{ ...labelStyle, marginBottom: 6, display: 'block' }}>Default Licence Type</label>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                          <select
                            value={ifoLicenceSkuId}
                            onChange={e => {
                              const sku = ifoLicences.find(l => l.skuId === e.target.value)
                              setIfoLicenceSkuId(e.target.value)
                              setIfoLicenceSkuName(sku?.name || '')
                            }}
                            style={{ ...inputStyle, flex: 1, minWidth: 200, fontFamily: 'inherit' }}
                          >
                            <option value="">— Select a licence —</option>
                            {ifoLicences.map(l => (
                              <option key={l.skuId} value={l.skuId}>
                                {l.name} ({l.available} available of {l.total})
                              </option>
                            ))}
                            {ifoLicenceSkuId && !ifoLicences.find(l => l.skuId === ifoLicenceSkuId) && (
                              <option value={ifoLicenceSkuId}>{ifoLicenceSkuName || ifoLicenceSkuId} (saved)</option>
                            )}
                          </select>
                          <button className="admin-btn" onClick={loadIfoLicences} disabled={ifoLicencesLoading} style={{ whiteSpace: 'nowrap' }}>
                            {ifoLicencesLoading ? 'Loading...' : 'Load Licences'}
                          </button>
                        </div>
                        <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text-muted, #888)' }}>
                          The licence assigned to each new joiner. Click &ldquo;Load Licences&rdquo; to refresh from M365.
                        </p>
                      </div>

                      {/* Group + Domain */}
                      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: 200 }}>
                          <label style={{ ...labelStyle, marginBottom: 6, display: 'block' }}>New Joiner Group</label>
                          <input value={ifoGroupName} onChange={e => setIfoGroupName(e.target.value)} placeholder="e.g. All Staff" style={inputStyle} />
                          <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text-muted, #888)' }}>
                            M365 group to add each new account to (optional).
                          </p>
                        </div>
                        <div style={{ flex: 1, minWidth: 200 }}>
                          <label style={{ ...labelStyle, marginBottom: 6, display: 'block' }}>Account Domain</label>
                          <input value={ifoAccountDomain} onChange={e => setIfoAccountDomain(e.target.value)} placeholder="e.g. contoso.com" style={inputStyle} />
                          <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text-muted, #888)' }}>
                            Domain for new account email addresses.
                          </p>
                        </div>
                      </div>

                      {/* Save button */}
                      <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 4 }}>
                        <button
                          className="admin-btn admin-btn-primary"
                          onClick={saveIfoSettings}
                          disabled={ifoSettingsSaving}
                          style={{ minWidth: 160, background: '#0078D4' }}
                        >
                          {ifoSettingsSaving ? 'Saving...' : 'Save Settings'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {ifoIntegration?.status === 'connected_ready' && (
                <div style={{ ...sectionStyle, marginTop: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
                    onClick={() => setIfoOffboardSettingsOpen(!ifoOffboardSettingsOpen)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <strong style={{ fontSize: 14, color: 'var(--text, #1a1a2e)' }}>Offboarding Settings</strong>
                    </div>
                    <svg viewBox="0 0 24 24" fill="none" stroke="var(--text-muted, #64748b)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={chevronStyle(ifoOffboardSettingsOpen)}>
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </div>

                  {ifoOffboardSettingsOpen && (
                    <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 18 }}>

                      {/* Offboarding Approver */}
                      <div>
                        <label style={{ ...labelStyle, marginBottom: 8, display: 'block' }}>Offboarding Approver</label>
                        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', color: 'var(--text, #333)' }}>
                            <input type="radio" name="ifo-offboard-approver" checked={ifoOffboardApproverMode === 'same_as_joiner'} onChange={() => setIfoOffboardApproverMode('same_as_joiner')} />
                            Same as joiner approver
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', color: 'var(--text, #333)' }}>
                            <input type="radio" name="ifo-offboard-approver" checked={ifoOffboardApproverMode === 'manager'} onChange={() => setIfoOffboardApproverMode('manager')} />
                            Leaver&rsquo;s manager
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', color: 'var(--text, #333)' }}>
                            <input type="radio" name="ifo-offboard-approver" checked={ifoOffboardApproverMode === 'nominated'} onChange={() => setIfoOffboardApproverMode('nominated')} />
                            Nominated person
                          </label>
                        </div>
                        {ifoOffboardApproverMode === 'nominated' && (
                          <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
                            <input value={ifoOffboardApproverName} onChange={e => setIfoOffboardApproverName(e.target.value)} placeholder="Approver name" style={{ ...inputStyle, flex: 1, minWidth: 160 }} />
                            <input value={ifoOffboardApproverEmail} onChange={e => setIfoOffboardApproverEmail(e.target.value)} placeholder="Approver email" style={{ ...inputStyle, flex: 1, minWidth: 200 }} />
                          </div>
                        )}
                        <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text-muted, #888)' }}>
                          This person must approve each M365 offboarding before sign-in is blocked and groups/licences are removed.
                        </p>
                      </div>

                      {/* Save button */}
                      <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 4 }}>
                        <button
                          className="admin-btn admin-btn-primary"
                          onClick={saveIfoSettings}
                          disabled={ifoSettingsSaving}
                          style={{ minWidth: 160, background: '#0078D4' }}
                        >
                          {ifoSettingsSaving ? 'Saving...' : 'Save Settings'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {ifoIntegration?.status === 'connected_ready' && (
                <div style={{ ...sectionStyle, marginTop: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
                    onClick={() => setIfoMoverSettingsOpen(!ifoMoverSettingsOpen)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <strong style={{ fontSize: 14, color: 'var(--text, #1a1a2e)' }}>Movers Settings</strong>
                    </div>
                    <svg viewBox="0 0 24 24" fill="none" stroke="var(--text-muted, #64748b)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={chevronStyle(ifoMoverSettingsOpen)}>
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </div>

                  {ifoMoverSettingsOpen && (
                    <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 18 }}>

                      {/* Mover Approver */}
                      <div>
                        <label style={{ ...labelStyle, marginBottom: 8, display: 'block' }}>Mover Approver</label>
                        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', color: 'var(--text, #333)' }}>
                            <input type="radio" name="ifo-mover-approver" checked={ifoMoverApproverMode === 'same_as_joiner'} onChange={() => setIfoMoverApproverMode('same_as_joiner')} />
                            Same as joiner approver
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', color: 'var(--text, #333)' }}>
                            <input type="radio" name="ifo-mover-approver" checked={ifoMoverApproverMode === 'manager'} onChange={() => setIfoMoverApproverMode('manager')} />
                            Employee&rsquo;s manager
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', color: 'var(--text, #333)' }}>
                            <input type="radio" name="ifo-mover-approver" checked={ifoMoverApproverMode === 'nominated'} onChange={() => setIfoMoverApproverMode('nominated')} />
                            Nominated person
                          </label>
                        </div>
                        {ifoMoverApproverMode === 'nominated' && (
                          <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
                            <input value={ifoMoverApproverName} onChange={e => setIfoMoverApproverName(e.target.value)} placeholder="Approver name" style={{ ...inputStyle, flex: 1, minWidth: 160 }} />
                            <input value={ifoMoverApproverEmail} onChange={e => setIfoMoverApproverEmail(e.target.value)} placeholder="Approver email" style={{ ...inputStyle, flex: 1, minWidth: 200 }} />
                          </div>
                        )}
                        <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text-muted, #888)' }}>
                          This person must approve each M365 mover update before profile, licence, and group changes are applied.
                        </p>
                      </div>

                      {/* Persona packs — configured in the engine */}
                      <div style={{ background: 'rgba(230,81,0,.06)', borderRadius: 8, padding: '10px 14px' }}>
                        <p style={{ margin: 0, fontSize: 12, color: 'var(--text, #333)' }}>
                          <strong>Persona packs:</strong> Personas are configured in InflowOnboarder
                          (Templates &rsaquo; Persona packs). InflowHR shows the personas that are
                          enabled and ready there.
                        </p>
                      </div>

                      {/* Scope note */}
                      <div style={{ background: 'rgba(0,120,212,.06)', borderRadius: 8, padding: '10px 14px' }}>
                        <p style={{ margin: 0, fontSize: 12, color: 'var(--text, #333)' }}>
                          <strong>API key scope:</strong> The API key needs <strong>m365.mover</strong> scope.
                          Scopes cannot be added to an existing key &mdash; create a new key in InflowOnboarder with
                          all required scopes, with approvals set to &ldquo;Approved in this service&rdquo;.
                        </p>
                      </div>

                      {/* Save button */}
                      <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 4 }}>
                        <button
                          className="admin-btn admin-btn-primary"
                          onClick={saveIfoSettings}
                          disabled={ifoSettingsSaving}
                          style={{ minWidth: 160, background: '#e65100' }}
                        >
                          {ifoSettingsSaving ? 'Saving...' : 'Save Settings'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* General InflowOnboarder notes */}
              {ifoIntegration?.status === 'connected_ready' && (
                <div style={{ ...sectionStyle, marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ background: 'rgba(0,120,212,.06)', borderRadius: 8, padding: '10px 14px' }}>
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--text, #333)' }}>
                      <strong>API key scope:</strong> The API key needs <strong>m365.joiner</strong>, <strong>m365.leaver</strong>,
                      <strong> m365.mover</strong>, and <strong>m365.license.list</strong> scopes.
                      Scopes cannot be added to an existing key &mdash; create a new key in InflowOnboarder with
                      all required scopes, with approvals set to &ldquo;Approved in this service&rdquo;.
                    </p>
                  </div>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted, #888)' }}>
                    Protected accounts (e.g. emergency admin accounts) are managed in InflowOnboarder&rsquo;s own Settings, not here.
                  </p>
                </div>
              )}

              {ifoIntegration?.status === 'connected_not_ready' && (
                <div style={{ ...sectionStyle, background: 'rgba(255,248,225,.5)', borderColor: '#ffe0b2' }}>
                  <strong style={{ fontSize: 13, color: '#e65100' }}>M365 Not Fully Ready</strong>
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: '#e65100' }}>
                    The API key is valid but Microsoft 365 read/write connections are not both healthy. Check your InflowOnboarder dashboard.
                  </p>
                  <p style={{ margin: '2px 0 0', fontSize: 12, color: '#666' }}>
                    API Key: ifo_…{ifoIntegration.api_key_hint}
                  </p>
                  <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                    <button className="admin-btn" onClick={checkIfoStatus} disabled={ifoChecking}>
                      {ifoChecking ? 'Checking...' : 'Re-check Status'}
                    </button>
                    <button className="admin-btn admin-btn-primary" onClick={() => setShowIfoModal(true)}>Reconnect</button>
                    {canDisconnect && <button className="admin-btn" onClick={disconnectInflowOnboarder}>Remove</button>}
                  </div>
                </div>
              )}

              {ifoIntegration?.status === 'needs_attention' && (
                <div style={{ ...sectionStyle, background: 'rgba(255,235,238,.5)', borderColor: '#ef9a9a' }}>
                  <strong style={{ fontSize: 13, color: '#c62828' }}>Needs Attention</strong>
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: '#c62828' }}>
                    Your API key is invalid or has been revoked. Reconnect with a new key.
                  </p>
                  <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                    <button className="admin-btn admin-btn-primary" onClick={() => setShowIfoModal(true)}>Reconnect</button>
                    {canDisconnect && <button className="admin-btn" onClick={disconnectInflowOnboarder}>Remove</button>}
                  </div>
                </div>
              )}

              {(!ifoIntegration || ifoIntegration.status === 'not_connected') && (
                <div style={{ ...sectionStyle, textAlign: 'center', padding: 24 }}>
                  <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text, #1a1a2e)' }}>
                    Connect your InflowOnboarder account to automate Microsoft 365 account creation and licence assignment during onboarding.
                  </p>
                  <button className="admin-btn admin-btn-primary" onClick={() => setShowIfoModal(true)}
                    style={{ fontSize: 14, padding: '10px 24px', background: '#0078D4' }}>
                    Configure InflowOnboarder
                  </button>
                </div>
              )}

              <div style={{ ...sectionStyle, background: 'rgba(248,249,255,.5)', marginTop: 16 }}>
                <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: 'var(--text, #333)' }}>How it works</p>
                <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.8, color: 'var(--text, #444)' }}>
                  <li>Connect using an API key from your InflowOnboarder dashboard</li>
                  <li>Configure onboarding settings: approver, licence type, group and domain</li>
                  <li>When onboarding reaches the &ldquo;Create Accounts &amp; Licences&rdquo; step, start a workflow run</li>
                  <li>The engine checks licence availability, then waits for approval in InflowHR</li>
                  <li>Once approved, the account is created, licensed and added to the group automatically</li>
                  <li>Full audit trail of every provisioning action in InflowHR</li>
                </ul>
              </div>
            </div>
          )}
        </div>
        )}

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

      {/* ── InflowOnboarder Configuration Modal ── */}
      {showIfoModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'var(--bg-card, #fff)', borderRadius: 16, padding: 32, maxWidth: 520, width: '90%', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text, #1a1a2e)' }}>Configure InflowOnboarder</h3>
              <button onClick={() => setShowIfoModal(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted, #888)' }}>&times;</button>
            </div>

            <div style={{ ...sectionStyle, background: 'rgba(248,249,255,.5)', marginBottom: 20 }}>
              <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: 'var(--text, #333)' }}>Setup Instructions</p>
              <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.8, color: 'var(--text, #444)' }}>
                <li>Log into your InflowOnboarder dashboard</li>
                <li>Go to Settings &rarr; API Keys &rarr; Generate Key</li>
                <li>Copy the key (starts with <code style={{ background: '#f1f5f9', padding: '1px 4px', borderRadius: 3 }}>ifo_</code>)</li>
                <li>Paste it below and click &ldquo;Save &amp; Test Connection&rdquo;</li>
              </ol>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={labelStyle}>API Key</label>
                <input
                  type="password"
                  value={ifoApiKey}
                  onChange={e => setIfoApiKey(e.target.value)}
                  placeholder="ifo_xxxx_xxxxxxxxxxxxxxxxxxxx"
                  style={inputStyle}
                />
                <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text-muted, #888)' }}>
                  The full key is encrypted at rest. Only the last 4 characters are stored for reference.
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 24, justifyContent: 'flex-end' }}>
              <button className="admin-btn" onClick={() => setShowIfoModal(false)}>Cancel</button>
              <button
                className="admin-btn admin-btn-primary"
                onClick={connectInflowOnboarder}
                disabled={ifoConnecting || !ifoApiKey.trim()}
                style={{ minWidth: 180, background: '#0078D4' }}
              >
                {ifoConnecting ? 'Testing Connection...' : 'Save & Test Connection'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
