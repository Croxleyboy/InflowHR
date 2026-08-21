import { useAuth } from '../context/AuthContext'

export default function AccessDenied() {
  const { signOut, employeeEmail, company } = useAuth()

  const isLoginDisabled = company?.login_disabled === true
  const isTrialExpired = company?.trial_expired === true

  const trialEndFormatted = company?.trial_end_date
    ? new Date(company.trial_end_date).toLocaleDateString('en-GB')
    : ''

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <rect width="48" height="48" rx="12" fill={isTrialExpired ? '#e65100' : '#c62828'} />
            <text x="24" y="32" textAnchor="middle" fill="#fff" fontSize="24" fontWeight="800" fontFamily="sans-serif">
              {isTrialExpired ? '⏱' : '!'}
            </text>
          </svg>
        </div>
        <h1 className="login-title" style={{ color: isTrialExpired ? '#e65100' : '#c62828' }}>
          {isTrialExpired ? 'Trial Expired' : isLoginDisabled ? 'Login Disabled' : 'Access Denied'}
        </h1>
        {isTrialExpired ? (
          <>
            <p className="login-subtitle">
              The trial period for <strong>{company?.name || 'your organisation'}</strong> expired on <strong>{trialEndFormatted}</strong>.
            </p>
            <p className="login-subtitle" style={{ fontSize: 13 }}>
              Please contact your InflowHR account manager to extend your trial or upgrade to a full subscription.
            </p>
            <p className="login-subtitle" style={{ fontSize: 13, marginTop: 8 }}>
              <a href="mailto:support@inflowhr.com" style={{ color: '#1565c0' }}>support@inflowhr.com</a>
            </p>
          </>
        ) : isLoginDisabled ? (
          <>
            <p className="login-subtitle">
              Login for <strong>{company?.name || employeeEmail.split('@')[1]}</strong> has been temporarily disabled by your administrator.
            </p>
            <p className="login-subtitle" style={{ fontSize: 13 }}>
              Please contact your HR administrator for more information.
            </p>
          </>
        ) : (
          <>
            <p className="login-subtitle">
              Your organisation (<strong>{employeeEmail.split('@')[1]}</strong>) has not been registered for InflowHR.
            </p>
            <p className="login-subtitle" style={{ fontSize: 13 }}>
              Please contact your HR administrator to request access.
            </p>
          </>
        )}
        <button className="login-microsoft-btn" onClick={signOut}>
          Sign out and try a different account
        </button>
      </div>
    </div>
  )
}
