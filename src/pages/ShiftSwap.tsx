import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'

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
}

interface SwapRequest {
  id: string
  shift_assignment_id: string
  requesting_employee_id: string
  target_employee_id: string
  status: string
  reason: string | null
  created_at: string
  requester?: Employee | null
  target?: Employee | null
  shift_assignment?: {
    id: string
    date: string
    shift_template_id: string
    rota_id: string
    shift_template: { name: string; colour: string; start_time: string; end_time: string } | null
    rota: { name: string } | null
  } | null
}

type SwapTab = 'request' | 'incoming' | 'sent'

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

function formatTime(time: string): string {
  if (!time) return ''
  const [hh, mm] = time.split(':').map(Number)
  const ampm = hh >= 12 ? 'pm' : 'am'
  const h = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh
  return mm === 0 ? `${h}${ampm}` : `${h}:${String(mm).padStart(2, '0')}${ampm}`
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
  const initialTab = (location.state as { tab?: SwapTab } | null)?.tab || 'request'
  const [tab, setTab] = useState<SwapTab>(initialTab)
  const [shifts, setShifts] = useState<ShiftAssignment[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [sentRequests, setSentRequests] = useState<SwapRequest[]>([])
  const [incomingRequests, setIncomingRequests] = useState<SwapRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null)
  const [targetEmployeeId, setTargetEmployeeId] = useState('')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [actioningId, setActioningId] = useState<string | null>(null)

  const employeeMap = useMemo(() => {
    const map: Record<string, Employee> = {}
    employees.forEach(e => { map[e.id] = e })
    return map
  }, [employees])

  const fetchData = useCallback(async () => {
    if (!employeeId || !companyUser?.company_id) return
    setLoading(true)

    const today = new Date().toISOString().split('T')[0]

    const [shiftsRes, employeesRes, sentRes, incomingRes] = await Promise.all([
      supabase
        .from('shift_assignments')
        .select('*, shift_template:shift_templates(id, name, start_time, end_time, colour), rota:rotas(name, status)')
        .eq('employee_id', employeeId)
        .eq('company_id', companyUser.company_id)
        .gte('date', today),
      supabase
        .from('employees')
        .select('id, first_name, last_name, avatar_url')
        .eq('company_id', companyUser.company_id)
        .eq('is_active', true),
      supabase
        .from('shift_swap_requests')
        .select('*, shift_assignment:shift_assignments(id, date, shift_template_id, rota_id, shift_template:shift_templates(name, colour, start_time, end_time), rota:rotas(name))')
        .eq('requesting_employee_id', employeeId)
        .eq('company_id', companyUser.company_id)
        .order('created_at', { ascending: false }),
      supabase
        .from('shift_swap_requests')
        .select('*, shift_assignment:shift_assignments(id, date, shift_template_id, rota_id, shift_template:shift_templates(name, colour, start_time, end_time), rota:rotas(name))')
        .eq('target_employee_id', employeeId)
        .eq('company_id', companyUser.company_id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false }),
    ])

    const published = (shiftsRes.data || []).filter((s: any) => s.rota?.status === 'published' || s.rota?.status === 'draft')
    setShifts(published as ShiftAssignment[])
    setEmployees((employeesRes.data || []) as Employee[])
    setSentRequests((sentRes.data || []) as SwapRequest[])
    setIncomingRequests((incomingRes.data || []) as SwapRequest[])
    setLoading(false)
  }, [employeeId, companyUser?.company_id])

  useEffect(() => { fetchData() }, [fetchData])

  async function handleSubmitSwap() {
    if (!selectedShiftId || !targetEmployeeId || !companyUser?.company_id) return
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
      console.error('[ShiftSwap] insert error:', error)
      alert(t('shifts.swap_failed'))
    } else {
      setSelectedShiftId(null)
      setTargetEmployeeId('')
      setReason('')
      setTab('sent')
    }
    setSubmitting(false)
    fetchData()
  }

  async function handleAcceptSwap(request: SwapRequest) {
    if (!request.shift_assignment || !companyUser?.company_id) return
    setActioningId(request.id)

    const origAssignment = request.shift_assignment
    const targetShiftOnDate = shifts.find(s => s.date === origAssignment.date)

    await supabase.from('shift_swap_requests').update({ status: 'approved' }).eq('id', request.id)

    await supabase.from('shift_assignments')
      .update({ employee_id: employeeId })
      .eq('id', origAssignment.id)

    if (targetShiftOnDate) {
      await supabase.from('shift_assignments')
        .update({ employee_id: request.requesting_employee_id })
        .eq('id', targetShiftOnDate.id)
    }

    setActioningId(null)
    fetchData()
  }

  async function handleDeclineSwap(requestId: string) {
    setActioningId(requestId)
    await supabase.from('shift_swap_requests').update({ status: 'rejected' }).eq('id', requestId)
    setActioningId(null)
    fetchData()
  }

  async function handleCancelSwap(requestId: string) {
    setActioningId(requestId)
    await supabase.from('shift_swap_requests').delete().eq('id', requestId)
    setActioningId(null)
    fetchData()
  }

  const pendingIncomingCount = incomingRequests.length

  if (loading) {
    return (
      <div className="feature-page">
        <p className="claims-empty">{t('common.loading')}</p>
      </div>
    )
  }

  return (
    <div className="swap-page">
      {/* Header */}
      <header className="schedule-header">
        <button className="feature-back" onClick={() => navigate('/shifts')}>
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
            <circle cx="18" cy="18" r="17" stroke="#c62828" strokeWidth="2" />
            <path d="M21 12l-6 6 6 6" stroke="#c62828" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="feature-header-center">
          <h1 className="feature-title">{t('shifts.swap_title')}</h1>
          <p className="feature-subtitle">{t('shifts.request_swap')}</p>
        </div>
        <button className="feature-refresh" onClick={fetchData}>
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="14" stroke="#c62828" strokeWidth="2" />
            <path d="M22 14a6.5 6.5 0 0 0-11.3-1.5M10 18a6.5 6.5 0 0 0 11.3 1.5" stroke="#c62828" strokeWidth="2" strokeLinecap="round" />
            <path d="M22 10v4h-4M10 22v-4h4" stroke="#c62828" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </header>

      {/* Tabs */}
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
        <button className={`swap-tab ${tab === 'sent' ? 'swap-tab-active' : ''}`} onClick={() => setTab('sent')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>
          {t('shifts.my_swap_requests')}
        </button>
      </div>

      {/* REQUEST TAB */}
      {tab === 'request' && (
        <div className="swap-content">
          {shifts.length === 0 ? (
            <div className="swap-empty">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="1.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              <p>{t('shifts.no_upcoming')}</p>
            </div>
          ) : (
            <div className="swap-shifts">
              <p className="swap-hint">{t('shifts.select_shift_hint')}</p>
              {shifts
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
                            <select value={targetEmployeeId} onChange={e => setTargetEmployeeId(e.target.value)}>
                              <option value="">{t('shifts.select_colleague')}</option>
                              {employees.filter(e => e.id !== employeeId).map(emp => (
                                <option key={emp.id} value={emp.id}>
                                  {emp.first_name} {emp.last_name}
                                </option>
                              ))}
                            </select>
                          </div>
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
                                {t('shifts.swap_submit')}
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
                const sa = req.shift_assignment
                const requester = employeeMap[req.requesting_employee_id]
                const colour = sa?.shift_template?.colour || '#999'
                const isActioning = actioningId === req.id
                const requesterName = requester ? `${requester.first_name} ${requester.last_name}` : '—'

                return (
                  <div key={req.id} className="swap-incoming-card">
                    <div className="swap-incoming-header">
                      <div className="swap-incoming-avatar" style={{ backgroundColor: avatarColor(requesterName) }}>
                        {requester?.avatar_url
                          ? <img src={requester.avatar_url} alt="" className="swap-avatar-img" />
                          : requester ? getInitials(requester.first_name, requester.last_name) : '?'
                        }
                      </div>
                      <div className="swap-incoming-who">
                        <span className="swap-incoming-name">{requesterName}</span>
                        <span className="swap-incoming-ago">{timeAgo(req.created_at)}</span>
                      </div>
                    </div>

                    <div className="swap-incoming-detail" style={{ borderLeftColor: colour }}>
                      <div className="swap-incoming-shift">
                        <span className="swap-shift-name" style={{ color: colour }}>{sa?.shift_template?.name || 'Shift'}</span>
                        <span className="swap-shift-date">{sa?.date ? formatDate(sa.date) : ''}</span>
                      </div>
                      <div className="swap-shift-time">
                        {formatTime(sa?.shift_template?.start_time || '')} – {formatTime(sa?.shift_template?.end_time || '')}
                      </div>
                      {sa?.rota?.name && <span className="swap-shift-rota">{sa.rota.name}</span>}
                    </div>

                    {req.reason && (
                      <div className="swap-incoming-reason">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                        "{req.reason}"
                      </div>
                    )}

                    <div className="swap-incoming-actions">
                      <button
                        className="swap-action-accept"
                        onClick={() => handleAcceptSwap(req)}
                        disabled={isActioning}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6L9 17l-5-5"/></svg>
                        {isActioning ? '...' : t('shifts.swap_accept')}
                      </button>
                      <button
                        className="swap-action-decline"
                        onClick={() => handleDeclineSwap(req.id)}
                        disabled={isActioning}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        {isActioning ? '...' : t('shifts.swap_decline')}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* SENT TAB */}
      {tab === 'sent' && (
        <div className="swap-content">
          {sentRequests.length === 0 ? (
            <div className="swap-empty">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="1.5"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>
              <p>{t('shifts.no_swaps')}</p>
            </div>
          ) : (
            <div className="swap-sent-list">
              {sentRequests.map(req => {
                const sa = req.shift_assignment
                const target = employeeMap[req.target_employee_id]
                const colour = sa?.shift_template?.colour || '#999'
                const isPending = req.status === 'pending'
                const isApproved = req.status === 'approved'
                const isRejected = req.status === 'rejected'
                const isActioning = actioningId === req.id
                const targetName = target ? `${target.first_name} ${target.last_name}` : '—'

                return (
                  <div key={req.id} className="swap-sent-card">
                    <div className="swap-sent-top">
                      <div className="swap-sent-shift" style={{ borderLeftColor: colour }}>
                        <span className="swap-shift-name" style={{ color: colour }}>{sa?.shift_template?.name || 'Shift'}</span>
                        <span className="swap-shift-date">{sa?.date ? formatDate(sa.date) : ''}</span>
                        <span className="swap-shift-time">
                          {formatTime(sa?.shift_template?.start_time || '')} – {formatTime(sa?.shift_template?.end_time || '')}
                        </span>
                      </div>
                      <span className={`swap-status swap-status-${req.status}`}>
                        {isPending && t('shifts.swap_pending')}
                        {isApproved && t('shifts.swap_approved')}
                        {isRejected && t('shifts.swap_rejected')}
                      </span>
                    </div>

                    <div className="swap-sent-target">
                      <div className="swap-incoming-avatar swap-avatar-sm" style={{ backgroundColor: avatarColor(targetName) }}>
                        {target?.avatar_url
                          ? <img src={target.avatar_url} alt="" className="swap-avatar-img" />
                          : target ? getInitials(target.first_name, target.last_name) : '?'
                        }
                      </div>
                      <span>{t('shifts.swap_sent_to')} <strong>{targetName}</strong></span>
                      <span className="swap-sent-ago">{timeAgo(req.created_at)}</span>
                    </div>

                    {req.reason && (
                      <div className="swap-incoming-reason">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                        "{req.reason}"
                      </div>
                    )}

                    {isPending && (
                      <button
                        className="swap-cancel-btn"
                        onClick={() => handleCancelSwap(req.id)}
                        disabled={isActioning}
                      >
                        {isActioning ? '...' : t('shifts.swap_cancel')}
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
