import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../context/LanguageContext'

const EMPLOYEE_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

interface KudosEntry {
  id: number
  from_employee_id: string
  to_employee_id: string | null
  message: string
  category: string | null
  recognition_type: string | null
  badge: string | null
  quality: string | null
  is_broadcast: boolean
  is_public: boolean
  like_count: number
  liked_by: string[]
  created_at: string
  from_name?: string
  from_avatar?: string | null
  to_name?: string
}

interface Employee {
  id: string
  first_name: string
  last_name: string
  avatar_url: string | null
}

const RECOGNITION_TYPES = [
  { value: 'broadcast', key: 'kudos.type_broadcast', icon: '📢' },
  { value: 'awards', key: 'kudos.type_awards', icon: '🏆' },
  { value: 'events', key: 'kudos.type_events', icon: '🎉' },
  { value: 'welcome', key: 'kudos.type_welcome', icon: '👋' },
  { value: 'birthday', key: 'kudos.type_birthday', icon: '🎂' },
  { value: 'anniversary', key: 'kudos.type_anniversary', icon: '🎊' },
  { value: 'recognition', key: 'kudos.type_recognition', icon: '⭐' },
  { value: 'thank_you', key: 'kudos.type_thank_you', icon: '🙏' },
  { value: 'love', key: 'kudos.type_love', icon: '💖' },
]

const BADGES = [
  { value: 'great_idea', key: 'kudos.badge_great_idea', icon: '💡' },
  { value: 'above_and_beyond', key: 'kudos.badge_above_beyond', icon: '🚀' },
  { value: 'problem_solver', key: 'kudos.badge_problem_solver', icon: '🧩' },
  { value: 'customer_hero', key: 'kudos.badge_customer_hero', icon: '🦸' },
  { value: 'efficiency_expert', key: 'kudos.badge_efficiency', icon: '⚡' },
  { value: 'positive_energy', key: 'kudos.badge_positive_energy', icon: '☀️' },
  { value: 'mentor', key: 'kudos.badge_mentor', icon: '🎓' },
]

const QUALITIES = [
  { value: 'team_player', key: 'kudos.quality_team_player' },
  { value: 'problem_solver', key: 'kudos.quality_problem_solver' },
  { value: 'great_mentor', key: 'kudos.quality_great_mentor' },
  { value: 'visionary', key: 'kudos.quality_visionary' },
  { value: 'great_leader', key: 'kudos.quality_great_leader' },
  { value: 'superstar', key: 'kudos.quality_superstar' },
  { value: 'thanks_being_you', key: 'kudos.quality_thanks_being_you' },
  { value: 'innovator', key: 'kudos.quality_innovator' },
  { value: 'professional', key: 'kudos.quality_professional' },
  { value: 'creative', key: 'kudos.quality_creative' },
  { value: 'good_luck', key: 'kudos.quality_good_luck' },
]

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

