import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function DesktopLayout() {
  const { t } = useLanguage()
  const { signOut, employeeName, employeeEmail, employeeId, company, companyUser, avatarUrl } = useAuth()
  const { dark, toggle } = useTheme()
  const navigate = useNavigate()
  const [badgeCount, setBadgeCount] = useState(0)
  const [isManager, setIsManager] = useState(false)
  const initials = employeeName.split(' ').map(n => n[0]).join('').toUpperCase() || '?'
  const isAdmin = companyUser && ['admin', 'hr'].includes(companyUser.role)

  useEffect(() => {
    if (employeeEmail && companyUser?.company_id) {
      supabase.from('workflow_tracker')
        .select('id', { count: 'exact', head: true })
        .ilike('assigned_to', `%${employeeEmail}%`)
        .eq('status', 'Pending')
        .eq('company_id', companyUser.company_id)
        .then(({ count }) => setBadgeCount(count || 0))
    }
    if (employeeId && companyUser?.company_id) {
      supabase.from('employees')
        .select('id', { count: 'exact', head: true })
        .eq('manager_id', employeeId)
        .eq('is_active', true)
        .eq('company_id', companyUser.company_id)
        .then(({ count }) => setIsManager((count || 0) > 0))
    }
  }, [employeeEmail, employeeId, companyUser?.company_id])

  const navItems = [
    { to: '/', icon: 'home', label: t('footer.dashboard'), end: true },
    { to: '/expenses', icon: 'expenses', label: t('dashboard.expenses') },
    { to: '/leave', icon: 'leave', label: t('footer.time_off') },
    { to: '/timesheets', icon: 'timesheets', label: t('dashboard.timesheets') },
    { to: '/payslips', icon: 'payslips', label: t('dashboard.payslips') },
    { to: '/kudos', icon: 'kudos', label: t('dashboard.kudos') },
    { to: '/benefits', icon: 'benefits', label: t('dashboard.benefits') },
    { to: '/elearning', icon: 'elearning', label: t('dashboard.elearning') },
    { to: '/my-profile', icon: 'profile', label: t('dashboard.my_profile') },
    { to: '/directory', icon: 'directory', label: `${t('directory.title')} ${t('directory.title_accent')}` },
    ...(isManager ? [{ to: '/one-to-ones', icon: 'one-to-ones', label: t('one_to_one.nav_label') }] : []),
    { to: '/notifications', icon: 'notifications', label: t('footer.notifications'), badge: badgeCount },
    { to: '/settings', icon: 'settings', label: t('footer.settings') },
  ]

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
      case 'settings':
        return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
      default:
        return null
    }
  }

  return (
    <div className="desktop-shell">
      <aside className="desktop-sidebar">
        <div className="desktop-sidebar-brand" onClick={() => navigate('/')}>
          {company?.logo_url ? (
            <img className="desktop-brand-logo" src={company.logo_url} alt={company.name} />
          ) : (
            <span className="desktop-brand-text">InflowHR</span>
          )}
          {company?.name && <span className="desktop-brand-company">{company.name}</span>}
        </div>

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

        <nav className="desktop-nav">
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `desktop-nav-item ${isActive ? 'desktop-nav-active' : ''}`}
            >
              <span className="desktop-nav-icon">{renderIcon(item.icon)}</span>
              <span className="desktop-nav-label">{item.label}</span>
              {item.badge && item.badge > 0 ? (
                <span className="desktop-nav-badge">{item.badge}</span>
              ) : null}
            </NavLink>
          ))}
        </nav>

        <div className="desktop-sidebar-footer">
          {isAdmin && (
            <button className="desktop-admin-btn" onClick={() => navigate('/admin')}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              Admin Portal
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
              Sign out
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
