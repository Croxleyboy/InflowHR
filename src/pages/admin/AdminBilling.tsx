import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useAdminCompany } from '../../context/AdminCompanyContext'

interface PricingRow {
  id: string
  feature_key: string
  feature_label: string
  feature_type: string
  default_price: number
  is_active: boolean
}

interface CompanyFeature {
  id: string
  feature_key: string
  is_enabled: boolean
  custom_price: number | null
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export default function AdminBilling() {
  const { selectedCompanyId } = useAdminCompany()
  const [pricing, setPricing] = useState<PricingRow[]>([])
  const [features, setFeatures] = useState<CompanyFeature[]>([])
  const [employeeCount, setEmployeeCount] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (selectedCompanyId) load()
  }, [selectedCompanyId])

  async function load() {
    setLoading(true)
    const [pricingRes, featuresRes, countRes] = await Promise.all([
      supabase.from('subscription_pricing').select('*').eq('is_active', true),
      supabase.from('company_features').select('*').eq('company_id', selectedCompanyId).eq('is_enabled', true),
      supabase.from('employees').select('id', { count: 'exact', head: true }).eq('company_id', selectedCompanyId).eq('is_active', true),
    ])
    setPricing((pricingRes.data as PricingRow[]) || [])
    setFeatures((featuresRes.data as CompanyFeature[]) || [])
    setEmployeeCount(countRes.count ?? 0)
    setLoading(false)
  }

  const enabledFeatureKeys = useMemo(() => new Set(features.map(f => f.feature_key)), [features])

  const baseline = useMemo(() => pricing.find(p => p.feature_type === 'baseline'), [pricing])

  const addons = useMemo(() =>
    pricing.filter(p => p.feature_type === 'addon' && enabledFeatureKeys.has(p.feature_key)),
    [pricing, enabledFeatureKeys]
  )

  function effectivePrice(pricingRow: PricingRow): number {
    const cf = features.find(f => f.feature_key === pricingRow.feature_key)
    return cf?.custom_price != null ? cf.custom_price : pricingRow.default_price
  }

  const baselinePrice = baseline ? effectivePrice(baseline) : 0
  const addonTotal = addons.reduce((sum, a) => sum + effectivePrice(a), 0)
  const perUserTotal = baselinePrice + addonTotal
  const monthlyTotal = perUserTotal * employeeCount

  // Build last 12 months for chart
  const chartData = useMemo(() => {
    const now = new Date()
    const months: { label: string; amount: number; isCurrent: boolean }[] = []
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      months.push({
        label: MONTH_LABELS[d.getMonth()],
        amount: monthlyTotal,
        isCurrent: i === 0,
      })
    }
    return months
  }, [monthlyTotal])

  const maxAmount = Math.max(...chartData.map(m => m.amount), 1)

  if (loading) return <div className="admin-section"><div className="admin-loading">Loading...</div></div>

  return (
    <div className="admin-section">
      <div className="admin-page-header">
        <h2>Billing &amp; Subscription</h2>
        <p>Financial overview for your company</p>
      </div>

      {/* Summary cards */}
      <div className="billing-summary">
        <div className="billing-card">
          <span className="billing-card-label">Baseline Plan</span>
          <span className="billing-card-value">&pound;{baselinePrice.toFixed(2)}</span>
          <span className="billing-card-sub">per user / month</span>
        </div>
        <div className="billing-card">
          <span className="billing-card-label">Active Add-ons</span>
          <span className="billing-card-value">{addons.length}</span>
          <span className="billing-card-sub">&pound;{addonTotal.toFixed(2)} per user</span>
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

      {/* Add-on chips */}
      {addons.length > 0 && (
        <div className="billing-addons">
          {addons.map(a => (
            <span key={a.feature_key} className="billing-addon-chip">
              {a.feature_label} &mdash; &pound;{effectivePrice(a).toFixed(2)}
            </span>
          ))}
        </div>
      )}

      {/* 12-month chart */}
      <div className="billing-chart">
        <h3>Estimated Monthly Costs (Last 12 Months)</h3>
        <div className="billing-chart-bars">
          {chartData.map((m, i) => (
            <div key={i} className="billing-chart-bar-wrap">
              <div style={{ position: 'relative', width: '100%' }}>
                <span className="billing-chart-amount" style={{ width: '100%', textAlign: 'center' }}>
                  &pound;{m.amount.toFixed(0)}
                </span>
                <div
                  className={`billing-chart-bar${m.isCurrent ? ' billing-chart-bar-current' : ''}`}
                  style={{ height: `${(m.amount / maxAmount) * 170}px` }}
                />
              </div>
              <span className="billing-chart-label">{m.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Cost breakdown table */}
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
                <td>{baseline.feature_label}</td>
                <td>Standard</td>
                <td>&pound;{effectivePrice(baseline).toFixed(2)}</td>
                <td>&pound;{(effectivePrice(baseline) * employeeCount).toFixed(2)}</td>
              </tr>
            )}
            {addons.map(a => (
              <tr key={a.feature_key}>
                <td>{a.feature_label}</td>
                <td>Add-on</td>
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
