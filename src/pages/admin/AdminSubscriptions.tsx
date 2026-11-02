import { useState, useEffect, useCallback } from 'react'
import { supabase, callRpcDirect } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { formatCurrency, currencySymbol } from '../../lib/formatters'
import { isWithinGracePeriod, gracePeriodRemaining, formatUKDate, type FeatureChangeLog } from '../../lib/billingCalculations'
import AdminCompanies from './AdminCompanies'
import AdminTrialRequests from './AdminTrialRequests'
import AdminSupportAccess from './AdminSupportAccess'
import AdminAuditLog from './AdminAuditLog'

interface PricingItem {
  id: string
  feature_key: string
  display_name: string
  description: string
  default_price: number
  is_addon: boolean
  is_active: boolean
  pack: string | null
  is_support_package: boolean
  flat_price: number | null
  support_type: 'launch' | 'monthly' | null
}

interface CompanyOption {
  id: string
  name: string
  billing_type: string
  fixed_annual_price: number | null
  billing_type_locked_until: string | null
  fy_start_month: number
  dashboard_style: string
  monthly_platform_fee: number
}

interface CompanyFeature {
  id: string
  company_id: string
  feature_key: string
  is_enabled: boolean
  custom_price: number | null
  activated_at: string | null
  deactivated_at: string | null
  grace_period_ends_at: string | null
  cancellation_scheduled: boolean
  cancellation_effective_date: string | null
  created_at: string
  monthly_query_limit: number | null
  monthly_queries_used: number | null
  monthly_tokens_used: number | null
  usage_period_start: string | null
}

const CORE_FEATURES = [
  'Leave', 'Performance', 'E-Learning', 'Expenses', 'Onboarding/Offboarding',
  'Payroll / Xero / Sage', 'Kudos', 'Announcements & Notifications',
  'Benefits', 'GDPR Document Storage', 'Timesheets', 'HR Tickets', 'Email Notifications',
  'Surveys & Feedback',
]

const PACK_A_FEATURE_KEYS = ['shifts', 'legal_timesheets', 'space_booking', 'asset_management']
const PACK_B_FEATURE_KEYS = ['teams_integration', 'skills_passport', 'modulr_integration', 'ai_help_agent']

const PACK_A_LABELS = ['Shifts & Rotas', 'Legal Timesheets', 'Space & Desk Booking', 'Asset Management']
const PACK_B_LABELS = ['Teams & Presence', 'Skills Passport & Talent Intelligence', 'Modulr Payments & BACS Export', 'AI Help Agent']

