import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useCheckIn } from '../context/CheckInContext'
import { useToast } from '../context/ToastContext'

interface ShiftToday {
  id: string; shift_date: string; start_time: string; end_time: string
  template_name: string; status: string
}
interface HistoryRow {
  id: string; check_in_at: string; check_out_at: string | null; status: string
  work_from_home: boolean; loc_name: string; shift_assignment_id: string | null
}

export default function ShiftCheckIn() {
  const navigate = useNavigate()
  const { companyUser, employeeId } = useAuth()
  const companyId = companyUser?.company_id || ''
  const { activeCheckin, activeBreak, checkIn, checkOut, startBreak, endBreak, settings, workLocations } = useCheckIn()
  const { showSuccess, showError } = useToast()

  const [elapsed, setElapsed] = useState(0)
  const [breakElapsed, setBreakElapsed] = useState(0)
  const [todayShift, setTodayShift] = useState<ShiftToday | null>(null)
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadData = useCallback(async () => {
    if (!employeeId || !companyId) return
    setLoading(true)
    const todayStr = new Date().toISOString().split('T')[0]
    const monthStart = new Date()
    monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0)

    const [shiftRes, locsRes, histRes] = await Promise.all([
      supabase.from('shift_assignments').select('id, shift_date, start_time, end_time, status, shift_template_id')
        .eq('employee_id', employeeId).eq('company_id', companyId).eq('shift_date', todayStr)
        .order('start_time').limit(1),
      supabase.from('work_locations').select('id, name').eq('company_id', companyId),
      supabase.from('checkin_records').select('*')
        .eq('employee_id', employeeId).eq('source', 'shifts')
        .gte('check_in_at', monthStart.toISOString())
        .order('check_in_at', { ascending: false }),
    ])

    if (shiftRes.data?.[0]) {
      const s = shiftRes.data[0]
      let tplName = 'Shift'
      if (s.shift_template_id) {
        const { data: tpl } = await supabase.from('shift_templates').select('name').eq('id', s.shift_template_id).single()
        if (tpl) tplName = tpl.name
      }
      setTodayShift({ ...s, template_name: tplName })
    } else {
      setTodayShift(null)
    }

    const locMap: Record<string, string> = {}
    locsRes.data?.forEach((l: { id: string; name: string }) => { locMap[l.id] = l.name })

    if (histRes.data) setHistory(histRes.data.map((r: { id: string; check_in_at: string; check_out_at: string | null; status: string; work_from_home: boolean; check_in_location_id: string | null; shift_assignment_id: string | null }) => ({
      ...r, loc_name: r.work_from_home ? 'Home' : (r.check_in_location_id ? locMap[r.check_in_location_id] || 'On-site' : 'On-site'),
    })))
    setLoading(false)
  }, [employeeId, companyId])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (activeCheckin && activeCheckin.source === 'shifts') {
      const tick = () => {
        setElapsed(Math.floor((Date.now() - new Date(activeCheckin.check_in_at).getTime()) / 1000))
        if (activeBreak) setBreakElapsed(Math.floor((Date.now() - new Date(activeBreak.break_start).getTime()) / 1000))
      }
      tick()
      timerRef.current = setInterval(tick, 1000)
    } else { setElapsed(0); setBreakElapsed(0) }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [activeCheckin, activeBreak])

  function fmtTimer(secs: number) {
    const h = Math.floor(secs / 3600); const m = Math.floor((secs % 3600) / 60); const s = secs % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  function fmtTime(iso: string) { return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) }
  function fmtDate(iso: string) { return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) }

  const promptMins = settings?.prompt_before_shift_mins || 20
  const canCheckInShift = (() => {
    if (!todayShift || activeCheckin) return false
    const now = new Date()
    const [sh, sm] = todayShift.start_time.split(':').map(Number)
    const shiftStart = new Date(); shiftStart.setHours(sh, sm, 0, 0)
    const windowStart = new Date(shiftStart.getTime() - promptMins * 60000)
    return now >= windowStart
  })()

  async function handleCheckIn() {
    setActing(true)
    const result = await checkIn('shifts', todayShift?.id)
    if (result.ok) { showSuccess(result.wfh ? 'Checked in from home' : 'Checked in for shift'); loadData() }
    else showError(result.error || 'Check-in failed')
    setActing(false)
  }
  async function handleCheckOut() {
    setActing(true)
    const result = await checkOut()
    if (result.ok) { showSuccess('Checked out'); loadData() }
    else showError(result.error || 'Check-out failed')
    setActing(false)
  }
  async function handleBreak(type: 'lunch' | 'short' | 'other') {
    setActing(true)
    if (activeBreak) {
      const r = await endBreak(); if (r.ok) showSuccess('Break ended'); else showError(r.error || 'Failed')
    } else {
      const r = await startBreak(type); if (r.ok) showSuccess('Break started'); else showError(r.error || 'Failed')
    }
    setActing(false)
  }

  const monthDays = history.filter(r => r.status !== 'cancelled').length
  const completed = history.filter(r => r.status === 'checked_out' || r.status === 'auto_closed')
  const monthHours = completed.reduce((sum, r) => {
    if (!r.check_out_at) return sum
    return sum + (new Date(r.check_out_at).getTime() - new Date(r.check_in_at).getTime()) / 3600000
  }, 0)

  if (!settings?.shifts_checkin_enabled) {
    return (
      <div className="page-container">
        <div className="page-card" style={{ textAlign: 'center', padding: 40 }}>
          <p style={{ color: '#999' }}>Check-in is not enabled for shifts. Please contact your admin.</p>
          <button className="btn-secondary" onClick={() => navigate('/shifts')} style={{ marginTop: 12 }}>Back to Shifts</button>
        </div>
      </div>
    )
  }

  const activeShiftCheckin = activeCheckin?.source === 'shifts' ? activeCheckin : null

  return (
    <div className="page-container">
      <style>{`
        .ci-timer-card { background: var(--card-bg, #fff); border-radius: 16px; padding: 24px; text-align: center; margin-bottom: 16px; border: 1px solid var(--border, #eee); }
        .ci-timer { font-size: 48px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: -1px; color: var(--text); margin: 8px 0; font-family: 'SF Mono', monospace, inherit; }
        .ci-timer.on-break { color: #d97706; }
        .ci-date { font-size: 13px; color: var(--text-muted, #999); }
        .ci-shift-card { background: var(--card-bg, #fff); border: 1px solid var(--border, #eee); border-radius: 12px; padding: 14px 16px; margin-bottom: 16px; }
        .ci-shift-name { font-weight: 600; font-size: 15px; }
        .ci-shift-time { font-size: 13px; color: var(--text-muted, #999); margin-top: 4px; }
        .ci-status-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 16px 0; }
        .ci-status-item { text-align: center; }
        .ci-status-label { font-size: 11px; color: var(--text-muted, #999); text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; }
        .ci-status-val { font-size: 15px; font-weight: 600; color: var(--text); margin-top: 2px; }
        .ci-actions { display: flex; gap: 10px; justify-content: center; margin-top: 16px; flex-wrap: wrap; }
        .ci-btn { padding: 12px 28px; border-radius: 10px; font-size: 15px; font-weight: 600; border: none; cursor: pointer; font-family: inherit; }
        .ci-btn-in { background: #16a34a; color: #fff; }
        .ci-btn-out { background: #dc2626; color: #fff; }
        .ci-btn-break { background: var(--card-bg, #f5f5f5); color: var(--text); border: 1px solid var(--border, #ddd); }
        .ci-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .ci-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(80px, 1fr)); gap: 10px; margin-bottom: 16px; }
        .ci-metric { background: var(--card-bg, #fff); border-radius: 12px; padding: 14px 10px; text-align: center; border: 1px solid var(--border, #eee); }
        .ci-metric-val { font-size: 22px; font-weight: 700; color: var(--text); }
        .ci-metric-label { font-size: 11px; color: var(--text-muted, #999); margin-top: 2px; }
        .ci-history { background: var(--card-bg, #fff); border-radius: 12px; border: 1px solid var(--border, #eee); overflow: hidden; }
        .ci-history-title { font-size: 14px; font-weight: 600; padding: 14px 16px 8px; }
        .ci-history-row { display: flex; align-items: center; padding: 10px 16px; border-top: 1px solid var(--border, #eee); font-size: 13px; gap: 8px; }
        .ci-history-date { min-width: 80px; font-weight: 500; }
        .ci-history-times { flex: 1; color: var(--text-muted, #999); }
        .ci-history-dur { font-weight: 600; min-width: 50px; text-align: right; }
        .ci-history-badge { font-size: 11px; padding: 2px 8px; border-radius: 4px; font-weight: 600; }
        .ci-badge-home { background: #eff6ff; color: #2563eb; }
        .ci-badge-site { background: #ecfdf5; color: #16a34a; }
        .ci-back { background: none; border: none; color: var(--text-muted, #999); font-size: 13px; cursor: pointer; font-family: inherit; padding: 0; margin-bottom: 12px; }
      `}</style>

      <button className="ci-back" onClick={() => navigate('/shifts')}>← Back to Shifts</button>

      {/* Today's shift */}
      {todayShift && (
        <div className="ci-shift-card">
          <div className="ci-shift-name">{todayShift.template_name}</div>
          <div className="ci-shift-time">
            {todayShift.start_time?.slice(0, 5)} — {todayShift.end_time?.slice(0, 5)}
          </div>
        </div>
      )}

      {/* Timer */}
      <div className="ci-timer-card">
        <div className="ci-date">
          {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </div>
        <div className={`ci-timer ${activeBreak ? 'on-break' : ''}`}>
          {activeShiftCheckin ? fmtTimer(activeBreak ? breakElapsed : elapsed) : '00:00:00'}
        </div>
        {activeBreak && <div style={{ fontSize: 13, color: '#d97706', fontWeight: 600 }}>On Break</div>}

        <div className="ci-status-grid">
          <div className="ci-status-item">
            <div className="ci-status-label">Check In</div>
            <div className="ci-status-val">{activeShiftCheckin ? fmtTime(activeShiftCheckin.check_in_at) : '—'}</div>
          </div>
          <div className="ci-status-item">
            <div className="ci-status-label">Work Time</div>
            <div className="ci-status-val">{activeShiftCheckin ? fmtTimer(elapsed) : '—'}</div>
          </div>
        </div>

        <div className="ci-actions">
          {!activeShiftCheckin ? (
            <button className="ci-btn ci-btn-in" onClick={handleCheckIn} disabled={acting || !canCheckInShift}>
              {acting ? 'Checking in...' : !todayShift ? 'No shift today' : !canCheckInShift ? `Opens ${promptMins}m before shift` : 'Check In'}
            </button>
          ) : (
            <>
              <button className="ci-btn ci-btn-break" onClick={() => handleBreak(activeBreak ? 'short' : 'lunch')} disabled={acting}>
                {activeBreak ? 'End Break' : 'Start Break'}
              </button>
              <button className="ci-btn ci-btn-out" onClick={handleCheckOut} disabled={acting}>
                {acting ? 'Checking out...' : 'Check Out'}
              </button>
            </>
          )}
        </div>
        {activeShiftCheckin?.work_from_home && (
          <div style={{ marginTop: 10, fontSize: 12, color: '#2563eb' }}>Working from home</div>
        )}
        {activeShiftCheckin && !activeShiftCheckin.work_from_home && (
          <div style={{ marginTop: 10, fontSize: 12, color: '#16a34a' }}>
            {workLocations.find(l => l.id === activeShiftCheckin.check_in_location_id)?.name || 'On-site'}
          </div>
        )}
      </div>

      {/* Metrics */}
      <div className="ci-metrics">
        <div className="ci-metric"><div className="ci-metric-val">{monthDays}</div><div className="ci-metric-label">Shifts</div></div>
        <div className="ci-metric"><div className="ci-metric-val">{monthHours.toFixed(0)}</div><div className="ci-metric-label">Hours</div></div>
        <div className="ci-metric"><div className="ci-metric-val">{completed.length}</div><div className="ci-metric-label">Completed</div></div>
      </div>

      {/* History */}
      {!loading && (
        <div className="ci-history">
          <div className="ci-history-title">This Month</div>
          {history.filter(r => r.status !== 'cancelled').length === 0 && (
            <div style={{ padding: 20, textAlign: 'center', color: '#999', fontSize: 13 }}>No check-ins this month</div>
          )}
          {history.filter(r => r.status !== 'cancelled').map(r => {
            const dur = r.check_out_at
              ? `${((new Date(r.check_out_at).getTime() - new Date(r.check_in_at).getTime()) / 3600000).toFixed(1)}h`
              : r.status === 'checked_in' ? 'Active' : '—'
            return (
              <div key={r.id} className="ci-history-row">
                <span className="ci-history-date">{fmtDate(r.check_in_at)}</span>
                <span className="ci-history-times">{fmtTime(r.check_in_at)} → {r.check_out_at ? fmtTime(r.check_out_at) : '—'}</span>
                <span className={`ci-history-badge ${r.work_from_home ? 'ci-badge-home' : 'ci-badge-site'}`}>{r.loc_name}</span>
                <span className="ci-history-dur">{dur}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
