import { useState } from 'react'
import { useFeatures, type Features } from '../context/FeatureContext'
import { useLanguage } from '../context/LanguageContext'
import { supabase } from '../lib/supabase'
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
]

const monthLabels = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export default function Settings() {
  const { features, setFeatures } = useFeatures()
  const { lang, setLang, t, fyStartMonth, setFyStartMonth } = useLanguage()
  const [draft, setDraft] = useState<Features>({ ...features })
  const [draftLang, setDraftLang] = useState<Lang>(lang)
  const [draftFy, setDraftFy] = useState(fyStartMonth)
  const [saved, setSaved] = useState(false)
  const isAdmin = true

  function handleToggle(key: keyof Features) {
    setDraft(d => ({ ...d, [key]: !d[key] }))
    setSaved(false)
  }

  async function handleSave() {
    setFeatures(draft)
    setLang(draftLang)
    setFyStartMonth(draftFy)

    await supabase.from('app_settings').update({
      language: draftLang,
      financial_year_start_month: draftFy,
      updated_at: new Date().toISOString(),
    }).eq('id', 1)

    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="settings-page">
      <h1>{t('settings.title')}</h1>

      <section className="settings-section">
        <h2>{t('settings.profile')}</h2>
        <div className="settings-info">
          <div className="settings-row"><span className="settings-label">{t('settings.name')}</span><span>Andy Jones</span></div>
          <div className="settings-row"><span className="settings-label">{t('settings.email')}</span><span>andy.jones@kumonix.com</span></div>
          <div className="settings-row"><span className="settings-label">{t('settings.role')}</span><span>Administrator</span></div>
        </div>
      </section>

      <section className="settings-section">
        <h2>{t('settings.app_info')}</h2>
        <div className="settings-info">
          <div className="settings-row"><span className="settings-label">{t('settings.version')}</span><span>1.0.0</span></div>
          <div className="settings-row"><span className="settings-label">{t('settings.environment')}</span><span>Production</span></div>
        </div>
      </section>

      {isAdmin && (
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

      {isAdmin && (
        <section className="settings-section">
          <h2>{t('settings.features')}</h2>
          <p className="settings-hint">{t('settings.features_hint')}</p>
          <div className="feature-toggles">
            {featureLabels.map(({ key, tKey }) => (
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
    </div>
  )
}
