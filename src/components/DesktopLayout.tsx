import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { useFeatures, type Features } from '../context/FeatureContext'
import { useNotificationBadge } from '../hooks/useNotificationBadge'

export default function DesktopLayout() {
  const { t } = useLanguage()
  const { signOut, employeeName, employeeEmail, company, companyUser, avatarUrl, portalRole, employmentCategory, isSuperAdmin } = useAuth()
  const { dark, toggle } = useTheme()
  const { features } = useFeatures()
  const navigate = useNavigate()
  const badgeCount = useNotificationBadge()
  const initials = employeeName.split(' ').map(n => n[0]).join('').toUpperCase() || '?'
  const isAdmin = companyUser && ['admin', 'hr'].includes(companyUser.role)
  const hasPortalAccess = isAdmin || !!portalRole
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('inflowhr-sidebar-collapsed') === '1' } catch { return false }
  })

  function toggleSidebarCollapse() {
    setSidebarCollapsed(prev => {
      const next = !prev
      try { localStorage.setItem('inflowhr-sidebar-collapsed', next ? '1' : '0') } catch { /* */ }
      return next
    })
  }

  const isShiftWorker = employmentCategory === 'shift_worker'
  const allNavItems: { to: string; icon: string; label: string; end?: boolean; badge?: number; feature?: keyof Features; pattern?: 'fixed' | 'variable' }[] = [
    { to: '/', icon: 'home', label: t('footer.dashboard'), end: true },
    { to: '/expenses', icon: 'expenses', label: t('dashboard.expenses'), feature: 'expenses' },
    { to: '/leave', icon: 'leave', label: t('footer.time_off'), feature: 'leave' },
    { to: '/timesheets', icon: 'timesheets', label: t('dashboard.timesheets'), feature: 'timesheets', pattern: 'fixed' },
    { to: '/payslips', icon: 'payslips', label: t('dashboard.payslips'), feature: 'payslips' },
    { to: '/kudos', icon: 'kudos', label: t('dashboard.kudos'), feature: 'kudos' },
    { to: '/benefits', icon: 'benefits', label: t('dashboard.benefits'), feature: 'benefits' },
    { to: '/elearning', icon: 'elearning', label: t('dashboard.elearning'), feature: 'elearning' },
    { to: '/shifts', icon: 'shifts', label: t('dashboard.shifts'), feature: 'shifts', pattern: 'variable' },
    { to: '/legal-timesheets', icon: 'timesheets', label: t('dashboard.legal_timesheets'), feature: 'legal_timesheets', pattern: 'fixed' },
    { to: '/space-booking', icon: 'space_booking', label: t('dashboard.space_booking'), feature: 'space_booking' },
    { to: '/surveys', icon: 'surveys', label: 'Surveys', feature: 'surveys' },
    { to: '/my-profile', icon: 'profile', label: t('dashboard.my_profile'), feature: 'profile' },
    { to: '/directory', icon: 'directory', label: `${t('directory.title')} ${t('directory.title_accent')}` },
    { to: '/one-to-ones', icon: 'one-to-ones', label: t('one_to_one.nav_label'), feature: 'performance' as keyof Features },
    { to: '/notifications', icon: 'notifications', label: t('footer.notifications'), badge: badgeCount },
    { to: '/settings', icon: 'settings', label: t('footer.settings') },
  ]
  const navItems = allNavItems.filter(item => {
    if (item.feature && !features[item.feature]) return false
    if (!isSuperAdmin && item.pattern === 'variable' && !isShiftWorker) return false
    if (!isSuperAdmin && item.pattern === 'fixed' && isShiftWorker) return false
    return true
  })

  function renderIcon(icon: string) {
    switch (icon) {
      case 'home':
        return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
      case 'expenses':
        return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
      case 'leave':
        return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
      case 'timesheets':
        return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
      case 'payslips':
        return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
      case 'kudos':
        return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z" /><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" /></svg>
      case 'benefits':
        return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>
      case 'elearning':
        return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></svg>
      case 'profile':
        return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
      case 'directory':
        return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
      case 'notifications':
        return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
      case 'one-to-ones':
        return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
      case 'shifts':
        return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /><line x1="2" y1="11" x2="22" y2="11" /></svg>
      case 'space_booking':
        return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="3" rx="1"/><path d="M4 10v7"/><path d="M20 10v7"/><path d="M12 10v4"/></svg>
      case 'surveys':
        return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
      case 'settings':
        return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
      default:
        return null
    }
  }

  return (
    <div className="desktop-shell">
      <aside className={`desktop-sidebar ${sidebarCollapsed ? 'desktop-sidebar-collapsed' : ''}`}>
        <div className="desktop-sidebar-brand" onClick={() => navigate('/')}>
          {company?.logo_url ? (
            <img className="desktop-brand-logo" src={company.logo_url} alt={company.name} />
          ) : (
            <span className="desktop-brand-text">{sidebarCollapsed ? 'I' : 'InflowHR'}</span>
          )}
          {!sidebarCollapsed && company?.name && <span className="desktop-brand-company">{company.name}</span>}
        </div>

        {!sidebarCollapsed && (
          <div className="desktop-sidebar-profile">
            {avatarUrl ? (
              <img className="desktop-profile-avatar-img" src={avatarUrl} alt={initials} />
            ) : (
              <div className="desktop-profile-avatar">{initials}</div>
            )}
            <div className="desktop-profile-info">
              <span className="desktop-profile-name">{employeeName}</span>
              <span className="desktop-profile-email">{employeeEmail}</span>
            </div>
          </div>
        )}

        <nav className="desktop-nav">
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `desktop-nav-item ${isActive ? 'desktop-nav-active' : ''}`}
              title={sidebarCollapsed ? item.label : undefined}
            >
              <span className="desktop-nav-icon">{renderIcon(item.icon)}</span>
              {!sidebarCollapsed && <span className="desktop-nav-label">{item.label}</span>}
              {item.badge && item.badge > 0 ? (
                <span className={`desktop-nav-badge ${sidebarCollapsed ? 'desktop-nav-badge-collapsed' : ''}`}>{item.badge}</span>
              ) : null}
            </NavLink>
          ))}
        </nav>

        <div className="desktop-sidebar-footer">
          <button className="desktop-sidebar-toggle" onClick={toggleSidebarCollapse} title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: sidebarCollapsed ? 'rotate(180deg)' : undefined, transition: 'transform 0.2s' }}>
              <polyline points="11 17 6 12 11 7" /><polyline points="18 17 13 12 18 7" />
            </svg>
            {!sidebarCollapsed && <span>Collapse</span>}
          </button>
          {hasPortalAccess && (
            <button className="desktop-admin-btn" onClick={() => navigate('/admin')} title={sidebarCollapsed ? 'Admin Portal' : undefined}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              {!sidebarCollapsed && 'Admin Portal'}
            </button>
          )}
          <div className="desktop-sidebar-actions">
            <button className="desktop-action-btn" onClick={toggle} title={dark ? 'Light mode' : 'Dark mode'}>
              {dark ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="5" /><g stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></g></svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
              )}
            </button>
            <button className="desktop-action-btn desktop-signout-btn" onClick={signOut} title="Sign out">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              {!sidebarCollapsed && 'Sign out'}
            </button>
          </div>
        </div>
      </aside>

      <main className="desktop-main">
        <div className="desktop-content">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
