import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { useToast } from '../../context/ToastContext'
import jsPDF from 'jspdf'

interface PricingRow {
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

const BILLING_PACK_A_LABELS = ['Shifts & Rotas', 'Legal Timesheets', 'Space & Desk Booking', 'Asset Management']
const BILLING_PACK_B_LABELS = ['Teams & Presence', 'Skills Passport & Talent Intelligence']
const BILLING_CORE_FEATURES = [
  'Leave', 'Performance', 'E-Learning', 'Expenses', 'Onboarding/Offboarding',
  'Payroll / Xero / Sage', 'Kudos', 'Announcements & Notifications',
  'Benefits', 'GDPR Document Storage', 'Timesheets', 'HR Tickets', 'Email Notifications',
  'Surveys & Feedback',
]

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

function generateAnnualInvoicePDF(
  companyName: string,
  fyLabel: string,
  annualPrice: number,
  subscribedFeatures: { name: string; type: string }[],
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
  const invoiceNum = `INV-${fyLabel.replace(/[^a-zA-Z0-9]/g, '')}-${companyName.replace(/[^a-zA-Z0-9]/g, '').substring(0, 6).toUpperCase()}-FP`
  const fmtDate = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
  const dueDate = new Date(now)
  dueDate.setDate(dueDate.getDate() + 30)

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
  doc.text(fmtDate(now), lm + 50, y)
  doc.text(fmtDate(dueDate), lm + 100, y)
  doc.text(fyLabel, lm + 145, y)
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

  doc.setFillColor(21, 101, 192)
  doc.roundedRect(lm, y, rm - lm, 9, 2, 2, 'F')
  y += 6
  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(255, 255, 255)
  doc.text('Subscribed Feature', lm + 4, y)
  doc.text('Type', lm + 110, y)
  y += 7

  doc.setTextColor(30, 30, 45)
  doc.setFont('helvetica', 'normal')

  subscribedFeatures.forEach((f, i) => {
    if (i % 2 === 0) {
      doc.setFillColor(248, 249, 252)
      doc.rect(lm, y - 4, rm - lm, 8, 'F')
    }
    doc.setFontSize(9)
    doc.text(f.name, lm + 4, y)
    doc.text(f.type, lm + 110, y)
    y += 8
  })

  y += 4
  doc.setDrawColor(220, 220, 220)
  doc.line(lm + 100, y, rm, y)
  y += 8

  const vatAmount = annualPrice * VAT_RATE
  const total = annualPrice + vatAmount

  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.text('Fixed Annual Price', lm + 80, y)
  doc.text(`£${annualPrice.toFixed(2)}`, rm - 4, y, { align: 'right' })
  y += 7
  doc.setFont('helvetica', 'normal')
  doc.text(`VAT (${(VAT_RATE * 100).toFixed(0)}%)`, lm + 80, y)
  doc.text(`£${vatAmount.toFixed(2)}`, rm - 4, y, { align: 'right' })
  y += 3
  doc.setDrawColor(21, 101, 192)
  doc.setLineWidth(0.5)
  doc.line(lm + 70, y, rm, y)
  y += 8
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(21, 101, 192)
  doc.text('Total Due', lm + 80, y)
  doc.text(`£${total.toFixed(2)}`, rm - 4, y, { align: 'right' })
  y += 16

  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(150, 150, 150)
  doc.text('Payment terms: Net 30 days from invoice date.', lm, y)
  y += 5
  doc.text('Fixed annual billing — covers all subscribed HR features for the financial year.', lm, y)
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
  doc.save(`Invoice-${safeCompany}-Annual-${fyLabel.replace(/\s+/g, '-')}.pdf`)
}

interface SnapshotFeatureDetail {
  key: string
  name: string
  price: number
}

interface BillingSnapshot {
  company_id: string
  year: number
  month: number
  employee_count: number
  core_per_user: number
  addon_per_user: number
  feature_details: SnapshotFeatureDetail[]
}

interface CancellationBillingSummary {
  billing_type: string
  billing_end_date: string
  outstanding_amount: number
  employee_count?: number
  note: string
}

interface ExistingCancellation {
  id: string
  status: string
  billing_end_date: string
  requested_at: string
  data_frozen_at: string | null
}

function CompanyBilling({ companyId, companyName }: { companyId: string; companyName: string }) {
  const { showError, showSuccess } = useToast()
  const { isSuperAdmin } = useAuth()
  const [pricing, setPricing] = useState<PricingRow[]>([])
  const [features, setFeatures] = useState<CompanyFeature[]>([])
  const [employeeCount, setEmployeeCount] = useState(0)
  const [snapshots, setSnapshots] = useState<BillingSnapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [billingType, setBillingType] = useState<'monthly' | 'fixed'>('monthly')
  const [fixedAnnualPrice, setFixedAnnualPrice] = useState(0)
  const [fyStartMonth, setFyStartMonth] = useState(4)
  const [monthlyPlatformFee, setMonthlyPlatformFee] = useState(30)
  const [viewEndYear, setViewEndYear] = useState(new Date().getFullYear())
  const [viewEndMonth, setViewEndMonth] = useState(new Date().getMonth() + 1)
  const [companyCreatedAt, setCompanyCreatedAt] = useState<Date | null>(null)

  const [showCancelModal, setShowCancelModal] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelBilling, setCancelBilling] = useState<CancellationBillingSummary | null>(null)
  const [cancelBillingLoading, setCancelBillingLoading] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [existingCancellation, setExistingCancellation] = useState<ExistingCancellation | null>(null)

  useEffect(() => {
    if (companyId) load()
  }, [companyId])

