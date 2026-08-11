import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useAdminCompany } from '../../context/AdminCompanyContext'

interface AllCompanyStats {
  totalEmployees: number
  totalCompanies: number
  subsPayroll: number
  subsBenefits: number
  subsShifts: number
  subsLegal: number
  subsTimesheets: number
  subsPerformance: number
  subsSpaceBooking: number
  totalOnboarders: number
  totalAnnouncements: number
  totalTickets: number
  totalBenefitTypes: number
}

interface CompanyStats {
  totalEmployees: number
  activeExpenses: number
  pendingLeave: number
  payslipsThisMonth: number
  kudosThisMonth: number
  openTickets: number
  pendingOnboarding: number
  announcements: number
}

export default function AdminDashboard() {
  const navigate = useNavigate()
  const { isSuperAdmin } = useAuth()
  const { selectedCompanyId, selectedCompany } = useAdminCompany()
  const [loading, setLoading] = useState(true)
  const [allStats, setAllStats] = useState<AllCompanyStats | null>(null)
  const [companyStats, setCompanyStats] = useState<CompanyStats | null>(null)

  useEffect(() => {
    if (isSuperAdmin) {
      loadSuperAdminStats()
    } else if (selectedCompanyId) {
      loadCompanyStats()
    }
  }, [isSuperAdmin, selectedCompanyId])

  async function loadSuperAdminStats() {
    setLoading(true)
    const [
      empRes, compRes, featRes, onbRes, annRes, tickRes, benRes,
    ] = await Promise.all([
      supabase.from('employees').select('id', { count: 'exact', head: true }),
      supabase.from('companies').select('id', { count: 'exact', head: true }),
      supabase.from('company_features').select('feature_key, company_id').eq('is_enabled', true),
      supabase.from('onboarding').select('id', { count: 'exact', head: true }),
      supabase.from('announcements').select('id', { count: 'exact', head: true }),
      supabase.from('hr_tickets').select('id', { count: 'exact', head: true }),
      supabase.from('benefit_types').select('id', { count: 'exact', head: true }),
    ])

    const features = (featRes.data || []) as { feature_key: string; company_id: string }[]
    const countFeature = (key: string) => features.filter(f => f.feature_key === key).length

    setAllStats({
      totalEmployees: empRes.count ?? 0,
      totalCompanies: compRes.count ?? 0,
      subsPayroll: countFeature('payroll'),
      subsBenefits: countFeature('benefits'),
      subsShifts: countFeature('shifts'),
      subsLegal: countFeature('legal_timesheets'),
      subsTimesheets: countFeature('timesheets'),
      subsPerformance: countFeature('performance'),
      subsSpaceBooking: countFeature('space_booking'),
      totalOnboarders: onbRes.count ?? 0,
      totalAnnouncements: annRes.count ?? 0,
      totalTickets: tickRes.count ?? 0,
      totalBenefitTypes: benRes.count ?? 0,
    })
    setLoading(false)
  }

  async function loadCompanyStats() {
    setLoading(true)
    const eq = (q: any) => q.eq('company_id', selectedCompanyId)
    const [emp, exp, leave, pay, kudos, onb, ann, tick] = await Promise.all([
      eq(supabase.from('employees').select('id', { count: 'exact', head: true })),
      eq(supabase.from('expense_claims').select('id', { count: 'exact', head: true }).eq('status', 'pending')),
      eq(supabase.from('leave_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending')),
      eq(supabase.from('payslips').select('id', { count: 'exact', head: true })),
      eq(supabase.from('kudos').select('id', { count: 'exact', head: true })),
      eq(supabase.from('onboarding').select('id', { count: 'exact', head: true }).eq('status', 'new')),
      eq(supabase.from('announcements').select('id', { count: 'exact', head: true })),
      eq(supabase.from('hr_tickets').select('id', { count: 'exact', head: true })),
    ])
    setCompanyStats({
      totalEmployees: emp.count ?? 0,
      activeExpenses: exp.count ?? 0,
      pendingLeave: leave.count ?? 0,
      payslipsThisMonth: pay.count ?? 0,
      kudosThisMonth: kudos.count ?? 0,
      openTickets: tick.count ?? 0,
      pendingOnboarding: onb.count ?? 0,
      announcements: ann.count ?? 0,
    })
    setLoading(false)
  }

  if (loading) {
    return (
      <div className="admin-dashboard">
        <div className="admin-page-header"><h2>Dashboard</h2></div>
        <div className="admin-loading">Loading...</div>
      </div>
    )
  }

  if (isSuperAdmin && allStats) return <SuperAdminDash stats={allStats} navigate={navigate} />

  if (companyStats) {
    const cards = [
      { label: 'Employees', value: companyStats.totalEmployees, color: '#5b9bd5', path: '/admin/employees' },
      { label: 'Pending Expenses', value: companyStats.activeExpenses, color: '#43a047', path: '/admin/expenses' },
      { label: 'Pending Leave', value: companyStats.pendingLeave, color: '#ff9800', path: '/admin/leave' },
      { label: 'Payslips', value: companyStats.payslipsThisMonth, color: '#1565c0', path: '/admin/payroll' },
      { label: 'Kudos', value: companyStats.kudosThisMonth, color: '#fdd835', path: '/admin/kudos' },
      { label: 'Onboarding', value: companyStats.pendingOnboarding, color: '#e91e63', path: '/admin/onboarding' },
      { label: 'Announcements', value: companyStats.announcements, color: '#7b1fa2', path: '/admin/announcements' },
      { label: 'HR Tickets', value: companyStats.openTickets, color: '#00897b', path: '/admin/tickets' },
    ]
    return (
      <div className="admin-dashboard">
        <div className="admin-page-header">
          <h2>Dashboard</h2>
          <p>{selectedCompany ? selectedCompany.name : 'Overview of your HR platform'}</p>
        </div>
        <div className="admin-stat-grid">
          {cards.map(c => (
            <button key={c.label} className="admin-stat-card" onClick={() => navigate(c.path)}>
              <div className="admin-stat-icon" style={{ background: c.color }}>
                <span style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>{c.value}</span>
              </div>
              <div className="admin-stat-info">
                <span className="admin-stat-label">{c.label}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    )
  }

  return null
}

function SuperAdminDash({ stats, navigate }: { stats: AllCompanyStats; navigate: (p: string) => void }) {
  const featureSubs = [
    { label: 'Payroll', value: stats.subsPayroll, color: '#1565c0' },
    { label: 'Benefits', value: stats.subsBenefits, color: '#7b1fa2' },
    { label: 'Shifts & Rotas', value: stats.subsShifts, color: '#e65100' },
    { label: 'Legal Timesheets', value: stats.subsLegal, color: '#00695c' },
    { label: 'Timesheets', value: stats.subsTimesheets, color: '#0277bd' },
    { label: 'Performance', value: stats.subsPerformance, color: '#c62828' },
    { label: 'Space Booking', value: stats.subsSpaceBooking, color: '#4527a0' },
  ]

  const maxSub = Math.max(...featureSubs.map(f => f.value), 1)

  return (
    <div className="admin-dashboard">
      <div className="admin-page-header">
        <h2>Platform Overview</h2>
        <p>All-company metrics across InflowHR</p>
      </div>

      <div className="sa-dash-grid">
        <button className="sa-dash-card" onClick={() => navigate('/admin/employees')}>
          <div className="sa-dash-card-icon" style={{ background: '#1565c0' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          </div>
          <div className="sa-dash-card-body">
            <span className="sa-dash-card-value">{stats.totalEmployees}</span>
            <span className="sa-dash-card-label">Total Employees</span>
          </div>
        </button>

        <button className="sa-dash-card" onClick={() => navigate('/admin/subscriptions')}>
          <div className="sa-dash-card-icon" style={{ background: '#2e7d32' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          </div>
          <div className="sa-dash-card-body">
            <span className="sa-dash-card-value">{stats.totalCompanies}</span>
            <span className="sa-dash-card-label">Companies</span>
          </div>
        </button>

        <button className="sa-dash-card" onClick={() => navigate('/admin/onboarding')}>
          <div className="sa-dash-card-icon" style={{ background: '#e91e63' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
          </div>
          <div className="sa-dash-card-body">
            <span className="sa-dash-card-value">{stats.totalOnboarders}</span>
            <span className="sa-dash-card-label">New Onboarders</span>
          </div>
        </button>

        <button className="sa-dash-card" onClick={() => navigate('/admin/announcements')}>
          <div className="sa-dash-card-icon" style={{ background: '#7b1fa2' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 17H2a3 3 0 0 0 3-3V9a7 7 0 0 1 14 0v5a3 3 0 0 0 3 3zm-8.27 4a2 2 0 0 1-3.46 0"/></svg>
          </div>
          <div className="sa-dash-card-body">
            <span className="sa-dash-card-value">{stats.totalAnnouncements}</span>
            <span className="sa-dash-card-label">Announcements</span>
          </div>
        </button>

        <button className="sa-dash-card" onClick={() => navigate('/admin/tickets')}>
          <div className="sa-dash-card-icon" style={{ background: '#00897b' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          </div>
          <div className="sa-dash-card-body">
            <span className="sa-dash-card-value">{stats.totalTickets}</span>
            <span className="sa-dash-card-label">Tickets Raised</span>
          </div>
        </button>

        <button className="sa-dash-card" onClick={() => navigate('/admin/benefits')}>
          <div className="sa-dash-card-icon" style={{ background: '#ef6c00' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="15" height="13" rx="2"/><path d="M16 8h4a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-4"/><circle cx="8" cy="21" r="1"/><circle cx="18" cy="21" r="1"/><path d="M1 16h22"/></svg>
          </div>
          <div className="sa-dash-card-body">
            <span className="sa-dash-card-value">{stats.totalBenefitTypes}</span>
            <span className="sa-dash-card-label">Benefit Types</span>
          </div>
        </button>
      </div>

      <div className="sa-dash-chart-section">
        <h3 className="sa-dash-section-title">Feature Subscriptions by Company</h3>
        <p className="sa-dash-section-sub">Number of companies subscribed to each feature add-on</p>
        <div className="sa-dash-bars">
          {featureSubs.map(f => (
            <div key={f.label} className="sa-dash-bar-row">
              <span className="sa-dash-bar-label">{f.label}</span>
              <div className="sa-dash-bar-track">
                <div
                  className="sa-dash-bar-fill"
                  style={{
                    width: `${(f.value / maxSub) * 100}%`,
                    background: f.color,
                  }}
                />
              </div>
              <span className="sa-dash-bar-value">{f.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
