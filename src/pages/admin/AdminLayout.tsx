import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'

const MENU_ITEMS = [
  { path: '/admin', label: 'Dashboard', icon: '📊', end: true },
  { path: '/admin/expenses', label: 'Expenses', icon: '💰' },
  { path: '/admin/leave', label: 'Leave', icon: '🏖️' },
  { path: '/admin/payroll', label: 'Payroll', icon: '💷' },
  { path: '/admin/employees', label: 'Employees', icon: '👥' },
  { path: '/admin/kudos', label: 'Kudos', icon: '⭐' },
  { path: '/admin/elearning', label: 'E-Learning', icon: '📚' },
  { path: '/admin/announcements', label: 'Announcements', icon: '📢' },
  { path: '/admin/onboarding', label: 'Onboarding', icon: '🚀' },
  { path: '/admin/tickets', label: 'HR Tickets', icon: '🎫' },
  { path: '/admin/benefits', label: 'Benefits', icon: '🎁' },
]

export default function AdminLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const navigate = useNavigate()

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
          {MENU_ITEMS.map(item => (
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
        <Outlet />
      </main>
    </div>
  )
}
