import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'

export default function Login() {
  const { signInWithMicrosoft } = useAuth()
  const { t } = useLanguage()

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <rect width="48" height="48" rx="12" fill="#1e1e2d" />
            <text x="24" y="32" textAnchor="middle" fill="#fff" fontSize="22" fontWeight="800" fontFamily="sans-serif">iH</text>
          </svg>
        </div>
        <h1 className="login-title">{t('login.title')}</h1>
        <p className="login-subtitle">{t('login.subtitle')}</p>

        <button className="login-microsoft-btn" onClick={signInWithMicrosoft}>
          <svg width="20" height="20" viewBox="0 0 21 21">
            <rect x="1" y="1" width="9" height="9" fill="#f25022" />
            <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
            <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
            <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
          </svg>
          {t('login.sign_in_microsoft')}
        </button>

        <p className="login-footer">{t('login.footer')}</p>
      </div>
    </div>
  )
}
