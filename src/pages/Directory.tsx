import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'
import { useFeatures } from '../context/FeatureContext'
import { toLocalDateStr } from '../lib/formatters'

interface DirectoryEntry {
  id: number
  firstname: string
  surname: string
  display_name: string
  job_title: string
  user_email: string
  telephone: string | null
  department: string | null
  avatar_url: string | null
  employee_uuid: string | null
}

interface ActiveCheckin {
  check_in_at: string
  work_from_home: boolean
}

interface TeamCheckinRow {
  employee_id: string
  name: string
  todayCheckin: { check_in_at: string; work_from_home: boolean } | null
  yesterday: { check_in_at: string; check_out_at: string | null } | null
}

const WATCHLIST_KEY = 'inflowhr-kudos-watchlist'
const COLLEAGUES_ONLY_KEY = 'inflowhr-kudos-colleagues-only'

function getWatchlist(): string[] {
  try {
    return JSON.parse(localStorage.getItem(WATCHLIST_KEY) || '[]')
  } catch { return [] }
}

export default function Directory() {
  const navigate = useNavigate()
  const { t } = useLanguage()
  const { companyUser, employeeId: currentEmployeeId, isManager, session } = useAuth()
  const { features } = useFeatures()
  const [entries, setEntries] = useState<DirectoryEntry[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<DirectoryEntry | null>(null)
  const [onLeaveIds, setOnLeaveIds] = useState<Set<string>>(new Set())
  const [watchlist, setWatchlist] = useState<string[]>(getWatchlist)
  const [showWatchlistPrompt, setShowWatchlistPrompt] = useState(false)
  const [selectedSkills, setSelectedSkills] = useState<{ name: string; proficiency: number }[]>([])
  const [selectedLangs, setSelectedLangs] = useState<{ language: string; proficiency: string }[]>([])
  const [selectedCheckin, setSelectedCheckin] = useState<ActiveCheckin | null>(null)
  const [showTeamCheckins, setShowTeamCheckins] = useState(false)
  const [teamCheckins, setTeamCheckins] = useState<TeamCheckinRow[]>([])
  const [teamCheckinsLoading, setTeamCheckinsLoading] = useState(false)
  const [presenceMap, setPresenceMap] = useState<Record<string, string>>({})
  const [teamsEnabled, setTeamsEnabled] = useState(false)
  const presenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchData = useCallback(async () => {
    if (!companyUser?.company_id) return
    setLoading(true)

    const today = toLocalDateStr()

    const [dirRes, leaveRes, empRes] = await Promise.all([
      supabase
        .from('onboarding')
        .select('id, firstname, surname, display_name, job_title, user_email, telephone, department, avatar_url')
        .eq('company_id', companyUser.company_id)
        .eq('appstatus', 'active')
        .order('firstname'),
      supabase
        .from('leave_requests')
        .select('employee_id')
        .eq('company_id', companyUser.company_id)
        .eq('status', 'approved')
        .lte('start_date', today)
        .gte('end_date', today),
      supabase
        .from('employees')
        .select('id, email')
        .eq('company_id', companyUser.company_id)
        .eq('is_active', true),
    ])

    const emailToEmpId = new Map<string, string>()
    ;(empRes.data || []).forEach((e: any) => emailToEmpId.set(e.email?.toLowerCase(), e.id))

    const validEmpIds = new Set(emailToEmpId.values())

    const entriesWithUuid = ((dirRes.data || []) as any[]).map(d => ({
      ...d,
      employee_uuid: emailToEmpId.get(d.user_email?.toLowerCase()) || null,
    })) as DirectoryEntry[]
    setEntries(entriesWithUuid)

    const stored = getWatchlist()
    const cleaned = stored.filter(id => validEmpIds.has(id) && id !== currentEmployeeId)
    if (cleaned.length !== stored.length) {
      setWatchlist(cleaned)
      localStorage.setItem(WATCHLIST_KEY, JSON.stringify(cleaned))
    }

    const leaveSet = new Set<string>()
    ;(leaveRes.data || []).forEach((r: any) => leaveSet.add(r.employee_id))
    setOnLeaveIds(leaveSet)

    setLoading(false)
  }, [companyUser?.company_id])

  useEffect(() => { fetchData() }, [fetchData])

  useEffect(() => {
    if (!companyUser?.company_id || !features.teams_integration) return
    supabase
      .from('company_teams_config')
      .select('is_enabled, consent_granted')
      .eq('company_id', companyUser.company_id)
      .maybeSingle()
      .then(({ data }) => {
        setTeamsEnabled(!!data?.is_enabled && !!data?.consent_granted)
      })
  }, [companyUser?.company_id, features.teams_integration])

  const fetchPresence = useCallback(async () => {
    if (!teamsEnabled || entries.length === 0 || !session?.provider_token) return
    const token = session.provider_token
    const jwtPayload = session.access_token
    const emails = entries.map(e => e.user_email).filter(Boolean)
    if (emails.length === 0) return

    try {
      const resolvedIds: Record<string, string> = {}
      const idToEmail: Record<string, string> = {}

      for (const email of emails) {
        const { data } = await supabase.functions.invoke('teams-proxy', {
          body: { endpoint: `/users/${encodeURIComponent(email)}`, provider_token: token },
        })
        if (data?.id) {
          resolvedIds[email] = data.id
          idToEmail[data.id] = email
        }
      }

      const userIds = Object.values(resolvedIds)
      if (userIds.length === 0) return

      const { data: batchResult } = await supabase.functions.invoke('teams-proxy', {
        body: {
          endpoint: '/communications/getPresencesByUserId',
          method: 'POST',
          body: { ids: userIds },
          provider_token: token,
        },
      })

      const map: Record<string, string> = {}
      for (const p of batchResult?.value || []) {
        const email = idToEmail[p.id]
        if (email) map[email] = p.availability || 'PresenceUnknown'
      }
      setPresenceMap(map)
    } catch {
      // presence fetch failed — not blocking
    }
  }, [teamsEnabled, entries, session?.provider_token])

  useEffect(() => {
    if (!teamsEnabled) return
    fetchPresence()
    presenceTimerRef.current = setInterval(fetchPresence, 60000)
    return () => {
      if (presenceTimerRef.current) clearInterval(presenceTimerRef.current)
    }
  }, [teamsEnabled, fetchPresence])

  function getPresenceColor(availability: string): string {
    switch (availability) {
      case 'Available': return '#43a047'
      case 'Busy': case 'DoNotDisturb': case 'BusyIdle': return '#e53935'
      case 'Away': case 'BeRightBack': return '#fb8c00'
      case 'Offline': return '#9e9e9e'
      default: return '#bdbdbd'
    }
  }

  async function openProfile(entry: DirectoryEntry) {
    setSelected(entry)
    setSelectedSkills([])
    setSelectedLangs([])
    setSelectedCheckin(null)

    if (entry.employee_uuid && companyUser?.company_id) {
      supabase
        .from('checkin_records')
        .select('check_in_at, work_from_home')
        .eq('employee_id', entry.employee_uuid)
        .eq('company_id', companyUser.company_id)
        .eq('status', 'checked_in')
        .order('check_in_at', { ascending: false })
        .limit(1)
        .then(({ data }) => {
          if (data && data[0]) setSelectedCheckin(data[0])
        })
    }

    if (!features.skills_passport || !entry.employee_uuid) return
    const [esRes, langRes] = await Promise.all([
      supabase.from('employee_skills').select('skill_id, proficiency').eq('employee_id', entry.employee_uuid).eq('status', 'validated'),
      supabase.from('employee_languages').select('language, proficiency').eq('employee_id', entry.employee_uuid),
    ])
    const esData = esRes.data
    if (esData && esData.length > 0) {
      const skillIds = esData.map(s => s.skill_id)
      const { data: skillData } = await supabase.from('skills').select('id, name').in('id', skillIds)
      const nameMap = new Map((skillData || []).map(s => [s.id, s.name]))
      setSelectedSkills(esData.map(s => ({ name: nameMap.get(s.skill_id) || 'Unknown', proficiency: s.proficiency })).sort((a, b) => b.proficiency - a.proficiency))
    }
    setSelectedLangs(langRes.data || [])
  }

  async function loadTeamCheckins() {
    setShowTeamCheckins(true)
    if (!currentEmployeeId || !companyUser?.company_id) return
    setTeamCheckinsLoading(true)

    const companyId = companyUser.company_id
    const today = new Date()
    const todayStr = toLocalDateStr(today)
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayStr = toLocalDateStr(yesterday)

    const { data: reports } = await supabase
      .from('employees')
      .select('id, first_name, last_name')
      .eq('company_id', companyId)
      .eq('manager_id', currentEmployeeId)
      .eq('is_active', true)

    if (!reports || reports.length === 0) {
      setTeamCheckins([])
      setTeamCheckinsLoading(false)
      return
    }

    const reportIds = reports.map((r: { id: string }) => r.id)
    const { data: records } = await supabase
      .from('checkin_records')
      .select('employee_id, check_in_at, check_out_at, status, work_from_home')
      .eq('company_id', companyId)
      .in('employee_id', reportIds)
      .gte('check_in_at', yesterdayStr + 'T00:00:00')
      .order('check_in_at', { ascending: false })

    const rows: TeamCheckinRow[] = reports.map((r: { id: string; first_name: string; last_name: string }) => {
      const empRecords = (records || []).filter((c: any) => c.employee_id === r.id)
      const todayRecord = empRecords.find((c: any) => c.check_in_at.startsWith(todayStr) && c.status === 'checked_in')
      const yesterdayRecord = empRecords.find((c: any) => c.check_in_at.startsWith(yesterdayStr))
      return {
        employee_id: r.id,
        name: `${r.first_name} ${r.last_name}`,
        todayCheckin: todayRecord ? { check_in_at: todayRecord.check_in_at, work_from_home: todayRecord.work_from_home } : null,
        yesterday: yesterdayRecord ? { check_in_at: yesterdayRecord.check_in_at, check_out_at: yesterdayRecord.check_out_at } : null,
      }
    })

    setTeamCheckins(rows)
    setTeamCheckinsLoading(false)
  }

  const filtered = search.trim()
    ? entries.filter(e => {
        const q = search.toLowerCase()
        const name = `${e.firstname} ${e.surname}`.toLowerCase()
        return name.includes(q) || (e.display_name || '').toLowerCase().includes(q)
      })
    : entries

  function getInitials(e: DirectoryEntry): string {
    return `${(e.firstname || '')[0] || ''}${(e.surname || '')[0] || ''}`
  }

  function isOnLeave(entry: DirectoryEntry): boolean {
    return onLeaveIds.has(String(entry.id))
  }

  function isOnWatchlist(entry: DirectoryEntry): boolean {
    if (!entry.employee_uuid) return false
    return watchlist.includes(entry.employee_uuid)
  }

  function toggleWatchlist(entry: DirectoryEntry) {
    const id = entry.employee_uuid
    if (!id) return
    let updated: string[]
    if (watchlist.includes(id)) {
      updated = watchlist.filter(w => w !== id)
    } else {
      updated = [...watchlist, id]
      const colleaguesOnly = localStorage.getItem(COLLEAGUES_ONLY_KEY) === 'true'
      if (!colleaguesOnly) {
        setShowWatchlistPrompt(true)
      }
    }
    setWatchlist(updated)
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(updated))
  }

  function enableColleaguesOnly() {
    localStorage.setItem(COLLEAGUES_ONLY_KEY, 'true')
    setShowWatchlistPrompt(false)
  }

  return (
    <div className="feature-page directory-page">
      <header className="directory-header">
        <button className="directory-back" onClick={() => navigate('/')}>
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
            <rect x="4" y="4" width="28" height="28" rx="6" stroke="#7b1fa2" strokeWidth="2" fill="none" />
            <rect x="10" y="10" width="16" height="16" rx="4" stroke="#7b1fa2" strokeWidth="1.5" fill="none" />
          </svg>
        </button>
        <div className="directory-header-center">
          <h1 className="directory-title">{t('directory.title')} <span className="directory-title-accent">{t('directory.title_accent')}</span></h1>
        </div>
        <button className="feature-refresh" onClick={fetchData}>
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="14" stroke="#1565c0" strokeWidth="2" />
            <path d="M22 14a6.5 6.5 0 0 0-11.3-1.5M10 18a6.5 6.5 0 0 0 11.3 1.5" stroke="#1565c0" strokeWidth="2" strokeLinecap="round" />
            <path d="M22 10v4h-4M10 22v-4h4" stroke="#1565c0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </header>

      <div className="directory-search-bar">
        <input
          className="directory-search-input"
          type="text"
          placeholder={t('directory.search_placeholder')}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <button className="directory-search-clear" onClick={() => setSearch('')}>
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <rect width="28" height="28" rx="6" fill="#e8a000" />
            <path d="M9 9l10 10M19 9l-10 10" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {isManager && (
        <div style={{ padding: '0 16px 12px' }}>
          <button
            onClick={loadTeamCheckins}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%',
              padding: '10px 14px', borderRadius: 10, border: '1px solid #7b1fa240',
              background: '#7b1fa210', color: '#7b1fa2', fontWeight: 600, fontSize: 14, cursor: 'pointer',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7b1fa2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
            </svg>
            Team Check-Ins
          </button>
        </div>
      )}

      {loading && <p className="claims-empty">{t('common.loading')}</p>}

      {!loading && filtered.length === 0 && (
        <p className="claims-empty">{t('directory.no_results')}</p>
      )}

      <div className="directory-list">
        {filtered.map(entry => (
          <div key={entry.id} className="directory-card">
            <div className="directory-card-top">
              <div className="directory-card-avatar-wrap">
                <button className="directory-card-avatar-btn" onClick={() => openProfile(entry)}>
                  {entry.avatar_url ? (
                    <img className="directory-card-avatar-img" src={entry.avatar_url} alt={`${entry.firstname} ${entry.surname}`} />
                  ) : (
                    <div className="directory-card-avatar">{getInitials(entry)}</div>
                  )}
                </button>
                {isOnLeave(entry) && (
                  <span className="directory-leave-badge">{t('directory.on_leave')}</span>
                )}
                {teamsEnabled && presenceMap[entry.user_email] && presenceMap[entry.user_email] !== 'PresenceUnknown' && (
                  <span
                    className="directory-presence-dot"
                    title={presenceMap[entry.user_email]}
                    style={{ background: getPresenceColor(presenceMap[entry.user_email]) }}
                  />
                )}
              </div>
              <div className="directory-card-info">
                <span className="directory-card-name">{entry.firstname} {entry.surname}</span>
                <span className="directory-card-email">{entry.user_email}</span>
              </div>
              {entry.employee_uuid !== currentEmployeeId && (
                <button
                  className={`directory-watchlist-btn ${isOnWatchlist(entry) ? 'directory-watchlist-active' : ''}`}
                  onClick={() => toggleWatchlist(entry)}
                  title={isOnWatchlist(entry) ? t('directory.remove_watchlist') : t('directory.add_watchlist')}
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill={isOnWatchlist(entry) ? '#e8a000' : 'none'} stroke="#e8a000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                </button>
              )}
              <a className="directory-card-phone" href={`tel:${entry.telephone || ''}`}>
                <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                  <circle cx="20" cy="20" r="19" fill="#1a1a2e" stroke="#1a1a2e" strokeWidth="2" />
                  <path d="M16.5 13.5c.3 1.5.8 3 1.5 4.3l-1.5 1.5a1 1 0 0 0-.1 1.2 14.5 14.5 0 0 0 3.6 3.6 1 1 0 0 0 1.2-.1l1.5-1.5c1.3.7 2.8 1.2 4.3 1.5a1 1 0 0 0 1-.8v-2.5a1 1 0 0 0-.8-1l-2.5-.5a1 1 0 0 0-1 .3l-.8.8a10.5 10.5 0 0 1-4-4l.8-.8a1 1 0 0 0 .3-1l-.5-2.5a1 1 0 0 0-1-.8h-2.5a1 1 0 0 0-.8 1z" fill="#fff" />
                </svg>
              </a>
            </div>
            <div className="directory-card-bottom">
              <span className="directory-card-tel">
                <strong>{t('directory.tel')}</strong> {entry.telephone || ''}
              </span>
              <span className="directory-card-dept">
                <strong>{t('directory.dept')}</strong> {entry.department || ''}
              </span>
            </div>
          </div>
        ))}
      </div>

      {selected && (
        <div className="directory-modal-overlay" onClick={() => setSelected(null)}>
          <div className="directory-modal" onClick={e => e.stopPropagation()}>
            <div className="directory-modal-top">
              <span className="directory-modal-title">{t('directory.contact_details')}</span>
              <button className="directory-modal-close-btn" onClick={() => setSelected(null)}>
                {t('directory.close')}
              </button>
            </div>

            <div className="directory-modal-profile">
              {selected.avatar_url ? (
                <img className="directory-modal-avatar-img" src={selected.avatar_url} alt={`${selected.firstname} ${selected.surname}`} />
              ) : (
                <div className="directory-modal-avatar">{getInitials(selected)}</div>
              )}
              <div className="directory-modal-name-wrap">
                <span className="directory-modal-name">{selected.firstname} {selected.surname}</span>
                <span className="directory-modal-role">{selected.job_title}</span>
                {isOnLeave(selected) && (
                  <span className="directory-leave-badge-modal">{t('directory.on_leave')}</span>
                )}
                {selectedCheckin && (
                  <span
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 4,
                      padding: '2px 8px', borderRadius: 12, fontSize: 12, fontWeight: 600,
                      background: '#e6f7ec', color: '#16a34a', border: '1px solid #16a34a40',
                    }}
                  >
                    📍 Checked in{selectedCheckin.work_from_home ? ' from home' : ''} · {new Date(selectedCheckin.check_in_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
            </div>

            <div className="directory-modal-details">
              <div className="directory-modal-detail-row">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="4" width="20" height="16" rx="2" />
                  <path d="M22 7l-10 7L2 7" />
                </svg>
                <span>{selected.user_email}</span>
              </div>
              <div className="directory-modal-detail-row">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.97.36 1.93.69 2.85a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.92.33 1.88.56 2.85.69a2 2 0 0 1 1.72 2.06z" />
                </svg>
                <span>{selected.telephone || ''}</span>
              </div>
              <div className="directory-modal-detail-row">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
                <span>{selected.department || ''}</span>
              </div>
            </div>

            {features.skills_passport && selectedSkills.length > 0 && (
              <div className="directory-modal-details" style={{ marginTop: 8 }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Validated Skills</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {selectedSkills.map((s, i) => (
                    <span key={i} style={{ padding: '2px 8px', borderRadius: 12, fontSize: 12, background: ['','#6b728020','#3b82f620','#8b5cf620','#f59e0b20','#10b98120'][s.proficiency], color: ['','#6b7280','#3b82f6','#8b5cf6','#f59e0b','#10b981'][s.proficiency], border: `1px solid ${['','#6b7280','#3b82f6','#8b5cf6','#f59e0b','#10b981'][s.proficiency]}40` }}>
                      {s.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {features.skills_passport && selectedLangs.length > 0 && (
              <div className="directory-modal-details" style={{ marginTop: 8 }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Languages</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {selectedLangs.map((l, i) => {
                    const c: Record<string, string> = { basic: '#6b7280', conversational: '#3b82f6', professional: '#8b5cf6', fluent: '#f59e0b', native: '#10b981' }
                    const lbl: Record<string, string> = { basic: 'Basic', conversational: 'Conversational', professional: 'Professional', fluent: 'Fluent', native: 'Native' }
                    return (
                      <span key={i} style={{ padding: '2px 8px', borderRadius: 12, fontSize: 12, background: (c[l.proficiency] || '#6b7280') + '20', color: c[l.proficiency] || '#6b7280', border: `1px solid ${c[l.proficiency] || '#6b7280'}40` }}>
                        {l.language} · {lbl[l.proficiency] || l.proficiency}
                      </span>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="directory-modal-actions">
              <a
                className="directory-modal-action-btn"
                href={`https://teams.microsoft.com/l/chat/0/0?users=${encodeURIComponent(selected.user_email)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                  <circle cx="20" cy="20" r="18" fill="#5b5fc7" />
                  <text x="20" y="16" textAnchor="middle" fill="#fff" fontSize="8" fontWeight="700" fontFamily="sans-serif">T</text>
                  <path d="M12 18h16v8a2 2 0 0 1-2 2H14a2 2 0 0 1-2-2v-8z" fill="#fff" opacity="0.3" />
                  <circle cx="20" cy="14" r="4" fill="#fff" opacity="0.6" />
                  <circle cx="27" cy="14" r="3" fill="#fff" opacity="0.4" />
                </svg>
              </a>
              <a
                className="directory-modal-action-btn"
                href={`mailto:${selected.user_email}`}
              >
                <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                  <circle cx="20" cy="20" r="18" fill="#0078d4" />
                  <text x="20" y="25" textAnchor="middle" fill="#fff" fontSize="16" fontWeight="800" fontFamily="sans-serif">O</text>
                </svg>
              </a>
            </div>
          </div>
        </div>
      )}

      {showTeamCheckins && (
        <div className="directory-modal-overlay" onClick={() => setShowTeamCheckins(false)}>
          <div className="directory-modal" onClick={e => e.stopPropagation()}>
            <div className="directory-modal-top">
              <span className="directory-modal-title">Team Check-Ins</span>
              <button className="directory-modal-close-btn" onClick={() => setShowTeamCheckins(false)}>
                {t('directory.close')}
              </button>
            </div>

            {teamCheckinsLoading && <p className="claims-empty">{t('common.loading')}</p>}

            {!teamCheckinsLoading && teamCheckins.length === 0 && (
              <p className="claims-empty">No direct reports found.</p>
            )}

            {!teamCheckinsLoading && teamCheckins.length > 0 && (
              <div className="directory-modal-details" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {teamCheckins.map(row => (
                  <div key={row.employee_id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border-color, #eee)' }}>
                    <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{row.name}</div>
                    <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                      Today: {row.todayCheckin
                        ? `Checked in at ${new Date(row.todayCheckin.check_in_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}${row.todayCheckin.work_from_home ? ' (Home)' : ''}`
                        : 'Not checked in'}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                      Yesterday: {row.yesterday
                        ? (() => {
                            const inT = new Date(row.yesterday.check_in_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
                            if (!row.yesterday.check_out_at) return `${inT} - (no checkout)`
                            const outT = new Date(row.yesterday.check_out_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
                            const durMins = Math.round((new Date(row.yesterday.check_out_at).getTime() - new Date(row.yesterday.check_in_at).getTime()) / 60000)
                            const hrs = Math.floor(durMins / 60)
                            const mins = durMins % 60
                            return `${inT} - ${outT}, ${hrs}h ${mins}m`
                          })()
                        : 'No record'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {showWatchlistPrompt && (
        <div className="directory-modal-overlay" onClick={() => setShowWatchlistPrompt(false)}>
          <div className="directory-watchlist-prompt" onClick={e => e.stopPropagation()}>
            <div className="directory-watchlist-prompt-icon">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="#e8a000" stroke="#e8a000" strokeWidth="1.5">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            </div>
            <p className="directory-watchlist-prompt-title">{t('directory.watchlist_prompt_title')}</p>
            <p className="directory-watchlist-prompt-text">{t('directory.watchlist_prompt_text')}</p>
            <div className="directory-watchlist-prompt-actions">
              <button className="directory-watchlist-prompt-yes" onClick={enableColleaguesOnly}>
                {t('directory.watchlist_enable')}
              </button>
              <button className="directory-watchlist-prompt-no" onClick={() => setShowWatchlistPrompt(false)}>
                {t('directory.watchlist_later')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
