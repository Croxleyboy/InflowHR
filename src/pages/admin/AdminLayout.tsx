import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useFeatures, type Features } from '../../context/FeatureContext'
import { AdminCompanyProvider, useAdminCompany } from '../../context/AdminCompanyContext'

interface MenuItem {
  path: string
  label: string
  icon: string
  end?: boolean
  superAdminOnly?: boolean
  feature?: keyof Features
}

const MENU_ITEMS: MenuItem[] = [
  { path: '/admin', label: 'Dashboard', icon: '📊', end: true },
  { path: '/admin/subscriptions', label: 'Subscriptions', icon: '📋', superAdminOnly: true },
  { path: '/admin/expenses', label: 'Expenses', icon: '💰', feature: 'expenses' },
  { path: '/admin/leave', label: 'Leave', icon: '🏖️', feature: 'leave' },
  { path: '/admin/payroll', label: 'Payroll', icon: '💷', feature: 'payslips' },
  { path: '/admin/employees', label: 'Employees', icon: '👥' },
  { path: '/admin/kudos', label: 'Kudos', icon: '⭐', feature: 'kudos' },
  { path: '/admin/elearning', label: 'E-Learning', icon: '📚', feature: 'elearning' },
  { path: '/admin/announcements', label: 'Announcements', icon: '📢' },
  { path: '/admin/onboarding', label: 'Onboarding', icon: '🚀' },
  { path: '/admin/tickets', label: 'HR Tickets', icon: '🎫' },
  { path: '/admin/benefits', label: 'Benefits', icon: '🎁', feature: 'benefits' },
  { path: '/admin/timesheets', label: 'Timesheets', icon: '⏱️', feature: 'timesheets' },
  { path: '/admin/performance', label: 'Performance', icon: '🎯', feature: 'performance' },
  { path: '/admin/shifts', label: 'Shifts & Rotas', icon: '🔄', feature: 'shifts' },
  { path: '/admin/legal-timesheets', label: 'Legal Timesheets', icon: '⚖️', feature: 'legal_timesheets' },
  { path: '/admin/space-management', label: 'Space Management', icon: '🏢', feature: 'space_booking' },
  { path: '/admin/notifications', label: 'Notifications', icon: '🔔' },
  { path: '/admin/billing', label: 'Billing', icon: '💳' },
]

function AdminLayoutInner() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const navigate = useNavigate()
  const { isSuperAdmin, employeeEmail, companyUser } = useAuth()
  const { features } = useFeatures()
  const { companies, selectedCompanyId, setSelectedCompanyId, selectedCompany, loading: companyLoading } = useAdminCompany()
  const visibleItems = MENU_ITEMS.filter(item =>
    (!item.superAdminOnly || isSuperAdmin) &&
    (!item.feature || isSuperAdmin || features[item.feature])
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

      <aside className={`admin-sidebar ${sidebarOpen ? 'admin-sidebar-open' : ''}`}>
        <nav className="admin-nav">
          {visibleItems.map(item => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.end}
              className={({ isActive }) => `admin-nav-item ${isActive ? 'admin-nav-active' : ''}`}
              onClick={() => setSidebarOpen(false)}
            >
              <span className="admin-nav-icon">{item.icon}</span>
              <span className="admin-nav-label">{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="admin-main">
        {companyLoading ? <div className="admin-loading">Loading...</div> : <Outlet />}
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
