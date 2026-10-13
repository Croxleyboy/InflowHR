import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLanguage } from '../context/LanguageContext'
import { useFeatures } from '../context/FeatureContext'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { supabase } from '../lib/supabase'
import { seedBenefitDefaults } from '../lib/benefitDefaults'
import { currencySymbol } from '../lib/formatters'

interface BenefitOption {
  id: number
  option_key: string
  icon: string
  title: string
  description: string
  is_enabled: boolean
}

interface BenefitType {
  id: number
  benefit_key: string
  title: string
  description: string
  icon: string
  color: string
  intro: string
  eligibility: string
  cost_description: string
  monthly_cost: number
  lock_period: 'none' | 'month' | 'year'
  is_enabled: boolean
  options: BenefitOption[]
}

interface BenefitDoc {
  id: number
  benefit_type_id: number
  file_name: string
  file_url: string
}

interface Enrollment {
  id: number
  benefit_type_id: number
  option_id: number | null
  enrolled_at: string
}

const CARD_SVG_ICONS: Record<string, React.ReactNode> = {
  vacation: <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>,
  health: <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>,
  car: <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="15" height="13" rx="2"/><path d="M16 8h4l3 5v5h-3"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>,
  cycle: <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><path d="M15 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" fill="#fff"/><path d="M12 17.5V14l-3-3 4-3 2 3h3"/></svg>,
}

function getFYStartMonth(): number {
  return 3
}

function isEnrollmentActive(enrolledAt: string, lockPeriod: string): boolean {
  if (lockPeriod === 'month') {
    const enrolled = new Date(enrolledAt)
    const effectiveStart = new Date(enrolled.getFullYear(), enrolled.getMonth() + 1, 1)
    return new Date() >= effectiveStart
  }
  return true
}

function isLocked(benefit: BenefitType, enrolledAt: string | null): { locked: boolean; until: string } {
  if (!enrolledAt || !benefit.lock_period || benefit.lock_period === 'none' || benefit.monthly_cost === 0) return { locked: false, until: '' }
  const now = new Date()
  if (benefit.lock_period === 'month') {
    const enrolled = new Date(enrolledAt)
    const lockEnd = new Date(enrolled.getFullYear(), enrolled.getMonth() + 2, 0)
    if (now < lockEnd) {
      return { locked: true, until: `${lockEnd.getDate()}/${lockEnd.getMonth() + 1}/${lockEnd.getFullYear()}` }
    }
  }
  if (benefit.lock_period === 'year') {
    const fyStart = getFYStartMonth()
    const fyEndYear = now.getMonth() >= fyStart ? now.getFullYear() + 1 : now.getFullYear()
    const fyEnd = new Date(fyEndYear, fyStart, 0)
    if (now < fyEnd) {
      return { locked: true, until: `${fyEnd.getDate()}/${fyEnd.getMonth() + 1}/${fyEnd.getFullYear()}` }
    }
  }
  return { locked: false, until: '' }
}

