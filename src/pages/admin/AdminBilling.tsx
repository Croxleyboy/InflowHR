import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useAdminCompany } from '../../context/AdminCompanyContext'

interface PricingRow {
  id: string
  feature_key: string
  display_name: string
  description: string
  default_price: number
  is_addon: boolean
  is_active: boolean
}

interface CompanyFeature {
  id: string
  company_id: string
  feature_key: string
  is_enabled: boolean
  custom_price: number | null
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export default function AdminBilling() {
  const { isSuperAdmin } = useAuth()
  const { selectedCompanyId, companies } = useAdminCompany()

  if (isSuperAdmin) return <SuperAdminBilling companies={companies} />
  return <CompanyBilling companyId={selectedCompanyId} />
}

function CompanyBilling({ companyId }: { companyId: string }) {
  const [pricing, setPricing] = useState<PricingRow[]>([])
  const [features, setFeatures] = useState<CompanyFeature[]>([])
  const [employeeCount, setEmployeeCount] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (companyId) load()
  }, [companyId])

  async function load() {
    setLoading(true)
    const [pricingRes, featuresRes, countRes] = await Promise.all([
      supabase.from('subscription_pricing').select('*').eq('is_active', true),
      supabase.from('company_features').select('*').eq('company_id', companyId),
      supabase.from('employees').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('is_active', true),
    ])
    setPricing((pricingRes.data as PricingRow[]) || [])
    setFeatures((featuresRes.data as CompanyFeature[]) || [])
    setEmployeeCount(countRes.count ?? 0)
    setLoading(false)
  }

  const baseline = useMemo(() => pricing.find(p => !p.is_addon), [pricing])
  const enabledAddons = useMemo(() => {
    const enabledKeys = new Set(features.filter(f => f.is_enabled).map(f => f.feature_key))
    return pricing.filter(p => p.is_addon && enabledKeys.has(p.feature_key))
  }, [pricing, features])

  function effectivePrice(pr: PricingRow): number {
    const cf = features.find(f => f.feature_key === pr.feature_key)
    return cf?.custom_price != null ? cf.custom_price : pr.default_price
  }

  const baselinePrice = baseline ? effectivePrice(baseline) : 0
  const addonTotal = enabledAddons.reduce((sum, a) => sum + effectivePrice(a), 0)
  const perUserTotal = baselinePrice + addonTotal
  const monthlyTotal = perUserTotal * employeeCount

  const chartData = useMemo(() => {
    const now = new Date()
    const months: { label: string; core: number; addons: number; isCurrent: boolean }[] = []
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      months.push({
        label: MONTH_LABELS[d.getMonth()],
        core: baselinePrice * employeeCount,
        addons: addonTotal * employeeCount,
        isCurrent: i === 0,
      })
    }
    return months
  }, [baselinePrice, addonTotal, employeeCount])

  const maxAmount = Math.max(...chartData.map(m => m.core + m.addons), 1)

  if (loading) return <div className="admin-section"><div className="admin-loading">Loading...</div></div>

  return (
    <div className="admin-section">
      <div className="admin-page-header">
        <h2>Billing &amp; Subscription</h2>
        <p>Financial overview for your company</p>
      </div>

      <div className="billing-summary">
        <div className="billing-card">
          <span className="billing-card-label">Core Plan</span>
          <span className="billing-card-value">&pound;{baselinePrice.toFixed(2)}</span>
          <span className="billing-card-sub">per user / month</span>
        </div>
        <div className="billing-card">
          <span className="billing-card-label">Feature Add-ons</span>
          <span className="billing-card-value">&pound;{addonTotal.toFixed(2)}</span>
          <span className="billing-card-sub">{enabledAddons.length} active add-on{enabledAddons.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="billing-card">
          <span className="billing-card-label">Employees</span>
          <span className="billing-card-value">{employeeCount}</span>
          <span className="billing-card-sub">active users</span>
        </div>
        <div className="billing-card billing-card-highlight">
          <span className="billing-card-label">Monthly Total</span>
          <span className="billing-card-value">&pound;{monthlyTotal.toFixed(2)}</span>
          <span className="billing-card-sub">&pound;{perUserTotal.toFixed(2)} &times; {employeeCount} users</span>
        </div>
      </div>

      {enabledAddons.length > 0 && (
        <div className="billing-addons">
          {enabledAddons.map(a => (
            <span key={a.feature_key} className="billing-addon-chip">
              {a.display_name} &mdash; &pound;{effectivePrice(a).toFixed(2)}
            </span>
          ))}
        </div>
      )}

      <div className="billing-chart">
        <h3>Monthly Cost Breakdown (Last 12 Months)</h3>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8, fontSize: 12 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: '#1565c0', display: 'inline-block' }} />
            Core
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: '#7b1fa2', display: 'inline-block' }} />
            Add-ons
          </span>
        </div>
        <div className="billing-chart-bars">
          {chartData.map((m, i) => (
            <div key={i} className="billing-chart-bar-wrap">
              <div style={{ position: 'relative', width: '100%' }}>
                <span className="billing-chart-amount" style={{ width: '100%', textAlign: 'center' }}>
                  &pound;{(m.core + m.addons).toFixed(0)}
                </span>
                <div style={{ display: 'flex', flexDirection: 'column-reverse' }}>
                  <div
                    className="billing-chart-bar"
                    style={{ height: `${(m.core / maxAmount) * 170}px`, background: '#1565c0', borderRadius: '4px 4px 0 0' }}
                  />
                  {m.addons > 0 && (
                    <div
                      style={{ height: `${(m.addons / maxAmount) * 170}px`, background: '#7b1fa2', borderRadius: '4px 4px 0 0' }}
                    />
                  )}
                </div>
              </div>
              <span className="billing-chart-label">{m.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Feature</th>
              <th>Type</th>
              <th>Price / User</th>
              <th>Monthly Cost</th>
            </tr>
          </thead>
          <tbody>
            {baseline && (
              <tr>
                <td>{baseline.display_name}</td>
                <td><span className="admin-badge admin-badge-approved">Core</span></td>
                <td>&pound;{effectivePrice(baseline).toFixed(2)}</td>
                <td>&pound;{(effectivePrice(baseline) * employeeCount).toFixed(2)}</td>
              </tr>
            )}
            {enabledAddons.map(a => (
              <tr key={a.feature_key}>
                <td>{a.display_name}</td>
                <td><span className="admin-badge admin-badge-pending">Add-on</span></td>
                <td>&pound;{effectivePrice(a).toFixed(2)}</td>
                <td>&pound;{(effectivePrice(a) * employeeCount).toFixed(2)}</td>
              </tr>
            ))}
            <tr style={{ fontWeight: 700 }}>
              <td>Monthly Total</td>
              <td></td>
              <td></td>
              <td>&pound;{monthlyTotal.toFixed(2)}</td>
            </tr>
            <tr style={{ fontWeight: 700 }}>
              <td>Annual Estimate</td>
              <td></td>
              <td></td>
              <td>&pound;{(monthlyTotal * 12).toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SuperAdminBilling({ companies }: { companies: { id: string; name: string }[] }) {
  const [pricing, setPricing] = useState<PricingRow[]>([])
  const [allFeatures, setAllFeatures] = useState<CompanyFeature[]>([])
  const [employeeCounts, setEmployeeCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [companies])

  async function load() {
    if (companies.length === 0) return
    setLoading(true)
    const [pricingRes, featuresRes] = await Promise.all([
      supabase.from('subscription_pricing').select('*').eq('is_active', true),
      supabase.from('company_features').select('*'),
    ])
    setPricing((pricingRes.data as PricingRow[]) || [])
    setAllFeatures((featuresRes.data as CompanyFeature[]) || [])

    const counts: Record<string, number> = {}
    const batchSize = 10
    for (let i = 0; i < companies.length; i += batchSize) {
      const batch = companies.slice(i, i + batchSize)
      const results = await Promise.all(
        batch.map(c =>
          supabase.from('employees').select('id', { count: 'exact', head: true }).eq('company_id', c.id).eq('is_active', true)
        )
      )
      batch.forEach((c, idx) => { counts[c.id] = results[idx].count ?? 0 })
    }
    setEmployeeCounts(counts)
    setLoading(false)
  }

  const companyData = useMemo(() => {
    const baseline = pricing.find(p => !p.is_addon)
    const addons = pricing.filter(p => p.is_addon)

    return companies.map(c => {
      const coFeatures = allFeatures.filter(f => f.company_id === c.id)
      const empCount = employeeCounts[c.id] || 0

      function effectivePrice(pr: PricingRow): number {
        const cf = coFeatures.find(f => f.feature_key === pr.feature_key)
        return cf?.custom_price != null ? cf.custom_price : pr.default_price
      }

      const basePrice = baseline ? effectivePrice(baseline) : 0
      const enabledAddons = addons.filter(a => coFeatures.some(f => f.feature_key === a.feature_key && f.is_enabled))
      const addonTotal = enabledAddons.reduce((s, a) => s + effectivePrice(a), 0)
      const monthly = (basePrice + addonTotal) * empCount

      return {
        id: c.id,
        name: c.name,
        employees: empCount,
        core: basePrice * empCount,
        addonsTotal: addonTotal * empCount,
        monthly,
        enabledAddons: enabledAddons.map(a => a.display_name),
      }
    }).sort((a, b) => b.monthly - a.monthly)
  }, [companies, pricing, allFeatures, employeeCounts])

  const platformTotal = companyData.reduce((s, c) => s + c.monthly, 0)
  const platformCore = companyData.reduce((s, c) => s + c.core, 0)
  const platformAddons = companyData.reduce((s, c) => s + c.addonsTotal, 0)
  const totalEmployees = companyData.reduce((s, c) => s + c.employees, 0)

  if (loading) return <div className="admin-section"><div className="admin-loading">Loading...</div></div>

  return (
    <div className="admin-section">
      <div className="admin-page-header">
        <h2>Platform Billing</h2>
        <p>All-company financial overview</p>
      </div>

      <div className="billing-summary">
        <div className="billing-card">
          <span className="billing-card-label">Total Companies</span>
          <span className="billing-card-value">{companies.length}</span>
          <span className="billing-card-sub">active organisations</span>
        </div>
        <div className="billing-card">
          <span className="billing-card-label">Total Employees</span>
          <span className="billing-card-value">{totalEmployees}</span>
          <span className="billing-card-sub">across all companies</span>
        </div>
        <div className="billing-card">
          <span className="billing-card-label">Core Revenue</span>
          <span className="billing-card-value">&pound;{platformCore.toFixed(2)}</span>
          <span className="billing-card-sub">per month</span>
        </div>
        <div className="billing-card">
          <span className="billing-card-label">Add-on Revenue</span>
          <span className="billing-card-value">&pound;{platformAddons.toFixed(2)}</span>
          <span className="billing-card-sub">per month</span>
        </div>
        <div className="billing-card billing-card-highlight" style={{ gridColumn: 'span 2' }}>
          <span className="billing-card-label">Platform Monthly Revenue</span>
          <span className="billing-card-value">&pound;{platformTotal.toFixed(2)}</span>
          <span className="billing-card-sub">Annual: &pound;{(platformTotal * 12).toFixed(2)}</span>
        </div>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Company</th>
              <th>Employees</th>
              <th>Core</th>
              <th>Add-ons</th>
              <th>Monthly Total</th>
              <th>Active Add-ons</th>
            </tr>
          </thead>
          <tbody>
            {companyData.map(c => (
              <tr key={c.id}>
                <td><strong>{c.name}</strong></td>
                <td>{c.employees}</td>
                <td>&pound;{c.core.toFixed(2)}</td>
                <td>&pound;{c.addonsTotal.toFixed(2)}</td>
                <td><strong>&pound;{c.monthly.toFixed(2)}</strong></td>
                <td>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {c.enabledAddons.length > 0
                      ? c.enabledAddons.map(a => (
                          <span key={a} className="billing-addon-chip" style={{ fontSize: 11, padding: '2px 8px' }}>{a}</span>
                        ))
                      : <span style={{ color: '#999', fontSize: 12 }}>None</span>
                    }
                  </div>
                </td>
              </tr>
            ))}
            <tr style={{ fontWeight: 700 }}>
              <td>Platform Total</td>
              <td>{totalEmployees}</td>
              <td>&pound;{platformCore.toFixed(2)}</td>
              <td>&pound;{platformAddons.toFixed(2)}</td>
              <td>&pound;{platformTotal.toFixed(2)}</td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
