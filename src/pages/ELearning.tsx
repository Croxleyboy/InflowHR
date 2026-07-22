import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLanguage } from '../context/LanguageContext'

const STORAGE_KEY = 'inflowhr-elearning'

interface CourseProgress {
  completed: string[]
  bookmarked: string[]
  inProgress: Record<string, number>
}

function loadProgress(): CourseProgress {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return { completed: [], bookmarked: [], inProgress: {} }
}

function saveProgress(p: CourseProgress) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
}

type CourseType = 'video' | 'article' | 'quiz' | 'policy'
type Category = 'all' | 'required' | 'recommended' | 'bookmarked'

interface Course {
  id: string
  titleKey: string
  descKey: string
  category: string
  type: CourseType
  duration: string
  required: boolean
  deadline?: string
  tags: string[]
}

const COURSES: Course[] = [
  { id: 'onb-welcome', titleKey: 'elearning.c_welcome_title', descKey: 'elearning.c_welcome_desc', category: 'onboarding', type: 'video', duration: '12 min', required: true, deadline: '2026-08-01', tags: ['new-starter'] },
  { id: 'onb-systems', titleKey: 'elearning.c_systems_title', descKey: 'elearning.c_systems_desc', category: 'onboarding', type: 'article', duration: '8 min', required: true, deadline: '2026-08-01', tags: ['new-starter'] },
  { id: 'onb-culture', titleKey: 'elearning.c_culture_title', descKey: 'elearning.c_culture_desc', category: 'onboarding', type: 'video', duration: '15 min', required: true, deadline: '2026-08-01', tags: ['new-starter'] },
  { id: 'comp-gdpr', titleKey: 'elearning.c_gdpr_title', descKey: 'elearning.c_gdpr_desc', category: 'compliance', type: 'quiz', duration: '20 min', required: true, deadline: '2026-09-01', tags: ['compliance'] },
  { id: 'comp-health', titleKey: 'elearning.c_health_title', descKey: 'elearning.c_health_desc', category: 'compliance', type: 'quiz', duration: '25 min', required: true, deadline: '2026-09-01', tags: ['compliance'] },
  { id: 'comp-antibrib', titleKey: 'elearning.c_antibribery_title', descKey: 'elearning.c_antibribery_desc', category: 'compliance', type: 'quiz', duration: '15 min', required: true, deadline: '2026-09-15', tags: ['compliance'] },
  { id: 'pol-handbook', titleKey: 'elearning.c_handbook_title', descKey: 'elearning.c_handbook_desc', category: 'policies', type: 'policy', duration: '10 min', required: false, tags: ['policy'] },
  { id: 'pol-expenses', titleKey: 'elearning.c_expenses_title', descKey: 'elearning.c_expenses_desc', category: 'policies', type: 'policy', duration: '5 min', required: false, tags: ['policy'] },
  { id: 'role-agile', titleKey: 'elearning.c_agile_title', descKey: 'elearning.c_agile_desc', category: 'role', type: 'video', duration: '30 min', required: false, tags: ['skills'] },
  { id: 'role-present', titleKey: 'elearning.c_presenting_title', descKey: 'elearning.c_presenting_desc', category: 'role', type: 'video', duration: '22 min', required: false, tags: ['skills'] },
  { id: 'dev-leadership', titleKey: 'elearning.c_leadership_title', descKey: 'elearning.c_leadership_desc', category: 'development', type: 'video', duration: '35 min', required: false, tags: ['growth'] },
  { id: 'dev-feedback', titleKey: 'elearning.c_feedback_title', descKey: 'elearning.c_feedback_desc', category: 'development', type: 'article', duration: '12 min', required: false, tags: ['growth'] },
  { id: 'wellbeing-stress', titleKey: 'elearning.c_stress_title', descKey: 'elearning.c_stress_desc', category: 'wellbeing', type: 'video', duration: '18 min', required: false, tags: ['wellbeing'] },
  { id: 'wellbeing-ergo', titleKey: 'elearning.c_ergo_title', descKey: 'elearning.c_ergo_desc', category: 'wellbeing', type: 'article', duration: '8 min', required: false, tags: ['wellbeing'] },
]

const CATEGORY_ICONS: Record<string, string> = {
  onboarding: '🚀',
  compliance: '🛡️',
  policies: '📋',
  role: '🎯',
  development: '📈',
  wellbeing: '🧘',
}

const TYPE_ICONS: Record<CourseType, React.ReactNode> = {
  video: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>,
  article: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
  quiz: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  policy: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
}

function getTypeLabel(type: CourseType, t: (k: string) => string): string {
  return t(`elearning.type_${type}`)
}

const CATEGORY_FILTERS = ['onboarding', 'compliance', 'policies', 'role', 'development', 'wellbeing'] as const

