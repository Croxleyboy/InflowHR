import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

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
  source: string | null
}

interface BenefitDeduction {
  title: string
  monthly_cost: number
}

export default function Payslips() {
  const navigate = useNavigate()
  const { t, lang } = useLanguage()
  const { employeeId: EMPLOYEE_ID, employeeName, avatarUrl, company, companyUser } = useAuth()
  const [monthPayslips, setMonthPayslips] = useState<PayslipData[]>([])
  const [selectedPayslipIdx, setSelectedPayslipIdx] = useState(0)
  const payslip = monthPayslips[selectedPayslipIdx] || null
  const [loading, setLoading] = useState(true)
  const [employeeRole, setEmployeeRole] = useState('')
  const [workerType, setWorkerType] = useState<'employed' | 'shift' | 'zero_hours'>('employed')
  const [benefitDeductions, setBenefitDeductions] = useState<BenefitDeduction[]>([])
  const [initialised, setInitialised] = useState(false)
  const monthNames = lang === 'de' ? MONTH_NAMES_DE : MONTH_NAMES_EN

  const fyMonths = getFYMonths()
  const [monthIdx, setMonthIdx] = useState(fyMonths.length - 1)

  const current = fyMonths[monthIdx]

  const loadPayslip = useCallback(async () => {
    if (!current || !EMPLOYEE_ID) return
    setLoading(true)
    const startOfMonth = `${current.year}-${String(current.month + 1).padStart(2, '0')}-01`
    const endOfMonth = new Date(current.year, current.month + 1, 0)
    const endStr = `${current.year}-${String(current.month + 1).padStart(2, '0')}-${String(endOfMonth.getDate()).padStart(2, '0')}`

    const { data } = await supabase.from('payslips')
      .select('*')
      .eq('employee_id', EMPLOYEE_ID)
      .eq('company_id', companyUser?.company_id)
      .gte('pay_period_start', startOfMonth)
      .lte('pay_period_start', endStr)
      .in('status', ['processed', 'paid'])
      .eq('released', true)
      .order('pay_period_start', { ascending: true })
      .limit(10)
    const results = (data as PayslipData[] | null) || []
    setMonthPayslips(results)
    setSelectedPayslipIdx(0)

    if (results.length === 0 && !initialised && monthIdx > 0) {
      setInitialised(true)
      setMonthIdx(i => i - 1)
      return
    }
    setInitialised(true)
    setLoading(false)
  }, [EMPLOYEE_ID, current?.year, current?.month, companyUser?.company_id, initialised, monthIdx])

  useEffect(() => { loadPayslip() }, [loadPayslip])

  useEffect(() => {
    if (!EMPLOYEE_ID || !companyUser?.company_id) return
    supabase.from('employees')
      .select('job_title, department, employment_category, contract_type')
      .eq('id', EMPLOYEE_ID)
      .eq('company_id', companyUser.company_id)
      .single()
      .then(({ data }) => {
        if (data) {
          const parts = [data.job_title, data.department].filter(Boolean)
          setEmployeeRole(parts.join(' — '))
          if (data.employment_category === 'shift_worker') {
            setWorkerType(data.contract_type === 'Zero hours shift worker' ? 'zero_hours' : 'shift')
          } else {
            setWorkerType('employed')
          }
        }
      })
  }, [EMPLOYEE_ID, companyUser?.company_id])

  useEffect(() => {
    if (!EMPLOYEE_ID || !companyUser?.company_id || !current) return
    const monthEnd = new Date(current.year, current.month + 1, 0)

    supabase.from('benefit_enrollments')
      .select('benefit_type_id, enrolled_at, benefit_type:benefit_types(title, monthly_cost, lock_period, is_enabled)')
      .eq('company_id', companyUser.company_id)
      .eq('employee_id', EMPLOYEE_ID)
      .is('option_id', null)
      .then(({ data }) => {
        if (!data) { setBenefitDeductions([]); return }
        const active: BenefitDeduction[] = []
        for (const row of data as any[]) {
          const bt = row.benefit_type
          if (!bt || !bt.is_enabled) continue
          const enrolledAt = new Date(row.enrolled_at)
          if (bt.lock_period === 'month') {
            const effectiveStart = new Date(enrolledAt.getFullYear(), enrolledAt.getMonth() + 1, 1)
            if (effectiveStart > monthEnd) continue
          } else {
            if (enrolledAt > monthEnd) continue
          }
          active.push({ title: bt.title, monthly_cost: bt.monthly_cost || 0 })
        }
        setBenefitDeductions(active)
      })
  }, [EMPLOYEE_ID, companyUser?.company_id, current?.year, current?.month])

  const canPrev = monthIdx > 0
  const canNext = monthIdx < fyMonths.length - 1

  const fmt = (n: number) => n?.toFixed(2) ?? '0.00'

  const benefitTotal = benefitDeductions.reduce((s, b) => s + b.monthly_cost, 0)

  const totalDeductions = payslip
    ? payslip.tax + payslip.national_insurance + payslip.pension + payslip.other_deductions + (payslip.monthly_deductions || 0) + benefitTotal
    : 0

  const adjustedNetPay = payslip
    ? payslip.gross_pay + (payslip.overtime || 0) + (payslip.adjustments || 0) - totalDeductions
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
        <button className="feature-refresh" onClick={loadPayslip}>
          <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="14" stroke="#fff" strokeWidth="2" />
            <path d="M22 14a6.5 6.5 0 0 0-11.3-1.5M10 18a6.5 6.5 0 0 0 11.3 1.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
            <path d="M22 10v4h-4M10 22v-4h4" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <div className="payslips-month-nav">
        <button className="payslips-nav-btn" disabled={!canPrev} onClick={() => setMonthIdx(i => i - 1)}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <span className="payslips-month-label">
          {current ? `${monthNames[current.month]} ${current.year}` : ''}
          {payslip?.source && (
            <span style={{
              marginLeft: 8, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
              background: payslip.source === 'sage' ? '#e0f2e9' : payslip.source === 'xero' ? '#dbeafe' : '#f3f0ff',
              color: payslip.source === 'sage' ? '#166534' : payslip.source === 'xero' ? '#1e40af' : '#5b21b6',
              verticalAlign: 'middle',
            }}>
              {payslip.source === 'sage' ? 'Sage' : payslip.source === 'xero' ? 'Xero' : 'InflowHR'}
            </span>
          )}
        </span>
        <button className="payslips-nav-btn" disabled={!canNext} onClick={() => setMonthIdx(i => i + 1)}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6"/></svg>
        </button>
      </div>

      {monthPayslips.length > 1 && (
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap', padding: '0 16px 8px' }}>
          {monthPayslips.map((p, i) => {
            const start = new Date(p.pay_period_start + 'T00:00:00')
            const end = new Date(p.pay_period_end + 'T00:00:00')
            const label = `${start.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} – ${end.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}`
            return (
              <button key={p.id} onClick={() => setSelectedPayslipIdx(i)}
                style={{
                  padding: '4px 10px', borderRadius: 16, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  border: i === selectedPayslipIdx ? '2px solid #5c6bc0' : '1px solid rgba(255,255,255,0.3)',
                  background: i === selectedPayslipIdx ? 'rgba(92,107,192,0.2)' : 'rgba(255,255,255,0.1)',
                  color: '#fff',
                }}>
                {label}
              </button>
            )
          })}
        </div>
      )}

      {loading ? (
        <div className="payslips-loading">{t('common.loading')}</div>
      ) : !payslip ? (
        <div className="payslips-loading">{t('payslips.no_data')}</div>
      ) : (
        <div className="payslips-content">
          <div className="payslips-company-banner">
            <div className="payslips-company-top">
              <span className="payslips-company-name">{company?.name || ''}</span>
              <span className="payslips-company-addr">{payslip.payroll_office || ''}</span>
            </div>
          </div>

          <div className="payslips-employee-row">
            <div className="payslips-employee-avatar">
              {avatarUrl ? (
                <img src={avatarUrl} alt={employeeName} className="payslips-employee-img" />
              ) : (
                <span>{employeeName.split(' ').map(n => n[0]).join('').toUpperCase()}</span>
              )}
            </div>
            <div className="payslips-employee-info">
              <span className="payslips-employee-name">{employeeName}</span>
              {employeeRole && <span className="payslips-employee-role">{employeeRole}</span>}
              <span style={{
                display: 'inline-block', marginTop: 4, fontSize: 11, fontWeight: 600,
                padding: '2px 10px', borderRadius: 10,
                background: workerType === 'employed' ? 'rgba(92,107,192,0.2)' : workerType === 'shift' ? 'rgba(126,87,194,0.2)' : 'rgba(38,166,154,0.2)',
                color: workerType === 'employed' ? '#5c6bc0' : workerType === 'shift' ? '#7e57c2' : '#26a69a',
              }}>
                {workerType === 'employed' ? 'Salaried Staff' : workerType === 'shift' ? 'Shift Worker' : 'Zero Hours'}
              </span>
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
              <span className="payslips-info-label">{t('payslips.pay_period')}</span>
              <span className="payslips-info-value">{new Date(payslip.pay_period_start).toLocaleDateString('en-GB')} — {new Date(payslip.pay_period_end).toLocaleDateString('en-GB')}</span>
            </div>
            <div className="payslips-info-item">
              <span className="payslips-info-label">{t('payslips.payment_date')}</span>
              <span className="payslips-info-value">{new Date(payslip.payment_date).toLocaleDateString('en-GB')}</span>
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
            {benefitDeductions.map((bd, i) => (
              <div key={i} className="payslips-row payslips-row-benefit">
                <span>{bd.title}</span>
                <span>&pound;{fmt(bd.monthly_cost)}</span>
              </div>
            ))}
            <div className="payslips-row payslips-row-total">
              <span>{t('payslips.total_deductions')}</span>
              <span>&pound;{fmt(totalDeductions)}</span>
            </div>
          </div>

          <div className="payslips-net-pay">
            <span>{t('payslips.net_pay')}</span>
            <span>&pound;{fmt(adjustedNetPay)}</span>
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
