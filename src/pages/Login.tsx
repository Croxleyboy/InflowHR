import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'

export default function Login() {
  const { signInWithMicrosoft, signInWithGoogle, signInWithPassword } = useAuth()
  const { t } = useLanguage()

  const [loginMode, setLoginMode] = useState<'sso' | 'account' | 'guest'>('sso')
  const [showBreakGlass, setShowBreakGlass] = useState(false)
  const [bgEmail, setBgEmail] = useState('')
  const [bgPassword, setBgPassword] = useState('')
  const [bgError, setBgError] = useState('')
  const [bgLoading, setBgLoading] = useState(false)
  const [guestEmail, setGuestEmail] = useState('')
  const [guestOtp, setGuestOtp] = useState('')
  const [guestError, setGuestError] = useState('')
  const [guestLoading, setGuestLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

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

  async function handleGuestLogin(e: React.FormEvent) {
    e.preventDefault()
    if (!guestEmail || !guestOtp) return
    setGuestLoading(true)
    setGuestError('')
    const err = await signInWithPassword(guestEmail.trim().toLowerCase(), guestOtp.trim().toUpperCase())
    if (err) setGuestError('Invalid email or passcode. Please check your details and try again.')
    setGuestLoading(false)
  }

  return (
    <div className="login-page">
      <span className="login-build">{__BUILD_NUMBER__}</span>

      {/* ── Hero Side ── */}
      <div className="login-hero">
        <div className="login-hero-content">
          <div className="login-hero-brand">
            <img src="/inflowhr-logo-alt.svg" alt="InflowHR" className="login-hero-logo-img" />
          </div>
          <h1 className="login-hero-headline">Seamless Workforce<br />&amp; HR Management</h1>
          <p className="login-hero-tagline">{t('login.hero_tagline')}</p>

          <div className="login-hero-pills">
            <div className="login-hero-pill">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              {t('login.feature_directory')}
            </div>
            <div className="login-hero-pill">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
              {t('login.feature_payslips')}
            </div>
            <div className="login-hero-pill">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              {t('login.feature_leave')}
            </div>
            <div className="login-hero-pill">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
              Automated JML Workflows
            </div>
            <div className="login-hero-pill">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              Payroll &amp; Compliance Ready
            </div>
            <div className="login-hero-pill">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
              E-Learning &amp; Development
            </div>
          </div>
        </div>

        <div className="login-hero-decoration">
          <div className="login-hero-orb login-hero-orb-1"></div>
          <div className="login-hero-orb login-hero-orb-2"></div>
          <div className="login-hero-orb login-hero-orb-3"></div>
          <div className="login-hero-grid"></div>
        </div>
      </div>

      {/* ── Login Panel ── */}
      <div className="login-form-side">
        <div className="login-card">
          <div className="login-welcome">
            <h1 className="login-title">Welcome to <span className="login-title-brand">InflowHR</span></h1>
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
            <button
              className={`login-mode-tab ${loginMode === 'guest' ? 'login-mode-tab-active' : ''}`}
              onClick={() => { setLoginMode('guest'); setGuestError('') }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
              Guest Access
            </button>
          </div>

          {loginMode === 'guest' ? (
            <>
              <form className="login-account-form" onSubmit={handleGuestLogin}>
                <p className="login-account-info">
                  Enter the email address and one-time passcode provided by your company administrator.
                </p>
                <div className="login-input-group">
                  <input
                    type="email"
                    className="login-account-input"
                    placeholder=" "
                    value={guestEmail}
                    onChange={e => setGuestEmail(e.target.value)}
                    autoComplete="email"
                    id="guest-email"
                  />
                  <label htmlFor="guest-email" className="login-input-label">Email Address</label>
                </div>
                <div className="login-input-group">
                  <input
                    type="text"
                    className="login-account-input"
                    placeholder=" "
                    value={guestOtp}
                    onChange={e => setGuestOtp(e.target.value.toUpperCase())}
                    autoComplete="one-time-code"
                    style={{ letterSpacing: '0.15em', fontFamily: 'monospace' }}
                    id="guest-otp"
                  />
                  <label htmlFor="guest-otp" className="login-input-label">One-Time Passcode</label>
                </div>
                {guestError && <p className="login-account-error">{guestError}</p>}
                <button
                  type="submit"
                  className="login-primary-btn"
                  disabled={guestLoading || !guestEmail || !guestOtp}
                >
                  {guestLoading ? (
                    <span className="login-btn-loading"><span className="login-spinner"></span> Verifying...</span>
                  ) : 'Sign In as Guest'}
                </button>
              </form>

              <div className="login-trust-badges" style={{ marginTop: 24 }}>
                <div className="login-trust-badge">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  <span>48-hour access window</span>
                </div>
                <div className="login-trust-badge">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  <span>View-only access</span>
                </div>
              </div>
            </>
          ) : loginMode === 'sso' ? (
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
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                  <span>{t('login.badge_sso')}</span>
                </div>
                <div className="login-trust-badge">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                  <span>{t('login.badge_encrypted')}</span>
                </div>
                <div className="login-trust-badge">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
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
                <div className="login-input-group">
                  <input
                    type="email"
                    className="login-account-input"
                    placeholder=" "
                    value={bgEmail}
                    onChange={e => setBgEmail(e.target.value)}
                    autoComplete="username"
                    id="account-email"
                  />
                  <label htmlFor="account-email" className="login-input-label">Username / Email</label>
                </div>
                <div className="login-input-group">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className="login-account-input"
                    placeholder=" "
                    value={bgPassword}
                    onChange={e => setBgPassword(e.target.value)}
                    autoComplete="current-password"
                    id="account-password"
                  />
                  <label htmlFor="account-password" className="login-input-label">Password</label>
                  <button
                    type="button"
                    className="login-password-toggle"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    )}
                  </button>
                </div>
                {bgError && <p className="login-account-error">{bgError}</p>}
                <button
                  type="submit"
                  className="login-primary-btn"
                  disabled={bgLoading || !bgEmail || !bgPassword}
                >
                  {bgLoading ? (
                    <span className="login-btn-loading"><span className="login-spinner"></span> Signing in...</span>
                  ) : 'Sign In to InflowHR'}
                </button>
              </form>

              <div className="login-trust-badges" style={{ marginTop: 24 }}>
                <div className="login-trust-badge">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                  <span>{t('login.badge_encrypted')}</span>
                </div>
                <div className="login-trust-badge">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
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

          <div className="login-footer-links">
            <Link to="/trial" className="login-footer-link">Try for Free</Link>
            <span className="login-footer-sep">·</span>
            <Link to="/privacy" className="login-footer-link">Privacy Policy</Link>
            <span className="login-footer-sep">·</span>
            <a href="https://inflowhr.com/help" target="_blank" rel="noopener noreferrer" className="login-footer-link">Help Centre</a>
          </div>

          <p className="login-copyright">© {new Date().getFullYear()} InflowHR. All rights reserved.</p>
        </div>
      </div>
    </div>
  )
}
