import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, callRpcDirect } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { listCompanyArchives } from '../../lib/companyArchive'

interface TrendPoint { label: string; value: number }

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function getGreeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

function Sparkline({ data, color }: { data: TrendPoint[]; color: string }) {
  if (data.length < 2) return null
  const max = Math.max(...data.map(d => d.value), 1)
  const w = 120
  const h = 36
  const pts = data.map((d, i) => ({
    x: 4 + (i / (data.length - 1)) * (w - 8),
    y: 4 + (1 - d.value / max) * (h - 8),
  }))
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
  const area = line + ` L${pts[pts.length - 1].x},${h} L${pts[0].x},${h} Z`
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
      <defs>
        <linearGradient id={`sg-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#sg-${color.replace('#', '')})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r="3" fill={color} />
    </svg>
  )
}

interface DockItem {
  label: string
  path: string
  svg: string
}

const DOCK: DockItem[] = [
  { label: 'Employees', path: '/admin/employees', svg: '<circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M17 11a4 4 0 1 0 0-8"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/>' },
  { label: 'Leave', path: '/admin/leave', svg: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>' },
  { label: 'Expenses', path: '/admin/expenses', svg: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>' },
  { label: 'Tickets', path: '/admin/tickets', svg: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/>' },
  { label: 'Onboarding', path: '/admin/onboarding', svg: '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/>' },
  { label: 'Kudos', path: '/admin/kudos', svg: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>' },
  { label: 'Guides', path: '/admin/user-guides', svg: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>' },
  { label: 'Classic view', path: '/admin', svg: '<polyline points="15 18 9 12 15 6"/>' },
]

export default function AdminDashboardModern() {
  const navigate = useNavigate()
  const { employeeName, avatarUrl } = useAuth()
  const { selectedCompanyId, selectedCompany } = useAdminCompany()
  const [loading, setLoading] = useState(true)
  const [dockOpen, setDockOpen] = useState(false)

  const [totalEmployees, setTotalEmployees] = useState(0)
  const [newOnboarders, setNewOnboarders] = useState(0)
  const [pendingExpenses, setPendingExpenses] = useState(0)
  const [pendingLeave, setPendingLeave] = useState(0)
  const [ticketsRaised, setTicketsRaised] = useState(0)
  const [kudosCount, setKudosCount] = useState(0)
  const [benefits, setBenefits] = useState(0)
  const [announcements, setAnnouncements] = useState(0)
  const [shiftsRotas, setShiftsRotas] = useState(0)
  const [performance1to1s, setPerformance1to1s] = useState(0)
  const [spaceBookings, setSpaceBookings] = useState(0)
  const [legalTimesheets, setLegalTimesheets] = useState(0)
  const [empTrend, setEmpTrend] = useState<TrendPoint[]>([])
  const [ticketTrend, setTicketTrend] = useState<TrendPoint[]>([])
  const [archives, setArchives] = useState<{ name: string; url: string; created_at: string }[]>([])
  const [supportGrant, setSupportGrant] = useState<{ active: boolean; expires_at: string; reason: string } | null>(null)
  const [grantingAccess, setGrantingAccess] = useState(false)
  const [revokingAccess, setRevokingAccess] = useState(false)
  const [expenseExportDaysAgo, setExpenseExportDaysAgo] = useState<number | null>(null)

  const firstName = employeeName.split(' ')[0] || 'Admin'
  const initials = employeeName.split(' ').map(n => n[0]).join('').toUpperCase() || '?'
  const isTrial = selectedCompany?.is_trial || false
  const trialEnd = selectedCompany?.trial_end_date || null
  const trialStart = selectedCompany?.trial_start_date || null
  const trialExpired = isTrial && trialEnd ? new Date(trialEnd) < new Date() : false

  useEffect(() => {
    if (selectedCompanyId) loadAll()
  }, [selectedCompanyId])

  async function loadAll() {
    setLoading(true)
    const cid = selectedCompanyId
    const eq = (q: any) => q.eq('company_id', cid)

    const [emp, onb, exp, leave, tick, kud, ben, ann, shi, perf, space, legal] = await Promise.all([
      eq(supabase.from('employees').select('id', { count: 'exact', head: true }).eq('is_active', true)),
      eq(supabase.from('onboarding').select('id', { count: 'exact', head: true }).eq('status', 'new')),
      eq(supabase.from('expense_claims').select('id', { count: 'exact', head: true }).eq('status', 'pending')),
      eq(supabase.from('leave_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending')),
      eq(supabase.from('hr_tickets').select('id', { count: 'exact', head: true })),
      eq(supabase.from('kudos').select('id', { count: 'exact', head: true })),
      eq(supabase.from('benefit_enrollments').select('id', { count: 'exact', head: true })),
      eq(supabase.from('announcements').select('id', { count: 'exact', head: true })),
      eq(supabase.from('shift_assignments').select('id', { count: 'exact', head: true })),
      eq(supabase.from('performance_reviews').select('id', { count: 'exact', head: true })),
      eq(supabase.from('space_bookings').select('id', { count: 'exact', head: true })),
      eq(supabase.from('legal_timesheet_entries').select('id', { count: 'exact', head: true })),
    ])

    setTotalEmployees(emp.count ?? 0)
    setNewOnboarders(onb.count ?? 0)
    setPendingExpenses(exp.count ?? 0)
    setPendingLeave(leave.count ?? 0)
    setTicketsRaised(tick.count ?? 0)
    setKudosCount(kud.count ?? 0)
    setBenefits(ben.count ?? 0)
    setAnnouncements(ann.count ?? 0)
    setShiftsRotas(shi.count ?? 0)
    setPerformance1to1s(perf.count ?? 0)
    setSpaceBookings(space.count ?? 0)
    setLegalTimesheets(legal.count ?? 0)

    const now = new Date()
    const empPts: TrendPoint[] = []
    const tickPts: TrendPoint[] = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0)
      const endStr = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`
      const startStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
      const label = MONTHS[d.getMonth()]
      const { count: ec } = await supabase.from('employees').select('id', { count: 'exact', head: true })
        .eq('company_id', cid).eq('is_active', true).lte('created_at', endStr + 'T23:59:59')
      empPts.push({ label, value: ec ?? 0 })
      const { count: tc } = await supabase.from('hr_tickets').select('id', { count: 'exact', head: true })
        .eq('company_id', cid).gte('created_at', startStr).lte('created_at', endStr + 'T23:59:59')
      tickPts.push({ label, value: tc ?? 0 })
    }
    setEmpTrend(empPts)
    setTicketTrend(tickPts)

    listCompanyArchives(cid).then(setArchives)
    loadSupportStatus(cid)
    loadExpenseExport(cid)
    setLoading(false)
  }

  async function loadExpenseExport(cid: string) {
    const { data } = await supabase.from('expense_export_log').select('exported_at')
      .eq('company_id', cid).order('exported_at', { ascending: false }).limit(1).maybeSingle()
    if (data) {
      setExpenseExportDaysAgo(Math.floor((Date.now() - new Date(data.exported_at).getTime()) / 86400000))
    } else {
      setExpenseExportDaysAgo(-1)
    }
  }

  async function loadSupportStatus(cid: string) {
    const { data } = await supabase.from('tenant_support_access').select('id, status, expires_at, reason')
      .eq('company_id', cid).eq('status', 'active').gt('expires_at', new Date().toISOString())
      .order('expires_at', { ascending: false }).limit(1)
    if (data && data.length > 0) {
      setSupportGrant({ active: true, expires_at: data[0].expires_at, reason: data[0].reason })
    } else {
      setSupportGrant({ active: false, expires_at: '', reason: '' })
    }
  }

  async function grantAccess() {
    setGrantingAccess(true)
    await callRpcDirect('extend_support_access', { p_company_id: selectedCompanyId, p_hours: 48 })
    await loadSupportStatus(selectedCompanyId)
    setGrantingAccess(false)
  }

  async function revokeAccess() {
    setRevokingAccess(true)
    const { data } = await supabase.from('tenant_support_access').select('id')
      .eq('company_id', selectedCompanyId).eq('status', 'active').gt('expires_at', new Date().toISOString())
    if (data) { for (const g of data) await callRpcDirect('revoke_support_access', { p_grant_id: g.id }) }
    await loadSupportStatus(selectedCompanyId)
    setRevokingAccess(false)
  }

  const cards: { label: string; value: number; path: string; accent: string; svg: string; spark?: TrendPoint[] }[] = [
    { label: 'Active Employees', value: totalEmployees, path: '/admin/employees', accent: '#6366f1', svg: '<circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/>', spark: empTrend },
    { label: 'New Onboarders', value: newOnboarders, path: '/admin/onboarding', accent: '#f43f5e', svg: '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/>' },
    { label: 'Pending Expenses', value: pendingExpenses, path: '/admin/expenses', accent: '#10b981', svg: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>' },
    { label: 'Pending Leave', value: pendingLeave, path: '/admin/leave', accent: '#f59e0b', svg: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>' },
    { label: 'Tickets Raised', value: ticketsRaised, path: '/admin/tickets', accent: '#06b6d4', svg: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/>', spark: ticketTrend },
    { label: 'Kudos Given', value: kudosCount, path: '/admin/kudos', accent: '#eab308', svg: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>' },
    { label: 'Benefits Enrolled', value: benefits, path: '/admin/benefits', accent: '#a855f7', svg: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>' },
    { label: 'Announcements', value: announcements, path: '/admin/announcements', accent: '#22c55e', svg: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>' },
    { label: 'Shifts & Rotas', value: shiftsRotas, path: '/admin/shifts', accent: '#f97316', svg: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>' },
    { label: 'Performance 1:1s', value: performance1to1s, path: '/admin/performance', accent: '#ec4899', svg: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>' },
    { label: 'Space Bookings', value: spaceBookings, path: '/admin/space-management', accent: '#8b5cf6', svg: '<rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 20 16 10 16 10 13 16 13 16 8"/>' },
    { label: 'Legal Timesheets', value: legalTimesheets, path: '/admin/legal-timesheets', accent: '#14b8a6', svg: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>' },
  ]

  return (
    <>
      <style>{CSS}</style>
      <div className="v2">
        {/* ── Gradient hero ── */}
        <div className="v2-hero">
          <div className="v2-hero-inner">
            <div>
              <p className="v2-date">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
              <h1 className="v2-greet">{getGreeting()}, {firstName}</h1>
              {isTrial && (
                <span className="v2-trial" style={{ color: trialExpired ? '#fca5a5' : '#fde68a' }}>
                  Trial: {fmtDate(trialStart)} – {fmtDate(trialEnd)}
                </span>
              )}
            </div>
            {avatarUrl
              ? <img className="v2-avatar" src={avatarUrl} alt="" />
              : <div className="v2-avatar v2-avatar-init">{initials}</div>
            }
          </div>
        </div>

        {/* ── Expense export warning ── */}
        {(expenseExportDaysAgo === -1 || (expenseExportDaysAgo !== null && expenseExportDaysAgo >= 25)) && (
          <button className="v2-warn" onClick={() => navigate('/admin/expenses')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            <span>{expenseExportDaysAgo === -1 ? 'Expenses have never been exported' : `Expense export is ${expenseExportDaysAgo} days old`} — tap to export</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        )}

        {/* ── Stat cards ── */}
        {loading ? <div className="v2-loading">Loading dashboard...</div> : (
          <div className="v2-grid">
            {cards.map(c => (
              <button key={c.label} className="v2-card" onClick={() => navigate(c.path)}>
                <div className="v2-card-head">
                  <div className="v2-card-icon" style={{ background: `${c.accent}18`, color: c.accent }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: c.svg }} />
                  </div>
                  <span className="v2-card-val" style={{ color: c.accent }}>{c.value}</span>
                </div>
                <span className="v2-card-lbl">{c.label}</span>
                {c.spark && c.spark.length > 1 && (
                  <div className="v2-card-spark"><Sparkline data={c.spark} color={c.accent} /></div>
                )}
              </button>
            ))}
          </div>
        )}

        {/* ── Archives ── */}
        {archives.length > 0 && (
          <div className="v2-section">
            <h3 className="v2-sec-title">Company Archives</h3>
            <div className="v2-archives">
              {archives.map(a => (
                <div key={a.name} className="v2-archive-row">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ opacity: 0.4, flexShrink: 0 }}><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
                  <span className="v2-archive-name">{a.name}</span>
                  <span className="v2-archive-date">{a.created_at ? new Date(a.created_at).toLocaleDateString('en-GB') : ''}</span>
                  <a href={a.url} download className="v2-archive-dl">Download</a>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Support access ── */}
        {supportGrant && (
          <div className="v2-section">
            <div className="v2-support-head">
              <div>
                <h3 className="v2-sec-title" style={{ marginBottom: 4 }}>Platform Support Access</h3>
                <p className="v2-muted">Control whether the InflowHR team can access your company data</p>
              </div>
              <span className={`v2-badge ${supportGrant.active ? 'v2-badge-on' : 'v2-badge-off'}`}>
                {supportGrant.active ? 'Granted' : 'No Access'}
              </span>
            </div>
            {supportGrant.active && (
              <div className="v2-support-info">
                <strong>Active until:</strong> {new Date(supportGrant.expires_at).toLocaleDateString('en-GB')} {new Date(supportGrant.expires_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                {supportGrant.reason && <> — <em>{supportGrant.reason}</em></>}
              </div>
            )}
            <div className="v2-support-btns">
              {!supportGrant.active ? (
                <button className="v2-btn v2-btn-primary" onClick={grantAccess} disabled={grantingAccess}>
                  {grantingAccess ? 'Granting...' : 'Grant Platform Access (48h)'}
                </button>
              ) : (
                <>
                  <button className="v2-btn v2-btn-primary" onClick={grantAccess} disabled={grantingAccess}>
                    {grantingAccess ? 'Extending...' : 'Extend 48h'}
                  </button>
                  <button className="v2-btn v2-btn-danger" onClick={revokeAccess} disabled={revokingAccess}>
                    {revokingAccess ? 'Revoking...' : 'Revoke Access'}
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Floating dock ── */}
        <div className={`v2-dock-wrap ${dockOpen ? 'v2-dock-open' : ''}`}>
          {dockOpen && <div className="v2-dock-overlay" onClick={() => setDockOpen(false)} />}
          <div className={`v2-dock ${dockOpen ? 'v2-dock-expanded' : ''}`}>
            {dockOpen ? (
              <div className="v2-dock-grid">
                {DOCK.map(item => (
                  <button key={item.path} className="v2-dock-item" onClick={() => { navigate(item.path); setDockOpen(false) }}>
                    <div className="v2-dock-icon">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: item.svg }} />
                    </div>
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            ) : null}
            <button className="v2-dock-toggle" onClick={() => setDockOpen(!dockOpen)}>
              {dockOpen ? (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              ) : (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>
              )}
              {!dockOpen && <span>Quick nav</span>}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

const CSS = `
/* ═══ V2 Admin Dashboard — self-contained, no global side-effects ═══ */

.v2 {
  --v2-radius: 18px;
  --v2-glass: rgba(255,255,255,0.06);
  --v2-border: rgba(255,255,255,0.08);
  --v2-text: #f0f0f5;
  --v2-muted: #8b8fa3;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', sans-serif;
  color: var(--v2-text);
  min-height: calc(100vh - 56px);
  background: #0c0c12;
  padding-bottom: 100px;
}

/* ── Hero ── */
.v2-hero {
  padding: 40px 32px 36px;
  background:
    radial-gradient(ellipse 80% 70% at 20% 30%, rgba(139,92,246,0.35), transparent 60%),
    radial-gradient(ellipse 60% 60% at 80% 60%, rgba(236,72,153,0.25), transparent 55%),
    radial-gradient(ellipse 70% 50% at 50% 0%, rgba(59,130,246,0.2), transparent 50%),
    radial-gradient(ellipse 50% 80% at 90% 10%, rgba(245,158,11,0.15), transparent 50%),
    linear-gradient(160deg, #1a1035 0%, #0f172a 40%, #0c0c18 100%);
  border-radius: 0 0 var(--v2-radius) var(--v2-radius);
}
.v2-hero-inner {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  max-width: 900px;
}
.v2-date {
  font-size: 14px;
  color: #c4b5fd;
  margin: 0 0 6px;
  font-weight: 500;
  letter-spacing: 0.02em;
}
.v2-greet {
  font-size: 32px;
  font-weight: 700;
  color: #fff;
  margin: 0;
  letter-spacing: -0.025em;
  line-height: 1.15;
}
.v2-trial {
  display: inline-block;
  margin-top: 8px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.03em;
}
.v2-avatar {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid rgba(255,255,255,0.15);
  flex-shrink: 0;
}
.v2-avatar-init {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: 700;
  color: #fff;
  background: rgba(255,255,255,0.1);
}

/* ── Warning banner ── */
.v2-warn {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 20px 32px 0;
  padding: 14px 18px;
  background: rgba(245,158,11,0.08);
  border: 1px solid rgba(245,158,11,0.2);
  border-radius: var(--v2-radius);
  color: #fde68a;
  font-size: 13px;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  transition: background 0.2s;
}
.v2-warn:hover { background: rgba(245,158,11,0.14); }
.v2-warn span { flex: 1; }

/* ── Loading ── */
.v2-loading {
  text-align: center;
  padding: 48px;
  color: var(--v2-muted);
  font-size: 14px;
}

/* ── Card grid ── */
.v2-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
  padding: 28px 32px 0;
}
.v2-card {
  background: var(--v2-glass);
  border: 1px solid var(--v2-border);
  border-radius: var(--v2-radius);
  padding: 20px;
  text-align: left;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(.4,0,.2,1);
  font-family: inherit;
  color: var(--v2-text);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.v2-card:hover {
  background: rgba(255,255,255,0.1);
  border-color: rgba(255,255,255,0.15);
  transform: translateY(-3px);
  box-shadow: 0 12px 40px rgba(0,0,0,0.35);
}
.v2-card-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}
.v2-card-icon {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.v2-card-val {
  font-size: 28px;
  font-weight: 800;
  letter-spacing: -0.03em;
  line-height: 1;
}
.v2-card-lbl {
  font-size: 12px;
  color: var(--v2-muted);
  font-weight: 500;
  letter-spacing: 0.01em;
}
.v2-card-spark { margin-top: 4px; }

/* ── Sections ── */
.v2-section {
  margin: 24px 32px 0;
  background: var(--v2-glass);
  border: 1px solid var(--v2-border);
  border-radius: var(--v2-radius);
  padding: 24px;
}
.v2-sec-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--v2-text);
  margin: 0 0 16px;
}
.v2-muted {
  font-size: 12px;
  color: var(--v2-muted);
  margin: 0;
}

/* Archives */
.v2-archives { display: flex; flex-direction: column; gap: 0; }
.v2-archive-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid var(--v2-border);
  font-size: 13px;
}
.v2-archive-row:last-child { border-bottom: none; }
.v2-archive-name { flex: 1; color: var(--v2-text); font-weight: 500; }
.v2-archive-date { color: var(--v2-muted); font-size: 12px; }
.v2-archive-dl {
  background: rgba(99,102,241,0.15);
  color: #a5b4fc;
  text-decoration: none;
  font-size: 12px;
  font-weight: 600;
  padding: 5px 14px;
  border-radius: 8px;
  transition: background 0.2s;
}
.v2-archive-dl:hover { background: rgba(99,102,241,0.25); }

/* Support */
.v2-support-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 16px;
}
.v2-badge {
  font-size: 11px;
  font-weight: 700;
  padding: 4px 12px;
  border-radius: 100px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.v2-badge-on { background: rgba(34,197,94,0.15); color: #86efac; }
.v2-badge-off { background: rgba(239,68,68,0.15); color: #fca5a5; }
.v2-support-info {
  background: rgba(34,197,94,0.08);
  border-radius: 12px;
  padding: 12px 16px;
  font-size: 13px;
  color: #bbf7d0;
  margin-bottom: 16px;
}
.v2-support-btns { display: flex; gap: 10px; }
.v2-btn {
  padding: 10px 20px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: none;
  font-family: inherit;
  transition: all 0.2s;
}
.v2-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.v2-btn-primary { background: #6366f1; color: #fff; }
.v2-btn-primary:hover:not(:disabled) { background: #818cf8; }
.v2-btn-danger { background: rgba(239,68,68,0.15); color: #fca5a5; }
.v2-btn-danger:hover:not(:disabled) { background: rgba(239,68,68,0.25); }

/* ── Floating dock ── */
.v2-dock-wrap {
  position: fixed;
  bottom: 24px;
  right: 32px;
  z-index: 1000;
}
.v2-dock-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.4);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  z-index: 999;
}
.v2-dock {
  position: relative;
  z-index: 1001;
}
.v2-dock-expanded {
  background: rgba(20,20,30,0.95);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 24px;
  padding: 24px 24px 16px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.5);
}
.v2-dock-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-bottom: 16px;
}
.v2-dock-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  background: none;
  border: none;
  cursor: pointer;
  padding: 12px 8px;
  border-radius: 16px;
  color: var(--v2-muted);
  font-size: 11px;
  font-weight: 500;
  font-family: inherit;
  transition: all 0.2s;
  min-width: 72px;
}
.v2-dock-item:hover {
  background: rgba(255,255,255,0.08);
  color: #fff;
}
.v2-dock-icon {
  width: 44px;
  height: 44px;
  border-radius: 14px;
  background: rgba(255,255,255,0.06);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
}
.v2-dock-item:hover .v2-dock-icon {
  background: rgba(99,102,241,0.2);
  color: #a5b4fc;
}
.v2-dock-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: center;
  margin: 0 auto;
  padding: 12px 24px;
  border-radius: 100px;
  border: none;
  cursor: pointer;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  background: linear-gradient(135deg, #6366f1, #a855f7, #ec4899);
  box-shadow: 0 4px 20px rgba(99,102,241,0.4);
  transition: all 0.3s;
}
.v2-dock-toggle:hover {
  box-shadow: 0 6px 28px rgba(99,102,241,0.5);
  transform: scale(1.04);
}
.v2-dock-expanded .v2-dock-toggle {
  background: rgba(255,255,255,0.08);
  box-shadow: none;
  border-radius: 14px;
  padding: 10px 20px;
  color: var(--v2-muted);
}
.v2-dock-expanded .v2-dock-toggle:hover {
  background: rgba(255,255,255,0.12);
  color: #fff;
  transform: none;
}

@media (max-width: 900px) {
  .v2-grid { grid-template-columns: repeat(2, 1fr); }
  .v2-dock-grid { grid-template-columns: repeat(3, 1fr); }
}
`
