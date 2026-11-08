import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { getManagerEmail } from '../lib/workflow'
import { getFYRange, formatDate } from '../lib/formatters'
import { useMediaQuery } from '../hooks/useMediaQuery'

interface TeamLeaveRequest {
  id: number
  employee_id: string
  leave_type_id: number
  start_date: string
  end_date: string
  days_requested: number
  status: string
  reason: string | null
  employee_name: string
  employee_avatar: string | null
}

interface LeaveBalance {
  leave_type_id: number
  total_allowance: number
  used: number
  pending: number
  carried_over: number
  lieu_days: number
  leave_type_name: string
  colour: string
}

interface OtherLeaveType {
  leave_type_id: number
  name: string
  colour: string
  approved: number
  pending: number
}

interface LeaveRequest {
  id: number
  leave_type_id: number
  start_date: string
  end_date: string
  days_requested: number
  status: string
  reason: string | null
  created_at: string
}

interface LeaveType {
  id: number
  name: string
  colour: string
}

const LEAVE_TYPE_COLORS: Record<string, string> = {
  'Annual Leave': '#43a047',
  'Sick Leave': '#e53935',
  'Compassionate Leave': '#8d6e63',
  'Parental Leave': '#ab47bc',
  'Jury Duty': '#5c6bc0',
  'Bereavement': '#78909c',
  'Exam Leave': '#ff9800',
  'Carers Leave': '#ec407a',
  'Career Break': '#7b1fa2',
  'Lieu Days': '#00897b',
}

