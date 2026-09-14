import { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useFeatures, type Features } from '../context/FeatureContext'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { useToast } from '../context/ToastContext'
import type { Lang } from '../lib/translations'

interface BillingSummary {
  billing_type: string
  billing_end_date: string
  outstanding_amount: number
  employee_count?: number
  per_employee_monthly?: number
  note: string
}

interface CancellationRequest {
  id: string
  status: string
  billing_end_date: string
  requested_at: string
  data_frozen_at: string | null
}

const featureLabels: { key: keyof Features; tKey: string }[] = [
  { key: 'expenses', tKey: 'dashboard.expenses' },
  { key: 'leave', tKey: 'dashboard.leave_remaining' },
  { key: 'profile', tKey: 'dashboard.my_profile' },
  { key: 'payslips', tKey: 'dashboard.payslips' },
  { key: 'kudos', tKey: 'dashboard.kudos' },
  { key: 'benefits', tKey: 'dashboard.benefits' },
  { key: 'elearning', tKey: 'dashboard.elearning' },
  { key: 'performance', tKey: 'dashboard.performance' },
  { key: 'timesheets', tKey: 'dashboard.timesheets' },
  { key: 'shifts', tKey: 'dashboard.shifts' },
  { key: 'legal_timesheets', tKey: 'dashboard.legal_timesheets' },
  { key: 'space_booking', tKey: 'dashboard.space_booking' },
]