export default function AdminSubscriptions() {
  const { isSuperAdmin, company } = useAuth()
  const currency = company?.currency || 'GBP'
  const { showSuccess, showError } = useToast()
  const [tab, setTab] = useState<'pricing' | 'features' | 'companies' | 'trial-requests' | 'support-access' | 'audit-log'>('pricing')

  // Pricing state
  const [pricing, setPricing] = useState<PricingItem[]>([])
  const [pricingLoading, setPricingLoading] = useState(true)
  const [editPrices, setEditPrices] = useState<Record<string, string>>({})
  const [editFlatPrices, setEditFlatPrices] = useState<Record<string, string>>({})
  const [savingPricing, setSavingPricing] = useState<string | null>(null)

  // Company features state
  const [companies, setCompanies] = useState<CompanyOption[]>([])
  const [selectedCompanyId, setSelectedCompanyId] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [employeeCount, setEmployeeCount] = useState(0)
  const [companyFeatures, setCompanyFeatures] = useState<CompanyFeature[]>([])
  const [featuresLoading, setFeaturesLoading] = useState(false)
  const [customPrices, setCustomPrices] = useState<Record<string, string>>({})
  const [savedPrices, setSavedPrices] = useState<Record<string, string>>({})
  const [savingFeature, setSavingFeature] = useState<string | null>(null)
  const [savingAllPrices, setSavingAllPrices] = useState(false)

  // Billing type state
  const [billingType, setBillingType] = useState<'monthly' | 'fixed'>('monthly')
  const [fixedAnnualPrice, setFixedAnnualPrice] = useState('')
  const [billingTypeLocked, setBillingTypeLocked] = useState<string | null>(null)
  const [savedBillingType, setSavedBillingType] = useState<'monthly' | 'fixed'>('monthly')
  const [savedFixedPrice, setSavedFixedPrice] = useState('')
  const [fyStartMonth, setFyStartMonth] = useState(4)
  const [dashboardStyle, setDashboardStyleState] = useState<'default' | 'slim'>('default')
  const [savedDashboardStyle, setSavedDashboardStyle] = useState<'default' | 'slim'>('default')
  const [monthlyPlatformFee, setMonthlyPlatformFee] = useState('30.00')
  const [savedMonthlyPlatformFee, setSavedMonthlyPlatformFee] = useState('30.00')

  // AI usage management state
  const [aiMonthlyLimit, setAiMonthlyLimit] = useState<number | null>(null)
  const [aiMonthlyUsed, setAiMonthlyUsed] = useState(0)
  const [aiMonthlyTokens, setAiMonthlyTokens] = useState(0)
  const [aiLimitInput, setAiLimitInput] = useState('')
  const [aiLimitSaving, setAiLimitSaving] = useState(false)

  // Guest auth settings state
  const [guestOtpEnabled, setGuestOtpEnabled] = useState(true)
  const [guestSsoEnabled, setGuestSsoEnabled] = useState(false)
  const [guestAuthLoading, setGuestAuthLoading] = useState(false)

  // Feature change log state
  const [changeLog, setChangeLog] = useState<FeatureChangeLog[]>([])
  const [changeLogLoading, setChangeLogLoading] = useState(false)

  async function loadPricing() {
    setPricingLoading(true)
    const { data } = await supabase
      .from('subscription_pricing')
      .select('*')
      .order('is_addon, display_name')
    const items = (data as PricingItem[]) || []
    setPricing(items)
    const prices: Record<string, string> = {}
    const flatPrices: Record<string, string> = {}
    items.forEach(p => {
      prices[p.id] = String(p.default_price)
      if (p.flat_price != null) flatPrices[p.id] = String(p.flat_price)
    })
    setEditPrices(prices)
    setEditFlatPrices(flatPrices)
    setPricingLoading(false)
  }

  async function loadCompanies() {
    const { data } = await supabase
      .from('companies')
      .select('id, name, billing_type, fixed_annual_price, billing_type_locked_until, fy_start_month, dashboard_style, monthly_platform_fee')
      .order('name')
    setCompanies((data as CompanyOption[]) || [])
  }

  async function loadCompanyFeatures(companyId: string) {
    setFeaturesLoading(true)
    const company = companies.find(c => c.id === companyId)
    setCompanyName(company?.name || '')

    const bt = (company?.billing_type === 'fixed' ? 'fixed' : 'monthly') as 'monthly' | 'fixed'
    setBillingType(bt)
    setSavedBillingType(bt)
    const fp = company?.fixed_annual_price != null ? String(company.fixed_annual_price) : ''
    setFixedAnnualPrice(fp)
    setSavedFixedPrice(fp)
    setBillingTypeLocked(company?.billing_type_locked_until || null)
    setFyStartMonth(company?.fy_start_month ?? 4)
    const ds = (company?.dashboard_style === 'slim' ? 'slim' : 'default') as 'default' | 'slim'
    setDashboardStyleState(ds)
    setSavedDashboardStyle(ds)
    const mpf = company?.monthly_platform_fee != null ? String(company.monthly_platform_fee) : '30.00'
    setMonthlyPlatformFee(mpf)
    setSavedMonthlyPlatformFee(mpf)

    const { data: metrics } = await callRpcDirect('get_company_metrics', { p_company_id: companyId })
    const m = metrics as Record<string, number> | null
    setEmployeeCount(m?.employee_count ?? 0)

    const { data } = await supabase
      .from('company_features')
      .select('*')
      .eq('company_id', companyId)
    const features = (data as CompanyFeature[]) || []
    setCompanyFeatures(features)

    const prices: Record<string, string> = {}
    features.forEach(f => {
      prices[f.feature_key] = f.custom_price != null ? String(f.custom_price) : ''
    })
    setCustomPrices(prices)
    setSavedPrices({ ...prices })

    const aiFeature = features.find(f => f.feature_key === 'ai_help_agent')
    if (aiFeature) {
      const mLimit = aiFeature.monthly_query_limit ?? null
      const mUsed = aiFeature.monthly_queries_used || 0
      const mTokens = aiFeature.monthly_tokens_used || 0
      const periodStart = aiFeature.usage_period_start
      const monthStart = new Date().toISOString().slice(0, 8) + '01'
      setAiMonthlyLimit(mLimit)
      setAiMonthlyUsed(periodStart && periodStart < monthStart ? 0 : mUsed)
      setAiMonthlyTokens(periodStart && periodStart < monthStart ? 0 : mTokens)
      setAiLimitInput(mLimit !== null ? String(mLimit) : '')
    } else {
      setAiMonthlyLimit(null)
      setAiMonthlyUsed(0)
      setAiMonthlyTokens(0)
      setAiLimitInput('')
    }

    setFeaturesLoading(false)
  }

  async function loadChangeLog(companyId: string) {
    setChangeLogLoading(true)
    const { data } = await supabase
      .from('feature_change_log')
      .select('*')
      .eq('company_id', companyId)
      .order('changed_at', { ascending: false })
      .limit(50)
    setChangeLog((data as FeatureChangeLog[]) || [])
    setChangeLogLoading(false)
  }

  async function loadGuestAuthSettings() {
    const { data } = await supabase.rpc('get_guest_auth_methods')
    if (data) {
      setGuestOtpEnabled(data.otp_enabled)
      setGuestSsoEnabled(data.sso_enabled)
    }
  }

  async function toggleGuestAuth(key: 'guest_otp_enabled' | 'guest_sso_enabled', newValue: boolean) {
    const otpNext = key === 'guest_otp_enabled' ? newValue : guestOtpEnabled
    const ssoNext = key === 'guest_sso_enabled' ? newValue : guestSsoEnabled
    if (!otpNext && !ssoNext) {
      showError('At least one guest login method must remain enabled')
      return
    }
    setGuestAuthLoading(true)
    await supabase.from('platform_settings').update({ value: String(newValue) }).eq('key', key)
    if (key === 'guest_otp_enabled') setGuestOtpEnabled(newValue)
    else setGuestSsoEnabled(newValue)
    showSuccess(`Guest ${key === 'guest_otp_enabled' ? 'OTP' : 'SSO'} login ${newValue ? 'enabled' : 'disabled'}`)
    setGuestAuthLoading(false)
  }

  useEffect(() => {
    loadPricing()
    loadCompanies()
    loadGuestAuthSettings()
  }, [])

  useEffect(() => {
    if (selectedCompanyId) {
      loadCompanyFeatures(selectedCompanyId)
      loadChangeLog(selectedCompanyId)
    }
  }, [selectedCompanyId])

  async function savePricingItem(item: PricingItem) {
    setSavingPricing(item.id)
    const update: Record<string, unknown> = { default_price: parseFloat(editPrices[item.id] || '0') }
    if (item.is_support_package && editFlatPrices[item.id] != null) {
      update.flat_price = parseFloat(editFlatPrices[item.id] || '0')
    }
    await supabase
      .from('subscription_pricing')
      .update(update)
      .eq('id', item.id)
    await loadPricing()
    setSavingPricing(null)
  }

  async function togglePricingActive(item: PricingItem) {
    await supabase
      .from('subscription_pricing')
      .update({ is_active: !item.is_active })
      .eq('id', item.id)
    await loadPricing()
  }

  async function enablePack(packKey: string) {
    if (!selectedCompanyId) return
    setSavingFeature(packKey)

    try {
      if (customPrices[packKey] && customPrices[packKey] !== '') {
        const { error: priceErr } = await supabase
          .from('company_features')
          .upsert(
            { company_id: selectedCompanyId, feature_key: packKey, is_enabled: false, custom_price: parseFloat(customPrices[packKey]) },
            { onConflict: 'company_id,feature_key', ignoreDuplicates: false }
          )
        if (priceErr) {
          showError(`Failed to save custom price: ${priceErr.message}`)
          setSavingFeature(null)
          return
        }
      }

      const { data, error } = await callRpcDirect('enable_pack', {
        p_company_id: selectedCompanyId,
        p_pack_key: packKey,
      })
      if (error) {
        showError(`Failed to enable pack: ${error}`)
      } else {
        const result = data as Record<string, any>
        const label = packKey === 'pack_a' ? 'People Operations' : 'Pro Integrations'
        if (result?.exempt) {
          showSuccess(`${label} enabled (no pro-rata — exempt)`)
        } else {
          showSuccess(`${label} enabled — pro-rata charge: ${formatCurrency(result?.pro_rata_amount || 0, currency)}`)
        }
      }
      await loadCompanyFeatures(selectedCompanyId)
      await loadChangeLog(selectedCompanyId)
    } catch (err: unknown) {
      showError(`Failed to enable pack: ${err instanceof Error ? err.message : String(err)}`)
    }
    setSavingFeature(null)
  }

  async function handleCancelPack(packKey: string) {
    if (!selectedCompanyId) return
    const label = packKey === 'pack_a' ? 'People Operations' : 'Pro Integrations'
    const packFeature = companyFeatures.find(f => f.feature_key === packKey)
    const inGrace = isWithinGracePeriod(packFeature?.activated_at || null)

    if (!window.confirm(
      inGrace
        ? `Cancel ${label}? This is within the 7-day grace period — features will be disabled immediately with no charge.`
        : `Cancel ${label}? Features will remain active until the end of this month. No charges from next month.`
    )) return

    setSavingFeature(packKey)
    const { data, error } = await callRpcDirect('cancel_pack', {
      p_company_id: selectedCompanyId,
      p_pack_key: packKey,
    })
    if (error) {
      showError(`Failed to cancel pack: ${error}`)
    } else {
      const result = data as Record<string, any>
      if (result?.cancel_type === 'grace_immediate') {
        showSuccess(`${label} cancelled — charge reversed (£${result?.reversed_amount || 0})`)
      } else {
        showSuccess(`${label} cancellation scheduled for ${formatUKDate(result?.effective_date)}`)
      }
    }
    await loadCompanyFeatures(selectedCompanyId)
    await loadChangeLog(selectedCompanyId)
    setSavingFeature(null)
  }

  async function toggleSupportPackage(featureKey: string, currentlyEnabled: boolean) {
    if (!selectedCompanyId) return
    setSavingFeature(featureKey)
    const { error } = await supabase
      .from('company_features')
      .upsert(
        { company_id: selectedCompanyId, feature_key: featureKey, is_enabled: !currentlyEnabled, custom_price: null },
        { onConflict: 'company_id,feature_key' }
      )
    if (error) {
      showError('Failed to update support package')
    } else {
      showSuccess(`Support package ${!currentlyEnabled ? 'added' : 'removed'}`)
    }
    await loadCompanyFeatures(selectedCompanyId)
    setSavingFeature(null)
  }

  async function toggleIndividualAddon(featureKey: string, currentlyEnabled: boolean) {
    if (!selectedCompanyId) return
    setSavingFeature(featureKey)

    const enabling = !currentlyEnabled
    const mutualPair: Record<string, string> = { enterprise_ai: 'ai_help_agent', ai_help_agent: 'enterprise_ai' }
    const opposite = mutualPair[featureKey]

    if (enabling && opposite) {
      await supabase
        .from('company_features')
        .upsert(
          { company_id: selectedCompanyId, feature_key: opposite, is_enabled: false, custom_price: null },
          { onConflict: 'company_id,feature_key' }
        )
    }

    const { error } = await supabase
      .from('company_features')
      .upsert(
        { company_id: selectedCompanyId, feature_key: featureKey, is_enabled: enabling, custom_price: null },
        { onConflict: 'company_id,feature_key' }
      )
    if (error) {
      showError('Failed to update add-on')
    } else {
      const msg = enabling && opposite
        ? `${featureKey === 'enterprise_ai' ? 'Enterprise AI' : 'AI Help Agent'} enabled — ${featureKey === 'enterprise_ai' ? 'AI Help Agent' : 'Enterprise AI'} disabled`
        : `Add-on ${enabling ? 'enabled' : 'disabled'}`
      showSuccess(msg)
    }
    await loadCompanyFeatures(selectedCompanyId)
    setSavingFeature(null)
  }

  async function saveAllCustomPrices() {
    if (!selectedCompanyId) return
    setSavingAllPrices(true)

    let errorCount = 0

    for (const key of ['hr_core', 'pack_a', 'pack_b']) {
      const existing = companyFeatures.find(f => f.feature_key === key)
      const customPrice = customPrices[key]
      const { error } = await supabase
        .from('company_features')
        .upsert(
          {
            company_id: selectedCompanyId,
            feature_key: key,
            is_enabled: existing?.is_enabled ?? (key === 'hr_core'),
            custom_price: customPrice ? parseFloat(customPrice) : null,
          },
          { onConflict: 'company_id,feature_key' }
        )
      if (error) errorCount++
    }

    const companyUpdate: Record<string, unknown> = {
      billing_type: billingType,
      fixed_annual_price: billingType === 'fixed' && fixedAnnualPrice ? parseFloat(fixedAnnualPrice) : null,
      dashboard_style: dashboardStyle,
      monthly_platform_fee: parseFloat(monthlyPlatformFee) || 30,
    }

    if (billingType === 'fixed' && savedBillingType === 'monthly') {
      const now = new Date()
      const currentMonth = now.getMonth() + 1
      let lockYear = now.getFullYear()
      if (currentMonth >= fyStartMonth) lockYear++
      const lockDate = `${lockYear}-${String(fyStartMonth).padStart(2, '0')}-01`
      companyUpdate.billing_type_locked_until = lockDate
    }

    const { error: coError } = await supabase
      .from('companies')
      .update(companyUpdate)
      .eq('id', selectedCompanyId)
    if (coError) errorCount++

    await loadCompanies()
    await loadCompanyFeatures(selectedCompanyId)
    setSavingAllPrices(false)

    if (errorCount > 0) {
      showError(`Failed to save ${errorCount} item(s)`)
    } else {
      showSuccess(`Subscription settings saved for ${companyName}`)
    }
  }

  const hasPriceChanges = Object.keys(customPrices).some(
    k => (customPrices[k] || '') !== (savedPrices[k] || '')
  )
  const hasBillingChanges = billingType !== savedBillingType || fixedAnnualPrice !== savedFixedPrice
  const hasDashboardStyleChanges = dashboardStyle !== savedDashboardStyle
  const hasPlatformFeeChanges = monthlyPlatformFee !== savedMonthlyPlatformFee
  const hasUnsavedChanges = hasPriceChanges || hasBillingChanges || hasDashboardStyleChanges || hasPlatformFeeChanges

  const isLockedToFixed = billingType === 'fixed' && billingTypeLocked && new Date(billingTypeLocked) > new Date()

  function getEffectivePrice(featureKey: string): number {
    const cf = companyFeatures.find(f => f.feature_key === featureKey)
    if (cf?.custom_price != null) return cf.custom_price
    const p = pricing.find(pr => pr.feature_key === featureKey)
    return p?.default_price ?? 0
  }

  function isFeatureEnabled(featureKey: string): boolean {
    const cf = companyFeatures.find(f => f.feature_key === featureKey)
    return cf?.is_enabled ?? false
  }

  function getPackPartialCount(packKeys: string[]): number {
    return packKeys.filter(k => isFeatureEnabled(k)).length
  }

  if (!isSuperAdmin) {
    return (
      <div className="admin-section">
        <div className="admin-page-header">
          <h2>Access Denied</h2>
          <p>This page is only available to super administrators.</p>
        </div>
      </div>
    )
  }

  const corePricing = pricing.find(p => p.feature_key === 'hr_core')
  const packAPricing = pricing.find(p => p.feature_key === 'pack_a')
  const packBPricing = pricing.find(p => p.feature_key === 'pack_b')
  const launchPackages = pricing.filter(p => p.is_support_package && p.support_type === 'launch')
  const monthlySupportPlans = pricing.filter(p => p.is_support_package && p.support_type === 'monthly')
  const supportPackages = pricing.filter(p => p.is_support_package)
  const PACK_ALL_KEYS = ['hr_core', 'pack_a', 'pack_b', ...PACK_A_FEATURE_KEYS, ...PACK_B_FEATURE_KEYS]
  const individualAddons = pricing.filter(p => p.is_addon && !p.is_support_package && !PACK_ALL_KEYS.includes(p.feature_key))

  const packAEnabled = isFeatureEnabled('pack_a')
  const packBEnabled = isFeatureEnabled('pack_b')

  const coreCost = corePricing ? getEffectivePrice('hr_core') * employeeCount : 0
  const packACost = packAEnabled && packAPricing ? getEffectivePrice('pack_a') * employeeCount : 0
  const packBCost = packBEnabled && packBPricing ? getEffectivePrice('pack_b') * employeeCount : 0
  const launchCost = launchPackages.reduce((sum, sp) => {
    if (!isFeatureEnabled(sp.feature_key)) return sum
    return sum + (sp.flat_price ?? 0)
  }, 0)
  const monthlySupportCost = monthlySupportPlans.reduce((sum, sp) => {
    if (!isFeatureEnabled(sp.feature_key)) return sum
    return sum + (sp.flat_price ?? 0)
  }, 0)
  const supportCost = launchCost + monthlySupportCost
  const addonCost = individualAddons.reduce((sum, a) => {
    if (!isFeatureEnabled(a.feature_key)) return sum
    return sum + (a.flat_price != null ? a.flat_price : a.default_price * employeeCount)
  }, 0)
  const platformFee = parseFloat(monthlyPlatformFee) || 30
  const totalCost = coreCost + packACost + packBCost + supportCost + addonCost + platformFee

  const tabStyle = (t: string) => ({
    padding: '10px 24px',
    border: 'none',
    background: 'none',
    fontWeight: 700 as const,
    fontSize: 14,
    cursor: 'pointer' as const,
    borderBottom: tab === t ? '3px solid #1565c0' : '3px solid transparent',
    color: tab === t ? '#1565c0' : '#8b8fa3',
    marginBottom: -2,
  })

  return (
    <div className="admin-section">
      <div className="admin-page-header">
        <h2>Subscription Management</h2>
        <p>Manage pricing and company feature assignments</p>
      </div>

      <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '2px solid #e5e7eb', flexWrap: 'wrap' }}>
        <button onClick={() => setTab('pricing')} style={tabStyle('pricing')}>Pricing</button>
        <button onClick={() => { setTab('features'); loadCompanies() }} style={tabStyle('features')}>Company Features</button>
        <button onClick={() => setTab('companies')} style={tabStyle('companies')}>Companies</button>
        <button onClick={() => setTab('trial-requests')} style={tabStyle('trial-requests')}>Trial Requests</button>
        <button onClick={() => setTab('support-access')} style={tabStyle('support-access')}>Support Access</button>
        <button onClick={() => setTab('audit-log')} style={tabStyle('audit-log')}>Audit Log</button>
      </div>

      {/* Pricing Tab */}
      {tab === 'pricing' && (
        <>
          {pricingLoading ? (
            <div className="admin-loading">Loading...</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Core */}
              {corePricing && (
                <div className="sub-pricing-card sub-pricing-card-baseline">
                  <div className="sub-pricing-name">{corePricing.display_name}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                    {CORE_FEATURES.map(f => (
                      <span key={f} style={{ fontSize: 11, background: '#e3f2fd', color: '#1565c0', padding: '3px 10px', borderRadius: 12, fontWeight: 500 }}>{f}</span>
                    ))}
                  </div>
                  <div className="sub-pricing-input-row">
                    <label>Price</label>
                    <span>{currencySymbol(currency)}</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="sub-pricing-input"
                      value={editPrices[corePricing.id] || ''}
                      onChange={e => setEditPrices(prev => ({ ...prev, [corePricing.id]: e.target.value }))}
                    />
                    <span>/user/month</span>
                  </div>
                  <div className="sub-pricing-actions">
                    <label className="admin-toggle-switch">
                      <input type="checkbox" checked={corePricing.is_active} onChange={() => togglePricingActive(corePricing)} />
                      <span className="admin-toggle-slider" />
                    </label>
                    <button className="sub-pricing-save" onClick={() => savePricingItem(corePricing)} disabled={savingPricing === corePricing.id}>
                      {savingPricing === corePricing.id ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              )}

              {/* People Operations */}
              {packAPricing && (
                <div className="sub-pricing-card sub-pricing-card-addon" style={{ borderLeft: '4px solid #43a047' }}>
                  <div className="sub-pricing-name">{packAPricing.display_name}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                    {PACK_A_LABELS.map(f => (
                      <span key={f} style={{ fontSize: 11, background: '#e8f5e9', color: '#2e7d32', padding: '3px 10px', borderRadius: 12, fontWeight: 500 }}>{f}</span>
                    ))}
                  </div>
                  <div className="sub-pricing-input-row">
                    <label>Price</label>
                    <span>{currencySymbol(currency)}</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="sub-pricing-input"
                      value={editPrices[packAPricing.id] || ''}
                      onChange={e => setEditPrices(prev => ({ ...prev, [packAPricing.id]: e.target.value }))}
                    />
                    <span>/user/month</span>
                  </div>
                  <div className="sub-pricing-actions">
                    <label className="admin-toggle-switch">
                      <input type="checkbox" checked={packAPricing.is_active} onChange={() => togglePricingActive(packAPricing)} />
                      <span className="admin-toggle-slider" />
                    </label>
                    <button className="sub-pricing-save" onClick={() => savePricingItem(packAPricing)} disabled={savingPricing === packAPricing.id}>
                      {savingPricing === packAPricing.id ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              )}

              {/* Pack B */}
              {packBPricing && (
                <div className="sub-pricing-card sub-pricing-card-addon" style={{ borderLeft: '4px solid #7b1fa2' }}>
                  <div className="sub-pricing-name">Pack B: Pro Integrations</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                    {PACK_B_LABELS.map(f => (
                      <span key={f} style={{ fontSize: 11, background: '#f3e5f5', color: '#7b1fa2', padding: '3px 10px', borderRadius: 12, fontWeight: 500 }}>{f}</span>
                    ))}
                  </div>
                  <div className="sub-pricing-input-row">
                    <label>Price</label>
                    <span>{currencySymbol(currency)}</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="sub-pricing-input"
                      value={editPrices[packBPricing.id] || ''}
                      onChange={e => setEditPrices(prev => ({ ...prev, [packBPricing.id]: e.target.value }))}
                    />
                    <span>/user/month</span>
                  </div>
                  <div className="sub-pricing-actions">
                    <label className="admin-toggle-switch">
                      <input type="checkbox" checked={packBPricing.is_active} onChange={() => togglePricingActive(packBPricing)} />
                      <span className="admin-toggle-slider" />
                    </label>
                    <button className="sub-pricing-save" onClick={() => savePricingItem(packBPricing)} disabled={savingPricing === packBPricing.id}>
                      {savingPricing === packBPricing.id ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              )}

              {/* Launch Packages (one-off) */}
              {launchPackages.length > 0 && (
                <>
                  <div style={{ fontWeight: 700, fontSize: 14, color: '#333', marginTop: 8 }}>Launch Packages <span style={{ fontSize: 11, fontWeight: 400, color: '#888' }}>(one-off)</span></div>
                  <div className="sub-pricing-grid">
                    {launchPackages.map(sp => (
                      <div key={sp.id} className="sub-pricing-card sub-pricing-card-addon" style={{ borderLeft: '4px solid #e65100' }}>
                        <div className="sub-pricing-name">{sp.display_name}</div>
                        <div className="sub-pricing-desc">{sp.description}</div>
                        <div className="sub-pricing-input-row">
                          <label>Flat Price</label>
                          <span>{currencySymbol(currency)}</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            className="sub-pricing-input"
                            value={editFlatPrices[sp.id] || ''}
                            onChange={e => setEditFlatPrices(prev => ({ ...prev, [sp.id]: e.target.value }))}
                          />
                          <span>(one-off)</span>
                        </div>
                        <div className="sub-pricing-actions">
                          <label className="admin-toggle-switch">
                            <input type="checkbox" checked={sp.is_active} onChange={() => togglePricingActive(sp)} />
                            <span className="admin-toggle-slider" />
                          </label>
                          <button className="sub-pricing-save" onClick={() => savePricingItem(sp)} disabled={savingPricing === sp.id}>
                            {savingPricing === sp.id ? 'Saving...' : 'Save'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* Monthly Support Plans */}
              {monthlySupportPlans.length > 0 && (
                <>
                  <div style={{ fontWeight: 700, fontSize: 14, color: '#333', marginTop: 8 }}>Monthly Support Plans <span style={{ fontSize: 11, fontWeight: 400, color: '#888' }}>(recurring)</span></div>
                  <div className="sub-pricing-grid">
                    {monthlySupportPlans.map(sp => (
                      <div key={sp.id} className="sub-pricing-card sub-pricing-card-addon" style={{ borderLeft: '4px solid #00897b' }}>
                        <div className="sub-pricing-name">{sp.display_name}</div>
                        <div className="sub-pricing-desc">{sp.description}</div>
                        <div className="sub-pricing-input-row">
                          <label>Monthly Price</label>
                          <span>{currencySymbol(currency)}</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            className="sub-pricing-input"
                            value={editFlatPrices[sp.id] || ''}
                            onChange={e => setEditFlatPrices(prev => ({ ...prev, [sp.id]: e.target.value }))}
                          />
                          <span>/month</span>
                        </div>
                        <div className="sub-pricing-actions">
                          <label className="admin-toggle-switch">
                            <input type="checkbox" checked={sp.is_active} onChange={() => togglePricingActive(sp)} />
                            <span className="admin-toggle-slider" />
                          </label>
                          <button className="sub-pricing-save" onClick={() => savePricingItem(sp)} disabled={savingPricing === sp.id}>
                            {savingPricing === sp.id ? 'Saving...' : 'Save'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* Individual Add-ons */}
              {individualAddons.length > 0 && (
                <>
                  <div style={{ fontWeight: 700, fontSize: 14, color: '#6a1b9a', marginTop: 8 }}>Individual Add-ons</div>
                  {individualAddons.map(addon => (
                    <div key={addon.id} className="sub-pricing-card sub-pricing-card-addon" style={{ borderLeft: '4px solid #8e24aa' }}>
                      <div className="sub-pricing-name">{addon.display_name}</div>
                      <div className="sub-pricing-desc">{addon.description}</div>
                      <div className="sub-pricing-input-row">
                        <label>Price</label>
                        <span>{currencySymbol(currency)}</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          className="sub-pricing-input"
                          value={editPrices[addon.id] || ''}
                          onChange={e => setEditPrices(prev => ({ ...prev, [addon.id]: e.target.value }))}
                        />
                        <span>/user/month</span>
                      </div>
                      <div className="sub-pricing-actions">
                        <label className="admin-toggle-switch">
                          <input type="checkbox" checked={addon.is_active} onChange={() => togglePricingActive(addon)} />
                          <span className="admin-toggle-slider" />
                        </label>
                        <button className="sub-pricing-save" onClick={() => savePricingItem(addon)} disabled={savingPricing === addon.id}>
                          {savingPricing === addon.id ? 'Saving...' : 'Save'}
                        </button>
                      </div>
                    </div>
                  ))}
                </>
              )}

              {pricing.length === 0 && (
                <div className="admin-empty">No pricing items found</div>
              )}

              {/* Guest Access Settings */}
              <div style={{ marginTop: 32, padding: 20, background: '#f8fafc', borderRadius: 12, border: '1px solid #e5e7eb' }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 4, color: '#1e293b' }}>Guest Access Settings</h3>
                <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>Control how guest users authenticate across all companies. At least one method must remain enabled.</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={guestOtpEnabled}
                      onChange={e => toggleGuestAuth('guest_otp_enabled', e.target.checked)}
                      disabled={guestAuthLoading}
                      style={{ width: 18, height: 18, accentColor: '#1565c0' }}
                    />
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#334155' }}>Email + One-Time Passcode (OTP)</span>
                    <span className="admin-badge admin-badge-approved" style={{ fontSize: 11, marginLeft: 4 }}>Default</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={guestSsoEnabled}
                      onChange={e => toggleGuestAuth('guest_sso_enabled', e.target.checked)}
                      disabled={guestAuthLoading}
                      style={{ width: 18, height: 18, accentColor: '#1565c0' }}
                    />
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#334155' }}>Microsoft SSO (Entra ID B2B)</span>
                  </label>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Company Features Tab */}
      {tab === 'features' && (
        <div className="sub-features-scroll">
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontWeight: 600, fontSize: 13, marginRight: 8 }}>Company</label>
            <select
              className="admin-input"
              style={{ minWidth: 240 }}
              value={selectedCompanyId}
              onChange={e => setSelectedCompanyId(e.target.value)}
            >
              <option value="">Select a company...</option>
              {companies.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {selectedCompanyId && (
            <>
              {featuresLoading ? (
                <div className="admin-loading">Loading...</div>
              ) : (
                <>
                  <div className="sub-company-header">
                    <div className="sub-company-name">{companyName}</div>
                    <div className="sub-company-count">{employeeCount} active employee{employeeCount !== 1 ? 's' : ''}</div>
                  </div>

                  {/* Billing Type */}
                  <div style={{ background: billingType === 'fixed' ? '#e8f5e9' : '#f5f5f5', border: `1px solid ${billingType === 'fixed' ? '#43a047' : '#e0e0e0'}`, borderRadius: 8, padding: 16, marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>Billing Type</div>
                      <label className="admin-toggle-switch">
                        <input
                          type="checkbox"
                          checked={billingType === 'fixed'}
                          onChange={() => {
                            if (isLockedToFixed) return
                            setBillingType(prev => prev === 'monthly' ? 'fixed' : 'monthly')
                          }}
                          disabled={!!isLockedToFixed}
                        />
                        <span className="admin-toggle-slider" />
                      </label>
                      <span style={{ fontSize: 13, fontWeight: 600, color: billingType === 'fixed' ? '#2e7d32' : '#666' }}>
                        {billingType === 'fixed' ? 'Fixed Annual Price' : 'Monthly Per-User'}
                      </span>
                      {isLockedToFixed && (
                        <span style={{ fontSize: 12, color: '#e65100', fontWeight: 600 }}>
                          Locked until {new Date(billingTypeLocked!).toLocaleDateString('en-GB')}
                        </span>
                      )}
                    </div>
                    {billingType === 'fixed' && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
                        <label style={{ fontWeight: 600, fontSize: 13 }}>Annual Price {currencySymbol(currency)}</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          className="admin-input"
                          style={{ width: 140 }}
                          value={fixedAnnualPrice}
                          onChange={e => setFixedAnnualPrice(e.target.value)}
                          placeholder="e.g. 5000.00"
                        />
                        <span style={{ fontSize: 12, color: '#666' }}>per year (all features included)</span>
                      </div>
                    )}
                    {billingType === 'fixed' && savedBillingType === 'monthly' && (
                      <p style={{ fontSize: 12, color: '#e65100', margin: '8px 0 0' }}>
                        Switching to fixed billing is a one-off change locked until the start of the next financial year ({
                          ['January','February','March','April','May','June','July','August','September','October','November','December'][fyStartMonth - 1]
                        }).
                      </p>
                    )}
                  </div>

                  {/* Dashboard Style */}
                  <div style={{ background: dashboardStyle === 'slim' ? '#e8eaf6' : '#f5f5f5', border: `1px solid ${dashboardStyle === 'slim' ? '#5c6bc0' : '#e0e0e0'}`, borderRadius: 8, padding: 16, marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>Dashboard Style</div>
                      <label className="admin-toggle-switch">
                        <input
                          type="checkbox"
                          checked={dashboardStyle === 'slim'}
                          onChange={() => setDashboardStyleState(prev => prev === 'default' ? 'slim' : 'default')}
                        />
                        <span className="admin-toggle-slider" />
                      </label>
                      <span style={{ fontSize: 13, fontWeight: 600, color: dashboardStyle === 'slim' ? '#3949ab' : '#666' }}>
                        {dashboardStyle === 'slim' ? 'Slim Cards' : 'Default'}
                      </span>
                    </div>
                    <p style={{ fontSize: 12, color: '#666', margin: '8px 0 0' }}>
                      {dashboardStyle === 'slim'
                        ? 'Feature cards display at half height. Expenses and Leave cards remain full size.'
                        : 'All dashboard cards display at standard height.'}
                    </p>
                  </div>

                  {/* HR Core Features */}
                  {corePricing && (
                    <div style={{ background: '#f8faff', border: '2px solid #1565c0', borderRadius: 8, padding: 16, marginBottom: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                        <span style={{ fontSize: 16 }}>&#9733;</span>
                        <span style={{ fontWeight: 700, fontSize: 15, color: '#1565c0' }}>Core Features</span>
                        <span style={{ fontSize: 11, color: '#43a047', fontWeight: 600 }}>Always included</span>
                        {customPrices['hr_core'] && customPrices['hr_core'] !== '' && (
                          <span style={{ fontSize: 10, background: '#e3f2fd', color: '#1565c0', padding: '2px 8px', borderRadius: 3, fontWeight: 600 }}>Custom Rate</span>
                        )}
                      </div>

                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
                        {CORE_FEATURES.map(f => (
                          <span key={f} style={{ fontSize: 11, background: '#e3f2fd', color: '#1565c0', padding: '3px 10px', borderRadius: 12, fontWeight: 500 }}>{f}</span>
                        ))}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', background: '#fff', borderRadius: 6, padding: 12, border: '1px solid #e0e0e0' }}>
                        <div style={{ textAlign: 'center', background: '#f5f5f5', borderRadius: 6, padding: '8px 14px', minWidth: 0 }}>
                          <div style={{ fontSize: 10, color: '#999', fontWeight: 600, textTransform: 'uppercase' }}>Default Price</div>
                          <div style={{ fontSize: 18, fontWeight: 700, color: '#999' }}>{formatCurrency(corePricing.default_price, currency)}</div>
                          <div style={{ fontSize: 10, color: '#bbb' }}>from Pricing tab</div>
                        </div>
                        <div style={{ fontSize: 18, color: '#ccc' }}>&rarr;</div>
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: 10, color: '#1565c0', fontWeight: 600, textTransform: 'uppercase' }}>Company Price</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ fontWeight: 600 }}>{currencySymbol(currency)}</span>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              className="admin-input"
                              style={{ width: 100, fontWeight: 700, fontSize: 16, textAlign: 'center' }}
                              placeholder={corePricing.default_price.toFixed(2)}
                              value={customPrices['hr_core'] ?? ''}
                              onChange={e => setCustomPrices(prev => ({ ...prev, hr_core: e.target.value }))}
                            />
                            <span style={{ fontSize: 12, color: '#666' }}>/user/mo</span>
                          </div>
                          <div style={{ fontSize: 10, color: '#bbb' }}>leave empty to use default</div>
                        </div>
                        <div style={{ flex: 1, minWidth: 120, textAlign: 'right' }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: '#1565c0' }}>
                            {formatCurrency(coreCost, currency)}/mo
                          </div>
                          <div style={{ fontSize: 11, color: '#666' }}>{employeeCount} users &times; {formatCurrency(getEffectivePrice('hr_core'), currency)}</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Pack A: People Operations */}
                  {packAPricing && (() => {
                    const partialCount = getPackPartialCount(PACK_A_FEATURE_KEYS)
                    const isPartial = !packAEnabled && partialCount > 0
                    const packAFeature = companyFeatures.find(f => f.feature_key === 'pack_a')
                    const packAGrace = packAEnabled && isWithinGracePeriod(packAFeature?.activated_at || null)
                    const packAGraceDays = gracePeriodRemaining(packAFeature?.activated_at || null)
                    const packACancelling = packAFeature?.cancellation_scheduled
                    return (
                      <div style={{ background: packAEnabled ? '#e8f5e9' : '#f5f5f5', border: `2px solid ${packAEnabled ? '#43a047' : isPartial ? '#ff9800' : '#e0e0e0'}`, borderRadius: 8, padding: 16, marginBottom: 16 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                          {!packAEnabled ? (
                            <button
                              className="admin-btn"
                              style={{ background: '#43a047', color: '#fff', border: 'none', fontWeight: 700, fontSize: 13, padding: '8px 16px', borderRadius: 6, cursor: 'pointer' }}
                              onClick={() => enablePack('pack_a')}
                              disabled={savingFeature === 'pack_a'}
                            >
                              {savingFeature === 'pack_a' ? 'Enabling...' : 'Enable Pack'}
                            </button>
                          ) : (
                            <span style={{ fontSize: 11, background: '#c8e6c9', color: '#2e7d32', padding: '4px 12px', borderRadius: 12, fontWeight: 700 }}>Active</span>
                          )}
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 700, fontSize: 15, color: '#2e7d32' }}>People Operations</div>
                            {isPartial && (
                              <div style={{ fontSize: 12, color: '#e65100', fontWeight: 600 }}>
                                {partialCount} of {PACK_A_FEATURE_KEYS.length} features enabled individually — enable pack to include all
                              </div>
                            )}
                            {packAEnabled && packAFeature?.activated_at && (
                              <div style={{ fontSize: 11, color: '#666' }}>Activated: {formatUKDate(packAFeature.activated_at)}</div>
                            )}
                          </div>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                            {customPrices['pack_a'] && customPrices['pack_a'] !== '' && (
                              <span style={{ fontSize: 10, background: '#e8f5e9', color: '#2e7d32', padding: '2px 8px', borderRadius: 3, fontWeight: 600 }}>Custom Rate</span>
                            )}
                            {packAGrace && (
                              <span style={{ fontSize: 10, background: '#fff3e0', color: '#e65100', padding: '3px 10px', borderRadius: 12, fontWeight: 700 }}>Grace period: {packAGraceDays} day{packAGraceDays !== 1 ? 's' : ''} remaining</span>
                            )}
                            {packACancelling && (
                              <span style={{ fontSize: 10, background: '#ffebee', color: '#c62828', padding: '3px 10px', borderRadius: 12, fontWeight: 700 }}>Cancelling: active until {formatUKDate(packAFeature?.cancellation_effective_date || null)}</span>
                            )}
                          </div>
                          {packAEnabled && !packACancelling && (
                            <button
                              className="admin-btn"
                              style={{ background: '#c62828', color: '#fff', border: 'none', fontWeight: 600, fontSize: 12, padding: '6px 14px', borderRadius: 6, cursor: 'pointer' }}
                              onClick={() => handleCancelPack('pack_a')}
                              disabled={savingFeature === 'pack_a'}
                            >
                              Cancel Pack
                            </button>
                          )}
                        </div>

                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                          {PACK_A_LABELS.map((f, i) => {
                            const fEnabled = isFeatureEnabled(PACK_A_FEATURE_KEYS[i])
                            return (
                              <span key={f} style={{ fontSize: 11, background: fEnabled ? '#c8e6c9' : '#eee', color: fEnabled ? '#2e7d32' : '#999', padding: '3px 10px', borderRadius: 12, fontWeight: 500 }}>{f}</span>
                            )
                          })}
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', background: '#fff', borderRadius: 6, padding: 12, border: '1px solid #e0e0e0' }}>
                          <div style={{ textAlign: 'center', background: '#f5f5f5', borderRadius: 6, padding: '8px 14px' }}>
                            <div style={{ fontSize: 10, color: '#999', fontWeight: 600, textTransform: 'uppercase' }}>Default Price</div>
                            <div style={{ fontSize: 18, fontWeight: 700, color: '#999' }}>{formatCurrency(packAPricing.default_price, currency)}</div>
                          </div>
                          <div style={{ fontSize: 18, color: '#ccc' }}>&rarr;</div>
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: 10, color: '#2e7d32', fontWeight: 600, textTransform: 'uppercase' }}>Company Price</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <span style={{ fontWeight: 600 }}>{currencySymbol(currency)}</span>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                className="admin-input"
                                style={{ width: 100, fontWeight: 700, fontSize: 16, textAlign: 'center' }}
                                placeholder={packAPricing.default_price.toFixed(2)}
                                value={customPrices['pack_a'] ?? ''}
                                onChange={e => setCustomPrices(prev => ({ ...prev, pack_a: e.target.value }))}
                              />
                              <span style={{ fontSize: 12, color: '#666' }}>/user/mo</span>
                            </div>
                          </div>
                          {packAEnabled && (
                            <div style={{ flex: 1, minWidth: 120, textAlign: 'right' }}>
                              <div style={{ fontSize: 13, fontWeight: 700, color: '#2e7d32' }}>
                                {formatCurrency(packACost, currency)}/mo
                              </div>
                              <div style={{ fontSize: 11, color: '#666' }}>{employeeCount} users &times; {formatCurrency(getEffectivePrice('pack_a'), currency)}</div>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })()}

                  {/* Pack B: Pro Integrations */}
                  {packBPricing && (() => {
                    const partialCount = getPackPartialCount(PACK_B_FEATURE_KEYS)
                    const isPartial = !packBEnabled && partialCount > 0
                    const packBFeature = companyFeatures.find(f => f.feature_key === 'pack_b')
                    const packBGrace = packBEnabled && isWithinGracePeriod(packBFeature?.activated_at || null)
                    const packBGraceDays = gracePeriodRemaining(packBFeature?.activated_at || null)
                    const packBCancelling = packBFeature?.cancellation_scheduled
                    return (
                      <div style={{ background: packBEnabled ? '#f3e5f5' : '#f5f5f5', border: `2px solid ${packBEnabled ? '#7b1fa2' : isPartial ? '#ff9800' : '#e0e0e0'}`, borderRadius: 8, padding: 16, marginBottom: 16 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                          {!packBEnabled ? (
                            <button
                              className="admin-btn"
                              style={{ background: '#7b1fa2', color: '#fff', border: 'none', fontWeight: 700, fontSize: 13, padding: '8px 16px', borderRadius: 6, cursor: 'pointer' }}
                              onClick={() => enablePack('pack_b')}
                              disabled={savingFeature === 'pack_b'}
                            >
                              {savingFeature === 'pack_b' ? 'Enabling...' : 'Enable Pack'}
                            </button>
                          ) : (
                            <span style={{ fontSize: 11, background: '#e1bee7', color: '#7b1fa2', padding: '4px 12px', borderRadius: 12, fontWeight: 700 }}>Active</span>
                          )}
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 700, fontSize: 15, color: '#7b1fa2' }}>Pro Integrations</div>
                            {isPartial && (
                              <div style={{ fontSize: 12, color: '#e65100', fontWeight: 600 }}>
                                {partialCount} of {PACK_B_FEATURE_KEYS.length} features enabled individually — enable pack to include all
                              </div>
                            )}
                            {packBEnabled && packBFeature?.activated_at && (
                              <div style={{ fontSize: 11, color: '#666' }}>Activated: {formatUKDate(packBFeature.activated_at)}</div>
                            )}
                          </div>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                            {customPrices['pack_b'] && customPrices['pack_b'] !== '' && (
                              <span style={{ fontSize: 10, background: '#f3e5f5', color: '#7b1fa2', padding: '2px 8px', borderRadius: 3, fontWeight: 600 }}>Custom Rate</span>
                            )}
                            {packBGrace && (
                              <span style={{ fontSize: 10, background: '#fff3e0', color: '#e65100', padding: '3px 10px', borderRadius: 12, fontWeight: 700 }}>Grace period: {packBGraceDays} day{packBGraceDays !== 1 ? 's' : ''} remaining</span>
                            )}
                            {packBCancelling && (
                              <span style={{ fontSize: 10, background: '#ffebee', color: '#c62828', padding: '3px 10px', borderRadius: 12, fontWeight: 700 }}>Cancelling: active until {formatUKDate(packBFeature?.cancellation_effective_date || null)}</span>
                            )}
                          </div>
                          {packBEnabled && !packBCancelling && (
                            <button
                              className="admin-btn"
                              style={{ background: '#c62828', color: '#fff', border: 'none', fontWeight: 600, fontSize: 12, padding: '6px 14px', borderRadius: 6, cursor: 'pointer' }}
                              onClick={() => handleCancelPack('pack_b')}
                              disabled={savingFeature === 'pack_b'}
                            >
                              Cancel Pack
                            </button>
                          )}
                        </div>

                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                          {PACK_B_LABELS.map((f, i) => {
                            const fEnabled = isFeatureEnabled(PACK_B_FEATURE_KEYS[i])
                            return (
                              <span key={f} style={{ fontSize: 11, background: fEnabled ? '#e1bee7' : '#eee', color: fEnabled ? '#7b1fa2' : '#999', padding: '3px 10px', borderRadius: 12, fontWeight: 500 }}>{f}</span>
                            )
                          })}
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', background: '#fff', borderRadius: 6, padding: 12, border: '1px solid #e0e0e0' }}>
                          <div style={{ textAlign: 'center', background: '#f5f5f5', borderRadius: 6, padding: '8px 14px' }}>
                            <div style={{ fontSize: 10, color: '#999', fontWeight: 600, textTransform: 'uppercase' }}>Default Price</div>
                            <div style={{ fontSize: 18, fontWeight: 700, color: '#999' }}>{formatCurrency(packBPricing.default_price, currency)}</div>
                          </div>
                          <div style={{ fontSize: 18, color: '#ccc' }}>&rarr;</div>
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: 10, color: '#7b1fa2', fontWeight: 600, textTransform: 'uppercase' }}>Company Price</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <span style={{ fontWeight: 600 }}>{currencySymbol(currency)}</span>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                className="admin-input"
                                style={{ width: 100, fontWeight: 700, fontSize: 16, textAlign: 'center' }}
                                placeholder={packBPricing.default_price.toFixed(2)}
                                value={customPrices['pack_b'] ?? ''}
                                onChange={e => setCustomPrices(prev => ({ ...prev, pack_b: e.target.value }))}
                              />
                              <span style={{ fontSize: 12, color: '#666' }}>/user/mo</span>
                            </div>
                          </div>
                          {packBEnabled && (
                            <div style={{ flex: 1, minWidth: 120, textAlign: 'right' }}>
                              <div style={{ fontSize: 13, fontWeight: 700, color: '#7b1fa2' }}>
                                {formatCurrency(packBCost, currency)}/mo
                              </div>
                              <div style={{ fontSize: 11, color: '#666' }}>{employeeCount} users &times; {formatCurrency(getEffectivePrice('pack_b'), currency)}</div>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })()}

                  {/* Launch Packages (one-off) */}
                  {launchPackages.length > 0 && (
                    <div style={{ background: '#fff8e1', border: '2px solid #f9a825', borderRadius: 8, padding: 16, marginBottom: 16 }}>
                      <div style={{ fontWeight: 700, fontSize: 15, color: '#e65100', marginBottom: 4 }}>Launch Packages</div>
                      <div style={{ fontSize: 11, color: '#888', marginBottom: 10 }}>One-off, fixed-price launch services. All prices ex VAT.</div>
                      {launchPackages.map(sp => {
                        const purchased = isFeatureEnabled(sp.feature_key)
                        return (
                          <div key={sp.feature_key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid #ffe082' }}>
                            <label className="admin-toggle-switch">
                              <input
                                type="checkbox"
                                checked={purchased}
                                onChange={() => toggleSupportPackage(sp.feature_key, purchased)}
                                disabled={savingFeature === sp.feature_key}
                              />
                              <span className="admin-toggle-slider" />
                            </label>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontWeight: 600, fontSize: 13 }}>{sp.display_name}</div>
                              <div style={{ fontSize: 12, color: '#666' }}>{sp.description}</div>
                            </div>
                            <div style={{ fontWeight: 700, fontSize: 14, color: '#e65100' }}>
                              {formatCurrency(sp.flat_price ?? 0, currency)}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {/* Monthly Support Plans */}
                  {monthlySupportPlans.length > 0 && (
                    <div style={{ background: '#e0f2f1', border: '2px solid #00897b', borderRadius: 8, padding: 16, marginBottom: 16 }}>
                      <div style={{ fontWeight: 700, fontSize: 15, color: '#00695c', marginBottom: 4 }}>Monthly Support Plan</div>
                      <div style={{ fontSize: 11, color: '#888', marginBottom: 10 }}>Standard is included with every subscription. Add Plus for priority support.</div>
                      {monthlySupportPlans.map(sp => {
                        const purchased = isFeatureEnabled(sp.feature_key)
                        const isStandard = sp.feature_key === 'support_standard'
                        return (
                          <div key={sp.feature_key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid #80cbc4' }}>
                            <label className="admin-toggle-switch">
                              <input
                                type="checkbox"
                                checked={isStandard ? true : purchased}
                                onChange={() => !isStandard && toggleSupportPackage(sp.feature_key, purchased)}
                                disabled={isStandard || savingFeature === sp.feature_key}
                              />
                              <span className="admin-toggle-slider" />
                            </label>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontWeight: 600, fontSize: 13 }}>{sp.display_name}{isStandard && <span style={{ marginLeft: 6, fontSize: 10, background: '#e8f5e9', color: '#2e7d32', padding: '1px 6px', borderRadius: 3, fontWeight: 600 }}>Included</span>}</div>
                              <div style={{ fontSize: 12, color: '#666' }}>{sp.description}</div>
                            </div>
                            <div style={{ fontWeight: 700, fontSize: 14, color: '#00695c' }}>
                              {isStandard ? 'Included' : `${formatCurrency(sp.flat_price ?? 0, currency)}/mo`}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {/* Individual Add-ons */}
                  {individualAddons.length > 0 && (
                    <div style={{ background: '#f3e5f5', border: '2px solid #8e24aa', borderRadius: 8, padding: 16, marginBottom: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                        <div style={{ fontWeight: 700, fontSize: 15, color: '#6a1b9a' }}>Individual Add-ons</div>
                        <span style={{ fontSize: 11, color: '#8e8e8e', fontStyle: 'italic' }}>toggles save automatically</span>
                      </div>
                      {individualAddons.map(addon => {
                        const enabled = isFeatureEnabled(addon.feature_key)
                        return (
                          <div key={addon.feature_key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid #ce93d8' }}>
                            <label className="admin-toggle-switch">
                              <input
                                type="checkbox"
                                checked={enabled}
                                onChange={() => toggleIndividualAddon(addon.feature_key, enabled)}
                                disabled={savingFeature === addon.feature_key}
                              />
                              <span className="admin-toggle-slider" />
                            </label>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontWeight: 600, fontSize: 13 }}>{addon.display_name}</div>
                              <div style={{ fontSize: 12, color: '#666' }}>{addon.description}</div>
                            </div>
                            <div style={{ fontWeight: 700, fontSize: 14, color: '#6a1b9a' }}>
                              {addon.flat_price != null ? formatCurrency(addon.flat_price, currency) : `${formatCurrency(addon.default_price, currency)}/user`}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {/* AI Usage Management */}
                  {isFeatureEnabled('ai_help_agent') && (
                    <div style={{ background: 'rgba(237,233,254,.5)', border: '2px solid #7c3aed', borderRadius: 8, padding: 16, marginBottom: 16 }}>
                      <div style={{ fontWeight: 700, fontSize: 15, color: '#7c3aed', marginBottom: 12 }}>AI Help Agent — Usage &amp; Limits</div>

                      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 12 }}>
                        <div>
                          <div style={{ fontSize: 24, fontWeight: 700, color: '#1a1a2e' }}>{aiMonthlyUsed}</div>
                          <div style={{ fontSize: 12, color: '#666' }}>Queries this month</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 24, fontWeight: 700, color: '#1a1a2e' }}>{aiMonthlyTokens.toLocaleString()}</div>
                          <div style={{ fontSize: 12, color: '#666' }}>Tokens used</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 24, fontWeight: 700, color: '#1a1a2e' }}>
                            {currencySymbol(currency)}{((aiMonthlyTokens / 1_000_000) * 0.60).toFixed(4)}
                          </div>
                          <div style={{ fontSize: 12, color: '#666' }}>Estimated cost (GPT-4o-mini)</div>
                        </div>
                      </div>

                      {aiMonthlyLimit !== null && (
                        <div style={{ marginBottom: 12 }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 4 }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: aiMonthlyUsed >= aiMonthlyLimit ? '#dc2626' : '#7c3aed' }}>
                              {aiMonthlyUsed} / {aiMonthlyLimit} queries
                            </span>
                            <span style={{ fontSize: 12, color: '#888' }}>({Math.round((aiMonthlyUsed / aiMonthlyLimit) * 100)}%)</span>
                          </div>
                          <div style={{ height: 8, borderRadius: 4, background: 'rgba(0,0,0,.08)', overflow: 'hidden' }}>
                            <div style={{
                              height: '100%',
                              borderRadius: 4,
                              width: `${Math.min(100, (aiMonthlyUsed / aiMonthlyLimit) * 100)}%`,
                              background: aiMonthlyUsed >= aiMonthlyLimit ? '#dc2626' : aiMonthlyUsed >= aiMonthlyLimit * 0.8 ? '#f59e0b' : '#7c3aed',
                              transition: 'width 0.3s ease',
                            }} />
                          </div>
                          {aiMonthlyUsed >= aiMonthlyLimit && (
                            <div style={{ fontSize: 12, color: '#dc2626', fontWeight: 600, marginTop: 4 }}>
                              Monthly limit reached — AI queries disabled until next month
                            </div>
                          )}
                        </div>
                      )}

                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, paddingTop: 12, borderTop: '1px solid #c4b5fd' }}>
                        <label style={{ fontSize: 13, fontWeight: 600, color: '#5b21b6', whiteSpace: 'nowrap' }}>Monthly query limit:</label>
                        <input
                          type="number"
                          min="0"
                          placeholder="Unlimited"
                          value={aiLimitInput}
                          onChange={e => setAiLimitInput(e.target.value)}
                          style={{ width: 120, padding: '6px 10px', borderRadius: 6, border: '1px solid #c4b5fd', fontSize: 14 }}
                        />
                        <button
                          className="admin-btn admin-btn-sm"
                          disabled={aiLimitSaving}
                          onClick={async () => {
                            if (!selectedCompanyId) return
                            setAiLimitSaving(true)
                            const newLimit = aiLimitInput.trim() === '' ? null : parseInt(aiLimitInput)
                            await supabase.from('company_features').update({ monthly_query_limit: newLimit }).eq('company_id', selectedCompanyId).eq('feature_key', 'ai_help_agent')
                            setAiMonthlyLimit(newLimit)
                            setAiLimitSaving(false)
                            showSuccess(newLimit !== null ? `Monthly AI limit set to ${newLimit} queries` : 'Monthly AI limit removed (unlimited)')
                          }}
                        >
                          {aiLimitSaving ? 'Saving...' : 'Set Limit'}
                        </button>
                      </div>

                      <div style={{ marginTop: 10, fontSize: 12, color: '#666', lineHeight: 1.6 }}>
                        <strong>Cost reference:</strong> GPT-4o-mini pricing is ~$0.15/million input + $0.60/million output tokens.
                        Average query uses ~800 tokens total ≈ $0.0004 per query.
                        {aiMonthlyLimit !== null && (
                          <span> At {aiMonthlyLimit} queries/month, estimated max cost: {currencySymbol(currency)}{(aiMonthlyLimit * 0.0004).toFixed(2)}/month.</span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Monthly Platform Fee */}
                  <div style={{ background: '#e3f2fd', border: '2px solid #1565c0', borderRadius: 8, padding: 16, marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: '#1565c0' }}>Monthly Platform Fee</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ fontWeight: 600 }}>{currencySymbol(currency)}</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          className="admin-input"
                          style={{ width: 120, fontWeight: 700, fontSize: 16, textAlign: 'center' }}
                          value={monthlyPlatformFee}
                          onChange={e => setMonthlyPlatformFee(e.target.value)}
                        />
                        <span style={{ fontSize: 12, color: '#666' }}>/month</span>
                      </div>
                      <span style={{ fontSize: 12, color: '#666' }}>Flat charge per company (not per user)</span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '16px 0' }}>
                    <button
                      className="admin-btn admin-btn-primary"
                      onClick={saveAllCustomPrices}
                      disabled={savingAllPrices || !hasUnsavedChanges}
                    >
                      {savingAllPrices ? 'Saving...' : 'Save Settings'}
                    </button>
                    {hasUnsavedChanges && (
                      <span style={{ fontSize: 12, color: '#e65100', fontWeight: 600 }}>Unsaved changes</span>
                    )}
                  </div>

                  {/* Monthly Financial Breakdown */}
                  <div className="admin-table-wrap">
                    <table className="sub-cost-table">
                      <thead>
                        <tr>
                          <th>Item</th>
                          <th>Price</th>
                          <th>Users</th>
                          <th>Monthly Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {corePricing && (
                          <tr>
                            <td>Core Features</td>
                            <td>{formatCurrency(getEffectivePrice('hr_core'), currency)}/user</td>
                            <td>{employeeCount}</td>
                            <td>{formatCurrency(coreCost, currency)}</td>
                          </tr>
                        )}
                        {packAEnabled && packAPricing && (
                          <tr>
                            <td>Pack A: People Operations</td>
                            <td>{formatCurrency(getEffectivePrice('pack_a'), currency)}/user</td>
                            <td>{employeeCount}</td>
                            <td>{formatCurrency(packACost, currency)}</td>
                          </tr>
                        )}
                        {packBEnabled && packBPricing && (
                          <tr>
                            <td>Pack B: Pro Integrations</td>
                            <td>{formatCurrency(getEffectivePrice('pack_b'), currency)}/user</td>
                            <td>{employeeCount}</td>
                            <td>{formatCurrency(packBCost, currency)}</td>
                          </tr>
                        )}
                        {supportPackages.filter(sp => isFeatureEnabled(sp.feature_key)).map(sp => (
                          <tr key={sp.feature_key}>
                            <td>{sp.display_name}</td>
                            <td>{formatCurrency(sp.flat_price ?? 0, currency)} flat</td>
                            <td>—</td>
                            <td>{formatCurrency(sp.flat_price ?? 0, currency)}</td>
                          </tr>
                        ))}
                        {individualAddons.filter(a => isFeatureEnabled(a.feature_key)).map(a => (
                          <tr key={a.feature_key}>
                            <td>{a.display_name}</td>
                            <td>{a.flat_price != null ? `${formatCurrency(a.flat_price, currency)} flat` : `${formatCurrency(a.default_price, currency)}/user`}</td>
                            <td>{a.flat_price != null ? '—' : String(employeeCount)}</td>
                            <td>{formatCurrency(a.flat_price != null ? a.flat_price : a.default_price * employeeCount, currency)}</td>
                          </tr>
                        ))}
                        <tr>
                          <td>Platform Fee</td>
                          <td>{formatCurrency(platformFee, currency)} flat</td>
                          <td>—</td>
                          <td>{formatCurrency(platformFee, currency)}</td>
                        </tr>
                        <tr className="sub-cost-total">
                          <td>Total</td>
                          <td></td>
                          <td></td>
                          <td>{formatCurrency(totalCost, currency)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {/* Feature Change History */}
                  {changeLog.length > 0 && (
                    <div style={{ marginTop: 24 }}>
                      <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, color: '#333' }}>Feature Change History</h4>
                      <div className="admin-table-wrap">
                        <table className="admin-table" style={{ fontSize: 12 }}>
                          <thead>
                            <tr>
                              <th>Date</th>
                              <th>Feature</th>
                              <th>Action</th>
                              <th>Price</th>
                              <th>Employees</th>
                              <th>Notes</th>
                            </tr>
                          </thead>
                          <tbody>
                            {changeLog.map(log => (
                              <tr key={log.id}>
                                <td style={{ whiteSpace: 'nowrap' }}>{formatUKDate(log.changed_at)}</td>
                                <td>{log.feature_key === 'pack_a' ? 'People Operations' : log.feature_key === 'pack_b' ? 'Pro Integrations' : log.feature_key}</td>
                                <td>
                                  <span style={{
                                    fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 8,
                                    background: log.action === 'enabled' ? '#e8f5e9' : log.action === 'grace_cancelled' ? '#fff3e0' : log.action === 'scheduled_cancel' ? '#ffebee' : '#f5f5f5',
                                    color: log.action === 'enabled' ? '#2e7d32' : log.action === 'grace_cancelled' ? '#e65100' : log.action === 'scheduled_cancel' ? '#c62828' : '#666'
                                  }}>
                                    {log.action.replace(/_/g, ' ')}
                                  </span>
                                </td>
                                <td>{log.effective_price != null ? formatCurrency(log.effective_price, currency) : '—'}</td>
                                <td>{log.employee_count ?? '—'}</td>
                                <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{log.notes || '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {changeLogLoading && <div style={{ fontSize: 12, color: '#999', marginTop: 6 }}>Loading...</div>}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'companies' && <AdminCompanies />}
      {tab === 'trial-requests' && <AdminTrialRequests />}
      {tab === 'support-access' && <AdminSupportAccess />}
      {tab === 'audit-log' && (
        <>
          <EmployeeAuditControls companies={companies} showSuccess={showSuccess} showError={showError} />
          <AdminAuditLog />
        </>
      )}
    </div>
  )
}

/* ─── Employee Audit Controls (super admin) ─── */

function EmployeeAuditControls({
  companies,
  showSuccess,
  showError,
}: {
  companies: CompanyOption[]
  showSuccess: (msg: string) => void
  showError: (msg: string) => void
}) {
  const [auditToggleCompanyId, setAuditToggleCompanyId] = useState('')
  const [auditLoggingEnabled, setAuditLoggingEnabled] = useState(true)
  const [togglingAudit, setTogglingAudit] = useState(false)

  const [clearCompanyId, setClearCompanyId] = useState('')
  const [clearBefore, setClearBefore] = useState('')
  const [clearing, setClearing] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)

  const loadAuditSetting = useCallback(async (companyId: string) => {
    if (!companyId) return
    const { data } = await supabase
      .from('companies')
      .select('employee_audit_logging')
      .eq('id', companyId)
      .single()
    if (data) setAuditLoggingEnabled(data.employee_audit_logging ?? true)
  }, [])

  useEffect(() => {
    if (auditToggleCompanyId) loadAuditSetting(auditToggleCompanyId)
  }, [auditToggleCompanyId, loadAuditSetting])

  async function toggleAuditLogging() {
    if (!auditToggleCompanyId) return
    setTogglingAudit(true)
    const newVal = !auditLoggingEnabled
    const { error } = await supabase
      .from('companies')
      .update({ employee_audit_logging: newVal })
      .eq('id', auditToggleCompanyId)
    if (error) {
      showError('Failed to update audit logging: ' + error.message)
    } else {
      setAuditLoggingEnabled(newVal)
      showSuccess(`Employee audit logging ${newVal ? 'enabled' : 'disabled'}`)
    }
    setTogglingAudit(false)
  }

  async function handleClearLogs() {
    if (!clearBefore) { showError('Please select a date'); return }
    setClearing(true)
    const { data, error } = await callRpcDirect('clear_employee_audit_logs', {
      p_before: new Date(clearBefore + 'T00:00:00Z').toISOString(),
      p_company_id: clearCompanyId || null,
    })
    if (error) {
      showError('Failed to clear logs: ' + (error as any).message)
    } else {
      const count = typeof data === 'number' ? data : 0
      showSuccess(`Cleared ${count} employee audit log${count !== 1 ? 's' : ''}`)
    }
    setClearing(false)
    setConfirmClear(false)
  }

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        {/* Toggle audit logging per company */}
        <div style={{ background: '#f8f9fc', border: '1px solid #e5e7eb', borderRadius: 10, padding: 16 }}>
          <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700, color: '#333' }}>Employee Audit Logging</h4>
          <p style={{ fontSize: 12, color: '#8b8fa3', margin: '0 0 12px' }}>
            Toggle employee change logging per company. When disabled, employee edits are not recorded.
          </p>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <select className="admin-select" style={{ minWidth: 200, fontSize: 13 }} value={auditToggleCompanyId} onChange={e => setAuditToggleCompanyId(e.target.value)}>
              <option value="">Select company...</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {auditToggleCompanyId && (
              <>
                <label className="admin-toggle-switch">
                  <input type="checkbox" checked={auditLoggingEnabled} onChange={toggleAuditLogging} disabled={togglingAudit} />
                  <span className="admin-toggle-slider" />
                </label>
                <span style={{ fontSize: 13, fontWeight: 600, color: auditLoggingEnabled ? '#2e7d32' : '#c62828' }}>
                  {auditLoggingEnabled ? 'Enabled' : 'Disabled'}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Clear employee logs */}
        <div style={{ background: '#fff5f5', border: '1px solid #fecaca', borderRadius: 10, padding: 16 }}>
          <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700, color: '#c62828' }}>Clear Employee Logs</h4>
          <p style={{ fontSize: 12, color: '#8b8fa3', margin: '0 0 12px' }}>
            Permanently delete employee UPDATE audit logs before a given date. This cannot be undone.
          </p>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <select className="admin-select" style={{ minWidth: 200, fontSize: 13 }} value={clearCompanyId} onChange={e => setClearCompanyId(e.target.value)}>
              <option value="">All companies</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#8b8fa3', display: 'block', marginBottom: 2 }}>Clear before</label>
              <input className="admin-input" type="date" style={{ fontSize: 13 }} value={clearBefore} onChange={e => setClearBefore(e.target.value)} />
            </div>
            {!confirmClear ? (
              <button
                className="admin-btn"
                style={{ background: '#c62828', color: '#fff', border: 'none', fontWeight: 700, fontSize: 13, padding: '8px 16px', borderRadius: 6, cursor: 'pointer' }}
                onClick={() => { if (!clearBefore) { showError('Please select a date'); return } setConfirmClear(true) }}
                disabled={!clearBefore}
              >
                Clear Logs
              </button>
            ) : (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: '#c62828', fontWeight: 600 }}>Are you sure?</span>
                <button
                  className="admin-btn"
                  style={{ background: '#c62828', color: '#fff', border: 'none', fontWeight: 700, fontSize: 13, padding: '8px 16px', borderRadius: 6, cursor: 'pointer' }}
                  onClick={handleClearLogs}
                  disabled={clearing}
                >
                  {clearing ? 'Clearing...' : 'Yes, Delete'}
                </button>
                <button className="admin-btn-sm" onClick={() => setConfirmClear(false)} style={{ fontSize: 12 }}>Cancel</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