  useEffect(() => {
    if (!companyId || isSuperAdmin) return
    supabase.from('cancellation_requests')
      .select('id, status, billing_end_date, requested_at, data_frozen_at')
      .eq('company_id', companyId)
      .not('status', 'in', '("cancelled","completed")')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => { if (data) setExistingCancellation(data as ExistingCancellation) })
  }, [companyId, isSuperAdmin])

  const handleOpenCancelModal = useCallback(async () => {
    setCancelBillingLoading(true)
    setShowCancelModal(true)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await supabase.rpc('get_cancellation_billing_summary' as any, { p_company_id: companyId })
      if (error) { showError('Failed to load billing: ' + error.message); setShowCancelModal(false); return }
      setCancelBilling(data as CancellationBillingSummary)
    } catch {
      showError('Failed to load billing information')
      setShowCancelModal(false)
    }
    setCancelBillingLoading(false)
  }, [companyId, showError])

  const handleConfirmCancellation = useCallback(async () => {
    setCancelling(true)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await supabase.rpc('request_company_cancellation' as any, {
        p_company_id: companyId,
        p_reason: cancelReason || null,
      })
      if (error) { showError('Cancellation request failed: ' + error.message); setCancelling(false); return }
      showSuccess('Cancellation request submitted. You will receive confirmation shortly.')
      setShowCancelModal(false)
      setCancelReason('')
      const { data } = await supabase.from('cancellation_requests')
        .select('id, status, billing_end_date, requested_at, data_frozen_at')
        .eq('company_id', companyId)
        .not('status', 'in', '("cancelled","completed")')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (data) setExistingCancellation(data as ExistingCancellation)
    } catch {
      showError('Cancellation request failed — please try again')
    }
    setCancelling(false)
  }, [companyId, cancelReason, showError, showSuccess])

  async function load() {
    setLoading(true)
    const now = new Date()

    const [pricingRes, featuresRes, metricsRes, snapshotsRes, companyRes] = await Promise.all([
      supabase.from('subscription_pricing').select('*').eq('is_active', true),
      supabase.from('company_features').select('*').eq('company_id', companyId),
      supabase.rpc('get_company_metrics', { p_company_id: companyId }),
      supabase.from('billing_snapshots')
        .select('*')
        .eq('company_id', companyId)
        .order('year')
        .order('month'),
      supabase.from('companies')
        .select('billing_type, fixed_annual_price, fy_start_month, monthly_platform_fee, created_at')
        .eq('id', companyId)
        .single(),
    ])
    const pricingData = (pricingRes.data as PricingRow[]) || []
    const featuresData = (featuresRes.data as CompanyFeature[]) || []
    const empCount = metricsRes.data?.employee_count ?? 0
    const snapshotData = (snapshotsRes.data as BillingSnapshot[]) || []

    const co = companyRes.data as { billing_type: string; fixed_annual_price: number | null; fy_start_month: number; monthly_platform_fee: number | null; created_at: string | null } | null
    const bt = co?.billing_type === 'fixed' ? 'fixed' : 'monthly'
    setBillingType(bt as 'monthly' | 'fixed')
    setFixedAnnualPrice(co?.fixed_annual_price ?? 0)
    setFyStartMonth(co?.fy_start_month ?? 4)
    setMonthlyPlatformFee(co?.monthly_platform_fee ?? 30)
    if (co?.created_at) setCompanyCreatedAt(new Date(co.created_at))
    setViewEndYear(now.getFullYear())
    setViewEndMonth(now.getMonth() + 1)

    setPricing(pricingData)
    setFeatures(featuresData)
    setEmployeeCount(empCount)
    setSnapshots(snapshotData)

    upsertCurrentMonthSnapshot(companyId, pricingData, featuresData, empCount, now)
    setLoading(false)
  }

  async function upsertCurrentMonthSnapshot(
    coId: string,
    pricingData: PricingRow[],
    featuresData: CompanyFeature[],
    empCount: number,
    now: Date,
  ) {
    const bl = pricingData.find(p => !p.is_addon)
    const enabledKeys = new Set(featuresData.filter(f => f.is_enabled).map(f => f.feature_key))
    const addons = pricingData.filter(p => p.is_addon && enabledKeys.has(p.feature_key))

    function eff(pr: PricingRow): number {
      const cf = featuresData.find(f => f.feature_key === pr.feature_key)
      return cf?.custom_price != null ? cf.custom_price : pr.default_price
    }

    const corePerUser = bl ? eff(bl) : 0
    const addonPerUser = addons.reduce((s, a) => s + eff(a), 0)
    const yr = now.getFullYear()
    const mo = now.getMonth() + 1

    const featureDetails: SnapshotFeatureDetail[] = []
    if (bl) featureDetails.push({ key: bl.feature_key, name: bl.display_name, price: corePerUser })
    addons.forEach(a => featureDetails.push({ key: a.feature_key, name: a.display_name, price: eff(a) }))

    await supabase.from('billing_snapshots').upsert(
      {
        company_id: coId,
        year: yr,
        month: mo,
        employee_count: empCount,
        core_per_user: corePerUser,
        addon_per_user: addonPerUser,
        feature_details: featureDetails,
        monthly_platform_fee: monthlyPlatformFee,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'company_id,year,month' },
    )

    setSnapshots(prev => {
      const filtered = prev.filter(s => !(s.year === yr && s.month === mo))
      return [...filtered, { company_id: coId, year: yr, month: mo, employee_count: empCount, core_per_user: corePerUser, addon_per_user: addonPerUser, feature_details: featureDetails }]
    })
  }

  const baseline = useMemo(() => pricing.find(p => p.feature_key === 'hr_core' || !p.is_addon), [pricing])
  const packAPricing = useMemo(() => pricing.find(p => p.feature_key === 'pack_a'), [pricing])
  const packBPricing = useMemo(() => pricing.find(p => p.feature_key === 'pack_b'), [pricing])
  const supportPackages = useMemo(() => pricing.filter(p => p.is_support_package), [pricing])
  const enabledKeys = useMemo(() => new Set(features.filter(f => f.is_enabled).map(f => f.feature_key)), [features])
  const enabledAddons = useMemo(() => {
    return pricing.filter(p => p.is_addon && !p.is_support_package && enabledKeys.has(p.feature_key))
  }, [pricing, enabledKeys])

  const packAEnabled = enabledKeys.has('pack_a')
  const packBEnabled = enabledKeys.has('pack_b')
  const enabledSupport = useMemo(() => supportPackages.filter(sp => enabledKeys.has(sp.feature_key)), [supportPackages, enabledKeys])

  const effectivePrice = useCallback((pr: PricingRow): number => {
    const cf = features.find(f => f.feature_key === pr.feature_key)
    return cf?.custom_price != null ? cf.custom_price : pr.default_price
  }, [features])

  const baselinePrice = baseline ? effectivePrice(baseline) : 0
  const hasCustomCore = baseline ? (baselinePrice !== baseline.default_price) : false
  const packAPrice = packAPricing && packAEnabled ? effectivePrice(packAPricing) : 0
  const packBPrice = packBPricing && packBEnabled ? effectivePrice(packBPricing) : 0
  const supportTotal = enabledSupport.reduce((sum, sp) => sum + (sp.flat_price ?? 0), 0)
  const isFixed = billingType === 'fixed' && fixedAnnualPrice > 0
  const fixedMonthly = isFixed ? fixedAnnualPrice / 12 : 0
  const perUserTotal = baselinePrice + packAPrice + packBPrice
  const subtotal = (isFixed ? fixedMonthly : perUserTotal * employeeCount) + supportTotal + monthlyPlatformFee
  const vat = subtotal * VAT_RATE
  const monthlyTotal = subtotal + vat

  const chartData = useMemo(() => {
    const now = new Date()
    const curYear = now.getFullYear()
    const curMonth = now.getMonth() + 1

    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(viewEndYear, viewEndMonth - 1 - (5 - i), 1)
      const yr = d.getFullYear()
      const mo = d.getMonth() + 1
      const isCurrent = yr === curYear && mo === curMonth

      if (isFixed) {
        return { label: MONTH_LABELS[d.getMonth()], month: MONTH_FULL[d.getMonth()], year: yr, core: fixedMonthly, packA: 0, packB: 0, isCurrent }
      }

      if (isCurrent) {
        return { label: MONTH_LABELS[d.getMonth()], month: MONTH_FULL[d.getMonth()], year: yr, core: baselinePrice * employeeCount, packA: packAPrice * employeeCount, packB: packBPrice * employeeCount, isCurrent: true }
      }

      const snap = snapshots.find(s => s.year === yr && s.month === mo)
      if (snap) {
        let snapPackA = 0
        let snapPackB = 0
        if (snap.feature_details?.length) {
          const paDetail = snap.feature_details.find(d => d.key === 'pack_a')
          const pbDetail = snap.feature_details.find(d => d.key === 'pack_b')
          if (paDetail) snapPackA = paDetail.price * snap.employee_count
          if (pbDetail) snapPackB = pbDetail.price * snap.employee_count
        } else {
          snapPackA = snap.addon_per_user * snap.employee_count
        }
        return { label: MONTH_LABELS[d.getMonth()], month: MONTH_FULL[d.getMonth()], year: yr, core: snap.core_per_user * snap.employee_count, packA: snapPackA, packB: snapPackB, isCurrent: false }
      }

      return { label: MONTH_LABELS[d.getMonth()], month: MONTH_FULL[d.getMonth()], year: yr, core: baselinePrice * employeeCount, packA: packAPrice * employeeCount, packB: packBPrice * employeeCount, isCurrent: false }
    })
  }, [baselinePrice, packAPrice, packBPrice, employeeCount, snapshots, isFixed, fixedMonthly, viewEndYear, viewEndMonth])

  const chartMaxFeatures = Math.max(...chartData.map(m => m.core + m.packA + m.packB), 0.01)

  const nowDate = new Date()
  const isAtLatest = viewEndYear === nowDate.getFullYear() && viewEndMonth === nowDate.getMonth() + 1
  const startDate = companyCreatedAt || new Date(2024, 0, 1)
  const earliestViewEnd = new Date(startDate.getFullYear(), startDate.getMonth() + 5, 1)
  const isAtEarliest = viewEndYear < earliestViewEnd.getFullYear() ||
    (viewEndYear === earliestViewEnd.getFullYear() && viewEndMonth <= earliestViewEnd.getMonth() + 1)

  function navigateBack() {
    const d = new Date(viewEndYear, viewEndMonth - 2, 1)
    setViewEndYear(d.getFullYear())
    setViewEndMonth(d.getMonth() + 1)
  }

  function navigateForward() {
    const d = new Date(viewEndYear, viewEndMonth, 1)
    setViewEndYear(d.getFullYear())
    setViewEndMonth(d.getMonth() + 1)
  }

  function handleInvoice(month: string, year: number) {
    if (!baseline) return
    const monthIdx = MONTH_FULL.indexOf(month)
    const now = new Date()
    const isCurrent = year === now.getFullYear() && monthIdx === now.getMonth()
    const snap = snapshots.find(s => s.year === year && s.month === monthIdx + 1)

    if (!isCurrent && snap && snap.feature_details?.length > 0) {
      const coreDetail = snap.feature_details.find(d => d.key === baseline.feature_key)
      const addonDetails = snap.feature_details.filter(d => d.key !== baseline.feature_key)
      generateInvoicePDF(
        companyName,
        month,
        year,
        coreDetail?.name || baseline.display_name,
        snap.core_per_user,
        addonDetails.map(d => ({ name: d.name, price: d.price })),
        snap.employee_count,
      )
    } else {
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
  }

  function getFYLabel(): string {
    const now = new Date()
    const currentMonth = now.getMonth() + 1
    let fyStartYear = now.getFullYear()
    if (currentMonth < fyStartMonth) fyStartYear--
    const fyEndYear = fyStartYear + 1
    return `${fyStartYear}/${fyEndYear}`
  }

  function handleAnnualInvoice() {
    const allFeatures: { name: string; type: string }[] = []
    if (baseline) allFeatures.push({ name: baseline.display_name, type: 'Core' })
    if (packAEnabled && packAPricing) allFeatures.push({ name: 'Pack A: ' + packAPricing.display_name, type: 'Pack A' })
    if (packBEnabled && packBPricing) allFeatures.push({ name: 'Pack B: ' + packBPricing.display_name, type: 'Pack B' })
    enabledSupport.forEach(sp => allFeatures.push({ name: sp.display_name, type: 'Support' }))
    generateAnnualInvoicePDF(companyName, getFYLabel(), fixedAnnualPrice, allFeatures)
  }

  if (loading) return <div className="admin-section"><div className="admin-loading">Loading...</div></div>

  return (
    <div className="admin-section">
      <div className="admin-page-header">
        <h2>Billing &amp; Subscription</h2>
        <p>Financial overview for {companyName || 'your company'}</p>
      </div>

      {isFixed && (
        <div style={{ background: '#e8f5e9', border: '1px solid #43a047', borderRadius: 8, padding: 12, marginBottom: 16, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <span style={{ fontSize: 18 }}>&#9679;</span>
          <span style={{ fontWeight: 600, color: '#2e7d32' }}>Fixed Annual Billing</span>
          <span style={{ color: '#555', fontSize: 13 }}>&mdash; &pound;{fixedAnnualPrice.toFixed(2)}/year (FY {getFYLabel()})</span>
        </div>
      )}

      <div className="billing-summary">
        {isFixed ? (
          <>
            <div className="billing-card">
              <span className="billing-card-label">Annual Price</span>
              <span className="billing-card-value">&pound;{fixedAnnualPrice.toFixed(2)}</span>
              <span className="billing-card-sub">fixed / year</span>
            </div>
            <div className="billing-card">
              <span className="billing-card-label">Monthly Equivalent</span>
              <span className="billing-card-value">&pound;{fixedMonthly.toFixed(2)}</span>
              <span className="billing-card-sub">excl. VAT</span>
            </div>
            <div className="billing-card">
              <span className="billing-card-label">Active Users</span>
              <span className="billing-card-value">{employeeCount}</span>
              <span className="billing-card-sub">employees</span>
            </div>
            <div className="billing-card billing-card-highlight">
              <span className="billing-card-label">Annual Total (inc. VAT)</span>
              <span className="billing-card-value">&pound;{(fixedAnnualPrice + fixedAnnualPrice * VAT_RATE).toFixed(2)}</span>
              <span className="billing-card-sub">&pound;{fixedAnnualPrice.toFixed(2)} + &pound;{(fixedAnnualPrice * VAT_RATE).toFixed(2)} VAT</span>
            </div>
          </>
        ) : (
          <>
            <div className="billing-card">
              <span className="billing-card-label">Core Plan{hasCustomCore && <span style={{ marginLeft: 6, fontSize: 10, background: '#e3f2fd', color: '#1565c0', padding: '1px 5px', borderRadius: 3, fontWeight: 600 }}>Custom</span>}</span>
              <span className="billing-card-value">&pound;{baselinePrice.toFixed(2)}</span>
              <span className="billing-card-sub">per user / month</span>
            </div>
            {packAEnabled && (
              <div className="billing-card" style={{ borderTop: '3px solid #43a047' }}>
                <span className="billing-card-label" style={{ color: '#2e7d32' }}>Pack A: Workforce</span>
                <span className="billing-card-value">&pound;{packAPrice.toFixed(2)}</span>
                <span className="billing-card-sub">per user / month</span>
              </div>
            )}
            {packBEnabled && (
              <div className="billing-card" style={{ borderTop: '3px solid #7b1fa2' }}>
                <span className="billing-card-label" style={{ color: '#7b1fa2' }}>Pack B: Enterprise</span>
                <span className="billing-card-value">&pound;{packBPrice.toFixed(2)}</span>
                <span className="billing-card-sub">per user / month</span>
              </div>
            )}
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
          </>
        )}
      </div>

      {!isFixed && (packAEnabled || packBEnabled || enabledSupport.length > 0) && (
        <div className="billing-addons" style={{ flexWrap: 'wrap', gap: 6 }}>
          {packAEnabled && (
            <>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#2e7d32' }}>Pack A:</span>
              {BILLING_PACK_A_LABELS.map(label => (
                <span key={label} className="billing-addon-chip" style={{ background: '#e8f5e9', color: '#2e7d32', border: '1px solid #a5d6a7' }}>{label}</span>
              ))}
            </>
          )}
          {packBEnabled && (
            <>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#7b1fa2' }}>Pack B:</span>
              {BILLING_PACK_B_LABELS.map(label => (
                <span key={label} className="billing-addon-chip" style={{ background: '#f3e5f5', color: '#7b1fa2', border: '1px solid #ce93d8' }}>{label}</span>
              ))}
            </>
          )}
          {enabledSupport.map(sp => (
            <span key={sp.feature_key} className="billing-addon-chip" style={{ background: '#fff3e0', color: '#e65100', border: '1px solid #ffcc80' }}>
              {sp.display_name} &mdash; &pound;{(sp.flat_price ?? 0).toFixed(2)}
            </span>
          ))}
        </div>
      )}

      <div className="billing-modern-chart">
        <div className="billing-modern-chart-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              onClick={navigateBack}
              disabled={isAtEarliest}
              style={{ background: 'none', border: '1px solid #e0e0e0', borderRadius: 6, width: 32, height: 32, cursor: isAtEarliest ? 'not-allowed' : 'pointer', opacity: isAtEarliest ? 0.3 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}
              title="Previous month"
            >&#8592;</button>
            <div>
              <h3 style={{ margin: 0 }}>Monthly Costs</h3>
              <p style={{ margin: 0, fontSize: 12, color: '#888' }}>{chartData.length > 0 && `${chartData[0].label} ${chartData[0].year} – ${chartData[chartData.length - 1].label} ${chartData[chartData.length - 1].year}`} {isFixed ? '· Fixed' : ''}</p>
            </div>
            <button
              onClick={navigateForward}
              disabled={isAtLatest}
              style={{ background: 'none', border: '1px solid #e0e0e0', borderRadius: 6, width: 32, height: 32, cursor: isAtLatest ? 'not-allowed' : 'pointer', opacity: isAtLatest ? 0.3 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}
              title="Next month"
            >&#8594;</button>
          </div>
          <div className="billing-chart-legend">
            {isFixed ? (
              <span><span className="billing-legend-dot" style={{ background: '#1565c0' }} />Fixed</span>
            ) : (
              <>
                <span><span className="billing-legend-dot" style={{ background: '#1565c0' }} />Core</span>
                {packAEnabled && <span><span className="billing-legend-dot" style={{ background: '#43a047' }} />Pack A</span>}
                {packBEnabled && <span><span className="billing-legend-dot" style={{ background: '#7b1fa2' }} />Pack B</span>}
              </>
            )}
            <span><span className="billing-legend-dot" style={{ background: '#3949ab' }} />Platform Fee</span>
          </div>
        </div>
        {(() => {
          const svgW = 680
          const padL = 55
          const cols = chartData.length
          const colW = (svgW - padL * 2) / cols
          const barW = Math.min(54, colW * 0.58)
          const barBase = 200
          const maxBarH = 140
          const svgH = 290

          const bars = chartData.map((m, idx) => {
            const cx = padL + colW / 2 + idx * colW
            const featureTotal = m.core + m.packA + m.packB
            const grandTotal = featureTotal + monthlyPlatformFee + supportTotal

            const coreH = chartMaxFeatures > 0 ? (m.core / chartMaxFeatures) * maxBarH : 0
            const packAH = chartMaxFeatures > 0 ? (m.packA / chartMaxFeatures) * maxBarH : 0
            const packBH = chartMaxFeatures > 0 ? (m.packB / chartMaxFeatures) * maxBarH : 0

            const coreBot = barBase
            const coreTop = barBase - coreH
            const packABot = coreTop
            const packATop = coreTop - packAH
            const packBBot = packATop
            const packBTop = packATop - packBH
            const barTop = packBTop

            return { cx, m, featureTotal, grandTotal, coreH, packAH, packBH, coreBot, coreTop, packABot, packATop, packBBot, packBTop, barTop }
          })

          return (
            <>
              <svg viewBox={`0 0 ${svgW} ${svgH}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
                <defs>
                  <linearGradient id="bc-grad-core" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#64b5f6" />
                    <stop offset="100%" stopColor="#1565c0" />
                  </linearGradient>
                  <linearGradient id="bc-grad-packA" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#81c784" />
                    <stop offset="100%" stopColor="#388e3c" />
                  </linearGradient>
                  <linearGradient id="bc-grad-packB" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ce93d8" />
                    <stop offset="100%" stopColor="#7b1fa2" />
                  </linearGradient>
                  <filter id="bc-shadow" x="-10%" y="-10%" width="120%" height="130%">
                    <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.08" />
                  </filter>
                </defs>

                <line x1={padL} y1={barBase} x2={svgW - padL} y2={barBase} stroke="#eee" strokeWidth={1} />

                {bars.slice(0, -1).map((b, i) => {
                  const next = bars[i + 1]
                  const lx = b.cx + barW / 2
                  const rx = next.cx - barW / 2
                  const mx = (lx + rx) / 2
                  const ribbons: React.ReactNode[] = []

                  if (b.coreH > 0.5 || next.coreH > 0.5) {
                    ribbons.push(
                      <path key={`rc${i}`}
                        d={`M${lx} ${b.coreBot} C${mx} ${b.coreBot} ${mx} ${next.coreBot} ${rx} ${next.coreBot} L${rx} ${next.coreTop} C${mx} ${next.coreTop} ${mx} ${b.coreTop} ${lx} ${b.coreTop} Z`}
                        fill="#1565c0" opacity={0.07}
                      />
                    )
                  }
                  if (b.packAH > 0.5 || next.packAH > 0.5) {
                    ribbons.push(
                      <path key={`ra${i}`}
                        d={`M${lx} ${b.packABot} C${mx} ${b.packABot} ${mx} ${next.packABot} ${rx} ${next.packABot} L${rx} ${next.packATop} C${mx} ${next.packATop} ${mx} ${b.packATop} ${lx} ${b.packATop} Z`}
                        fill="#388e3c" opacity={0.07}
                      />
                    )
                  }
                  if (b.packBH > 0.5 || next.packBH > 0.5) {
                    ribbons.push(
                      <path key={`rb${i}`}
                        d={`M${lx} ${b.packBBot} C${mx} ${b.packBBot} ${mx} ${next.packBBot} ${rx} ${next.packBBot} L${rx} ${next.packBTop} C${mx} ${next.packBTop} ${mx} ${b.packBTop} ${lx} ${b.packBTop} Z`}
                        fill="#7b1fa2" opacity={0.07}
                      />
                    )
                  }

                  return <g key={`rib${i}`}>{ribbons}</g>
                })}

                {bars.map((b, i) => {
                  const halfW = barW / 2
                  const r = Math.min(6, barW / 4)
                  const bubbleY = b.featureTotal > 0 ? Math.max(b.barTop - 30, 4) : barBase - 30
                  return (
                    <g key={`bar${i}`} opacity={b.m.isCurrent ? 1 : 0.85}>
                      {b.coreH > 0.5 && (
                        <rect x={b.cx - halfW} y={b.coreTop} width={barW} height={b.coreH}
                          rx={b.packAH < 0.5 && b.packBH < 0.5 ? r : 0} ry={b.packAH < 0.5 && b.packBH < 0.5 ? r : 0}
                          fill="url(#bc-grad-core)" filter={b.m.isCurrent ? 'url(#bc-shadow)' : undefined} />
                      )}
                      {b.packAH > 0.5 && (
                        <rect x={b.cx - halfW} y={b.packATop} width={barW} height={b.packAH}
                          rx={b.packBH < 0.5 ? r : 0} ry={b.packBH < 0.5 ? r : 0}
                          fill="url(#bc-grad-packA)" filter={b.m.isCurrent ? 'url(#bc-shadow)' : undefined} />
                      )}
                      {b.packBH > 0.5 && (
                        <rect x={b.cx - halfW} y={b.packBTop} width={barW} height={b.packBH}
                          rx={r} ry={r}
                          fill="url(#bc-grad-packB)" filter={b.m.isCurrent ? 'url(#bc-shadow)' : undefined} />
                      )}
                      {b.coreH > 0.5 && (
                        <rect x={b.cx - halfW} y={b.coreBot - r} width={barW} height={r}
                          rx={r} ry={r} fill="url(#bc-grad-core)" />
                      )}

                      <rect x={b.cx - 34} y={bubbleY} width={68} height={22} rx={11}
                        fill={b.m.isCurrent ? '#1a237e' : '#fafafa'} stroke={b.m.isCurrent ? 'none' : '#e0e0e0'} strokeWidth={0.5}
                        filter={b.m.isCurrent ? 'url(#bc-shadow)' : undefined} />
                      <text x={b.cx} y={bubbleY + 15} textAnchor="middle"
                        fontSize={11} fontWeight={700} fontFamily="system-ui, -apple-system, sans-serif"
                        fill={b.m.isCurrent ? '#fff' : '#333'}>
                        &pound;{b.grandTotal.toFixed(0)}
                      </text>

                      <text x={b.cx} y={barBase + 18} textAnchor="middle"
                        fontSize={12} fontFamily="system-ui, -apple-system, sans-serif"
                        fill={b.m.isCurrent ? '#333' : '#999'} fontWeight={b.m.isCurrent ? 600 : 400}>
                        {b.m.label}
                      </text>

                      <rect x={b.cx - 28} y={barBase + 28} width={56} height={20} rx={10}
                        fill="#e8eaf6" stroke="#c5cae9" strokeWidth={0.5} />
                      <text x={b.cx} y={barBase + 41} textAnchor="middle"
                        fontSize={9} fontWeight={600} fontFamily="system-ui, -apple-system, sans-serif" fill="#3949ab">
                        &pound;{monthlyPlatformFee.toFixed(0)} fee
                      </text>

                      {b.m.isCurrent && (
                        <circle cx={b.cx} cy={barBase + 57} r={3} fill="#1565c0" />
                      )}
                    </g>
                  )
                })}
              </svg>
              {!isFixed && (
                <div style={{ display: 'flex', justifyContent: 'space-around', padding: '0 55px', marginTop: -8 }}>
                  {chartData.map((m, i) => (
                    <button
                      key={i}
                      className="billing-invoice-btn"
                      title={`Download invoice for ${m.month} ${m.year}`}
                      onClick={() => handleInvoice(m.month, m.year)}
                      style={{ flex: '0 0 auto', width: `${100 / cols}%`, display: 'flex', justifyContent: 'center' }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 18 15 15"/></svg>
                    </button>
                  ))}
                </div>
              )}
            </>
          )
        })()}
      </div>

      {isFixed && (
        <div style={{ display: 'flex', justifyContent: 'center', margin: '16px 0' }}>
          <button
            className="admin-btn admin-btn-primary"
            onClick={handleAnnualInvoice}
            style={{ display: 'flex', alignItems: 'center', gap: 8 }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 18 15 15"/></svg>
            Download Annual Invoice (FY {getFYLabel()})
          </button>
        </div>
      )}

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Feature</th>
              <th>Type</th>
              {!isFixed && <th>Price / User</th>}
              <th>{isFixed ? 'Included' : 'Monthly Cost'}</th>
            </tr>
          </thead>
          <tbody>
            {baseline && (
              <tr>
                <td>{baseline.display_name}</td>
                <td><span className="admin-badge admin-badge-approved">Core</span></td>
                {!isFixed && <td>&pound;{effectivePrice(baseline).toFixed(2)}</td>}
                <td>{isFixed ? <span style={{ color: '#43a047', fontWeight: 600 }}>&#10003;</span> : <>&pound;{(effectivePrice(baseline) * employeeCount).toFixed(2)}</>}</td>
              </tr>
            )}
            {baseline && (
              <tr>
                <td colSpan={isFixed ? 2 : 3} style={{ paddingLeft: 24, fontSize: 12, color: '#888', borderBottom: '1px solid #f0f0f0' }}>
                  {BILLING_CORE_FEATURES.join(' · ')}
                </td>
                <td style={{ borderBottom: '1px solid #f0f0f0' }}></td>
              </tr>
            )}
            {packAEnabled && packAPricing && (
              <>
                <tr>
                  <td style={{ color: '#2e7d32', fontWeight: 600 }}>Pack A: Workforce &amp; Operations</td>
                  <td><span className="admin-badge" style={{ background: '#e8f5e9', color: '#2e7d32' }}>Pack A</span></td>
                  {!isFixed && <td>&pound;{packAPrice.toFixed(2)}</td>}
                  <td>{isFixed ? <span style={{ color: '#43a047', fontWeight: 600 }}>&#10003;</span> : <>&pound;{(packAPrice * employeeCount).toFixed(2)}</>}</td>
                </tr>
                <tr>
                  <td colSpan={isFixed ? 2 : 3} style={{ paddingLeft: 24, fontSize: 12, color: '#888', borderBottom: '1px solid #f0f0f0' }}>
                    {BILLING_PACK_A_LABELS.join(' · ')}
                  </td>
                  <td style={{ borderBottom: '1px solid #f0f0f0' }}></td>
                </tr>
              </>
            )}
            {packBEnabled && packBPricing && (
              <>
                <tr>
                  <td style={{ color: '#7b1fa2', fontWeight: 600 }}>Pack B: Enterprise Integrations</td>
                  <td><span className="admin-badge" style={{ background: '#f3e5f5', color: '#7b1fa2' }}>Pack B</span></td>
                  {!isFixed && <td>&pound;{packBPrice.toFixed(2)}</td>}
                  <td>{isFixed ? <span style={{ color: '#43a047', fontWeight: 600 }}>&#10003;</span> : <>&pound;{(packBPrice * employeeCount).toFixed(2)}</>}</td>
                </tr>
                <tr>
                  <td colSpan={isFixed ? 2 : 3} style={{ paddingLeft: 24, fontSize: 12, color: '#888', borderBottom: '1px solid #f0f0f0' }}>
                    {BILLING_PACK_B_LABELS.join(' · ')}
                  </td>
                  <td style={{ borderBottom: '1px solid #f0f0f0' }}></td>
                </tr>
              </>
            )}
            {enabledSupport.map(sp => (
              <tr key={sp.feature_key}>
                <td style={{ color: '#e65100' }}>{sp.display_name}</td>
                <td><span className="admin-badge" style={{ background: '#fff3e0', color: '#e65100' }}>Support</span></td>
                {!isFixed && <td>&pound;{(sp.flat_price ?? 0).toFixed(2)} flat</td>}
                <td>&pound;{(sp.flat_price ?? 0).toFixed(2)}</td>
              </tr>
            ))}
            <tr>
              <td>Platform Fee</td>
              <td><span className="admin-badge" style={{ background: '#e3f2fd', color: '#1565c0' }}>Flat</span></td>
              {!isFixed && <td>&pound;{monthlyPlatformFee.toFixed(2)} flat</td>}
              <td>&pound;{monthlyPlatformFee.toFixed(2)}</td>
            </tr>
            {isFixed ? (
              <>
                <tr style={{ fontWeight: 700 }}>
                  <td>Annual Fixed Price</td>
                  <td></td>
                  <td>&pound;{(fixedAnnualPrice + monthlyPlatformFee * 12).toFixed(2)}</td>
                </tr>
                <tr style={{ fontWeight: 600 }}>
                  <td>VAT (20%)</td>
                  <td></td>
                  <td>&pound;{((fixedAnnualPrice + monthlyPlatformFee * 12) * VAT_RATE).toFixed(2)}</td>
                </tr>
                <tr style={{ fontWeight: 700 }}>
                  <td>Annual Total</td>
                  <td></td>
                  <td>&pound;{((fixedAnnualPrice + monthlyPlatformFee * 12) * (1 + VAT_RATE)).toFixed(2)}</td>
                </tr>
              </>
            ) : (
              <>
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
              </>
            )}
          </tbody>
        </table>
      </div>

      <div className="billing-terms">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        <span>All invoices are payable within <strong>30 days</strong> of the invoice date. Billed by <strong>Kumonix Ltd</strong> (kumonix.com). VAT charged at 20%.{isFixed && <> This company is on <strong>fixed annual billing</strong>.</>}</span>
      </div>

      {!isSuperAdmin && (
        <div style={{ borderTop: '2px solid #ef4444', paddingTop: 20, marginTop: 24 }}>
          <h3 style={{ color: '#ef4444', margin: '0 0 12px' }}>Cancel Subscription</h3>
          {existingCancellation ? (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: 16 }}>
              <p style={{ margin: 0, fontWeight: 600, color: '#dc2626' }}>Cancellation in progress</p>
              <p style={{ margin: '8px 0 0', fontSize: 14, color: '#7f1d1d' }}>
                Status: <strong>{existingCancellation.status}</strong>
                {existingCancellation.billing_end_date && (
                  <> — Service until {new Date(existingCancellation.billing_end_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</>
                )}
              </p>
              {existingCancellation.status === 'frozen' && (
                <p style={{ margin: '8px 0 0', fontSize: 14, color: '#7f1d1d' }}>
                  Your data has been frozen. The service administrator will provide your data export shortly.
                </p>
              )}
            </div>
          ) : (
            <>
              <p style={{ fontSize: 14, color: '#64748b', marginBottom: 12 }}>
                Cancelling your subscription will end your service at the close of the current billing period. All outstanding charges for this month will still apply.
              </p>
              <button
                onClick={handleOpenCancelModal}
                style={{ padding: '10px 20px', borderRadius: 6, border: '1px solid #fecaca', background: '#fff', color: '#ef4444', cursor: 'pointer', fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
                </svg>
                Cancel Subscription
              </button>
            </>
          )}
        </div>
      )}

      {showCancelModal && (
        <div className="modal-overlay" onClick={() => !cancelling && setShowCancelModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <h2 style={{ color: '#dc2626', margin: '0 0 16px' }}>Cancel Subscription</h2>

            {cancelBillingLoading ? (
              <p>Loading billing information…</p>
            ) : cancelBilling ? (
              <>
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: 16, marginBottom: 16 }}>
                  <h3 style={{ margin: '0 0 8px', fontSize: 15, color: '#991b1b' }}>Outstanding Charges</h3>
                  <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 4 }}>
                    <span>Billing type</span>
                    <strong>{cancelBilling.billing_type === 'fixed' ? 'Fixed Annual' : 'Monthly per employee'}</strong>
                  </div>
                  {cancelBilling.employee_count != null && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 4 }}>
                      <span>Active employees</span>
                      <strong>{cancelBilling.employee_count}</strong>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 4 }}>
                    <span>Amount due</span>
                    <strong style={{ color: '#dc2626', fontSize: 18 }}>&pound;{cancelBilling.outstanding_amount.toFixed(2)}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                    <span>Service until</span>
                    <strong>{new Date(cancelBilling.billing_end_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</strong>
                  </div>
                  <p style={{ fontSize: 13, color: '#7f1d1d', marginTop: 8, marginBottom: 0 }}>{cancelBilling.note}</p>
                </div>

                <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: 16, marginBottom: 16 }}>
                  <h3 style={{ margin: '0 0 8px', fontSize: 15, color: '#92400e' }}>What happens next</h3>
                  <ol style={{ margin: 0, paddingLeft: 20, fontSize: 14, color: '#78350f', lineHeight: 1.6 }}>
                    <li>Your request is sent to the service administrator for review</li>
                    <li>At the end of your billing period, your account will be frozen</li>
                    <li>All company data will be exported and made available for download</li>
                    <li>No one at your company will be able to log in after the freeze</li>
                    <li>After 30 days, all data will be permanently deleted</li>
                  </ol>
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontWeight: 600, marginBottom: 6, fontSize: 14 }}>Reason for cancellation (optional)</label>
                  <textarea
                    value={cancelReason}
                    onChange={e => setCancelReason(e.target.value)}
                    rows={3}
                    style={{ width: '100%', borderRadius: 6, border: '1px solid #d1d5db', padding: 10, fontSize: 14, resize: 'vertical', boxSizing: 'border-box' }}
                    placeholder="Help us improve — why are you cancelling?"
                  />
                </div>

                <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => setShowCancelModal(false)}
                    disabled={cancelling}
                    style={{ padding: '10px 20px', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: 14 }}
                  >Keep Subscription</button>
                  <button
                    onClick={handleConfirmCancellation}
                    disabled={cancelling}
                    style={{ padding: '10px 20px', borderRadius: 6, border: 'none', background: '#dc2626', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}
                  >{cancelling ? 'Submitting…' : 'Confirm Cancellation'}</button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}

function SuperAdminBilling({ companies }: { companies: { id: string; name: string; is_trial?: boolean; trial_end_date?: string | null }[] }) {
  const [pricing, setPricing] = useState<PricingRow[]>([])
  const [allFeatures, setAllFeatures] = useState<CompanyFeature[]>([])
  const [employeeCounts, setEmployeeCounts] = useState<Record<string, number>>({})
  const [platformFees, setPlatformFees] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [companies])

  async function load() {
    if (companies.length === 0) return
    setLoading(true)
    const [pricingRes, featuresRes, companiesRes] = await Promise.all([
      supabase.from('subscription_pricing').select('*').eq('is_active', true),
      supabase.from('company_features').select('*'),
      supabase.from('companies').select('id, monthly_platform_fee'),
    ])
    setPricing((pricingRes.data as PricingRow[]) || [])
    setAllFeatures((featuresRes.data as CompanyFeature[]) || [])
    const fees: Record<string, number> = {}
    if (companiesRes.data) {
      for (const c of companiesRes.data as { id: string; monthly_platform_fee: number | null }[]) {
        fees[c.id] = c.monthly_platform_fee ?? 30
      }
    }
    setPlatformFees(fees)

    const counts: Record<string, number> = {}
    const { data: metrics } = await supabase.rpc('get_all_company_metrics')
    if (metrics && Array.isArray(metrics)) {
      for (const m of metrics) {
        counts[m.company_id] = m.employee_count || 0
      }
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
      const defaultBasePrice = baseline?.default_price ?? 0
      const hasCustomCore = basePrice !== defaultBasePrice
      const enabledAddons = addons.filter(a => coFeatures.some(f => f.feature_key === a.feature_key && f.is_enabled))
      const hasCustomAddons = enabledAddons.some(a => {
        const cf = coFeatures.find(f => f.feature_key === a.feature_key)
        return cf?.custom_price != null && cf.custom_price !== a.default_price
      })
      const addonTotal = enabledAddons.reduce((s, a) => s + effectivePrice(a), 0)
      const companyPlatformFee = platformFees[c.id] ?? 30
      const subtotal = (basePrice + addonTotal) * empCount + companyPlatformFee
      const vat = subtotal * VAT_RATE
      const monthly = subtotal + vat

      return {
        id: c.id,
        name: c.name,
        employees: empCount,
        core: basePrice * empCount,
        corePerUser: basePrice,
        hasCustomCore,
        hasCustomAddons,
        addonsTotal: addonTotal * empCount,
        platformFee: companyPlatformFee,
        subtotal,
        vat,
        monthly,
        enabledAddons: enabledAddons.map(a => a.display_name),
        baselineName: baseline?.display_name || 'Core',
        baselinePrice: basePrice,
        addonDetails: enabledAddons.map(a => ({ name: a.display_name, price: effectivePrice(a) })),
        isTrial: c.is_trial || false,
        trialEndDate: c.trial_end_date || null,
      }
    }).sort((a, b) => b.monthly - a.monthly)
  }, [companies, pricing, allFeatures, employeeCounts, platformFees])

  const platformSubtotal = companyData.reduce((s, c) => s + c.subtotal, 0)
  const platformVat = companyData.reduce((s, c) => s + c.vat, 0)
  const platformTotal = companyData.reduce((s, c) => s + c.monthly, 0)
  const platformCore = companyData.reduce((s, c) => s + c.core, 0)
  const platformAddons = companyData.reduce((s, c) => s + c.addonsTotal, 0)
  const platformFeeTotal = companyData.reduce((s, c) => s + c.platformFee, 0)
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
        <div className="billing-card">
          <span className="billing-card-label">Platform Fees</span>
          <span className="billing-card-value">&pound;{platformFeeTotal.toFixed(2)}</span>
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
              <th>Core/User</th>
              <th>Core Total</th>
              <th>Add-ons</th>
              <th>Platform Fee</th>
              <th>VAT</th>
              <th>Monthly Total</th>
              <th>Active Add-ons</th>
              <th>Invoice</th>
            </tr>
          </thead>
          <tbody>
            {companyData.map(c => (
              <tr key={c.id}>
                <td>
                  <strong>{c.name}</strong>
                  {c.isTrial && (
                    <span style={{ display: 'inline-block', marginLeft: 6, fontSize: 10, background: c.trialEndDate && new Date(c.trialEndDate) < new Date() ? '#ffebee' : '#fff3e0', color: c.trialEndDate && new Date(c.trialEndDate) < new Date() ? '#c62828' : '#e65100', padding: '1px 6px', borderRadius: 3, fontWeight: 600, verticalAlign: 'middle' }}>
                      {c.trialEndDate && new Date(c.trialEndDate) < new Date() ? 'Trial Expired' : 'Trial'}
                    </span>
                  )}
                </td>
                <td>{c.employees}</td>
                <td>
                  &pound;{c.corePerUser.toFixed(2)}
                  {(c.hasCustomCore || c.hasCustomAddons) && (
                    <span style={{ display: 'inline-block', marginLeft: 4, fontSize: 10, background: '#e3f2fd', color: '#1565c0', padding: '1px 5px', borderRadius: 3, fontWeight: 600, verticalAlign: 'middle' }}>Custom</span>
                  )}
                </td>
                <td>&pound;{c.core.toFixed(2)}</td>
                <td>&pound;{c.addonsTotal.toFixed(2)}</td>
                <td>&pound;{c.platformFee.toFixed(2)}</td>
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
              <td></td>
              <td>&pound;{platformCore.toFixed(2)}</td>
              <td>&pound;{platformAddons.toFixed(2)}</td>
              <td>&pound;{platformFeeTotal.toFixed(2)}</td>
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
