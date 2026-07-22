import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
const BENEFITS_KEY = 'inflowhr-benefits'
const ADMIN_BENEFITS_KEY = 'inflowhr-admin-benefits'

interface BenefitDeduction {
  name: string
  amount: number
}

function getBenefitDeductions(): BenefitDeduction[] {
  try {
    const enrollRaw = localStorage.getItem(BENEFITS_KEY)
    const adminRaw = localStorage.getItem(ADMIN_BENEFITS_KEY)
    if (!enrollRaw || !adminRaw) return []
    const enrollments = JSON.parse(enrollRaw)
    const adminBenefits = JSON.parse(adminRaw)
    const deductions: BenefitDeduction[] = []
    const keyToId: Record<string, string> = { health_insurance: 'health', car_insurance: 'car', cycle_scheme: 'cycle' }
    for (const [key, id] of Object.entries(keyToId)) {
      if (!enrollments[key]) continue
      const b = adminBenefits.find((x: any) => x.id === id)
      if (b && (b.monthlyCost ?? 0) > 0) {
        deductions.push({ name: b.title || id, amount: b.monthlyCost })
      }
    }
    return deductions
  } catch { return [] }
}

const MONTH_NAMES_EN = ['January','February','March','April','May','June','July','August','September','October','November','December']
const MONTH_NAMES_DE = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']

function getFYMonths(): { year: number; month: number }[] {
  const now = new Date()
  const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  const months: { year: number; month: number }[] = []
  for (let m = 3; m <= now.getMonth() + (now.getFullYear() > fyStartYear ? 12 : 0); m++) {
    const actualMonth = m % 12
    const actualYear = fyStartYear + Math.floor(m / 12)
    if (actualYear > now.getFullYear() || (actualYear === now.getFullYear() && actualMonth > now.getMonth())) break
    months.push({ year: actualYear, month: actualMonth })
  }
  return months
}

interface PayslipData {
  id: number
  reference_number: string
  pay_period_start: string
  pay_period_end: string
  gross_pay: number
  tax: number
  national_insurance: number
  pension: number
  other_deductions: number
  net_pay: number
  payment_date: string
  status: string
  overtime: number
  adjustments: number
  monthly_deductions: number
  tax_code: string
  annual_salary: number
  payroll_id: string
  bank_account: string
  payroll_office: string
}

