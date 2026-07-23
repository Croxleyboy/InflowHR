import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'

export default function Login() {
  const { signInWithMicrosoft } = useAuth()
  const { t } = useLanguage()

  return (
    <div className="login-page">
      <div className="login-hero">
        <div className="login-hero-content">
          <div className="login-hero-logo">
            <img src="/inflowhr-logo.avif" alt="InflowHR" className="login-hero-logo-img" />
          </div>
          <p className="login-hero-tagline">{t('login.hero_tagline')}</p>
          <div className="login-hero-features">
            <div className="login-hero-feature">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              <span>{t('login.feature_directory')}</span>
            </div>
            <div className="login-hero-feature">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
              <span>{t('login.feature_payslips')}</span>
            </div>
            <div className="login-hero-feature">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              <span>{t('login.feature_leave')}</span>
            </div>
            <div className="login-hero-feature">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
              <span>{t('login.feature_more')}</span>
            </div>
          </div>
        </div>
        <div className="login-hero-decoration">
          <div className="login-hero-circle login-hero-circle-1"></div>
          <div className="login-hero-circle login-hero-circle-2"></div>
          <div className="login-hero-circle login-hero-circle-3"></div>
        </div>
      </div>

      <div className="login-form-side">
        <div className="login-card">
          <div className="login-welcome">
            <h1 className="login-title">{t('login.welcome')}</h1>
            <p className="login-subtitle">{t('login.subtitle')}</p>
          </div>

          <button className="login-microsoft-btn" onClick={signInWithMicrosoft}>
            <svg width="20" height="20" viewBox="0 0 21 21">
              <rect x="1" y="1" width="9" height="9" fill="#f25022" />
              <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
              <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
              <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
            </svg>
            {t('login.sign_in_microsoft')}
          </button>

          <div className="login-divider">
            <span>{t('login.secure_access')}</span>
          </div>

          <div className="login-trust-badges">
            <div className="login-trust-badge">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              <span>{t('login.badge_sso')}</span>
            </div>
            <div className="login-trust-badge">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              <span>{t('login.badge_encrypted')}</span>
            </div>
            <div className="login-trust-badge">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              <span>{t('login.badge_gdpr')}</span>
            </div>
          </div>

          <p className="login-footer">{t('login.footer')}</p>
        </div>
      </div>
    </div>
  )
}
