import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

// ── Types ──
interface LegalClient {
  id: string
  name: string
}

interface LegalMatter {
  id: string
  client_id: string
  name: string
  allowed_codes: string[] | null
}

interface TimerState {
  id: string
  clientId: string
  clientName: string
  matterId: string
  matterName: string
  taskCode: string
  elapsed: number
  running: boolean
  startedAt: number | null
}

interface TimesheetEntry {
  id: string
  date: string
  client_id: string
  clientName: string
  matter_id: string
  matterName: string
  taskCode: string
  taskLabel: string
  durationHrs: number
  narrative: string
  status: 'draft' | 'submitted' | 'approved' | 'rejected'
  createdAt: string
}

type DurationMode = 'manual' | 'startend' | 'timer'

// ── Constants ──
const BILLABLE_TARGET = 7.5
const MAX_DAILY_HRS = 10

const TASK_CODES = [
  { code: 'L110', label: 'Research' },
  { code: 'L120', label: 'Drafting' },
  { code: 'L130', label: 'Review / Analysis' },
  { code: 'L140', label: 'Communication' },
  { code: 'L150', label: 'Negotiation' },
  { code: 'L160', label: 'Counseling / Advice' },
  { code: 'L210', label: 'Pleadings' },
  { code: 'L220', label: 'Discovery' },
  { code: 'L230', label: 'Motions' },
  { code: 'L310', label: 'Court Appearances' },
  { code: 'L320', label: 'Depositions' },
  { code: 'L410', label: 'Case Management' },
  { code: 'L510', label: 'Document Management' },
  { code: 'A101', label: 'Plan / Strategy' },
  { code: 'A102', label: 'Conferencing' },
  { code: 'A104', label: 'Travel' },
]

const NARRATIVE_TEMPLATES = [
  'Drafted correspondence to',
  'Attendance on client regarding',
  'Reviewed and amended',
  'Telephone conference with',
  'Prepared for hearing re',
  'Reviewed file and considered',
  'Instructions received from client re',
  'Engaged in negotiations concerning',
]

const STATUS_COLORS: Record<string, string> = {
  draft: '#78909c',
  submitted: '#ff9800',
  approved: '#43a047',
  rejected: '#e53935',
}

function roundUp(hrs: number, incrementMins: number): number {
  if (incrementMins <= 1) return parseFloat(hrs.toFixed(2))
  const units = incrementMins / 60
  return Math.ceil(hrs / units) * units
}

