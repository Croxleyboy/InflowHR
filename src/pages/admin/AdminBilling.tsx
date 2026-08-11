import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import jsPDF from 'jspdf'

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
const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const VAT_RATE = 0.20

export default function AdminBilling() {
  const { isSuperAdmin } = useAuth()
  const { selectedCompanyId, selectedCompany, companies } = useAdminCompany()

  if (isSuperAdmin) return <SuperAdminBilling companies={companies} />
  return <CompanyBilling companyId={selectedCompanyId} companyName={selectedCompany?.name || ''} />
}

function generateInvoicePDF(
  companyName: string,
  monthLabel: string,
  year: number,
  baselineName: string,
  baselinePrice: number,
  addons: { name: string; price: number }[],
  employeeCount: number,
) {
  const doc = new jsPDF()
  const pw = doc.internal.pageSize.getWidth()
  const lm = 20
  const rm = pw - 20
  let y = 20

  doc.setFontSize(22)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(21, 101, 192)
  doc.text('KUMONIX', lm, y)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(120, 120, 120)
  doc.text('kumonix.com', lm, y + 6)
  doc.text('hello@kumonix.com', lm, y + 11)

  doc.setFontSize(28)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(30, 30, 45)
  doc.text('INVOICE', rm, y, { align: 'right' })
  y += 24

  const now = new Date()
  const invoiceNum = `INV-${year}${String(MONTH_FULL.indexOf(monthLabel) + 1).padStart(2, '0')}-${companyName.replace(/[^a-zA-Z0-9]/g, '').substring(0, 6).toUpperCase()}`
  const issueDate = new Date(now.getFullYear(), now.getMonth(), 1)
  const dueDate = new Date(issueDate)
  dueDate.setDate(dueDate.getDate() + 30)
  const fmtDate = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`

  doc.setDrawColor(220, 220, 220)
  doc.line(lm, y, rm, y)
  y += 8

  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(120, 120, 120)
  doc.text('INVOICE NO', lm, y)
  doc.text('ISSUE DATE', lm + 50, y)
  doc.text('DUE DATE', lm + 100, y)
  doc.text('PERIOD', lm + 145, y)
  y += 5
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(30, 30, 45)
  doc.text(invoiceNum, lm, y)
  doc.text(fmtDate(issueDate), lm + 50, y)
  doc.text(fmtDate(dueDate), lm + 100, y)
  doc.text(`${monthLabel} ${year}`, lm + 145, y)
  y += 12

  doc.setFillColor(245, 247, 250)
  doc.roundedRect(lm, y, rm - lm, 24, 3, 3, 'F')
  y += 7
  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(120, 120, 120)
  doc.text('BILL TO', lm + 6, y)
  doc.text('FROM', rm / 2 + 10, y)
  y += 6
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(30, 30, 45)
  doc.text(companyName, lm + 6, y)
  doc.text('Kumonix Ltd', rm / 2 + 10, y)
  y += 5
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(100, 100, 100)
  doc.text('kumonix.com', rm / 2 + 10, y)
  y += 16

  // Table header
  doc.setFillColor(21, 101, 192)
  doc.roundedRect(lm, y, rm - lm, 9, 2, 2, 'F')
  y += 6
  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(255, 255, 255)
  doc.text('Feature', lm + 4, y)
  doc.text('Type', lm + 80, y)
  doc.text('Price/User', lm + 110, y)
  doc.text('Users', lm + 140, y)
  doc.text('Amount', rm - 4, y, { align: 'right' })
  y += 7

  doc.setTextColor(30, 30, 45)
  doc.setFont('helvetica', 'normal')

  const rows: { name: string; type: string; price: number; users: number; amount: number }[] = []
  rows.push({ name: baselineName, type: 'Core', price: baselinePrice, users: employeeCount, amount: baselinePrice * employeeCount })
  addons.forEach(a => {
    rows.push({ name: a.name, type: 'Add-on', price: a.price, users: employeeCount, amount: a.price * employeeCount })
  })

  rows.forEach((r, i) => {
    if (i % 2 === 0) {
      doc.setFillColor(248, 249, 252)
      doc.rect(lm, y - 4, rm - lm, 8, 'F')
    }
    doc.setFontSize(9)
    doc.text(r.name, lm + 4, y)
    doc.text(r.type, lm + 80, y)
    doc.text(`£${r.price.toFixed(2)}`, lm + 110, y)
    doc.text(String(r.users), lm + 140, y)
    doc.text(`£${r.amount.toFixed(2)}`, rm - 4, y, { align: 'right' })
    y += 8
  })

  y += 4
  doc.setDrawColor(220, 220, 220)
  doc.line(lm + 100, y, rm, y)
  y += 8

  const subtotal = rows.reduce((s, r) => s + r.amount, 0)
  const vat = subtotal * VAT_RATE
  const total = subtotal + vat

  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text('Subtotal', lm + 110, y)
  doc.text(`£${subtotal.toFixed(2)}`, rm - 4, y, { align: 'right' })
  y += 7
  doc.text(`VAT (${(VAT_RATE * 100).toFixed(0)}%)`, lm + 110, y)
  doc.text(`£${vat.toFixed(2)}`, rm - 4, y, { align: 'right' })
  y += 3
  doc.setDrawColor(21, 101, 192)
  doc.setLineWidth(0.5)
  doc.line(lm + 100, y, rm, y)
  y += 8
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(21, 101, 192)
  doc.text('Total Due', lm + 110, y)
  doc.text(`£${total.toFixed(2)}`, rm - 4, y, { align: 'right' })
  y += 16

  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(150, 150, 150)
  doc.text('Payment terms: Net 30 days from invoice date.', lm, y)
  y += 5
  doc.text('Please reference the invoice number in your payment.', lm, y)
  y += 10
  doc.setDrawColor(230, 230, 230)
  doc.line(lm, y, rm, y)
  y += 6
  doc.setTextColor(21, 101, 192)
  doc.setFont('helvetica', 'bold')
  doc.text('Kumonix Ltd', lm, y)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(150, 150, 150)
  doc.text('  |  kumonix.com  |  hello@kumonix.com', lm + 26, y)

  const safeCompany = companyName.replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-')
  doc.save(`Invoice-${safeCompany}-${monthLabel}-${year}.pdf`)
}

function CompanyBilling({ companyId, companyName }: { companyId: string; companyName: string }) {
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

  const effectivePrice = useCallback((pr: PricingRow): number => {
    const cf = features.find(f => f.feature_key === pr.feature_key)
    return cf?.custom_price != null ? cf.custom_price : pr.default_price
  }, [features])

  const baselinePrice = baseline ? effectivePrice(baseline) : 0
  const addonTotal = enabledAddons.reduce((sum, a) => sum + effectivePrice(a), 0)
  const perUserTotal = baselinePrice + addonTotal
  const subtotal = perUserTotal * employeeCount
  const vat = subtotal * VAT_RATE
  const monthlyTotal = subtotal + vat

  const chartData = useMemo(() => {
    const now = new Date()
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
      return {
        label: MONTH_LABELS[d.getMonth()],
        month: MONTH_FULL[d.getMonth()],
        year: d.getFullYear(),
        core: baselinePrice * employeeCount,
        addons: addonTotal * employeeCount,
        isCurrent: i === 5,
      }
    })
  }, [baselinePrice, addonTotal, employeeCount])

  const maxAmount = Math.max(...chartData.map(m => m.core + m.addons), 1)

  function handleInvoice(month: string, year: number) {
    if (!baseline) return
    generateInvoicePDF(
      companyName,
      month,
      year,
      baseline.display_name,
      effectivePrice(baseline),
      enabledAddons.map(a => ({ name: a.display_name, price: effectivePrice(a) })),
      employeeCount,
    )
  }

  if (loading) return <div className="admin-section"><div className="admin-loading">Loading...</div></div>

  return (
    <div className="admin-section">
      <div className="admin-page-header">
        <h2>Billing &amp; Subscription</h2>
        <p>Financial overview for {companyName || 'your company'}</p>
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
          <span className="billing-card-sub">{enabledAddons.length} active</span>
        </div>
        <div className="billing-card">
          <span className="billing-card-label">Active Users</span>
          <span className="billing-card-value">{employeeCount}</span>
          <span className="billing-card-sub">employees</span>
        </div>
        <div className="billing-card billing-card-highlight">
          <span className="billing-card-label">Monthly Total (inc. VAT)</span>
          <span className="billing-card-value">&pound;{monthlyTotal.toFixed(2)}</span>
          <span className="billing-card-sub">&pound;{subtotal.toFixed(2)} + &pound;{vat.toFixed(2)} VAT</span>
        </div>
      </div>

      {enabledAddons.length > 0 && (
        <div className="billing-addons">
          {enabledAddons.map(a => (
            <span key={a.feature_key} className="billing-addon-chip">
              {a.display_name} &mdash; &pound;{effectivePrice(a).toFixed(2)}/user
            </span>
          ))}
        </div>
      )}

      <div className="billing-modern-chart">
        <div className="billing-modern-chart-header">
          <div>
            <h3>Monthly Costs</h3>
            <p>Last 6 months &middot; Core + Add-ons breakdown</p>
          </div>
          <div className="billing-chart-legend">
            <span><span className="billing-legend-dot" style={{ background: 'var(--billing-core, #1565c0)' }} />Core</span>
            <span><span className="billing-legend-dot" style={{ background: 'var(--billing-addon, #7b1fa2)' }} />Add-ons</span>
          </div>
        </div>
        <div className="billing-modern-bars">
          {chartData.map((m, i) => {
            const total = m.core + m.addons
            const corePct = maxAmount > 0 ? (m.core / maxAmount) * 100 : 0
            const addonPct = maxAmount > 0 ? (m.addons / maxAmount) * 100 : 0
            return (
              <div key={i} className={`billing-modern-bar-col${m.isCurrent ? ' billing-bar-current' : ''}`}>
                <span className="billing-modern-amount">&pound;{total.toFixed(0)}</span>
                <div className="billing-modern-bar-stack">
                  {addonPct > 0 && (
                    <div className="billing-bar-addon" style={{ height: `${addonPct}%` }} />
                  )}
                  <div className="billing-bar-core" style={{ height: `${corePct}%` }} />
                </div>
                <span className="billing-modern-label">{m.label}</span>
                <button
                  className="billing-invoice-btn"
                  title={`Download invoice for ${m.month} ${m.year}`}
                  onClick={() => handleInvoice(m.month, m.year)}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 18 15 15"/></svg>
                </button>
              </div>
            )
          })}
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
            <tr style={{ fontWeight: 600 }}>
              <td>Subtotal</td>
              <td></td>
              <td></td>
              <td>&pound;{subtotal.toFixed(2)}</td>
            </tr>
            <tr style={{ fontWeight: 600 }}>
              <td>VAT (20%)</td>
              <td></td>
              <td></td>
              <td>&pound;{vat.toFixed(2)}</td>
            </tr>
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

      <div className="billing-terms">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        <span>All invoices are payable within <strong>30 days</strong> of the invoice date. Billed by <strong>Kumonix Ltd</strong> (kumonix.com). VAT charged at 20%.</span>
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
      const subtotal = (basePrice + addonTotal) * empCount
      const vat = subtotal * VAT_RATE
      const monthly = subtotal + vat

      return {
        id: c.id,
        name: c.name,
        employees: empCount,
        core: basePrice * empCount,
        addonsTotal: addonTotal * empCount,
        subtotal,
        vat,
        monthly,
        enabledAddons: enabledAddons.map(a => a.display_name),
        baselineName: baseline?.display_name || 'Core',
        baselinePrice: basePrice,
        addonDetails: enabledAddons.map(a => ({ name: a.display_name, price: effectivePrice(a) })),
      }
    }).sort((a, b) => b.monthly - a.monthly)
  }, [companies, pricing, allFeatures, employeeCounts])

  const platformSubtotal = companyData.reduce((s, c) => s + c.subtotal, 0)
  const platformVat = companyData.reduce((s, c) => s + c.vat, 0)
  const platformTotal = companyData.reduce((s, c) => s + c.monthly, 0)
  const platformCore = companyData.reduce((s, c) => s + c.core, 0)
  const platformAddons = companyData.reduce((s, c) => s + c.addonsTotal, 0)
  const totalEmployees = companyData.reduce((s, c) => s + c.employees, 0)

  function handleInvoice(c: typeof companyData[0]) {
    const now = new Date()
    generateInvoicePDF(
      c.name,
      MONTH_FULL[now.getMonth()],
      now.getFullYear(),
      c.baselineName,
      c.baselinePrice,
      c.addonDetails,
      c.employees,
    )
  }

  if (loading) return <div className="admin-section"><div className="admin-loading">Loading...</div></div>

  return (
    <div className="admin-section">
      <div className="admin-page-header">
        <h2>Platform Billing</h2>
        <p>All-company financial overview</p>
      </div>

      <div className="billing-summary">
        <div className="billing-card">
          <span className="billing-card-label">Companies</span>
          <span className="billing-card-value">{companies.length}</span>
          <span className="billing-card-sub">organisations</span>
        </div>
        <div className="billing-card">
          <span className="billing-card-label">Total Users</span>
          <span className="billing-card-value">{totalEmployees}</span>
          <span className="billing-card-sub">across all companies</span>
        </div>
        <div className="billing-card">
          <span className="billing-card-label">Core Revenue</span>
          <span className="billing-card-value">&pound;{platformCore.toFixed(2)}</span>
          <span className="billing-card-sub">excl. VAT</span>
        </div>
        <div className="billing-card">
          <span className="billing-card-label">Add-on Revenue</span>
          <span className="billing-card-value">&pound;{platformAddons.toFixed(2)}</span>
          <span className="billing-card-sub">excl. VAT</span>
        </div>
        <div className="billing-card billing-card-highlight">
          <span className="billing-card-label">Platform Total (inc. VAT)</span>
          <span className="billing-card-value">&pound;{platformTotal.toFixed(2)}</span>
          <span className="billing-card-sub">&pound;{platformSubtotal.toFixed(2)} + &pound;{platformVat.toFixed(2)} VAT</span>
        </div>
        <div className="billing-card">
          <span className="billing-card-label">Annual Estimate</span>
          <span className="billing-card-value">&pound;{(platformTotal * 12).toFixed(2)}</span>
          <span className="billing-card-sub">inc. VAT</span>
        </div>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Company</th>
              <th>Users</th>
              <th>Core</th>
              <th>Add-ons</th>
              <th>VAT</th>
              <th>Monthly Total</th>
              <th>Active Add-ons</th>
              <th>Invoice</th>
            </tr>
          </thead>
          <tbody>
            {companyData.map(c => (
              <tr key={c.id}>
                <td><strong>{c.name}</strong></td>
                <td>{c.employees}</td>
                <td>&pound;{c.core.toFixed(2)}</td>
                <td>&pound;{c.addonsTotal.toFixed(2)}</td>
                <td>&pound;{c.vat.toFixed(2)}</td>
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
                <td>
                  <button className="billing-invoice-btn-table" title="Download invoice" onClick={() => handleInvoice(c)}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 18 15 15"/></svg>
                  </button>
                </td>
              </tr>
            ))}
            <tr style={{ fontWeight: 700 }}>
              <td>Platform Total</td>
              <td>{totalEmployees}</td>
              <td>&pound;{platformCore.toFixed(2)}</td>
              <td>&pound;{platformAddons.toFixed(2)}</td>
              <td>&pound;{platformVat.toFixed(2)}</td>
              <td>&pound;{platformTotal.toFixed(2)}</td>
              <td></td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
