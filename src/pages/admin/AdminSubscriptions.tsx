import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import AdminCompanies from './AdminCompanies'
import AdminDemoSeed from './AdminDemoSeed'
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
}

interface CompanyOption {
  id: string
  name: string
  billing_type: string
  fixed_annual_price: number | null
  billing_type_locked_until: string | null
  fy_start_month: number
}

interface CompanyFeature {
  id: string
  company_id: string
  feature_key: string
  is_enabled: boolean
  custom_price: number | null
  created_at: string
}

export default function AdminSubscriptions() {
  const { isSuperAdmin } = useAuth()
  const { showSuccess, showError } = useToast()
  const [tab, setTab] = useState<'pricing' | 'features' | 'companies' | 'demo-seed' | 'support-access' | 'audit-log'>('pricing')

  // Pricing state
  const [pricing, setPricing] = useState<PricingItem[]>([])
  const [pricingLoading, setPricingLoading] = useState(true)
  const [editPrices, setEditPrices] = useState<Record<string, string>>({})
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

  // Load pricing
  async function loadPricing() {
    setPricingLoading(true)
    const { data } = await supabase
      .from('subscription_pricing')
      .select('*')
      .order('is_addon, display_name')
    const items = (data as PricingItem[]) || []
    setPricing(items)
    const prices: Record<string, string> = {}
    items.forEach(p => { prices[p.id] = String(p.default_price) })
    setEditPrices(prices)
    setPricingLoading(false)
  }

  // Load companies (include inactive so newly registered companies appear)
  async function loadCompanies() {
    const { data } = await supabase
      .from('companies')
      .select('id, name, billing_type, fixed_annual_price, billing_type_locked_until, fy_start_month')
      .order('name')
    setCompanies((data as CompanyOption[]) || [])
  }

  // Load company features
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

    const { count } = await supabase
      .from('employees')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('is_active', true)
    setEmployeeCount(count || 0)

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
    setFeaturesLoading(false)
  }

  useEffect(() => {
    loadPricing()
    loadCompanies()
  }, [])

  useEffect(() => {
    if (selectedCompanyId) loadCompanyFeatures(selectedCompanyId)
  }, [selectedCompanyId])

  // Save pricing item
  async function savePricingItem(item: PricingItem) {
    setSavingPricing(item.id)
    const newPrice = parseFloat(editPrices[item.id] || '0')
    await supabase
      .from('subscription_pricing')
      .update({ default_price: newPrice })
      .eq('id', item.id)
    await loadPricing()
    setSavingPricing(null)
  }

  // Toggle pricing active
  async function togglePricingActive(item: PricingItem) {
    await supabase
      .from('subscription_pricing')
      .update({ is_active: !item.is_active })
      .eq('id', item.id)
    await loadPricing()
  }

  // Toggle company feature
  async function toggleFeature(featureKey: string, currentlyEnabled: boolean) {
    if (!selectedCompanyId) return
    setSavingFeature(featureKey)
    const customPrice = customPrices[featureKey]
    const { error } = await supabase
      .from('company_features')
      .upsert(
        {
          company_id: selectedCompanyId,
          feature_key: featureKey,
          is_enabled: !currentlyEnabled,
          custom_price: customPrice ? parseFloat(customPrice) : null,
        },
        { onConflict: 'company_id,feature_key' }
      )
    if (error) alert('Failed to update feature: ' + error.message)
    await loadCompanyFeatures(selectedCompanyId)
    setSavingFeature(null)
  }

  // Save all custom prices + billing type at once
  async function saveAllCustomPrices() {
    if (!selectedCompanyId) return
    setSavingAllPrices(true)

    const allFeatureKeys = pricing.map(p => p.feature_key)
    let errorCount = 0

    for (const featureKey of allFeatureKeys) {
      const existing = companyFeatures.find(f => f.feature_key === featureKey)
      const pricingItem = pricing.find(p => p.feature_key === featureKey)
      const isCore = pricingItem && !pricingItem.is_addon
      const customPrice = customPrices[featureKey]
      const { error } = await supabase
        .from('company_features')
        .upsert(
          {
            company_id: selectedCompanyId,
            feature_key: featureKey,
            is_enabled: existing?.is_enabled ?? isCore ?? false,
            custom_price: customPrice ? parseFloat(customPrice) : null,
          },
          { onConflict: 'company_id,feature_key' }
        )
      if (error) errorCount++
    }

    // Save billing type and fixed price to companies table
    const companyUpdate: Record<string, unknown> = {
      billing_type: billingType,
      fixed_annual_price: billingType === 'fixed' && fixedAnnualPrice ? parseFloat(fixedAnnualPrice) : null,
    }

    // When switching to fixed, lock until start of next FY
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
  const hasUnsavedChanges = hasPriceChanges || hasBillingChanges

  const isLockedToFixed = billingType === 'fixed' && billingTypeLocked && new Date(billingTypeLocked) > new Date()

  // Helpers for cost table
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

  const baseline = pricing.find(p => !p.is_addon)
  const addons = pricing.filter(p => p.is_addon)
  const enabledAddons = addons.filter(a => isFeatureEnabled(a.feature_key))

  const baselineCost = baseline ? getEffectivePrice(baseline.feature_key) * employeeCount : 0
  const totalCost = enabledAddons.reduce(
    (sum, a) => sum + getEffectivePrice(a.feature_key) * employeeCount,
    baselineCost
  )

  return (
    <div className="admin-section">
      <div className="admin-page-header">
        <h2>Subscription Management</h2>
        <p>Manage pricing and company feature assignments</p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '2px solid #e5e7eb' }}>
        <button
          onClick={() => setTab('pricing')}
          style={{
            padding: '10px 24px',
            border: 'none',
            background: 'none',
            fontWeight: 700,
            fontSize: 14,
            cursor: 'pointer',
            borderBottom: tab === 'pricing' ? '3px solid #1565c0' : '3px solid transparent',
            color: tab === 'pricing' ? '#1565c0' : '#8b8fa3',
            marginBottom: -2,
          }}
        >
          Pricing
        </button>
        <button
          onClick={() => { setTab('features'); loadCompanies() }}
          style={{
            padding: '10px 24px',
            border: 'none',
            background: 'none',
            fontWeight: 700,
            fontSize: 14,
            cursor: 'pointer',
            borderBottom: tab === 'features' ? '3px solid #1565c0' : '3px solid transparent',
            color: tab === 'features' ? '#1565c0' : '#8b8fa3',
            marginBottom: -2,
          }}
        >
          Company Features
        </button>
        <button
          onClick={() => setTab('companies')}
          style={{
            padding: '10px 24px',
            border: 'none',
            background: 'none',
            fontWeight: 700,
            fontSize: 14,
            cursor: 'pointer',
            borderBottom: tab === 'companies' ? '3px solid #1565c0' : '3px solid transparent',
            color: tab === 'companies' ? '#1565c0' : '#8b8fa3',
            marginBottom: -2,
          }}
        >
          Companies
        </button>
        <button
          onClick={() => setTab('demo-seed')}
          style={{
            padding: '10px 24px',
            border: 'none',
            background: 'none',
            fontWeight: 700,
            fontSize: 14,
            cursor: 'pointer',
            borderBottom: tab === 'demo-seed' ? '3px solid #1565c0' : '3px solid transparent',
            color: tab === 'demo-seed' ? '#1565c0' : '#8b8fa3',
            marginBottom: -2,
          }}
        >
          Demo Seed
        </button>
        <button
          onClick={() => setTab('support-access')}
          style={{
            padding: '10px 24px',
            border: 'none',
            background: 'none',
            fontWeight: 700,
            fontSize: 14,
            cursor: 'pointer',
            borderBottom: tab === 'support-access' ? '3px solid #1565c0' : '3px solid transparent',
            color: tab === 'support-access' ? '#1565c0' : '#8b8fa3',
            marginBottom: -2,
          }}
        >
          Support Access
        </button>
        <button
          onClick={() => setTab('audit-log')}
          style={{
            padding: '10px 24px',
            border: 'none',
            background: 'none',
            fontWeight: 700,
            fontSize: 14,
            cursor: 'pointer',
            borderBottom: tab === 'audit-log' ? '3px solid #1565c0' : '3px solid transparent',
            color: tab === 'audit-log' ? '#1565c0' : '#8b8fa3',
            marginBottom: -2,
          }}
        >
          Audit Log
        </button>
      </div>

      {/* Pricing Tab */}
      {tab === 'pricing' && (
        <>
          {pricingLoading ? (
            <div className="admin-loading">Loading...</div>
          ) : (
            <div className="sub-pricing-grid">
              {pricing.map(item => (
                <div
                  key={item.id}
                  className={`sub-pricing-card ${item.is_addon ? 'sub-pricing-card-addon' : 'sub-pricing-card-baseline'}`}
                >
                  <div className="sub-pricing-name">{item.display_name}</div>
                  <div className="sub-pricing-desc">{item.description}</div>
                  <div className="sub-pricing-input-row">
                    <label>Price</label>
                    <span>£</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="sub-pricing-input"
                      value={editPrices[item.id] || ''}
                      onChange={e =>
                        setEditPrices(prev => ({ ...prev, [item.id]: e.target.value }))
                      }
                    />
                    <span>/user/month</span>
                  </div>
                  <div className="sub-pricing-actions">
                    <label className="admin-toggle-switch">
                      <input
                        type="checkbox"
                        checked={item.is_active}
                        onChange={() => togglePricingActive(item)}
                      />
                      <span className="admin-toggle-slider" />
                    </label>
                    <button
                      className="sub-pricing-save"
                      onClick={() => savePricingItem(item)}
                      disabled={savingPricing === item.id}
                    >
                      {savingPricing === item.id ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              ))}
              {pricing.length === 0 && (
                <div className="admin-empty">No pricing items found</div>
              )}
            </div>
          )}
        </>
      )}

      {/* Company Features Tab */}
      {tab === 'features' && (
        <>
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
                        <label style={{ fontWeight: 600, fontSize: 13 }}>Annual Price £</label>
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

                  {/* Baseline Subscription */}
                  {baseline && (
                    <div style={{ background: '#f8faff', border: '2px solid #1565c0', borderRadius: 8, padding: 16, marginBottom: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                        <span style={{ fontSize: 16 }}>&#9733;</span>
                        <span style={{ fontWeight: 700, fontSize: 15, color: '#1565c0' }}>Baseline Subscription</span>
                        {customPrices[baseline.feature_key] && customPrices[baseline.feature_key] !== '' && (
                          <span style={{ fontSize: 10, background: '#e3f2fd', color: '#1565c0', padding: '2px 8px', borderRadius: 3, fontWeight: 600 }}>Custom Rate</span>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: 200 }}>
                          <div style={{ fontWeight: 600, fontSize: 14 }}>{baseline.display_name}</div>
                          <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>{baseline.description}</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: 11, color: '#999', fontWeight: 600 }}>Default</div>
                            <div style={{ fontSize: 16, fontWeight: 700, color: '#999' }}>&pound;{baseline.default_price.toFixed(2)}</div>
                          </div>
                          <div style={{ fontSize: 18, color: '#ccc' }}>&rarr;</div>
                          <div>
                            <div style={{ fontSize: 11, color: '#1565c0', fontWeight: 600 }}>Company Price</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <span style={{ fontWeight: 600 }}>&pound;</span>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                className="admin-input"
                                style={{ width: 100, fontWeight: 700, fontSize: 16, textAlign: 'center' }}
                                placeholder={baseline.default_price.toFixed(2)}
                                value={customPrices[baseline.feature_key] ?? ''}
                                onChange={e =>
                                  setCustomPrices(prev => ({
                                    ...prev,
                                    [baseline.feature_key]: e.target.value,
                                  }))
                                }
                              />
                              <span style={{ fontSize: 12, color: '#666' }}>/user/month</span>
                            </div>
                          </div>
                        </div>
                      </div>
                      {customPrices[baseline.feature_key] && customPrices[baseline.feature_key] !== '' && (
                        <div style={{ marginTop: 8, fontSize: 12, color: '#1565c0' }}>
                          Monthly baseline cost: &pound;{(parseFloat(customPrices[baseline.feature_key] || '0') * employeeCount).toFixed(2)} ({employeeCount} user{employeeCount !== 1 ? 's' : ''} &times; &pound;{parseFloat(customPrices[baseline.feature_key] || '0').toFixed(2)})
                          {parseFloat(customPrices[baseline.feature_key]) < baseline.default_price && <span style={{ marginLeft: 8, color: '#43a047' }}>&#9660; {((1 - parseFloat(customPrices[baseline.feature_key]) / baseline.default_price) * 100).toFixed(0)}% discount</span>}
                          {parseFloat(customPrices[baseline.feature_key]) > baseline.default_price && <span style={{ marginLeft: 8, color: '#e65100' }}>&#9650; {((parseFloat(customPrices[baseline.feature_key]) / baseline.default_price - 1) * 100).toFixed(0)}% premium</span>}
                        </div>
                      )}
                      {(!customPrices[baseline.feature_key] || customPrices[baseline.feature_key] === '') && (
                        <div style={{ marginTop: 8, fontSize: 12, color: '#999' }}>
                          Using default rate: &pound;{(baseline.default_price * employeeCount).toFixed(2)}/month ({employeeCount} user{employeeCount !== 1 ? 's' : ''} &times; &pound;{baseline.default_price.toFixed(2)})
                        </div>
                      )}
                    </div>
                  )}

                  {/* Add-on feature toggles */}
                  {addons.map(addon => {
                    const enabled = isFeatureEnabled(addon.feature_key)
                    const hasCustom = customPrices[addon.feature_key] && customPrices[addon.feature_key] !== ''
                    return (
                      <div key={addon.feature_key} className="sub-feature-card">
                        <label className="admin-toggle-switch">
                          <input
                            type="checkbox"
                            checked={enabled}
                            onChange={() => toggleFeature(addon.feature_key, enabled)}
                            disabled={savingFeature === addon.feature_key}
                          />
                          <span className="admin-toggle-slider" />
                        </label>
                        <div className="sub-feature-info">
                          <div className="sub-feature-name">
                            {addon.display_name}
                            {hasCustom && <span style={{ marginLeft: 6, fontSize: 10, background: '#e3f2fd', color: '#1565c0', padding: '1px 5px', borderRadius: 3, fontWeight: 600 }}>Custom</span>}
                          </div>
                          <div className="sub-feature-desc">{addon.description}</div>
                        </div>
                        <div className="sub-feature-price" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 11, color: '#999' }}>Default £{addon.default_price.toFixed(2)}</span>
                          <label>Custom £</label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder={addon.default_price.toFixed(2)}
                            value={customPrices[addon.feature_key] ?? ''}
                            onChange={e =>
                              setCustomPrices(prev => ({
                                ...prev,
                                [addon.feature_key]: e.target.value,
                              }))
                            }
                          />
                        </div>
                      </div>
                    )
                  })}

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
                  <table className="sub-cost-table">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Price/User</th>
                        <th>Users</th>
                        <th>Monthly Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {baseline && (
                        <tr>
                          <td>{baseline.display_name}</td>
                          <td>£{getEffectivePrice(baseline.feature_key).toFixed(2)}</td>
                          <td>{employeeCount}</td>
                          <td>£{baselineCost.toFixed(2)}</td>
                        </tr>
                      )}
                      {enabledAddons.map(addon => {
                        const price = getEffectivePrice(addon.feature_key)
                        return (
                          <tr key={addon.feature_key}>
                            <td>{addon.display_name}</td>
                            <td>£{price.toFixed(2)}</td>
                            <td>{employeeCount}</td>
                            <td>£{(price * employeeCount).toFixed(2)}</td>
                          </tr>
                        )
                      })}
                      <tr className="sub-cost-total">
                        <td>Total</td>
                        <td></td>
                        <td></td>
                        <td>£{totalCost.toFixed(2)}</td>
                      </tr>
                    </tbody>
                  </table>
                </>
              )}
            </>
          )}
        </>
      )}

      {/* Companies Tab */}
      {tab === 'companies' && <AdminCompanies />}

      {/* Demo Seed Tab */}
      {tab === 'demo-seed' && <AdminDemoSeed />}

      {/* Support Access Tab */}
      {tab === 'support-access' && <AdminSupportAccess />}

      {/* Audit Log Tab */}
      {tab === 'audit-log' && <AdminAuditLog />}
    </div>
  )
}
