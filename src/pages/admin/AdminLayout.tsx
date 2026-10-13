import { useState } from 'react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useFeatures, type Features } from '../../context/FeatureContext'
import { AdminCompanyProvider, useAdminCompany } from '../../context/AdminCompanyContext'

interface MenuItem {
  path: string
  label: string
  svg: string
  end?: boolean
  superAdminOnly?: boolean
  feature?: keyof Features
  permKey?: string
}

interface MenuGroup {
  label: string
  svg: string
  items: MenuItem[]
}

const MENU_GROUPS: (MenuItem | MenuGroup)[] = [
  { path: '/admin', label: 'Dashboard', svg: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>', end: true },
  { path: '/admin/getting-setup', label: 'Getting Setup', svg: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>' },
  {
    label: 'Super Admin',
    svg: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    items: [
      { path: '/admin/subscriptions', label: 'Subscriptions', svg: '<rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/>', superAdminOnly: true },
      { path: '/admin/cancellations', label: 'Cancellations', svg: '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>', superAdminOnly: true },
      { path: '/admin/teams-test', label: 'Integration Tests', svg: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>', superAdminOnly: true },
      { path: '/admin/xero-test', label: 'Xero API Test', svg: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>', superAdminOnly: true },
    ],
  },
  {
    label: 'People',
    svg: '<circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/>',
    items: [
      { path: '/admin/employees', label: 'Employees', svg: '<circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><path d="M17 11a4 4 0 1 0 0-8"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/>', permKey: 'employees' },
      { path: '/admin/onboarding', label: 'Onboard / Offboard', svg: '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/>', permKey: 'onboarding' },
      { path: '/admin/tickets', label: 'HR Tickets', svg: '<path d="M2 9V7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v2"/><path d="M22 15v2a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-2"/><path d="M2 10a2 2 0 0 1 0 4"/><path d="M22 10a2 2 0 0 0 0 4"/>', permKey: 'tickets' },
    ],
  },
  {
    label: 'Time & Attendance',
    svg: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    items: [
      { path: '/admin/leave', label: 'Leave', svg: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>', feature: 'leave', permKey: 'leave' },
      { path: '/admin/timesheets', label: 'Timesheets', svg: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>', feature: 'timesheets', permKey: 'timesheets' },
      { path: '/admin/shifts', label: 'Shifts & Rotas', svg: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>', feature: 'shifts', permKey: 'shifts' },
      { path: '/admin/legal-timesheets', label: 'Legal Timesheets', svg: '<path d="M12 3v18"/><path d="M6 6l6 3 6-3"/><path d="M4 10l4 10h-8z" transform="translate(0)"/><path d="M16 10l4 10h-8z"/>', feature: 'legal_timesheets', permKey: 'legal_timesheets' },
    ],
  },
  {
    label: 'Pay & Finance',
    svg: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
    items: [
      { path: '/admin/payroll', label: 'Payroll', svg: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 12h.01M18 12h.01"/>', feature: 'payslips', permKey: 'payroll' },
      { path: '/admin/expenses', label: 'Expenses', svg: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>', feature: 'expenses', permKey: 'expenses' },
      { path: '/admin/billing', label: 'Billing', svg: '<rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>', permKey: 'billing' },
    ],
  },
  {
    label: 'Engagement',
    svg: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    items: [
      { path: '/admin/kudos', label: 'Kudos', svg: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>', feature: 'kudos', permKey: 'kudos' },
      { path: '/admin/announcements', label: 'Announcements', svg: '<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>', permKey: 'announcements' },
      { path: '/admin/surveys', label: 'Surveys & Feedback', svg: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>', feature: 'surveys', permKey: 'surveys' },
    ],
  },
  {
    label: 'Learning & Growth',
    svg: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
    items: [
      { path: '/admin/elearning', label: 'E-Learning', svg: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>', feature: 'elearning', permKey: 'elearning' },
      { path: '/admin/performance', label: 'Performance', svg: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>', feature: 'performance', permKey: 'performance' },
      { path: '/admin/talent-intelligence', label: 'Talent Intelligence', svg: '<path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-2.04Z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-2.04Z"/>', feature: 'skills_passport', permKey: 'talent_intelligence' },
    ],
  },
  {
    label: 'Workplace',
    svg: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>',
    items: [
      { path: '/admin/space-management', label: 'Space Management', svg: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>', feature: 'space_booking', permKey: 'space_management' },
      { path: '/admin/assets', label: 'Asset Management', svg: '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>', feature: 'asset_management', permKey: 'assets' },
      { path: '/admin/benefits', label: 'Benefits', svg: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>', feature: 'benefits', permKey: 'benefits' },
    ],
  },
  {
    label: 'Settings',
    svg: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    items: [
      { path: '/admin/reports', label: 'Reports', svg: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>', permKey: 'reports' },
      { path: '/admin/integrations', label: 'Integrations', svg: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>', permKey: 'integrations' },
      { path: '/admin/access', label: 'Access', svg: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>', permKey: 'access' },
      { path: '/admin/notifications', label: 'Notifications', svg: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>', permKey: 'notifications' },
      { path: '/admin/user-guides', label: 'User Guides', svg: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>', permKey: 'user_guides' },
    ],
  },
]

function isGroup(entry: MenuItem | MenuGroup): entry is MenuGroup {
  return 'items' in entry
}

function AdminLayoutInner() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set())
  const navigate = useNavigate()
  const location = useLocation()
  const { isSuperAdmin, employeeEmail, companyUser, portalRole, portalPermissions } = useAuth()
  const { features } = useFeatures()
  const { companies, selectedCompanyId, setSelectedCompanyId, selectedCompany } = useAdminCompany()

  const isFullAccess = isSuperAdmin || companyUser?.role === 'admin' || portalRole === 'company_admin'

  const isItemVisible = (item: MenuItem) => {
    if (item.superAdminOnly && !isSuperAdmin) return false
    if (item.feature && !isSuperAdmin && !features[item.feature]) return false
    if (item.permKey && !isFullAccess && portalPermissions && portalPermissions[item.permKey] === false) return false
    return true
  }

  const toggleGroup = (label: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }

  const isPathActive = (path: string, end?: boolean) => {
    if (end) return location.pathname === path
    return location.pathname === path || location.pathname.startsWith(path + '/')
  }

  const renderNavItem = (item: MenuItem, indent?: boolean) => (
    <NavLink
      key={item.path}
      to={item.path}
      end={item.end}
      className={({ isActive }) => `admin-nav-item ${indent ? 'admin-nav-item-indent' : ''} ${isActive ? 'admin-nav-active' : ''}`}
      onClick={() => setSidebarOpen(false)}
      title={sidebarCollapsed ? item.label : undefined}
    >
      <span className="admin-nav-icon">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: item.svg }} />
      </span>
      <span className="admin-nav-label">{item.label}</span>
    </NavLink>
  )

  return (
    <div className="admin-shell">
      <header className="admin-topbar">
        <button className="admin-burger" onClick={() => setSidebarOpen(!sidebarOpen)}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {sidebarOpen
              ? <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>
              : <><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></>
            }
          </svg>
        </button>
        <h1 className="admin-topbar-title">
          <span className="admin-topbar-logo">InflowHR</span>
          <span className="admin-topbar-subtitle">Admin Portal</span>
        </h1>

        {isSuperAdmin && companies.length > 1 && (
          <div className="admin-company-selector">
            <select
              value={selectedCompanyId}
              onChange={e => setSelectedCompanyId(e.target.value)}
              className="admin-company-select"
            >
              {companies.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name} {!c.is_active ? '(Inactive)' : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {!isSuperAdmin && selectedCompany && (
          <span className="admin-company-label">{selectedCompany.name}</span>
        )}

        <div className="admin-topbar-user">
          <span className="admin-topbar-role">{isSuperAdmin ? 'Super Admin' : companyUser?.role === 'admin' ? 'Company Admin' : 'Admin'}</span>
          <span className="admin-topbar-email">{employeeEmail}</span>
        </div>

        <button className="admin-topbar-exit" onClick={() => navigate('/')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          <span>Exit</span>
        </button>
      </header>

      {sidebarOpen && <div className="admin-overlay" onClick={() => setSidebarOpen(false)} />}

      <aside className={`admin-sidebar ${sidebarOpen ? 'admin-sidebar-open' : ''} ${sidebarCollapsed ? 'admin-sidebar-collapsed' : ''}`}>
        <nav className="admin-nav">
          {MENU_GROUPS.map(entry => {
            if (isGroup(entry)) {
              const visibleItems = entry.items.filter(isItemVisible)
              if (visibleItems.length === 0) return null
              const expanded = expandedGroups.has(entry.label)
              const hasActiveChild = visibleItems.some(item => isPathActive(item.path, item.end))
              return (
                <div key={entry.label} className="admin-nav-group">
                  <button
                    className={`admin-nav-group-header ${hasActiveChild ? 'admin-nav-group-active' : ''}`}
                    onClick={() => toggleGroup(entry.label)}
                    title={sidebarCollapsed ? entry.label : undefined}
                  >
                    <span className="admin-nav-icon">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: entry.svg }} />
                    </span>
                    <span className="admin-nav-label">{entry.label}</span>
                    <svg className={`admin-nav-chevron ${expanded ? 'admin-nav-chevron-open' : ''}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                  {expanded && (
                    <div className="admin-nav-group-items">
                      {visibleItems.map(item => renderNavItem(item, true))}
                    </div>
                  )}
                </div>
              )
            }
            if (!isItemVisible(entry)) return null
            return renderNavItem(entry)
          })}
        </nav>
        <button
          className="admin-need-help"
          onClick={() => { navigate('/admin/tickets'); setSidebarOpen(false) }}
          title="Need help?"
        >
          <span className="admin-need-help-inner">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <span className="admin-need-help-label">Need Help?</span>
          </span>
        </button>
        <button
          className="admin-sidebar-toggle"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          title={sidebarCollapsed ? 'Expand menu' : 'Collapse menu'}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {sidebarCollapsed
              ? <polyline points="9 18 15 12 9 6" />
              : <polyline points="15 18 9 12 15 6" />
            }
          </svg>
        </button>
      </aside>

      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  )
}

export default function AdminLayout() {
  return (
    <AdminCompanyProvider>
      <AdminLayoutInner />
    </AdminCompanyProvider>
  )
}