export default function Kudos() {
  const navigate = useNavigate()
  const { t } = useLanguage()
  const [tab, setTab] = useState<'feed' | 'new'>('feed')
  const [entries, setEntries] = useState<KudosEntry[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)

  // New kudos form
  const [recipientId, setRecipientId] = useState('')
  const [message, setMessage] = useState('')
  const [recType, setRecType] = useState('recognition')
  const [badge, setBadge] = useState('')
  const [quality, setQuality] = useState('')
  const [isPublic, setIsPublic] = useState(true)
  const [sendState, setSendState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [showLeaderboard, setShowLeaderboard] = useState(false)
  const [leaderboard, setLeaderboard] = useState<{ name: string; points: number }[]>([])

  async function openLeaderboard() {
    const { data } = await supabase
      .from('kudos')
      .select('to_employee_id')
      .not('to_employee_id', 'is', null)

    if (data && data.length > 0) {
      const counts = new Map<string, number>()
      data.forEach((k: any) => {
        counts.set(k.to_employee_id, (counts.get(k.to_employee_id) || 0) + 1)
      })
      const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
      const empIds = sorted.map(s => s[0])
      const { data: emps } = await supabase
        .from('employees')
        .select('id, first_name, last_name')
        .in('id', empIds)
      const empMap = new Map((emps || []).map((e: any) => [e.id, `${e.first_name} ${e.last_name}`]))
      setLeaderboard(sorted.map(([id, pts]) => ({ name: empMap.get(id) || 'Unknown', points: pts })))
    }
    setShowLeaderboard(true)
  }

  const fetchData = useCallback(async () => {
    setLoading(true)

    const empRes = await supabase
      .from('employees')
      .select('id, first_name, last_name, avatar_url')
      .eq('is_active', true)
      .order('first_name')

    let kudosRes = await supabase
      .from('kudos')
      .select('*')
      .or(`to_employee_id.eq.${EMPLOYEE_ID},is_broadcast.eq.true`)
      .order('created_at', { ascending: false })

    if (!kudosRes.data || kudosRes.error) {
      kudosRes = await supabase
        .from('kudos')
        .select('*')
        .or(`to_employee_id.eq.${EMPLOYEE_ID},to_employee_id.is.null`)
        .order('created_at', { ascending: false })
    }

    const emps = (empRes.data || []) as Employee[]
    setEmployees(emps)
    const empMap = new Map(emps.map(e => [e.id, e]))

    if (kudosRes.data) {
      const enriched: KudosEntry[] = kudosRes.data.map((k: any) => {
        const from = empMap.get(k.from_employee_id)
        const to = k.to_employee_id ? empMap.get(k.to_employee_id) : null
        return {
          ...k,
          liked_by: k.liked_by || [],
          from_name: from ? `${from.first_name} ${from.last_name}` : 'Unknown',
          from_avatar: from?.avatar_url || null,
          to_name: to ? `${to.first_name} ${to.last_name}` : undefined,
        }
      })
      setEntries(enriched)
    }

    setLoading(false)
  }, [])

  useEffect(() => {
    fetchData()
    localStorage.setItem('inflowhr-kudos-seen', new Date().toISOString())
  }, [fetchData])

  async function handleLike(entry: KudosEntry) {
    if (entry.liked_by.includes(EMPLOYEE_ID)) return
    const newLikedBy = [...entry.liked_by, EMPLOYEE_ID]
    await supabase
      .from('kudos')
      .update({ like_count: entry.like_count + 1, liked_by: newLikedBy })
      .eq('id', entry.id)
    setEntries(prev => prev.map(e =>
      e.id === entry.id ? { ...e, like_count: e.like_count + 1, liked_by: newLikedBy } : e
    ))
  }

  async function handleDelete(id: number) {
    await supabase.from('kudos').delete().eq('id', id)
    setEntries(prev => prev.filter(e => e.id !== id))
  }

  async function handleSend() {
    if (!message.trim()) return
    const isBroadcast = recType === 'broadcast'
    if (!isBroadcast && !recipientId) return

    setSendState('sending')
    await supabase.from('kudos').insert({
      from_employee_id: EMPLOYEE_ID,
      to_employee_id: isBroadcast ? null : recipientId,
      message: message.trim(),
      category: 'going_above',
      recognition_type: recType,
      badge: badge || null,
      quality: quality || null,
      is_broadcast: isBroadcast,
      is_public: isPublic,
      like_count: 0,
      liked_by: [],
    })

    setSendState('sent')
    setMessage('')
    setRecipientId('')
    setBadge('')
    setQuality('')
    setTimeout(() => {
      setSendState('idle')
      setTab('feed')
      fetchData()
    }, 1500)
  }

  function getBadgeDisplay(badgeKey: string | null): { icon: string; label: string } | null {
    if (!badgeKey) return null
    const b = BADGES.find(x => x.value === badgeKey)
    return b ? { icon: b.icon, label: t(b.key) } : null
  }

  function getQualityDisplay(qualityKey: string | null): string | null {
    if (!qualityKey) return null
    const q = QUALITIES.find(x => x.value === qualityKey)
    return q ? t(q.key) : null
  }

  function getRecTypeDisplay(rt: string | null): { icon: string; label: string } | null {
    if (!rt) return null
    const r = RECOGNITION_TYPES.find(x => x.value === rt)
    return r ? { icon: r.icon, label: t(r.key) } : null
  }

  function getInitials(name: string): string {
    return name.split(' ').map(n => n[0]).join('').toUpperCase()
  }

  return (
    <div className="feature-page kudos-page">
      <header className="kudos-header">
        <button className="kudos-back" onClick={() => navigate('/')}>
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
            <circle cx="18" cy="18" r="17" stroke="#00897b" strokeWidth="2" />
            <path d="M21 12l-6 6 6 6" stroke="#00897b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="kudos-header-center">
          <h1 className="kudos-title">{t('kudos.title')} <span className="kudos-title-accent">{t('kudos.title_accent')}</span></h1>
          <p className="kudos-subtitle">{t('kudos.subtitle')}</p>
        </div>
        <button className="kudos-graph-btn" onClick={openLeaderboard}>
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="14" stroke="#00897b" strokeWidth="2" />
            <rect x="8" y="18" width="4" height="6" rx="1" fill="#00897b" />
            <rect x="14" y="12" width="4" height="12" rx="1" fill="#00897b" />
            <rect x="20" y="15" width="4" height="9" rx="1" fill="#00897b" />
          </svg>
        </button>
        <button className="feature-refresh" onClick={fetchData}>
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="14" stroke="#00897b" strokeWidth="2" />
            <path d="M22 14a6.5 6.5 0 0 0-11.3-1.5M10 18a6.5 6.5 0 0 0 11.3 1.5" stroke="#00897b" strokeWidth="2" strokeLinecap="round" />
            <path d="M22 10v4h-4M10 22v-4h4" stroke="#00897b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </header>

      <div className="kudos-tabs">
        <button className={`kudos-tab ${tab === 'feed' ? 'kudos-tab-active' : ''}`} onClick={() => setTab('feed')}>
          {t('kudos.tab_feed')}
        </button>
        <button className={`kudos-tab ${tab === 'new' ? 'kudos-tab-active' : ''}`} onClick={() => setTab('new')}>
          {t('kudos.tab_new')}
        </button>
      </div>

      {tab === 'feed' && (
        <div className="kudos-feed">
          {loading && <p className="claims-empty">{t('common.loading')}</p>}
          {!loading && entries.length === 0 && <p className="claims-empty">{t('kudos.no_kudos')}</p>}
          {entries.map(entry => {
            const badgeInfo = getBadgeDisplay(entry.badge)
            const qualityInfo = getQualityDisplay(entry.quality)
            const recInfo = getRecTypeDisplay(entry.recognition_type)
            const hasLiked = entry.liked_by.includes(EMPLOYEE_ID)
            const canDelete = entry.is_broadcast && entry.from_employee_id === EMPLOYEE_ID

            return (
              <div key={entry.id} className={`kudos-card ${entry.is_broadcast ? 'kudos-card-broadcast' : ''}`}>
                <div className="kudos-card-top">
                  <div className="kudos-card-avatar">
                    {entry.from_avatar
                      ? <img src={entry.from_avatar} alt="" className="kudos-card-avatar-img" />
                      : <span>{getInitials(entry.from_name || '')}</span>
                    }
                  </div>
                  <div className="kudos-card-meta">
                    <span className="kudos-card-from">{entry.from_name}</span>
                    <span className="kudos-card-time">{timeAgo(entry.created_at)}</span>
                  </div>
                  {recInfo && (
                    <span className="kudos-card-type-badge">
                      <span>{recInfo.icon}</span> {recInfo.label}
                    </span>
                  )}
                </div>

                {entry.to_name && (
                  <div className="kudos-card-to">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00897b" strokeWidth="2.5">
                      <path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span>{entry.to_name}</span>
                  </div>
                )}

                <p className="kudos-card-message">{entry.message}</p>

                <div className="kudos-card-tags">
                  {badgeInfo && (
                    <span className="kudos-card-badge-tag">
                      <span>{badgeInfo.icon}</span> {badgeInfo.label}
                    </span>
                  )}
                  {qualityInfo && (
                    <span className="kudos-card-quality-tag">{qualityInfo}</span>
                  )}
                </div>

                <div className="kudos-card-actions">
                  <button
                    className={`kudos-like-btn ${hasLiked ? 'kudos-liked' : ''}`}
                    onClick={() => handleLike(entry)}
                    disabled={hasLiked}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill={hasLiked ? '#00897b' : 'none'} stroke="#00897b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z" />
                      <path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
                    </svg>
                    <span>{entry.like_count}</span>
                  </button>
                  {canDelete && (
                    <button className="kudos-delete-btn" onClick={() => handleDelete(entry.id)}>
                      {t('kudos.delete')}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {tab === 'new' && (
        <div className="kudos-new-form">
          <div className="kudos-form-group">
            <label className="kudos-form-label">{t('kudos.recognition_type')}</label>
            <div className="kudos-rec-type-grid">
              {RECOGNITION_TYPES.map(rt => (
                <button
                  key={rt.value}
                  className={`kudos-rec-type-btn ${recType === rt.value ? 'kudos-rec-type-active' : ''}`}
                  onClick={() => setRecType(rt.value)}
                >
                  <span className="kudos-rec-type-icon">{rt.icon}</span>
                  <span className="kudos-rec-type-label">{t(rt.key)}</span>
                </button>
              ))}
            </div>
          </div>

          {recType !== 'broadcast' && (
            <div className="kudos-form-group">
              <label className="kudos-form-label">{t('kudos.select_recipient')}</label>
              <select
                className="kudos-form-select"
                value={recipientId}
                onChange={e => setRecipientId(e.target.value)}
              >
                <option value="">{t('kudos.select_recipient')}</option>
                {employees.filter(e => e.id !== EMPLOYEE_ID).map(e => (
                  <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="kudos-form-group">
            <label className="kudos-form-label">{t('kudos.badge')}</label>
            <div className="kudos-badge-grid">
              {BADGES.map(b => (
                <button
                  key={b.value}
                  className={`kudos-badge-btn ${badge === b.value ? 'kudos-badge-active' : ''}`}
                  onClick={() => setBadge(badge === b.value ? '' : b.value)}
                >
                  <span className="kudos-badge-icon">{b.icon}</span>
                  <span className="kudos-badge-label">{t(b.key)}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="kudos-form-group">
            <label className="kudos-form-label">{t('kudos.quality')}</label>
            <select
              className="kudos-form-select"
              value={quality}
              onChange={e => setQuality(e.target.value)}
            >
              <option value="">{t('kudos.quality')}</option>
              {QUALITIES.map(q => (
                <option key={q.value} value={q.value}>{t(q.key)}</option>
              ))}
            </select>
          </div>

          <div className="kudos-form-group">
            <textarea
              className="kudos-form-textarea"
              placeholder={t('kudos.message_placeholder')}
              value={message}
              onChange={e => setMessage(e.target.value)}
              rows={4}
            />
          </div>

          <div className="kudos-form-group kudos-public-row">
            <label className="kudos-form-label">{t('kudos.public')}</label>
            <button
              className={`kudos-toggle ${isPublic ? 'kudos-toggle-on' : ''}`}
              onClick={() => setIsPublic(!isPublic)}
            >
              <div className="kudos-toggle-dot" />
            </button>
          </div>

          <button
            className="kudos-send-btn"
            onClick={handleSend}
            disabled={sendState !== 'idle' || !message.trim()}
          >
            {sendState === 'idle' && t('kudos.send')}
            {sendState === 'sending' && t('kudos.sending')}
            {sendState === 'sent' && (
              <>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {t('kudos.sent')}
              </>
            )}
          </button>
        </div>
      )}

      {showLeaderboard && (
        <div className="kudos-lb-overlay" onClick={() => setShowLeaderboard(false)}>
          <div className="kudos-lb-modal" onClick={e => e.stopPropagation()}>
            <div className="kudos-lb-header">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5C7 4 7 7 7 7" />
                <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5C17 4 17 7 17 7" />
                <path d="M4 22h16" />
                <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20 7 22" />
                <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20 17 22" />
                <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
              </svg>
              <span className="kudos-lb-title">{t('kudos.leaderboard')}</span>
              <button className="kudos-lb-close" onClick={() => setShowLeaderboard(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {leaderboard.length === 0 && (
              <p className="kudos-lb-empty">{t('kudos.no_kudos')}</p>
            )}

            <div className="kudos-lb-chart">
              {(() => {
                const maxPts = Math.max(...leaderboard.map(l => l.points), 1)
                const colors = ['#00897b', '#26a69a', '#4db6ac', '#80cbc4', '#b2dfdb']
                return leaderboard.map((entry, i) => (
                  <div key={i} className="kudos-lb-row">
                    <div className="kudos-lb-rank">
                      {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                    </div>
                    <div className="kudos-lb-bar-wrap">
                      <span className="kudos-lb-name">{entry.name}</span>
                      <div className="kudos-lb-bar-track">
                        <div
                          className="kudos-lb-bar-fill"
                          style={{ width: `${(entry.points / maxPts) * 100}%`, background: colors[i] || colors[4] }}
                        />
                      </div>
                    </div>
                    <span className="kudos-lb-points">{entry.points}</span>
                  </div>
                ))
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
