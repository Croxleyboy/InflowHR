import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAdminCompany } from '../../context/AdminCompanyContext'

interface DashStats {
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
  const { selectedCompanyId, selectedCompany } = useAdminCompany()
  const [stats, setStats] = useState<DashStats>({
    totalEmployees: 0, activeExpenses: 0, pendingLeave: 0,
    payslipsThisMonth: 0, kudosThisMonth: 0, openTickets: 0,
    pendingOnboarding: 0, announcements: 0,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!selectedCompanyId) return
    async function load() {
      setLoading(true)
      const eq = (q: any) => q.eq('company_id', selectedCompanyId)
      const [emp, exp, leave, pay, kudos, onb, ann] = await Promise.all([
        eq(supabase.from('employees').select('id', { count: 'exact', head: true })),
        eq(supabase.from('expense_claims').select('id', { count: 'exact', head: true }).eq('status', 'pending')),
        eq(supabase.from('leave_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending')),
        eq(supabase.from('payslips').select('id', { count: 'exact', head: true })),
        eq(supabase.from('kudos').select('id', { count: 'exact', head: true })),
        eq(supabase.from('onboarding').select('id', { count: 'exact', head: true }).eq('status', 'new')),
        eq(supabase.from('announcements').select('id', { count: 'exact', head: true })),
      ])
      setStats({
        totalEmployees: emp.count ?? 0,
        activeExpenses: exp.count ?? 0,
        pendingLeave: leave.count ?? 0,
        payslipsThisMonth: pay.count ?? 0,
        kudosThisMonth: kudos.count ?? 0,
        openTickets: 0,
        pendingOnboarding: onb.count ?? 0,
        announcements: ann.count ?? 0,
      })
      setLoading(false)
    }
    load()
  }, [selectedCompanyId])

  const cards = [
    { label: 'Employees', value: stats.totalEmployees, icon: '👥', color: '#5b9bd5', path: '/admin/employees' },
    { label: 'Pending Expenses', value: stats.activeExpenses, icon: '💰', color: '#43a047', path: '/admin/expenses' },
    { label: 'Pending Leave', value: stats.pendingLeave, icon: '🏖️', color: '#ff9800', path: '/admin/leave' },
    { label: 'Payslips', value: stats.payslipsThisMonth, icon: '💷', color: '#1565c0', path: '/admin/payroll' },
    { label: 'Kudos', value: stats.kudosThisMonth, icon: '⭐', color: '#fdd835', path: '/admin/kudos' },
    { label: 'Onboarding', value: stats.pendingOnboarding, icon: '🚀', color: '#e91e63', path: '/admin/onboarding' },
    { label: 'Announcements', value: stats.announcements, icon: '📢', color: '#7b1fa2', path: '/admin/announcements' },
    { label: 'HR Tickets', value: stats.openTickets, icon: '🎫', color: '#00897b', path: '/admin/tickets' },
    { label: 'Shift Templates', value: 0, icon: '🔄', color: '#e65100', path: '/admin/shifts' },
    { label: 'Rotas', value: 0, icon: '📅', color: '#bf360c', path: '/admin/rotas' },
  ]

  return (
    <div className="admin-dashboard">
      <div className="admin-page-header">
        <h2>Dashboard</h2>
        <p>{selectedCompany ? selectedCompany.name : 'Overview of your HR platform'}</p>
      </div>
      {loading ? (
        <div className="admin-loading">Loading...</div>
      ) : (
        <div className="admin-stat-grid">
          {cards.map(c => (
            <button key={c.label} className="admin-stat-card" onClick={() => navigate(c.path)}>
              <div className="admin-stat-icon" style={{ background: c.color }}>{c.icon}</div>
              <div className="admin-stat-info">
                <span className="admin-stat-value">{c.value}</span>
                <span className="admin-stat-label">{c.label}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
