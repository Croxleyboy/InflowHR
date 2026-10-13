import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, callRpcDirect } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { listCompanyArchives, listAllCompanyArchives } from '../../lib/companyArchive'
import type { ArchiveFile } from '../../lib/companyArchive'

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
  benefits: number
  shiftsRotas: number
  legalTimesheets: number
  performance1to1s: number
  spaceBookings: number
  newOnboarders: number
  announcements: number
  ticketsRaised: number
  pendingExpenses: number
  pendingLeave: number
  kudos: number
  elearningRate: number
  upcomingShifts: number
  spacesAvailable: number
  totalAssets: number
  assetsChange: number
}

interface TrendPoint { label: string; value: number }

export default function AdminDashboard() {
  const navigate = useNavigate()
  const { isSuperAdmin } = useAuth()
  const { selectedCompanyId, selectedCompany } = useAdminCompany()
  const [loading, setLoading] = useState(true)
  const [allStats, setAllStats] = useState<AllCompanyStats | null>(null)
  const [companyStats, setCompanyStats] = useState<CompanyStats | null>(null)
  const [empTrend, setEmpTrend] = useState<TrendPoint[]>([])
  const [ticketTrend, setTicketTrend] = useState<TrendPoint[]>([])
  const [allArchives, setAllArchives] = useState<ArchiveFile[]>([])

  useEffect(() => {
    if (isSuperAdmin) {
      loadSuperAdminStats()
      listAllCompanyArchives().then(setAllArchives)
    } else if (selectedCompanyId) {
      loadCompanyStats()
    }
  }, [isSuperAdmin, selectedCompanyId])

  async function loadSuperAdminStats() {
    setLoading(true)
    const [metricsRes, compRes, featRes, annRes, benRes] = await Promise.all([
      supabase.rpc('get_all_company_metrics'),
      supabase.from('companies').select('id', { count: 'exact', head: true }),
      supabase.from('company_features').select('feature_key, company_id').eq('is_enabled', true),
      supabase.from('announcements').select('id', { count: 'exact', head: true }),
      supabase.from('benefit_types').select('id', { count: 'exact', head: true }),
    ])
    const metrics = (metricsRes.data || []) as { employee_count: number; total_employees: number; open_tickets: number; pending_onboarding: number }[]
    const totalEmployees = metrics.reduce((s, m) => s + (m.total_employees || 0), 0)
    const totalTickets = metrics.reduce((s, m) => s + (m.open_tickets || 0), 0)
    const totalOnboarders = metrics.reduce((s, m) => s + (m.pending_onboarding || 0), 0)
    const features = (featRes.data || []) as { feature_key: string; company_id: string }[]
    const countFeature = (key: string) => features.filter(f => f.feature_key === key).length
    setAllStats({
      totalEmployees,
      totalCompanies: compRes.count ?? 0,
      subsPayroll: countFeature('payroll'),
      subsBenefits: countFeature('benefits'),
      subsShifts: countFeature('shifts'),
      subsLegal: countFeature('legal_timesheets'),
      subsTimesheets: countFeature('timesheets'),
      subsPerformance: countFeature('performance'),
      subsSpaceBooking: countFeature('space_booking'),
      totalOnboarders,
      totalAnnouncements: annRes.count ?? 0,
      totalTickets,
      totalBenefitTypes: benRes.count ?? 0,
    })
    setLoading(false)
  }

  async function loadCompanyStats() {
    setLoading(true)
    const cid = selectedCompanyId
    const eq = (q: any) => q.eq('company_id', cid)

    const [emp, ben, shifts, legal, perf, space, onb, ann, tick, exp, leave, kudos] = await Promise.all([
      eq(supabase.from('employees').select('id', { count: 'exact', head: true }).eq('is_active', true)),
      eq(supabase.from('benefit_enrollments').select('id', { count: 'exact', head: true })),
      eq(supabase.from('shift_assignments').select('id', { count: 'exact', head: true })),
      eq(supabase.from('legal_timesheet_entries').select('id', { count: 'exact', head: true })),
      eq(supabase.from('performance_reviews').select('id', { count: 'exact', head: true })),
      eq(supabase.from('space_bookings').select('id', { count: 'exact', head: true })),
      eq(supabase.from('onboarding').select('id', { count: 'exact', head: true }).eq('status', 'new')),
      eq(supabase.from('announcements').select('id', { count: 'exact', head: true })),
      eq(supabase.from('hr_tickets').select('id', { count: 'exact', head: true })),
      eq(supabase.from('expense_claims').select('id', { count: 'exact', head: true }).eq('status', 'pending')),
      eq(supabase.from('leave_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending')),
      eq(supabase.from('kudos').select('id', { count: 'exact', head: true })),
    ])

    const todayStr = new Date().toISOString().slice(0, 10)
    const monthAgoEnd = new Date(new Date().getFullYear(), new Date().getMonth(), 0).toISOString().slice(0, 10)

    const [enrolAll, enrolDone, upShifts, totalSpaces, bookedSpaces, assetsNow, assetsPrev] = await Promise.all([
      eq(supabase.from('elearning_completions').select('course_id', { count: 'exact', head: true })),
      eq(supabase.from('elearning_completions').select('course_id', { count: 'exact', head: true }).not('completed_at', 'is', null)),
      eq(supabase.from('shift_assignments').select('id', { count: 'exact', head: true }).gte('shift_date', todayStr)),
      eq(supabase.from('spaces').select('id', { count: 'exact', head: true }).eq('is_active', true)),
      eq(supabase.from('space_bookings').select('id', { count: 'exact', head: true }).eq('booking_date', todayStr)),
      eq(supabase.from('company_assets').select('id', { count: 'exact', head: true })),
      eq(supabase.from('company_assets').select('id', { count: 'exact', head: true }).lte('created_at', monthAgoEnd + 'T23:59:59')),
    ])

    const enrolTotal = enrolAll.count ?? 0
    const enrolComplete = enrolDone.count ?? 0
    const elearningRate = enrolTotal > 0 ? Math.round((enrolComplete / enrolTotal) * 100) : 0
    const assetsNowCount = assetsNow.count ?? 0
    const assetsPrevCount = assetsPrev.count ?? 0
    const assetsChange = assetsPrevCount > 0 ? Math.round(((assetsNowCount - assetsPrevCount) / assetsPrevCount) * 100) : (assetsNowCount > 0 ? 100 : 0)

    setCompanyStats({
      totalEmployees: emp.count ?? 0,
      benefits: ben.count ?? 0,
      shiftsRotas: shifts.count ?? 0,
      legalTimesheets: legal.count ?? 0,
      performance1to1s: perf.count ?? 0,
      spaceBookings: space.count ?? 0,
      newOnboarders: onb.count ?? 0,
      announcements: ann.count ?? 0,
      ticketsRaised: tick.count ?? 0,
      pendingExpenses: exp.count ?? 0,
      pendingLeave: leave.count ?? 0,
      kudos: kudos.count ?? 0,
      elearningRate,
      upcomingShifts: upShifts.count ?? 0,
      spacesAvailable: Math.max(0, (totalSpaces.count ?? 0) - (bookedSpaces.count ?? 0)),
      totalAssets: assetsNowCount,
      assetsChange,
    })

    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    const now = new Date()
    const empPoints: TrendPoint[] = []
    const tickPoints: TrendPoint[] = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0)
      const endStr = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`
      const startStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
      const label = MONTHS[d.getMonth()]

      const { count: empCount } = await supabase
        .from('employees').select('id', { count: 'exact', head: true })
        .eq('company_id', cid).eq('is_active', true).lte('created_at', endStr + 'T23:59:59')
      empPoints.push({ label, value: empCount ?? 0 })

      const { count: tickCount } = await supabase
        .from('hr_tickets').select('id', { count: 'exact', head: true })
        .eq('company_id', cid).gte('created_at', startStr).lte('created_at', endStr + 'T23:59:59')
      tickPoints.push({ label, value: tickCount ?? 0 })
    }
    setEmpTrend(empPoints)
    setTicketTrend(tickPoints)
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

  if (isSuperAdmin && allStats) return <SuperAdminDash stats={allStats} navigate={navigate} archives={allArchives} />

  if (companyStats) {
    return (
      <CompanyDash
        stats={companyStats}
        companyName={selectedCompany?.name || ''}
        companyId={selectedCompanyId || ''}
        navigate={navigate}
        empTrend={empTrend}
        ticketTrend={ticketTrend}
        isTrial={selectedCompany?.is_trial || false}
        trialStartDate={selectedCompany?.trial_start_date || null}
        trialEndDate={selectedCompany?.trial_end_date || null}
      />
    )
  }

  return null
}

function MiniLineChart({ data, color, height = 48 }: { data: TrendPoint[]; color: string; height?: number }) {
  if (data.length < 2) return null
  const max = Math.max(...data.map(d => d.value), 1)
  const w = 160
  const h = height
  const pad = 4
  const pts = data.map((d, i) => ({
    x: pad + (i / (data.length - 1)) * (w - pad * 2),
    y: pad + (1 - d.value / max) * (h - pad * 2),
  }))
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
  const area = line + ` L${pts[pts.length - 1].x},${h} L${pts[0].x},${h} Z`

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
      <defs>
        <linearGradient id={`grad-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#grad-${color.replace('#', '')})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={i === pts.length - 1 ? 3.5 : 0} fill={color} />
      ))}
      {data.map((d, i) => (
        <text key={i} x={pts[i].x} y={h - 1} textAnchor="middle" fontSize="8" fill="#8b8fa3">{d.label}</text>
      ))}
    </svg>
  )
}

