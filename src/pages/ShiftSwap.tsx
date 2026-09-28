import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { formatTime12 as formatTime, toLocalDateStr } from '../lib/formatters'

interface ShiftAssignment {
  id: string
  date: string
  employee_id: string
  shift_template_id: string
  rota_id: string
  shift_template: {
    id: string
    name: string
    start_time: string
    end_time: string
    colour: string
  } | null
  rota: {
    name: string
    status: string
  } | null
}

interface Employee {
  id: string
  first_name: string
  last_name: string
  avatar_url?: string | null
  work_pattern_id?: string | null
}

interface SwapRequest {
  id: string
  shift_assignment_id: string
  target_shift_assignment_id: string | null
  requesting_employee_id: string
  target_employee_id: string
  status: string
  reason: string | null
  response_message: string | null
  created_at: string
  shift_assignment?: {
    id: string
    date: string
    shift_template_id: string
    rota_id: string
    shift_template: { name: string; colour: string; start_time: string; end_time: string } | null
    rota: { name: string } | null
  } | null
  target_shift?: {
    id: string
    date: string
    shift_template: { name: string; colour: string; start_time: string; end_time: string } | null
    rota: { name: string } | null
  } | null
}

type SwapTab = 'request' | 'incoming' | 'history'

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function getInitials(first: string, last: string): string {
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase()
}

const AVATAR_COLORS = ['#667eea', '#764ba2', '#f093fb', '#4facfe', '#43e97b', '#fa709a', '#fee140', '#30cfd0']
function avatarColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h)
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}

