import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'

export default function Login() {
  const { signInWithMicrosoft, signInWithGoogle, signInWithPassword } = useAuth()
  const { t } = useLanguage()

  const [loginMode, setLoginMode] = useState<'sso' | 'account'>('sso')
  const [showBreakGlass, setShowBreakGlass] = useState(false)
  const [bgEmail, setBgEmail] = useState('')
  const [bgPassword, setBgPassword] = useState('')
  const [bgError, setBgError] = useState('')
  const [bgLoading, setBgLoading] = useState(false)

  async function handleAccountLogin(e: React.FormEvent) {
    e.preventDefault()
    if (!bgEmail || !bgPassword) return
    setBgLoading(true)
    setBgError('')
    const err = await signInWithPassword(bgEmail.trim(), bgPassword)
    if (err) setBgError(err)
    setBgLoading(false)
  }

  async function handleBreakGlass(e: React.FormEvent) {
    e.preventDefault()
    if (!bgEmail || !bgPassword) return
    setBgLoading(true)
    setBgError('')
    const err = await signInWithPassword(bgEmail.trim(), bgPassword)
    if (err) setBgError(err)
    setBgLoading(false)
  }

  return (
    <div className="login-page">
      <span className="login-build">{__BUILD_NUMBER__}</span>
      <div className="login-hero">
        <div className="login-hero-content">
          <div className="login-hero-logo">
            <img src="/inflowhr-logo-alt.svg" alt="InflowHR" className="login-hero-logo-img" />
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

          <div className="login-mode-tabs">
            <button
              className={`login-mode-tab ${loginMode === 'sso' ? 'login-mode-tab-active' : ''}`}
              onClick={() => { setLoginMode('sso'); setBgError('') }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              SSO Login
            </button>
            <button
              className={`login-mode-tab ${loginMode === 'account' ? 'login-mode-tab-active' : ''}`}
              onClick={() => { setLoginMode('account'); setBgError('') }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              Account Login
            </button>
          </div>

          {loginMode === 'sso' ? (
            <>
              <div className="login-sso-buttons">
                <button className="login-microsoft-btn" onClick={signInWithMicrosoft}>
                  <svg width="20" height="20" viewBox="0 0 21 21">
                    <rect x="1" y="1" width="9" height="9" fill="#f25022" />
                    <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
                    <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
                    <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
                  </svg>
                  {t('login.sign_in_microsoft')}
                </button>
                <button className="login-google-btn" onClick={signInWithGoogle}>
                  <svg width="20" height="20" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A11.96 11.96 0 0 0 1 12c0 1.93.46 3.77 1.18 5.42l3.66-2.84z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  Sign in with Google
                </button>
              </div>

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
            </>
          ) : (
            <>
              <form className="login-account-form" onSubmit={handleAccountLogin}>
                <p className="login-account-info">
                  Sign in with your company account credentials provided by your administrator.
                </p>
                <input
                  type="email"
                  className="login-account-input"
                  placeholder="Username / Email"
                  value={bgEmail}
                  onChange={e => setBgEmail(e.target.value)}
                  autoComplete="username"
                />
                <input
                  type="password"
                  className="login-account-input"
                  placeholder="Password"
                  value={bgPassword}
                  onChange={e => setBgPassword(e.target.value)}
                  autoComplete="current-password"
                />
                {bgError && <p className="login-account-error">{bgError}</p>}
                <button
                  type="submit"
                  className="login-account-btn"
                  disabled={bgLoading || !bgEmail || !bgPassword}
                >
                  {bgLoading ? 'Signing in...' : 'Sign In'}
                </button>
              </form>

              <div className="login-trust-badges" style={{ marginTop: 24 }}>
                <div className="login-trust-badge">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                  <span>{t('login.badge_encrypted')}</span>
                </div>
                <div className="login-trust-badge">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                  <span>{t('login.badge_gdpr')}</span>
                </div>
              </div>
            </>
          )}

          <button
            className="login-breakglass-toggle"
            onClick={() => setShowBreakGlass(!showBreakGlass)}
          >
            {showBreakGlass ? 'Hide' : 'Emergency Access'}
          </button>

          {showBreakGlass && (
            <form className="login-breakglass-form" onSubmit={handleBreakGlass}>
              <p className="login-breakglass-warning">Break glass access — authorised personnel only</p>
              <input
                type="email"
                className="login-breakglass-input"
                placeholder="Email"
                value={bgEmail}
                onChange={e => setBgEmail(e.target.value)}
                autoComplete="username"
              />
              <input
                type="password"
                className="login-breakglass-input"
                placeholder="Password"
                value={bgPassword}
                onChange={e => setBgPassword(e.target.value)}
                autoComplete="current-password"
              />
              {bgError && <p className="login-breakglass-error">{bgError}</p>}
              <button
                type="submit"
                className="login-breakglass-btn"
                disabled={bgLoading || !bgEmail || !bgPassword}
              >
                {bgLoading ? 'Signing in...' : 'Sign In'}
              </button>
            </form>
          )}

          <Link to="/trial" className="login-trial-link">Try for Free — 14 Day Trial</Link>
          <Link to="/privacy" className="login-privacy-link">Privacy Notice</Link>
        </div>
      </div>
    </div>
  )
}
