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
  subsSurveys: number
  subsAssets: number
  subsElearning: number
  subsCheckIn: number
  totalOnboarders: number
  totalAnnouncements: number
  totalTickets: number
  totalBenefitTypes: number
  totalNotifications: number
  unreadNotifications: number
  actionNotifications: number
  totalKudos: number
  totalKudosLikes: number
  totalSurveyDeployments: number
  totalSurveyResponses: number
  totalSurveyRecipients: number
  totalOneToOnes: number
  completedOneToOnes: number
  totalGoals: number
  activeGoals: number
  totalSpaceBookings: number
  todaySpaceBookings: number
  totalLeavers: number
  totalMovers: number
  completedOnboarders: number
  pendingOnboarders: number
  completedOffboarders: number
  pendingOffboarders: number
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
  aiQueries: number
  aiAvgPerPerson: number
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
  const [saTrends, setSaTrends] = useState<Record<string, TrendPoint[]>>({})

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
    const todayStr = new Date().toISOString().slice(0, 10)
    const { data: subCos } = await supabase.from('companies').select('id').eq('is_trial', false)
    const subIds = (subCos || []).map(c => c.id)

    const [metricsRes, compRes, featRes, annRes, benRes, notifRes, unreadNotifRes, actionNotifRes, kudosRes, kudosLikesRes, surveyDepRes, otoRes, otoCompRes, goalsRes, activeGoalsRes, bookingsRes, todayBookingsRes, leaverRes, moverRes, compOnbRes, pendOnbRes, compOffRes, pendOffRes] = await Promise.all([
      supabase.rpc('get_all_company_metrics'),
      supabase.from('companies').select('id', { count: 'exact', head: true }).eq('is_trial', false),
      supabase.from('company_features').select('feature_key, company_id').eq('is_enabled', true),
      supabase.from('announcements').select('id', { count: 'exact', head: true }),
      supabase.from('benefit_types').select('id', { count: 'exact', head: true }),
      supabase.from('notifications').select('id', { count: 'exact', head: true }),
      supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('is_read', false),
      supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('type', 'action').eq('is_read', false),
      supabase.from('kudos').select('id', { count: 'exact', head: true }),
      supabase.from('kudos').select('like_count'),
      supabase.from('survey_deployments').select('id, total_recipients, total_responses'),
      supabase.from('one_to_one_meetings').select('id', { count: 'exact', head: true }),
      supabase.from('one_to_one_meetings').select('id', { count: 'exact', head: true }).eq('status', 'completed'),
      supabase.from('performance_goals').select('id', { count: 'exact', head: true }),
      supabase.from('performance_goals').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('space_bookings').select('id', { count: 'exact', head: true }),
      supabase.from('space_bookings').select('id', { count: 'exact', head: true }).eq('booking_date', todayStr),
      supabase.from('offboarding').select('id', { count: 'exact', head: true }).in('company_id', subIds),
      supabase.from('role_changes').select('id', { count: 'exact', head: true }).in('company_id', subIds),
      supabase.from('onboarding').select('id', { count: 'exact', head: true }).eq('is_complete', true).in('company_id', subIds),
      supabase.from('onboarding').select('id', { count: 'exact', head: true }).eq('is_complete', false).in('company_id', subIds),
      supabase.from('offboarding').select('id', { count: 'exact', head: true }).eq('is_complete', true).in('company_id', subIds),
      supabase.from('offboarding').select('id', { count: 'exact', head: true }).eq('is_complete', false).in('company_id', subIds),
    ])
    const metrics = (metricsRes.data || []) as { employee_count: number; total_employees: number; open_tickets: number; pending_onboarding: number }[]
    const totalEmployees = metrics.reduce((s, m) => s + (m.total_employees || 0), 0)
    const totalTickets = metrics.reduce((s, m) => s + (m.open_tickets || 0), 0)
    const totalOnboarders = metrics.reduce((s, m) => s + (m.pending_onboarding || 0), 0)
    const features = (featRes.data || []) as { feature_key: string; company_id: string }[]
    const countFeature = (key: string) => features.filter(f => f.feature_key === key).length

    const surveyDeps = (surveyDepRes.data || []) as { id: string; total_recipients: number; total_responses: number }[]
    const totalSurveyRecipients = surveyDeps.reduce((s, d) => s + (d.total_recipients || 0), 0)
    const totalSurveyResponses = surveyDeps.reduce((s, d) => s + (d.total_responses || 0), 0)
    const totalKudosLikes = ((kudosLikesRes.data || []) as { like_count: number }[]).reduce((s, k) => s + (k.like_count || 0), 0)

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
      subsSurveys: countFeature('surveys'),
      subsAssets: countFeature('asset_management'),
      subsElearning: countFeature('elearning'),
      subsCheckIn: countFeature('check_in'),
      totalOnboarders,
      totalAnnouncements: annRes.count ?? 0,
      totalTickets,
      totalBenefitTypes: benRes.count ?? 0,
      totalNotifications: notifRes.count ?? 0,
      unreadNotifications: unreadNotifRes.count ?? 0,
      actionNotifications: actionNotifRes.count ?? 0,
      totalKudos: kudosRes.count ?? 0,
      totalKudosLikes,
      totalSurveyDeployments: surveyDeps.length,
      totalSurveyResponses,
      totalSurveyRecipients,
      totalOneToOnes: otoRes.count ?? 0,
      completedOneToOnes: otoCompRes.count ?? 0,
      totalGoals: goalsRes.count ?? 0,
      activeGoals: activeGoalsRes.count ?? 0,
      totalSpaceBookings: bookingsRes.count ?? 0,
      todaySpaceBookings: todayBookingsRes.count ?? 0,
      totalLeavers: leaverRes.count ?? 0,
      totalMovers: moverRes.count ?? 0,
      completedOnboarders: compOnbRes.count ?? 0,
      pendingOnboarders: pendOnbRes.count ?? 0,
      completedOffboarders: compOffRes.count ?? 0,
      pendingOffboarders: pendOffRes.count ?? 0,
    })
    setLoading(false)

    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    const now = new Date()
    const trends: Record<string, TrendPoint[]> = { employees: [], onboarders: [], notifications: [], kudos: [], tickets: [], bookings: [] }
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0)
      const startStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
      const endStr = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`
      const label = MONTHS[d.getMonth()]

      const [empC, onbC, notC, kudC, tickC, bookC] = await Promise.all([
        supabase.from('employees').select('id', { count: 'exact', head: true }).eq('is_active', true).lte('created_at', endStr + 'T23:59:59'),
        supabase.from('onboarding').select('id', { count: 'exact', head: true }).gte('created_at', startStr).lte('created_at', endStr + 'T23:59:59'),
        supabase.from('notifications').select('id', { count: 'exact', head: true }).gte('created_at', startStr).lte('created_at', endStr + 'T23:59:59'),
        supabase.from('kudos').select('id', { count: 'exact', head: true }).gte('created_at', startStr).lte('created_at', endStr + 'T23:59:59'),
        supabase.from('hr_tickets').select('id', { count: 'exact', head: true }).gte('created_at', startStr).lte('created_at', endStr + 'T23:59:59'),
        supabase.from('space_bookings').select('id', { count: 'exact', head: true }).gte('booking_date', startStr).lte('booking_date', endStr),
      ])
      trends.employees.push({ label, value: empC.count ?? 0 })
      trends.onboarders.push({ label, value: onbC.count ?? 0 })
      trends.notifications.push({ label, value: notC.count ?? 0 })
      trends.kudos.push({ label, value: kudC.count ?? 0 })
      trends.tickets.push({ label, value: tickC.count ?? 0 })
      trends.bookings.push({ label, value: bookC.count ?? 0 })
    }
    setSaTrends(trends)
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

    const [enrolAll, enrolDone, upShifts, totalSpaces, bookedSpaces, assetsNow, assetsPrev, aiUsageRes] = await Promise.all([
      eq(supabase.from('elearning_completions').select('course_id', { count: 'exact', head: true })),
      eq(supabase.from('elearning_completions').select('course_id', { count: 'exact', head: true }).not('completed_at', 'is', null)),
      eq(supabase.from('shift_assignments').select('id', { count: 'exact', head: true }).gte('shift_date', todayStr)),
      eq(supabase.from('spaces').select('id', { count: 'exact', head: true }).eq('is_active', true)),
      eq(supabase.from('space_bookings').select('id', { count: 'exact', head: true }).eq('booking_date', todayStr)),
      eq(supabase.from('company_assets').select('id', { count: 'exact', head: true })),
      eq(supabase.from('company_assets').select('id', { count: 'exact', head: true }).lte('created_at', monthAgoEnd + 'T23:59:59')),
      supabase.from('ai_help_usage').select('query_count').eq('company_id', cid),
    ])

    const enrolTotal = enrolAll.count ?? 0
    const enrolComplete = enrolDone.count ?? 0
    const elearningRate = enrolTotal > 0 ? Math.round((enrolComplete / enrolTotal) * 100) : 0
    const assetsNowCount = assetsNow.count ?? 0
    const assetsPrevCount = assetsPrev.count ?? 0
    const assetsChange = assetsPrevCount > 0 ? Math.round(((assetsNowCount - assetsPrevCount) / assetsPrevCount) * 100) : (assetsNowCount > 0 ? 100 : 0)

    const aiQueries = (aiUsageRes.data || []).reduce((s: number, r: any) => s + (r.query_count || 0), 0)
    const activeEmpCount = emp.count ?? 0
    const aiAvgPerPerson = activeEmpCount > 0 ? Math.round((aiQueries / activeEmpCount) * 10) / 10 : 0

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
      aiQueries,
      aiAvgPerPerson,
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

  if (isSuperAdmin && allStats) return <SuperAdminDash stats={allStats} navigate={navigate} archives={allArchives} trends={saTrends} />

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
  const uid = `mini-lg-${color.replace('#', '')}`
  const pts = data.map((d, i) => ({
    x: pad + (i / (data.length - 1)) * (w - pad * 2),
    y: pad + (1 - d.value / max) * (h - pad * 2 - 10),
  }))
  const smoothLine = pts.reduce((acc, p, i) => {
    if (i === 0) return `M${p.x},${p.y}`
    const prev = pts[i - 1]
    const cpx = (prev.x + p.x) / 2
    return acc + ` C${cpx},${prev.y} ${cpx},${p.y} ${p.x},${p.y}`
  }, '')
  const area = smoothLine + ` L${pts[pts.length - 1].x},${h - 10} L${pts[0].x},${h - 10} Z`

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
      <defs>
        <linearGradient id={uid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${uid})`} />
      <path d={smoothLine} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={i === pts.length - 1 ? 3 : 0} fill={i === pts.length - 1 ? '#fff' : 'none'} stroke={i === pts.length - 1 ? color : 'none'} strokeWidth="2" />
      ))}
      {data.map((d, i) => (
        <text key={i} x={pts[i].x} y={h - 1} textAnchor="middle" fontSize="8" fill="#9b9cb5" fontWeight="500">{d.label}</text>
      ))}
    </svg>
  )
}

