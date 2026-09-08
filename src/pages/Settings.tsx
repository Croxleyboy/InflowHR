import { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useFeatures, type Features } from '../context/FeatureContext'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { useToast } from '../context/ToastContext'
import type { Lang } from '../lib/translations'

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
        </div>
      </section>

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
    </div>
  )
}