export default function Payslips() {
  const navigate = useNavigate()
  const { t, lang } = useLanguage()
  const { employeeId: EMPLOYEE_ID, employeeName } = useAuth()
  const [payslip, setPayslip] = useState<PayslipData | null>(null)
  const [loading, setLoading] = useState(true)
  const [benefitDeductions] = useState<BenefitDeduction[]>(getBenefitDeductions)
  const totalBenefitDeductions = benefitDeductions.reduce((s, d) => s + d.amount, 0)
  const monthNames = lang === 'de' ? MONTH_NAMES_DE : MONTH_NAMES_EN

  const fyMonths = getFYMonths()
  const [monthIdx, setMonthIdx] = useState(fyMonths.length - 1)

  const current = fyMonths[monthIdx]

  useEffect(() => {
    if (!current) return
    setLoading(true)
    const startOfMonth = `${current.year}-${String(current.month + 1).padStart(2, '0')}-01`
    const endOfMonth = new Date(current.year, current.month + 1, 0)
    const endStr = `${current.year}-${String(current.month + 1).padStart(2, '0')}-${String(endOfMonth.getDate()).padStart(2, '0')}`

    supabase.from('payslips')
      .select('*')
      .eq('employee_id', EMPLOYEE_ID)
      .gte('pay_period_start', startOfMonth)
      .lte('pay_period_start', endStr)
      .limit(1)
      .single()
      .then(({ data }) => {
        setPayslip(data as PayslipData | null)
        setLoading(false)
      })
  }, [monthIdx, current?.year, current?.month])

  const canPrev = monthIdx > 0
  const canNext = monthIdx < fyMonths.length - 1

  const fmt = (n: number) => n?.toFixed(2) ?? '0.00'

  const totalDeductions = payslip
    ? payslip.tax + payslip.national_insurance + payslip.pension + payslip.other_deductions + (payslip.monthly_deductions || 0) + totalBenefitDeductions
    : 0

  return (
    <div className="payslips-page">
      <div className="payslips-header">
        <button className="payslips-back" onClick={() => navigate(-1)}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <div className="payslips-header-center">
          <h1 className="payslips-title">{t('payslips.title')} <span className="payslips-title-accent">{t('payslips.title_accent')}</span></h1>
          <p className="payslips-header-sub">{t('payslips.subtitle')}</p>
        </div>
        <div style={{ width: 28 }} />
      </div>

      <div className="payslips-month-nav">
        <button className="payslips-nav-btn" disabled={!canPrev} onClick={() => setMonthIdx(i => i - 1)}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <span className="payslips-month-label">
          {current ? `${monthNames[current.month]} ${current.year}` : ''}
        </span>
        <button className="payslips-nav-btn" disabled={!canNext} onClick={() => setMonthIdx(i => i + 1)}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6"/></svg>
        </button>
      </div>

      {loading ? (
        <div className="payslips-loading">{t('common.loading')}</div>
      ) : !payslip ? (
        <div className="payslips-loading">{t('payslips.no_data')}</div>
      ) : (
        <div className="payslips-content">
          <div className="payslips-company-banner">
            <div className="payslips-company-top">
              <span className="payslips-company-name">Kumonix Ltd</span>
              <span className="payslips-company-addr">{payslip.payroll_office || ''}</span>
            </div>
          </div>

          <div className="payslips-employee-row">
            <div className="payslips-employee-avatar">
              <img src="https://lh3.googleusercontent.com/a/default-user" alt="" className="payslips-employee-img" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).parentElement!.textContent = 'AJ' }} />
            </div>
            <div className="payslips-employee-info">
              <span className="payslips-employee-name">{employeeName}</span>
              <span className="payslips-employee-role">CEO — Leadership</span>
            </div>
          </div>

          <div className="payslips-info-grid">
            <div className="payslips-info-item">
              <span className="payslips-info-label">{t('payslips.payroll_id')}</span>
              <span className="payslips-info-value">{payslip.payroll_id || '-'}</span>
            </div>
            <div className="payslips-info-item">
              <span className="payslips-info-label">{t('payslips.tax_code')}</span>
              <span className="payslips-info-value">{payslip.tax_code || '-'}</span>
            </div>
            <div className="payslips-info-item">
              <span className="payslips-info-label">{t('payslips.ni_number')}</span>
              <span className="payslips-info-value">AB 12 34 56 C</span>
            </div>
            <div className="payslips-info-item">
              <span className="payslips-info-label">{t('payslips.pay_period')}</span>
              <span className="payslips-info-value">{payslip.pay_period_start} — {payslip.pay_period_end}</span>
            </div>
            <div className="payslips-info-item">
              <span className="payslips-info-label">{t('payslips.payment_date')}</span>
              <span className="payslips-info-value">{payslip.payment_date}</span>
            </div>
          </div>

          <div className="payslips-section">
            <div className="payslips-section-header payslips-section-earnings">{t('payslips.earnings')}</div>
            <div className="payslips-row">
              <span>{t('payslips.basic_salary')}</span>
              <span>&pound;{fmt(payslip.gross_pay)}</span>
            </div>
            <div className="payslips-row">
              <span>{t('payslips.overtime')}</span>
              <span>&pound;{fmt(payslip.overtime || 0)}</span>
            </div>
            <div className="payslips-row">
              <span>{t('payslips.adjustments')}</span>
              <span>&pound;{fmt(payslip.adjustments || 0)}</span>
            </div>
            <div className="payslips-row payslips-row-total">
              <span>{t('payslips.total_earnings')}</span>
              <span>&pound;{fmt(payslip.gross_pay + (payslip.overtime || 0) + (payslip.adjustments || 0))}</span>
            </div>
          </div>

          <div className="payslips-section">
            <div className="payslips-section-header payslips-section-deductions">{t('payslips.deductions')}</div>
            <div className="payslips-row">
              <span>{t('payslips.income_tax')}</span>
              <span>&pound;{fmt(payslip.tax)}</span>
            </div>
            <div className="payslips-row">
              <span>{t('payslips.national_insurance')}</span>
              <span>&pound;{fmt(payslip.national_insurance)}</span>
            </div>
            <div className="payslips-row">
              <span>{t('payslips.pension')}</span>
              <span>&pound;{fmt(payslip.pension)}</span>
            </div>
            {(payslip.other_deductions || 0) > 0 && (
              <div className="payslips-row">
                <span>{t('payslips.other_deductions')}</span>
                <span>&pound;{fmt(payslip.other_deductions)}</span>
              </div>
            )}
            {benefitDeductions.map(d => (
              <div key={d.name} className="payslips-row payslips-row-benefit">
                <span>{t('payslips.benefit_deduction')}: {d.name}</span>
                <span>&pound;{fmt(d.amount)}</span>
              </div>
            ))}
            <div className="payslips-row payslips-row-total">
              <span>{t('payslips.total_deductions')}</span>
              <span>&pound;{fmt(totalDeductions)}</span>
            </div>
          </div>

          <div className="payslips-net-pay">
            <span>{t('payslips.net_pay')}</span>
            <span>&pound;{fmt(payslip.net_pay - totalBenefitDeductions)}</span>
          </div>

          <div className="payslips-footer-info">
            <div className="payslips-info-item">
              <span className="payslips-info-label">{t('payslips.annual_salary')}</span>
              <span className="payslips-info-value">&pound;{fmt(payslip.annual_salary || 0)}</span>
            </div>
            <div className="payslips-info-item">
              <span className="payslips-info-label">{t('payslips.bank_account')}</span>
              <span className="payslips-info-value">{payslip.bank_account || '-'}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