export default function ELearning() {
  const navigate = useNavigate()
  const { t } = useLanguage()
  const [progress, setProgress] = useState<CourseProgress>(loadProgress)
  const [filter, setFilter] = useState<Category>('all')
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)
  const [expandedCourse, setExpandedCourse] = useState<string | null>(null)
  const [showComplete, setShowComplete] = useState<string | null>(null)

  useEffect(() => { saveProgress(progress) }, [progress])

  const completedCount = progress.completed.length
  const totalHours = COURSES.reduce((sum, c) => {
    if (progress.completed.includes(c.id) || (progress.inProgress[c.id] ?? 0) > 0) {
      return sum + parseInt(c.duration)
    }
    return sum
  }, 0)
  const requiredTotal = COURSES.filter(c => c.required).length
  const requiredDone = COURSES.filter(c => c.required && progress.completed.includes(c.id)).length

  const continueId = Object.entries(progress.inProgress)
    .filter(([id, pct]) => pct > 0 && pct < 100 && !progress.completed.includes(id))
    .sort(([, a], [, b]) => b - a)[0]?.[0]
  const continueCourse = COURSES.find(c => c.id === continueId)

  function filteredCourses() {
    let list = COURSES
    if (filter === 'required') list = list.filter(c => c.required)
    if (filter === 'recommended') list = list.filter(c => !c.required)
    if (filter === 'bookmarked') list = list.filter(c => progress.bookmarked.includes(c.id))
    if (categoryFilter) list = list.filter(c => c.category === categoryFilter)
    return list
  }

  function toggleBookmark(id: string) {
    setProgress(p => ({
      ...p,
      bookmarked: p.bookmarked.includes(id)
        ? p.bookmarked.filter(b => b !== id)
        : [...p.bookmarked, id],
    }))
  }

  function startCourse(id: string) {
    if (progress.completed.includes(id)) return
    setProgress(p => ({
      ...p,
      inProgress: { ...p.inProgress, [id]: Math.max(p.inProgress[id] ?? 0, 25) },
    }))
    setExpandedCourse(id)
  }

  function completeCourse(id: string) {
    setShowComplete(id)
    setTimeout(() => {
      setProgress(p => ({
        ...p,
        completed: [...p.completed.filter(c => c !== id), id],
        inProgress: { ...p.inProgress, [id]: 100 },
      }))
      setShowComplete(null)
      setExpandedCourse(null)
    }, 1500)
  }

  function getCourseStatus(id: string): 'completed' | 'in-progress' | 'not-started' {
    if (progress.completed.includes(id)) return 'completed'
    if ((progress.inProgress[id] ?? 0) > 0) return 'in-progress'
    return 'not-started'
  }

  function daysUntilDeadline(deadline?: string): number | null {
    if (!deadline) return null
    const diff = new Date(deadline).getTime() - Date.now()
    return Math.ceil(diff / (1000 * 60 * 60 * 24))
  }

  return (
    <div className="feature-page elearning-page">
      <header className="elearning-header">
        <button className="elearning-back" onClick={() => navigate('/')}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1>{t('elearning.title')} <span className="elearning-title-accent">{t('elearning.title_accent')}</span></h1>
      </header>

      {/* Stats Bar */}
      <div className="elearning-stats">
        <div className="elearning-stat">
          <span className="elearning-stat-number">{completedCount}</span>
          <span className="elearning-stat-label">{t('elearning.stat_completed')}</span>
        </div>
        <div className="elearning-stat-divider" />
        <div className="elearning-stat">
          <span className="elearning-stat-number">{totalHours}</span>
          <span className="elearning-stat-label">{t('elearning.stat_minutes')}</span>
        </div>
        <div className="elearning-stat-divider" />
        <div className="elearning-stat">
          <span className="elearning-stat-number">{requiredDone}/{requiredTotal}</span>
          <span className="elearning-stat-label">{t('elearning.stat_required')}</span>
        </div>
      </div>

      {/* Continue Learning */}
      {continueCourse && (
        <div className="elearning-continue" onClick={() => startCourse(continueCourse.id)}>
          <div className="elearning-continue-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          </div>
          <div className="elearning-continue-info">
            <span className="elearning-continue-label">{t('elearning.continue_learning')}</span>
            <span className="elearning-continue-title">{t(continueCourse.titleKey)}</span>
            <div className="elearning-continue-progress">
              <div className="elearning-continue-bar">
                <div className="elearning-continue-fill" style={{ width: `${progress.inProgress[continueCourse.id]}%` }} />
              </div>
              <span>{progress.inProgress[continueCourse.id]}%</span>
            </div>
          </div>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5d4037" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="elearning-filters">
        {(['all', 'required', 'recommended', 'bookmarked'] as Category[]).map(cat => (
          <button
            key={cat}
            className={`elearning-filter-chip ${filter === cat ? 'elearning-filter-active' : ''}`}
            onClick={() => { setFilter(cat); setCategoryFilter(null) }}
          >
            {t(`elearning.filter_${cat}`)}
          </button>
        ))}
      </div>

      {/* Category Chips */}
      <div className="elearning-categories">
        {CATEGORY_FILTERS.map(cat => (
          <button
            key={cat}
            className={`elearning-cat-chip ${categoryFilter === cat ? 'elearning-cat-active' : ''}`}
            onClick={() => setCategoryFilter(categoryFilter === cat ? null : cat)}
          >
            <span>{CATEGORY_ICONS[cat]}</span>
            <span>{t(`elearning.cat_${cat}`)}</span>
          </button>
        ))}
      </div>

      {/* Course List */}
      <div className="elearning-courses">
        {filteredCourses().map(course => {
          const status = getCourseStatus(course.id)
          const isBookmarked = progress.bookmarked.includes(course.id)
          const isExpanded = expandedCourse === course.id
          const daysLeft = daysUntilDeadline(course.deadline)
          const pct = progress.inProgress[course.id] ?? 0

          return (
            <div key={course.id} className={`elearning-card ${status === 'completed' ? 'elearning-card-done' : ''} ${isExpanded ? 'elearning-card-expanded' : ''}`}>
              {showComplete === course.id && (
                <div className="elearning-complete-overlay">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  <span>{t('elearning.well_done')}</span>
                </div>
              )}
              <div className="elearning-card-top" onClick={() => setExpandedCourse(isExpanded ? null : course.id)}>
                <div className="elearning-card-icon" data-category={course.category}>
                  {CATEGORY_ICONS[course.category]}
                </div>
                <div className="elearning-card-info">
                  <h3 className="elearning-card-title">{t(course.titleKey)}</h3>
                  <div className="elearning-card-meta">
                    <span className="elearning-card-type">{TYPE_ICONS[course.type]} {getTypeLabel(course.type, t)}</span>
                    <span className="elearning-card-duration">{course.duration}</span>
                  </div>
                </div>
                <div className="elearning-card-right">
                  {status === 'completed' ? (
                    <div className="elearning-badge-done">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    </div>
                  ) : course.required && daysLeft !== null ? (
                    <span className={`elearning-deadline ${daysLeft <= 7 ? 'elearning-deadline-urgent' : ''}`}>
                      {daysLeft <= 0 ? t('elearning.overdue') : `${daysLeft}d`}
                    </span>
                  ) : null}
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`elearning-chevron ${isExpanded ? 'elearning-chevron-open' : ''}`}>
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </div>
              </div>

              {status === 'in-progress' && !isExpanded && (
                <div className="elearning-card-progress-bar">
                  <div className="elearning-card-progress-fill" style={{ width: `${pct}%` }} />
                </div>
              )}

              {isExpanded && (
                <div className="elearning-card-body">
                  <p className="elearning-card-desc">{t(course.descKey)}</p>
                  {course.required && (
                    <div className="elearning-card-required-badge">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                      {t('elearning.mandatory')}
                      {course.deadline && <span> · {t('elearning.due_by')} {new Date(course.deadline).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
                    </div>
                  )}

                  {status === 'in-progress' && (
                    <div className="elearning-expanded-progress">
                      <div className="elearning-expanded-bar">
                        <div className="elearning-expanded-fill" style={{ width: `${pct}%` }} />
                      </div>
                      <span>{pct}% {t('elearning.complete_label')}</span>
                    </div>
                  )}

                  <div className="elearning-card-actions">
                    <button className="elearning-bookmark-btn" onClick={e => { e.stopPropagation(); toggleBookmark(course.id) }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill={isBookmarked ? '#f9a825' : 'none'} stroke={isBookmarked ? '#f9a825' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                      </svg>
                    </button>
                    {status === 'completed' ? (
                      <button className="elearning-action-btn elearning-action-review" onClick={e => { e.stopPropagation() }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
                        {t('elearning.review')}
                      </button>
                    ) : status === 'in-progress' ? (
                      <button className="elearning-action-btn elearning-action-continue" onClick={e => { e.stopPropagation(); completeCourse(course.id) }}>
                        {t('elearning.mark_complete')}
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                      </button>
                    ) : (
                      <button className="elearning-action-btn elearning-action-start" onClick={e => { e.stopPropagation(); startCourse(course.id) }}>
                        {t('elearning.start_course')}
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
        {filteredCourses().length === 0 && (
          <div className="elearning-empty">
            <span>📚</span>
            <p>{t('elearning.no_courses')}</p>
          </div>
        )}
      </div>

      <div className="elearning-footer-note">
        <p>{t('elearning.footer_note')}</p>
      </div>
    </div>
  )
}