const monthLabels = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export default function Settings() {
  const { features, companyFeatures, setFeatures } = useFeatures()
  const { lang, setLang, t, fyStartMonth, setFyStartMonth } = useLanguage()
  const { employeeName, employeeEmail, companyUser, isSuperAdmin, portalRole } = useAuth()
  const { showError, showSuccess } = useToast()
  const navigate = useNavigate()
  const [draft, setDraft] = useState<Features>({ ...features })
  const [draftLang, setDraftLang] = useState<Lang>(lang)
  const [draftFy, setDraftFy] = useState(fyStartMonth)
  const [saved, setSaved] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [dashLayout, setDashLayout] = useState(localStorage.getItem('inflowhr-dashboard-layout') || 'cards')
  const [isDesktop, setIsDesktop] = useState(window.innerWidth >= 768)
  const [consents, setConsents] = useState<Record<string, boolean>>({})
  const [consentsLoading, setConsentsLoading] = useState(true)
  const [consentSaving, setConsentSaving] = useState<string | null>(null)
  const [showCancelModal, setShowCancelModal] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [billingSummary, setBillingSummary] = useState<BillingSummary | null>(null)
  const [billingLoading, setBillingLoading] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [existingCancellation, setExistingCancellation] = useState<CancellationRequest | null>(null)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  const isCompanyAdmin = isSuperAdmin || companyUser?.role === 'admin'
  const hasPortalAccess = isCompanyAdmin || !!portalRole

  const handleDownloadMyData = useCallback(async () => {
    if (!companyUser?.employee_id) { showError('No employee record linked'); return }
    setExporting(true)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await supabase.rpc('export_employee_data' as any, { p_employee_id: companyUser.employee_id })
      if (error) { showError('Export failed: ' + error.message); setExporting(false); return }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `my-data-export-${new Date().toISOString().split('T')[0]}.json`
      a.click()
      URL.revokeObjectURL(url)
      showSuccess('Your data has been downloaded')
    } catch {
      showError('Export failed — please try again')
    }
    setExporting(false)
  }, [companyUser?.employee_id, showError, showSuccess])

  useEffect(() => {
    if (!companyUser?.employee_id || !companyUser?.company_id) { setConsentsLoading(false); return }
    supabase.from('employee_consents')
      .select('consent_type, withdrawn_at')
      .eq('employee_id', companyUser.employee_id)
      .eq('company_id', companyUser.company_id)
      .then(({ data }) => {
        const map: Record<string, boolean> = {}
        ;(data || []).forEach((c: { consent_type: string; withdrawn_at: string | null }) => {
          map[c.consent_type] = !c.withdrawn_at
        })
        setConsents(map)
        setConsentsLoading(false)
      })
  }, [companyUser?.employee_id, companyUser?.company_id])

  const handleConsentToggle = useCallback(async (consentType: string) => {
    if (!companyUser?.employee_id || !companyUser?.company_id) return
    setConsentSaving(consentType)
    const currentlyGranted = consents[consentType] ?? false

    if (currentlyGranted) {
      const { error } = await supabase.from('employee_consents')
        .update({ withdrawn_at: new Date().toISOString() })
        .eq('employee_id', companyUser.employee_id)
        .eq('company_id', companyUser.company_id)
        .eq('consent_type', consentType)
      if (error) { showError('Failed to update consent'); setConsentSaving(null); return }
      setConsents(prev => ({ ...prev, [consentType]: false }))
      showSuccess('Consent withdrawn')
    } else {
      const existing = await supabase.from('employee_consents')
        .select('id')
        .eq('employee_id', companyUser.employee_id)
        .eq('company_id', companyUser.company_id)
        .eq('consent_type', consentType)
        .maybeSingle()

      if (existing.data) {
        const { error } = await supabase.from('employee_consents')
          .update({ granted_at: new Date().toISOString(), withdrawn_at: null, consent_version: '1.0' })
          .eq('id', existing.data.id)
        if (error) { showError('Failed to update consent'); setConsentSaving(null); return }
      } else {
        const { error } = await supabase.from('employee_consents')
          .insert({
            employee_id: companyUser.employee_id,
            company_id: companyUser.company_id,
            consent_type: consentType,
            consent_version: '1.0',
          })
        if (error) { showError('Failed to record consent'); setConsentSaving(null); return }
      }
      setConsents(prev => ({ ...prev, [consentType]: true }))
      showSuccess('Consent granted')
    }
    setConsentSaving(null)
  }, [companyUser?.employee_id, companyUser?.company_id, consents, showError, showSuccess])

  // Check for existing cancellation request
  useEffect(() => {
    if (!companyUser?.company_id || !isCompanyAdmin || isSuperAdmin) return
    supabase.from('cancellation_requests')
      .select('id, status, billing_end_date, requested_at, data_frozen_at')
      .eq('company_id', companyUser.company_id)
      .not('status', 'in', '("cancelled","completed")')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setExistingCancellation(data as CancellationRequest)
      })
  }, [companyUser?.company_id, isCompanyAdmin, isSuperAdmin])

  const handleOpenCancelModal = useCallback(async () => {
    if (!companyUser?.company_id) return
    setBillingLoading(true)
    setShowCancelModal(true)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await supabase.rpc('get_cancellation_billing_summary' as any, {
        p_company_id: companyUser.company_id,
      })
      if (error) { showError('Failed to load billing: ' + error.message); setShowCancelModal(false); return }
      setBillingSummary(data as BillingSummary)
    } catch {
      showError('Failed to load billing information')
      setShowCancelModal(false)
    }
    setBillingLoading(false)
  }, [companyUser?.company_id, showError])

  const handleConfirmCancellation = useCallback(async () => {
    if (!companyUser?.company_id) return
    setCancelling(true)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await supabase.rpc('request_company_cancellation' as any, {
        p_company_id: companyUser.company_id,
        p_reason: cancelReason || null,
      })
      if (error) { showError('Cancellation request failed: ' + error.message); setCancelling(false); return }
      showSuccess('Cancellation request submitted. You will receive confirmation shortly.')
      setShowCancelModal(false)
      setCancelReason('')
      // Refresh existing cancellation state
      const { data } = await supabase.from('cancellation_requests')
        .select('id, status, billing_end_date, requested_at, data_frozen_at')
        .eq('company_id', companyUser.company_id)
        .not('status', 'in', '("cancelled","completed")')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (data) setExistingCancellation(data as CancellationRequest)
    } catch {
      showError('Cancellation request failed — please try again')
    }
    setCancelling(false)
  }, [companyUser?.company_id, cancelReason, showError, showSuccess])

  function handleToggle(key: keyof Features) {
    setDraft(d => ({ ...d, [key]: !d[key] }))
    setSaved(false)
  }

  async function handleSave() {
    setFeatures(draft)
    setLang(draftLang)
    setFyStartMonth(draftFy)

    if (companyUser?.company_id) {
      const { error: settingsError } = await supabase.from('app_settings').update({
        language: draftLang,
        financial_year_start_month: draftFy,
        updated_at: new Date().toISOString(),
      }).eq('company_id', companyUser.company_id)
      if (settingsError) { showError('Failed to update settings: ' + settingsError.message); return }

      const featureRows = (Object.keys(draft) as (keyof Features)[]).map(key => ({
        company_id: companyUser.company_id,
        feature_key: key === 'payslips' ? 'payroll' : key,
        is_visible: draft[key],
      }))
      try {
        await Promise.all(featureRows.map(row =>
          supabase.from('company_features')
            .update({ is_visible: row.is_visible })
            .eq('company_id', row.company_id)
            .eq('feature_key', row.feature_key)
        ))
      } catch (e: any) {
        showError('Failed to update feature toggles: ' + (e?.message || String(e)))
        return
      }
    }

    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="settings-page">
      <h1>{t('settings.title')}</h1>

      <section className="settings-section">
        <h2>{t('settings.profile')}</h2>
        <div className="settings-info">
          <div className="settings-row"><span className="settings-label">{t('settings.name')}</span><span>{employeeName}</span></div>
          <div className="settings-row"><span className="settings-label">{t('settings.email')}</span><span>{employeeEmail}</span></div>
          <div className="settings-row"><span className="settings-label">{t('settings.role')}</span><span>{companyUser?.role === 'admin' ? 'Administrator' : 'Employee'}</span></div>
        </div>
      </section>

      <section className="settings-section">
        <h2>{t('settings.app_info')}</h2>
        <div className="settings-info">
          <div className="settings-row"><span className="settings-label">{t('settings.version')}</span><span>1.0.0</span></div>
          <div className="settings-row"><span className="settings-label">{t('settings.environment')}</span><span>Production</span></div>
        </div>
      </section>

      {isCompanyAdmin && (
        <section className="settings-section">
          <h2>{t('settings.app_settings')}</h2>
          <div className="settings-info">
            <div className="settings-row">
              <span className="settings-label">{t('settings.language')}</span>
              <div className="language-selector">
                <button
                  className={`lang-btn ${draftLang === 'en' ? 'lang-active' : ''}`}
                  onClick={() => { setDraftLang('en'); setSaved(false) }}
                >English</button>
                <button
                  className={`lang-btn ${draftLang === 'de' ? 'lang-active' : ''}`}
                  onClick={() => { setDraftLang('de'); setSaved(false) }}
                >Deutsch</button>
              </div>
            </div>
            <div className="settings-row">
              <span className="settings-label">{t('settings.financial_year')}</span>
              <select
                className="fy-select"
                value={draftFy}
                onChange={e => { setDraftFy(Number(e.target.value)); setSaved(false) }}
              >
                {monthLabels.map((m, i) => (
                  <option key={i} value={i + 1}>{m}</option>
                ))}
              </select>
            </div>
          </div>
        </section>
      )}

      {isCompanyAdmin && (
        <section className="settings-section">
          <h2>{t('settings.features')}</h2>
          <p className="settings-hint">{t('settings.features_hint')}</p>
          <div className="feature-toggles">
            {featureLabels.filter(({ key }) => companyFeatures[key] || key === 'elearning').map(({ key, tKey }) => {
              const disabled = !companyFeatures[key]
              return (
                <div className="toggle-row" key={key} style={disabled ? { opacity: 0.5 } : undefined}>
                  <span>{t(tKey)}{disabled ? ' (disabled)' : ''}</span>
                  <button
                    className={`toggle-switch ${draft[key] && !disabled ? 'toggle-on' : 'toggle-off'}`}
                    onClick={() => !disabled && handleToggle(key)}
                    role="switch"
                    aria-checked={draft[key] && !disabled}
                    disabled={disabled}
                    style={disabled ? { cursor: 'not-allowed' } : undefined}
                  >
                    <span className="toggle-knob" />
                  </button>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {isCompanyAdmin && (
        <button className="save-btn" onClick={handleSave}>
          {saved ? t('settings.saved') : t('settings.save')}
        </button>
      )}

      {isDesktop && (
        <section className="settings-section">
          <h2>Dashboard Layout</h2>
          <div className="settings-info">
            <div className="settings-row">
              <span className="settings-label">Default view</span>
              <div className="language-selector">
                <button
                  className={`lang-btn ${dashLayout === 'cards' ? 'lang-active' : ''}`}
                  onClick={() => { localStorage.setItem('inflowhr-dashboard-layout', 'cards'); setDashLayout('cards') }}
                >Cards</button>
                <button
                  className={`lang-btn ${dashLayout === 'detailed' ? 'lang-active' : ''}`}
                  onClick={() => { localStorage.setItem('inflowhr-dashboard-layout', 'detailed'); setDashLayout('detailed') }}
                >Detailed</button>
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="settings-section">
        <h2>Your Data</h2>
        <div className="settings-info">
          <button className="settings-row settings-row-btn" onClick={handleDownloadMyData} disabled={exporting}>
            <span className="settings-row-left">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              <span>{exporting ? 'Exporting…' : 'Download My Data'}</span>
            </span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
          </button>
          <button className="settings-row settings-row-btn" onClick={() => navigate('/user-guide')}>
            <span className="settings-row-left">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
              </svg>
              <span>User Guide</span>
            </span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
          </button>
          <button className="settings-row settings-row-btn" onClick={() => navigate('/privacy')}>
            <span className="settings-row-left">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
              <span>Privacy Notice</span>
            </span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
          </button>
        </div>
      </section>

      {!consentsLoading && companyUser?.employee_id && (
        <section className="settings-section">
          <h2>Data Consents</h2>
          <p className="settings-hint" style={{ marginBottom: 12 }}>
            Manage your consent for optional data processing. You can withdraw consent at any time. <a href="/privacy" style={{ color: 'var(--primary, #6C4FBF)' }}>View our Privacy Notice</a>
          </p>
          <div className="feature-toggles">
            <div className="toggle-row">
              <div>
                <span>Religion or belief data</span>
                <p style={{ fontSize: 12, color: '#64748b', margin: '2px 0 0' }}>Used to accommodate religious observance and dietary requirements</p>
              </div>
              <button
                className={`toggle-switch ${consents.special_category ? 'toggle-on' : 'toggle-off'}`}
                onClick={() => handleConsentToggle('special_category')}
                disabled={consentSaving === 'special_category'}
                role="switch"
                aria-checked={consents.special_category ?? false}
              >
                <span className="toggle-knob" />
              </button>
            </div>
            <div className="toggle-row">
              <div>
                <span>Geolocation check-in</span>
                <p style={{ fontSize: 12, color: '#64748b', margin: '2px 0 0' }}>Records GPS coordinates when you check in/out for timesheets or shifts</p>
              </div>
              <button
                className={`toggle-switch ${consents.geolocation ? 'toggle-on' : 'toggle-off'}`}
                onClick={() => handleConsentToggle('geolocation')}
                disabled={consentSaving === 'geolocation'}
                role="switch"
                aria-checked={consents.geolocation ?? false}
              >
                <span className="toggle-knob" />
              </button>
            </div>
          </div>
        </section>
      )}

      {isCompanyAdmin && !isSuperAdmin && (
        <section className="settings-section" style={{ borderTop: '2px solid #ef4444', paddingTop: 20, marginTop: 24 }}>
          <h2 style={{ color: '#ef4444' }}>Subscription</h2>
          {existingCancellation ? (
            <div className="settings-info" style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: 16 }}>
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
            <div className="settings-info">
              <p className="settings-hint" style={{ marginBottom: 12 }}>
                Cancelling your subscription will end your service at the close of the current billing period. All outstanding charges for this month will still apply.
              </p>
              <button
                className="settings-row settings-row-btn"
                onClick={handleOpenCancelModal}
                style={{ color: '#ef4444', borderColor: '#fecaca' }}
              >
                <span className="settings-row-left">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="15" y1="9" x2="9" y2="15"/>
                    <line x1="9" y1="9" x2="15" y2="15"/>
                  </svg>
                  <span>Cancel Subscription</span>
                </span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
              </button>
            </div>
          )}
        </section>
      )}

      {hasPortalAccess && (
        <section className="settings-section settings-admin-section">
          <button className="settings-admin-btn" onClick={() => navigate('/admin')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            {t('settings.admin_portal')}
          </button>
        </section>
      )}

      {showCancelModal && (
        <div className="modal-overlay" onClick={() => !cancelling && setShowCancelModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <h2 style={{ color: '#dc2626', margin: '0 0 16px' }}>Cancel Subscription</h2>

            {billingLoading ? (
              <p>Loading billing information…</p>
            ) : billingSummary ? (
              <>
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: 16, marginBottom: 16 }}>
                  <h3 style={{ margin: '0 0 8px', fontSize: 15, color: '#991b1b' }}>Outstanding Charges</h3>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span>Billing type</span>
                    <strong>{billingSummary.billing_type === 'fixed' ? 'Fixed Annual' : 'Monthly per employee'}</strong>
                  </div>
                  {billingSummary.employee_count != null && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span>Active employees</span>
                      <strong>{billingSummary.employee_count}</strong>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span>Amount due</span>
                    <strong style={{ color: '#dc2626', fontSize: 18 }}>
                      &pound;{billingSummary.outstanding_amount.toFixed(2)}
                    </strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Service until</span>
                    <strong>{new Date(billingSummary.billing_end_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</strong>
                  </div>
                  <p style={{ fontSize: 13, color: '#7f1d1d', marginTop: 8, marginBottom: 0 }}>
                    {billingSummary.note}
                  </p>
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
                  >
                    Keep Subscription
                  </button>
                  <button
                    onClick={handleConfirmCancellation}
                    disabled={cancelling}
                    style={{ padding: '10px 20px', borderRadius: 6, border: 'none', background: '#dc2626', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}
                  >
                    {cancelling ? 'Submitting…' : 'Confirm Cancellation'}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}
