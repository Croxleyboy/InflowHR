import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useCheckIn } from '../context/CheckInContext'
import { useToast } from '../context/ToastContext'

interface ShiftToday {
  id: string; date: string; start_time: string; end_time: string
  template_name: string; status: string
}
interface HistoryRow {
  id: string; check_in_at: string; check_out_at: string | null; status: string
  work_from_home: boolean; loc_name: string; shift_assignment_id: string | null
}
interface BreakRow { id: string; break_start: string; break_end: string | null; break_type: string }

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
  const [breaks, setBreaks] = useState<BreakRow[]>([])
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
      supabase.from('shift_assignments').select('id, date, status, shift_template_id, shift_template:shift_templates(name, start_time, end_time), rota:rotas(status)')
        .eq('employee_id', employeeId).eq('company_id', companyId).eq('date', todayStr)
        .limit(1),
      supabase.from('work_locations').select('id, name').eq('company_id', companyId),
      supabase.from('checkin_records').select('*')
        .eq('employee_id', employeeId).eq('source', 'shifts')
        .gte('check_in_at', monthStart.toISOString())
        .order('check_in_at', { ascending: false }),
    ])

    const validShift = (shiftRes.data || []).find((s: any) => {
      const rotaStatus = s.rota?.status
      return rotaStatus === 'published' || rotaStatus === 'draft'
    })
    if (validShift) {
      const s = validShift as any
      const tpl = s.shift_template
      setTodayShift({
        id: s.id,
        date: s.date,
        start_time: tpl?.start_time || '00:00',
        end_time: tpl?.end_time || '00:00',
        template_name: tpl?.name || 'Shift',
        status: s.status,
      })
    } else {
      setTodayShift(null)
    }

    const locMap: Record<string, string> = {}
    locsRes.data?.forEach((l: { id: string; name: string }) => { locMap[l.id] = l.name })

    if (histRes.data) setHistory(histRes.data.map((r: { id: string; check_in_at: string; check_out_at: string | null; status: string; work_from_home: boolean; check_in_location_id: string | null; shift_assignment_id: string | null }) => ({
      ...r, loc_name: r.work_from_home ? 'Home' : (r.check_in_location_id ? locMap[r.check_in_location_id] || 'On-site' : 'On-site'),
    })))

    if (activeCheckin && activeCheckin.source === 'shifts') {
      const { data: brks } = await supabase.from('break_records').select('*')
        .eq('checkin_record_id', activeCheckin.id).order('break_start', { ascending: false })
      if (brks) setBreaks(brks)
    }
    setLoading(false)
  }, [employeeId, companyId, activeCheckin])

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
    if (!todayShift) return false
    if (activeCheckin) return false
    const now = new Date()
    const [sh, sm] = todayShift.start_time.split(':').map(Number)
    const shiftStart = new Date(); shiftStart.setHours(sh, sm, 0, 0)
    const windowStart = new Date(shiftStart.getTime() - promptMins * 60000)
    return now >= windowStart
  })()

  async function handleCheckIn() {
    setActing(true)
    if (activeCheckin) {
      showError(`You are already checked in to ${activeCheckin.source}. Please check out first.`)
      setActing(false)
      return
    }
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
      const r = await endBreak(); if (r.ok) { showSuccess('Break ended'); loadData() } else showError(r.error || 'Failed')
    } else {
      const r = await startBreak(type); if (r.ok) showSuccess('Break started'); else showError(r.error || 'Failed')
    }
    setActing(false)
  }

  const completedRecords = history.filter(r => r.status === 'checked_out' || r.status === 'auto_closed')
  const monthHours = completedRecords.reduce((sum, r) => {
    if (!r.check_out_at) return sum
    return sum + (new Date(r.check_out_at).getTime() - new Date(r.check_in_at).getTime()) / 3600000
  }, 0)

  const totalBreakSecs = breaks.reduce((sum, b) => {
    const end = b.break_end ? new Date(b.break_end).getTime() : Date.now()
    return sum + (end - new Date(b.break_start).getTime()) / 1000
  }, 0)

  const todayRecords = history.filter(r => {
    const d = new Date(r.check_in_at)
    const now = new Date()
    return d.toDateString() === now.toDateString()
  })

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

  const mapLat = activeShiftCheckin?.check_in_lat
    ?? (workLocations.length > 0 ? workLocations[0].latitude : 51.5074)
  const mapLng = activeShiftCheckin?.check_in_lng
    ?? (workLocations.length > 0 ? workLocations[0].longitude : -0.1278)
  const mapUrl = `https://maps.google.com/maps?q=${mapLat},${mapLng}&z=16&output=embed`

  const checkedInLoc = activeShiftCheckin
    ? workLocations.find(l => l.id === activeShiftCheckin.check_in_location_id)
    : null
  const locationName = activeShiftCheckin
    ? activeShiftCheckin.work_from_home ? 'Home' : (checkedInLoc?.name || 'On-site')
    : workLocations.length > 0 ? workLocations[0].name : '—'

  const checkinBtnLabel = (() => {
    if (acting) return '...'
    if (activeCheckin && activeCheckin.source !== 'shifts') return `Checked in to ${activeCheckin.source}`
    if (!todayShift) return 'No shift today'
    if (!canCheckInShift) return `Opens ${promptMins}m before shift`
    return 'Check In'
  })()

  return (
    <div className="ci-page">
      <style>{`
        .ci-page { padding: 0 0 100px; background: var(--bg, #f5f5f5); min-height: 100vh; }

        .ci-header { background: linear-gradient(135deg, #bf360c, #e65100); color: #fff; padding: 10px 16px; display: flex; align-items: center; gap: 10px; }
        .ci-header-back { background: none; border: none; cursor: pointer; padding: 0; display: flex; }
        .ci-header-center { flex: 1; }
        .ci-header-title { font-size: 18px; font-weight: 800; margin: 0; color: #fff; }
        .ci-header-title span { font-style: italic; color: #ffcc80; }
        .ci-header-sub { font-size: 11px; color: rgba(255,255,255,0.7); margin-top: 1px; }
        .ci-header-refresh { background: none; border: none; cursor: pointer; padding: 0; display: flex; }

        .ci-map-frame { width: 100%; height: 180px; border: none; display: block; }

        .ci-hero { padding: 12px 16px 0; }
        .ci-time-row { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 6px; }
        .ci-time-big { font-size: 32px; font-weight: 700; color: var(--text); font-variant-numeric: tabular-nums; line-height: 1; }
        .ci-time-date { font-size: 12px; color: var(--text-muted); font-weight: 500; }

        .ci-shift-info { background: #fff3e0; border: 1px solid #ffcc80; border-radius: 8px; padding: 8px 12px; margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between; }
        .ci-shift-name { font-weight: 600; font-size: 13px; color: #e65100; }
        .ci-shift-time { font-size: 12px; color: #bf360c; }
        [data-theme="dark"] .ci-shift-info { background: #3e2723; border-color: #6d4c41; }
        [data-theme="dark"] .ci-shift-name { color: #ffcc80; }
        [data-theme="dark"] .ci-shift-time { color: #ffab91; }
        @media (prefers-color-scheme: dark) {
          :root:not([data-theme="light"]) .ci-shift-info { background: #3e2723; border-color: #6d4c41; }
          :root:not([data-theme="light"]) .ci-shift-name { color: #ffcc80; }
          :root:not([data-theme="light"]) .ci-shift-time { color: #ffab91; }
        }

        .ci-status-actions { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--border, #eee); margin-bottom: 10px; }
        .ci-status-icon { width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .ci-status-icon.active { background: #fff3e0; color: #e65100; }
        .ci-status-icon.inactive { background: var(--bg-card, #eee); color: var(--text-muted); }
        .ci-status-icon.on-break { background: #fef3c7; color: #d97706; }
        .ci-status-info { flex: 1; min-width: 0; }
        .ci-status-text { font-size: 13px; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .ci-status-sub { font-size: 11px; color: var(--text-muted); }
        .ci-action-btns { display: flex; gap: 6px; flex-shrink: 0; }
        .ci-act-btn { padding: 8px 16px; border-radius: 8px; font-size: 13px; font-weight: 700; border: none; cursor: pointer; font-family: inherit; white-space: nowrap; }
        .ci-act-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .ci-act-checkin { background: #e65100; color: #fff; }
        .ci-act-checkin:hover:not(:disabled) { background: #bf360c; }
        .ci-act-break { background: #f59e0b; color: #fff; }
        .ci-act-break:hover:not(:disabled) { background: #d97706; }
        .ci-act-checkout { background: #dc2626; color: #fff; }
        .ci-act-checkout:hover:not(:disabled) { background: #b91c1c; }

        .ci-body { padding: 0 16px; }

        .ci-card { background: var(--bg-card, #fff); border: 1px solid var(--border, #eee); border-radius: 12px; padding: 12px 14px; margin-bottom: 8px; }
        .ci-card-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); margin-bottom: 8px; }

        .ci-today-row { display: flex; align-items: center; justify-content: space-between; padding: 5px 0; }
        .ci-today-row + .ci-today-row { border-top: 1px solid var(--border, #eee); padding-top: 8px; margin-top: 3px; }
        .ci-today-loc { font-size: 13px; font-weight: 600; color: var(--text); }
        .ci-today-status { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-muted); }
        .ci-today-dot { width: 7px; height: 7px; border-radius: 50%; }
        .ci-today-dot.in { background: #e65100; }
        .ci-today-dot.out { background: #9e9e9e; }
        .ci-today-time { font-size: 12px; font-weight: 600; color: var(--text); }

        .ci-month-stats { display: flex; justify-content: space-between; }
        .ci-month-stat { text-align: center; flex: 1; }
        .ci-month-val { font-size: 18px; font-weight: 700; color: var(--text); }
        .ci-month-label { font-size: 10px; color: var(--text-muted); margin-top: 1px; text-transform: uppercase; letter-spacing: 0.03em; }

        .ci-history { background: var(--bg-card, #fff); border-radius: 12px; border: 1px solid var(--border, #eee); overflow: hidden; margin-top: 8px; }
        .ci-history-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); padding: 10px 14px 4px; }
        .ci-history-row { display: flex; align-items: center; padding: 8px 14px; border-top: 1px solid var(--border, #eee); font-size: 11px; gap: 5px; color: var(--text); }
        .ci-history-date { min-width: 68px; font-weight: 500; }
        .ci-history-times { flex: 1; color: var(--text-muted); }
        .ci-history-dur { font-weight: 600; min-width: 40px; text-align: right; }
        .ci-history-badge { font-size: 10px; padding: 2px 6px; border-radius: 4px; font-weight: 600; }
        .ci-badge-home { background: #eff6ff; color: #2563eb; }
        .ci-badge-site { background: #fff3e0; color: #e65100; }

        [data-theme="dark"] .ci-badge-home { background: #1e3a5f; color: #60a5fa; }
        [data-theme="dark"] .ci-badge-site { background: #3e2723; color: #ffab91; }
        [data-theme="dark"] .ci-act-checkin { background: #bf360c; }
        [data-theme="dark"] .ci-act-checkin:hover:not(:disabled) { background: #8d2100; }
        [data-theme="dark"] .ci-act-break { background: #b45309; }
        [data-theme="dark"] .ci-act-break:hover:not(:disabled) { background: #92400e; }
        [data-theme="dark"] .ci-act-checkout { background: #b91c1c; }
        [data-theme="dark"] .ci-act-checkout:hover:not(:disabled) { background: #991b1b; }
        [data-theme="dark"] .ci-status-icon.active { background: #3e2723; color: #ffab91; }
        [data-theme="dark"] .ci-status-icon.on-break { background: #451a03; color: #fbbf24; }
        @media (prefers-color-scheme: dark) {
          :root:not([data-theme="light"]) .ci-badge-home { background: #1e3a5f; color: #60a5fa; }
          :root:not([data-theme="light"]) .ci-badge-site { background: #3e2723; color: #ffab91; }
          :root:not([data-theme="light"]) .ci-act-checkin { background: #bf360c; }
          :root:not([data-theme="light"]) .ci-act-checkin:hover:not(:disabled) { background: #8d2100; }
          :root:not([data-theme="light"]) .ci-act-break { background: #b45309; }
          :root:not([data-theme="light"]) .ci-act-break:hover:not(:disabled) { background: #92400e; }
          :root:not([data-theme="light"]) .ci-act-checkout { background: #b91c1c; }
          :root:not([data-theme="light"]) .ci-act-checkout:hover:not(:disabled) { background: #991b1b; }
          :root:not([data-theme="light"]) .ci-status-icon.active { background: #3e2723; color: #ffab91; }
          :root:not([data-theme="light"]) .ci-status-icon.on-break { background: #451a03; color: #fbbf24; }
        }
      `}</style>

      <header className="ci-header">
        <button className="ci-header-back" onClick={() => navigate('/shifts')}>
          <svg width="28" height="28" viewBox="0 0 36 36" fill="none">
            <circle cx="18" cy="18" r="17" stroke="#fff" strokeWidth="2" />
            <path d="M21 12l-6 6 6 6" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="ci-header-center">
          <h1 className="ci-header-title">Shift <span>Check-In</span></h1>
          <p className="ci-header-sub">Shift attendance</p>
        </div>
        <button className="ci-header-refresh" onClick={loadData}>
          <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="14" stroke="#fff" strokeWidth="2" />
            <path d="M22 14a6.5 6.5 0 0 0-11.3-1.5M10 18a6.5 6.5 0 0 0 11.3 1.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
            <path d="M22 10v4h-4M10 22v-4h4" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </header>

      <iframe
        className="ci-map-frame"
        src={mapUrl}
        title="Location map"
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        allowFullScreen
      />

      <div className="ci-hero">
        <div className="ci-time-row">
          <div className="ci-time-big">
            {new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
          </div>
          <div className="ci-time-date">
            {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
          </div>
        </div>

        {todayShift && (
          <div className="ci-shift-info">
            <span className="ci-shift-name">{todayShift.template_name}</span>
            <span className="ci-shift-time">{todayShift.start_time?.slice(0, 5)} — {todayShift.end_time?.slice(0, 5)}</span>
          </div>
        )}

        <div className="ci-status-actions">
          <div className={`ci-status-icon ${activeBreak ? 'on-break' : activeShiftCheckin ? 'active' : 'inactive'}`}>
            {activeBreak ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
            ) : activeShiftCheckin ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/></svg>
            )}
          </div>
          <div className="ci-status-info">
            <div className="ci-status-text">
              {activeBreak
                ? `Break ${fmtTime(activeBreak.break_start)}`
                : activeShiftCheckin
                  ? `In ${fmtTime(activeShiftCheckin.check_in_at)}`
                  : 'Not checked in'}
            </div>
            <div className="ci-status-sub">
              {activeBreak
                ? fmtTimer(breakElapsed)
                : activeShiftCheckin
                  ? fmtTimer(elapsed)
                  : todayShift ? 'Tap Check In' : 'No shift today'}
            </div>
          </div>
          <div className="ci-action-btns">
            {!activeShiftCheckin ? (
              <button className="ci-act-btn ci-act-checkin" onClick={handleCheckIn} disabled={acting || !canCheckInShift}>
                {checkinBtnLabel}
              </button>
            ) : (
              <>
                <button className="ci-act-btn ci-act-break" onClick={() => handleBreak(activeBreak ? 'short' : 'lunch')} disabled={acting}>
                  {activeBreak ? 'End Break' : 'Break'}
                </button>
                <button className="ci-act-btn ci-act-checkout" onClick={handleCheckOut} disabled={acting}>
                  {acting ? '...' : 'Check Out'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="ci-body">
        <div className="ci-card">
          <div className="ci-card-title">Today's Time</div>
          <div className="ci-today-row">
            <div className="ci-today-loc">{locationName}</div>
          </div>
          {todayRecords.length === 0 && !activeShiftCheckin && (
            <div className="ci-today-row">
              <div className="ci-today-status"><span className="ci-today-dot out" /> No check-ins today</div>
            </div>
          )}
          {activeShiftCheckin && (
            <div className="ci-today-row">
              <div className="ci-today-status">
                <span className="ci-today-dot in" />
                {activeBreak ? 'On Break' : 'Checked In'}
              </div>
              <div className="ci-today-time">{fmtTime(activeShiftCheckin.check_in_at)}</div>
            </div>
          )}
          {todayRecords.filter(r => r.status === 'checked_out' || r.status === 'auto_closed').map(r => (
            <div key={r.id} className="ci-today-row">
              <div className="ci-today-status"><span className="ci-today-dot out" /> Checked Out</div>
              <div className="ci-today-time">{fmtTime(r.check_in_at)} — {r.check_out_at ? fmtTime(r.check_out_at) : '—'}</div>
            </div>
          ))}
        </div>

        <div className="ci-card">
          <div className="ci-card-title">This Month</div>
          <div className="ci-month-stats">
            <div className="ci-month-stat">
              <div className="ci-month-val">{history.filter(r => r.status !== 'cancelled').length}</div>
              <div className="ci-month-label">Shifts</div>
            </div>
            <div className="ci-month-stat">
              <div className="ci-month-val">{monthHours.toFixed(1)}</div>
              <div className="ci-month-label">Hours</div>
            </div>
            <div className="ci-month-stat">
              <div className="ci-month-val">{totalBreakSecs > 0 ? fmtTimer(Math.floor(totalBreakSecs)) : '0'}</div>
              <div className="ci-month-label">Break</div>
            </div>
          </div>
        </div>

        {!loading && history.filter(r => r.status !== 'cancelled').length > 0 && (
          <div className="ci-history">
            <div className="ci-history-title">Recent Check-ins</div>
            {history.filter(r => r.status !== 'cancelled').slice(0, 10).map(r => {
              const dur = r.check_out_at
                ? `${((new Date(r.check_out_at).getTime() - new Date(r.check_in_at).getTime()) / 3600000).toFixed(1)}h`
                : r.status === 'checked_in' ? 'Active' : '—'
              return (
                <div key={r.id} className="ci-history-row">
                  <span className="ci-history-date">{fmtDate(r.check_in_at)}</span>
                  <span className="ci-history-times">
                    {fmtTime(r.check_in_at)} → {r.check_out_at ? fmtTime(r.check_out_at) : '—'}
                  </span>
                  <span className={`ci-history-badge ${r.work_from_home ? 'ci-badge-home' : 'ci-badge-site'}`}>
                    {r.loc_name}
                  </span>
                  <span className="ci-history-dur">{dur}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
