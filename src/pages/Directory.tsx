import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'

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
  const { employeeId: EMPLOYEE_ID } = useAuth()
  const [entries, setEntries] = useState<DirectoryEntry[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<DirectoryEntry | null>(null)
  const [onLeaveIds, setOnLeaveIds] = useState<Set<string>>(new Set())
  const [watchlist, setWatchlist] = useState<string[]>(getWatchlist)
  const [showWatchlistPrompt, setShowWatchlistPrompt] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)

    const today = new Date().toISOString().split('T')[0]

    const [dirRes, leaveRes] = await Promise.all([
      supabase
        .from('onboarding')
        .select('id, firstname, surname, display_name, job_title, user_email, telephone, department, avatar_url')
        .eq('appstatus', 'active')
        .order('firstname'),
      supabase
        .from('leave_requests')
        .select('employee_id')
        .eq('status', 'approved')
        .lte('start_date', today)
        .gte('end_date', today),
    ])

    setEntries((dirRes.data || []) as DirectoryEntry[])

    const leaveSet = new Set<string>()
    ;(leaveRes.data || []).forEach((r: any) => leaveSet.add(r.employee_id))
    setOnLeaveIds(leaveSet)

    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

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

  function isOnWatchlist(entryId: number): boolean {
    return watchlist.includes(String(entryId))
  }

  function toggleWatchlist(entryId: number) {
    const id = String(entryId)
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

      {loading && <p className="claims-empty">{t('common.loading')}</p>}

      {!loading && filtered.length === 0 && (
        <p className="claims-empty">{t('directory.no_results')}</p>
      )}

      <div className="directory-list">
        {filtered.map(entry => (
          <div key={entry.id} className="directory-card">
            <div className="directory-card-top">
              <div className="directory-card-avatar-wrap">
                <button className="directory-card-avatar-btn" onClick={() => setSelected(entry)}>
                  {entry.avatar_url ? (
                    <img className="directory-card-avatar-img" src={entry.avatar_url} alt={`${entry.firstname} ${entry.surname}`} />
                  ) : (
                    <div className="directory-card-avatar">{getInitials(entry)}</div>
                  )}
                </button>
                {isOnLeave(entry) && (
                  <span className="directory-leave-badge">{t('directory.on_leave')}</span>
                )}
              </div>
              <div className="directory-card-info">
                <span className="directory-card-name">{entry.firstname} {entry.surname}</span>
                <span className="directory-card-email">{entry.user_email}</span>
              </div>
              <button
                className={`directory-watchlist-btn ${isOnWatchlist(entry.id) ? 'directory-watchlist-active' : ''}`}
                onClick={() => toggleWatchlist(entry.id)}
                title={isOnWatchlist(entry.id) ? t('directory.remove_watchlist') : t('directory.add_watchlist')}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill={isOnWatchlist(entry.id) ? '#e8a000' : 'none'} stroke="#e8a000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              </button>
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