function getLockUntilDate(lockPeriod: string): string {
  const now = new Date()
  if (lockPeriod === 'month') {
    const d = new Date(now.getFullYear(), now.getMonth() + 2, 0)
    return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`
  }
  if (lockPeriod === 'year') {
    const fyStart = getFYStartMonth()
    const fyEndYear = now.getMonth() >= fyStart ? now.getFullYear() + 1 : now.getFullYear()
    const fyEnd = new Date(fyEndYear, fyStart, 0)
    return `${fyEnd.getDate()}/${fyEnd.getMonth() + 1}/${fyEnd.getFullYear()}`
  }
  return ''
}

function canSubscribeToYearlyBenefit(): boolean {
  const now = new Date()
  const fyStart = getFYStartMonth()
  const fyStartYear = now.getMonth() >= fyStart ? now.getFullYear() + 1 : now.getFullYear()
  const windowOpen = new Date(fyStartYear, fyStart - 1, 1)
  const windowClose = new Date(fyStartYear, fyStart, 0)
  return now >= windowOpen && now <= windowClose
}

export default function Benefits() {
  const navigate = useNavigate()
  const { t } = useLanguage()
  const { features } = useFeatures()
  const { employeeId, companyUser, company } = useAuth()
  const currency = company?.currency || 'GBP'
  const { showError } = useToast()
  const companyId = companyUser?.company_id
  const payrollEnabled = features.payslips

  const [benefitTypes, setBenefitTypes] = useState<BenefitType[]>([])
  const [enrollments, setEnrollments] = useState<Enrollment[]>([])
  const [loading, setLoading] = useState(true)
  const [openModal, setOpenModal] = useState<string | null>(null)
  const [confirmEnroll, setConfirmEnroll] = useState<{ benefitType: BenefitType; title: string; cost: number; until: string } | null>(null)
  const [docs, setDocs] = useState<BenefitDoc[]>([])

  const loadData = useCallback(async () => {
    if (!companyId || !employeeId) return
    setLoading(true)

    let typesRes = await supabase.from('benefit_types').select('*').eq('company_id', companyId).eq('is_enabled', true).order('sort_order')

    if (!typesRes.data || typesRes.data.length === 0) {
      await seedBenefitDefaults(companyId)
      typesRes = await supabase.from('benefit_types').select('*').eq('company_id', companyId).eq('is_enabled', true).order('sort_order')
    }

    const enrollRes = await supabase.from('benefit_enrollments').select('*').eq('company_id', companyId).eq('employee_id', employeeId)

    const types = (typesRes.data || []) as BenefitType[]
    const typeIds = types.map(t => t.id)

    if (typeIds.length > 0) {
      const [optsRes, docsRes] = await Promise.all([
        supabase.from('benefit_options').select('*').eq('company_id', companyId).in('benefit_type_id', typeIds).eq('is_enabled', true).order('sort_order'),
        supabase.from('benefit_documents').select('*').eq('company_id', companyId).in('benefit_type_id', typeIds),
      ])

      const optMap = new Map<number, BenefitOption[]>()
      for (const o of (optsRes.data || [])) {
        const list = optMap.get(o.benefit_type_id) || []
        list.push(o as BenefitOption)
        optMap.set(o.benefit_type_id, list)
      }
      for (const t of types) {
        t.options = optMap.get(t.id) || []
      }
      setDocs((docsRes.data || []) as BenefitDoc[])
    } else {
      for (const t of types) t.options = []
      setDocs([])
    }

    setBenefitTypes(types)
    setEnrollments((enrollRes.data || []) as Enrollment[])
    setLoading(false)
  }, [companyId, employeeId])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    function onFocus() { loadData() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [loadData])

  function isEnrolledInType(typeId: number): boolean {
    return enrollments.some(e => e.benefit_type_id === typeId && e.option_id === null)
  }

  function isEnrolledInOption(optionId: number): boolean {
    return enrollments.some(e => e.option_id === optionId)
  }

  function getEnrollDate(typeId: number): string | null {
    const e = enrollments.find(x => x.benefit_type_id === typeId && x.option_id === null)
    return e ? e.enrolled_at : null
  }

  function isActiveEnrollment(typeId: number): boolean {
    const e = enrollments.find(x => x.benefit_type_id === typeId && x.option_id === null)
    if (!e) return false
    const bt = benefitTypes.find(b => b.id === typeId)
    if (!bt) return false
    return isEnrollmentActive(e.enrolled_at, bt.lock_period)
  }

  async function toggleVacOption(optionId: number) {
    if (!companyId || !employeeId) return
    const vacType = benefitTypes.find(b => b.benefit_key === 'vacation')
    if (!vacType) return

    if (isEnrolledInOption(optionId)) {
      const { error } = await supabase.from('benefit_enrollments').delete()
        .eq('company_id', companyId).eq('employee_id', employeeId).eq('option_id', optionId)
      if (error) { showError('Failed to update benefit: ' + error.message); return }
      setEnrollments(prev => prev.filter(e => e.option_id !== optionId))
    } else {
      const { data, error } = await supabase.from('benefit_enrollments').insert({
        company_id: companyId, employee_id: employeeId,
        benefit_type_id: vacType.id, option_id: optionId,
      }).select('*').single()
      if (error) { showError('Failed to update benefit: ' + error.message); return }
      if (data) setEnrollments(prev => [...prev, data as Enrollment])
    }
  }

  async function toggleBenefitEnrollment(bt: BenefitType) {
    if (!companyId || !employeeId) return
    const enrolled = isEnrolledInType(bt.id)
    const lock = isLocked(bt, getEnrollDate(bt.id))
    if (lock.locked && enrolled) return

    if (!enrolled && bt.lock_period === 'year' && !canSubscribeToYearlyBenefit()) {
      const fyStart = getFYStartMonth()
      const fyStartYear = new Date().getMonth() >= fyStart ? new Date().getFullYear() + 1 : new Date().getFullYear()
      const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December']
      showError(`This benefit can only be subscribed to during ${monthNames[fyStart - 1]} ${fyStart === 0 ? fyStartYear - 1 : fyStartYear}, one month before the financial year starts.`)
      return
    }

    if (!enrolled && bt.monthly_cost > 0 && bt.lock_period !== 'none') {
      setConfirmEnroll({ benefitType: bt, title: bt.title, cost: bt.monthly_cost, until: getLockUntilDate(bt.lock_period) })
      return
    }

    await doEnroll(bt)
  }

  async function doEnroll(bt: BenefitType) {
    if (!companyId || !employeeId) return
    const enrolled = isEnrolledInType(bt.id)

    if (enrolled) {
      const { error } = await supabase.from('benefit_enrollments').delete()
        .eq('company_id', companyId).eq('employee_id', employeeId)
        .eq('benefit_type_id', bt.id).is('option_id', null)
      if (error) { showError('Failed to update enrolment: ' + error.message); return }
      setEnrollments(prev => prev.filter(e => !(e.benefit_type_id === bt.id && e.option_id === null)))
    } else {
      const { data, error } = await supabase.from('benefit_enrollments').insert({
        company_id: companyId, employee_id: employeeId,
        benefit_type_id: bt.id, option_id: null,
      }).select('*').single()
      if (error) { showError('Failed to update enrolment: ' + error.message); return }
      if (data) setEnrollments(prev => [...prev, data as Enrollment])
    }
  }

  if (loading) return <div className="benefits-page"><p style={{ textAlign: 'center', padding: 40 }}>{t('common.loading')}</p></div>

  function renderCard(bt: BenefitType) {
    const svgIcon = CARD_SVG_ICONS[bt.benefit_key]
    const isVacation = bt.benefit_key === 'vacation'
    const enrolled = isVacation ? bt.options.some(o => isEnrolledInOption(o.id)) : isEnrolledInType(bt.id)
    const active = !isVacation && enrolled && isActiveEnrollment(bt.id)
    const pending = !isVacation && enrolled && !active

    return (
      <button key={bt.id} className="benefits-card" onClick={() => setOpenModal(bt.benefit_key)}>
        <div className="benefits-card-icon" style={{ background: bt.color }}>
          {svgIcon || <span style={{ fontSize: 28 }}>{bt.icon}</span>}
        </div>
        <div className="benefits-card-text">
          <span className="benefits-card-title">{bt.title}</span>
          <span className="benefits-card-desc">{bt.description}</span>
        </div>
        {active && <span className="benefits-enrolled-badge">{t('benefits.enrolled')}</span>}
        {pending && <span className="benefits-enrolled-badge" style={{ background: '#ff9800' }}>{t('benefits.pending_start')}</span>}
        {isVacation && enrolled && <span className="benefits-enrolled-badge">{t('benefits.enrolled')}</span>}
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="benefits-card-arrow"><path d="M9 6l6 6-6 6"/></svg>
      </button>
    )
  }

  function renderVacationModal(bt: BenefitType) {
    const typeDocs = docs.filter(d => d.benefit_type_id === bt.id)
    return (
      <div className="benefits-modal-overlay" onClick={() => setOpenModal(null)}>
        <div className="benefits-modal" onClick={e => e.stopPropagation()}>
          <div className="benefits-modal-header" style={{ background: bt.color }}>
            <h2>{bt.title}</h2>
            <button className="benefits-modal-close" onClick={() => setOpenModal(null)}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <p className="benefits-modal-intro">{bt.intro}</p>
          <p className="benefits-modal-eligibility">{bt.eligibility}</p>
          <div className="benefits-modal-options">
            {bt.options.map(opt => {
              const checked = isEnrolledInOption(opt.id)
              return (
                <button key={opt.id} className={`benefits-option-row ${checked ? 'benefits-option-active' : ''}`} onClick={() => toggleVacOption(opt.id)}>
                  <span className="benefits-option-icon">{opt.icon}</span>
                  <div className="benefits-option-text">
                    <span className="benefits-option-title">{opt.title}</span>
                    <span className="benefits-option-desc">{opt.description}</span>
                  </div>
                  <div className={`benefits-checkbox ${checked ? 'benefits-checkbox-on' : ''}`}>
                    {checked && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                  </div>
                </button>
              )
            })}
          </div>
          {typeDocs.length > 0 && (
            <div className="benefits-docs-section">
              <h4>{t('benefits.documents')}</h4>
              {typeDocs.map(d => (
                <a key={d.id} href={d.file_url} target="_blank" rel="noopener noreferrer" className="benefits-doc-link">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  {d.file_name}
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  function renderDetailModal(bt: BenefitType) {
    const enrolled = isEnrolledInType(bt.id)
    const lock = isLocked(bt, getEnrollDate(bt.id))
    const yearlyBlocked = !enrolled && bt.lock_period === 'year' && !canSubscribeToYearlyBenefit()
    const typeDocs = docs.filter(d => d.benefit_type_id === bt.id)

    return (
      <div className="benefits-modal-overlay" onClick={() => setOpenModal(null)}>
        <div className="benefits-modal" onClick={e => e.stopPropagation()}>
          <div className="benefits-modal-header" style={{ background: bt.color }}>
            <h2>{bt.title}</h2>
            <button className="benefits-modal-close" onClick={() => setOpenModal(null)}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div className="benefits-modal-body">
            <p className="benefits-modal-intro">{bt.intro}</p>
            <div className="benefits-modal-details">
              {bt.options.map(opt => (
                <div key={opt.id} className="benefits-detail-row">
                  <span className="benefits-detail-icon">{opt.icon}</span>
                  <span>{opt.title}</span>
                </div>
              ))}
            </div>
            <p className="benefits-modal-eligibility">{bt.eligibility}</p>
            {payrollEnabled && bt.cost_description && <p className="benefits-modal-cost">{bt.cost_description}</p>}
            {bt.lock_period === 'month' && !enrolled && (
              <p className="benefits-lock-notice">{t('benefits.monthly_note')}</p>
            )}
            {yearlyBlocked && (
              <p className="benefits-lock-notice">{t('benefits.yearly_window_closed')}</p>
            )}
            <button
              className={`benefits-signup-btn ${enrolled ? 'benefits-signup-active' : ''} ${(lock.locked && enrolled) || yearlyBlocked ? 'benefits-signup-locked' : ''}`}
              onClick={() => toggleBenefitEnrollment(bt)}
              disabled={(lock.locked && enrolled) || yearlyBlocked}
            >
              <div className={`benefits-checkbox ${enrolled ? 'benefits-checkbox-on' : ''}`}>
                {enrolled && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
              </div>
              <span>{lock.locked && enrolled ? t('benefits.locked') : enrolled ? t('benefits.enrolled_label') : yearlyBlocked ? t('benefits.unavailable') : t('benefits.sign_up')}</span>
            </button>
            {lock.locked && enrolled && <p className="benefits-lock-notice">{t('benefits.locked_until')} {lock.until}</p>}
            {typeDocs.length > 0 && (
              <div className="benefits-docs-section">
                <h4>{t('benefits.documents')}</h4>
                {typeDocs.map(d => (
                  <a key={d.id} href={d.file_url} target="_blank" rel="noopener noreferrer" className="benefits-doc-link">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    {d.file_name}
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="benefits-page">
      <div className="benefits-header">
        <button className="benefits-back" onClick={() => navigate(-1)}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <div className="benefits-header-center">
          <h1 className="benefits-title">{t('benefits.title')} <span className="benefits-title-accent">{t('benefits.title_accent')}</span></h1>
        </div>
        <button className="feature-refresh" onClick={loadData}>
          <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="14" stroke="#fff" strokeWidth="2" />
            <path d="M22 14a6.5 6.5 0 0 0-11.3-1.5M10 18a6.5 6.5 0 0 0 11.3 1.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
            <path d="M22 10v4h-4M10 22v-4h4" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <div className="benefits-list">
        {benefitTypes.map(bt => renderCard(bt))}
      </div>

      <div className="benefits-footer-text">
        <p>{t('benefits.footer_text')}</p>
      </div>

      {benefitTypes.map(bt => {
        if (openModal !== bt.benefit_key) return null
        if (bt.benefit_key === 'vacation') return <div key={bt.id}>{renderVacationModal(bt)}</div>
        return <div key={bt.id}>{renderDetailModal(bt)}</div>
      })}

      {confirmEnroll && (
        <div className="benefits-modal-overlay" onClick={() => setConfirmEnroll(null)}>
          <div className="benefits-confirm-modal" onClick={e => e.stopPropagation()}>
            <div className="benefits-confirm-icon">&#9888;&#65039;</div>
            <h3>{t('benefits.confirm_title')}</h3>
            <p className="benefits-confirm-text">
              {t('benefits.confirm_text_1')} <strong>{confirmEnroll.title}</strong> {t('benefits.confirm_text_2')} <strong>{currencySymbol(currency)}{confirmEnroll.cost.toFixed(2)}/{t('benefits.confirm_per_month')}</strong>.
            </p>
            <p className="benefits-confirm-lock">
              {t('benefits.confirm_lock')} <strong>{confirmEnroll.until}</strong>.
            </p>
            <div className="benefits-confirm-actions">
              <button className="benefits-confirm-btn benefits-confirm-yes" onClick={() => { doEnroll(confirmEnroll.benefitType); setConfirmEnroll(null) }}>
                {t('benefits.confirm_yes')}
              </button>
              <button className="benefits-confirm-btn benefits-confirm-no" onClick={() => setConfirmEnroll(null)}>
                {t('benefits.confirm_no')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
