import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import AdminCompanies from './AdminCompanies'
import AdminDemoSeed from './AdminDemoSeed'

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
  const [tab, setTab] = useState<'pricing' | 'features' | 'companies' | 'demo-seed'>('pricing')

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
  const [savingFeature, setSavingFeature] = useState<string | null>(null)

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

  // Load companies
  async function loadCompanies() {
    const { data } = await supabase
      .from('companies')
      .select('id, name')
      .eq('is_active', true)
      .order('name')
    setCompanies((data as CompanyOption[]) || [])
  }

  // Load company features
  async function loadCompanyFeatures(companyId: string) {
    setFeaturesLoading(true)
    const company = companies.find(c => c.id === companyId)
    setCompanyName(company?.name || '')

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

  // Save custom price
  async function saveCustomPrice(featureKey: string) {
    if (!selectedCompanyId) return
    setSavingFeature(featureKey)
    const existing = companyFeatures.find(f => f.feature_key === featureKey)
    const customPrice = customPrices[featureKey]
    await supabase
      .from('company_features')
      .upsert(
        {
          company_id: selectedCompanyId,
          feature_key: featureKey,
          is_enabled: existing?.is_enabled ?? false,
          custom_price: customPrice ? parseFloat(customPrice) : null,
        },
        { onConflict: 'company_id,feature_key' }
      )
    await loadCompanyFeatures(selectedCompanyId)
    setSavingFeature(null)
  }

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
          onClick={() => setTab('features')}
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

                  {/* Add-on feature toggles */}
                  {addons.map(addon => {
                    const enabled = isFeatureEnabled(addon.feature_key)
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
                          <div className="sub-feature-name">{addon.display_name}</div>
                          <div className="sub-feature-desc">{addon.description}</div>
                        </div>
                        <div className="sub-feature-price">
                          <label>Custom £</label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder={String(addon.default_price)}
                            value={customPrices[addon.feature_key] ?? ''}
                            onChange={e =>
                              setCustomPrices(prev => ({
                                ...prev,
                                [addon.feature_key]: e.target.value,
                              }))
                            }
                            onBlur={() => saveCustomPrice(addon.feature_key)}
                          />
                        </div>
                      </div>
                    )
                  })}

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
    </div>
  )
}
