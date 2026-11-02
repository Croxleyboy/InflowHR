import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { useToast } from '../../context/ToastContext'
import jsPDF from 'jspdf'
import { formatCurrency, currencySymbol } from '../../lib/formatters'
import { isWithinGracePeriod, gracePeriodRemaining, formatUKDate, type BillingAdjustment } from '../../lib/billingCalculations'

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
  support_type: 'launch' | 'monthly' | null
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
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const VAT_RATE = 0.20


export default function AdminBilling() {
  const { isSuperAdmin, isMspAdmin } = useAuth()
  const { selectedCompanyId, selectedCompany, companies } = useAdminCompany()

  if (isSuperAdmin) return <SuperAdminBilling companies={companies} />
  return <CompanyBilling companyId={selectedCompanyId} companyName={selectedCompany?.name || ''} isMspAdmin={isMspAdmin} managedByMspId={selectedCompany?.managed_by_msp_id || null} />
}

function generateInvoicePDF(
  companyName: string,
  monthLabel: string,
  year: number,
  baselineName: string,
  baselinePrice: number,
  packs: { name: string; price: number }[],
  employeeCount: number,
  companyId?: string,
  supportItems?: { name: string; price: number }[],
  platformFee?: number,
  currency: string = 'GBP',
  adjustments?: BillingAdjustment[],
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
  doc.text('support@kumonix.com', lm, y + 11)

  doc.setFontSize(28)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(30, 30, 45)
  doc.text('INVOICE', rm, y, { align: 'right' })
  y += 24

  const now = new Date()
  const companySlug = companyId ? companyId.replace(/-/g, '').substring(0, 8).toUpperCase() : companyName.replace(/[^a-zA-Z0-9]/g, '').substring(0, 6).toUpperCase()
  const invoiceNum = `INV-${year}${String(MONTH_FULL.indexOf(monthLabel) + 1).padStart(2, '0')}-${companySlug}`
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

  let rowIdx = 0
  const drawRow = (name: string, type: string, price: string, users: string, amount: string, indent = false, bold = false) => {
    if (rowIdx % 2 === 0) {
      doc.setFillColor(248, 249, 252)
      doc.rect(lm, y - 4, rm - lm, 8, 'F')
    }
    doc.setFontSize(9)
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.text(name, indent ? lm + 12 : lm + 4, y)
    doc.text(type, lm + 80, y)
    doc.text(price, lm + 110, y)
    doc.text(users, lm + 140, y)
    doc.text(amount, rm - 4, y, { align: 'right' })
    doc.setFont('helvetica', 'normal')
    y += 8
    rowIdx++
  }

  drawRow(baselineName, 'Core', `${formatCurrency(baselinePrice, currency)}`, String(employeeCount), `${formatCurrency(baselinePrice * employeeCount, currency)}`, false, true)

  packs.forEach(p => {
    drawRow(p.name, 'Pack', `${formatCurrency(p.price, currency)}`, String(employeeCount), `${formatCurrency(p.price * employeeCount, currency)}`, false, true)
  })

  if (supportItems && supportItems.length > 0) {
    supportItems.forEach(sp => {
      const isLaunch = sp.name.startsWith('Launch') || sp.name.includes('Launch')
      const type = isLaunch ? 'Launch' : 'Support'
      const suffix = isLaunch ? 'one-off' : (sp.price > 0 ? '/mo' : 'incl.')
      drawRow(sp.name, type, `${formatCurrency(sp.price, currency)} ${suffix}`, '', `${formatCurrency(sp.price, currency)}`, false, true)
    })
  }

  if (platformFee && platformFee > 0) {
    drawRow('Platform Fee', 'Flat', `${formatCurrency(platformFee, currency)} flat`, '', `${formatCurrency(platformFee, currency)}`, false, true)
  }

  let adjustmentsTotal = 0
  if (adjustments && adjustments.length > 0) {
    y += 2
    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(21, 101, 192)
    doc.text('Adjustments', lm + 4, y)
    y += 6
    doc.setTextColor(30, 30, 45)
    adjustments.forEach(adj => {
      const label = adj.adjustment_type === 'grace_reversal'
        ? `Grace reversal: ${adj.display_name}`
        : `Pro-rata: ${adj.display_name} (${adj.days_charged}/${adj.days_in_month} days)`
      const amt = adj.line_amount
      adjustmentsTotal += amt
      if (rowIdx % 2 === 0) {
        doc.setFillColor(248, 249, 252)
        doc.rect(lm, y - 4, rm - lm, 8, 'F')
      }
      doc.setFontSize(9)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(adj.adjustment_type === 'grace_reversal' ? 220 : 30, adj.adjustment_type === 'grace_reversal' ? 30 : 30, adj.adjustment_type === 'grace_reversal' ? 30 : 45)
      doc.text(label, lm + 8, y)
      doc.text('Adj.', lm + 80, y)
      doc.text('', lm + 110, y)
      doc.text('', lm + 140, y)
      doc.text(`${amt < 0 ? '-' : ''}${formatCurrency(Math.abs(amt), currency)}`, rm - 4, y, { align: 'right' })
      y += 8
      rowIdx++
    })
  }

  y += 4
  doc.setDrawColor(220, 220, 220)
  doc.line(lm + 100, y, rm, y)
  y += 8

  const supportTotal = (supportItems || []).reduce((s, sp) => s + sp.price, 0)
  const subtotal = baselinePrice * employeeCount + packs.reduce((s, p) => s + p.price * employeeCount, 0) + supportTotal + (platformFee || 0) + adjustmentsTotal
  const vat = subtotal * VAT_RATE
  const total = subtotal + vat

  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text('Subtotal', lm + 110, y)
  doc.text(`${formatCurrency(subtotal, currency)}`, rm - 4, y, { align: 'right' })
  y += 7
  doc.text(`VAT (${(VAT_RATE * 100).toFixed(0)}%)`, lm + 110, y)
  doc.text(`${formatCurrency(vat, currency)}`, rm - 4, y, { align: 'right' })
  y += 3
  doc.setDrawColor(21, 101, 192)
  doc.setLineWidth(0.5)
  doc.line(lm + 100, y, rm, y)
  y += 8
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(21, 101, 192)
  doc.text('Total Due', lm + 110, y)
  doc.text(`${formatCurrency(total, currency)}`, rm - 4, y, { align: 'right' })
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
  doc.text('  |  kumonix.com  |  support@kumonix.com', lm + 26, y)

  const safeCompany = companyName.replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-')
  doc.save(`Invoice-${safeCompany}-${monthLabel}-${year}.pdf`)
}