function MiniBarChart({ data, color, height = 48 }: { data: TrendPoint[]; color: string; height?: number }) {
  if (data.length === 0) return null
  const max = Math.max(...data.map(d => d.value), 1)
  const w = 160
  const h = height
  const barW = Math.min(14, (w - 8) / data.length - 3)
  const r = Math.min(barW / 2, 4)

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
      <defs>
        <linearGradient id={`mini-bar-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} />
          <stop offset="100%" stopColor={color} stopOpacity="0.5" />
        </linearGradient>
      </defs>
      {data.map((d, i) => {
        const x = 4 + i * ((w - 8) / data.length) + ((w - 8) / data.length - barW) / 2
        const barH = Math.max((d.value / max) * (h - 16), 2)
        const isLast = i === data.length - 1
        return (
          <g key={i}>
            <rect x={x} y={h - 12 - barH} width={barW} height={barH} rx={r} ry={r} fill={isLast ? `url(#mini-bar-${color.replace('#', '')})` : color + '40'} />
            <text x={x + barW / 2} y={h - 1} textAnchor="middle" fontSize="8" fill="#9b9cb5" fontWeight="500">{d.label}</text>
          </g>
        )
      })}
    </svg>
  )
}

function LargeChart({ data, color, type }: { data: TrendPoint[]; color: string; type: 'line' | 'bar' }) {
  if (data.length < 2) return null
  const max = Math.max(...data.map(d => d.value), 1)
  const w = 400
  const h = 160
  const padL = 38
  const padR = 14
  const padT = 24
  const padB = 26
  const chartW = w - padL - padR
  const chartH = h - padT - padB
  const uid = `sa-${color.replace('#', '')}-${type}`

  const gridLines = 4
  const gridVals = Array.from({ length: gridLines + 1 }, (_, i) => Math.round((max / gridLines) * i))

  if (type === 'line') {
    const pts = data.map((d, i) => ({
      x: padL + (i / (data.length - 1)) * chartW,
      y: padT + (1 - d.value / max) * chartH,
    }))
    const smoothLine = pts.reduce((acc, p, i) => {
      if (i === 0) return `M${p.x},${p.y}`
      const prev = pts[i - 1]
      const cpx = (prev.x + p.x) / 2
      return acc + ` C${cpx},${prev.y} ${cpx},${p.y} ${p.x},${p.y}`
    }, '')
    const area = smoothLine + ` L${pts[pts.length - 1].x},${padT + chartH} L${pts[0].x},${padT + chartH} Z`

    return (
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
        <defs>
          <linearGradient id={uid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0.01" />
          </linearGradient>
        </defs>
        {gridVals.map((v, i) => {
          const y = padT + (1 - v / max) * chartH
          return (
            <g key={i}>
              <line x1={padL} y1={y} x2={w - padR} y2={y} stroke="#eeeef4" strokeWidth="1" />
              <text x={padL - 8} y={y + 3.5} textAnchor="end" fontSize="9.5" fill="#b0b2c6" fontWeight="500">{v}</text>
            </g>
          )
        })}
        <path d={area} fill={`url(#${uid})`} />
        <path d={smoothLine} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
        {pts.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={4} fill="#fff" stroke={color} strokeWidth="2.5" />
            <text x={p.x} y={h - 6} textAnchor="middle" fontSize="10" fill="#9b9cb5" fontWeight="500">{data[i].label}</text>
            <text x={p.x} y={p.y - 10} textAnchor="middle" fontSize="10" fontWeight="700" fill="#1e1e2d">{data[i].value}</text>
          </g>
        ))}
      </svg>
    )
  }

  const barW = Math.min(28, chartW / data.length - 10)
  const r = Math.min(barW / 2, 6)
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
      <defs>
        <linearGradient id={uid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="1" />
          <stop offset="100%" stopColor={color} stopOpacity="0.55" />
        </linearGradient>
        <linearGradient id={`${uid}-dim`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.45" />
          <stop offset="100%" stopColor={color} stopOpacity="0.18" />
        </linearGradient>
      </defs>
      {gridVals.map((v, i) => {
        const y = padT + (1 - v / max) * chartH
        return (
          <g key={i}>
            <line x1={padL} y1={y} x2={w - padR} y2={y} stroke="#eeeef4" strokeWidth="1" />
            <text x={padL - 8} y={y + 3.5} textAnchor="end" fontSize="9.5" fill="#b0b2c6" fontWeight="500">{v}</text>
          </g>
        )
      })}
      {data.map((d, i) => {
        const x = padL + (i + 0.5) * (chartW / data.length) - barW / 2
        const barH = Math.max((d.value / max) * chartH, 2)
        const y = padT + chartH - barH
        const isLast = i === data.length - 1
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={barH} rx={r} ry={r} fill={`url(#${isLast ? uid : uid + '-dim'})`} />
            <text x={x + barW / 2} y={h - 6} textAnchor="middle" fontSize="10" fill="#9b9cb5" fontWeight="500">{d.label}</text>
            <text x={x + barW / 2} y={y - 6} textAnchor="middle" fontSize="10" fontWeight="700" fill="#1e1e2d">{d.value}</text>
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
    { label: 'AI Queries', value: stats.aiQueries, color: '#7c5cfc', path: '/admin/integrations', subtitle: `${stats.aiAvgPerPerson} avg/person` },
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

function IfoDonutChart({ stats }: { stats: AllCompanyStats }) {
  const segments = [
    { label: 'Onboarders Completed', value: stats.completedOnboarders, color: '#e53935' },
    { label: 'Onboarders Pending', value: stats.pendingOnboarders, color: '#7e57c2' },
    { label: 'Offboarders Completed', value: stats.completedOffboarders, color: '#ce93d8' },
    { label: 'Offboarders Pending', value: stats.pendingOffboarders, color: '#f8bbd0' },
    { label: 'Movers / Persona Actions', value: stats.totalMovers, color: '#ffe0b2' },
  ]
  const total = segments.reduce((s, seg) => s + seg.value, 0)
  const cx = 90, cy = 90, midR = 66, strokeW = 26, gapAngle = 0.06

  const activeSegments = segments.filter(s => s.value > 0)
  const arcs: { d: string; color: string }[] = []
  if (total > 0) {
    let angle = -Math.PI / 2
    for (const seg of activeSegments) {
      const sweep = (seg.value / total) * Math.PI * 2 - (activeSegments.length > 1 ? gapAngle : 0)
      if (sweep <= 0) { angle += (seg.value / total) * Math.PI * 2; continue }
      const x1 = cx + midR * Math.cos(angle)
      const y1 = cy + midR * Math.sin(angle)
      const x2 = cx + midR * Math.cos(angle + sweep)
      const y2 = cy + midR * Math.sin(angle + sweep)
      const large = sweep > Math.PI ? 1 : 0
      arcs.push({
        d: `M${x1},${y1} A${midR},${midR} 0 ${large} 1 ${x2},${y2}`,
        color: seg.color,
      })
      angle += sweep + gapAngle
    }
  }

  return (
    <div className="sa-chart-panel">
      <h4 className="sa-chart-title">InflowOnboarder</h4>
      <p className="sa-chart-subtitle">Actions completed & pending</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginTop: 8 }}>
        <div style={{ position: 'relative', width: 180, height: 180, flexShrink: 0 }}>
          <svg width="180" height="180" viewBox="0 0 180 180">
            {total === 0 ? (
              <circle cx={cx} cy={cy} r={midR} fill="none" stroke="#eeeef4" strokeWidth={strokeW} />
            ) : (
              arcs.map((a, i) => <path key={i} d={a.d} fill="none" stroke={a.color} strokeWidth={strokeW} strokeLinecap="round" />)
            )}
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <span style={{ fontSize: 28, fontWeight: 800, color: '#1e1e2d', lineHeight: 1 }}>{total}</span>
            <span style={{ fontSize: 10, fontWeight: 600, color: '#9b9cb5', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 }}>Total</span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          {segments.map(seg => (
            <div key={seg.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 12, height: 12, borderRadius: 2, background: seg.color, flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: '#555', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{seg.label}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#1e1e2d', marginLeft: 'auto' }}>{seg.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function SuperAdminDash({ stats, navigate, archives, trends }: { stats: AllCompanyStats; navigate: (p: string) => void; archives: ArchiveFile[]; trends: Record<string, TrendPoint[]> }) {
  const [aiMonthly, setAiMonthly] = useState<{ month: string; tokens: number; queries: number; cost: number }[]>([])
  const [aiCompanies, setAiCompanies] = useState<{ name: string; queries: number; tokens: number; cost: number }[]>([])
  const [showAiPopup, setShowAiPopup] = useState(false)

  useEffect(() => {
    loadAiCosts()
  }, [])

  async function loadAiCosts() {
    const now = new Date()
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    const monthly: { month: string; tokens: number; queries: number; cost: number }[] = []
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0)
      const startStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
      const endStr = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`
      const { data } = await supabase.from('ai_help_usage')
        .select('query_count, total_tokens')
        .gte('query_date', startStr)
        .lte('query_date', endStr)
      const tokens = (data || []).reduce((s, r) => s + (r.total_tokens || 0), 0)
      const queries = (data || []).reduce((s, r) => s + (r.query_count || 0), 0)
      const cost = tokens * 0.00000075
      monthly.push({ month: `${MONTHS[d.getMonth()]} ${d.getFullYear().toString().slice(2)}`, tokens, queries, cost })
    }
    setAiMonthly(monthly)

    const thisStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
    const thisEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    const thisEndStr = `${thisEnd.getFullYear()}-${String(thisEnd.getMonth() + 1).padStart(2, '0')}-${String(thisEnd.getDate()).padStart(2, '0')}`
    const { data: thisMonth } = await supabase.from('ai_help_usage')
      .select('company_id, query_count, total_tokens')
      .gte('query_date', thisStart)
      .lte('query_date', thisEndStr)

    const companyMap: Record<string, { queries: number; tokens: number }> = {}
    for (const r of (thisMonth || [])) {
      if (!companyMap[r.company_id]) companyMap[r.company_id] = { queries: 0, tokens: 0 }
      companyMap[r.company_id].queries += r.query_count || 0
      companyMap[r.company_id].tokens += r.total_tokens || 0
    }

    const companyIds = Object.keys(companyMap)
    if (companyIds.length > 0) {
      const { data: companies } = await supabase.from('companies')
        .select('id, name')
        .in('id', companyIds)
      const nameMap: Record<string, string> = {}
      for (const c of (companies || [])) nameMap[c.id] = c.name
      const list = companyIds.map(id => ({
        name: nameMap[id] || id.slice(0, 8),
        queries: companyMap[id].queries,
        tokens: companyMap[id].tokens,
        cost: companyMap[id].tokens * 0.00000075,
      })).sort((a, b) => b.cost - a.cost)
      setAiCompanies(list)
    }
  }

  const surveyCompletionRate = stats.totalSurveyRecipients > 0 ? Math.round((stats.totalSurveyResponses / stats.totalSurveyRecipients) * 100) : 0
  const otoCompletionRate = stats.totalOneToOnes > 0 ? Math.round((stats.completedOneToOnes / stats.totalOneToOnes) * 100) : 0

  const totalAiCostYear = aiMonthly.reduce((s, m) => s + m.cost, 0)
  const totalAiQueriesMonth = aiMonthly.length > 0 ? aiMonthly[aiMonthly.length - 1].queries : 0
  const totalAiCostMonth = aiMonthly.length > 0 ? aiMonthly[aiMonthly.length - 1].cost : 0

  const cards: { label: string; value: string; color: string; path: string; sub?: string }[] = [
    { label: 'Employees', value: String(stats.totalEmployees), color: '#1565c0', path: '/admin/employees' },
    { label: 'Companies', value: String(stats.totalCompanies), color: '#2e7d32', path: '/admin/subscriptions' },
    { label: 'Notifications', value: String(stats.totalNotifications), color: '#5c6bc0', path: '/admin/employees', sub: `${stats.unreadNotifications} unread` },
    { label: 'Actions', value: String(stats.actionNotifications), color: '#d84315', path: '/admin/employees', sub: 'pending' },
    { label: 'Kudos', value: String(stats.totalKudos), color: '#fbc02d', path: '/admin/kudos', sub: `${stats.totalKudosLikes} likes` },
    { label: 'Surveys', value: String(stats.totalSurveyDeployments), color: '#26a69a', path: '/admin/surveys', sub: `${surveyCompletionRate}%` },
    { label: '1:1 Meetings', value: String(stats.totalOneToOnes), color: '#c62828', path: '/admin/performance', sub: `${otoCompletionRate}% done` },
    { label: 'Goals', value: String(stats.totalGoals), color: '#ef6c00', path: '/admin/performance', sub: `${stats.activeGoals} active` },
    { label: 'Room Bookings', value: String(stats.totalSpaceBookings), color: '#4527a0', path: '/admin/space-management', sub: `${stats.todaySpaceBookings} today` },
    { label: 'Announcements', value: String(stats.totalAnnouncements), color: '#00897b', path: '/admin/announcements' },
    { label: 'Tickets', value: String(stats.totalTickets), color: '#37474f', path: '/admin/tickets' },
    { label: 'Benefits', value: String(stats.totalBenefitTypes), color: '#6a1b9a', path: '/admin/benefits' },
  ]

  const featureSubs = [
    { label: 'Payroll', value: stats.subsPayroll, color: '#1565c0' },
    { label: 'Benefits', value: stats.subsBenefits, color: '#7b1fa2' },
    { label: 'Shifts & Rotas', value: stats.subsShifts, color: '#e65100' },
    { label: 'Legal Timesheets', value: stats.subsLegal, color: '#00695c' },
    { label: 'Timesheets', value: stats.subsTimesheets, color: '#0277bd' },
    { label: 'Performance', value: stats.subsPerformance, color: '#c62828' },
    { label: 'Space Booking', value: stats.subsSpaceBooking, color: '#4527a0' },
    { label: 'Surveys', value: stats.subsSurveys, color: '#26a69a' },
    { label: 'Asset Management', value: stats.subsAssets, color: '#ef6c00' },
    { label: 'E-Learning', value: stats.subsElearning, color: '#2e7d32' },
    { label: 'Check-In', value: stats.subsCheckIn, color: '#5c6bc0' },
  ]
  const maxSub = Math.max(...featureSubs.map(f => f.value), 1)

  return (
    <div className="admin-dashboard">
      <div className="admin-page-header">
        <h2>Platform Overview</h2>
        <p>All-company metrics across InflowHR</p>
      </div>

      {/* AI Helper + Employee Growth — side by side */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 16, flexWrap: 'wrap' }}>
        <div className="sa-chart-panel" style={{ flex: '1 1 340px', minWidth: 0, marginBottom: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            <div>
              <h3 className="sa-chart-title">AI Helper Costs</h3>
              <p className="sa-chart-subtitle">GPT-4o-mini · last 12 months</p>
            </div>
            <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
              <div style={{ textAlign: 'right' }}>
                <div className="sa-chart-hero-label">This Month</div>
                <div className="sa-chart-hero" style={{ color: '#7c5cfc', fontSize: 18 }}>£{totalAiCostMonth.toFixed(2)}</div>
                <div style={{ fontSize: 10, color: '#9b9cb5', marginTop: 1 }}>{totalAiQueriesMonth.toLocaleString()} queries</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="sa-chart-hero-label">Annual Total</div>
                <div className="sa-chart-hero" style={{ color: '#1e1e2d', fontSize: 18 }}>£{totalAiCostYear.toFixed(2)}</div>
              </div>
            </div>
          </div>
          <svg width="100%" viewBox="0 0 360 60" style={{ display: 'block', marginBottom: 4 }}>
            <defs>
              <linearGradient id="ai-bar-hot" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#7c5cfc" />
                <stop offset="100%" stopColor="#a78bfa" />
              </linearGradient>
              <linearGradient id="ai-bar-cool" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#c4b5fd" stopOpacity="0.7" />
                <stop offset="100%" stopColor="#ddd6fe" stopOpacity="0.4" />
              </linearGradient>
            </defs>
            {aiMonthly.map((m, i) => {
              const maxCost = Math.max(...aiMonthly.map(x => x.cost), 0.01)
              const bw = 360 / aiMonthly.length
              const pad = bw * 0.15
              const barH = Math.max((m.cost / maxCost) * 36, 2)
              const isLast = i === aiMonthly.length - 1
              const r = Math.min((bw - pad * 2) / 2, 4)
              return (
                <g key={i}>
                  <rect x={i * bw + pad} y={42 - barH} width={bw - pad * 2} height={barH} rx={r} ry={r} fill={isLast ? 'url(#ai-bar-hot)' : 'url(#ai-bar-cool)'}>
                    <title>{m.month}: £{m.cost.toFixed(2)} ({m.queries} queries)</title>
                  </rect>
                  <text x={i * bw + bw / 2} y={54} textAnchor="middle" fontSize="8" fill="#9b9cb5" fontWeight="500">{m.month.split(' ')[0]}</text>
                </g>
              )
            })}
          </svg>
          <button
            onClick={() => setShowAiPopup(true)}
            style={{ marginTop: 4, background: 'none', border: 'none', color: '#7c5cfc', fontSize: 11, fontWeight: 600, cursor: 'pointer', padding: 0 }}
          >
            View company breakdown →
          </button>
        </div>
        {trends['employees'] && trends['employees'].length > 1 && (
          <div className="sa-chart-panel" style={{ flex: '1 1 340px', minWidth: 0, marginBottom: 0 }}>
            <h4 className="sa-chart-title">Employee Growth</h4>
            <p className="sa-chart-subtitle">6-month trend</p>
            <LargeChart data={trends['employees']} color="#7c5cfc" type="line" />
          </div>
        )}
      </div>

      {/* AI Company Breakdown Popup */}
      {showAiPopup && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(30,30,45,0.45)', backdropFilter: 'blur(4px)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowAiPopup(false)}>
          <div style={{ background: '#fff', borderRadius: 20, padding: 28, maxWidth: 580, width: '92%', maxHeight: '70vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.18)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#1e1e2d' }}>AI Helper — Company Breakdown</h3>
              <button onClick={() => setShowAiPopup(false)} style={{ background: '#f5f3ff', border: 'none', borderRadius: 8, width: 32, height: 32, fontSize: 18, cursor: 'pointer', color: '#7c5cfc', fontWeight: 700 }}>×</button>
            </div>
            {aiCompanies.length === 0 ? (
              <p style={{ color: '#9b9cb5', fontSize: 13 }}>No AI usage this month.</p>
            ) : (
              <>
                {aiCompanies.map((c, i) => {
                  const maxQ = Math.max(...aiCompanies.map(x => x.queries), 1)
                  const pct = Math.round((c.queries / maxQ) * 100)
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: i < aiCompanies.length - 1 ? '1px solid #f1f0f7' : 'none' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#1e1e2d', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>
                        <div style={{ fontSize: 11, color: '#9b9cb5' }}>{c.queries.toLocaleString()} queries · {c.tokens.toLocaleString()} tokens</div>
                      </div>
                      <div style={{ width: 120, height: 8, background: '#f1f0f7', borderRadius: 4, flexShrink: 0 }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg, #a78bfa, #7c5cfc)', borderRadius: 4 }} />
                      </div>
                      <div style={{ width: 60, textAlign: 'right', fontSize: 13, fontWeight: 700, color: '#7c5cfc', flexShrink: 0 }}>£{c.cost.toFixed(4)}</div>
                    </div>
                  )
                })}
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 14, marginTop: 6, borderTop: '2px solid #eeeef4', fontSize: 13, fontWeight: 700, color: '#1e1e2d' }}>
                  <span>Total</span>
                  <span>£{aiCompanies.reduce((s, c) => s + c.cost, 0).toFixed(4)}</span>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Condensed stat cards — 6 per row */}
      <div className="sa-grid">
        {cards.map(c => (
          <button key={c.label} className="sa-card" onClick={() => navigate(c.path)} style={{ '--sa-accent': c.color } as React.CSSProperties}>
            <span className="sa-card-label">{c.label}</span>
            <span className="sa-card-value" style={{ color: c.color }}>{c.value}</span>
            {c.sub && <span className="sa-card-sub">{c.sub}</span>}
          </button>
        ))}
      </div>

      {/* Trend charts — 2-up grid with upgraded panels */}
      {Object.keys(trends).length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 14, marginTop: 14 }}>
          {/* InflowOnboarder donut chart — replaces Employee Growth position */}
          <IfoDonutChart stats={stats} />
          {[
            { title: 'New Onboarders', sub: 'per month', key: 'onboarders', color: '#a78bfa', type: 'bar' as const },
            { title: 'Notifications', sub: 'per month', key: 'notifications', color: '#818cf8', type: 'bar' as const },
            { title: 'Kudos Given', sub: 'per month', key: 'kudos', color: '#f59e0b', type: 'bar' as const },
            { title: 'Tickets Raised', sub: 'per month', key: 'tickets', color: '#64748b', type: 'bar' as const },
            { title: 'Room Bookings', sub: 'per month', key: 'bookings', color: '#8b5cf6', type: 'bar' as const },
          ].filter(t => trends[t.key] && trends[t.key].length > 1).map(t => (
            <div key={t.key} className="sa-chart-panel">
              <h4 className="sa-chart-title">{t.title}</h4>
              <p className="sa-chart-subtitle">{t.sub}</p>
              <LargeChart data={trends[t.key]} color={t.color} type={t.type} />
            </div>
          ))}
        </div>
      )}

      {/* Feature Subscriptions — stacked horizontal bars with legend */}
      <div className="sa-chart-panel" style={{ marginTop: 14 }}>
        <h4 className="sa-chart-title">Feature Subscriptions</h4>
        <p className="sa-chart-subtitle">Companies subscribed to each add-on</p>
        <div className="sa-legend">
          {featureSubs.slice(0, 6).map(f => (
            <div key={f.label} className="sa-legend-item">
              <span className="sa-legend-dot" style={{ background: f.color }} />
              {f.label}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {featureSubs.map(f => {
            const pct = Math.round((f.value / maxSub) * 100)
            return (
              <div key={f.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 110, fontSize: 12, fontWeight: 500, color: '#6b6d85', flexShrink: 0, textAlign: 'right' }}>{f.label}</span>
                <div style={{ flex: 1, height: 10, background: '#f1f0f7', borderRadius: 5, overflow: 'hidden' }}>
                  <div style={{ width: `${(f.value / maxSub) * 100}%`, height: '100%', background: `linear-gradient(90deg, ${f.color}88, ${f.color})`, borderRadius: 5, transition: 'width 0.6s ease' }} />
                </div>
                <span style={{ width: 44, fontSize: 12, fontWeight: 700, color: '#1e1e2d', textAlign: 'right' }}>{f.value}</span>
                <span style={{ width: 36, fontSize: 10, color: '#9b9cb5', textAlign: 'right' }}>{pct}%</span>
              </div>
            )
          })}
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
