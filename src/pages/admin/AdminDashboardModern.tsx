import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { useFeatures, type Features } from '../../context/FeatureContext'

interface QuickStat {
  label: string
  value: number | string
  delta?: string
  deltaUp?: boolean
  color: string
  path: string
  icon: string
}

interface RecentActivity {
  id: string
  type: string
  description: string
  time: string
  icon: string
}

interface NavItem {
  label: string
  icon: string
  path: string
  color: string
  bg: string
  feature?: keyof Features
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Directory', icon: '👥', path: '/admin/employees', color: '#e74c3c', bg: 'linear-gradient(135deg, #e74c3c, #c0392b)' },
  { label: 'Time off', icon: '🏖️', path: '/admin/leave', color: '#e67e22', bg: 'linear-gradient(135deg, #e67e22, #d35400)', feature: 'leave' },
  { label: 'Attendance', icon: '⏱️', path: '/admin/timesheets', color: '#f39c12', bg: 'linear-gradient(135deg, #f39c12, #e67e22)', feature: 'timesheets' },
  { label: 'Workflows', icon: '⚙️', path: '/admin/onboarding', color: '#9b59b6', bg: 'linear-gradient(135deg, #9b59b6, #8e44ad)' },
  { label: 'Performance', icon: '🎯', path: '/admin/performance', color: '#3498db', bg: 'linear-gradient(135deg, #3498db, #2980b9)', feature: 'performance' },
  { label: 'Surveys', icon: '📊', path: '/admin/kudos', color: '#2ecc71', bg: 'linear-gradient(135deg, #2ecc71, #27ae60)', feature: 'kudos' },
  { label: 'Analytics', icon: '📈', path: '/admin/billing', color: '#1abc9c', bg: 'linear-gradient(135deg, #1abc9c, #16a085)' },
  { label: 'Docs & e-Sign', icon: '📄', path: '/admin/announcements', color: '#34495e', bg: 'linear-gradient(135deg, #34495e, #2c3e50)' },
]

function getGreeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good Morning'
  if (h < 18) return 'Good Afternoon'
  return 'Good Evening'
}

