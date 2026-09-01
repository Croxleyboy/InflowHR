import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useCheckIn } from '../context/CheckInContext'
import { useToast } from '../context/ToastContext'

interface HistoryRow {
  id: string; check_in_at: string; check_out_at: string | null; status: string
  work_from_home: boolean; loc_name: string
}
interface BreakRow { id: string; break_start: string; break_end: string | null; break_type: string }

export default function TimesheetCheckIn() {
  const navigate = useNavigate()
  const { companyUser, employeeId } = useAuth()
  const companyId = companyUser?.company_id || ''
  const { activeCheckin, activeBreak, checkIn, checkOut, startBreak, endBreak, settings, workLocations } = useCheckIn()
  const { showSuccess, showError } = useToast()

  const [elapsed, setElapsed] = useState(0)
  const [breakElapsed, setBreakElapsed] = useState(0)
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [breaks, setBreaks] = useState<BreakRow[]>([])
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadHistory = useCallback(async () => {
    if (!employeeId || !companyId) return
    setLoading(true)
    const monthStart = new Date()
    monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0)

    const { data: locs } = await supabase.from('work_locations').select('id, name').eq('company_id', companyId)
    const locMap: Record<string, string> = {}
    locs?.forEach((l: { id: string; name: string }) => { locMap[l.id] = l.name })

    const { data } = await supabase.from('checkin_records').select('*')
      .eq('employee_id', employeeId).eq('source', 'timesheets')
      .gte('check_in_at', monthStart.toISOString())
      .order('check_in_at', { ascending: false })

    if (data) setHistory(data.map((r: { id: string; check_in_at: string; check_out_at: string | null; status: string; work_from_home: boolean; check_in_location_id: string | null }) => ({
      ...r, loc_name: r.work_from_home ? 'Home' : (r.check_in_location_id ? locMap[r.check_in_location_id] || 'On-site' : 'On-site'),
    })))

    if (activeCheckin) {
      const { data: brks } = await supabase.from('break_records').select('*')
        .eq('checkin_record_id', activeCheckin.id).order('break_start', { ascending: false })
      if (brks) setBreaks(brks)
    }
    setLoading(false)
  }, [employeeId, companyId, activeCheckin])

  useEffect(() => { loadHistory() }, [loadHistory])

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (activeCheckin) {
      const tick = () => {
        setElapsed(Math.floor((Date.now() - new Date(activeCheckin.check_in_at).getTime()) / 1000))
        if (activeBreak) {
          setBreakElapsed(Math.floor((Date.now() - new Date(activeBreak.break_start).getTime()) / 1000))
        }
      }
      tick()
      timerRef.current = setInterval(tick, 1000)
    } else {
      setElapsed(0); setBreakElapsed(0)
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [activeCheckin, activeBreak])

  function fmtTimer(secs: number) {
    const h = Math.floor(secs / 3600)
    const m = Math.floor((secs % 3600) / 60)
    const s = secs % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  function fmtTime(iso: string) { return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) }
  function fmtDate(iso: string) { return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) }

  async function handleCheckIn() {
    setActing(true)
    const result = await checkIn('timesheets')
    if (result.ok) {
      showSuccess(result.wfh ? 'Checked in from home' : 'Checked in successfully')
      loadHistory()
    } else {
      showError(result.error || 'Check-in failed')
    }
    setActing(false)
  }

  async function handleCheckOut() {
    setActing(true)
    const result = await checkOut()
    if (result.ok) { showSuccess('Checked out'); loadHistory() }
    else showError(result.error || 'Check-out failed')
    setActing(false)
  }

  async function handleBreak(type: 'lunch' | 'short' | 'other') {
    setActing(true)
    if (activeBreak) {
      const r = await endBreak()
      if (r.ok) { showSuccess('Break ended'); loadHistory() } else showError(r.error || 'Failed')
    } else {
      const r = await startBreak(type)
      if (r.ok) { showSuccess('Break started') } else { showError(r.error || 'Failed') }
    }
    setActing(false)
  }

  const completedToday = history.filter(r => r.status === 'checked_out' || r.status === 'auto_closed')
  const monthHours = completedToday.reduce((sum, r) => {
    if (!r.check_out_at) return sum
    return sum + (new Date(r.check_out_at).getTime() - new Date(r.check_in_at).getTime()) / 3600000
  }, 0)

  const totalBreakSecs = breaks.reduce((sum, b) => {
    const end = b.break_end ? new Date(b.break_end).getTime() : Date.now()
    return sum + (end - new Date(b.break_start).getTime()) / 1000
  }, 0)

  const mapLat = activeCheckin?.check_in_lat
    ?? (workLocations.length > 0 ? workLocations[0].latitude : 51.5074)
  const mapLng = activeCheckin?.check_in_lng
    ?? (workLocations.length > 0 ? workLocations[0].longitude : -0.1278)

  const zoom = 16
  const n = Math.pow(2, zoom)
  const tileX = Math.floor((mapLng + 180) / 360 * n)
  const latRad = mapLat * Math.PI / 180
  const tileY = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n)
  const tileGrid: string[][] = []
  for (let dy = -1; dy <= 1; dy++) {
    const row: string[] = []
    for (let dx = -1; dx <= 2; dx++) {
      row.push(`https://tile.openstreetmap.org/${zoom}/${tileX + dx}/${tileY + dy}.png`)
    }
    tileGrid.push(row)
  }
  const pixelX = ((mapLng + 180) / 360 * n - tileX) * 256
  const pixelY = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n - tileY) * 256
  const markerLeft = 256 + pixelX
  const markerTop = 256 + pixelY

  const checkedInLoc = activeCheckin
    ? workLocations.find(l => l.id === activeCheckin.check_in_location_id)
    : null
  const locationName = activeCheckin
    ? activeCheckin.work_from_home ? 'Home' : (checkedInLoc?.name || 'On-site')
    : workLocations.length > 0 ? workLocations[0].name : '—'

  const todayRecords = history.filter(r => {
    const d = new Date(r.check_in_at)
    const now = new Date()
    return d.toDateString() === now.toDateString()
  })

  if (!settings?.timesheets_checkin_enabled) {
    return (
      <div className="page-container">
        <div className="page-card" style={{ textAlign: 'center', padding: 40 }}>
          <p style={{ color: '#999' }}>Check-in is not enabled for timesheets. Please contact your admin.</p>
          <button className="btn-secondary" onClick={() => navigate('/timesheets')} style={{ marginTop: 12 }}>Back to Timesheets</button>
        </div>
      </div>
    )
  }

  return (
    <div className="ci-page">
      <style>{`
        .ci-page { padding: 0 0 100px; background: var(--bg, #f5f5f5); min-height: 100vh; }

        .ci-header { background: linear-gradient(135deg, #1565c0, #1e88e5); color: #fff; padding: 12px 16px; display: flex; align-items: center; gap: 12px; }
        .ci-header-back { background: none; border: none; cursor: pointer; padding: 0; display: flex; }
        .ci-header-center { flex: 1; }
        .ci-header-title { font-size: 18px; font-weight: 800; margin: 0; color: #fff; }
        .ci-header-title span { font-style: italic; color: #90caf9; }
        .ci-header-sub { font-size: 11px; color: rgba(255,255,255,0.7); margin-top: 1px; }
        .ci-header-refresh { background: none; border: none; cursor: pointer; padding: 0; display: flex; }

        .ci-map-wrap { width: 100%; height: 180px; overflow: hidden; position: relative; }
        .ci-map-tiles { display: grid; grid-template-columns: repeat(4, 256px); position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); }
        .ci-map-tiles img { width: 256px; height: 256px; display: block; }
        .ci-map-pin { position: absolute; transform: translate(-50%, -100%); z-index: 2; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3)); }

        .ci-hero { padding: 12px 16px 0; }
        .ci-time-row { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 6px; }
        .ci-time-big { font-size: 32px; font-weight: 700; color: var(--text); font-variant-numeric: tabular-nums; line-height: 1; }
        .ci-time-date { font-size: 12px; color: var(--text-muted); font-weight: 500; }

        .ci-status-actions { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--border, #eee); margin-bottom: 10px; }
        .ci-status-icon { width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .ci-status-icon.active { background: #dcfce7; color: #16a34a; }
        .ci-status-icon.inactive { background: var(--bg-card, #eee); color: var(--text-muted); }
        .ci-status-icon.on-break { background: #fef3c7; color: #d97706; }
        .ci-status-info { flex: 1; min-width: 0; }
        .ci-status-text { font-size: 13px; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .ci-status-sub { font-size: 11px; color: var(--text-muted); }
        .ci-action-btns { display: flex; gap: 6px; flex-shrink: 0; }
        .ci-act-btn { padding: 8px 16px; border-radius: 8px; font-size: 13px; font-weight: 700; border: none; cursor: pointer; font-family: inherit; white-space: nowrap; }
        .ci-act-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .ci-act-checkin { background: #16a34a; color: #fff; }
        .ci-act-checkin:hover:not(:disabled) { background: #15803d; }
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
        .ci-today-dot.in { background: #16a34a; }
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
        .ci-badge-site { background: #ecfdf5; color: #16a34a; }

        [data-theme="dark"] .ci-badge-home { background: #1e3a5f; color: #60a5fa; }
        [data-theme="dark"] .ci-badge-site { background: #14532d; color: #4ade80; }
        [data-theme="dark"] .ci-act-checkin { background: #15803d; }
        [data-theme="dark"] .ci-act-checkin:hover:not(:disabled) { background: #166534; }
        [data-theme="dark"] .ci-act-break { background: #b45309; }
        [data-theme="dark"] .ci-act-break:hover:not(:disabled) { background: #92400e; }
        [data-theme="dark"] .ci-act-checkout { background: #b91c1c; }
        [data-theme="dark"] .ci-act-checkout:hover:not(:disabled) { background: #991b1b; }
        [data-theme="dark"] .ci-status-icon.active { background: #14532d; color: #4ade80; }
        [data-theme="dark"] .ci-status-icon.on-break { background: #451a03; color: #fbbf24; }
        @media (prefers-color-scheme: dark) {
          :root:not([data-theme="light"]) .ci-badge-home { background: #1e3a5f; color: #60a5fa; }
          :root:not([data-theme="light"]) .ci-badge-site { background: #14532d; color: #4ade80; }
          :root:not([data-theme="light"]) .ci-act-checkin { background: #15803d; }
          :root:not([data-theme="light"]) .ci-act-checkin:hover:not(:disabled) { background: #166534; }
          :root:not([data-theme="light"]) .ci-act-break { background: #b45309; }
          :root:not([data-theme="light"]) .ci-act-break:hover:not(:disabled) { background: #92400e; }
          :root:not([data-theme="light"]) .ci-act-checkout { background: #b91c1c; }
          :root:not([data-theme="light"]) .ci-act-checkout:hover:not(:disabled) { background: #991b1b; }
          :root:not([data-theme="light"]) .ci-status-icon.active { background: #14532d; color: #4ade80; }
          :root:not([data-theme="light"]) .ci-status-icon.on-break { background: #451a03; color: #fbbf24; }
        }
      `}</style>

      <header className="ci-header">
        <button className="ci-header-back" onClick={() => navigate('/timesheets')}>
          <svg width="28" height="28" viewBox="0 0 36 36" fill="none">
            <circle cx="18" cy="18" r="17" stroke="#fff" strokeWidth="2" />
            <path d="M21 12l-6 6 6 6" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="ci-header-center">
          <h1 className="ci-header-title">Check <span>In/Out</span></h1>
          <p className="ci-header-sub">Timesheet attendance</p>
        </div>
        <button className="ci-header-refresh" onClick={loadHistory}>
          <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="14" stroke="#fff" strokeWidth="2" />
            <path d="M22 14a6.5 6.5 0 0 0-11.3-1.5M10 18a6.5 6.5 0 0 0 11.3 1.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
            <path d="M22 10v4h-4M10 22v-4h4" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </header>

      {/* Map — OpenStreetMap tiles, no dependencies */}
      <div className="ci-map-wrap">
        <div className="ci-map-tiles" style={{ marginLeft: -(markerLeft - window.innerWidth / 2), marginTop: -(markerTop - 90) }}>
          {tileGrid.map((row, ri) => row.map((url, ci) => (
            <img key={`${ri}-${ci}`} src={url} alt="" style={{ gridRow: ri + 1, gridColumn: ci + 1 }} />
          )))}
        </div>
        <svg className="ci-map-pin" style={{ left: '50%', top: 90 }} width="28" height="40" viewBox="0 0 28 40">
          <path d="M14 0C6.3 0 0 6.3 0 14c0 10.5 14 26 14 26s14-15.5 14-26C28 6.3 21.7 0 14 0z" fill="#1565c0"/>
          <circle cx="14" cy="14" r="6" fill="#fff"/>
        </svg>
      </div>

      {/* Time + Status + Action buttons — all visible without scrolling */}
      <div className="ci-hero">
        <div className="ci-time-row">
          <div className="ci-time-big">
            {new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
          </div>
          <div className="ci-time-date">
            {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
          </div>
        </div>

        <div className="ci-status-actions">
          <div className={`ci-status-icon ${activeBreak ? 'on-break' : activeCheckin ? 'active' : 'inactive'}`}>
            {activeBreak ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
            ) : activeCheckin ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/></svg>
            )}
          </div>
          <div className="ci-status-info">
            <div className="ci-status-text">
              {activeBreak
                ? `On break since ${fmtTime(activeBreak.break_start)}`
                : activeCheckin
                  ? `Checked in at ${fmtTime(activeCheckin.check_in_at)}`
                  : 'Not checked in'}
            </div>
            <div className="ci-status-sub">
              {activeBreak
                ? `Break: ${fmtTimer(breakElapsed)}`
                : activeCheckin
                  ? `Worked: ${fmtTimer(elapsed)}`
                  : 'Tap Check In to start'}
            </div>
          </div>
          <div className="ci-action-btns">
            {!activeCheckin ? (
              <button className="ci-act-btn ci-act-checkin" onClick={handleCheckIn} disabled={acting}>
                {acting ? '...' : 'Check In'}
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
        {/* Today's Time card */}
        <div className="ci-card">
          <div className="ci-card-title">Today's Time</div>
          <div className="ci-today-row">
            <div className="ci-today-loc">{locationName}</div>
          </div>
          {todayRecords.length === 0 && !activeCheckin && (
            <div className="ci-today-row">
              <div className="ci-today-status"><span className="ci-today-dot out" /> No check-ins today</div>
            </div>
          )}
          {activeCheckin && (
            <div className="ci-today-row">
              <div className="ci-today-status">
                <span className="ci-today-dot in" />
                {activeBreak ? 'On Break' : 'Checked In'}
              </div>
              <div className="ci-today-time">{fmtTime(activeCheckin.check_in_at)}</div>
            </div>
          )}
          {todayRecords.filter(r => r.status === 'checked_out' || r.status === 'auto_closed').map(r => (
            <div key={r.id} className="ci-today-row">
              <div className="ci-today-status"><span className="ci-today-dot out" /> Checked Out</div>
              <div className="ci-today-time">{fmtTime(r.check_in_at)} — {r.check_out_at ? fmtTime(r.check_out_at) : '—'}</div>
            </div>
          ))}
        </div>

        {/* Monthly summary */}
        <div className="ci-card">
          <div className="ci-card-title">This Month</div>
          <div className="ci-month-stats">
            <div className="ci-month-stat">
              <div className="ci-month-val">{history.filter(r => r.status !== 'cancelled').length}</div>
              <div className="ci-month-label">Days</div>
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

        {/* History */}
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