function generateAnnualInvoicePDF(
  companyName: string,
  fyLabel: string,
  annualPrice: number,
  subscribedFeatures: { name: string; type: string; pack?: string }[],
  companyId?: string,
  currency: string = 'GBP',
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
  doc.text('support@kumonix.com', lm, y + 11)

  doc.setFontSize(28)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(30, 30, 45)
  doc.text('INVOICE', rm, y, { align: 'right' })
  y += 24

  const now = new Date()
  const companySlug = companyId ? companyId.replace(/-/g, '').substring(0, 8).toUpperCase() : companyName.replace(/[^a-zA-Z0-9]/g, '').substring(0, 6).toUpperCase()
  const invoiceNum = `INV-${fyLabel.replace(/[^a-zA-Z0-9]/g, '')}-${companySlug}-FP`
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

  let rowIdx = 0
  const drawAnnualRow = (name: string, type: string, indent = false, bold = false) => {
    if (rowIdx % 2 === 0) {
      doc.setFillColor(248, 249, 252)
      doc.rect(lm, y - 4, rm - lm, 8, 'F')
    }
    doc.setFontSize(9)
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.text(name, indent ? lm + 12 : lm + 4, y)
    doc.text(type, lm + 110, y)
    doc.setFont('helvetica', 'normal')
    y += 8
    rowIdx++
  }

  const grouped = new Map<string, string[]>()
  const ungrouped: { name: string; type: string }[] = []
  for (const f of subscribedFeatures) {
    if (f.pack) {
      if (!grouped.has(f.pack)) grouped.set(f.pack, [])
      grouped.get(f.pack)!.push(f.name)
    } else {
      ungrouped.push(f)
    }
  }

  for (const f of ungrouped) {
    if (grouped.has(f.name)) {
      drawAnnualRow(f.name, f.type, false, true)
      for (const feat of grouped.get(f.name)!) {
        drawAnnualRow(feat, '', true)
      }
    } else {
      drawAnnualRow(f.name, f.type)
    }
  }
  for (const [packName, feats] of grouped) {
    if (ungrouped.some(u => u.name === packName)) continue
    drawAnnualRow(packName, 'Pack', false, true)
    for (const feat of feats) {
      drawAnnualRow(feat, '', true)
    }
  }

  y += 4
  doc.setDrawColor(220, 220, 220)
  doc.line(lm + 100, y, rm, y)
  y += 8

  const vatAmount = annualPrice * VAT_RATE
  const total = annualPrice + vatAmount

  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.text('Fixed Annual Price', lm + 80, y)
  doc.text(`${formatCurrency(annualPrice, currency)}`, rm - 4, y, { align: 'right' })
  y += 7
  doc.setFont('helvetica', 'normal')
  doc.text(`VAT (${(VAT_RATE * 100).toFixed(0)}%)`, lm + 80, y)
  doc.text(`${formatCurrency(vatAmount, currency)}`, rm - 4, y, { align: 'right' })
  y += 3
  doc.setDrawColor(21, 101, 192)
  doc.setLineWidth(0.5)
  doc.line(lm + 70, y, rm, y)
  y += 8
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(21, 101, 192)
  doc.text('Total Due', lm + 80, y)
  doc.text(`${formatCurrency(total, currency)}`, rm - 4, y, { align: 'right' })
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
  doc.text('  |  kumonix.com  |  support@kumonix.com', lm + 26, y)

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
  is_locked?: boolean
  adjustments_total?: number
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

function CompanyBilling({ companyId, companyName, isMspAdmin, managedByMspId }: { companyId: string; companyName: string; isMspAdmin?: boolean; managedByMspId?: string | null }) {
  const { showError, showSuccess } = useToast()
  const { isSuperAdmin, company } = useAuth()
  const [mspManagerName, setMspManagerName] = useState('')
  const currency = company?.currency || 'GBP'
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

  const [adjustments, setAdjustments] = useState<BillingAdjustment[]>([])
  const [cancellingPack, setCancellingPack] = useState(false)
  const [showPackCancelModal, setShowPackCancelModal] = useState<string | null>(null)
  const isTrial = company?.is_trial || false

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
    if (!managedByMspId) { setMspManagerName(''); return }
    supabase.from('companies').select('name').eq('id', managedByMspId).single()
      .then(({ data }) => { if (data) setMspManagerName(data.name) })
  }, [managedByMspId])

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

    const [pricingRes, featuresRes, metricsRes, snapshotsRes, companyRes, adjustmentsRes] = await Promise.all([
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
      supabase.from('billing_adjustments')
        .select('*')
        .eq('company_id', companyId)
        .eq('year', now.getFullYear())
        .eq('month', now.getMonth() + 1)
        .order('created_at'),
    ])
    const pricingData = (pricingRes.data as PricingRow[]) || []
    const featuresData = (featuresRes.data as CompanyFeature[]) || []
    const empCount = metricsRes.data?.employee_count ?? 0
    const snapshotData = (snapshotsRes.data as BillingSnapshot[]) || []
    setAdjustments((adjustmentsRes.data as BillingAdjustment[]) || [])

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

    const existingSnap = snapshots.find(s => s.year === yr && s.month === mo)
    if (existingSnap?.is_locked) return

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
  const launchPackages = useMemo(() => pricing.filter(p => p.is_support_package && p.support_type === 'launch'), [pricing])
  const monthlySupportPlans = useMemo(() => pricing.filter(p => p.is_support_package && p.support_type === 'monthly'), [pricing])
  const enabledKeys = useMemo(() => new Set(features.filter(f => f.is_enabled).map(f => f.feature_key)), [features])
  const enabledAddons = useMemo(() => {
    return pricing.filter(p => p.is_addon && !p.is_support_package && enabledKeys.has(p.feature_key))
  }, [pricing, enabledKeys])

  const packAEnabled = enabledKeys.has('pack_a')
  const packBEnabled = enabledKeys.has('pack_b')
  const enabledSupport = useMemo(() => supportPackages.filter(sp => enabledKeys.has(sp.feature_key)), [supportPackages, enabledKeys])
  const enabledLaunch = useMemo(() => launchPackages.filter(sp => enabledKeys.has(sp.feature_key)), [launchPackages, enabledKeys])
  const enabledMonthlySupport = useMemo(() => monthlySupportPlans.filter(sp => enabledKeys.has(sp.feature_key)), [monthlySupportPlans, enabledKeys])

  const effectivePrice = useCallback((pr: PricingRow): number => {
    const cf = features.find(f => f.feature_key === pr.feature_key)
    return cf?.custom_price != null ? cf.custom_price : pr.default_price
  }, [features])

  const baselinePrice = baseline ? effectivePrice(baseline) : 0
  const hasCustomCore = baseline ? (baselinePrice !== baseline.default_price) : false
  const packAPrice = packAPricing && packAEnabled ? effectivePrice(packAPricing) : 0
  const packBPrice = packBPricing && packBEnabled ? effectivePrice(packBPricing) : 0
  const launchTotal = enabledLaunch.reduce((sum, sp) => sum + (sp.flat_price ?? 0), 0)
  const monthlySupportTotal = enabledMonthlySupport.reduce((sum, sp) => sum + (sp.flat_price ?? 0), 0)
  const supportTotal = launchTotal + monthlySupportTotal
  const isFixed = billingType === 'fixed' && fixedAnnualPrice > 0
  const fixedMonthly = isFixed ? fixedAnnualPrice / 12 : 0
  const perUserTotal = baselinePrice + packAPrice + packBPrice
  const adjustmentsTotal = adjustments.reduce((s, a) => s + a.line_amount, 0)
  const subtotal = (isFixed ? fixedMonthly : perUserTotal * employeeCount) + supportTotal + monthlyPlatformFee + (isFixed || isTrial ? 0 : adjustmentsTotal)
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

  const packAFeature = features.find(f => f.feature_key === 'pack_a')
  const packBFeature = features.find(f => f.feature_key === 'pack_b')

  async function handleCancelPack(packKey: string) {
    setCancellingPack(true)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await supabase.rpc('cancel_pack' as any, { p_company_id: companyId, p_pack_key: packKey })
      if (error) { showError('Failed to cancel pack: ' + error.message); setCancellingPack(false); setShowPackCancelModal(null); return }
      const result = data as { status: string; message: string } | null
      showSuccess(result?.message || 'Pack cancellation processed')
      setShowPackCancelModal(null)
      await load()
    } catch {
      showError('Failed to cancel pack — please try again')
    }
    setCancellingPack(false)
  }

  function handleInvoice(month: string, year: number) {
    if (!baseline) return
    const monthIdx = MONTH_FULL.indexOf(month)
    const now = new Date()
    const isCurrent = year === now.getFullYear() && monthIdx === now.getMonth()
    const snap = snapshots.find(s => s.year === year && s.month === monthIdx + 1)

    const monthAdj = (!isFixed && !isTrial && isCurrent) ? adjustments : []

    if (!isCurrent && snap && snap.feature_details?.length > 0) {
      const coreDetail = snap.feature_details.find(d => d.key === baseline.feature_key)
      const addonDetails = snap.feature_details.filter(d => d.key !== baseline.feature_key)
      const invoicePacks = addonDetails.map(d => {
        return { name: d.name, price: d.price }
      })
      generateInvoicePDF(
        companyName,
        month,
        year,
        coreDetail?.name || baseline.display_name,
        snap.core_per_user,
        invoicePacks,
        snap.employee_count,
        companyId,
        [...enabledLaunch, ...enabledMonthlySupport].map(sp => ({ name: sp.display_name, price: sp.flat_price ?? 0 })),
        monthlyPlatformFee,
        currency,
        monthAdj,
      )
    } else {
      const invoicePacks = enabledAddons.map(a => {
        return { name: a.display_name, price: effectivePrice(a) }
      })
      generateInvoicePDF(
        companyName,
        month,
        year,
        baseline.display_name,
        effectivePrice(baseline),
        invoicePacks,
        employeeCount,
        companyId,
        [...enabledLaunch, ...enabledMonthlySupport].map(sp => ({ name: sp.display_name, price: sp.flat_price ?? 0 })),
        monthlyPlatformFee,
        currency,
        monthAdj,
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
    const allFeatures: { name: string; type: string; pack?: string }[] = []
    if (baseline) {
      allFeatures.push({ name: baseline.display_name, type: 'Core' })
    }
    if (packAEnabled && packAPricing) {
      allFeatures.push({ name: packAPricing.display_name, type: 'Pack A' })
    }
    if (packBEnabled && packBPricing) {
      allFeatures.push({ name: 'Pack B: ' + packBPricing.display_name, type: 'Pack B' })
    }
    enabledLaunch.forEach(sp => allFeatures.push({ name: sp.display_name, type: 'Launch' }))
    enabledMonthlySupport.forEach(sp => allFeatures.push({ name: sp.display_name, type: 'Support' }))
    generateAnnualInvoicePDF(companyName, getFYLabel(), fixedAnnualPrice, allFeatures, companyId, currency)
  }

  if (managedByMspId && !isSuperAdmin) {
    return (
      <div className="admin-section">
        <div className="admin-page-header">
          <h2>Billing &amp; Subscription</h2>
          <p>Financial overview for {companyName || 'your company'}</p>
        </div>
        <div style={{ background: '#ede9fe', border: '1px solid #7c3aed', borderRadius: 12, padding: '32px 24px', textAlign: 'center', maxWidth: 520, margin: '32px auto' }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 12 }}>
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/><circle cx="12" cy="7" r="1.5"/>
          </svg>
          <h3 style={{ margin: '0 0 8px', color: '#5b21b6', fontSize: 18 }}>Billing Managed by {mspManagerName || 'Your MSP Partner'}</h3>
          <p style={{ margin: 0, color: '#555', fontSize: 14, lineHeight: 1.6 }}>
            Your company&rsquo;s billing and subscription is managed through your MSP partner agreement with <strong>{mspManagerName || 'your partner'}</strong>. For billing enquiries, invoices, or plan changes, please contact your MSP partner directly.
          </p>
        </div>
      </div>
    )
  }

  if (loading) return <div className="admin-section"><div className="admin-loading">Loading...</div></div>

  return (
    <div className="admin-section">
      <div className="admin-page-header">
        <h2>Billing &amp; Subscription</h2>
        <p>Financial overview for {companyName || 'your company'}</p>
      </div>

      {isMspAdmin && (
        <div style={{ background: '#ede9fe', border: '1px solid #7c3aed', borderRadius: 8, padding: 12, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 600, color: '#5b21b6' }}>MSP Managed</span>
          <span style={{ color: '#555', fontSize: 13 }}>&mdash; Billing for this company is managed through your MSP partner agreement. Contact your InflowHR account manager for wholesale pricing details.</span>
        </div>
      )}

      {isFixed && (
        <div style={{ background: '#e8f5e9', border: '1px solid #43a047', borderRadius: 8, padding: 12, marginBottom: 16, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <span style={{ fontSize: 18 }}>&#9679;</span>
          <span style={{ fontWeight: 600, color: '#2e7d32' }}>Fixed Annual Billing</span>
          <span style={{ color: '#555', fontSize: 13 }}>&mdash; {formatCurrency(fixedAnnualPrice, currency)}/year (FY {getFYLabel()})</span>
        </div>
      )}

      <div className="billing-summary">
        {isFixed ? (
          <>
            <div className="billing-card">
              <span className="billing-card-label">Annual Price</span>
              <span className="billing-card-value">{formatCurrency(fixedAnnualPrice, currency)}</span>
              <span className="billing-card-sub">fixed / year</span>
            </div>
            <div className="billing-card">
              <span className="billing-card-label">Monthly Equivalent</span>
              <span className="billing-card-value">{formatCurrency(fixedMonthly, currency)}</span>
              <span className="billing-card-sub">excl. VAT</span>
            </div>
            <div className="billing-card">
              <span className="billing-card-label">Active Users</span>
              <span className="billing-card-value">{employeeCount}</span>
              <span className="billing-card-sub">employees</span>
            </div>
            <div className="billing-card billing-card-highlight">
              <span className="billing-card-label">Annual Total (inc. VAT)</span>
              <span className="billing-card-value">{formatCurrency(fixedAnnualPrice + fixedAnnualPrice * VAT_RATE, currency)}</span>
              <span className="billing-card-sub">{formatCurrency(fixedAnnualPrice, currency)} + {formatCurrency(fixedAnnualPrice * VAT_RATE, currency)} VAT</span>
            </div>
          </>
        ) : (
          <>
            <div className="billing-card">
              <span className="billing-card-label">Core Plan{hasCustomCore && <span style={{ marginLeft: 6, fontSize: 10, background: '#e3f2fd', color: '#1565c0', padding: '1px 5px', borderRadius: 3, fontWeight: 600 }}>Custom</span>}</span>
              <span className="billing-card-value">{formatCurrency(baselinePrice, currency)}</span>
              <span className="billing-card-sub">per user / month</span>
            </div>
            {packAEnabled && (
              <div className="billing-card" style={{ borderTop: '3px solid #43a047' }}>
                <span className="billing-card-label" style={{ color: '#2e7d32' }}>Pack A: People Ops</span>
                <span className="billing-card-value">{formatCurrency(packAPrice, currency)}</span>
                <span className="billing-card-sub">per user / month</span>
              </div>
            )}
            {packBEnabled && (
              <div className="billing-card" style={{ borderTop: '3px solid #7b1fa2' }}>
                <span className="billing-card-label" style={{ color: '#7b1fa2' }}>Pack B: Pro Integrations</span>
                <span className="billing-card-value">{formatCurrency(packBPrice, currency)}</span>
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
              <span className="billing-card-value">{formatCurrency(monthlyTotal, currency)}</span>
              <span className="billing-card-sub">{formatCurrency(subtotal, currency)} + {formatCurrency(vat, currency)} VAT</span>
            </div>
          </>
        )}
      </div>

      {!isFixed && !isTrial && (packAEnabled || packBEnabled) && (
        <div style={{ background: '#fafafa', border: '1px solid #e0e0e0', borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>Your Packs</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {packAEnabled && packAPricing && (
              <div style={{ background: '#fff', border: '1px solid #a5d6a7', borderRadius: 8, padding: 12, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <span style={{ fontWeight: 600, color: '#2e7d32', flex: '1 1 auto' }}>Pack A: People Operations</span>
                <span style={{ fontSize: 13, color: '#555' }}>{formatCurrency(packAPrice, currency)}/user &middot; {formatCurrency(packAPrice * employeeCount, currency)}/mo</span>
                {packAFeature?.activated_at && (
                  <span style={{ fontSize: 12, color: '#888' }}>Activated: {formatUKDate(packAFeature.activated_at)}</span>
                )}
                {packAFeature && isWithinGracePeriod(packAFeature.activated_at) && (
                  <span style={{ fontSize: 11, background: '#fff8e1', color: '#f57f17', border: '1px solid #ffcc02', padding: '2px 8px', borderRadius: 12, fontWeight: 600 }}>
                    Grace period: {gracePeriodRemaining(packAFeature.activated_at)} days left
                  </span>
                )}
                {packAFeature?.cancellation_scheduled && (
                  <span style={{ fontSize: 11, background: '#ffebee', color: '#c62828', border: '1px solid #ef9a9a', padding: '2px 8px', borderRadius: 12, fontWeight: 600 }}>
                    Cancelling: active until {formatUKDate(packAFeature.cancellation_effective_date)}
                  </span>
                )}
                {!isSuperAdmin && !packAFeature?.cancellation_scheduled && (
                  <button
                    onClick={() => setShowPackCancelModal('pack_a')}
                    style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid #ef9a9a', background: '#fff', color: '#c62828', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
                  >Cancel Pack</button>
                )}
              </div>
            )}
            {packBEnabled && packBPricing && (
              <div style={{ background: '#fff', border: '1px solid #ce93d8', borderRadius: 8, padding: 12, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <span style={{ fontWeight: 600, color: '#7b1fa2', flex: '1 1 auto' }}>Pack B: Pro Integrations</span>
                <span style={{ fontSize: 13, color: '#555' }}>{formatCurrency(packBPrice, currency)}/user &middot; {formatCurrency(packBPrice * employeeCount, currency)}/mo</span>
                {packBFeature?.activated_at && (
                  <span style={{ fontSize: 12, color: '#888' }}>Activated: {formatUKDate(packBFeature.activated_at)}</span>
                )}
                {packBFeature && isWithinGracePeriod(packBFeature.activated_at) && (
                  <span style={{ fontSize: 11, background: '#fff8e1', color: '#f57f17', border: '1px solid #ffcc02', padding: '2px 8px', borderRadius: 12, fontWeight: 600 }}>
                    Grace period: {gracePeriodRemaining(packBFeature.activated_at)} days left
                  </span>
                )}
                {packBFeature?.cancellation_scheduled && (
                  <span style={{ fontSize: 11, background: '#ffebee', color: '#c62828', border: '1px solid #ef9a9a', padding: '2px 8px', borderRadius: 12, fontWeight: 600 }}>
                    Cancelling: active until {formatUKDate(packBFeature.cancellation_effective_date)}
                  </span>
                )}
                {!isSuperAdmin && !packBFeature?.cancellation_scheduled && (
                  <button
                    onClick={() => setShowPackCancelModal('pack_b')}
                    style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid #ce93d8', background: '#fff', color: '#7b1fa2', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
                  >Cancel Pack</button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {(isFixed || isTrial) && (packAEnabled || packBEnabled) && (
        <div style={{ background: '#e3f2fd', border: '1px solid #90caf9', borderRadius: 8, padding: 10, marginBottom: 16, fontSize: 13, color: '#1565c0' }}>
          <strong>Note:</strong> Pro-rata billing does not apply to {isTrial ? 'trial' : 'fixed-price'} subscriptions.
        </div>
      )}

      {!isFixed && (packAEnabled || packBEnabled || enabledLaunch.length > 0 || enabledMonthlySupport.length > 0) && (
        <div className="billing-addons" style={{ flexWrap: 'wrap', gap: 6 }}>
          {packAEnabled && (
            <span className="billing-addon-chip" style={{ background: '#e8f5e9', color: '#2e7d32', border: '1px solid #a5d6a7', fontWeight: 600 }}>Pack A: People Operations</span>
          )}
          {packBEnabled && (
            <span className="billing-addon-chip" style={{ background: '#f3e5f5', color: '#7b1fa2', border: '1px solid #ce93d8', fontWeight: 600 }}>Pack B: Pro Integrations</span>
          )}
          {enabledLaunch.map(sp => (
            <span key={sp.feature_key} className="billing-addon-chip" style={{ background: '#fff3e0', color: '#e65100', border: '1px solid #ffcc80' }}>
              {sp.display_name} &mdash; {formatCurrency(sp.flat_price ?? 0, currency)} (one-off)
            </span>
          ))}
          {enabledMonthlySupport.map(sp => (
            <span key={sp.feature_key} className="billing-addon-chip" style={{ background: '#e0f2f1', color: '#00695c', border: '1px solid #80cbc4' }}>
              {sp.display_name} &mdash; {sp.flat_price ? `${formatCurrency(sp.flat_price, currency)}/mo` : 'Included'}
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
            const grandTotal = featureTotal + monthlyPlatformFee + (m.isCurrent ? supportTotal : 0)

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
                        {currencySymbol(currency)}{b.grandTotal.toFixed(0)}
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
                        {currencySymbol(currency)}{monthlyPlatformFee.toFixed(0)} fee
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
                {!isFixed && <td>{formatCurrency(effectivePrice(baseline), currency)}</td>}
                <td>{isFixed ? <span style={{ color: '#43a047', fontWeight: 600 }}>&#10003;</span> : <>{formatCurrency(effectivePrice(baseline) * employeeCount, currency)}</>}</td>
              </tr>
            )}
            {packAEnabled && packAPricing && (
              <>
                <tr>
                  <td style={{ color: '#2e7d32', fontWeight: 600 }}>Pack A: People Operations</td>
                  <td><span className="admin-badge" style={{ background: '#e8f5e9', color: '#2e7d32' }}>Pack A</span></td>
                  {!isFixed && <td>{formatCurrency(packAPrice, currency)}</td>}
                  <td>{isFixed ? <span style={{ color: '#43a047', fontWeight: 600 }}>&#10003;</span> : <>{formatCurrency(packAPrice * employeeCount, currency)}</>}</td>
                </tr>
              </>
            )}
            {packBEnabled && packBPricing && (
              <>
                <tr>
                  <td style={{ color: '#7b1fa2', fontWeight: 600 }}>Pack B: Pro Integrations</td>
                  <td><span className="admin-badge" style={{ background: '#f3e5f5', color: '#7b1fa2' }}>Pack B</span></td>
                  {!isFixed && <td>{formatCurrency(packBPrice, currency)}</td>}
                  <td>{isFixed ? <span style={{ color: '#43a047', fontWeight: 600 }}>&#10003;</span> : <>{formatCurrency(packBPrice * employeeCount, currency)}</>}</td>
                </tr>
              </>
            )}
            {enabledLaunch.map(sp => (
              <tr key={sp.feature_key}>
                <td style={{ color: '#e65100' }}>{sp.display_name}</td>
                <td><span className="admin-badge" style={{ background: '#fff3e0', color: '#e65100' }}>Launch</span></td>
                {!isFixed && <td>{formatCurrency(sp.flat_price ?? 0, currency)} one-off</td>}
                <td>{formatCurrency(sp.flat_price ?? 0, currency)}</td>
              </tr>
            ))}
            {enabledMonthlySupport.map(sp => (
              <tr key={sp.feature_key}>
                <td style={{ color: '#00695c' }}>{sp.display_name}</td>
                <td><span className="admin-badge" style={{ background: '#e0f2f1', color: '#00695c' }}>Support</span></td>
                {!isFixed && <td>{sp.flat_price ? `${formatCurrency(sp.flat_price, currency)}/mo` : 'Included'}</td>}
                <td>{sp.flat_price ? `${formatCurrency(sp.flat_price, currency)}` : 'Included'}</td>
              </tr>
            ))}
            <tr>
              <td>Platform Fee</td>
              <td><span className="admin-badge" style={{ background: '#e3f2fd', color: '#1565c0' }}>Flat</span></td>
              {!isFixed && <td>{formatCurrency(monthlyPlatformFee, currency)} flat</td>}
              <td>{formatCurrency(monthlyPlatformFee, currency)}</td>
            </tr>
            {!isFixed && !isTrial && adjustments.length > 0 && (
              <>
                <tr>
                  <td colSpan={4} style={{ fontWeight: 600, color: '#1565c0', paddingTop: 8 }}>Adjustments</td>
                </tr>
                {adjustments.map(adj => (
                  <tr key={adj.id} style={{ color: adj.adjustment_type === 'grace_reversal' ? '#c62828' : '#333' }}>
                    <td style={{ paddingLeft: 16, fontSize: 13 }}>
                      {adj.adjustment_type === 'grace_reversal'
                        ? `Grace reversal: ${adj.display_name}`
                        : `Pro-rata: ${adj.display_name} (${adj.days_charged}/${adj.days_in_month} days)`}
                    </td>
                    <td><span className="admin-badge" style={{ background: '#e3f2fd', color: '#1565c0', fontSize: 10 }}>Adj.</span></td>
                    <td></td>
                    <td style={{ fontWeight: 600 }}>{adj.line_amount < 0 ? '-' : ''}{formatCurrency(Math.abs(adj.line_amount), currency)}</td>
                  </tr>
                ))}
              </>
            )}
            {isFixed ? (
              <>
                <tr style={{ fontWeight: 700 }}>
                  <td>Annual Fixed Price</td>
                  <td></td>
                  <td>{formatCurrency(fixedAnnualPrice + monthlyPlatformFee * 12, currency)}</td>
                </tr>
                <tr style={{ fontWeight: 600 }}>
                  <td>VAT (20%)</td>
                  <td></td>
                  <td>{formatCurrency((fixedAnnualPrice + monthlyPlatformFee * 12) * VAT_RATE, currency)}</td>
                </tr>
                <tr style={{ fontWeight: 700 }}>
                  <td>Annual Total</td>
                  <td></td>
                  <td>{formatCurrency((fixedAnnualPrice + monthlyPlatformFee * 12) * (1 + VAT_RATE), currency)}</td>
                </tr>
              </>
            ) : (
              <>
                <tr style={{ fontWeight: 600 }}>
                  <td>Subtotal</td>
                  <td></td>
                  <td></td>
                  <td>{formatCurrency(subtotal, currency)}</td>
                </tr>
                <tr style={{ fontWeight: 600 }}>
                  <td>VAT (20%)</td>
                  <td></td>
                  <td></td>
                  <td>{formatCurrency(vat, currency)}</td>
                </tr>
                <tr style={{ fontWeight: 700 }}>
                  <td>Monthly Total</td>
                  <td></td>
                  <td></td>
                  <td>{formatCurrency(monthlyTotal, currency)}</td>
                </tr>
                <tr style={{ fontWeight: 700 }}>
                  <td>Annual Estimate</td>
                  <td></td>
                  <td></td>
                  <td>{formatCurrency(monthlyTotal * 12, currency)}</td>
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

      {showPackCancelModal && (
        <div className="modal-overlay" onClick={() => !cancellingPack && setShowPackCancelModal(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
            {(() => {
              const packKey = showPackCancelModal
              const feat = features.find(f => f.feature_key === packKey)
              const packName = packKey === 'pack_a' ? 'Pack A: People Operations' : 'Pack B: Pro Integrations'
              const inGrace = feat ? isWithinGracePeriod(feat.activated_at) : false
              const graceLeft = feat ? gracePeriodRemaining(feat.activated_at) : 0
              return (
                <>
                  <h2 style={{ color: '#c62828', margin: '0 0 12px' }}>Cancel {packName}</h2>
                  {inGrace ? (
                    <div style={{ background: '#fff8e1', border: '1px solid #ffcc02', borderRadius: 8, padding: 14, marginBottom: 16 }}>
                      <p style={{ margin: 0, fontWeight: 600, color: '#f57f17' }}>Within grace period ({graceLeft} days remaining)</p>
                      <p style={{ margin: '8px 0 0', fontSize: 14, color: '#555' }}>
                        This pack will be disabled immediately with <strong>no charge</strong>. Any pro-rata charge already applied will be reversed.
                      </p>
                    </div>
                  ) : (
                    <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: 14, marginBottom: 16 }}>
                      <p style={{ margin: 0, fontWeight: 600, color: '#c62828' }}>Past grace period</p>
                      <p style={{ margin: '8px 0 0', fontSize: 14, color: '#555' }}>
                        Features will remain active until the <strong>end of this billing month</strong>. No further charges will apply from next month.
                      </p>
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                    <button
                      onClick={() => setShowPackCancelModal(null)}
                      disabled={cancellingPack}
                      style={{ padding: '10px 20px', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: 14 }}
                    >Keep Pack</button>
                    <button
                      onClick={() => handleCancelPack(packKey)}
                      disabled={cancellingPack}
                      style={{ padding: '10px 20px', borderRadius: 6, border: 'none', background: '#c62828', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}
                    >{cancellingPack ? 'Processing…' : inGrace ? 'Cancel Now — No Charge' : 'Confirm Cancellation'}</button>
                  </div>
                </>
              )
            })()}
          </div>
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
                    <strong style={{ color: '#dc2626', fontSize: 18 }}>{formatCurrency(cancelBilling.outstanding_amount, currency)}</strong>
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
  const [companyStartDates, setCompanyStartDates] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set())
  const [expandedYears, setExpandedYears] = useState<Set<number>>(new Set([new Date().getFullYear()]))
  const currency = 'GBP'

  const [mspBilling, setMspBilling] = useState<any[]>([])
  const [mspBillingLoading, setMspBillingLoading] = useState(false)
  const [recalculating, setRecalculating] = useState(false)
  const { showSuccess, showError } = useToast()

  useEffect(() => {
    setMspBillingLoading(true)
    supabase.rpc('get_msp_billing_summary' as any).then(({ data }: any) => {
      setMspBilling(data || [])
      setMspBillingLoading(false)
    })
  }, [])

  const handleRecalculateTiers = async () => {
    setRecalculating(true)
    const { data, error } = await supabase.rpc('recalculate_msp_tiers' as any) as any
    if (error) { showError('Failed to recalculate: ' + error.message) }
    else {
      const changes = data?.changes || []
      if (changes.length === 0) showSuccess('All MSP tiers are up to date')
      else showSuccess(`Updated ${changes.length} MSP tier(s)`)
      supabase.rpc('get_msp_billing_summary' as any).then(({ data: d }: any) => setMspBilling(d || []))
    }
    setRecalculating(false)
  }

  useEffect(() => { load() }, [companies])

  async function load() {
    if (companies.length === 0) return
    setLoading(true)
    const [pricingRes, featuresRes, companiesRes] = await Promise.all([
      supabase.from('subscription_pricing').select('*').eq('is_active', true),
      supabase.from('company_features').select('*'),
      supabase.from('companies').select('id, monthly_platform_fee, created_at'),
    ])
    setPricing((pricingRes.data as PricingRow[]) || [])
    setAllFeatures((featuresRes.data as CompanyFeature[]) || [])
    const fees: Record<string, number> = {}
    const starts: Record<string, string> = {}
    if (companiesRes.data) {
      for (const c of companiesRes.data as { id: string; monthly_platform_fee: number | null; created_at: string | null }[]) {
        fees[c.id] = c.monthly_platform_fee ?? 30
        if (c.created_at) starts[c.id] = c.created_at
      }
    }
    setPlatformFees(fees)
    setCompanyStartDates(starts)

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
        billingStartMonth: (() => {
          const ca = companyStartDates[c.id]
          if (!ca) return 1
          const d = new Date(ca)
          return d.getMonth() + 2 > 12 ? 1 : d.getMonth() + 2
        })(),
        billingStartYear: (() => {
          const ca = companyStartDates[c.id]
          if (!ca) return 2024
          const d = new Date(ca)
          return d.getMonth() + 2 > 12 ? d.getFullYear() + 1 : d.getFullYear()
        })(),
      }
    }).sort((a, b) => b.monthly - a.monthly)
  }, [companies, pricing, allFeatures, employeeCounts, platformFees, companyStartDates])

  const platformSubtotal = companyData.reduce((s, c) => s + c.subtotal, 0)
  const platformVat = companyData.reduce((s, c) => s + c.vat, 0)
  const platformTotal = companyData.reduce((s, c) => s + c.monthly, 0)
  const platformCore = companyData.reduce((s, c) => s + c.core, 0)
  const platformAddons = companyData.reduce((s, c) => s + c.addonsTotal, 0)
  const platformFeeTotal = companyData.reduce((s, c) => s + c.platformFee, 0)
  const totalEmployees = companyData.reduce((s, c) => s + c.employees, 0)

  function handleInvoice(c: typeof companyData[0], month?: string, year?: number) {
    const now = new Date()
    const m = month || MONTH_FULL[now.getMonth()]
    const y = year || now.getFullYear()
    const invoicePacks = c.addonDetails.map(d => {
      return { name: d.name, price: d.price }
    })
    generateInvoicePDF(
      c.name,
      m,
      y,
      c.baselineName,
      c.baselinePrice,
      invoicePacks,
      c.employees,
      c.id,
      [],
      c.platformFee,
      currency,
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
          <span className="billing-card-value">{formatCurrency(platformCore, currency)}</span>
          <span className="billing-card-sub">excl. VAT</span>
        </div>
        <div className="billing-card">
          <span className="billing-card-label">Pack Revenue</span>
          <span className="billing-card-value">{formatCurrency(platformAddons, currency)}</span>
          <span className="billing-card-sub">excl. VAT</span>
        </div>
        <div className="billing-card">
          <span className="billing-card-label">Platform Fees</span>
          <span className="billing-card-value">{formatCurrency(platformFeeTotal, currency)}</span>
          <span className="billing-card-sub">excl. VAT</span>
        </div>
        <div className="billing-card billing-card-highlight">
          <span className="billing-card-label">Platform Total (inc. VAT)</span>
          <span className="billing-card-value">{formatCurrency(platformTotal, currency)}</span>
          <span className="billing-card-sub">{formatCurrency(platformSubtotal, currency)} + {formatCurrency(platformVat, currency)} VAT</span>
        </div>
        <div className="billing-card">
          <span className="billing-card-label">Annual Estimate</span>
          <span className="billing-card-value">{formatCurrency(platformTotal * 12, currency)}</span>
          <span className="billing-card-sub">inc. VAT</span>
        </div>
      </div>

      {mspBilling.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>MSP Wholesale Billing</h3>
            <button
              onClick={handleRecalculateTiers}
              disabled={recalculating}
              style={{
                padding: '4px 12px', fontSize: 12, fontWeight: 600, borderRadius: 4,
                background: '#ede9fe', color: '#5b21b6', border: '1px solid #c4b5fd', cursor: 'pointer',
              }}
            >
              {recalculating ? 'Recalculating...' : 'Recalculate Tiers'}
            </button>
          </div>
          {mspBillingLoading ? (
            <p style={{ color: '#888' }}>Loading MSP billing...</p>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>MSP Partner</th>
                    <th>Tier</th>
                    <th>Discount</th>
                    <th>Managed Cos.</th>
                    <th>Total Employees</th>
                    <th>Monthly Wholesale</th>
                  </tr>
                </thead>
                <tbody>
                  {mspBilling.map((msp: any) => (
                    <tr key={msp.msp_company_id}>
                      <td><strong>{msp.msp_name}</strong></td>
                      <td>
                        <span style={{
                          fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 12, textTransform: 'capitalize',
                          background: msp.msp_tier === 'enterprise' ? '#ede9fe' : msp.msp_tier === 'growth' ? '#dcfce7' : '#f3f4f6',
                          color: msp.msp_tier === 'enterprise' ? '#5b21b6' : msp.msp_tier === 'growth' ? '#166534' : '#374151',
                        }}>
                          {msp.msp_tier || 'starter'}
                        </span>
                      </td>
                      <td>{msp.msp_wholesale_discount || 0}%</td>
                      <td>{msp.managed_count}</td>
                      <td>{msp.total_employees}</td>
                      <td><strong>{formatCurrency(msp.monthly_wholesale || 0, currency)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Company</th>
              <th>Users</th>
              <th>Core/User</th>
              <th>Core Total</th>
              <th>Packs</th>
              <th>Platform Fee</th>
              <th>VAT</th>
              <th>Monthly Total</th>
              <th>Active Packs</th>
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
                  {formatCurrency(c.corePerUser, currency)}
                  {(c.hasCustomCore || c.hasCustomAddons) && (
                    <span style={{ display: 'inline-block', marginLeft: 4, fontSize: 10, background: '#e3f2fd', color: '#1565c0', padding: '1px 5px', borderRadius: 3, fontWeight: 600, verticalAlign: 'middle' }}>Custom</span>
                  )}
                </td>
                <td>{formatCurrency(c.core, currency)}</td>
                <td>{formatCurrency(c.addonsTotal, currency)}</td>
                <td>{formatCurrency(c.platformFee, currency)}</td>
                <td>{formatCurrency(c.vat, currency)}</td>
                <td><strong>{formatCurrency(c.monthly, currency)}</strong></td>
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
              <td>{formatCurrency(platformCore, currency)}</td>
              <td>{formatCurrency(platformAddons, currency)}</td>
              <td>{formatCurrency(platformFeeTotal, currency)}</td>
              <td>{formatCurrency(platformVat, currency)}</td>
              <td>{formatCurrency(platformTotal, currency)}</td>
              <td></td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>

      {(() => {
        const now = new Date()
        const currentYear = now.getFullYear()
        const currentMonth = now.getMonth() + 1
        const earliestYear = Math.min(currentYear, ...companyData.map(c => c.billingStartYear))
        const years = Array.from({ length: currentYear - earliestYear + 1 }, (_, i) => currentYear - i)

        return (
          <div style={{ marginTop: 32 }}>
            <h3 style={{ margin: '0 0 16px' }}>Monthly Billing Records</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {years.map(year => {
                const isYearExpanded = expandedYears.has(year)
                const isCurrentYear = year === currentYear
                const yearTotal = companyData.reduce((s, c) => {
                  const monthsActive = MONTH_FULL.filter((_, idx) => {
                    const m = idx + 1
                    if (year === currentYear && m > currentMonth) return false
                    return year > c.billingStartYear || (year === c.billingStartYear && m >= c.billingStartMonth)
                  }).length
                  return s + c.monthly * monthsActive
                }, 0)

                return (
                  <div key={year} style={{ border: '1px solid #d0d0d0', borderRadius: 10, overflow: 'hidden', background: isCurrentYear ? '#fafbff' : '#fff' }}>
                    <button
                      onClick={() => setExpandedYears(prev => {
                        const next = new Set(prev)
                        if (next.has(year)) next.delete(year)
                        else next.add(year)
                        return next
                      })}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}
                    >
                      <span style={{ fontSize: 16, color: '#555', width: 20, textAlign: 'center' }}>{isYearExpanded ? '▼' : '▶'}</span>
                      <span style={{ fontWeight: 700, fontSize: 17, flex: 1 }}>
                        {year}
                        {isCurrentYear && <span style={{ marginLeft: 10, fontSize: 10, background: '#1565c0', color: '#fff', padding: '2px 10px', borderRadius: 10, fontWeight: 600, verticalAlign: 'middle' }}>Current Year</span>}
                      </span>
                      <span style={{ fontWeight: 700, fontSize: 15, color: '#1565c0' }}>{formatCurrency(yearTotal, currency)}</span>
                    </button>

                    {isYearExpanded && (
                      <div style={{ borderTop: '1px solid #e0e0e0', padding: '8px 12px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {MONTH_FULL.map((month, idx) => {
                          const monthNum = idx + 1
                          const monthKey = `${year}-${monthNum}`
                          const isExpanded = expandedMonths.has(monthKey)
                          const isFuture = year === currentYear && monthNum > currentMonth
                          const isCurrent = year === currentYear && monthNum === currentMonth
                          const billableCompanies = companyData.filter(c =>
                            c.employees > 0 &&
                            (year > c.billingStartYear || (year === c.billingStartYear && monthNum >= c.billingStartMonth))
                          )
                          const monthTotal = isFuture ? 0 : billableCompanies.reduce((s, c) => s + c.monthly, 0)
                          const monthCoreTot = billableCompanies.reduce((s, c) => s + c.core, 0)
                          const monthAddonTot = billableCompanies.reduce((s, c) => s + c.addonsTotal, 0)
                          const monthFeeTot = billableCompanies.reduce((s, c) => s + c.platformFee, 0)
                          const monthVatTot = billableCompanies.reduce((s, c) => s + c.vat, 0)
                          const monthEmpTot = billableCompanies.reduce((s, c) => s + c.employees, 0)

                          return (
                            <div key={month} style={{ border: '1px solid #e8e8e8', borderRadius: 8, overflow: 'hidden', background: isCurrent ? '#f0f4ff' : '#fff', opacity: isFuture ? 0.5 : 1 }}>
                              <button
                                onClick={() => {
                                  if (isFuture) return
                                  setExpandedMonths(prev => {
                                    const next = new Set(prev)
                                    if (next.has(monthKey)) next.delete(monthKey)
                                    else next.add(monthKey)
                                    return next
                                  })
                                }}
                                disabled={isFuture}
                                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', border: 'none', background: 'none', cursor: isFuture ? 'not-allowed' : 'pointer', textAlign: 'left', fontFamily: 'inherit' }}
                              >
                                <span style={{ fontSize: 13, color: '#666', width: 16, textAlign: 'center' }}>{isExpanded ? '▾' : '▸'}</span>
                                <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>
                                  {month}
                                  {isCurrent && <span style={{ marginLeft: 8, fontSize: 10, background: '#1565c0', color: '#fff', padding: '2px 8px', borderRadius: 10, fontWeight: 600, verticalAlign: 'middle' }}>Current</span>}
                                  {isFuture && <span style={{ marginLeft: 8, fontSize: 11, color: '#999' }}>Upcoming</span>}
                                </span>
                                {!isFuture && (
                                  <>
                                    <span style={{ fontSize: 12, color: '#888' }}>{billableCompanies.length} {billableCompanies.length === 1 ? 'company' : 'companies'}</span>
                                    <span style={{ fontWeight: 700, fontSize: 13, color: '#1565c0', minWidth: 80, textAlign: 'right' }}>{formatCurrency(monthTotal, currency)}</span>
                                  </>
                                )}
                              </button>

                              {isExpanded && !isFuture && (
                                <div style={{ borderTop: '1px solid #e8e8e8', padding: '0 8px 8px' }}>
                                  <div className="admin-table-wrap" style={{ marginTop: 0 }}>
                                    <table className="admin-table" style={{ fontSize: 13 }}>
                                      <thead>
                                        <tr>
                                          <th>Company</th>
                                          <th>Users</th>
                                          <th>Core</th>
                                          <th>Packs</th>
                                          <th>Platform Fee</th>
                                          <th>VAT</th>
                                          <th>Total</th>
                                          <th>Invoice</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {billableCompanies.map(c => (
                                          <tr key={c.id}>
                                            <td>
                                              <strong>{c.name}</strong>
                                              {c.isTrial && (
                                                <span style={{ marginLeft: 6, fontSize: 10, background: '#fff3e0', color: '#e65100', padding: '1px 6px', borderRadius: 3, fontWeight: 600 }}>Trial</span>
                                              )}
                                            </td>
                                            <td>{c.employees}</td>
                                            <td>{formatCurrency(c.core, currency)}</td>
                                            <td>{formatCurrency(c.addonsTotal, currency)}</td>
                                            <td>{formatCurrency(c.platformFee, currency)}</td>
                                            <td>{formatCurrency(c.vat, currency)}</td>
                                            <td><strong>{formatCurrency(c.monthly, currency)}</strong></td>
                                            <td>
                                              <button className="billing-invoice-btn-table" title={`Download invoice for ${month} ${year}`} onClick={() => handleInvoice(c, month, year)}>
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 18 15 15"/></svg>
                                              </button>
                                            </td>
                                          </tr>
                                        ))}
                                        <tr style={{ fontWeight: 700, background: '#f5f7fa' }}>
                                          <td>Month Total</td>
                                          <td>{monthEmpTot}</td>
                                          <td>{formatCurrency(monthCoreTot, currency)}</td>
                                          <td>{formatCurrency(monthAddonTot, currency)}</td>
                                          <td>{formatCurrency(monthFeeTot, currency)}</td>
                                          <td>{formatCurrency(monthVatTot, currency)}</td>
                                          <td>{formatCurrency(monthTotal, currency)}</td>
                                          <td></td>
                                        </tr>
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}
    </div>
  )
}