function getDateString(): string {
  const d = new Date()
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]}`
}

export default function AdminDashboardModern() {
  const navigate = useNavigate()
  const { employeeName, avatarUrl } = useAuth()
  const { selectedCompanyId, selectedCompany } = useAdminCompany()
  const { features } = useFeatures()
  const [stats, setStats] = useState<QuickStat[]>([])
  const [activities, setActivities] = useState<RecentActivity[]>([])
  const [loading, setLoading] = useState(true)
  const firstName = employeeName.split(' ')[0] || 'Admin'
  const initials = employeeName.split(' ').map(n => n[0]).join('').toUpperCase() || '?'

  useEffect(() => {
    if (selectedCompanyId) loadData()
  }, [selectedCompanyId])

  async function loadData() {
    setLoading(true)
    const cid = selectedCompanyId
    const eq = (q: any) => q.eq('company_id', cid)

    const [emp, onb, exp, leave, tickets, timesheets] = await Promise.all([
      eq(supabase.from('employees').select('id', { count: 'exact', head: true }).eq('is_active', true)),
      eq(supabase.from('onboarding').select('id', { count: 'exact', head: true }).eq('status', 'new')),
      eq(supabase.from('expense_claims').select('id', { count: 'exact', head: true }).eq('status', 'pending')),
      eq(supabase.from('leave_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending')),
      eq(supabase.from('hr_tickets').select('id', { count: 'exact', head: true }).in('status', ['open', 'in_progress'])),
      eq(supabase.from('timesheets').select('id', { count: 'exact', head: true }).eq('status', 'pending')),
    ])

    setStats([
      { label: 'Active employees', value: emp.count ?? 0, color: '#3b82f6', path: '/admin/employees', icon: '👥' },
      { label: 'Pending onboarders', value: onb.count ?? 0, color: '#f59e0b', path: '/admin/onboarding', icon: '🚀' },
      { label: 'Leave requests', value: leave.count ?? 0, delta: 'awaiting approval', color: '#10b981', path: '/admin/leave', icon: '🏖️' },
      { label: 'Expense claims', value: exp.count ?? 0, delta: 'pending review', color: '#ef4444', path: '/admin/expenses', icon: '💰' },
      { label: 'Open tickets', value: tickets.count ?? 0, color: '#8b5cf6', path: '/admin/tickets', icon: '🎫' },
      { label: 'Pending timesheets', value: timesheets.count ?? 0, color: '#06b6d4', path: '/admin/timesheets', icon: '⏱️' },
    ])

    const { data: recentLeave } = await supabase
      .from('leave_requests')
      .select('id, created_at, status, employee:employees!leave_requests_employee_id_fkey(first_name, last_name)')
      .eq('company_id', cid)
      .order('created_at', { ascending: false })
      .limit(3)

    const { data: recentTickets } = await supabase
      .from('hr_tickets')
      .select('id, created_at, subject, status')
      .eq('company_id', cid)
      .order('created_at', { ascending: false })
      .limit(2)

    const acts: RecentActivity[] = []
    if (recentLeave) {
      for (const r of recentLeave as any[]) {
        const name = r.employee ? `${r.employee.first_name} ${r.employee.last_name}` : 'Unknown'
        const ago = getTimeAgo(r.created_at)
        acts.push({ id: `l-${r.id}`, type: 'leave', description: `${name} requested time off`, time: ago, icon: '🏖️' })
      }
    }
    if (recentTickets) {
      for (const t of recentTickets as any[]) {
        const ago = getTimeAgo(t.created_at)
        acts.push({ id: `t-${t.id}`, type: 'ticket', description: `Ticket: ${t.subject}`, time: ago, icon: '🎫' })
      }
    }
    acts.sort((a, b) => a.time.localeCompare(b.time))
    setActivities(acts.slice(0, 5))
    setLoading(false)
  }

  function getTimeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    const days = Math.floor(hrs / 24)
    return `${days}d ago`
  }

  const visibleNav = NAV_ITEMS.filter(n => !n.feature || features[n.feature])

  return (
    <>
      <style>{modernDashCSS}</style>
      <div className="mdash">
        {/* Hero section with gradient background */}
        <div className="mdash-hero">
          <div className="mdash-hero-content">
            <div className="mdash-hero-text">
              <p className="mdash-date">{getDateString()}</p>
              <h1 className="mdash-greeting">{getGreeting()}, {firstName}</h1>
            </div>
            <div className="mdash-hero-avatar">
              {avatarUrl
                ? <img src={avatarUrl} alt={initials} className="mdash-avatar-img" />
                : <div className="mdash-avatar-fallback">{initials}</div>
              }
            </div>
          </div>

          {/* Search / quick actions bar */}
          <div className="mdash-search-bar">
            <span className="mdash-search-placeholder">quick jump to any admin page...</span>
            <div className="mdash-quick-links">
              <button onClick={() => navigate('/admin/onboarding')}>Onboarding report</button>
              <button onClick={() => navigate('/admin/tickets')}>Open tickets</button>
              <button onClick={() => navigate('/admin/expenses')}>Pending expenses</button>
            </div>
          </div>
        </div>

        {/* Icon dock navigation */}
        <div className="mdash-dock">
          {visibleNav.map(item => (
            <button key={item.path} className="mdash-dock-item" onClick={() => navigate(item.path)}>
              <div className="mdash-dock-icon" style={{ background: item.bg }}>
                <span>{item.icon}</span>
              </div>
              <span className="mdash-dock-label">{item.label}</span>
            </button>
          ))}
        </div>

        {/* Stats grid */}
        <div className="mdash-stats-section">
          <h2 className="mdash-section-title">Overview</h2>
          {loading ? (
            <div className="mdash-loading">Loading...</div>
          ) : (
            <div className="mdash-stats-grid">
              {stats.map(s => (
                <button key={s.label} className="mdash-stat-card" onClick={() => navigate(s.path)}>
                  <div className="mdash-stat-icon-wrap" style={{ background: `${s.color}15` }}>
                    <span style={{ fontSize: 20 }}>{s.icon}</span>
                  </div>
                  <div className="mdash-stat-info">
                    <span className="mdash-stat-value" style={{ color: s.color }}>{s.value}</span>
                    <span className="mdash-stat-label">{s.label}</span>
                    {s.delta && <span className="mdash-stat-delta">{s.delta}</span>}
                  </div>
                  <svg className="mdash-stat-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Recent activity */}
        {activities.length > 0 && (
          <div className="mdash-activity-section">
            <h2 className="mdash-section-title">Recent Activity</h2>
            <div className="mdash-activity-list">
              {activities.map(a => (
                <div key={a.id} className="mdash-activity-item">
                  <span className="mdash-activity-icon">{a.icon}</span>
                  <span className="mdash-activity-desc">{a.description}</span>
                  <span className="mdash-activity-time">{a.time}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Company info footer */}
        {selectedCompany && (
          <div className="mdash-company-footer">
            <span>{selectedCompany.name}</span>
            {selectedCompany.is_trial && (
              <span className="mdash-trial-badge">Trial</span>
            )}
          </div>
        )}

        <div className="mdash-back-link">
          <button onClick={() => navigate('/admin')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
            Back to classic dashboard
          </button>
        </div>
      </div>
    </>
  )
}

const modernDashCSS = `
  .mdash {
    min-height: 100vh;
    background: #0f0f14;
    color: #e8e8ed;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, sans-serif;
    overflow-x: hidden;
  }

  /* ── Hero ── */
  .mdash-hero {
    position: relative;
    padding: 48px 48px 32px;
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 30%, #0f3460 60%, #533483 100%);
    border-bottom-left-radius: 32px;
    border-bottom-right-radius: 32px;
    overflow: hidden;
  }
  .mdash-hero::before {
    content: '';
    position: absolute;
    inset: 0;
    background:
      radial-gradient(ellipse 60% 50% at 70% 20%, rgba(233, 137, 90, 0.25), transparent),
      radial-gradient(ellipse 50% 60% at 30% 80%, rgba(83, 52, 131, 0.35), transparent);
    pointer-events: none;
  }
  .mdash-hero-content {
    position: relative;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 32px;
  }
  .mdash-hero-text { flex: 1; }
  .mdash-date {
    font-size: 16px;
    font-weight: 500;
    color: #e9896a;
    margin: 0 0 8px;
    font-style: italic;
    letter-spacing: 0.02em;
  }
  .mdash-greeting {
    font-size: 36px;
    font-weight: 700;
    color: #fff;
    margin: 0;
    letter-spacing: -0.02em;
    line-height: 1.2;
  }
  .mdash-hero-avatar {
    flex-shrink: 0;
    margin-left: 24px;
  }
  .mdash-avatar-img {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    object-fit: cover;
    border: 3px solid rgba(255,255,255,0.2);
  }
  .mdash-avatar-fallback {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: rgba(255,255,255,0.15);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    font-weight: 700;
    color: #fff;
    border: 3px solid rgba(255,255,255,0.2);
  }

  /* ── Search bar ── */
  .mdash-search-bar {
    position: relative;
    background: rgba(255,255,255,0.12);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(255,255,255,0.15);
    border-radius: 20px;
    padding: 20px 24px;
  }
  .mdash-search-placeholder {
    display: block;
    font-size: 16px;
    color: rgba(255,255,255,0.45);
    margin-bottom: 16px;
  }
  .mdash-quick-links {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }
  .mdash-quick-links button {
    background: rgba(255,255,255,0.1);
    border: 1px solid rgba(255,255,255,0.15);
    border-radius: 12px;
    padding: 8px 16px;
    color: #e8e8ed;
    font-size: 13px;
    cursor: pointer;
    transition: all 0.2s;
    font-family: inherit;
  }
  .mdash-quick-links button::after {
    content: ' ↗';
    opacity: 0.5;
  }
  .mdash-quick-links button:hover {
    background: rgba(255,255,255,0.2);
    transform: translateY(-1px);
  }

  /* ── Icon dock ── */
  .mdash-dock {
    display: flex;
    gap: 8px;
    padding: 28px 48px;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .mdash-dock::-webkit-scrollbar { display: none; }
  .mdash-dock-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    background: none;
    border: none;
    cursor: pointer;
    min-width: 80px;
    padding: 8px 4px;
    transition: transform 0.2s;
    font-family: inherit;
  }
  .mdash-dock-item:hover { transform: translateY(-4px); }
  .mdash-dock-icon {
    width: 56px;
    height: 56px;
    border-radius: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 24px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.3);
    transition: box-shadow 0.2s;
  }
  .mdash-dock-item:hover .mdash-dock-icon {
    box-shadow: 0 8px 24px rgba(0,0,0,0.4);
  }
  .mdash-dock-label {
    font-size: 11px;
    font-weight: 500;
    color: #a0a0b0;
    white-space: nowrap;
  }

  /* ── Stats ── */
  .mdash-stats-section {
    padding: 0 48px 32px;
  }
  .mdash-section-title {
    font-size: 20px;
    font-weight: 700;
    color: #e8e8ed;
    margin: 0 0 20px;
    letter-spacing: -0.01em;
  }
  .mdash-loading {
    text-align: center;
    padding: 32px;
    color: #a0a0b0;
    font-size: 14px;
  }
  .mdash-stats-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
  }
  .mdash-stat-card {
    display: flex;
    align-items: center;
    gap: 16px;
    background: #1a1a24;
    border: 1px solid #2a2a3a;
    border-radius: 20px;
    padding: 20px;
    cursor: pointer;
    transition: all 0.25s;
    text-align: left;
    font-family: inherit;
    color: inherit;
  }
  .mdash-stat-card:hover {
    background: #22222e;
    border-color: #3a3a4a;
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(0,0,0,0.3);
  }
  .mdash-stat-icon-wrap {
    width: 48px;
    height: 48px;
    border-radius: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .mdash-stat-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .mdash-stat-value {
    font-size: 28px;
    font-weight: 800;
    line-height: 1.1;
    letter-spacing: -0.02em;
  }
  .mdash-stat-label {
    font-size: 13px;
    color: #8b8fa3;
    font-weight: 500;
  }
  .mdash-stat-delta {
    font-size: 11px;
    color: #6b6f83;
    font-weight: 400;
  }
  .mdash-stat-arrow {
    color: #4a4a5a;
    flex-shrink: 0;
    transition: color 0.2s;
  }
  .mdash-stat-card:hover .mdash-stat-arrow { color: #8b8fa3; }

  /* ── Activity ── */
  .mdash-activity-section {
    padding: 0 48px 32px;
  }
  .mdash-activity-list {
    background: #1a1a24;
    border: 1px solid #2a2a3a;
    border-radius: 20px;
    overflow: hidden;
  }
  .mdash-activity-item {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 16px 20px;
    border-bottom: 1px solid #2a2a3a;
    transition: background 0.15s;
  }
  .mdash-activity-item:last-child { border-bottom: none; }
  .mdash-activity-item:hover { background: #22222e; }
  .mdash-activity-icon { font-size: 18px; flex-shrink: 0; }
  .mdash-activity-desc {
    flex: 1;
    font-size: 14px;
    color: #c8c8d4;
    font-weight: 500;
  }
  .mdash-activity-time {
    font-size: 12px;
    color: #6b6f83;
    white-space: nowrap;
  }

  /* ── Footer ── */
  .mdash-company-footer {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 16px 48px;
    font-size: 13px;
    color: #6b6f83;
  }
  .mdash-trial-badge {
    background: #f59e0b20;
    color: #f59e0b;
    font-size: 11px;
    font-weight: 600;
    padding: 3px 10px;
    border-radius: 100px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .mdash-back-link {
    text-align: center;
    padding: 0 48px 48px;
  }
  .mdash-back-link button {
    background: none;
    border: 1px solid #2a2a3a;
    color: #8b8fa3;
    font-size: 13px;
    padding: 10px 20px;
    border-radius: 12px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    transition: all 0.2s;
    font-family: inherit;
  }
  .mdash-back-link button:hover {
    color: #e8e8ed;
    border-color: #4a4a5a;
    background: #1a1a24;
  }
`