function MiniBarChart({ data, color, height = 48 }: { data: TrendPoint[]; color: string; height?: number }) {
  if (data.length === 0) return null
  const max = Math.max(...data.map(d => d.value), 1)
  const w = 160
  const h = height
  const barW = Math.min(16, (w - 8) / data.length - 3)

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
      {data.map((d, i) => {
        const x = 4 + i * ((w - 8) / data.length) + ((w - 8) / data.length - barW) / 2
        const barH = (d.value / max) * (h - 16)
        return (
          <g key={i}>
            <rect x={x} y={h - 12 - barH} width={barW} height={barH} rx={3} fill={i === data.length - 1 ? color : color + '80'} />
            <text x={x + barW / 2} y={h - 1} textAnchor="middle" fontSize="8" fill="#8b8fa3">{d.label}</text>
          </g>
        )
      })}
    </svg>
  )
}

function formatUkDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

function CompanyDash({
  stats, companyName, companyId, navigate, empTrend, ticketTrend,
  isTrial, trialStartDate, trialEndDate,
}: {
  stats: CompanyStats
  companyName: string
  companyId: string
  navigate: (p: string) => void
  empTrend: TrendPoint[]
  ticketTrend: TrendPoint[]
  isTrial: boolean
  trialStartDate: string | null
  trialEndDate: string | null
}) {
  const trialExpired = isTrial && trialEndDate ? new Date(trialEndDate) < new Date() : false
  const trialLabel = isTrial
    ? `Trial: ${formatUkDate(trialStartDate)} – ${formatUkDate(trialEndDate)}`
    : ''
  const [archives, setArchives] = useState<{ name: string; url: string; created_at: string }[]>([])
  const [archivesLoading, setArchivesLoading] = useState(false)
  const [supportGrant, setSupportGrant] = useState<{ active: boolean; expires_at: string; reason: string } | null>(null)
  const [grantingAccess, setGrantingAccess] = useState(false)
  const [revokingAccess, setRevokingAccess] = useState(false)
  const [expenseExportDaysAgo, setExpenseExportDaysAgo] = useState<number | null>(null)

  useEffect(() => {
    if (companyId) {
      setArchivesLoading(true)
      listCompanyArchives(companyId).then(a => { setArchives(a); setArchivesLoading(false) })
      loadSupportStatus()
      loadLastExpenseExport()
    }
  }, [companyId])

  async function loadLastExpenseExport() {
    const { data } = await supabase
      .from('expense_export_log')
      .select('exported_at')
      .eq('company_id', companyId)
      .order('exported_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (data) {
      const days = Math.floor((Date.now() - new Date(data.exported_at).getTime()) / (1000 * 60 * 60 * 24))
      setExpenseExportDaysAgo(days)
    } else {
      setExpenseExportDaysAgo(-1)
    }
  }

  async function loadSupportStatus() {
    const { data } = await supabase
      .from('tenant_support_access')
      .select('id, status, expires_at, reason')
      .eq('company_id', companyId)
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString())
      .order('expires_at', { ascending: false })
      .limit(1)
    if (data && data.length > 0) {
      setSupportGrant({ active: true, expires_at: data[0].expires_at, reason: data[0].reason })
    } else {
      setSupportGrant({ active: false, expires_at: '', reason: '' })
    }
  }

  async function grantPlatformAccess() {
    setGrantingAccess(true)
    const { error } = await callRpcDirect('extend_support_access', {
      p_company_id: companyId,
      p_hours: 48,
    })
    if (error) {
      alert('Failed to grant access: ' + error)
    }
    await loadSupportStatus()
    setGrantingAccess(false)
  }

  async function revokePlatformAccess() {
    setRevokingAccess(true)
    const { data } = await supabase
      .from('tenant_support_access')
      .select('id')
      .eq('company_id', companyId)
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString())
    if (data) {
      for (const g of data) {
        await callRpcDirect('revoke_support_access', { p_grant_id: g.id })
      }
    }
    await loadSupportStatus()
    setRevokingAccess(false)
  }

  const cards: {
    label: string; value: number; color: string; path: string
    chart?: 'line' | 'bar'; chartData?: TrendPoint[]
    suffix?: string; subtitle?: string; change?: number
  }[] = [
    { label: 'Total Employees', value: stats.totalEmployees, color: '#1565c0', path: '/admin/employees', chart: 'line', chartData: empTrend },
    { label: 'New Onboarders', value: stats.newOnboarders, color: '#e91e63', path: '/admin/onboarding' },
    { label: 'Benefits Enrolled', value: stats.benefits, color: '#7b1fa2', path: '/admin/benefits' },
    { label: 'Shifts & Rotas', value: stats.shiftsRotas, color: '#e65100', path: '/admin/shifts' },
    { label: 'Legal Timesheets', value: stats.legalTimesheets, color: '#00695c', path: '/admin/legal-timesheets' },
    { label: 'Performance 1:1s', value: stats.performance1to1s, color: '#c62828', path: '/admin/performance' },
    { label: 'Space Bookings', value: stats.spaceBookings, color: '#4527a0', path: '/admin/space-management' },
    { label: 'Announcements', value: stats.announcements, color: '#2e7d32', path: '/admin/announcements' },
    { label: 'Tickets Raised', value: stats.ticketsRaised, color: '#00897b', path: '/admin/tickets', chart: 'bar', chartData: ticketTrend },
    { label: 'Pending Expenses', value: stats.pendingExpenses, color: '#43a047', path: '/admin/expenses' },
    { label: 'Pending Leave', value: stats.pendingLeave, color: '#ff9800', path: '/admin/leave' },
    { label: 'Kudos Given', value: stats.kudos, color: '#fbc02d', path: '/admin/kudos' },
    { label: 'E-Learning', value: stats.elearningRate, color: '#26a69a', path: '/admin/elearning', suffix: '%' },
    { label: 'Upcoming Shifts', value: stats.upcomingShifts, color: '#ef6c00', path: '/admin/shifts' },
    { label: 'Spaces Available', value: stats.spacesAvailable, color: '#5e35b1', path: '/admin/space-management', subtitle: 'today' },
    { label: 'Assets Registered', value: stats.totalAssets, color: '#0277bd', path: '/admin/asset-management', change: stats.assetsChange },
  ]

  return (
    <div className="admin-dashboard">
      <div className="admin-page-header">
        <h2>{companyName}{trialLabel && <span style={{ fontWeight: 400, fontSize: 14, color: trialExpired ? '#c62828' : 'var(--text-secondary)' }}> ({trialLabel})</span>}</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <p>Company dashboard overview</p>
          <button onClick={() => navigate('/admin/dashboard-v2')} style={{ background: 'linear-gradient(135deg, #1a1a2e, #533483)', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>Try new dashboard</button>
        </div>
      </div>

      {(expenseExportDaysAgo === -1 || (expenseExportDaysAgo !== null && expenseExportDaysAgo >= 25)) && (
        <div className="cd-warning-banner" onClick={() => navigate('/admin/expenses')} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: '#fff3e0', border: '1px solid #ffb74d', borderRadius: 10, marginBottom: 16, cursor: 'pointer' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#e65100" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <div style={{ flex: 1 }}>
            <strong style={{ color: '#e65100', fontSize: 13 }}>
              {expenseExportDaysAgo === -1 ? 'Expenses have never been exported' : `Expense export is ${expenseExportDaysAgo} days old`}
            </strong>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: '#bf360c' }}>
              Tap here to export the latest expenses and receipts
            </p>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e65100" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
      )}

      <div className="cd-grid">
        {cards.map(c => (
          <button key={c.label} className="cd-card" onClick={() => navigate(c.path)}>
            <div className="cd-card-top">
              <div className="cd-card-meta">
                <span className="cd-card-label">{c.label}{c.subtitle && <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-muted, #8b8fa3)', marginLeft: 4 }}>({c.subtitle})</span>}</span>
                <span className="cd-card-value" style={{ color: c.color }}>
                  {c.value}{c.suffix || ''}
                  {c.change !== undefined && c.change !== 0 && (
                    <span style={{ fontSize: 12, fontWeight: 600, marginLeft: 6, color: c.change > 0 ? '#43a047' : '#e53935' }}>
                      {c.change > 0 ? '+' : ''}{c.change}%
                    </span>
                  )}
                </span>
              </div>
              <div className="cd-card-icon" style={{ background: c.color }}>
                <span style={{ fontSize: 18, fontWeight: 800, color: '#fff' }}>{c.value}{c.suffix || ''}</span>
              </div>
            </div>
            {c.chart && c.chartData && c.chartData.length > 1 && (
              <div className="cd-card-chart">
                {c.chart === 'line'
                  ? <MiniLineChart data={c.chartData} color={c.color} />
                  : <MiniBarChart data={c.chartData} color={c.color} />
                }
              </div>
            )}
          </button>
        ))}
      </div>

      {!archivesLoading && archives.length > 0 && (
        <div className="cd-archives-section">
          <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 12px', color: '#1a1a2e' }}>Company Archives</h3>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Archive</th>
                  <th>Created</th>
                  <th>Download</th>
                </tr>
              </thead>
              <tbody>
                {archives.map(a => (
                  <tr key={a.name}>
                    <td>{a.name}</td>
                    <td>{a.created_at ? new Date(a.created_at).toLocaleDateString('en-GB') : '-'}</td>
                    <td>
                      <a
                        href={a.url}
                        download
                        className="admin-btn-sm"
                        style={{ background: '#1565c0', color: '#fff', border: 'none', textDecoration: 'none', display: 'inline-block' }}
                      >
                        Download
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {supportGrant && (
        <div className="cd-archives-section" style={{ marginTop: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <div>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 4px', color: '#1a1a2e' }}>Platform Support Access</h3>
              <p style={{ fontSize: 13, color: '#8b8fa3', margin: 0 }}>
                Control whether the InflowHR platform team can access your company data for support
              </p>
            </div>
            <span className={`admin-badge ${supportGrant.active ? 'admin-badge-approved' : 'admin-badge-rejected'}`}>
              {supportGrant.active ? 'Access Granted' : 'No Access'}
            </span>
          </div>

          {supportGrant.active && (
            <div style={{ padding: '10px 14px', background: '#e8f5e9', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
              <strong>Active until:</strong>{' '}
              {new Date(supportGrant.expires_at).toLocaleDateString('en-GB')}{' '}
              {new Date(supportGrant.expires_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
              {supportGrant.reason && <> &mdash; <em>{supportGrant.reason}</em></>}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            {!supportGrant.active ? (
              <button
                className="admin-btn admin-btn-primary"
                onClick={grantPlatformAccess}
                disabled={grantingAccess}
              >
                {grantingAccess ? 'Granting...' : 'Grant Platform Access (48h)'}
              </button>
            ) : (
              <>
                <button
                  className="admin-btn admin-btn-primary"
                  onClick={grantPlatformAccess}
                  disabled={grantingAccess}
                >
                  {grantingAccess ? 'Extending...' : 'Extend 48h'}
                </button>
                <button
                  className="admin-btn"
                  style={{ background: '#c62828', color: '#fff', border: 'none' }}
                  onClick={revokePlatformAccess}
                  disabled={revokingAccess}
                >
                  {revokingAccess ? 'Revoking...' : 'Revoke Access'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function SuperAdminDash({ stats, navigate, archives }: { stats: AllCompanyStats; navigate: (p: string) => void; archives: ArchiveFile[] }) {
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
                <div className="sa-dash-bar-fill" style={{ width: `${(f.value / maxSub) * 100}%`, background: f.color }} />
              </div>
              <span className="sa-dash-bar-value">{f.value}</span>
            </div>
          ))}
        </div>
      </div>

      {archives.length > 0 && (
        <div className="cd-archives-section">
          <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 12px', color: '#1e1e2d' }}>Company Archives</h3>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Archive</th>
                  <th>Created</th>
                  <th>Download</th>
                </tr>
              </thead>
              <tbody>
                {archives.map((a, i) => (
                  <tr key={i}>
                    <td><strong>{a.companyName}</strong></td>
                    <td>{a.name}</td>
                    <td>{a.created_at ? new Date(a.created_at).toLocaleDateString('en-GB') : '-'}</td>
                    <td>
                      {a.url ? (
                        <a
                          href={a.url}
                          download
                          className="admin-btn-sm"
                          style={{ background: '#1565c0', color: '#fff', border: 'none', textDecoration: 'none', display: 'inline-block' }}
                        >
                          Download
                        </a>
                      ) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