export default function MyLeave() {
  const navigate = useNavigate()
  const { t, tStatus } = useLanguage()
  const { employeeId: EMPLOYEE_ID, employeeName: EMPLOYEE_NAME, employeeEmail: EMPLOYEE_EMAIL, companyUser, isManager } = useAuth()
  const { showError } = useToast()
  const [balances, setBalances] = useState<LeaveBalance[]>([])
  const [otherTypes, setOtherTypes] = useState<OtherLeaveType[]>([])
  const [loading, setLoading] = useState(true)
  const [imOffState, setImOffState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [isZeroHours, setIsZeroHours] = useState(false)
  const [zhHolidayMethod, setZhHolidayMethod] = useState<'accrual' | 'rolled_up'>('rolled_up')
  const [zhAccrualRate, setZhAccrualRate] = useState(12.07)
  const isDesktop = useMediaQuery('(min-width: 769px)')

  const [historyRequests, setHistoryRequests] = useState<LeaveRequest[]>([])
  const [historyTypeMap, setHistoryTypeMap] = useState<Map<number, LeaveType>>(new Map())
  const [historyTab, setHistoryTab] = useState<'active' | 'dismissed' | 'team'>('active')
  const [teamLeaveRequests, setTeamLeaveRequests] = useState<TeamLeaveRequest[]>([])
  const [teamLeaveTypeMap, setTeamLeaveTypeMap] = useState<Map<number, LeaveType>>(new Map())
  const [teamLeaveLoading, setTeamLeaveLoading] = useState(false)
  const [teamTrendData, setTeamTrendData] = useState<{ weekLabel: string; days: number }[]>([])
  const [teamReportCount, setTeamReportCount] = useState(0)

  const loadData = useCallback(async () => {
    if (!EMPLOYEE_ID) return
    setLoading(true)
    const { data: co } = await supabase.from('companies').select('fy_start_month').eq('id', companyUser?.company_id).single()
    const { fyYear, fyStart, fyEnd } = getFYRange(co?.fy_start_month || 4)

    const { data: empData } = await supabase.from('employees').select('employment_category, contract_type').eq('id', EMPLOYEE_ID).single()
    const zh = empData?.employment_category === 'shift_worker' && empData?.contract_type === 'Zero hours shift worker'
    setIsZeroHours(zh)
    if (zh && companyUser?.company_id) {
      const { data: wts } = await supabase.from('worker_type_settings').select('holiday_pay_method, holiday_accrual_rate').eq('company_id', companyUser.company_id).eq('worker_type', 'zero_hours').maybeSingle()
      setZhHolidayMethod((wts?.holiday_pay_method as 'accrual' | 'rolled_up') || 'rolled_up')
      setZhAccrualRate(wts?.holiday_accrual_rate ?? 12.07)
    }

    const [balRes, allReqRes] = await Promise.all([
      supabase
        .from('leave_balances')
        .select('leave_type_id, total_allowance, used, carried_over, lieu_days')
        .eq('employee_id', EMPLOYEE_ID)
        .eq('company_id', companyUser?.company_id)
        .eq('year', fyYear),
      supabase
        .from('leave_requests')
        .select('leave_type_id, days_requested, status')
        .eq('employee_id', EMPLOYEE_ID)
        .eq('company_id', companyUser?.company_id)
        .in('status', ['approved', 'pending'])
        .gte('start_date', fyStart)
        .lte('start_date', fyEnd),
    ])

    const approvedByType = new Map<number, number>()
    const pendingByType = new Map<number, number>()
    for (const r of allReqRes.data || []) {
      const days = Number(r.days_requested)
      if (r.status === 'approved') {
        approvedByType.set(r.leave_type_id, (approvedByType.get(r.leave_type_id) || 0) + days)
      } else {
        pendingByType.set(r.leave_type_id, (pendingByType.get(r.leave_type_id) || 0) + days)
      }
    }

    const balanceTypeIds = new Set<number>()
    if (balRes.data && balRes.data.length > 0) {
      const typeIds = balRes.data.map((b: any) => b.leave_type_id)
      typeIds.forEach((id: number) => balanceTypeIds.add(id))
      const { data: types } = await supabase.from('leave_types').select('id, name, colour').in('id', typeIds)
      const typeMap = new Map((types || []).map((lt: any) => [lt.id, lt]))
      const merged: LeaveBalance[] = balRes.data.map((b: any) => {
        const lt = typeMap.get(b.leave_type_id) || { name: 'Leave', colour: '#999' }
        return {
          ...b,
          used: approvedByType.get(b.leave_type_id) || 0,
          pending: pendingByType.get(b.leave_type_id) || 0,
          lieu_days: Number(b.lieu_days) || 0,
          leave_type_name: lt.name,
          colour: lt.colour,
        }
      })
      setBalances(merged)
    } else {
      setBalances([])
    }

    const otherTypeIds = new Set<number>()
    for (const id of approvedByType.keys()) { if (!balanceTypeIds.has(id)) otherTypeIds.add(id) }
    for (const id of pendingByType.keys()) { if (!balanceTypeIds.has(id)) otherTypeIds.add(id) }

    if (otherTypeIds.size > 0) {
      const { data: otherTypesData } = await supabase.from('leave_types').select('id, name, colour').in('id', [...otherTypeIds])
      const others: OtherLeaveType[] = (otherTypesData || []).map((lt: any) => ({
        leave_type_id: lt.id,
        name: lt.name,
        colour: lt.colour,
        approved: approvedByType.get(lt.id) || 0,
        pending: pendingByType.get(lt.id) || 0,
      }))
      setOtherTypes(others)
    } else {
      setOtherTypes([])
    }

    const { data: reqs } = await supabase
      .from('leave_requests')
      .select('id, leave_type_id, start_date, end_date, days_requested, status, reason, created_at')
      .eq('employee_id', EMPLOYEE_ID)
      .eq('company_id', companyUser?.company_id)
      .order('created_at', { ascending: false })

    if (reqs && reqs.length > 0) {
      setHistoryRequests(reqs as LeaveRequest[])
      const hTypeIds = [...new Set(reqs.map((r: any) => r.leave_type_id))]
      const { data: hTypes } = await supabase.from('leave_types').select('id, name, colour').in('id', hTypeIds)
      if (hTypes) {
        setHistoryTypeMap(new Map(hTypes.map((lt: any) => [lt.id, lt as LeaveType])))
      }
    } else {
      setHistoryRequests([])
    }

    setLoading(false)
  }, [EMPLOYEE_ID])

  const loadTeamLeave = useCallback(async () => {
    if (!EMPLOYEE_ID || !companyUser?.company_id || !isManager) return
    setTeamLeaveLoading(true)
    const { data: directReports } = await supabase
      .from('employees')
      .select('id, first_name, last_name, avatar_url')
      .eq('company_id', companyUser.company_id)
      .eq('manager_id', EMPLOYEE_ID)
      .eq('is_active', true)
    if (!directReports || directReports.length === 0) { setTeamLeaveLoading(false); setTeamReportCount(0); return }
    setTeamReportCount(directReports.length)
    const reportIds = directReports.map((r: any) => r.id)
    const nameMap = new Map(directReports.map((r: any) => [r.id, { name: `${r.first_name} ${r.last_name}`, avatar: r.avatar_url }]))
    const trendStart = new Date()
    trendStart.setDate(trendStart.getDate() - 84)
    const trendStartStr = `${trendStart.getFullYear()}-${String(trendStart.getMonth() + 1).padStart(2, '0')}-${String(trendStart.getDate()).padStart(2, '0')}`
    const [activeRes, trendRes] = await Promise.all([
      supabase
        .from('leave_requests')
        .select('id, employee_id, leave_type_id, start_date, end_date, days_requested, status, reason')
        .eq('company_id', companyUser.company_id)
        .in('employee_id', reportIds)
        .in('status', ['pending', 'approved'])
        .order('start_date', { ascending: true }),
      supabase
        .from('leave_requests')
        .select('start_date, days_requested')
        .eq('company_id', companyUser.company_id)
        .in('employee_id', reportIds)
        .eq('status', 'approved')
        .gte('start_date', trendStartStr)
        .order('start_date', { ascending: true })
    ])
    const teamReqs = activeRes.data
    if (teamReqs && teamReqs.length > 0) {
      const typeIds = [...new Set(teamReqs.map((r: any) => r.leave_type_id))]
      const { data: types } = await supabase.from('leave_types').select('id, name, colour').in('id', typeIds)
      if (types) setTeamLeaveTypeMap(new Map(types.map((lt: any) => [lt.id, lt as LeaveType])))
      setTeamLeaveRequests(teamReqs.map((r: any) => {
        const emp = nameMap.get(r.employee_id) || { name: 'Employee', avatar: null }
        return { ...r, employee_name: emp.name, employee_avatar: emp.avatar }
      }))
    } else {
      setTeamLeaveRequests([])
    }
    const weeks: { weekLabel: string; days: number }[] = []
    const now = new Date()
    for (let w = 11; w >= 0; w--) {
      const wStart = new Date(now)
      wStart.setDate(now.getDate() - (w * 7) - now.getDay() + 1)
      const wEnd = new Date(wStart)
      wEnd.setDate(wStart.getDate() + 6)
      const wStartStr = `${wStart.getFullYear()}-${String(wStart.getMonth() + 1).padStart(2, '0')}-${String(wStart.getDate()).padStart(2, '0')}`
      const wEndStr = `${wEnd.getFullYear()}-${String(wEnd.getMonth() + 1).padStart(2, '0')}-${String(wEnd.getDate()).padStart(2, '0')}`
      const total = (trendRes.data || [])
        .filter((r: any) => r.start_date >= wStartStr && r.start_date <= wEndStr)
        .reduce((sum: number, r: any) => sum + (r.days_requested || 0), 0)
      weeks.push({ weekLabel: `${wStart.getDate()}/${wStart.getMonth() + 1}`, days: total })
    }
    setTeamTrendData(weeks)
    setTeamLeaveLoading(false)
  }, [EMPLOYEE_ID, companyUser?.company_id, isManager])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    if (historyTab === 'team' && teamLeaveRequests.length === 0 && !teamLeaveLoading) loadTeamLeave()
  }, [historyTab, loadTeamLeave])

  useEffect(() => {
    const onFocus = () => { if (EMPLOYEE_ID) loadData() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [loadData, EMPLOYEE_ID])

  const primary = balances.find(b => b.leave_type_name === 'Annual Leave')
  const basAllowance = primary ? primary.total_allowance : 0
  const primaryLieu = primary ? (primary.lieu_days || 0) : 0
  const primaryCarried = primary ? (primary.carried_over || 0) : 0
  const primaryPending = primary ? primary.pending : 0
  const totalEntitlement = basAllowance + primaryLieu + primaryCarried
  const totalUsed = primary ? primary.used : 0
  const remaining = totalEntitlement - totalUsed
  const notTaken = totalEntitlement - totalUsed - primaryPending
  const usedPct = totalEntitlement > 0 ? (totalUsed / totalEntitlement) * 100 : 0
  const pendingPct = totalEntitlement > 0 ? (primaryPending / totalEntitlement) * 100 : 0
  const circumference = 2 * Math.PI * 52

  const totalSickDays = otherTypes.filter(lt => lt.name === 'Sick Leave').reduce((sum, lt) => sum + lt.approved, 0)
  const totalSickPending = otherTypes.filter(lt => lt.name === 'Sick Leave').reduce((sum, lt) => sum + lt.pending, 0)

  function translateLeaveType(name: string): string {
    const keyMap: Record<string, string> = {
      'Annual Leave': 'my_leave.annual_leave',
      'Sick Leave': 'my_leave.sick_leave',
      'Compassionate Leave': 'my_leave.compassionate_leave',
      'Parental Leave': 'my_leave.parental_leave',
      'Jury Duty': 'my_leave.jury_duty',
      'Bereavement': 'my_leave.bereavement',
      'Exam Leave': 'my_leave.exam_leave',
      'Carers Leave': 'my_leave.carers_leave',
      'Career Break': 'my_leave.career_break',
      'Lieu Days': 'my_leave.lieu_days',
    }
    return keyMap[name] ? t(keyMap[name]) : name
  }

  async function handleImOff() {
    setImOffState('sending')

    const now = new Date()
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const { data: todayLeave } = await supabase
      .from('leave_requests')
      .select('id')
      .eq('employee_id', EMPLOYEE_ID)
      .eq('company_id', companyUser?.company_id)
      .eq('status', 'approved')
      .lte('start_date', todayStr)
      .gte('end_date', todayStr)
      .limit(1)

    if (!todayLeave || todayLeave.length === 0) {
      showError(t('my_leave.im_off_no_leave'))
      setImOffState('idle')
      return
    }

    const managerEmail = await getManagerEmail(EMPLOYEE_ID, EMPLOYEE_EMAIL, 'leave')

    const { error: wfError } = await supabase.from('workflow_tracker').insert({
      emp_display_name: EMPLOYEE_NAME,
      step: 1,
      status: 'Complete',
      record_type: 'Notification',
      action: "I'm Off notification",
      employee_email: EMPLOYEE_EMAIL,
      assigned_to: managerEmail,
      approval_id: null,
      reminder_count: 0,
      task_description: `${EMPLOYEE_NAME} is now off and away from the office.`,
      approval_status: null,
      company_id: companyUser?.company_id,
    })
    if (wfError) showError('Failed to create workflow tracker: ' + wfError.message)

    const { error: notifError } = await supabase.from('notifications').insert({
      employee_id: EMPLOYEE_ID,
      title: `${EMPLOYEE_NAME} is Off`,
      message: `${EMPLOYEE_NAME} has marked themselves as away. They will not be available.`,
      type: 'info',
      link: '/leave',
      is_read: false,
      company_id: companyUser?.company_id,
    })
    if (notifError) showError('Failed to create notification: ' + notifError.message)

    window.dispatchEvent(new Event('notifications-updated'))
    setImOffState('sent')
    setTimeout(() => setImOffState('idle'), 3000)
  }

  const fmt = (v: number) => isZeroHours ? v.toFixed(1) : String(v)

  const activeHistoryRequests = historyRequests.filter(r => r.status === 'approved' || r.status === 'pending')
  const dismissedHistoryRequests = historyRequests.filter(r => r.status === 'cancelled' || r.status === 'rejected')
  const todayStr = (() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })()
  const upcomingHistory = activeHistoryRequests.filter(r => r.end_date >= todayStr).sort((a, b) => a.start_date.localeCompare(b.start_date))
  const previousHistory = activeHistoryRequests.filter(r => r.end_date < todayStr)

  if (loading) {
    return (
      <div className="feature-page">
        <p className="claims-empty">{t('common.loading')}</p>
      </div>
    )
  }

  return (
    <div className="feature-page my-leave-page">
      <header className="my-leave-header">
        <button className="new-claim-back" onClick={() => navigate('/')}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 className="new-claim-title">{t('my_leave.title')}</h1>
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          <button className="feature-refresh" onClick={loadData}>
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
              <circle cx="16" cy="16" r="14" stroke="#fff" strokeWidth="2" />
              <path d="M22 14a6.5 6.5 0 0 0-11.3-1.5M10 18a6.5 6.5 0 0 0 11.3 1.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
              <path d="M22 10v4h-4M10 22v-4h4" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button className="my-leave-add-btn" onClick={() => navigate('/leave/new')}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>
      </header>

      {isZeroHours && zhHolidayMethod === 'rolled_up' && (
        <div style={{ margin: '0 0 16px', padding: 16, background: '#f0f9ff', borderRadius: 10, border: '1px solid #bfdbfe' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>Holiday Pay — Rolled Up</span>
            <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: '#dbeafe', color: '#1e40af', fontWeight: 600 }}>UK Statutory</span>
          </div>
          <p style={{ fontSize: 13, color: '#374151', margin: 0, lineHeight: 1.5 }}>
            Your holiday pay is included as a {zhAccrualRate}% uplift on each payslip. You can still book time off for record-keeping — see your payslips for holiday pay details.
          </p>
        </div>
      )}

      <div className="ml-top-section">
        <div className="ml-annual-card">
          <div className="ml-annual-top">
            <div className="ml-ring-wrap">
              <svg viewBox="0 0 120 120" className="ml-ring">
                <circle cx="60" cy="60" r="52" fill="none" stroke="var(--ml-ring-track)" strokeWidth="10" />
                <circle
                  cx="60" cy="60" r="52"
                  fill="none"
                  stroke="#43a047"
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeDasharray={`${(usedPct / 100) * circumference} ${circumference}`}
                  transform="rotate(-90 60 60)"
                />
                {pendingPct > 0 && (
                  <circle
                    cx="60" cy="60" r="52"
                    fill="none"
                    stroke="#ff9800"
                    strokeWidth="10"
                    strokeLinecap="round"
                    strokeDasharray={`${(pendingPct / 100) * circumference} ${circumference}`}
                    strokeDashoffset={`${-(usedPct / 100) * circumference}`}
                    transform="rotate(-90 60 60)"
                  />
                )}
              </svg>
              <div className="ml-ring-center">
                <span className="ml-ring-value">{fmt(remaining)}</span>
                <span className="ml-ring-label">{isZeroHours ? 'hrs left' : t('my_leave.remaining')}</span>
              </div>
            </div>

            <div className="ml-annual-stats">
              <div className="ml-annual-title-row">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#43a047" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                </svg>
                <span className="ml-annual-label">{isZeroHours ? 'Accrued Hours' : translateLeaveType('Annual Leave')}</span>
              </div>
              <div className="ml-stat-grid">
                <div className="ml-stat-item">
                  <span className="ml-stat-num">{fmt(totalEntitlement)}</span>
                  <span className="ml-stat-desc">{isZeroHours ? 'Accrued' : t('my_leave.entitlement')}</span>
                </div>
                <div className="ml-stat-item">
                  <span className="ml-stat-num ml-stat-used">{fmt(totalUsed)}</span>
                  <span className="ml-stat-desc">{isZeroHours ? 'Used (hrs)' : t('my_leave.used')}</span>
                </div>
                {primaryPending > 0 && (
                  <div className="ml-stat-item">
                    <span className="ml-stat-num ml-stat-pending">{fmt(primaryPending)}</span>
                    <span className="ml-stat-desc">{isZeroHours ? 'Pending (hrs)' : t('my_leave.pending_days')}</span>
                  </div>
                )}
                <div className="ml-stat-item">
                  <span className="ml-stat-num ml-stat-nottaken">{fmt(notTaken > 0 ? notTaken : 0)}</span>
                  <span className="ml-stat-desc">Not Taken</span>
                </div>
              </div>

              {(totalSickDays > 0 || totalSickPending > 0) && (
                <div className="ml-sick-inline">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e53935" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                  </svg>
                  <span className="ml-sick-label">{translateLeaveType('Sick Leave')}</span>
                  <span className="ml-sick-count">{totalSickDays} day{totalSickDays !== 1 ? 's' : ''} taken</span>
                  {totalSickPending > 0 && (
                    <span className="ml-other-pending">{totalSickPending} pending</span>
                  )}
                </div>
              )}

              {otherTypes.filter(lt => lt.name !== 'Sick Leave').map(lt => (
                <div key={lt.leave_type_id} className="ml-sick-inline">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={lt.colour} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                  <span className="ml-sick-label">{translateLeaveType(lt.name)}</span>
                  <span className="ml-sick-count">{lt.approved} day{lt.approved !== 1 ? 's' : ''} taken</span>
                  {lt.pending > 0 && (
                    <span className="ml-other-pending">{lt.pending} pending</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {(primaryCarried > 0 || primaryLieu > 0) && (
            <div className="ml-annual-breakdown">
              <span className="ml-breakdown-item">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#43a047" strokeWidth="2.5"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                {basAllowance} base
              </span>
              {primaryCarried > 0 && (
                <span className="ml-breakdown-item">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0891b2" strokeWidth="2.5"><path d="M17 3L21 7L17 11" /><path d="M3 13V11a4 4 0 014-4h14" /></svg>
                  {primaryCarried} carried over
                </span>
              )}
              {primaryLieu > 0 && (
                <span className="ml-breakdown-item">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                  {primaryLieu} lieu
                </span>
              )}
            </div>
          )}
        </div>

        {/* Mobile-only: separate other types cards */}
        {!isDesktop && otherTypes.length > 0 && (
          <div className="ml-other-types">
            <h3 className="ml-section-title">Other Leave This Year</h3>
            <div className="ml-other-grid">
              {otherTypes.map(lt => (
                <div key={lt.leave_type_id} className="ml-other-card" style={{ '--ml-type-color': lt.colour } as React.CSSProperties}>
                  <div className="ml-other-icon" style={{ background: lt.colour }}>
                    {lt.name === 'Sick Leave' ? (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                      </svg>
                    ) : (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="3" y1="10" x2="21" y2="10" />
                      </svg>
                    )}
                  </div>
                  <div className="ml-other-info">
                    <span className="ml-other-name">{translateLeaveType(lt.name)}</span>
                    <div className="ml-other-counts">
                      <span className="ml-other-approved">{lt.approved} day{lt.approved !== 1 ? 's' : ''} taken</span>
                      {lt.pending > 0 && (
                        <span className="ml-other-pending">{lt.pending} pending</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {!isDesktop && balances.filter(b => b.leave_type_name !== 'Annual Leave' && (b.used > 0 || b.pending > 0)).length > 0 && (
          <div className="ml-other-types">
            {!otherTypes.length && <h3 className="ml-section-title">Other Leave This Year</h3>}
            <div className="ml-other-grid">
              {balances.filter(b => b.leave_type_name !== 'Annual Leave' && (b.used > 0 || b.pending > 0)).map(b => {
                const effectiveTotal = b.total_allowance + (b.carried_over || 0) + (b.lieu_days || 0)
                return (
                  <div key={b.leave_type_id} className="ml-other-card" style={{ '--ml-type-color': b.colour } as React.CSSProperties}>
                    <div className="ml-other-icon" style={{ background: b.colour }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="3" y1="10" x2="21" y2="10" />
                      </svg>
                    </div>
                    <div className="ml-other-info">
                      <span className="ml-other-name">{translateLeaveType(b.leave_type_name)}</span>
                      <div className="ml-other-counts">
                        <span className="ml-other-approved">{b.used} of {effectiveTotal} used</span>
                        {b.pending > 0 && (
                          <span className="ml-other-pending">{b.pending} pending</span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Desktop-only: right side action panel */}
        {isDesktop && (
          <div className="ml-actions-panel">
            <button className="my-leave-card" onClick={() => navigate('/leave/new')}>
              <div className="my-leave-card-icon my-leave-card-book">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                  <line x1="12" y1="14" x2="12" y2="18" />
                  <line x1="10" y1="16" x2="14" y2="16" />
                </svg>
              </div>
              <div className="my-leave-card-text">
                <span className="my-leave-card-title">{t('my_leave.book_leave')}</span>
                <span className="my-leave-card-desc">{t('my_leave.book_leave_desc')}</span>
              </div>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>

            <button className="my-leave-card" onClick={() => navigate('/leave/calendar')}>
              <div className="my-leave-card-icon my-leave-card-types">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                  <circle cx="8" cy="14" r="1" fill="#fff" />
                  <circle cx="12" cy="14" r="1" fill="#fff" />
                  <circle cx="16" cy="14" r="1" fill="#fff" />
                </svg>
              </div>
              <div className="my-leave-card-text">
                <span className="my-leave-card-title">{t('my_leave.leave_calendar')}</span>
                <span className="my-leave-card-desc">{t('my_leave.leave_calendar_desc')}</span>
              </div>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>

            <button
              className={`my-leave-im-off-btn ${imOffState === 'sent' ? 'my-leave-im-off-sent' : ''}`}
              onClick={handleImOff}
              disabled={imOffState !== 'idle'}
            >
              {imOffState === 'idle' && (
                <>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                  </svg>
                  <span>{t('my_leave.im_off')}</span>
                </>
              )}
              {imOffState === 'sending' && <span>{t('my_leave.im_off_sending')}</span>}
              {imOffState === 'sent' && (
                <>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>{t('my_leave.im_off_sent')}</span>
                </>
              )}
            </button>
            <p className="my-leave-im-off-hint">{t('my_leave.im_off_desc')}</p>
          </div>
        )}
      </div>

      {/* Mobile-only: action cards + I'm Off */}
      {!isDesktop && (
        <>
          <div className="my-leave-cards">
            <button className="my-leave-card" onClick={() => navigate('/leave/new')}>
              <div className="my-leave-card-icon my-leave-card-book">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                  <line x1="12" y1="14" x2="12" y2="18" />
                  <line x1="10" y1="16" x2="14" y2="16" />
                </svg>
              </div>
              <div className="my-leave-card-text">
                <span className="my-leave-card-title">{t('my_leave.book_leave')}</span>
                <span className="my-leave-card-desc">{t('my_leave.book_leave_desc')}</span>
              </div>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>

            <button className="my-leave-card" onClick={() => navigate('/leave/history')}>
              <div className="my-leave-card-icon my-leave-card-history">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              </div>
              <div className="my-leave-card-text">
                <span className="my-leave-card-title">{t('my_leave.leave_history')}</span>
                <span className="my-leave-card-desc">{t('my_leave.leave_history_desc')}</span>
              </div>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>

            <button className="my-leave-card" onClick={() => navigate('/leave/calendar')}>
              <div className="my-leave-card-icon my-leave-card-types">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                  <circle cx="8" cy="14" r="1" fill="#fff" />
                  <circle cx="12" cy="14" r="1" fill="#fff" />
                  <circle cx="16" cy="14" r="1" fill="#fff" />
                </svg>
              </div>
              <div className="my-leave-card-text">
                <span className="my-leave-card-title">{t('my_leave.leave_calendar')}</span>
                <span className="my-leave-card-desc">{t('my_leave.leave_calendar_desc')}</span>
              </div>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>

          <button
            className={`my-leave-im-off-btn ${imOffState === 'sent' ? 'my-leave-im-off-sent' : ''}`}
            onClick={handleImOff}
            disabled={imOffState !== 'idle'}
          >
            {imOffState === 'idle' && (
              <>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
                <span>{t('my_leave.im_off')}</span>
              </>
            )}
            {imOffState === 'sending' && <span>{t('my_leave.im_off_sending')}</span>}
            {imOffState === 'sent' && (
              <>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>{t('my_leave.im_off_sent')}</span>
              </>
            )}
          </button>

          <p className="my-leave-im-off-hint">{t('my_leave.im_off_desc')}</p>
        </>
      )}

      {/* Desktop-only: inline leave history as directory-style table */}
      {isDesktop && (
        <div className="ml-inline-history">
          <div className="leave-history-tabs">
            <button className={`leave-history-tab${historyTab === 'active' ? ' active' : ''}`} onClick={() => setHistoryTab('active')}>
              Pending & Approved
              {activeHistoryRequests.length > 0 && <span className="leave-history-tab-count">{activeHistoryRequests.length}</span>}
            </button>
            <button className={`leave-history-tab${historyTab === 'dismissed' ? ' active' : ''}`} onClick={() => setHistoryTab('dismissed')}>
              Cancelled & Declined
              {dismissedHistoryRequests.length > 0 && <span className="leave-history-tab-count leave-history-tab-count-muted">{dismissedHistoryRequests.length}</span>}
            </button>
            {isManager && (
              <button className={`leave-history-tab${historyTab === 'team' ? ' active' : ''}`} onClick={() => setHistoryTab('team')} style={historyTab === 'team' ? { borderColor: '#7b1fa2', color: '#7b1fa2' } : {}}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/>
                  <circle cx="18" cy="8" r="3"/><path d="M21 21v-1a3 3 0 0 0-2-2.83"/>
                </svg>
                My Team
                {teamLeaveRequests.filter(r => r.status === 'pending').length > 0 && (
                  <span className="leave-history-tab-count" style={{ background: '#e65100' }}>{teamLeaveRequests.filter(r => r.status === 'pending').length}</span>
                )}
              </button>
            )}
          </div>

          {historyTab === 'active' && activeHistoryRequests.length === 0 && (
            <p className="claims-empty">{t('leave_history.no_leave')}</p>
          )}

          {historyTab === 'active' && (upcomingHistory.length > 0 || previousHistory.length > 0) && (
            <>
              {upcomingHistory.length > 0 && (
                <>
                  <h3 className="leave-history-section-title">{t('leave_history.upcoming')}</h3>
                  <div className="ml-leave-table-wrap">
                    <table className="ml-leave-table">
                      <thead>
                        <tr>
                          <th>Leave Type</th>
                          <th>Status</th>
                          <th>From</th>
                          <th>To</th>
                          <th>Days</th>
                        </tr>
                      </thead>
                      <tbody>
                        {upcomingHistory.map(req => {
                          const lt = historyTypeMap.get(req.leave_type_id)
                          const typeName = lt ? lt.name : 'Leave'
                          const colour = LEAVE_TYPE_COLORS[typeName] || (lt ? lt.colour : '#999')
                          return (
                            <tr key={req.id} className="ml-leave-table-row" onClick={() => navigate(`/leave/${req.id}`)}>
                              <td>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <span style={{ width: 4, height: 28, borderRadius: 2, background: colour, flexShrink: 0 }} />
                                  <span style={{ fontWeight: 700, color: 'var(--text)' }}>{translateLeaveType(typeName)}</span>
                                </div>
                              </td>
                              <td>
                                <span className="ml-leave-table-badge" style={{ background: req.status === 'approved' ? '#e6f7ec' : '#fff3e0', color: req.status === 'approved' ? '#16a34a' : '#e65100' }}>
                                  {tStatus(req.status)}
                                </span>
                              </td>
                              <td><span style={{ fontWeight: 600 }}>{formatDate(req.start_date)}</span></td>
                              <td><span style={{ fontWeight: 600 }}>{formatDate(req.end_date)}</span></td>
                              <td>
                                <span className="ml-leave-table-days" style={{ borderColor: colour, color: colour }}>{req.days_requested}</span>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              {previousHistory.length > 0 && (
                <>
                  <h3 className="leave-history-section-title">{t('leave_history.previous')}</h3>
                  <div className="ml-leave-table-wrap">
                    <table className="ml-leave-table">
                      <thead>
                        <tr>
                          <th>Leave Type</th>
                          <th>Status</th>
                          <th>From</th>
                          <th>To</th>
                          <th>Days</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previousHistory.map(req => {
                          const lt = historyTypeMap.get(req.leave_type_id)
                          const typeName = lt ? lt.name : 'Leave'
                          const colour = LEAVE_TYPE_COLORS[typeName] || (lt ? lt.colour : '#999')
                          return (
                            <tr key={req.id} className="ml-leave-table-row" onClick={() => navigate(`/leave/${req.id}`)}>
                              <td>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <span style={{ width: 4, height: 28, borderRadius: 2, background: colour, flexShrink: 0 }} />
                                  <span style={{ fontWeight: 700, color: 'var(--text)' }}>{translateLeaveType(typeName)}</span>
                                </div>
                              </td>
                              <td>
                                <span className="ml-leave-table-badge" style={{ background: '#e6f7ec', color: '#16a34a' }}>
                                  {tStatus(req.status)}
                                </span>
                              </td>
                              <td><span style={{ fontWeight: 600 }}>{formatDate(req.start_date)}</span></td>
                              <td><span style={{ fontWeight: 600 }}>{formatDate(req.end_date)}</span></td>
                              <td>
                                <span className="ml-leave-table-days" style={{ borderColor: colour, color: colour }}>{req.days_requested}</span>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}

          {historyTab === 'dismissed' && dismissedHistoryRequests.length === 0 && (
            <p className="claims-empty">No cancelled or declined requests</p>
          )}

          {historyTab === 'dismissed' && dismissedHistoryRequests.length > 0 && (
            <div className="ml-leave-table-wrap" style={{ marginTop: 12 }}>
              <table className="ml-leave-table">
                <thead>
                  <tr>
                    <th>Leave Type</th>
                    <th>Status</th>
                    <th>From</th>
                    <th>To</th>
                    <th>Days</th>
                  </tr>
                </thead>
                <tbody>
                  {dismissedHistoryRequests.map(req => {
                    const lt = historyTypeMap.get(req.leave_type_id)
                    const typeName = lt ? lt.name : 'Leave'
                    const colour = LEAVE_TYPE_COLORS[typeName] || (lt ? lt.colour : '#999')
                    return (
                      <tr key={req.id} className="ml-leave-table-row" style={{ opacity: 0.7 }} onClick={() => navigate(`/leave/${req.id}`)}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ width: 4, height: 28, borderRadius: 2, background: colour, flexShrink: 0 }} />
                            <span style={{ fontWeight: 700, color: 'var(--text)' }}>{translateLeaveType(typeName)}</span>
                          </div>
                        </td>
                        <td>
                          <span className="ml-leave-table-badge" style={{ background: req.status === 'cancelled' ? '#f5f5f5' : '#fbe9e7', color: req.status === 'cancelled' ? '#757575' : '#c62828' }}>
                            {tStatus(req.status)}
                          </span>
                        </td>
                        <td><span style={{ fontWeight: 600 }}>{formatDate(req.start_date)}</span></td>
                        <td><span style={{ fontWeight: 600 }}>{formatDate(req.end_date)}</span></td>
                        <td>
                          <span className="ml-leave-table-days" style={{ borderColor: '#999', color: '#999' }}>{req.days_requested}</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {historyTab === 'team' && (
            <>
              {teamLeaveLoading && <p className="claims-empty">{t('common.loading')}</p>}
              {!teamLeaveLoading && teamLeaveRequests.length === 0 && teamReportCount === 0 && (
                <p className="claims-empty">No team leave requests found</p>
              )}
              {!teamLeaveLoading && (() => {
                const pendingTeam = teamLeaveRequests.filter(r => r.status === 'pending')
                const approvedTeam = teamLeaveRequests.filter(r => r.status === 'approved' && r.end_date >= todayStr)
                const pastTeam = teamLeaveRequests.filter(r => r.status === 'approved' && r.end_date < todayStr)
                const getInitials = (name: string) => name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)

                const maxTrend = Math.max(...teamTrendData.map(w => w.days), 1)
                const chartW = 480
                const chartH = 180
                const barW = 28
                const barGap = (chartW - teamTrendData.length * barW) / (teamTrendData.length + 1)

                const renderTeamRow = (req: TeamLeaveRequest) => {
                  const lt = teamLeaveTypeMap.get(req.leave_type_id)
                  const typeName = lt ? lt.name : 'Leave'
                  const colour = LEAVE_TYPE_COLORS[typeName] || (lt ? lt.colour : '#999')
                  return (
                    <div key={req.id} className="ml-team-row">
                      <div className="ml-team-row-left">
                        {req.employee_avatar ? (
                          <img src={req.employee_avatar} alt="" className="ml-team-row-avatar" />
                        ) : (
                          <div className="ml-team-row-avatar ml-team-row-avatar-placeholder">
                            {getInitials(req.employee_name)}
                          </div>
                        )}
                        <div className="ml-team-row-info">
                          <span className="ml-team-row-name">{req.employee_name}</span>
                          <span className="ml-team-row-dates">{formatDate(req.start_date)} - {formatDate(req.end_date)}</span>
                        </div>
                      </div>
                      <div className="ml-team-row-right">
                        <span className="ml-team-row-days">{req.days_requested} {req.days_requested === 1 ? 'Day' : 'Days'}</span>
                        <span className="ml-team-row-type" style={{ color: colour }}>{translateLeaveType(typeName)}</span>
                      </div>
                    </div>
                  )
                }

                const groupByMonth = (rows: TeamLeaveRequest[]) => {
                  const groups: { month: string; items: TeamLeaveRequest[] }[] = []
                  rows.forEach(r => {
                    const d = new Date(r.start_date + 'T00:00:00')
                    const m = d.toLocaleDateString('en-GB', { month: 'long' })
                    const last = groups[groups.length - 1]
                    if (last && last.month === m) { last.items.push(r) }
                    else { groups.push({ month: m, items: [r] }) }
                  })
                  return groups
                }

                return (
                  <div className="ml-team-grid">
                    <div className="ml-team-card">
                      <div className="ml-team-card-header">
                        <h3>Pending Approvals</h3>
                        <span className="ml-team-card-badge" style={{ background: '#e65100' }}>{pendingTeam.length}</span>
                      </div>
                      <div className="ml-team-card-body">
                        {pendingTeam.length === 0 && <p className="ml-team-card-empty">No pending approvals</p>}
                        {pendingTeam.map(renderTeamRow)}
                      </div>
                    </div>

                    <div className="ml-team-card">
                      <div className="ml-team-card-header">
                        <h3>Upcoming Leaves</h3>
                        <span className="ml-team-card-badge" style={{ background: '#1565c0' }}>{approvedTeam.length}</span>
                      </div>
                      <div className="ml-team-card-body">
                        {approvedTeam.length === 0 && <p className="ml-team-card-empty">No upcoming leaves</p>}
                        {groupByMonth(approvedTeam).map(g => (
                          <div key={g.month}>
                            <div className="ml-team-month-label">
                              <span className="ml-team-month-dot" />
                              {g.month}
                            </div>
                            {g.items.map(renderTeamRow)}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="ml-team-card">
                      <div className="ml-team-card-header">
                        <h3>Leave Trend</h3>
                        <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>Weekly View</span>
                      </div>
                      <div className="ml-team-card-body" style={{ padding: '12px 8px 8px' }}>
                        {teamTrendData.length > 0 && (
                          <svg viewBox={`0 0 ${chartW} ${chartH + 28}`} width="100%" style={{ display: 'block' }}>
                            <line x1="30" y1={chartH} x2={chartW} y2={chartH} stroke="var(--border, #e0e0e0)" strokeWidth="1" />
                            {[0.25, 0.5, 0.75, 1].map(pct => {
                              const y = chartH - (chartH - 10) * pct
                              return (
                                <g key={pct}>
                                  <line x1="30" y1={y} x2={chartW} y2={y} stroke="var(--border, #e0e0e0)" strokeWidth="0.5" strokeDasharray="3 3" />
                                  <text x="26" y={y + 3} textAnchor="end" fontSize="9" fill="var(--text-muted, #999)">{Math.round(maxTrend * pct)}</text>
                                </g>
                              )
                            })}
                            <text x="4" y={chartH / 2} textAnchor="middle" fontSize="9" fill="var(--text-muted, #999)" transform={`rotate(-90, 4, ${chartH / 2})`}>No of Associates</text>
                            {teamTrendData.map((w, i) => {
                              const barH = maxTrend > 0 ? (w.days / maxTrend) * (chartH - 10) : 0
                              const x = 36 + barGap + i * (barW + barGap)
                              return (
                                <g key={i}>
                                  <rect x={x} y={chartH - barH} width={barW} height={Math.max(barH, 0)} rx={3} fill={i === teamTrendData.length - 1 ? '#43a047' : '#c8e600'} opacity={w.days === 0 ? 0.15 : 0.9} />
                                  {w.days > 0 && (
                                    <text x={x + barW / 2} y={chartH - barH - 4} textAnchor="middle" fontSize="9" fontWeight="700" fill="var(--text)">{w.days}</text>
                                  )}
                                  <text x={x + barW / 2} y={chartH + 13} textAnchor="middle" fontSize="8" fill="var(--text-muted, #999)">{w.weekLabel}</text>
                                </g>
                              )
                            })}
                          </svg>
                        )}
                        {teamTrendData.length === 0 && <p className="ml-team-card-empty">No trend data available</p>}
                      </div>
                    </div>

                    <div className="ml-team-card">
                      <div className="ml-team-card-header">
                        <h3>Leave History</h3>
                        <span className="ml-team-card-badge" style={{ background: '#7b1fa2' }}>{pastTeam.length}</span>
                      </div>
                      <div className="ml-team-card-body">
                        {pastTeam.length === 0 && <p className="ml-team-card-empty">No leave history</p>}
                        {groupByMonth(pastTeam).map(g => (
                          <div key={g.month}>
                            <div className="ml-team-month-label">
                              <span className="ml-team-month-dot" />
                              {g.month}
                            </div>
                            {g.items.map(renderTeamRow)}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )
              })()}
            </>
          )}
        </div>
      )}
    </div>
  )
}
