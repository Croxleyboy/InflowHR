import { useState } from 'react'
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
  const { employeeName, employeeEmail, companyUser } = useAuth()
  const { showError } = useToast()
  const navigate = useNavigate()
  const [draft, setDraft] = useState<Features>({ ...features })
  const [draftLang, setDraftLang] = useState<Lang>(lang)
  const [draftFy, setDraftFy] = useState(fyStartMonth)
  const [saved, setSaved] = useState(false)
  const isCompanyAdmin = companyUser?.role === 'admin'

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
            {featureLabels.filter(({ key }) => companyFeatures[key]).map(({ key, tKey }) => (
              <div className="toggle-row" key={key}>
                <span>{t(tKey)}</span>
                <button
                  className={`toggle-switch ${draft[key] ? 'toggle-on' : 'toggle-off'}`}
                  onClick={() => handleToggle(key)}
                  role="switch"
                  aria-checked={draft[key]}
                >
                  <span className="toggle-knob" />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <button className="save-btn" onClick={handleSave}>
        {saved ? t('settings.saved') : t('settings.save')}
      </button>

      <section className="settings-section">
        <button className="settings-admin-btn settings-guide-btn" onClick={() => navigate('/user-guide')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
          </svg>
          User Guide
        </button>
      </section>

      {isCompanyAdmin && (
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
