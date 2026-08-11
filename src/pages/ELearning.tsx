import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'

const STORAGE_KEY = 'inflowhr-elearning'

interface CourseProgress {
  completed: string[]
  bookmarked: string[]
  inProgress: Record<string, number>
  completedDates: Record<string, string>
}

function loadProgress(): CourseProgress {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return { ...parsed, completedDates: parsed.completedDates || {} }
    }
  } catch {}
  return { completed: [], bookmarked: [], inProgress: {}, completedDates: {} }
}

function saveProgress(p: CourseProgress) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
}

export type CourseType = 'video' | 'article' | 'quiz' | 'policy'
type Category = 'all' | 'required' | 'recommended' | 'bookmarked'

export interface Course {
  id: string
  titleKey: string
  descKey: string
  category: string
  type: CourseType
  duration: string
  required: boolean
  deadline?: string
  daysToComplete?: number
  tags: string[]
  annualReminder?: boolean
  industry?: string
  externalUrl?: string
}

export const COURSES: Course[] = [
  // ── Onboarding ──
  { id: 'onb-getting-started', titleKey: 'elearning.c_getting_started_title', descKey: 'elearning.c_getting_started_desc', category: 'onboarding', type: 'article', duration: '20 min', required: true, tags: ['new-starter', 'faq'] },
  { id: 'onb-welcome', titleKey: 'elearning.c_welcome_title', descKey: 'elearning.c_welcome_desc', category: 'onboarding', type: 'video', duration: '12 min', required: true, deadline: '2026-08-01', tags: ['new-starter'] },
  { id: 'onb-systems', titleKey: 'elearning.c_systems_title', descKey: 'elearning.c_systems_desc', category: 'onboarding', type: 'article', duration: '8 min', required: true, deadline: '2026-08-01', tags: ['new-starter'] },
  { id: 'onb-culture', titleKey: 'elearning.c_culture_title', descKey: 'elearning.c_culture_desc', category: 'onboarding', type: 'video', duration: '15 min', required: true, deadline: '2026-08-01', tags: ['new-starter'] },

  // ── Compliance (common — annual reminders) ──
  { id: 'comp-gdpr', titleKey: 'elearning.c_gdpr_title', descKey: 'elearning.c_gdpr_desc', category: 'compliance', type: 'quiz', duration: '20 min', required: true, deadline: '2026-09-01', tags: ['compliance'], annualReminder: true },
  { id: 'comp-health', titleKey: 'elearning.c_health_title', descKey: 'elearning.c_health_desc', category: 'compliance', type: 'quiz', duration: '25 min', required: true, deadline: '2026-09-01', tags: ['compliance'], annualReminder: true },
  { id: 'comp-antibrib', titleKey: 'elearning.c_antibribery_title', descKey: 'elearning.c_antibribery_desc', category: 'compliance', type: 'quiz', duration: '15 min', required: true, deadline: '2026-09-15', tags: ['compliance'], annualReminder: true },
  { id: 'comp-cybersec', titleKey: 'elearning.c_cybersec_title', descKey: 'elearning.c_cybersec_desc', category: 'compliance', type: 'quiz', duration: '20 min', required: true, deadline: '2026-09-01', tags: ['compliance'], annualReminder: true },
  { id: 'comp-dei', titleKey: 'elearning.c_dei_title', descKey: 'elearning.c_dei_desc', category: 'compliance', type: 'video', duration: '25 min', required: true, deadline: '2026-10-01', tags: ['compliance'], annualReminder: true },
  { id: 'comp-modern-slavery', titleKey: 'elearning.c_modern_slavery_title', descKey: 'elearning.c_modern_slavery_desc', category: 'compliance', type: 'quiz', duration: '15 min', required: true, deadline: '2026-10-01', tags: ['compliance'], annualReminder: true },
  { id: 'comp-fire', titleKey: 'elearning.c_fire_title', descKey: 'elearning.c_fire_desc', category: 'compliance', type: 'quiz', duration: '15 min', required: true, deadline: '2026-09-01', tags: ['compliance'], annualReminder: true },
  { id: 'comp-mhfa', titleKey: 'elearning.c_mhfa_title', descKey: 'elearning.c_mhfa_desc', category: 'compliance', type: 'video', duration: '30 min', required: false, tags: ['compliance', 'wellbeing'] },
  { id: 'comp-env', titleKey: 'elearning.c_env_title', descKey: 'elearning.c_env_desc', category: 'compliance', type: 'article', duration: '15 min', required: false, tags: ['compliance'] },

  // ── Policies ──
  { id: 'pol-handbook', titleKey: 'elearning.c_handbook_title', descKey: 'elearning.c_handbook_desc', category: 'policies', type: 'policy', duration: '10 min', required: false, tags: ['policy'] },
  { id: 'pol-expenses', titleKey: 'elearning.c_expenses_title', descKey: 'elearning.c_expenses_desc', category: 'policies', type: 'policy', duration: '5 min', required: false, tags: ['policy'] },
  { id: 'pol-remote', titleKey: 'elearning.c_remote_title', descKey: 'elearning.c_remote_desc', category: 'policies', type: 'article', duration: '10 min', required: false, tags: ['policy'] },
  { id: 'pol-social-media', titleKey: 'elearning.c_social_media_title', descKey: 'elearning.c_social_media_desc', category: 'policies', type: 'policy', duration: '8 min', required: false, tags: ['policy'] },

  // ── Role / Skills ──
  { id: 'role-agile', titleKey: 'elearning.c_agile_title', descKey: 'elearning.c_agile_desc', category: 'role', type: 'video', duration: '30 min', required: false, tags: ['skills'] },
  { id: 'role-present', titleKey: 'elearning.c_presenting_title', descKey: 'elearning.c_presenting_desc', category: 'role', type: 'video', duration: '22 min', required: false, tags: ['skills'] },
  { id: 'role-time-mgmt', titleKey: 'elearning.c_time_mgmt_title', descKey: 'elearning.c_time_mgmt_desc', category: 'role', type: 'article', duration: '12 min', required: false, tags: ['skills'] },
  { id: 'role-conflict', titleKey: 'elearning.c_conflict_title', descKey: 'elearning.c_conflict_desc', category: 'role', type: 'video', duration: '18 min', required: false, tags: ['skills'] },

  // ── Development ──
  { id: 'dev-leadership', titleKey: 'elearning.c_leadership_title', descKey: 'elearning.c_leadership_desc', category: 'development', type: 'video', duration: '35 min', required: false, tags: ['growth'] },
  { id: 'dev-feedback', titleKey: 'elearning.c_feedback_title', descKey: 'elearning.c_feedback_desc', category: 'development', type: 'article', duration: '12 min', required: false, tags: ['growth'] },
  { id: 'dev-coaching', titleKey: 'elearning.c_coaching_title', descKey: 'elearning.c_coaching_desc', category: 'development', type: 'video', duration: '25 min', required: false, tags: ['growth'] },
  { id: 'dev-project-mgmt', titleKey: 'elearning.c_project_mgmt_title', descKey: 'elearning.c_project_mgmt_desc', category: 'development', type: 'video', duration: '30 min', required: false, tags: ['growth'] },

  // ── Wellbeing ──
  { id: 'wellbeing-stress', titleKey: 'elearning.c_stress_title', descKey: 'elearning.c_stress_desc', category: 'wellbeing', type: 'video', duration: '18 min', required: false, tags: ['wellbeing'] },
  { id: 'wellbeing-ergo', titleKey: 'elearning.c_ergo_title', descKey: 'elearning.c_ergo_desc', category: 'wellbeing', type: 'article', duration: '8 min', required: false, tags: ['wellbeing'] },
  { id: 'wellbeing-financial', titleKey: 'elearning.c_financial_wellbeing_title', descKey: 'elearning.c_financial_wellbeing_desc', category: 'wellbeing', type: 'article', duration: '15 min', required: false, tags: ['wellbeing'] },

  // ── Industry: Legal ──
  { id: 'legal-sra', titleKey: 'elearning.c_sra_title', descKey: 'elearning.c_sra_desc', category: 'compliance', type: 'quiz', duration: '30 min', required: true, tags: ['compliance'], annualReminder: true, industry: 'legal' },
  { id: 'legal-aml', titleKey: 'elearning.c_aml_title', descKey: 'elearning.c_aml_desc', category: 'compliance', type: 'quiz', duration: '25 min', required: true, tags: ['compliance'], annualReminder: true, industry: 'legal' },
  { id: 'legal-conflict-interest', titleKey: 'elearning.c_conflict_interest_title', descKey: 'elearning.c_conflict_interest_desc', category: 'compliance', type: 'quiz', duration: '20 min', required: true, tags: ['compliance'], annualReminder: true, industry: 'legal' },
  { id: 'legal-client-money', titleKey: 'elearning.c_client_money_title', descKey: 'elearning.c_client_money_desc', category: 'compliance', type: 'quiz', duration: '20 min', required: true, tags: ['compliance'], annualReminder: true, industry: 'legal' },
  { id: 'legal-prof-ethics', titleKey: 'elearning.c_prof_ethics_title', descKey: 'elearning.c_prof_ethics_desc', category: 'development', type: 'video', duration: '25 min', required: false, tags: ['growth'], industry: 'legal' },
  { id: 'legal-cpd', titleKey: 'elearning.c_cpd_title', descKey: 'elearning.c_cpd_desc', category: 'development', type: 'article', duration: '10 min', required: false, tags: ['growth'], industry: 'legal' },

  // ── Industry: Education ──
  { id: 'edu-safeguarding', titleKey: 'elearning.c_safeguarding_title', descKey: 'elearning.c_safeguarding_desc', category: 'compliance', type: 'quiz', duration: '35 min', required: true, tags: ['compliance'], annualReminder: true, industry: 'education' },
  { id: 'edu-prevent', titleKey: 'elearning.c_prevent_title', descKey: 'elearning.c_prevent_desc', category: 'compliance', type: 'quiz', duration: '25 min', required: true, tags: ['compliance'], annualReminder: true, industry: 'education' },
  { id: 'edu-send', titleKey: 'elearning.c_send_title', descKey: 'elearning.c_send_desc', category: 'compliance', type: 'video', duration: '30 min', required: true, tags: ['compliance'], annualReminder: true, industry: 'education' },
  { id: 'edu-online-safety', titleKey: 'elearning.c_online_safety_title', descKey: 'elearning.c_online_safety_desc', category: 'compliance', type: 'quiz', duration: '20 min', required: true, tags: ['compliance'], annualReminder: true, industry: 'education' },
  { id: 'edu-behaviour', titleKey: 'elearning.c_behaviour_title', descKey: 'elearning.c_behaviour_desc', category: 'role', type: 'video', duration: '25 min', required: false, tags: ['skills'], industry: 'education' },
  { id: 'edu-ofsted', titleKey: 'elearning.c_ofsted_title', descKey: 'elearning.c_ofsted_desc', category: 'development', type: 'article', duration: '20 min', required: false, tags: ['growth'], industry: 'education' },

  // ── Industry: Accountancy ──
  { id: 'acc-aml', titleKey: 'elearning.c_acc_aml_title', descKey: 'elearning.c_acc_aml_desc', category: 'compliance', type: 'quiz', duration: '25 min', required: true, tags: ['compliance'], annualReminder: true, industry: 'accountancy' },
  { id: 'acc-ethics', titleKey: 'elearning.c_acc_ethics_title', descKey: 'elearning.c_acc_ethics_desc', category: 'compliance', type: 'quiz', duration: '20 min', required: true, tags: ['compliance'], annualReminder: true, industry: 'accountancy' },
  { id: 'acc-tax-update', titleKey: 'elearning.c_tax_update_title', descKey: 'elearning.c_tax_update_desc', category: 'compliance', type: 'video', duration: '30 min', required: true, tags: ['compliance'], annualReminder: true, industry: 'accountancy' },
  { id: 'acc-audit-standards', titleKey: 'elearning.c_audit_standards_title', descKey: 'elearning.c_audit_standards_desc', category: 'compliance', type: 'quiz', duration: '25 min', required: true, tags: ['compliance'], annualReminder: true, industry: 'accountancy' },
  { id: 'acc-client-conf', titleKey: 'elearning.c_client_conf_title', descKey: 'elearning.c_client_conf_desc', category: 'compliance', type: 'quiz', duration: '15 min', required: true, tags: ['compliance'], annualReminder: true, industry: 'accountancy' },
  { id: 'acc-cpd', titleKey: 'elearning.c_acc_cpd_title', descKey: 'elearning.c_acc_cpd_desc', category: 'development', type: 'article', duration: '10 min', required: false, tags: ['growth'], industry: 'accountancy' },
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

function isRenewalDue(courseId: string, completedDates: Record<string, string>): boolean {
  const completedDate = completedDates[courseId]
  if (!completedDate) return false
  const completed = new Date(completedDate)
  const oneYearAgo = new Date()
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
  return completed < oneYearAgo
}

export default function ELearning() {
  const navigate = useNavigate()
  const { t } = useLanguage()
  const { companyUser, employeeId: EMPLOYEE_ID } = useAuth()
  const [progress, setProgress] = useState<CourseProgress>(loadProgress)
  const [filter, setFilter] = useState<Category>('all')
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)
  const [expandedCourse, setExpandedCourse] = useState<string | null>(null)
  const [showComplete, setShowComplete] = useState<string | null>(null)
  const [allCourses, setAllCourses] = useState<Course[]>(COURSES)
  const [enabledCourseIds, setEnabledCourseIds] = useState<Set<string> | null>(null)
  const [enrolmentDates, setEnrolmentDates] = useState<Record<string, string>>({})

  const fetchCourses = useCallback(async () => {
    const { data } = await supabase
      .from('elearning_courses')
      .select('*')
      .eq('is_active', true)
      .order('category')
      .order('title')
    if (data && data.length > 0) {
      setAllCourses(data.map((r: any) => ({
        id: r.id,
        titleKey: r.title,
        descKey: r.description,
        category: r.category,
        type: r.type,
        duration: r.duration,
        required: r.required,
        deadline: r.deadline || undefined,
        daysToComplete: r.days_to_complete || undefined,
        tags: r.tags || [],
        annualReminder: r.annual_reminder,
        industry: r.industry || undefined,
        externalUrl: r.external_url || undefined,
      })))
    }
  }, [])

  const fetchEnabledCourses = useCallback(async () => {
    if (!companyUser?.company_id) return
    const { data } = await supabase
      .from('company_elearning_courses')
      .select('course_id')
      .eq('company_id', companyUser.company_id)
      .eq('is_enabled', true)
    if (data) {
      setEnabledCourseIds(new Set(data.map((r: any) => r.course_id)))
    }
  }, [companyUser?.company_id])

  const fetchEnrolmentDates = useCallback(async () => {
    if (!companyUser?.company_id || !EMPLOYEE_ID) return
    const { data } = await supabase
      .from('course_enrolments')
      .select('course_id, enrolled_at')
      .eq('company_id', companyUser.company_id)
      .eq('employee_id', EMPLOYEE_ID)
    if (data) {
      const dates: Record<string, string> = {}
      data.forEach((r: any) => { if (r.enrolled_at) dates[r.course_id] = r.enrolled_at })
      setEnrolmentDates(dates)
    }
  }, [companyUser?.company_id, EMPLOYEE_ID])

  useEffect(() => { fetchCourses() }, [fetchCourses])
  useEffect(() => { fetchEnabledCourses() }, [fetchEnabledCourses])
  useEffect(() => { fetchEnrolmentDates() }, [fetchEnrolmentDates])
  useEffect(() => { saveProgress(progress) }, [progress])

  useEffect(() => {
    if (!companyUser?.company_id || !EMPLOYEE_ID || progress.completed.length === 0) return
    const rows = progress.completed.map(cid => ({
      company_id: companyUser.company_id,
      employee_id: EMPLOYEE_ID,
      course_id: cid,
      completed_at: progress.completedDates[cid] || new Date().toISOString(),
    }))
    supabase.from('elearning_completions').upsert(rows, { onConflict: 'company_id,employee_id,course_id' })
  }, [companyUser?.company_id, EMPLOYEE_ID])

  const visibleCourses = enabledCourseIds !== null
    ? allCourses.filter(c => enabledCourseIds.has(c.id))
    : allCourses

  const completedCount = progress.completed.filter(id => visibleCourses.some(c => c.id === id)).length
  const totalHours = visibleCourses.reduce((sum, c) => {
    if (progress.completed.includes(c.id) || (progress.inProgress[c.id] ?? 0) > 0) {
      return sum + parseInt(c.duration)
    }
    return sum
  }, 0)
  const requiredTotal = visibleCourses.filter(c => c.required).length
  const requiredDone = visibleCourses.filter(c => c.required && progress.completed.includes(c.id)).length

  const renewalDueCount = visibleCourses.filter(c =>
    c.annualReminder && progress.completed.includes(c.id) && isRenewalDue(c.id, progress.completedDates)
  ).length

  const continueId = Object.entries(progress.inProgress)
    .filter(([id, pct]) => pct > 0 && pct < 100 && !progress.completed.includes(id))
    .sort(([, a], [, b]) => b - a)[0]?.[0]
  const continueCourse = visibleCourses.find(c => c.id === continueId)

  function filteredCourses() {
    let list = visibleCourses
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

  function openCourse(course: Course) {
    if (course.type === 'policy') {
      setProgress(p => ({
        ...p,
        inProgress: { ...p.inProgress, [course.id]: Math.max(p.inProgress[course.id] ?? 0, 25) },
      }))
      setExpandedCourse(course.id)
      return
    }
    setProgress(p => ({
      ...p,
      inProgress: { ...p.inProgress, [course.id]: Math.max(p.inProgress[course.id] ?? 0, 25) },
    }))
    const params = new URLSearchParams({
      type: course.type,
      title: t(course.titleKey),
      desc: t(course.descKey),
      duration: course.duration,
    })
    if (course.externalUrl) params.set('url', course.externalUrl)
    navigate(`/elearning/${course.id}?${params.toString()}`)
  }

  function completeCourse(id: string) {
    setShowComplete(id)
    setTimeout(() => {
      const now = new Date().toISOString()
      setProgress(p => ({
        ...p,
        completed: [...p.completed.filter(c => c !== id), id],
        inProgress: { ...p.inProgress, [id]: 100 },
        completedDates: { ...p.completedDates, [id]: now },
      }))
      if (companyUser?.company_id && EMPLOYEE_ID) {
        supabase.from('elearning_completions').upsert({
          company_id: companyUser.company_id,
          employee_id: EMPLOYEE_ID,
          course_id: id,
          completed_at: now,
        }, { onConflict: 'company_id,employee_id,course_id' })
      }
      setShowComplete(null)
      setExpandedCourse(null)
    }, 1500)
  }

  function renewCourse(id: string) {
    setProgress(p => ({
      ...p,
      completed: p.completed.filter(c => c !== id),
      inProgress: { ...p.inProgress, [id]: 0 },
    }))
    if (companyUser?.company_id && EMPLOYEE_ID) {
      supabase.from('elearning_completions').delete()
        .eq('company_id', companyUser.company_id)
        .eq('employee_id', EMPLOYEE_ID)
        .eq('course_id', id)
    }
    setExpandedCourse(id)
  }

  function getCourseStatus(id: string): 'completed' | 'in-progress' | 'not-started' | 'renewal-due' {
    if (progress.completed.includes(id)) {
      const course = allCourses.find(c => c.id === id)
      if (course?.annualReminder && isRenewalDue(id, progress.completedDates)) return 'renewal-due'
      return 'completed'
    }
    if ((progress.inProgress[id] ?? 0) > 0) return 'in-progress'
    return 'not-started'
  }

  function daysUntilDeadline(course: Course): number | null {
    if (course.daysToComplete) {
      const enrolledAt = enrolmentDates[course.id]
      if (!enrolledAt) return course.daysToComplete
      const enrolled = new Date(enrolledAt)
      const deadlineDate = new Date(enrolled)
      deadlineDate.setDate(deadlineDate.getDate() + course.daysToComplete)
      const diff = deadlineDate.getTime() - Date.now()
      return Math.ceil(diff / (1000 * 60 * 60 * 24))
    }
    if (!course.deadline) return null
    const diff = new Date(course.deadline).getTime() - Date.now()
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
        <button className="feature-refresh" onClick={fetchEnabledCourses} style={{ marginLeft: 'auto' }}>
          <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="14" stroke="#fff" strokeWidth="2" />
            <path d="M22 14a6.5 6.5 0 0 0-11.3-1.5M10 18a6.5 6.5 0 0 0 11.3 1.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
            <path d="M22 10v4h-4M10 22v-4h4" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
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
        {renewalDueCount > 0 && (
          <>
            <div className="elearning-stat-divider" />
            <div className="elearning-stat">
              <span className="elearning-stat-number elearning-stat-renewal">{renewalDueCount}</span>
              <span className="elearning-stat-label">{t('elearning.stat_renewal_due')}</span>
            </div>
          </>
        )}
      </div>

      {/* Continue Learning */}
      {continueCourse && (
        <div className="elearning-continue" onClick={() => openCourse(continueCourse)}>
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
          const daysLeft = daysUntilDeadline(course)
          const pct = progress.inProgress[course.id] ?? 0

          return (
            <div key={course.id} className={`elearning-card ${status === 'completed' ? 'elearning-card-done' : ''} ${status === 'renewal-due' ? 'elearning-card-renewal' : ''} ${isExpanded ? 'elearning-card-expanded' : ''}`}>
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
                    {course.annualReminder && (
                      <span className="elearning-card-annual">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 22c1.1 0 2-.9 2-2h-4a2 2 0 0 0 2 2z"/><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/></svg>
                        {t('elearning.annual')}
                      </span>
                    )}
                  </div>
                </div>
                <div className="elearning-card-right">
                  {status === 'completed' ? (
                    <div className="elearning-badge-done">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    </div>
                  ) : status === 'renewal-due' ? (
                    <span className="elearning-badge-renewal">{t('elearning.renewal_due')}</span>
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
                      {daysLeft !== null && <span> · {daysLeft <= 0 ? t('elearning.overdue') : `${daysLeft} ${t('elearning.days_remaining')}`}</span>}
                    </div>
                  )}
                  {course.annualReminder && (
                    <div className="elearning-card-annual-badge">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 22c1.1 0 2-.9 2-2h-4a2 2 0 0 0 2 2z"/><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/></svg>
                      {t('elearning.annual_renewal_note')}
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
                    {status === 'renewal-due' ? (
                      <button className="elearning-action-btn elearning-action-renewal" onClick={e => { e.stopPropagation(); renewCourse(course.id) }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
                        {t('elearning.renew_now')}
                      </button>
                    ) : status === 'completed' ? (
                      <button className="elearning-action-btn elearning-action-review" onClick={e => { e.stopPropagation(); openCourse(course) }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
                        {t('elearning.review')}
                      </button>
                    ) : status === 'in-progress' ? (
                      <>
                        <button className="elearning-action-btn elearning-action-start" onClick={e => { e.stopPropagation(); openCourse(course) }}>
                          {t('elearning.continue_learning')}
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                        </button>
                        <button className="elearning-action-btn elearning-action-continue" onClick={e => { e.stopPropagation(); completeCourse(course.id) }}>
                          {t('elearning.mark_complete')}
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                        </button>
                      </>
                    ) : (
                      <button className="elearning-action-btn elearning-action-start" onClick={e => { e.stopPropagation(); openCourse(course) }}>
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
