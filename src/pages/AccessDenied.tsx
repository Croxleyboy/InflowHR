import { useAuth } from '../context/AuthContext'

export default function AccessDenied() {
  const { signOut, employeeEmail } = useAuth()

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <rect width="48" height="48" rx="12" fill="#c62828" />
            <text x="24" y="32" textAnchor="middle" fill="#fff" fontSize="24" fontWeight="800" fontFamily="sans-serif">!</text>
          </svg>
        </div>
        <h1 className="login-title" style={{ color: '#c62828' }}>Access Denied</h1>
        <p className="login-subtitle">
          Your organisation (<strong>{employeeEmail.split('@')[1]}</strong>) has not been registered for InflowHR.
        </p>
        <p className="login-subtitle" style={{ fontSize: 13 }}>
          Please contact your HR administrator to request access.
        </p>
        <button className="login-microsoft-btn" onClick={signOut}>
          Sign out and try a different account
        </button>
      </div>
    </div>
  )
}