function hrsToMins(hrs: number): number {
  return Math.round(hrs * 60)
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function elapsedToHrs(seconds: number, incrementMins: number): number {
  return parseFloat(roundUp(seconds / 3600, incrementMins).toFixed(2))
}

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]}`
}

function getWeekDates(): string[] {
  const now = new Date()
  const day = now.getDay()
  const diff = day === 0 ? -6 : 1 - day
  const mon = new Date(now)
  mon.setDate(now.getDate() + diff)
  const dates: string[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(mon)
    d.setDate(mon.getDate() + i)
    dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  }
  return dates
}

export default function LegalTimesheets() {
  const navigate = useNavigate()
  const { t, fyStartMonth } = useLanguage()
  const { employeeId, companyUser } = useAuth()
  const companyId = companyUser?.company_id

  // ── Rounding setting (from company config) ──
  const [roundingMins, setRoundingMins] = useState(6)

  // ── Supabase-backed state ──
  const [clients, setClients] = useState<LegalClient[]>([])
  const [matters, setMatters] = useState<LegalMatter[]>([])
  const [entries, setEntries] = useState<TimesheetEntry[]>([])
  const [loading, setLoading] = useState(true)

  // ── Timer state (persisted to localStorage) ──
  const TIMER_STORAGE_KEY = `lt-timers-${companyId}-${employeeId}`
  const [timers, setTimers] = useState<TimerState[]>(() => {
    try {
      const saved = localStorage.getItem(`lt-timers-${companyId}-${employeeId}`)
      if (saved) return JSON.parse(saved) as TimerState[]
    } catch { /* ignore */ }
    return []
  })
  const [showModal, setShowModal] = useState(false)
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null)
  const [, setTick] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Modal form state
  const [formClient, setFormClient] = useState('')
  const [formMatter, setFormMatter] = useState('')
  const [formTaskCode, setFormTaskCode] = useState('L110')
  const [formNarrative, setFormNarrative] = useState('')
  const [formDurationMode, setFormDurationMode] = useState<DurationMode>('manual')
  const [formManualHrs, setFormManualHrs] = useState('')
  const [formStartTime, setFormStartTime] = useState('09:00')
  const [formEndTime, setFormEndTime] = useState('09:30')
  const [formTimerId, setFormTimerId] = useState('')
  const [formAutoRound, setFormAutoRound] = useState(true)
  const [formDate, setFormDate] = useState(todayStr())
  const [clientSearch, setClientSearch] = useState('')
  const [matterSearch, setMatterSearch] = useState('')
  const [showTemplates, setShowTemplates] = useState(false)

  // ── Load clients, matters, entries from Supabase ──
  const loadData = useCallback(async () => {
    if (!companyId || !employeeId) return
    setLoading(true)

    const [clientsRes, mattersRes, entriesRes, companyRes] = await Promise.all([
      supabase
        .from('legal_clients')
        .select('id, name')
        .eq('company_id', companyId)
        .eq('status', 'active')
        .order('name'),
      supabase
        .from('legal_matters')
        .select('id, client_id, name, allowed_codes')
        .eq('company_id', companyId)
        .eq('status', 'active')
        .contains('assigned_employees', [employeeId])
        .order('name'),
      supabase
        .from('legal_timesheet_entries')
        .select('id, date, client_id, matter_id, task_code, duration_hrs, narrative, status, created_at')
        .eq('company_id', companyId)
        .eq('employee_id', employeeId)
        .order('created_at', { ascending: false }),
      supabase
        .from('companies')
        .select('legal_ts_rounding_minutes')
        .eq('id', companyId)
        .single(),
    ])

    if (companyRes.data?.legal_ts_rounding_minutes != null) {
      setRoundingMins(companyRes.data.legal_ts_rounding_minutes)
    }

    if (clientsRes.data) setClients(clientsRes.data)
    if (mattersRes.data) setMatters(mattersRes.data)

    if (entriesRes.data) {
      // Build lookup maps for client/matter names
      const clientMap: Record<string, string> = {}
      if (clientsRes.data) clientsRes.data.forEach(c => { clientMap[c.id] = c.name })
      const matterMap: Record<string, string> = {}
      if (mattersRes.data) mattersRes.data.forEach(m => { matterMap[m.id] = m.name })

      const mapped: TimesheetEntry[] = entriesRes.data.map(row => {
        const task = TASK_CODES.find(tc => tc.code === row.task_code)
        return {
          id: row.id,
          date: row.date,
          client_id: row.client_id,
          clientName: clientMap[row.client_id] || 'Unknown',
          matter_id: row.matter_id,
          matterName: matterMap[row.matter_id] || 'Unknown',
          taskCode: row.task_code || '',
          taskLabel: task?.label || '',
          durationHrs: Number(row.duration_hrs),
          narrative: row.narrative || '',
          status: row.status as TimesheetEntry['status'],
          createdAt: row.created_at,
        }
      })
      setEntries(mapped)
    }

    setLoading(false)
  }, [companyId, employeeId])

  useEffect(() => { loadData() }, [loadData])

  // Persist timers to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify(timers))
    } catch { /* ignore */ }
  }, [timers, TIMER_STORAGE_KEY])

  // Timer tick
  useEffect(() => {
    const hasRunning = timers.some(tmr => tmr.running)
    if (hasRunning && !timerRef.current) {
      timerRef.current = setInterval(() => setTick(n => n + 1), 1000)
    }
    if (!hasRunning && timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [timers])

  // ── Guard: if auth not ready, show loading ──
  if (!companyId || !employeeId) {
    return <div className="lt-page"><div className="lt-empty"><p>Loading...</p></div></div>
  }

  function getTimerElapsed(timer: TimerState): number {
    if (!timer.running || !timer.startedAt) return timer.elapsed
    return timer.elapsed + Math.floor((Date.now() - timer.startedAt) / 1000)
  }

  async function startTimer(clientId: string, matterId: string) {
    const client = clients.find(c => c.id === clientId)
    const matter = matters.find(m => m.id === matterId)
    if (!client || !matter) return

    setTimers(prev => {
      // Check for duplicate client+matter timer
      const duplicate = prev.find(tmr => tmr.clientId === clientId && tmr.matterId === matterId)
      if (duplicate) {
        // Resume the existing one, pause others
        return prev.map(tmr => {
          if (tmr.id === duplicate.id) {
            return { ...tmr, running: true, startedAt: Date.now() }
          }
          if (tmr.running) {
            return { ...tmr, running: false, elapsed: getTimerElapsed(tmr), startedAt: null }
          }
          return tmr
        })
      }

      // Pause all running timers, add new one
      const paused = prev.map(tmr => tmr.running
        ? { ...tmr, running: false, elapsed: getTimerElapsed(tmr), startedAt: null }
        : tmr
      )
      return [...paused, {
        id: `timer-${Date.now()}`,
        clientId,
        clientName: client.name,
        matterId,
        matterName: matter.name,
        taskCode: 'L110',
        elapsed: 0,
        running: true,
        startedAt: Date.now(),
      }]
    })
  }

  function toggleTimer(id: string) {
    setTimers(prev => prev.map(tmr => {
      if (tmr.id === id) {
        if (tmr.running) {
          // Pause this timer
          return { ...tmr, running: false, elapsed: getTimerElapsed(tmr), startedAt: null }
        }
        // Resume this timer
        return { ...tmr, running: true, startedAt: Date.now() }
      }
      // Auto-pause any other running timer
      if (tmr.running) {
        return { ...tmr, running: false, elapsed: getTimerElapsed(tmr), startedAt: null }
      }
      return tmr
    }))
  }

  function stopTimer(id: string) {
    setTimers(prev => prev.filter(tmr => tmr.id !== id))
  }

  async function logTimerAsEntry(timer: TimerState) {
    const elapsed = getTimerElapsed(timer)
    const hrs = formAutoRound ? roundUp(elapsed / 3600, roundingMins) : parseFloat((elapsed / 3600).toFixed(2))
    if (hrs <= 0) return
    const task = TASK_CODES.find(tc => tc.code === timer.taskCode)

    const { data, error } = await supabase
      .from('legal_timesheet_entries')
      .insert({
        company_id: companyId,
        employee_id: employeeId,
        date: formDate,
        client_id: timer.clientId,
        matter_id: timer.matterId,
        task_code: timer.taskCode,
        duration_hrs: hrs,
        narrative: '',
        status: 'draft',
      })
      .select('id, date, client_id, matter_id, task_code, duration_hrs, narrative, status, created_at')
      .single()

    if (!error && data) {
      const entry: TimesheetEntry = {
        id: data.id,
        date: data.date,
        client_id: data.client_id,
        clientName: timer.clientName,
        matter_id: data.matter_id,
        matterName: timer.matterName,
        taskCode: data.task_code || '',
        taskLabel: task?.label || '',
        durationHrs: Number(data.duration_hrs),
        narrative: data.narrative || '',
        status: data.status as TimesheetEntry['status'],
        createdAt: data.created_at,
      }
      setEntries(prev => [entry, ...prev])
    }
    stopTimer(timer.id)
  }

  // Computed
  const today = todayStr()
  const todayEntries = entries.filter(e => e.date === today)
  const todayLogged = todayEntries.reduce((s, e) => s + e.durationHrs, 0)
  const weekDates = getWeekDates()
  const weekLogged = entries
    .filter(e => weekDates.includes(e.date))
    .reduce((s, e) => s + e.durationHrs, 0)
  const progressPct = Math.min(100, (todayLogged / BILLABLE_TARGET) * 100)

  const fyStartDate = (() => {
    const now = new Date()
    const yr = now.getMonth() + 1 >= fyStartMonth ? now.getFullYear() : now.getFullYear() - 1
    const m = String(fyStartMonth).padStart(2, '0')
    return `${yr}-${m}-01`
  })()

  const groupedByDate = (() => {
    const map: Record<string, TimesheetEntry[]> = {}
    for (const e of entries) {
      if (!map[e.date]) map[e.date] = []
      map[e.date].push(e)
    }
    return Object.entries(map).sort(([a], [b]) => b.localeCompare(a))
  })()

  const recentMatters = (() => {
    const seen = new Set<string>()
    const recent: { clientId: string; clientName: string; matterId: string; matterName: string }[] = []
    for (const e of entries) {
      const key = `${e.client_id}|${e.matter_id}`
      if (seen.has(key)) continue
      seen.add(key)
      recent.push({ clientId: e.client_id, clientName: e.clientName, matterId: e.matter_id, matterName: e.matterName })
      if (recent.length >= 5) break
    }
    return recent
  })()

  // Matters filtered by selected client
  const mattersForClient = matters.filter(m => m.client_id === formClient)

  // Form helpers
  function getFormDuration(): number {
    if (formDurationMode === 'manual') {
      const v = parseFloat(formManualHrs)
      return isNaN(v) ? 0 : (formAutoRound ? roundUp(v, roundingMins) : v)
    }
    if (formDurationMode === 'startend') {
      const [sh, sm] = formStartTime.split(':').map(Number)
      const [eh, em] = formEndTime.split(':').map(Number)
      let mins = (eh * 60 + em) - (sh * 60 + sm)
      if (mins < 0) mins += 1440
      const hrs = mins / 60
      return formAutoRound ? roundUp(hrs, roundingMins) : parseFloat(hrs.toFixed(2))
    }
    if (formDurationMode === 'timer' && formTimerId) {
      const timer = timers.find(tmr => tmr.id === formTimerId)
      if (timer) {
        const secs = getTimerElapsed(timer)
        return formAutoRound ? roundUp(secs / 3600, roundingMins) : parseFloat((secs / 3600).toFixed(2))
      }
    }
    return 0
  }

  async function handleSubmitEntry() {
    const client = clients.find(c => c.id === formClient)
    const matter = mattersForClient.find(m => m.id === formMatter)
    if (!client || !matter) return

    const dur = getFormDuration()
    if (dur <= 0) return

    const task = TASK_CODES.find(tc => tc.code === formTaskCode)

    const { data, error } = await supabase
      .from('legal_timesheet_entries')
      .insert({
        company_id: companyId,
        employee_id: employeeId,
        date: formDate,
        client_id: formClient,
        matter_id: formMatter,
        task_code: formTaskCode,
        duration_hrs: dur,
        narrative: formNarrative,
        status: 'draft',
      })
      .select('id, date, client_id, matter_id, task_code, duration_hrs, narrative, status, created_at')
      .single()

    if (!error && data) {
      const entry: TimesheetEntry = {
        id: data.id,
        date: data.date,
        client_id: data.client_id,
        clientName: client.name,
        matter_id: data.matter_id,
        matterName: matter.name,
        taskCode: data.task_code || '',
        taskLabel: task?.label || '',
        durationHrs: Number(data.duration_hrs),
        narrative: data.narrative || '',
        status: data.status as TimesheetEntry['status'],
        createdAt: data.created_at,
      }
      setEntries(prev => [entry, ...prev])
    }

    if (formDurationMode === 'timer' && formTimerId) {
      stopTimer(formTimerId)
    }

    resetForm()
    setShowModal(false)
  }

  function resetForm() {
    setFormClient('')
    setFormMatter('')
    setFormTaskCode('L110')
    setFormNarrative('')
    setFormManualHrs('')
    setFormStartTime('09:00')
    setFormEndTime('09:30')
    setFormTimerId('')
    setFormDurationMode('manual')
    setFormDate(todayStr())
    setClientSearch('')
    setMatterSearch('')
    setShowTemplates(false)
  }

  async function deleteEntry(id: string) {
    await supabase.from('legal_timesheet_entries').delete().eq('id', id).eq('company_id', companyId)
    setEntries(prev => prev.filter(e => e.id !== id))
  }

  async function submitEntry(id: string) {
    const { error } = await supabase
      .from('legal_timesheet_entries')
      .update({ status: 'submitted', submitted_at: new Date().toISOString() })
      .eq('id', id)
      .eq('company_id', companyId)
    if (!error) {
      setEntries(prev => prev.map(e => e.id === id ? { ...e, status: 'submitted' } : e))
    }
  }

  const filteredClients = clients.filter(c =>
    !clientSearch || c.name.toLowerCase().includes(clientSearch.toLowerCase())
  )
  const filteredMatters = mattersForClient.filter(m =>
    !matterSearch || m.name.toLowerCase().includes(matterSearch.toLowerCase())
  )

  const formDuration = getFormDuration()
  const wouldExceedMax = (todayLogged + formDuration) > MAX_DAILY_HRS && formDuration > 0

  if (loading) {
    return <div className="lt-page"><div className="lt-empty"><p>Loading...</p></div></div>
  }

  return (
    <div className="lt-page">
      {/* Header */}
      <header className="lt-header">
        <button className="lt-back" onClick={() => navigate('/')}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <div className="lt-header-text">
          <h1>{t('legal_ts.title')}</h1>
          <p>{t('legal_ts.subtitle')}</p>
        </div>
        <button className="feature-refresh" onClick={loadData} style={{ marginLeft: 'auto' }}>
          <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="14" stroke="#fff" strokeWidth="2" />
            <path d="M22 14a6.5 6.5 0 0 0-11.3-1.5M10 18a6.5 6.5 0 0 0 11.3 1.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
            <path d="M22 10v4h-4M10 22v-4h4" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </header>

      {/* Summary Bar */}
      <div className="lt-summary">
        <div className="lt-summary-row">
          <div className="lt-summary-item">
            <span className="lt-summary-label">{t('legal_ts.today')}</span>
            <span className="lt-summary-value">{todayLogged.toFixed(1)}<span className="lt-summary-unit"> / {BILLABLE_TARGET}h</span></span>
          </div>
          <div className="lt-summary-item">
            <span className="lt-summary-label">{t('legal_ts.this_week')}</span>
            <span className="lt-summary-value">{weekLogged.toFixed(1)}<span className="lt-summary-unit">h</span></span>
          </div>
        </div>
        <div className="lt-progress-track">
          <div className="lt-progress-fill" style={{ width: `${progressPct}%` }} />
          {progressPct >= 100 && <div className="lt-progress-glow" />}
        </div>
        <div className="lt-progress-labels">
          <span>{progressPct.toFixed(0)}{t('legal_ts.daily_target')}</span>
          <span>{(BILLABLE_TARGET - todayLogged).toFixed(1)}h {t('legal_ts.remaining')}</span>
        </div>
      </div>

      {/* Active Timers Tray */}
      {timers.length > 0 && (
        <div className="lt-timer-tray">
          <div className="lt-timer-tray-header">
            <div className="lt-timer-tray-label">{t('legal_ts.active_timers')}</div>
            <button className="lt-timer-add-btn" onClick={() => { resetForm(); setFormDurationMode('timer'); setShowModal(true) }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            </button>
          </div>
          {timers.map(timer => {
            const elapsed = getTimerElapsed(timer)
            const hrs = elapsedToHrs(elapsed, roundingMins)
            return (
              <div key={timer.id} className={`lt-timer-card ${timer.running ? 'lt-timer-running' : ''}`}>
                <div className="lt-timer-info">
                  <span className="lt-timer-client">{timer.clientName}</span>
                  <span className="lt-timer-matter">{timer.matterName}</span>
                </div>
                <div className="lt-timer-display">
                  <span className="lt-timer-time">{formatElapsed(elapsed)}</span>
                  <span className="lt-timer-hrs">{hrs}h</span>
                </div>
                <div className="lt-timer-actions">
                  <button className="lt-timer-btn lt-timer-play" onClick={() => toggleTimer(timer.id)}>
                    {timer.running ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                    )}
                  </button>
                  <button className="lt-timer-btn lt-timer-log" onClick={() => logTimerAsEntry(timer)}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                  </button>
                  <button className="lt-timer-btn lt-timer-stop" onClick={() => stopTimer(timer.id)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Quick Actions */}
      <div className="lt-actions">
        <button className="lt-action-log" onClick={() => { resetForm(); setShowModal(true) }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          {t('legal_ts.log_time')}
        </button>
        <button className="lt-action-timer" onClick={() => {
          resetForm()
          setShowModal(true)
          setFormDurationMode('timer')
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2 2" /><path d="M5 3l2 2" /><path d="M19 3l-2 2" /><line x1="12" y1="1" x2="12" y2="3" /></svg>
          {t('legal_ts.start_timer')}
        </button>
      </div>

      {/* Entry Feed */}
      <div className="lt-feed">
        {groupedByDate.length === 0 ? (
          <div className="lt-empty">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="1.5"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
            <p>{t('legal_ts.no_entries')}</p>
            <span>{t('legal_ts.no_entries_hint')}</span>
          </div>
        ) : (
          groupedByDate.map(([date, dayEntries]) => {
            const dayTotal = dayEntries.reduce((s, e) => s + e.durationHrs, 0)
            const isToday = date === today
            return (
              <div key={date} className="lt-day-group">
                <div className={`lt-day-header ${isToday ? 'lt-day-today' : ''}`}>
                  <span className="lt-day-label">{isToday ? t('legal_ts.today') : formatDateLabel(date)}</span>
                  <span className="lt-day-total">{dayTotal.toFixed(1)}h</span>
                </div>
                {dayEntries.map(entry => {
                  const isExpanded = expandedEntry === entry.id
                  const mins = hrsToMins(entry.durationHrs)
                  return (
                    <div key={entry.id} className="lt-entry-card">
                      <div className="lt-entry-top" onClick={() => setExpandedEntry(isExpanded ? null : entry.id)}>
                        <div className="lt-entry-left">
                          <div className="lt-entry-client">{entry.clientName}</div>
                          <div className="lt-entry-matter">{entry.matterName}</div>
                          <div className="lt-entry-meta">
                            <span className="lt-entry-task-badge">{entry.taskCode} - {entry.taskLabel}</span>
                          </div>
                        </div>
                        <div className="lt-entry-right">
                          <div className="lt-entry-duration">{entry.durationHrs.toFixed(1)}h</div>
                          <div className="lt-entry-mins">{mins} mins</div>
                          <span className="lt-entry-status" style={{ background: STATUS_COLORS[entry.status] }}>{entry.status}</span>
                        </div>
                      </div>
                      {entry.narrative && !isExpanded && (
                        <div className="lt-entry-narrative-preview">{entry.narrative.slice(0, 80)}{entry.narrative.length > 80 ? '...' : ''}</div>
                      )}
                      {isExpanded && (
                        <div className="lt-entry-expanded">
                          {entry.narrative && <div className="lt-entry-narrative-full">{entry.narrative}</div>}
                          <div className="lt-entry-actions">
                            {entry.status === 'draft' && (
                              <>
                                <button className="lt-entry-submit-btn" onClick={e => { e.stopPropagation(); submitEntry(entry.id) }}>{t('legal_ts.submit')}</button>
                                <button className="lt-entry-delete-btn" onClick={e => { e.stopPropagation(); deleteEntry(entry.id) }}>{t('legal_ts.delete')}</button>
                              </>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })
        )}
      </div>

      {/* Log Time Modal */}
      {showModal && (
        <div className="lt-modal-overlay" onClick={() => setShowModal(false)}>
          <div className="lt-modal" onClick={e => e.stopPropagation()}>
            <div className="lt-modal-header">
              <h2>{t('legal_ts.log_time')}</h2>
              <button className="lt-modal-close" onClick={() => setShowModal(false)}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>

            <div className="lt-modal-body">
              {/* Recent Matters */}
              {recentMatters.length > 0 && (
                <div className="lt-recent">
                  <span className="lt-form-label">{t('legal_ts.recent_matters')}</span>
                  <div className="lt-recent-pills">
                    {recentMatters.map(rm => (
                      <button
                        key={`${rm.clientId}-${rm.matterId}`}
                        className={`lt-recent-pill ${formClient === rm.clientId && formMatter === rm.matterId ? 'lt-recent-active' : ''}`}
                        onClick={() => { setFormClient(rm.clientId); setFormMatter(rm.matterId) }}
                      >
                        {rm.clientName} - {rm.matterName}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Client */}
              <div className="lt-form-group">
                <label className="lt-form-label">{t('legal_ts.client')}</label>
                <div className="lt-form-inline">
                  <input
                    className="lt-form-search"
                    placeholder={t('legal_ts.search_clients')}
                    value={clientSearch}
                    onChange={e => setClientSearch(e.target.value)}
                  />
                  <select className="lt-form-select" value={formClient} onChange={e => { setFormClient(e.target.value); setFormMatter('') }}>
                    <option value="">{t('legal_ts.select_client')}</option>
                    {filteredClients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>

              {/* Matter */}
              {formClient && (
                <div className="lt-form-group">
                  <label className="lt-form-label">{t('legal_ts.matter')}</label>
                  <div className="lt-form-inline">
                    <input
                      className="lt-form-search"
                      placeholder={t('legal_ts.search_matters')}
                      value={matterSearch}
                      onChange={e => setMatterSearch(e.target.value)}
                    />
                    <select className="lt-form-select" value={formMatter} onChange={e => setFormMatter(e.target.value)}>
                      <option value="">{t('legal_ts.select_matter')}</option>
                      {filteredMatters.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </div>
                </div>
              )}

              {/* Duration Mode */}
              <div className="lt-form-group">
                <label className="lt-form-label">{t('legal_ts.duration')}</label>
                <div className="lt-duration-tabs">
                  <button className={`lt-dur-tab ${formDurationMode === 'manual' ? 'lt-dur-active' : ''}`} onClick={() => setFormDurationMode('manual')}>{t('legal_ts.manual')}</button>
                  <button className={`lt-dur-tab ${formDurationMode === 'startend' ? 'lt-dur-active' : ''}`} onClick={() => setFormDurationMode('startend')}>{t('legal_ts.start_end')}</button>
                  <button className={`lt-dur-tab ${formDurationMode === 'timer' ? 'lt-dur-active' : ''}`} onClick={() => setFormDurationMode('timer')}>{t('legal_ts.timer')}</button>
                </div>

                {formDurationMode === 'manual' && (
                  <div className="lt-dur-manual">
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      className="lt-form-input lt-dur-input"
                      placeholder="0.0"
                      value={formManualHrs}
                      onChange={e => setFormManualHrs(e.target.value)}
                    />
                    <span className="lt-dur-unit">hrs</span>
                  </div>
                )}

                {formDurationMode === 'startend' && (
                  <div className="lt-dur-startend">
                    <input type="time" className="lt-form-input" value={formStartTime} onChange={e => setFormStartTime(e.target.value)} />
                    <span className="lt-dur-sep">—</span>
                    <input type="time" className="lt-form-input" value={formEndTime} onChange={e => setFormEndTime(e.target.value)} />
                  </div>
                )}

                {formDurationMode === 'timer' && (
                  <div className="lt-dur-timer-pick">
                    {timers.length > 0 && (
                      <div className="lt-dur-timer-list">
                        {timers.map(timer => (
                          <button
                            key={timer.id}
                            className={`lt-dur-timer-opt ${formTimerId === timer.id ? 'lt-dur-timer-selected' : ''}`}
                            onClick={() => setFormTimerId(timer.id)}
                          >
                            <span>{timer.clientName} - {timer.matterName}</span>
                            <span className="lt-dur-timer-elapsed">{formatElapsed(getTimerElapsed(timer))} ({elapsedToHrs(getTimerElapsed(timer), roundingMins)}h)</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {timers.length === 0 && !formClient && (
                      <p className="lt-dur-no-timer">{t('legal_ts.no_active_timers')}</p>
                    )}
                    {formClient && formMatter && !timers.find(tmr => tmr.clientId === formClient && tmr.matterId === formMatter) && (
                      <button className="lt-start-timer-btn" onClick={() => {
                        startTimer(formClient, formMatter)
                        setShowModal(false)
                      }}>
                        {t('legal_ts.start_timer_now')}
                      </button>
                    )}
                  </div>
                )}

                {formDuration > 0 && (
                  <div className="lt-dur-preview">
                    <span>{formDuration.toFixed(1)} hrs / {hrsToMins(formDuration)} mins</span>
                    {formAutoRound && <span className="lt-dur-rounded">auto-rounded to nearest {roundingMins} mins</span>}
                  </div>
                )}

                <label className="lt-auto-round">
                  <input type="checkbox" checked={formAutoRound} onChange={e => setFormAutoRound(e.target.checked)} />
                  Auto-round to {roundingMins}-min increments ({(roundingMins / 60).toFixed(roundingMins % 6 === 0 ? 1 : 2)}h)
                </label>
              </div>

              {/* Task Code */}
              <div className="lt-form-group">
                <label className="lt-form-label">{t('legal_ts.activity_code')}</label>
                <select className="lt-form-select" value={formTaskCode} onChange={e => setFormTaskCode(e.target.value)}>
                  {TASK_CODES.map(tc => (
                    <option key={tc.code} value={tc.code}>{tc.code} - {tc.label}</option>
                  ))}
                </select>
              </div>

              {/* Date */}
              <div className="lt-form-group">
                <label className="lt-form-label">Date</label>
                <input
                  type="date"
                  className="lt-form-input"
                  value={formDate}
                  onChange={e => setFormDate(e.target.value)}
                  min={fyStartDate}
                  max={todayStr()}
                />
              </div>

              {/* Narrative */}
              <div className="lt-form-group">
                <div className="lt-form-label-row">
                  <label className="lt-form-label">{t('legal_ts.narrative')}</label>
                  <div className="lt-narrative-tools">
                    <button className="lt-template-toggle" onClick={() => setShowTemplates(!showTemplates)} title="Insert template">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                    </button>
                  </div>
                </div>
                {showTemplates && (
                  <div className="lt-templates">
                    {NARRATIVE_TEMPLATES.map(tpl => (
                      <button key={tpl} className="lt-template-chip" onClick={() => { setFormNarrative(prev => prev + (prev ? ' ' : '') + tpl); setShowTemplates(false) }}>
                        {tpl}
                      </button>
                    ))}
                  </div>
                )}
                <textarea
                  className="lt-form-textarea"
                  rows={3}
                  placeholder={t('legal_ts.narrative_placeholder')}
                  value={formNarrative}
                  onChange={e => setFormNarrative(e.target.value)}
                />
              </div>

              {/* Warning */}
              {wouldExceedMax && (
                <div className="lt-warning">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#e53935" strokeWidth="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                  <span>{t('legal_ts.overtime_warning')}</span>
                </div>
              )}
            </div>

            <div className="lt-modal-footer">
              <button className="lt-modal-cancel" onClick={() => setShowModal(false)}>{t('legal_ts.cancel')}</button>
              <button className="lt-modal-submit" onClick={handleSubmitEntry} disabled={!formClient || !formMatter || formDuration <= 0}>
                {t('legal_ts.log_entry')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