export default function ShiftSwap() {
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useLanguage()
  const { employeeId, companyUser } = useAuth()
  const { showError } = useToast()
  const initialTab = (location.state as { tab?: SwapTab } | null)?.tab || 'request'
  const [tab, setTab] = useState<SwapTab>(initialTab)
  const [myShifts, setMyShifts] = useState<ShiftAssignment[]>([])
  const [allShiftAssignments, setAllShiftAssignments] = useState<ShiftAssignment[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [swapRequests, setSwapRequests] = useState<SwapRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null)
  const [targetEmployeeId, setTargetEmployeeId] = useState('')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [actioningId, setActioningId] = useState<string | null>(null)
  const [counterShiftId, setCounterShiftId] = useState<string | null>(null)
  const [responseMessage, setResponseMessage] = useState('')

  const employeeMap = useMemo(() => {
    const map: Record<string, Employee> = {}
    employees.forEach(e => { map[e.id] = e })
    return map
  }, [employees])

  const employeesWithShifts = useMemo(() => {
    const idsWithShifts = new Set(allShiftAssignments.map(sa => sa.employee_id))
    return employees.filter(e => e.id !== employeeId && idsWithShifts.has(e.id))
  }, [employees, allShiftAssignments, employeeId])

  const targetShifts = useMemo(() => {
    if (!targetEmployeeId) return []
    return allShiftAssignments.filter(sa => sa.employee_id === targetEmployeeId)
  }, [allShiftAssignments, targetEmployeeId])

  const incomingRequests = useMemo(() => {
    return swapRequests.filter(r =>
      (r.target_employee_id === employeeId && r.status === 'pending') ||
      (r.requesting_employee_id === employeeId && r.status === 'counter_offered')
    )
  }, [swapRequests, employeeId])

  const historyRequests = useMemo(() => {
    return swapRequests.filter(r =>
      r.requesting_employee_id === employeeId || r.target_employee_id === employeeId
    ).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  }, [swapRequests, employeeId])

  const fetchData = useCallback(async () => {
    if (!employeeId || !companyUser?.company_id) return
    setLoading(true)

    const today = toLocalDateStr()

    const [myShiftsRes, allAssignRes, employeesRes, swapRes, wpRes, rotaRes] = await Promise.all([
      supabase
        .from('shift_assignments')
        .select('*, shift_template:shift_templates(id, name, start_time, end_time, colour), rota:rotas(name, status)')
        .eq('employee_id', employeeId)
        .eq('company_id', companyUser.company_id)
        .gte('date', today),
      supabase
        .from('shift_assignments')
        .select('*, shift_template:shift_templates(id, name, start_time, end_time, colour), rota:rotas(name, status)')
        .eq('company_id', companyUser.company_id)
        .gte('date', today),
      supabase
        .from('employees')
        .select('id, first_name, last_name, avatar_url, work_pattern_id')
        .eq('company_id', companyUser.company_id)
        .eq('is_active', true),
      supabase
        .from('shift_swap_requests')
        .select('*, shift_assignment:shift_assignments(id, date, shift_template_id, rota_id, shift_template:shift_templates(name, colour, start_time, end_time), rota:rotas(name))')
        .eq('company_id', companyUser.company_id)
        .or(`requesting_employee_id.eq.${employeeId},target_employee_id.eq.${employeeId}`)
        .order('created_at', { ascending: false }),
      supabase
        .from('work_patterns')
        .select('id, pattern_type')
        .eq('company_id', companyUser.company_id)
        .eq('is_active', true),
      supabase
        .from('rotas')
        .select('id, name, status')
        .eq('company_id', companyUser.company_id)
        .eq('status', 'published'),
    ])

    const publishedRotaIds = new Set((rotaRes.data || []).map((r: any) => r.id))
    const publishedMyShifts = (myShiftsRes.data || []).filter((s: any) => publishedRotaIds.has(s.rota_id))
    const publishedAllAssign = (allAssignRes.data || []).filter((s: any) => publishedRotaIds.has(s.rota_id))

    setMyShifts(publishedMyShifts as ShiftAssignment[])
    setAllShiftAssignments(publishedAllAssign as ShiftAssignment[])

    const variablePatternIds = new Set((wpRes.data || []).filter((p: any) => p.pattern_type === 'variable').map((p: any) => p.id))
    const allEmps = (employeesRes.data || []) as Employee[]
    setEmployees(allEmps.filter(e => !e.work_pattern_id || variablePatternIds.has(e.work_pattern_id)))

    const swapRows = (swapRes.data || []) as any[]
    const targetShiftIds = swapRows.map(r => r.target_shift_assignment_id).filter(Boolean)
    let targetShiftMap: Record<string, any> = {}
    if (targetShiftIds.length > 0) {
      const { data: tsData } = await supabase
        .from('shift_assignments')
        .select('id, date, shift_template:shift_templates(name, colour, start_time, end_time), rota:rotas(name)')
        .in('id', targetShiftIds)
      if (tsData) {
        tsData.forEach((ts: any) => { targetShiftMap[ts.id] = ts })
      }
    }

    setSwapRequests(swapRows.map((r: any) => ({
      ...r,
      target_shift: r.target_shift_assignment_id ? targetShiftMap[r.target_shift_assignment_id] || null : null,
    })))

    setLoading(false)
  }, [employeeId, companyUser?.company_id])

  useEffect(() => { fetchData() }, [fetchData])

  async function handleSubmitSwap() {
    if (!selectedShiftId || !targetEmployeeId || !companyUser?.company_id) return
    const selectedShift = myShifts.find(s => s.id === selectedShiftId)
    if (selectedShift && selectedShift.date < toLocalDateStr()) {
      showError('Cannot request a swap for a shift that has already passed')
      return
    }
    setSubmitting(true)

    const { error } = await supabase.from('shift_swap_requests').insert({
      company_id: companyUser.company_id,
      shift_assignment_id: selectedShiftId,
      requesting_employee_id: employeeId,
      target_employee_id: targetEmployeeId,
      status: 'pending',
      reason: reason || null,
    })

    if (error) {
      showError(t('shifts.swap_failed'))
    } else {
      await supabase.from('workflow_tracker').insert({
        emp_display_name: employeeMap[targetEmployeeId] ? `${employeeMap[targetEmployeeId].first_name} ${employeeMap[targetEmployeeId].last_name}` : '',
        step: 1,
        status: 'Pending',
        record_type: 'Shift Swap',
        action: 'Shift swap request received',
        employee_email: '',
        assigned_to: '',
        reminder_count: 1,
        task_description: `Shift swap request from ${employeeMap[employeeId!]?.first_name || ''} ${employeeMap[employeeId!]?.last_name || ''} — ${selectedShift?.shift_template?.name || 'Shift'} on ${selectedShift ? formatDate(selectedShift.date) : ''}`,
        company_id: companyUser.company_id,
      })

      setSelectedShiftId(null)
      setTargetEmployeeId('')
      setReason('')
      setTab('history')
    }
    setSubmitting(false)
    fetchData()
  }

  async function handleCounterOffer(request: SwapRequest) {
    if (!counterShiftId || !companyUser?.company_id) return
    setActioningId(request.id)

    const { error } = await supabase.from('shift_swap_requests')
      .update({
        target_shift_assignment_id: counterShiftId,
        response_message: responseMessage || null,
        status: 'counter_offered',
      })
      .eq('id', request.id)
      .eq('company_id', companyUser.company_id)

    if (error) {
      showError('Failed to send counter-offer: ' + error.message)
    } else {
      const requester = employeeMap[request.requesting_employee_id]
      await supabase.from('workflow_tracker').insert({
        emp_display_name: requester ? `${requester.first_name} ${requester.last_name}` : '',
        step: 2,
        status: 'Pending',
        record_type: 'Shift Swap',
        action: 'Counter-offer received — review and approve or decline',
        employee_email: '',
        assigned_to: '',
        reminder_count: 1,
        task_description: `Shift swap counter-offer received`,
        company_id: companyUser.company_id,
      })
    }

    setCounterShiftId(null)
    setResponseMessage('')
    setActioningId(null)
    fetchData()
  }

  async function handleApproveSwap(request: SwapRequest) {
    if (!companyUser?.company_id || !request.target_shift_assignment_id) return
    setActioningId(request.id)

    const { error: approveErr } = await supabase.from('shift_swap_requests')
      .update({ status: 'approved' })
      .eq('id', request.id)
      .eq('company_id', companyUser.company_id)

    if (approveErr) {
      showError('Failed to approve swap: ' + approveErr.message)
      setActioningId(null)
      return
    }

    await supabase.from('shift_assignments')
      .update({ employee_id: request.target_employee_id })
      .eq('id', request.shift_assignment_id)
      .eq('company_id', companyUser.company_id)

    await supabase.from('shift_assignments')
      .update({ employee_id: request.requesting_employee_id })
      .eq('id', request.target_shift_assignment_id)
      .eq('company_id', companyUser.company_id)

    const target = employeeMap[request.target_employee_id]
    const requester = employeeMap[request.requesting_employee_id]

    await Promise.all([
      supabase.from('workflow_tracker').insert({
        emp_display_name: requester ? `${requester.first_name} ${requester.last_name}` : '',
        step: 3,
        status: 'Complete',
        record_type: 'Shift Swap',
        action: 'Shift swap approved — shifts have been swapped',
        employee_email: '',
        assigned_to: '',
        reminder_count: 1,
        task_description: `Shift swap with ${target?.first_name || ''} ${target?.last_name || ''} approved`,
        company_id: companyUser.company_id,
      }),
      supabase.from('workflow_tracker').insert({
        emp_display_name: target ? `${target.first_name} ${target.last_name}` : '',
        step: 3,
        status: 'Complete',
        record_type: 'Shift Swap',
        action: 'Shift swap approved — shifts have been swapped',
        employee_email: '',
        assigned_to: '',
        reminder_count: 1,
        task_description: `Shift swap with ${requester?.first_name || ''} ${requester?.last_name || ''} approved`,
        company_id: companyUser.company_id,
      }),
    ])

    window.dispatchEvent(new Event('notifications-updated'))
    setActioningId(null)
    fetchData()
  }

  async function handleDeclineSwap(request: SwapRequest) {
    setActioningId(request.id)
    const { error } = await supabase.from('shift_swap_requests')
      .update({ status: 'rejected', response_message: responseMessage || null })
      .eq('id', request.id)
      .eq('company_id', companyUser?.company_id)

    if (error) {
      showError('Failed to decline: ' + error.message)
    }
    setResponseMessage('')
    setActioningId(null)
    fetchData()
  }

  async function handleCancelSwap(requestId: string) {
    setActioningId(requestId)
    const { error } = await supabase.from('shift_swap_requests')
      .update({ status: 'cancelled' })
      .eq('id', requestId)
      .eq('company_id', companyUser?.company_id)
    if (error) showError('Failed to cancel: ' + error.message)
    setActioningId(null)
    fetchData()
  }

  function renderShiftCard(sa: { date: string; shift_template?: { name: string; colour: string; start_time: string; end_time: string } | null; rota?: { name: string } | null } | null, label?: string) {
    if (!sa) return null
    const colour = sa.shift_template?.colour || '#999'
    return (
      <div className="swap-incoming-detail" style={{ borderLeftColor: colour }}>
        {label && <span style={{ fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', width: '100%' }}>{label}</span>}
        <div className="swap-incoming-shift">
          <span className="swap-shift-name" style={{ color: colour }}>{sa.shift_template?.name || 'Shift'}</span>
          <span className="swap-shift-date">{formatDate(sa.date)}</span>
        </div>
        <div className="swap-shift-time">
          {formatTime(sa.shift_template?.start_time || '')} – {formatTime(sa.shift_template?.end_time || '')}
        </div>
        {sa.rota?.name && <span className="swap-shift-rota">{sa.rota.name}</span>}
      </div>
    )
  }

  function renderAvatar(emp: Employee | undefined, size?: 'sm') {
    const name = emp ? `${emp.first_name} ${emp.last_name}` : '?'
    return (
      <div className={`swap-incoming-avatar ${size === 'sm' ? 'swap-avatar-sm' : ''}`} style={{ backgroundColor: avatarColor(name) }}>
        {emp?.avatar_url
          ? <img src={emp.avatar_url} alt="" className="swap-avatar-img" />
          : emp ? getInitials(emp.first_name, emp.last_name) : '?'
        }
      </div>
    )
  }

  function statusLabel(status: string) {
    switch (status) {
      case 'pending': return t('shifts.swap_pending')
      case 'counter_offered': return 'Counter Offered'
      case 'approved': return t('shifts.swap_approved')
      case 'rejected': return t('shifts.swap_rejected')
      case 'cancelled': return 'Cancelled'
      default: return status
    }
  }

  function statusClass(status: string) {
    if (status === 'approved') return 'swap-status-approved'
    if (status === 'rejected' || status === 'cancelled') return 'swap-status-rejected'
    return 'swap-status-pending'
  }

  const pendingIncomingCount = incomingRequests.length

  if (loading) {
    return (
      <div className="shifts-page">
        <p className="claims-empty">{t('common.loading')}</p>
      </div>
    )
  }

  return (
    <div className="shifts-page">
      <header className="shifts-header">
        <button className="shifts-header-back" onClick={() => navigate('/shifts')}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <div className="shifts-header-center">
          <h1 className="shifts-header-title">{t('shifts.swap_title')}</h1>
          <p className="shifts-header-subtitle">{t('shifts.request_swap')}</p>
        </div>
        <button className="shifts-header-refresh" onClick={fetchData}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round">
            <path d="M21 12a9 9 0 0 1-15.36 6.36" /><path d="M3 12a9 9 0 0 1 15.36-6.36" />
            <polyline points="21 3 21 9 15 9" /><polyline points="3 21 3 15 9 15" />
          </svg>
        </button>
      </header>

      <div className="swap-tabs">
        <button className={`swap-tab ${tab === 'request' ? 'swap-tab-active' : ''}`} onClick={() => setTab('request')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
          {t('shifts.request_swap')}
        </button>
        <button className={`swap-tab ${tab === 'incoming' ? 'swap-tab-active' : ''}`} onClick={() => setTab('incoming')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>
          {t('shifts.incoming')}
          {pendingIncomingCount > 0 && <span className="swap-badge">{pendingIncomingCount}</span>}
        </button>
        <button className={`swap-tab ${tab === 'history' ? 'swap-tab-active' : ''}`} onClick={() => setTab('history')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          History
        </button>
      </div>

      {/* REQUEST TAB */}
      {tab === 'request' && (
        <div className="swap-content">
          {myShifts.length === 0 ? (
            <div className="swap-empty">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="1.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              <p>{t('shifts.no_upcoming')}</p>
            </div>
          ) : (
            <div className="swap-shifts">
              <p className="swap-hint">Select one of your shifts to swap, then choose a colleague who has shifts assigned.</p>
              {myShifts
                .sort((a, b) => a.date.localeCompare(b.date))
                .map(s => {
                  const colour = s.shift_template?.colour || '#999'
                  const isSelected = selectedShiftId === s.id
                  return (
                    <div key={s.id}>
                      <button
                        className={`swap-shift-card ${isSelected ? 'swap-shift-selected' : ''}`}
                        style={{ borderLeftColor: colour }}
                        onClick={() => { setSelectedShiftId(isSelected ? null : s.id); setTargetEmployeeId(''); setReason('') }}
                      >
                        <div className="swap-shift-info">
                          <span className="swap-shift-name" style={{ color: colour }}>{s.shift_template?.name || 'Shift'}</span>
                          <span className="swap-shift-date">{formatDate(s.date)}</span>
                        </div>
                        <div className="swap-shift-time">
                          {formatTime(s.shift_template?.start_time || '')} – {formatTime(s.shift_template?.end_time || '')}
                        </div>
                        {s.rota?.name && <span className="swap-shift-rota">{s.rota.name}</span>}
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={`swap-shift-chevron ${isSelected ? 'open' : ''}`}>
                          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>

                      {isSelected && (
                        <div className="swap-form">
                          <div className="swap-form-field">
                            <label>{t('shifts.swap_with')}</label>
                            {employeesWithShifts.length === 0 ? (
                              <p style={{ fontSize: 13, color: '#999', margin: '4px 0 0' }}>No colleagues with shift assignments available</p>
                            ) : (
                              <select value={targetEmployeeId} onChange={e => setTargetEmployeeId(e.target.value)}>
                                <option value="">{t('shifts.select_colleague')}</option>
                                {employeesWithShifts.map(emp => (
                                  <option key={emp.id} value={emp.id}>
                                    {emp.first_name} {emp.last_name}
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>

                          {targetEmployeeId && targetShifts.length > 0 && (
                            <div style={{ marginBottom: 10 }}>
                              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#888', marginBottom: 4 }}>
                                Their upcoming shifts
                              </label>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                {targetShifts.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5).map(ts => {
                                  const c = ts.shift_template?.colour || '#999'
                                  return (
                                    <div key={ts.id} className="swap-incoming-detail" style={{ borderLeftColor: c, margin: 0 }}>
                                      <div className="swap-incoming-shift">
                                        <span className="swap-shift-name" style={{ color: c }}>{ts.shift_template?.name || 'Shift'}</span>
                                        <span className="swap-shift-date">{formatDate(ts.date)}</span>
                                      </div>
                                      <div className="swap-shift-time">
                                        {formatTime(ts.shift_template?.start_time || '')} – {formatTime(ts.shift_template?.end_time || '')}
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          )}

                          <div className="swap-form-field">
                            <label>{t('shifts.swap_reason')}</label>
                            <textarea
                              value={reason}
                              onChange={e => setReason(e.target.value)}
                              rows={2}
                              placeholder={t('shifts.swap_reason_placeholder')}
                            />
                          </div>
                          <button
                            className="swap-submit-btn"
                            onClick={handleSubmitSwap}
                            disabled={!targetEmployeeId || submitting}
                          >
                            {submitting ? t('shifts.swap_submitting') : (
                              <>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>
                                Send Swap Request
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
            </div>
          )}
        </div>
      )}

      {/* INCOMING TAB */}
      {tab === 'incoming' && (
        <div className="swap-content">
          {incomingRequests.length === 0 ? (
            <div className="swap-empty">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="1.5"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>
              <p>{t('shifts.no_incoming')}</p>
            </div>
          ) : (
            <div className="swap-incoming-list">
              {incomingRequests.map(req => {
                const isCounterOffer = req.status === 'counter_offered' && req.requesting_employee_id === employeeId
                const isPendingForTarget = req.status === 'pending' && req.target_employee_id === employeeId
                const otherEmpId = isCounterOffer ? req.target_employee_id : req.requesting_employee_id
                const otherEmp = employeeMap[otherEmpId]
                const otherName = otherEmp ? `${otherEmp.first_name} ${otherEmp.last_name}` : '—'
                const isActioning = actioningId === req.id

                const myUpcomingShifts = allShiftAssignments.filter(sa =>
                  sa.employee_id === employeeId &&
                  sa.id !== req.shift_assignment_id
                )

                return (
                  <div key={req.id} className="swap-incoming-card">
                    <div className="swap-incoming-header">
                      {renderAvatar(otherEmp)}
                      <div className="swap-incoming-who">
                        <span className="swap-incoming-name">{otherName}</span>
                        <span className="swap-incoming-ago">{timeAgo(req.created_at)}</span>
                      </div>
                      <span className={`swap-status ${statusClass(req.status)}`} style={{ marginLeft: 'auto' }}>
                        {isCounterOffer ? 'Counter Offer' : statusLabel(req.status)}
                      </span>
                    </div>

                    {renderShiftCard(req.shift_assignment, isCounterOffer ? 'Your shift' : 'Their shift')}

                    {isCounterOffer && req.target_shift && (
                      renderShiftCard(req.target_shift, 'Their offered shift')
                    )}

                    {req.reason && (
                      <div className="swap-incoming-reason">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                        "{req.reason}"
                      </div>
                    )}

                    {req.response_message && (
                      <div className="swap-incoming-reason">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                        "{req.response_message}"
                      </div>
                    )}

                    {/* Target responds to initial request: pick a counter-shift */}
                    {isPendingForTarget && (
                      <div style={{ marginTop: 8 }}>
                        <div className="swap-form-field">
                          <label>Choose one of your shifts to offer in return</label>
                          {myUpcomingShifts.length === 0 ? (
                            <p style={{ fontSize: 13, color: '#999', margin: '4px 0 0' }}>You have no upcoming shifts to offer</p>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
                              {myUpcomingShifts.sort((a, b) => a.date.localeCompare(b.date)).map(ms => {
                                const c = ms.shift_template?.colour || '#999'
                                const isChosen = counterShiftId === ms.id
                                return (
                                  <button
                                    key={ms.id}
                                    className={`swap-shift-card ${isChosen ? 'swap-shift-selected' : ''}`}
                                    style={{ borderLeftColor: c, marginBottom: 0 }}
                                    onClick={() => setCounterShiftId(isChosen ? null : ms.id)}
                                  >
                                    <div className="swap-shift-info">
                                      <span className="swap-shift-name" style={{ color: c }}>{ms.shift_template?.name || 'Shift'}</span>
                                      <span className="swap-shift-date">{formatDate(ms.date)}</span>
                                    </div>
                                    <div className="swap-shift-time">
                                      {formatTime(ms.shift_template?.start_time || '')} – {formatTime(ms.shift_template?.end_time || '')}
                                    </div>
                                    {isChosen && (
                                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2e7d32" strokeWidth="3"><path d="M20 6L9 17l-5-5"/></svg>
                                    )}
                                  </button>
                                )
                              })}
                            </div>
                          )}
                        </div>
                        <div className="swap-form-field">
                          <label>Message (optional)</label>
                          <textarea
                            value={responseMessage}
                            onChange={e => setResponseMessage(e.target.value)}
                            rows={2}
                            placeholder="Add a message..."
                          />
                        </div>
                        <div className="swap-incoming-actions">
                          <button
                            className="swap-action-accept"
                            onClick={() => handleCounterOffer(req)}
                            disabled={!counterShiftId || isActioning}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/></svg>
                            {isActioning ? '...' : 'Offer Shift'}
                          </button>
                          <button
                            className="swap-action-decline"
                            onClick={() => handleDeclineSwap(req)}
                            disabled={isActioning}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                            {isActioning ? '...' : t('shifts.swap_decline')}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Requester approves/declines the counter-offer */}
                    {isCounterOffer && (
                      <div className="swap-incoming-actions" style={{ marginTop: 8 }}>
                        <button
                          className="swap-action-accept"
                          onClick={() => handleApproveSwap(req)}
                          disabled={isActioning}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6L9 17l-5-5"/></svg>
                          {isActioning ? '...' : 'Approve Swap'}
                        </button>
                        <button
                          className="swap-action-decline"
                          onClick={() => handleDeclineSwap(req)}
                          disabled={isActioning}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                          {isActioning ? '...' : t('shifts.swap_decline')}
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* HISTORY TAB */}
      {tab === 'history' && (
        <div className="swap-content">
          {historyRequests.length === 0 ? (
            <div className="swap-empty">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              <p>No swap requests yet</p>
            </div>
          ) : (
            <div className="swap-sent-list">
              {historyRequests.map(req => {
                const isRequester = req.requesting_employee_id === employeeId
                const otherEmpId = isRequester ? req.target_employee_id : req.requesting_employee_id
                const otherEmp = employeeMap[otherEmpId]
                const colour = req.shift_assignment?.shift_template?.colour || '#999'
                const isActioning = actioningId === req.id
                const otherName = otherEmp ? `${otherEmp.first_name} ${otherEmp.last_name}` : '—'
                const canCancel = isRequester && (req.status === 'pending' || req.status === 'counter_offered')

                return (
                  <div key={req.id} className="swap-sent-card">
                    <div className="swap-sent-top">
                      <div className="swap-sent-shift" style={{ borderLeftColor: colour }}>
                        <span className="swap-shift-name" style={{ color: colour }}>{req.shift_assignment?.shift_template?.name || 'Shift'}</span>
                        <span className="swap-shift-date">{req.shift_assignment?.date ? formatDate(req.shift_assignment.date) : ''}</span>
                        <span className="swap-shift-time">
                          {formatTime(req.shift_assignment?.shift_template?.start_time || '')} – {formatTime(req.shift_assignment?.shift_template?.end_time || '')}
                        </span>
                      </div>
                      <span className={`swap-status ${statusClass(req.status)}`}>
                        {statusLabel(req.status)}
                      </span>
                    </div>

                    {req.target_shift && (
                      <div className="swap-sent-shift" style={{ borderLeftColor: req.target_shift.shift_template?.colour || '#999', margin: '0 0 8px', padding: '6px 10px', borderRadius: 6, background: 'rgba(0,0,0,0.02)' }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', width: '100%' }}>Counter offer</span>
                        <span className="swap-shift-name" style={{ color: req.target_shift.shift_template?.colour || '#999' }}>{req.target_shift.shift_template?.name || 'Shift'}</span>
                        <span className="swap-shift-date">{formatDate(req.target_shift.date)}</span>
                        <span className="swap-shift-time">
                          {formatTime(req.target_shift.shift_template?.start_time || '')} – {formatTime(req.target_shift.shift_template?.end_time || '')}
                        </span>
                      </div>
                    )}

                    <div className="swap-sent-target">
                      {renderAvatar(otherEmp, 'sm')}
                      <span>{isRequester ? 'Sent to' : 'From'} <strong>{otherName}</strong></span>
                      <span className="swap-sent-ago">{timeAgo(req.created_at)}</span>
                    </div>

                    {req.reason && (
                      <div className="swap-incoming-reason">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                        "{req.reason}"
                      </div>
                    )}
                    {req.response_message && (
                      <div className="swap-incoming-reason">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                        "{req.response_message}"
                      </div>
                    )}

                    {canCancel && (
                      <button
                        className="swap-cancel-btn"
                        onClick={() => handleCancelSwap(req.id)}
                        disabled={isActioning}
                      >
                        {isActioning ? '...' : 'Withdraw Request'}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
