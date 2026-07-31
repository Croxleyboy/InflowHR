import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLanguage } from '../context/LanguageContext'
import { useFeatures } from '../context/FeatureContext'

const STORAGE_KEY = 'inflowhr-benefits'
const ADMIN_BENEFITS_KEY = 'inflowhr-admin-benefits'

interface AdminBenefitOption { id: string; enabled: boolean }
interface AdminBenefitType { id: string; enabled: boolean; options: AdminBenefitOption[]; monthlyCost?: number; lockPeriod?: 'none' | 'month' | 'year'; title?: string }

function loadAdminConfig(): AdminBenefitType[] | null {
  try {
    const raw = localStorage.getItem(ADMIN_BENEFITS_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function isBenefitEnabled(adminCfg: AdminBenefitType[] | null, id: string): boolean {
  if (!adminCfg) return true
  const b = adminCfg.find(x => x.id === id)
  return b ? b.enabled : true
}

function isOptionEnabled(adminCfg: AdminBenefitType[] | null, benefitId: string, optionId: string): boolean {
  if (!adminCfg) return true
  const b = adminCfg.find(x => x.id === benefitId)
  if (!b) return true
  const o = b.options.find(x => x.id === optionId)
  return o ? o.enabled : true
}

interface BenefitEnrollments {
  vacation_options: string[]
  health_insurance: boolean
  car_insurance: boolean
  cycle_scheme: boolean
  enrollDates?: Record<string, string>
}

const DEFAULT: BenefitEnrollments = {
  vacation_options: [],
  health_insurance: false,
  car_insurance: false,
  cycle_scheme: false,
  enrollDates: {},
}

function loadEnrollments(): BenefitEnrollments {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? { ...DEFAULT, ...JSON.parse(raw) } : DEFAULT
  } catch { return DEFAULT }
}

function isLocked(adminCfg: AdminBenefitType[] | null, benefitId: string, enrollDates?: Record<string, string>): { locked: boolean; until: string } {
  if (!adminCfg || !enrollDates) return { locked: false, until: '' }
  const b = adminCfg.find(x => x.id === benefitId)
  if (!b || !b.lockPeriod || b.lockPeriod === 'none' || (b.monthlyCost ?? 0) === 0) return { locked: false, until: '' }
  const enrollDate = enrollDates[benefitId]
  if (!enrollDate) return { locked: false, until: '' }
  const now = new Date()
  if (b.lockPeriod === 'month') {
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    if (new Date(enrollDate) <= endOfMonth) {
      const d = endOfMonth
      return { locked: now < d, until: `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}` }
    }
  }
  if (b.lockPeriod === 'year') {
    const fyEndYear = now.getMonth() >= 3 ? now.getFullYear() + 1 : now.getFullYear()
    const fyEnd = new Date(fyEndYear, 3, 5)
    if (new Date(enrollDate) <= fyEnd) {
      return { locked: now < fyEnd, until: `5/4/${fyEndYear}` }
    }
  }
  return { locked: false, until: '' }
}

const VACATION_OPTIONS = [
  { id: 'buy_leave', icon: '🛒', titleKey: 'benefits.vac_buy_leave', descKey: 'benefits.vac_buy_leave_desc' },
  { id: 'sell_leave', icon: '💷', titleKey: 'benefits.vac_sell_leave', descKey: 'benefits.vac_sell_leave_desc' },
  { id: 'carry_over', icon: '📦', titleKey: 'benefits.vac_carry_over', descKey: 'benefits.vac_carry_over_desc' },
  { id: 'sabbatical', icon: '🌍', titleKey: 'benefits.vac_sabbatical', descKey: 'benefits.vac_sabbatical_desc' },
  { id: 'compressed_hours', icon: '⏰', titleKey: 'benefits.vac_compressed', descKey: 'benefits.vac_compressed_desc' },
]

export default function Benefits() {
  const navigate = useNavigate()
  const { t } = useLanguage()
  const { features } = useFeatures()
  const payrollEnabled = features.payslips
  const [enrollments, setEnrollments] = useState<BenefitEnrollments>(loadEnrollments)
  const [openModal, setOpenModal] = useState<string | null>(null)
  const [adminCfg] = useState<AdminBenefitType[] | null>(loadAdminConfig)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(enrollments))
  }, [enrollments])

  const toggleVacOption = (id: string) => {
    setEnrollments(prev => ({
      ...prev,
      vacation_options: prev.vacation_options.includes(id)
        ? prev.vacation_options.filter(v => v !== id)
        : [...prev.vacation_options, id],
    }))
  }

  const benefitKeyToId: Record<string, string> = { health_insurance: 'health', car_insurance: 'car', cycle_scheme: 'cycle' }
  const [confirmEnroll, setConfirmEnroll] = useState<{ key: 'health_insurance' | 'car_insurance' | 'cycle_scheme'; title: string; cost: number; until: string } | null>(null)

  function getLockUntilDate(lockPeriod: string): string {
    const now = new Date()
    if (lockPeriod === 'month') {
      const d = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`
    }
    if (lockPeriod === 'year') {
      const fyEndYear = now.getMonth() >= 3 ? now.getFullYear() + 1 : now.getFullYear()
      return `5/4/${fyEndYear}`
    }
    return ''
  }

  const toggleBool = (key: 'health_insurance' | 'car_insurance' | 'cycle_scheme') => {
    const bId = benefitKeyToId[key]
    const lock = isLocked(adminCfg, bId, enrollments.enrollDates)
    if (lock.locked && enrollments[key]) return

    if (!enrollments[key] && adminCfg) {
      const b = adminCfg.find(x => x.id === bId)
      if (b && (b.monthlyCost ?? 0) > 0 && b.lockPeriod && b.lockPeriod !== 'none') {
        setConfirmEnroll({ key, title: b.title || bId, cost: b.monthlyCost!, until: getLockUntilDate(b.lockPeriod) })
        return
      }
    }

    doEnroll(key)
  }

  const doEnroll = (key: 'health_insurance' | 'car_insurance' | 'cycle_scheme') => {
    const bId = benefitKeyToId[key]
    setEnrollments(prev => {
      const newVal = !prev[key]
      const dates = { ...(prev.enrollDates || {}) }
      if (newVal) {
        dates[bId] = new Date().toISOString()
      } else {
        delete dates[bId]
      }
      return { ...prev, [key]: newVal, enrollDates: dates }
    })
  }

  const vacEnrolled = enrollments.vacation_options.length > 0

  return (
    <div className="benefits-page">
      <div className="benefits-header">
        <button className="benefits-back" onClick={() => navigate(-1)}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <div className="benefits-header-center">
          <h1 className="benefits-title">{t('benefits.title')} <span className="benefits-title-accent">{t('benefits.title_accent')}</span></h1>
        </div>
        <button className="benefits-refresh" onClick={() => window.location.reload()}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
        </button>
      </div>

      <div className="benefits-list">
        {/* 1 - Vacation / Salary Sacrifice */}
        {isBenefitEnabled(adminCfg, 'vacation') && <button className="benefits-card" onClick={() => setOpenModal('vacation')}>
          <div className="benefits-card-icon benefits-icon-vacation">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
          </div>
          <div className="benefits-card-text">
            <span className="benefits-card-title">{t('benefits.vacation_title')}</span>
            <span className="benefits-card-desc">{t('benefits.vacation_desc')}</span>
          </div>
          {vacEnrolled && <span className="benefits-enrolled-badge">{t('benefits.enrolled')}</span>}
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="benefits-card-arrow"><path d="M9 6l6 6-6 6"/></svg>
        </button>}

        {/* 2 - Health Insurance */}
        {isBenefitEnabled(adminCfg, 'health') && <button className="benefits-card" onClick={() => setOpenModal('health')}>
          <div className="benefits-card-icon benefits-icon-health">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
          </div>
          <div className="benefits-card-text">
            <span className="benefits-card-title">{t('benefits.health_title')}</span>
            <span className="benefits-card-desc">{t('benefits.health_desc')}</span>
          </div>
          {enrollments.health_insurance && <span className="benefits-enrolled-badge">{t('benefits.enrolled')}</span>}
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="benefits-card-arrow"><path d="M9 6l6 6-6 6"/></svg>
        </button>}

        {/* 3 - Car Insurance */}
        {isBenefitEnabled(adminCfg, 'car') && <button className="benefits-card" onClick={() => setOpenModal('car')}>
          <div className="benefits-card-icon benefits-icon-car">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="15" height="13" rx="2"/><path d="M16 8h4l3 5v5h-3"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
          </div>
          <div className="benefits-card-text">
            <span className="benefits-card-title">{t('benefits.car_title')}</span>
            <span className="benefits-card-desc">{t('benefits.car_desc')}</span>
          </div>
          {enrollments.car_insurance && <span className="benefits-enrolled-badge">{t('benefits.enrolled')}</span>}
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="benefits-card-arrow"><path d="M9 6l6 6-6 6"/></svg>
        </button>}

        {/* 4 - Cycle Scheme */}
        {isBenefitEnabled(adminCfg, 'cycle') && <button className="benefits-card" onClick={() => setOpenModal('cycle')}>
          <div className="benefits-card-icon benefits-icon-cycle">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><path d="M15 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" fill="#fff"/><path d="M12 17.5V14l-3-3 4-3 2 3h3"/></svg>
          </div>
          <div className="benefits-card-text">
            <span className="benefits-card-title">{t('benefits.cycle_title')}</span>
            <span className="benefits-card-desc">{t('benefits.cycle_desc')}</span>
          </div>
          {enrollments.cycle_scheme && <span className="benefits-enrolled-badge">{t('benefits.enrolled')}</span>}
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="benefits-card-arrow"><path d="M9 6l6 6-6 6"/></svg>
        </button>}
      </div>

      <div className="benefits-footer-text">
        <p>{t('benefits.footer_text')}</p>
      </div>

      {/* Vacation Options Modal */}
      {openModal === 'vacation' && (
        <div className="benefits-modal-overlay" onClick={() => setOpenModal(null)}>
          <div className="benefits-modal" onClick={e => e.stopPropagation()}>
            <div className="benefits-modal-header benefits-modal-header-vacation">
              <h2>{t('benefits.vacation_title')}</h2>
              <button className="benefits-modal-close" onClick={() => setOpenModal(null)}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <p className="benefits-modal-intro">{t('benefits.vacation_intro')}</p>
            <p className="benefits-modal-eligibility">{t('benefits.vacation_eligibility')}</p>
            <div className="benefits-modal-options">
              {VACATION_OPTIONS.filter(opt => isOptionEnabled(adminCfg, 'vacation', opt.id)).map(opt => {
                const checked = enrollments.vacation_options.includes(opt.id)
                return (
                  <button key={opt.id} className={`benefits-option-row ${checked ? 'benefits-option-active' : ''}`} onClick={() => toggleVacOption(opt.id)}>
                    <span className="benefits-option-icon">{opt.icon}</span>
                    <div className="benefits-option-text">
                      <span className="benefits-option-title">{t(opt.titleKey)}</span>
                      <span className="benefits-option-desc">{t(opt.descKey)}</span>
                    </div>
                    <div className={`benefits-checkbox ${checked ? 'benefits-checkbox-on' : ''}`}>
                      {checked && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Health Insurance Modal */}
      {openModal === 'health' && (
        <div className="benefits-modal-overlay" onClick={() => setOpenModal(null)}>
          <div className="benefits-modal" onClick={e => e.stopPropagation()}>
            <div className="benefits-modal-header benefits-modal-header-health">
              <h2>{t('benefits.health_title')}</h2>
              <button className="benefits-modal-close" onClick={() => setOpenModal(null)}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="benefits-modal-body">
              <p className="benefits-modal-intro">{t('benefits.health_intro')}</p>
              <div className="benefits-modal-details">
                {[
                  { id: 'hospital', icon: '🏥', key: 'benefits.health_detail_1' },
                  { id: 'gp', icon: '👨‍⚕️', key: 'benefits.health_detail_2' },
                  { id: 'dental', icon: '🦷', key: 'benefits.health_detail_3' },
                  { id: 'optical', icon: '👁️', key: 'benefits.health_detail_4' },
                  { id: 'prescriptions', icon: '💊', key: 'benefits.health_detail_5' },
                  { id: 'wellness', icon: '🏆', key: 'benefits.health_detail_6' },
                  { id: 'family', icon: '👨‍👩‍👧', key: 'benefits.health_detail_7' },
                ].filter(r => isOptionEnabled(adminCfg, 'health', r.id)).map(r => (
                  <div key={r.id} className="benefits-detail-row">
                    <span className="benefits-detail-icon">{r.icon}</span>
                    <span>{t(r.key)}</span>
                  </div>
                ))}
              </div>
              <p className="benefits-modal-eligibility">{t('benefits.health_eligibility')}</p>
              {payrollEnabled && <p className="benefits-modal-cost">{t('benefits.health_cost')}</p>}
              {(() => { const lock = isLocked(adminCfg, 'health', enrollments.enrollDates); return (
                <>
                  <button className={`benefits-signup-btn ${enrollments.health_insurance ? 'benefits-signup-active' : ''} ${lock.locked && enrollments.health_insurance ? 'benefits-signup-locked' : ''}`} onClick={() => toggleBool('health_insurance')} disabled={lock.locked && enrollments.health_insurance}>
                    <div className={`benefits-checkbox ${enrollments.health_insurance ? 'benefits-checkbox-on' : ''}`}>
                      {enrollments.health_insurance && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                    </div>
                    <span>{lock.locked && enrollments.health_insurance ? t('benefits.locked') : enrollments.health_insurance ? t('benefits.enrolled_label') : t('benefits.sign_up')}</span>
                  </button>
                  {lock.locked && enrollments.health_insurance && <p className="benefits-lock-notice">{t('benefits.locked_until')} {lock.until}</p>}
                </>
              ); })()}
            </div>
          </div>
        </div>
      )}

      {/* Car Insurance Modal */}
      {openModal === 'car' && (
        <div className="benefits-modal-overlay" onClick={() => setOpenModal(null)}>
          <div className="benefits-modal" onClick={e => e.stopPropagation()}>
            <div className="benefits-modal-header benefits-modal-header-car">
              <h2>{t('benefits.car_title')}</h2>
              <button className="benefits-modal-close" onClick={() => setOpenModal(null)}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="benefits-modal-body">
              <p className="benefits-modal-intro">{t('benefits.car_intro')}</p>
              <div className="benefits-modal-details">
                {[
                  { id: 'comprehensive', icon: '🚗', key: 'benefits.car_detail_1' },
                  { id: 'breakdown', icon: '🛡️', key: 'benefits.car_detail_2' },
                  { id: 'windscreen', icon: '🔧', key: 'benefits.car_detail_3' },
                  { id: 'discount', icon: '💰', key: 'benefits.car_detail_4' },
                  { id: 'legal', icon: '⚖️', key: 'benefits.car_detail_5' },
                  { id: 'courtesy', icon: '🚙', key: 'benefits.car_detail_6' },
                ].filter(r => isOptionEnabled(adminCfg, 'car', r.id)).map(r => (
                  <div key={r.id} className="benefits-detail-row">
                    <span className="benefits-detail-icon">{r.icon}</span>
                    <span>{t(r.key)}</span>
                  </div>
                ))}
              </div>
              <p className="benefits-modal-eligibility">{t('benefits.car_eligibility')}</p>
              {payrollEnabled && <p className="benefits-modal-cost">{t('benefits.car_cost')}</p>}
              {(() => { const lock = isLocked(adminCfg, 'car', enrollments.enrollDates); return (
                <>
                  <button className={`benefits-signup-btn ${enrollments.car_insurance ? 'benefits-signup-active' : ''} ${lock.locked && enrollments.car_insurance ? 'benefits-signup-locked' : ''}`} onClick={() => toggleBool('car_insurance')} disabled={lock.locked && enrollments.car_insurance}>
                    <div className={`benefits-checkbox ${enrollments.car_insurance ? 'benefits-checkbox-on' : ''}`}>
                      {enrollments.car_insurance && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                    </div>
                    <span>{lock.locked && enrollments.car_insurance ? t('benefits.locked') : enrollments.car_insurance ? t('benefits.enrolled_label') : t('benefits.sign_up')}</span>
                  </button>
                  {lock.locked && enrollments.car_insurance && <p className="benefits-lock-notice">{t('benefits.locked_until')} {lock.until}</p>}
                </>
              ); })()}
            </div>
          </div>
        </div>
      )}

      {/* Cycle Scheme Modal */}
      {openModal === 'cycle' && (
        <div className="benefits-modal-overlay" onClick={() => setOpenModal(null)}>
          <div className="benefits-modal" onClick={e => e.stopPropagation()}>
            <div className="benefits-modal-header benefits-modal-header-cycle">
              <h2>{t('benefits.cycle_title')}</h2>
              <button className="benefits-modal-close" onClick={() => setOpenModal(null)}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="benefits-modal-body">
              <p className="benefits-modal-intro">{t('benefits.cycle_intro')}</p>
              <div className="benefits-modal-details">
                {[
                  { id: 'bike', icon: '🚲', key: 'benefits.cycle_detail_1' },
                  { id: 'tax_free', icon: '💷', key: 'benefits.cycle_detail_2' },
                  { id: 'green', icon: '🌱', key: 'benefits.cycle_detail_3' },
                  { id: 'accessories', icon: '🔄', key: 'benefits.cycle_detail_4' },
                  { id: 'insurance', icon: '🛡️', key: 'benefits.cycle_detail_5' },
                  { id: 'maintenance', icon: '📋', key: 'benefits.cycle_detail_6' },
                ].filter(r => isOptionEnabled(adminCfg, 'cycle', r.id)).map(r => (
                  <div key={r.id} className="benefits-detail-row">
                    <span className="benefits-detail-icon">{r.icon}</span>
                    <span>{t(r.key)}</span>
                  </div>
                ))}
              </div>
              <p className="benefits-modal-eligibility">{t('benefits.cycle_eligibility')}</p>
              {payrollEnabled && <p className="benefits-modal-cost">{t('benefits.cycle_cost')}</p>}
              {(() => { const lock = isLocked(adminCfg, 'cycle', enrollments.enrollDates); return (
                <>
                  <button className={`benefits-signup-btn ${enrollments.cycle_scheme ? 'benefits-signup-active' : ''} ${lock.locked && enrollments.cycle_scheme ? 'benefits-signup-locked' : ''}`} onClick={() => toggleBool('cycle_scheme')} disabled={lock.locked && enrollments.cycle_scheme}>
                    <div className={`benefits-checkbox ${enrollments.cycle_scheme ? 'benefits-checkbox-on' : ''}`}>
                      {enrollments.cycle_scheme && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                    </div>
                    <span>{lock.locked && enrollments.cycle_scheme ? t('benefits.locked') : enrollments.cycle_scheme ? t('benefits.enrolled_label') : t('benefits.sign_up')}</span>
                  </button>
                  {lock.locked && enrollments.cycle_scheme && <p className="benefits-lock-notice">{t('benefits.locked_until')} {lock.until}</p>}
                </>
              ); })()}
            </div>
          </div>
        </div>
      )}

      {/* Enrollment Confirmation Modal */}
      {confirmEnroll && (
        <div className="benefits-modal-overlay" onClick={() => setConfirmEnroll(null)}>
          <div className="benefits-confirm-modal" onClick={e => e.stopPropagation()}>
            <div className="benefits-confirm-icon">&#9888;&#65039;</div>
            <h3>{t('benefits.confirm_title')}</h3>
            <p className="benefits-confirm-text">
              {t('benefits.confirm_text_1')} <strong>{confirmEnroll.title}</strong> {t('benefits.confirm_text_2')} <strong>&pound;{confirmEnroll.cost.toFixed(2)}/{t('benefits.confirm_per_month')}</strong>.
            </p>
            <p className="benefits-confirm-lock">
              {t('benefits.confirm_lock')} <strong>{confirmEnroll.until}</strong>.
            </p>
            <div className="benefits-confirm-actions">
              <button className="benefits-confirm-btn benefits-confirm-yes" onClick={() => { doEnroll(confirmEnroll.key); setConfirmEnroll(null) }}>
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
