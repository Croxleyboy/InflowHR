import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { useAuth } from '../../context/AuthContext'
import { useFeatures } from '../../context/FeatureContext'
import { useToast } from '../../context/ToastContext'
import type { CourseType } from '../ELearning'

function toEmbedUrl(url: string): string {
  if (!url) return ''
  try {
    const u = new URL(url)
    if (u.hostname === 'www.youtube.com' || u.hostname === 'youtube.com') {
      const v = u.searchParams.get('v')
      if (v) return `https://www.youtube.com/embed/${v}`
    }
    if (u.hostname === 'youtu.be') return `https://www.youtube.com/embed${u.pathname}`
    if (u.hostname === 'vimeo.com' && /^\/\d+/.test(u.pathname)) return `https://player.vimeo.com/video${u.pathname}`
  } catch {}
  return url
}

function isVideoEmbeddable(url: string): boolean {
  try {
    const u = new URL(url)
    return ['www.youtube.com', 'youtube.com', 'youtu.be', 'vimeo.com'].includes(u.hostname)
  } catch { return false }
}

interface DbCourse {
  id: string
  title: string
  description: string
  category: string
  type: CourseType
  duration: string
  required: boolean
  deadline: string | null
  days_to_complete: number | null
  tags: string[]
  annual_reminder: boolean
  industry: string | null
  external_url: string | null
  is_active: boolean
  company_id: string | null
}

interface VisibilityRow {
  course_id: string
  company_id: string
  is_enabled: boolean
  target_departments: string[]
}

interface CompanyRow { id: string; name: string }

const TYPE_ICONS: Record<CourseType, string> = {
  video: '🎬', article: '📄', quiz: '❓', policy: '🛡️',
}

const CATEGORY_LABELS: Record<string, string> = {
  onboarding: 'Onboarding',
  compliance: 'Compliance',
  policies: 'Policies',
  role: 'My Role',
  development: 'Growth',
  wellbeing: 'Wellbeing',
}

const INDUSTRY_LABELS: Record<string, string> = {
  '': 'All Industries',
  legal: 'Legal',
  education: 'Education',
  accountancy: 'Accountancy',
}

const PAGE_SIZE = 30

const CATEGORIES = ['onboarding', 'compliance', 'policies', 'role', 'development', 'wellbeing']
const TYPES: CourseType[] = ['video', 'article', 'quiz', 'policy']
const INDUSTRIES = ['', 'legal', 'education', 'accountancy']

const EMPTY_COURSE: DbCourse = {
  id: '', title: '', description: '', category: 'onboarding', type: 'article',
  duration: '10 min', required: false, deadline: null, days_to_complete: null, tags: [],
  annual_reminder: false, industry: null, external_url: null, is_active: true, company_id: null,
}

type TabKey = 'courses' | 'visibility' | 'company_courses' | 'library' | 'analytics' | 'new_starter'

export default function AdminELearning() {
  const { selectedCompanyId } = useAdminCompany()
  const { isSuperAdmin } = useAuth()
  const { companyFeatures, loadCompanyFeatures } = useFeatures()
  const { showError, showSuccess } = useToast()
  const [tab, setTab] = useState<TabKey>(isSuperAdmin ? 'courses' : 'library')
  const [elEnabled, setElEnabled] = useState(true)
  const [toggling, setToggling] = useState(false)

  useEffect(() => {
    if (!selectedCompanyId) return
    ;(async () => {
      const { data } = await supabase.from('company_features')
        .select('is_enabled, is_visible')
        .eq('company_id', selectedCompanyId)
        .eq('feature_key', 'elearning')
        .maybeSingle()
      setElEnabled(data ? (isSuperAdmin ? data.is_enabled : data.is_enabled && data.is_visible) : false)
    })()
  }, [selectedCompanyId, isSuperAdmin])

  async function toggleELearning() {
    if (!selectedCompanyId || toggling) return
    setToggling(true)
    const newVal = !elEnabled
    if (isSuperAdmin) {
      const updateFields: Record<string, boolean> = { is_enabled: newVal }
      if (!newVal) updateFields.is_visible = false
      await supabase.from('company_features')
        .update(updateFields)
        .eq('company_id', selectedCompanyId)
        .eq('feature_key', 'elearning')
    } else {
      await supabase.from('company_features')
        .update({ is_visible: newVal })
        .eq('company_id', selectedCompanyId)
        .eq('feature_key', 'elearning')
    }
    setElEnabled(newVal)
    if (companyFeatures) await loadCompanyFeatures(selectedCompanyId)
    setToggling(false)
    showSuccess(`E-Learning ${newVal ? 'enabled' : 'disabled'}`)
  }

  const tabs: { key: TabKey; label: string; show: boolean }[] = isSuperAdmin
    ? [
        { key: 'courses', label: 'Core Courses', show: true },
        { key: 'visibility', label: 'Company Visibility', show: true },
        { key: 'new_starter', label: 'New Starter Course', show: !!selectedCompanyId },
      ]
    : [
        { key: 'library', label: 'Course Library', show: true },
        { key: 'company_courses', label: 'Company Courses', show: true },
        { key: 'new_starter', label: 'New Starter Course', show: true },
        { key: 'analytics', label: 'Analytics', show: true },
      ]

  return (
    <div className="admin-section">
      <div className="admin-page-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2>E-Learning Content Management</h2>
            <p>
              {isSuperAdmin
                ? 'Manage core courses and company visibility'
                : 'Manage your company courses and configure the course library'}
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted, #8b8fa3)' }}>
              E-Learning {elEnabled ? 'On' : 'Off'}
            </span>
            <button
              className={`ts-toggle ${elEnabled ? 'ts-toggle-on' : ''}`}
              onClick={toggleELearning}
              disabled={toggling}
              aria-label="Toggle e-learning"
            >
              <span className="ts-toggle-knob" />
            </button>
          </div>
        </div>
      </div>

      <div className="admin-tabs">
        {tabs.filter(t => t.show).map(t => (
          <button
            key={t.key}
            className={`admin-tab ${tab === t.key ? 'admin-tab-active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'courses' && isSuperAdmin && (
        <CoreCourseManagementTab showError={showError} showSuccess={showSuccess} />
      )}
      {tab === 'visibility' && isSuperAdmin && (
        <SuperAdminVisibilityTab />
      )}
      {tab === 'library' && !isSuperAdmin && (
        <CompanyLibraryTab companyId={selectedCompanyId} />
      )}
      {tab === 'company_courses' && !isSuperAdmin && (
        <CompanyCourseTab companyId={selectedCompanyId} showError={showError} showSuccess={showSuccess} />
      )}
      {tab === 'new_starter' && selectedCompanyId && (
        <NewStarterCourseTab companyId={selectedCompanyId} showError={showError} showSuccess={showSuccess} />
      )}
      {tab === 'analytics' && !isSuperAdmin && (
        <AnalyticsTab companyId={selectedCompanyId} />
      )}
    </div>
  )
}

/* ────── Helper: load company departments ────── */

async function loadDepartments(companyId: string): Promise<string[]> {
  const { data } = await supabase
    .from('employees')
    .select('department')
    .eq('company_id', companyId)
    .eq('is_active', true)
  if (!data) return []
  const depts = [...new Set(data.map((e: any) => e.department).filter(Boolean))] as string[]
  return depts.sort()
}

/* ────── Company Library Tab (Company Admins) ────── */

function CompanyLibraryTab({ companyId }: { companyId: string }) {
  const [courses, setCourses] = useState<DbCourse[]>([])
  const [visMap, setVisMap] = useState<Record<string, VisibilityRow>>({})
  const [departments, setDepartments] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterIndustry, setFilterIndustry] = useState('')
  const [deptDropdownOpen, setDeptDropdownOpen] = useState<string | null>(null)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [page, setPage] = useState(1)

  const fetchData = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    const [coursesRes, visRes, depts] = await Promise.all([
      supabase.from('elearning_courses').select('*').eq('is_active', true).order('category').order('title'),
      supabase.from('company_elearning_courses').select('course_id, company_id, is_enabled, target_departments').eq('company_id', companyId),
      loadDepartments(companyId),
    ])
    const allCourses = (coursesRes.data as DbCourse[]) || []
    setCourses(allCourses.filter(c => c.company_id === null || c.company_id === companyId))
    const vm: Record<string, VisibilityRow> = {}
    for (const row of (visRes.data || []) as VisibilityRow[]) {
      vm[row.course_id] = row
    }
    setVisMap(vm)
    setDepartments(depts)
    setLoading(false)
  }, [companyId])

  useEffect(() => { fetchData() }, [fetchData])

  async function toggleCourse(courseId: string) {
    if (!companyId) return
    setSaving(courseId)
    const current = visMap[courseId]
    const newEnabled = !(current?.is_enabled)
    await supabase.from('company_elearning_courses').upsert(
      { company_id: companyId, course_id: courseId, is_enabled: newEnabled, target_departments: current?.target_departments || [] },
      { onConflict: 'company_id,course_id' }
    )
    setVisMap(prev => ({
      ...prev,
      [courseId]: { course_id: courseId, company_id: companyId, is_enabled: newEnabled, target_departments: current?.target_departments || [] },
    }))
    setSaving(null)
  }

  async function toggleDepartment(courseId: string, dept: string) {
    if (!companyId) return
    const current = visMap[courseId]
    const currentDepts = current?.target_departments || []
    const newDepts = currentDepts.includes(dept)
      ? currentDepts.filter(d => d !== dept)
      : [...currentDepts, dept]
    await supabase.from('company_elearning_courses').upsert(
      { company_id: companyId, course_id: courseId, is_enabled: current?.is_enabled ?? true, target_departments: newDepts },
      { onConflict: 'company_id,course_id' }
    )
    setVisMap(prev => ({
      ...prev,
      [courseId]: { course_id: courseId, company_id: companyId, is_enabled: current?.is_enabled ?? true, target_departments: newDepts },
    }))
  }

  async function bulkToggle(enable: boolean) {
    if (!companyId) return
    setSaving('__all__')
    const rows = filtered.map(c => ({
      company_id: companyId, course_id: c.id, is_enabled: enable,
      target_departments: visMap[c.id]?.target_departments || [],
    }))
    await supabase.from('company_elearning_courses').upsert(rows, { onConflict: 'company_id,course_id' })
    setVisMap(prev => {
      const next = { ...prev }
      filtered.forEach(c => {
        next[c.id] = { course_id: c.id, company_id: companyId, is_enabled: enable, target_departments: prev[c.id]?.target_departments || [] }
      })
      return next
    })
    setSaving(null)
  }

  const filtered = useMemo(() => courses.filter(c => {
    if (search && !c.title.toLowerCase().includes(search.toLowerCase()) && !c.id.toLowerCase().includes(search.toLowerCase())) return false
    if (filterCategory && c.category !== filterCategory) return false
    if (filterIndustry && (c.industry || '') !== filterIndustry) return false
    return true
  }), [courses, search, filterCategory, filterIndustry])

  useEffect(() => { setPage(1) }, [search, filterCategory, filterIndustry])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const enabledCount = filtered.filter(c => visMap[c.id]?.is_enabled).length
  const categories = [...new Set(courses.map(c => c.category))]
  const industries = [...new Set(courses.filter(c => c.industry).map(c => c.industry!))]

  if (loading) return <div className="admin-loading">Loading...</div>

  return (
    <>
      <p style={{ margin: '0 0 4px', fontSize: 13, color: 'var(--text-muted, #8b8fa3)' }}>
        Enable or disable courses for your employees. Use department targeting to assign courses to specific teams.
      </p>
      <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-muted, #8b8fa3)' }}>
        {enabledCount}/{filtered.length} enabled
      </p>
      <div className="admin-filters">
        <input placeholder="Search courses..." value={search} onChange={e => setSearch(e.target.value)} className="admin-input admin-search" />
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className="admin-select">
          <option value="">All Categories</option>
          {categories.map(cat => <option key={cat} value={cat}>{CATEGORY_LABELS[cat] || cat}</option>)}
        </select>
        <select value={filterIndustry} onChange={e => setFilterIndustry(e.target.value)} className="admin-select">
          <option value="">All Industries</option>
          {industries.map(ind => <option key={ind} value={ind}>{INDUSTRY_LABELS[ind] || ind}</option>)}
        </select>
        <button className="admin-btn admin-btn-primary" onClick={() => bulkToggle(true)} disabled={saving === '__all__'}>Enable All</button>
        <button className="admin-btn admin-btn-secondary" onClick={() => bulkToggle(false)} disabled={saving === '__all__'}>Disable All</button>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table admin-el-table">
          <thead>
            <tr>
              <th>Enabled</th><th>Type</th><th>Course</th>
              <th className="admin-el-hide-mobile">Category</th>
              <th className="admin-el-hide-mobile">Industry</th>
              <th className="admin-el-hide-mobile">Duration</th>
              <th className="admin-el-hide-tablet">Required</th>
              {departments.length > 0 && <th>Departments</th>}
              <th>Preview</th>
            </tr>
          </thead>
          <tbody>
            {paginated.map(course => {
              const vis = visMap[course.id]
              const enabled = vis?.is_enabled ?? false
              const targetDepts = vis?.target_departments || []
              const isPreviewing = previewId === course.id
              return (
                <>
                  <tr key={course.id} className={!enabled ? 'admin-row-inactive' : ''}>
                    <td>
                      <label className="admin-toggle-switch">
                        <input type="checkbox" checked={enabled} onChange={() => toggleCourse(course.id)} disabled={saving === course.id} />
                        <span className="admin-toggle-slider" />
                      </label>
                    </td>
                    <td><span className="admin-type-icon">{TYPE_ICONS[course.type]}</span> {course.type}</td>
                    <td className="admin-el-title-cell">
                      <div>
                        <strong>{course.title}</strong><br />
                        <span className="admin-td-desc">{course.description.substring(0, 60)}{course.description.length > 60 ? '...' : ''}</span>
                      </div>
                    </td>
                    <td className="admin-el-hide-mobile"><span className="admin-tag-mini">{CATEGORY_LABELS[course.category] || course.category}</span></td>
                    <td className="admin-el-hide-mobile">
                      {course.industry ? <span className="admin-tag-mini">{INDUSTRY_LABELS[course.industry] || course.industry}</span> : <span style={{ opacity: 0.4 }}>—</span>}
                    </td>
                    <td className="admin-el-hide-mobile">{course.duration}</td>
                    <td className="admin-el-hide-tablet">{course.required ? '✓' : '—'}</td>
                    {departments.length > 0 && (
                      <td style={{ position: 'relative' }}>
                        <button
                          className="admin-btn-sm"
                          style={{ fontSize: 12, minWidth: 80 }}
                          onClick={() => setDeptDropdownOpen(deptDropdownOpen === course.id ? null : course.id)}
                          disabled={!enabled}
                        >
                          {targetDepts.length === 0 ? 'All' : `${targetDepts.length} dept${targetDepts.length !== 1 ? 's' : ''}`} ▾
                        </button>
                        {deptDropdownOpen === course.id && (
                          <DepartmentDropdown
                            courseId={course.id}
                            departments={departments}
                            selectedDepartments={targetDepts}
                            onToggle={toggleDepartment}
                            onClose={() => setDeptDropdownOpen(null)}
                          />
                        )}
                      </td>
                    )}
                    <td>
                      <button
                        className="admin-btn-icon"
                        title={isPreviewing ? 'Close preview' : 'Preview course'}
                        onClick={() => setPreviewId(isPreviewing ? null : course.id)}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={isPreviewing ? '#5c6bc0' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          {isPreviewing
                            ? <><polyline points="18 15 12 9 6 15"/></>
                            : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>
                          }
                        </svg>
                      </button>
                    </td>
                  </tr>
                  {isPreviewing && (
                    <tr key={`preview-${course.id}`} className="admin-expanded-row">
                      <td colSpan={departments.length > 0 ? 9 : 8}>
                        <CoursePreviewPanel
                          course={course}
                          enabled={enabled}
                          targetDepts={targetDepts}
                          departments={departments}
                          onToggleEnable={() => toggleCourse(course.id)}
                          onToggleDept={(dept) => toggleDepartment(course.id, dept)}
                          saving={saving === course.id}
                        />
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="admin-empty">No courses match your filters</div>}
      </div>
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 12 }}>
          <button className="admin-action-btn" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</button>
          <span style={{ fontSize: 13 }}>Page {page} of {totalPages}</span>
          <button className="admin-action-btn" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</button>
        </div>
      )}
    </>
  )
}

/* ────── Company Courses Tab (Company Admins) ────── */

function CompanyCourseTab({ companyId, showError, showSuccess }: { companyId: string; showError: (m: string) => void; showSuccess: (m: string) => void }) {
  const [courses, setCourses] = useState<DbCourse[]>([])
  const [departments, setDepartments] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<DbCourse>({ ...EMPTY_COURSE })
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState<DbCourse>({ ...EMPTY_COURSE })
  const [addDepts, setAddDepts] = useState<string[]>([])
  const [editDepts, setEditDepts] = useState<string[]>([])
  const [page, setPage] = useState(1)

  const loadAll = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    const [coursesRes, depts] = await Promise.all([
      supabase.from('elearning_courses').select('*').eq('company_id', companyId).order('category').order('title'),
      loadDepartments(companyId),
    ])
    setCourses((coursesRes.data as DbCourse[]) || [])
    setDepartments(depts)
    setLoading(false)
  }, [companyId])

  useEffect(() => { loadAll() }, [loadAll])

  const filtered = useMemo(() => courses.filter(c => {
    if (search && !c.title.toLowerCase().includes(search.toLowerCase())) return false
    if (filterCategory && c.category !== filterCategory) return false
    return true
  }), [courses, search, filterCategory])

  useEffect(() => { setPage(1) }, [search, filterCategory])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function generateId(title: string): string {
    return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 40) || 'new-course'
  }

  async function saveCourse() {
    const form = addForm
    const id = form.id.trim() || `${companyId.substring(0, 8)}-${generateId(form.title)}`
    if (!form.title.trim()) { showError('Title is required'); return }
    if (courses.some(c => c.id === id)) { showError('A course with this ID already exists'); return }
    const { error } = await supabase.from('elearning_courses').insert({
      id, title: form.title.trim(), description: form.description.trim(),
      category: form.category, type: form.type, duration: form.duration,
      required: form.required, deadline: form.deadline || null,
      days_to_complete: form.days_to_complete || null, tags: form.tags,
      annual_reminder: form.annual_reminder, industry: form.industry || null,
      external_url: form.external_url || null, is_active: form.is_active,
      company_id: companyId,
    })
    if (error) { showError('Failed to create course: ' + error.message); return }
    await supabase.from('company_elearning_courses').upsert(
      { company_id: companyId, course_id: id, is_enabled: true, target_departments: addDepts },
      { onConflict: 'company_id,course_id' }
    )
    showSuccess('Course created')
    setAddForm({ ...EMPTY_COURSE })
    setAddDepts([])
    setShowAdd(false)
    loadAll()
  }

  async function updateCourse() {
    if (!editingId) return
    const form = editForm
    if (!form.title.trim()) { showError('Title is required'); return }
    const { error } = await supabase.from('elearning_courses').update({
      title: form.title.trim(), description: form.description.trim(),
      category: form.category, type: form.type, duration: form.duration,
      required: form.required, deadline: form.deadline || null,
      days_to_complete: form.days_to_complete || null, tags: form.tags,
      annual_reminder: form.annual_reminder, industry: form.industry || null,
      external_url: form.external_url || null, is_active: form.is_active,
    }).eq('id', editingId)
    if (error) { showError('Failed to update course: ' + error.message); return }
    if (editDepts.length > 0 || true) {
      await supabase.from('company_elearning_courses').upsert(
        { company_id: companyId, course_id: editingId, is_enabled: true, target_departments: editDepts },
        { onConflict: 'company_id,course_id' }
      )
    }
    showSuccess('Course updated')
    setEditingId(null)
    loadAll()
  }

  async function deleteCourse(id: string) {
    if (!confirm('Delete this course? It will be removed from all employee views.')) return
    await supabase.from('company_elearning_courses').delete().eq('course_id', id).eq('company_id', companyId)
    const { error } = await supabase.from('elearning_courses').delete().eq('id', id)
    if (error) { showError('Failed to delete course: ' + error.message); return }
    showSuccess('Course deleted')
    loadAll()
  }

  async function startEdit(c: DbCourse) {
    setEditingId(c.id)
    setEditForm({ ...c })
    setShowAdd(false)
    const { data } = await supabase.from('company_elearning_courses')
      .select('target_departments')
      .eq('company_id', companyId)
      .eq('course_id', c.id)
      .maybeSingle()
    setEditDepts((data as any)?.target_departments || [])
  }

  const categories = [...new Set(courses.map(c => c.category))]

  if (loading) return <div className="admin-loading">Loading...</div>

  return (
    <>
      <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-muted, #8b8fa3)' }}>
        Create and manage courses specific to your company. These are only visible to your employees.
      </p>

      <div className="admin-mini-stats">
        <div className="admin-mini-stat"><span className="admin-mini-value">{courses.length}</span><span>Total</span></div>
        <div className="admin-mini-stat"><span className="admin-mini-value" style={{ color: '#43a047' }}>{courses.filter(c => c.is_active).length}</span><span>Active</span></div>
        <div className="admin-mini-stat"><span className="admin-mini-value" style={{ color: '#e53935' }}>{courses.filter(c => !c.is_active).length}</span><span>Inactive</span></div>
      </div>

      <div className="admin-filters">
        <input placeholder="Search courses..." value={search} onChange={e => setSearch(e.target.value)} className="admin-input admin-search" style={{ minWidth: 180 }} />
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className="admin-select">
          <option value="">All Categories</option>
          {categories.map(cat => <option key={cat} value={cat}>{CATEGORY_LABELS[cat] || cat}</option>)}
        </select>
        <button className="admin-btn-sm admin-btn-save" onClick={() => { setShowAdd(!showAdd); setEditingId(null) }}>
          {showAdd ? 'Cancel' : '+ New Course'}
        </button>
      </div>

      {showAdd && (
        <div className="admin-el-editor" style={{ marginBottom: 20 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>Create Company Course</h3>
          <CourseForm form={addForm} setForm={setAddForm as any} />
          {departments.length > 0 && (
            <DepartmentPicker departments={departments} selected={addDepts} onChange={setAddDepts} />
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="admin-btn-sm admin-btn-save" onClick={saveCourse}>Create Course</button>
            <button className="admin-btn-sm admin-btn-cancel" onClick={() => setShowAdd(false)}>Cancel</button>
          </div>
        </div>
      )}

      {editingId && (
        <div className="admin-el-editor" style={{ marginBottom: 20 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>Edit Course: {editForm.title}</h3>
          <CourseForm form={editForm} setForm={setEditForm as any} isEdit />
          {departments.length > 0 && (
            <DepartmentPicker departments={departments} selected={editDepts} onChange={setEditDepts} />
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="admin-btn-sm admin-btn-save" onClick={updateCourse}>Save Changes</button>
            <button className="admin-btn-sm admin-btn-cancel" onClick={() => setEditingId(null)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="admin-table-wrap">
        <table className="admin-table admin-el-table">
          <thead>
            <tr>
              <th>Status</th><th>Type</th><th>Course</th>
              <th className="admin-el-hide-mobile">Category</th>
              <th className="admin-el-hide-mobile">Duration</th>
              <th className="admin-el-hide-tablet">Required</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {paginated.map(course => (
              <tr key={course.id} className={!course.is_active ? 'admin-row-inactive' : ''}>
                <td>
                  <span className={`admin-badge ${course.is_active ? 'admin-badge-approved' : 'admin-badge-rejected'}`}>
                    {course.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td><span className="admin-type-icon">{TYPE_ICONS[course.type]}</span> {course.type}</td>
                <td className="admin-el-title-cell">
                  <div>
                    <strong>{course.title}</strong><br />
                    <span className="admin-td-desc">{course.description.substring(0, 60)}{course.description.length > 60 ? '...' : ''}</span>
                  </div>
                </td>
                <td className="admin-el-hide-mobile"><span className="admin-tag-mini">{CATEGORY_LABELS[course.category] || course.category}</span></td>
                <td className="admin-el-hide-mobile">{course.duration}</td>
                <td className="admin-el-hide-tablet">{course.required ? '✓' : '—'}</td>
                <td className="admin-actions">
                  <button className="admin-btn-icon" title="Edit" onClick={() => startEdit(course)}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  </button>
                  <button className="admin-btn-icon admin-btn-danger" title="Delete" onClick={() => deleteCourse(course.id)}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="admin-empty">No company courses yet. Create one above.</div>}
      </div>
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 12 }}>
          <button className="admin-action-btn" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</button>
          <span style={{ fontSize: 13 }}>Page {page} of {totalPages}</span>
          <button className="admin-action-btn" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</button>
        </div>
      )}
    </>
  )
}

/* ────── Super Admin: Core Course Management Tab ────── */

function CoreCourseManagementTab({ showError, showSuccess }: { showError: (m: string) => void; showSuccess: (m: string) => void }) {
  const [courses, setCourses] = useState<DbCourse[]>([])
  const [companies, setCompanies] = useState<CompanyRow[]>([])
  const [visibilityMap, setVisibilityMap] = useState<Record<string, Set<string>>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<DbCourse>({ ...EMPTY_COURSE })
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState<DbCourse>({ ...EMPTY_COURSE })
  const [addCompanyIds, setAddCompanyIds] = useState<Set<string>>(new Set())
  const [visDropdownOpen, setVisDropdownOpen] = useState<string | null>(null)
  const [page, setPage] = useState(1)

  const loadAll = useCallback(async () => {
    setLoading(true)
    const [coursesRes, companiesRes, visRes] = await Promise.all([
      supabase.from('elearning_courses').select('*').is('company_id', null).order('category').order('title'),
      supabase.from('companies').select('id, name').eq('is_active', true).order('name'),
      supabase.from('company_elearning_courses').select('course_id, company_id, is_enabled'),
    ])
    setCourses((coursesRes.data as DbCourse[]) || [])
    setCompanies((companiesRes.data as CompanyRow[]) || [])
    const vm: Record<string, Set<string>> = {}
    for (const row of (visRes.data || []) as { course_id: string; company_id: string; is_enabled: boolean }[]) {
      if (row.is_enabled) {
        if (!vm[row.course_id]) vm[row.course_id] = new Set()
        vm[row.course_id].add(row.company_id)
      }
    }
    setVisibilityMap(vm)
    setLoading(false)
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  const filtered = useMemo(() => courses.filter(c => {
    if (search && !c.title.toLowerCase().includes(search.toLowerCase()) && !c.id.toLowerCase().includes(search.toLowerCase())) return false
    if (filterCategory && c.category !== filterCategory) return false
    return true
  }), [courses, search, filterCategory])

  useEffect(() => { setPage(1) }, [search, filterCategory])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function generateId(title: string): string {
    return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 40) || 'new-course'
  }

  async function saveCourse() {
    const form = addForm
    const id = form.id.trim() || generateId(form.title)
    if (!form.title.trim()) { showError('Title is required'); return }
    if (courses.some(c => c.id === id)) { showError('A course with this ID already exists'); return }
    const { error } = await supabase.from('elearning_courses').insert({
      id, title: form.title.trim(), description: form.description.trim(),
      category: form.category, type: form.type, duration: form.duration,
      required: form.required, deadline: form.deadline || null,
      days_to_complete: form.days_to_complete || null, tags: form.tags,
      annual_reminder: form.annual_reminder, industry: form.industry || null,
      external_url: form.external_url || null, is_active: form.is_active,
      company_id: null,
    })
    if (error) { showError('Failed to create course: ' + error.message); return }
    if (addCompanyIds.size > 0) {
      const rows = Array.from(addCompanyIds).map(cid => ({ company_id: cid, course_id: id, is_enabled: true }))
      await supabase.from('company_elearning_courses').upsert(rows, { onConflict: 'company_id,course_id' })
    }
    showSuccess('Core course created')
    setAddForm({ ...EMPTY_COURSE })
    setAddCompanyIds(new Set())
    setShowAdd(false)
    loadAll()
  }

  async function updateCourse() {
    if (!editingId) return
    const form = editForm
    if (!form.title.trim()) { showError('Title is required'); return }
    const { error } = await supabase.from('elearning_courses').update({
      title: form.title.trim(), description: form.description.trim(),
      category: form.category, type: form.type, duration: form.duration,
      required: form.required, deadline: form.deadline || null,
      days_to_complete: form.days_to_complete || null, tags: form.tags,
      annual_reminder: form.annual_reminder, industry: form.industry || null,
      external_url: form.external_url || null, is_active: form.is_active,
    }).eq('id', editingId)
    if (error) { showError('Failed to update course: ' + error.message); return }
    showSuccess('Course updated')
    setEditingId(null)
    loadAll()
  }

  async function deleteCourse(id: string) {
    if (!confirm('Delete this core course? It will be removed from all companies.')) return
    await supabase.from('company_elearning_courses').delete().eq('course_id', id)
    const { error } = await supabase.from('elearning_courses').delete().eq('id', id)
    if (error) { showError('Failed to delete course: ' + error.message); return }
    showSuccess('Course deleted')
    loadAll()
  }

  function startEdit(c: DbCourse) {
    setEditingId(c.id)
    setEditForm({ ...c })
    setShowAdd(false)
  }

  async function toggleCompanyVisibility(courseId: string, companyId: string) {
    const current = visibilityMap[courseId]?.has(companyId) || false
    await supabase.from('company_elearning_courses').upsert(
      { company_id: companyId, course_id: courseId, is_enabled: !current },
      { onConflict: 'company_id,course_id' }
    )
    setVisibilityMap(prev => {
      const next = { ...prev }
      if (!next[courseId]) next[courseId] = new Set()
      else next[courseId] = new Set(next[courseId])
      if (current) next[courseId].delete(companyId); else next[courseId].add(companyId)
      return next
    })
  }

  const categories = [...new Set(courses.map(c => c.category))]

  if (loading) return <div className="admin-loading">Loading...</div>

  return (
    <>
      <div className="admin-mini-stats">
        <div className="admin-mini-stat"><span className="admin-mini-value">{courses.length}</span><span>Total</span></div>
        <div className="admin-mini-stat"><span className="admin-mini-value" style={{ color: '#43a047' }}>{courses.filter(c => c.is_active).length}</span><span>Active</span></div>
        <div className="admin-mini-stat"><span className="admin-mini-value" style={{ color: '#e53935' }}>{courses.filter(c => !c.is_active).length}</span><span>Inactive</span></div>
      </div>

      <div className="admin-filters">
        <input placeholder="Search courses..." value={search} onChange={e => setSearch(e.target.value)} className="admin-input admin-search" style={{ minWidth: 180 }} />
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className="admin-select">
          <option value="">All Categories</option>
          {categories.map(cat => <option key={cat} value={cat}>{CATEGORY_LABELS[cat] || cat}</option>)}
        </select>
        <button className="admin-btn-sm admin-btn-save" onClick={() => { setShowAdd(!showAdd); setEditingId(null) }}>
          {showAdd ? 'Cancel' : '+ New Core Course'}
        </button>
      </div>

      {showAdd && (
        <div className="admin-el-editor" style={{ marginBottom: 20 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>Create Core Course</h3>
          <CourseForm form={addForm} setForm={setAddForm as any} companies={companies} selectedCompanyIds={addCompanyIds} onCompanyToggle={(cid) => setAddCompanyIds(prev => { const next = new Set(prev); if (next.has(cid)) next.delete(cid); else next.add(cid); return next })} />
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="admin-btn-sm admin-btn-save" onClick={saveCourse}>Create Course</button>
            <button className="admin-btn-sm admin-btn-cancel" onClick={() => setShowAdd(false)}>Cancel</button>
          </div>
        </div>
      )}

      {editingId && (
        <div className="admin-el-editor" style={{ marginBottom: 20 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>Edit Course: {editForm.title}</h3>
          <CourseForm form={editForm} setForm={setEditForm as any} isEdit />
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="admin-btn-sm admin-btn-save" onClick={updateCourse}>Save Changes</button>
            <button className="admin-btn-sm admin-btn-cancel" onClick={() => setEditingId(null)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="admin-table-wrap">
        <table className="admin-table admin-el-table">
          <thead>
            <tr>
              <th>Status</th><th>Type</th><th>Course</th>
              <th className="admin-el-hide-mobile">Category</th>
              <th className="admin-el-hide-mobile">Industry</th>
              <th className="admin-el-hide-mobile">Duration</th>
              <th className="admin-el-hide-tablet">Required</th>
              <th>Companies</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {paginated.map(course => {
              const visCount = visibilityMap[course.id]?.size || 0
              return (
                <tr key={course.id} className={!course.is_active ? 'admin-row-inactive' : ''}>
                  <td>
                    <span className={`admin-badge ${course.is_active ? 'admin-badge-approved' : 'admin-badge-rejected'}`}>
                      {course.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td><span className="admin-type-icon">{TYPE_ICONS[course.type]}</span> {course.type}</td>
                  <td className="admin-el-title-cell">
                    <div>
                      <strong>{course.title}</strong><br />
                      <span className="admin-td-desc">{course.description.substring(0, 60)}{course.description.length > 60 ? '...' : ''}</span>
                    </div>
                  </td>
                  <td className="admin-el-hide-mobile"><span className="admin-tag-mini">{CATEGORY_LABELS[course.category] || course.category}</span></td>
                  <td className="admin-el-hide-mobile">
                    {course.industry ? <span className="admin-tag-mini">{INDUSTRY_LABELS[course.industry] || course.industry}</span> : <span style={{ opacity: 0.4 }}>—</span>}
                  </td>
                  <td className="admin-el-hide-mobile">{course.duration}</td>
                  <td className="admin-el-hide-tablet">{course.required ? '✓' : '—'}</td>
                  <td style={{ position: 'relative' }}>
                    <button
                      className="admin-btn-sm"
                      style={{ fontSize: 12, minWidth: 80 }}
                      onClick={() => setVisDropdownOpen(visDropdownOpen === course.id ? null : course.id)}
                    >
                      {visCount}/{companies.length} ▾
                    </button>
                    {visDropdownOpen === course.id && (
                      <CompanyVisibilityDropdown
                        courseId={course.id}
                        companies={companies}
                        enabledCompanyIds={visibilityMap[course.id] || new Set()}
                        onToggle={toggleCompanyVisibility}
                        onClose={() => setVisDropdownOpen(null)}
                      />
                    )}
                  </td>
                  <td className="admin-actions">
                    <button className="admin-btn-icon" title="Edit" onClick={() => startEdit(course)}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button className="admin-btn-icon admin-btn-danger" title="Delete" onClick={() => deleteCourse(course.id)}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="admin-empty">No courses match your filters</div>}
      </div>
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 12 }}>
          <button className="admin-action-btn" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</button>
          <span style={{ fontSize: 13 }}>Page {page} of {totalPages}</span>
          <button className="admin-action-btn" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</button>
        </div>
      )}
    </>
  )
}

/* ────── Super Admin: Company Visibility Tab ────── */

function SuperAdminVisibilityTab() {
  const [courses, setCourses] = useState<DbCourse[]>([])
  const [companies, setCompanies] = useState<CompanyRow[]>([])
  const [visibilityMap, setVisibilityMap] = useState<Record<string, Set<string>>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterCompany, setFilterCompany] = useState('')
  const [page, setPage] = useState(1)

  const loadAll = useCallback(async () => {
    setLoading(true)
    const [coursesRes, companiesRes, visRes] = await Promise.all([
      supabase.from('elearning_courses').select('*').order('category').order('title'),
      supabase.from('companies').select('id, name').eq('is_active', true).order('name'),
      supabase.from('company_elearning_courses').select('course_id, company_id, is_enabled'),
    ])
    setCourses((coursesRes.data as DbCourse[]) || [])
    setCompanies((companiesRes.data as CompanyRow[]) || [])
    const vm: Record<string, Set<string>> = {}
    for (const row of (visRes.data || []) as { course_id: string; company_id: string; is_enabled: boolean }[]) {
      if (row.is_enabled) {
        if (!vm[row.course_id]) vm[row.course_id] = new Set()
        vm[row.course_id].add(row.company_id)
      }
    }
    setVisibilityMap(vm)
    setLoading(false)
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  async function toggleCompanyVisibility(courseId: string, companyId: string) {
    const current = visibilityMap[courseId]?.has(companyId) || false
    await supabase.from('company_elearning_courses').upsert(
      { company_id: companyId, course_id: courseId, is_enabled: !current },
      { onConflict: 'company_id,course_id' }
    )
    setVisibilityMap(prev => {
      const next = { ...prev }
      if (!next[courseId]) next[courseId] = new Set()
      else next[courseId] = new Set(next[courseId])
      if (current) next[courseId].delete(companyId); else next[courseId].add(companyId)
      return next
    })
  }

  const filtered = useMemo(() => courses.filter(c => {
    if (search && !c.title.toLowerCase().includes(search.toLowerCase())) return false
    if (filterCategory && c.category !== filterCategory) return false
    if (filterCompany) {
      const vis = visibilityMap[c.id]
      if (!vis?.has(filterCompany)) return false
    }
    return true
  }), [courses, search, filterCategory, filterCompany, visibilityMap])

  useEffect(() => { setPage(1) }, [search, filterCategory, filterCompany])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const categories = [...new Set(courses.map(c => c.category))]

  if (loading) return <div className="admin-loading">Loading...</div>

  return (
    <>
      <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-muted, #8b8fa3)' }}>
        Manage which companies can see each course. Core and company-specific courses are listed.
      </p>
      <div className="admin-filters">
        <input placeholder="Search courses..." value={search} onChange={e => setSearch(e.target.value)} className="admin-input admin-search" />
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className="admin-select">
          <option value="">All Categories</option>
          {categories.map(cat => <option key={cat} value={cat}>{CATEGORY_LABELS[cat] || cat}</option>)}
        </select>
        <select value={filterCompany} onChange={e => setFilterCompany(e.target.value)} className="admin-select">
          <option value="">All Companies</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table admin-el-table">
          <thead>
            <tr>
              <th>Course</th>
              <th className="admin-el-hide-mobile">Source</th>
              {companies.map(c => <th key={c.id} style={{ fontSize: 11, maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis' }} title={c.name}>{c.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {paginated.map(course => (
              <tr key={course.id}>
                <td className="admin-el-title-cell">
                  <div>
                    <strong>{course.title}</strong><br />
                    <span className="admin-td-desc">{CATEGORY_LABELS[course.category] || course.category}</span>
                  </div>
                </td>
                <td className="admin-el-hide-mobile">
                  <span className="admin-tag-mini" style={{ background: course.company_id ? '#e3f2fd' : '#f3e5f5', color: course.company_id ? '#1565c0' : '#7b1fa2' }}>
                    {course.company_id ? 'Company' : 'Core'}
                  </span>
                </td>
                {companies.map(company => (
                  <td key={company.id} style={{ textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={visibilityMap[course.id]?.has(company.id) || false}
                      onChange={() => toggleCompanyVisibility(course.id, company.id)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="admin-empty">No courses match your filters</div>}
      </div>
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 12 }}>
          <button className="admin-action-btn" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</button>
          <span style={{ fontSize: 13 }}>Page {page} of {totalPages}</span>
          <button className="admin-action-btn" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</button>
        </div>
      )}
    </>
  )
}

/* ────── Analytics Tab (Company Admin) ────── */

interface EnrolmentRow {
  employee_id: string
  course_id: string
  status: string
  progress_pct: number
  started_at: string | null
  completed_at: string | null
  enrolled_at: string | null
  company_id: string
}

interface CompletionRow {
  employee_id: string
  course_id: string
  completed_at: string
}

/* ────── New Starter Course Config Tab (Company Admins) ────── */

function NewStarterCourseTab({ companyId, showError, showSuccess }: { companyId: string; showError: (m: string) => void; showSuccess: (m: string) => void }) {
  const [loading, setLoading] = useState(true)
  const [enabled, setEnabled] = useState(false)
  const [courseId, setCourseId] = useState<string | null>(null)
  const [courses, setCourses] = useState<DbCourse[]>([])
  const [saving, setSaving] = useState(false)
  const [enrolments, setEnrolments] = useState<any[]>([])

  const loadAll = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    const [compRes, coursesRes] = await Promise.all([
      supabase.from('companies').select('new_starter_elearning_enabled, new_starter_course_id').eq('id', companyId).single(),
      supabase.from('elearning_courses').select('id, title, type, category, days_to_complete, required, is_active').or(`company_id.eq.${companyId},company_id.is.null`).eq('is_active', true).order('title'),
    ])
    if (compRes.data) {
      setEnabled(!!compRes.data.new_starter_elearning_enabled)
      setCourseId(compRes.data.new_starter_course_id || null)
    }
    setCourses((coursesRes.data as any[]) || [])
    if (compRes.data?.new_starter_course_id) {
      const { data: enr } = await supabase.from('course_enrolments')
        .select('id, employee_id, status, progress_pct, enrolled_at, completed_at, employees(first_name, last_name)')
        .eq('company_id', companyId)
        .eq('course_id', compRes.data.new_starter_course_id)
        .order('enrolled_at', { ascending: false })
        .limit(50)
      setEnrolments(enr || [])
    } else {
      setEnrolments([])
    }
    setLoading(false)
  }, [companyId])

  useEffect(() => { loadAll() }, [loadAll])

  async function toggleEnabled() {
    if (saving) return
    setSaving(true)
    const newVal = !enabled
    const { error } = await supabase.from('companies').update({ new_starter_elearning_enabled: newVal }).eq('id', companyId)
    if (error) { showError('Failed to update setting'); setSaving(false); return }
    setEnabled(newVal)
    showSuccess(`New starter e-learning ${newVal ? 'enabled' : 'disabled'}`)
    setSaving(false)
  }

  async function saveCourse(newCourseId: string) {
    if (saving) return
    setSaving(true)
    const { error } = await supabase.from('companies').update({ new_starter_course_id: newCourseId || null }).eq('id', companyId)
    if (error) { showError('Failed to update course selection'); setSaving(false); return }
    setCourseId(newCourseId || null)
    showSuccess('New starter course updated')
    setSaving(false)
    loadAll()
  }

  async function createNewStarterCourse() {
    if (saving) return
    setSaving(true)
    const id = `${companyId.substring(0, 8)}-new-starter-induction`
    const existing = courses.find(c => c.id === id)
    if (existing) {
      await saveCourse(id)
      return
    }
    const { error } = await supabase.from('elearning_courses').insert({
      id, title: 'New Starter Induction Course', description: 'Company induction course for new employees. Complete within 7 days of your start date.',
      category: 'onboarding', type: 'article' as CourseType, duration: '30 min',
      required: true, days_to_complete: 7, tags: ['induction', 'new-starter'],
      annual_reminder: false, is_active: true, company_id: companyId,
    })
    if (error) { showError('Failed to create course: ' + error.message); setSaving(false); return }
    await supabase.from('company_elearning_courses').upsert(
      { company_id: companyId, course_id: id, is_enabled: true, target_departments: [] },
      { onConflict: 'company_id,course_id' }
    )
    await saveCourse(id)
  }

  if (loading) return <div className="admin-loading">Loading new starter course settings...</div>

  const selectedCourse = courses.find(c => c.id === courseId)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div className="admin-card" style={{ padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>New Starter E-Learning</h3>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted, #8b8fa3)' }}>
              Automatically assign an induction course to new employees during onboarding
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted, #8b8fa3)' }}>
              {enabled ? 'Enabled' : 'Disabled'}
            </span>
            <button
              className={`ts-toggle ${enabled ? 'ts-toggle-on' : ''}`}
              onClick={toggleEnabled}
              disabled={saving}
              aria-label="Toggle new starter e-learning"
            >
              <span className="ts-toggle-knob" />
            </button>
          </div>
        </div>

        {enabled && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <label style={{ fontSize: 13, fontWeight: 600, minWidth: 120 }}>Assigned Course</label>
              <select
                className="ts-input"
                style={{ flex: 1, minWidth: 200 }}
                value={courseId || ''}
                onChange={(e) => saveCourse(e.target.value)}
                disabled={saving}
              >
                <option value="">— Select a course —</option>
                {courses.map(c => (
                  <option key={c.id} value={c.id}>
                    {TYPE_ICONS[c.type as CourseType] || '📄'} {c.title} ({CATEGORY_LABELS[c.category] || c.category})
                  </option>
                ))}
              </select>
              <button className="ts-btn ts-btn-sm" style={{ background: 'var(--ts-color-primary, #4f46e5)', color: '#fff', border: 'none' }} onClick={createNewStarterCourse} disabled={saving} title="Create a pre-configured new starter induction course">
                + Create Default Course
              </button>
            </div>

            {selectedCourse && (
              <div style={{ background: 'var(--bg-card, #f8f9fb)', borderRadius: 8, padding: 16, border: '1px solid var(--border, #e2e4ea)' }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 28 }}>{TYPE_ICONS[selectedCourse.type as CourseType] || '📄'}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{selectedCourse.title}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted, #8b8fa3)', marginTop: 2 }}>
                      {CATEGORY_LABELS[selectedCourse.category] || selectedCourse.category} &middot; {selectedCourse.type}
                      {selectedCourse.days_to_complete ? ` · ${selectedCourse.days_to_complete} day deadline` : ''}
                      {selectedCourse.required ? ' · Required' : ''}
                    </div>
                  </div>
                </div>
                <p style={{ fontSize: 12, color: 'var(--text-muted, #8b8fa3)', margin: '12px 0 0' }}>
                  This course is automatically assigned to new starters on their configured start date during onboarding.
                  Employees have {selectedCourse.days_to_complete || 7} days to complete it. Progress appears on the employee&apos;s dashboard reminders.
                </p>
              </div>
            )}

            {!courseId && (
              <div style={{ background: '#fff8e1', borderRadius: 8, padding: 12, border: '1px solid #ffe082', fontSize: 13 }}>
                ⚠️ No course selected. The &quot;Assign New Starter E-Learning&quot; onboarding step will be marked as skippable until a course is configured.
              </div>
            )}
          </div>
        )}
      </div>

      {enabled && courseId && enrolments.length > 0 && (
        <div className="admin-card" style={{ padding: 24 }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600 }}>Recent Enrolments</h3>
          <div style={{ overflowX: 'auto' }}>
            <table className="ts-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Status</th>
                  <th>Progress</th>
                  <th>Enrolled</th>
                  <th>Completed</th>
                </tr>
              </thead>
              <tbody>
                {enrolments.map((e: any) => {
                  const emp = e.employees as any
                  const enrolled = e.enrolled_at ? new Date(e.enrolled_at) : null
                  const deadline = enrolled ? new Date(enrolled.getTime() + (selectedCourse?.days_to_complete || 7) * 86400000) : null
                  const overdue = deadline && !e.completed_at && new Date() > deadline
                  return (
                    <tr key={e.id}>
                      <td>{emp ? `${emp.first_name} ${emp.last_name}` : '—'}</td>
                      <td>
                        <span className={`ts-badge ${e.status === 'completed' ? 'ts-badge-success' : overdue ? 'ts-badge-danger' : e.status === 'in_progress' ? 'ts-badge-info' : 'ts-badge-muted'}`}>
                          {overdue ? 'Overdue' : e.status === 'not_started' ? 'Not Started' : e.status === 'in_progress' ? 'In Progress' : e.status === 'completed' ? 'Completed' : e.status}
                        </span>
                      </td>
                      <td>{e.progress_pct ?? 0}%</td>
                      <td>{enrolled ? enrolled.toLocaleDateString('en-GB') : '—'}</td>
                      <td>{e.completed_at ? new Date(e.completed_at).toLocaleDateString('en-GB') : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

/* ────── Analytics Tab (Company Admins) ────── */

interface EmployeeRow {
  id: string
  department: string | null
  first_name: string
  last_name: string
}

function AnalyticsTab({ companyId }: { companyId: string }) {
  const [loading, setLoading] = useState(true)
  const [courses, setCourses] = useState<DbCourse[]>([])
  const [enrolments, setEnrolments] = useState<EnrolmentRow[]>([])
  const [completions, setCompletions] = useState<CompletionRow[]>([])
  const [employees, setEmployees] = useState<EmployeeRow[]>([])

  const fetchData = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    const [coursesRes, enrolRes, complRes, empRes] = await Promise.all([
      supabase.from('elearning_courses').select('*').eq('is_active', true),
      supabase.from('course_enrolments').select('employee_id, course_id, status, progress_pct, started_at, completed_at, enrolled_at, company_id').eq('company_id', companyId),
      supabase.from('elearning_completions').select('employee_id, course_id, completed_at').eq('company_id', companyId),
      supabase.from('employees').select('id, department, first_name, last_name').eq('company_id', companyId).eq('is_active', true),
    ])
    setCourses(((coursesRes.data as DbCourse[]) || []).filter(c => c.company_id === null || c.company_id === companyId))
    setEnrolments((enrolRes.data as EnrolmentRow[]) || [])
    setCompletions((complRes.data as CompletionRow[]) || [])
    setEmployees((empRes.data as EmployeeRow[]) || [])
    setLoading(false)
  }, [companyId])

  useEffect(() => { fetchData() }, [fetchData])

  const stats = useMemo(() => {
    const totalEnrolments = enrolments.length
    const completed = enrolments.filter(e => e.status === 'completed').length
    const inProgress = enrolments.filter(e => e.status === 'in_progress').length
    const notStarted = enrolments.filter(e => e.status === 'not_started').length
    const completionRate = totalEnrolments > 0 ? Math.round((completed / totalEnrolments) * 100) : 0

    const courseCompletionMap: Record<string, { completed: number; total: number; title: string }> = {}
    for (const e of enrolments) {
      if (!courseCompletionMap[e.course_id]) {
        const course = courses.find(c => c.id === e.course_id)
        courseCompletionMap[e.course_id] = { completed: 0, total: 0, title: course?.title || e.course_id }
      }
      courseCompletionMap[e.course_id].total++
      if (e.status === 'completed') courseCompletionMap[e.course_id].completed++
    }

    const popularCourses = Object.entries(courseCompletionMap)
      .map(([id, d]) => ({ id, ...d, rate: d.total > 0 ? Math.round((d.completed / d.total) * 100) : 0 }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8)

    const lowCompletion = Object.entries(courseCompletionMap)
      .map(([id, d]) => ({ id, ...d, rate: d.total > 0 ? Math.round((d.completed / d.total) * 100) : 0 }))
      .filter(c => c.rate < 50 && c.total >= 2)
      .sort((a, b) => a.rate - b.rate)
      .slice(0, 6)

    const now = new Date()
    const atRisk: { courseTitle: string; employeeName: string; daysLeft: number; progress: number }[] = []
    for (const e of enrolments) {
      if (e.status === 'completed') continue
      const course = courses.find(c => c.id === e.course_id)
      if (!course?.days_to_complete || !e.enrolled_at) continue
      const enrollDate = new Date(e.enrolled_at)
      const deadlineDate = new Date(enrollDate.getTime() + course.days_to_complete * 86400000)
      const daysLeft = Math.ceil((deadlineDate.getTime() - now.getTime()) / 86400000)
      if (daysLeft <= 14) {
        const emp = employees.find(em => em.id === e.employee_id)
        atRisk.push({
          courseTitle: course.title,
          employeeName: emp ? `${emp.first_name} ${emp.last_name}` : 'Unknown',
          daysLeft,
          progress: e.progress_pct || 0,
        })
      }
    }
    atRisk.sort((a, b) => a.daysLeft - b.daysLeft)

    const deptMap: Record<string, { completed: number; total: number }> = {}
    for (const e of enrolments) {
      const emp = employees.find(em => em.id === e.employee_id)
      const dept = emp?.department || 'Unassigned'
      if (!deptMap[dept]) deptMap[dept] = { completed: 0, total: 0 }
      deptMap[dept].total++
      if (e.status === 'completed') deptMap[dept].completed++
    }
    const deptBreakdown = Object.entries(deptMap)
      .map(([dept, d]) => ({ dept, ...d, rate: d.total > 0 ? Math.round((d.completed / d.total) * 100) : 0 }))
      .sort((a, b) => b.rate - a.rate)

    const monthlyTrend: { month: string; count: number }[] = []
    const monthMap: Record<string, number> = {}
    for (const c of completions) {
      const d = new Date(c.completed_at)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      monthMap[key] = (monthMap[key] || 0) + 1
    }
    const sortedMonths = Object.keys(monthMap).sort()
    const recentMonths = sortedMonths.slice(-6)
    for (const m of recentMonths) {
      const [y, mo] = m.split('-')
      const label = new Date(parseInt(y), parseInt(mo) - 1).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })
      monthlyTrend.push({ month: label, count: monthMap[m] })
    }

    return { totalEnrolments, completed, inProgress, notStarted, completionRate, popularCourses, lowCompletion, atRisk, deptBreakdown, monthlyTrend }
  }, [enrolments, completions, courses, employees])

  if (loading) return <div className="admin-loading">Loading analytics...</div>

  if (enrolments.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted, #8b8fa3)' }}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ marginBottom: 12, opacity: 0.4 }}>
          <path d="M18 20V10M12 20V4M6 20v-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <p style={{ fontSize: 15, fontWeight: 600 }}>No enrolment data yet</p>
        <p style={{ fontSize: 13 }}>Analytics will appear once employees begin enrolling in courses.</p>
      </div>
    )
  }

  const maxPopular = Math.max(...stats.popularCourses.map(c => c.total), 1)
  const maxTrend = Math.max(...stats.monthlyTrend.map(m => m.count), 1)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Summary cards */}
      <div className="admin-mini-stats">
        <div className="admin-mini-stat">
          <span className="admin-mini-value">{stats.totalEnrolments}</span>
          <span>Enrolments</span>
        </div>
        <div className="admin-mini-stat">
          <span className="admin-mini-value" style={{ color: '#43a047' }}>{stats.completed}</span>
          <span>Completed</span>
        </div>
        <div className="admin-mini-stat">
          <span className="admin-mini-value" style={{ color: '#fb8c00' }}>{stats.inProgress}</span>
          <span>In Progress</span>
        </div>
        <div className="admin-mini-stat">
          <span className="admin-mini-value" style={{ color: '#e53935' }}>{stats.notStarted}</span>
          <span>Not Started</span>
        </div>
        <div className="admin-mini-stat">
          <span className="admin-mini-value" style={{ color: '#5c6bc0' }}>{stats.completionRate}%</span>
          <span>Completion Rate</span>
        </div>
      </div>

      {/* Charts row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
        {/* Donut chart */}
        <div className="admin-el-editor" style={{ padding: 20 }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700 }}>Completion Overview</h3>
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 24 }}>
            <svg viewBox="0 0 120 120" width="140" height="140">
              {(() => {
                const total = stats.totalEnrolments || 1
                const slices = [
                  { value: stats.completed, color: '#43a047', label: 'Completed' },
                  { value: stats.inProgress, color: '#fb8c00', label: 'In Progress' },
                  { value: stats.notStarted, color: '#e53935', label: 'Not Started' },
                ]
                const r = 42
                const cx = 60
                const cy = 60
                const circumference = 2 * Math.PI * r
                let offset = 0
                return (
                  <>
                    {slices.map((s, i) => {
                      const pct = s.value / total
                      const dashLength = pct * circumference
                      const el = (
                        <circle
                          key={i}
                          cx={cx} cy={cy} r={r}
                          fill="none"
                          stroke={s.color}
                          strokeWidth="16"
                          strokeDasharray={`${dashLength} ${circumference - dashLength}`}
                          strokeDashoffset={-offset}
                          transform={`rotate(-90 ${cx} ${cy})`}
                        />
                      )
                      offset += dashLength
                      return el
                    })}
                    <text x={cx} y={cy - 4} textAnchor="middle" fill="var(--text-primary, #1e293b)" fontSize="22" fontWeight="700">{stats.completionRate}%</text>
                    <text x={cx} y={cy + 14} textAnchor="middle" fill="var(--text-muted, #8b8fa3)" fontSize="10">complete</text>
                  </>
                )
              })()}
            </svg>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 12, height: 12, borderRadius: 3, background: '#43a047', flexShrink: 0 }} />
                Completed ({stats.completed})
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 12, height: 12, borderRadius: 3, background: '#fb8c00', flexShrink: 0 }} />
                In Progress ({stats.inProgress})
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 12, height: 12, borderRadius: 3, background: '#e53935', flexShrink: 0 }} />
                Not Started ({stats.notStarted})
              </div>
            </div>
          </div>
        </div>

        {/* Monthly trend */}
        {stats.monthlyTrend.length > 0 && (
          <div className="admin-el-editor" style={{ padding: 20 }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700 }}>Monthly Completions</h3>
            <svg viewBox={`0 0 ${Math.max(stats.monthlyTrend.length * 60, 200)} 140`} width="100%" height="160" style={{ overflow: 'visible' }}>
              {stats.monthlyTrend.map((m, i) => {
                const barW = 36
                const x = i * 60 + 20
                const barH = (m.count / maxTrend) * 100
                const y = 110 - barH
                return (
                  <g key={i}>
                    <rect x={x} y={y} width={barW} height={barH} rx={4} fill="#5c6bc0" opacity={0.85} />
                    <text x={x + barW / 2} y={y - 6} textAnchor="middle" fill="var(--text-primary, #1e293b)" fontSize="11" fontWeight="600">{m.count}</text>
                    <text x={x + barW / 2} y={128} textAnchor="middle" fill="var(--text-muted, #8b8fa3)" fontSize="10">{m.month}</text>
                  </g>
                )
              })}
              <line x1="10" y1="110" x2={stats.monthlyTrend.length * 60 + 10} y2="110" stroke="var(--border, #e5e7eb)" strokeWidth="1" />
            </svg>
          </div>
        )}
      </div>

      {/* Popular courses */}
      {stats.popularCourses.length > 0 && (
        <div className="admin-el-editor" style={{ padding: 20 }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700 }}>Most Enrolled Courses</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {stats.popularCourses.map(c => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ flex: '1 1 200px', fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.title}>{c.title}</span>
                <div style={{ flex: 1, height: 20, background: 'var(--surface-alt, #f1f5f9)', borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
                  <div style={{ height: '100%', width: `${(c.total / maxPopular) * 100}%`, background: '#5c6bc0', borderRadius: 4, position: 'relative' }}>
                    <div style={{ position: 'absolute', top: 0, left: 0, height: '100%', width: `${c.rate}%`, background: '#43a047', borderRadius: '4px 0 0 4px' }} />
                  </div>
                </div>
                <span style={{ flex: '0 0 80px', fontSize: 12, textAlign: 'right', color: 'var(--text-muted, #8b8fa3)' }}>
                  {c.completed}/{c.total} ({c.rate}%)
                </span>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--text-muted, #8b8fa3)', marginTop: 4 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: '#43a047' }} /> Completed
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: '#5c6bc0' }} /> Enrolled
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Department breakdown + At Risk / Low completion */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
        {/* Department breakdown */}
        {stats.deptBreakdown.length > 0 && (
          <div className="admin-el-editor" style={{ padding: 20 }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700 }}>Department Completion</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {stats.deptBreakdown.map(d => (
                <div key={d.dept}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                    <span style={{ fontWeight: 500 }}>{d.dept}</span>
                    <span style={{ color: 'var(--text-muted, #8b8fa3)' }}>{d.rate}% ({d.completed}/{d.total})</span>
                  </div>
                  <div style={{ height: 10, background: 'var(--surface-alt, #f1f5f9)', borderRadius: 5, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${d.rate}%`, background: d.rate >= 75 ? '#43a047' : d.rate >= 50 ? '#fb8c00' : '#e53935', borderRadius: 5, transition: 'width 0.3s' }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* At risk */}
        {stats.atRisk.length > 0 && (
          <div className="admin-el-editor" style={{ padding: 20 }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700, color: '#e53935' }}>
              At Risk — Approaching Deadline
            </h3>
            <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--text-muted, #8b8fa3)' }}>
              Courses due within 14 days that are not yet completed
            </p>
            <div className="admin-table-wrap">
              <table className="admin-table" style={{ fontSize: 13 }}>
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Course</th>
                    <th>Progress</th>
                    <th>Days Left</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.atRisk.slice(0, 10).map((r, i) => (
                    <tr key={i}>
                      <td>{r.employeeName}</td>
                      <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.courseTitle}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ width: 60, height: 6, background: 'var(--surface-alt, #f1f5f9)', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${r.progress}%`, background: r.daysLeft <= 3 ? '#e53935' : '#fb8c00', borderRadius: 3 }} />
                          </div>
                          <span style={{ fontSize: 11 }}>{r.progress}%</span>
                        </div>
                      </td>
                      <td>
                        <span style={{ fontWeight: 700, color: r.daysLeft <= 0 ? '#e53935' : r.daysLeft <= 3 ? '#fb8c00' : 'var(--text-primary, #1e293b)' }}>
                          {r.daysLeft <= 0 ? 'Overdue' : `${r.daysLeft}d`}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Low completion courses */}
        {stats.lowCompletion.length > 0 && (
          <div className="admin-el-editor" style={{ padding: 20 }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700, color: '#fb8c00' }}>
              Low Completion Courses
            </h3>
            <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--text-muted, #8b8fa3)' }}>
              Courses with under 50% completion rate (2+ enrolments)
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {stats.lowCompletion.map(c => (
                <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'var(--surface-alt, #f8fafc)', borderRadius: 8, border: '1px solid var(--border, #e5e7eb)' }}>
                  <span style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }} title={c.title}>{c.title}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: c.rate < 25 ? '#e53935' : '#fb8c00' }}>{c.rate}%</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ────── Course Preview Panel (Company Admin) ────── */

function CoursePreviewPanel({ course, enabled, targetDepts, departments, onToggleEnable, onToggleDept, saving }: {
  course: DbCourse; enabled: boolean; targetDepts: string[]; departments: string[];
  onToggleEnable: () => void; onToggleDept: (dept: string) => void; saving: boolean;
}) {
  return (
    <div style={{ padding: '16px 4px' }}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 340px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <span style={{ fontSize: 28 }}>{TYPE_ICONS[course.type]}</span>
            <div>
              <h3 style={{ margin: 0, fontSize: 17 }}>{course.title}</h3>
              <span style={{ fontSize: 12, color: 'var(--text-muted, #8b8fa3)' }}>
                {CATEGORY_LABELS[course.category] || course.category}
                {course.industry && <> &middot; {INDUSTRY_LABELS[course.industry] || course.industry}</>}
                {course.company_id ? ' · Company course' : ' · Core course'}
              </span>
            </div>
          </div>

          <p style={{ margin: '0 0 14px', fontSize: 14, lineHeight: 1.6, color: 'var(--text-primary, #1e293b)' }}>
            {course.description}
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '8px 16px', fontSize: 13, marginBottom: 14 }}>
            <div><span style={{ color: 'var(--text-muted, #8b8fa3)' }}>Type:</span> <strong style={{ textTransform: 'capitalize' }}>{course.type}</strong></div>
            <div><span style={{ color: 'var(--text-muted, #8b8fa3)' }}>Duration:</span> <strong>{course.duration}</strong></div>
            <div><span style={{ color: 'var(--text-muted, #8b8fa3)' }}>Required:</span> <strong>{course.required ? 'Yes' : 'No'}</strong></div>
            <div><span style={{ color: 'var(--text-muted, #8b8fa3)' }}>Annual renewal:</span> <strong>{course.annual_reminder ? 'Yes' : 'No'}</strong></div>
            {course.days_to_complete && (
              <div><span style={{ color: 'var(--text-muted, #8b8fa3)' }}>Complete within:</span> <strong>{course.days_to_complete} days</strong></div>
            )}
            {course.deadline && (
              <div><span style={{ color: 'var(--text-muted, #8b8fa3)' }}>Deadline:</span> <strong>{new Date(course.deadline).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</strong></div>
            )}
          </div>

          {course.tags.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
              {course.tags.map(tag => (
                <span key={tag} className="admin-tag-mini" style={{ background: 'var(--surface-alt, #f1f5f9)', fontSize: 11 }}>{tag}</span>
              ))}
            </div>
          )}

          {course.external_url && isVideoEmbeddable(course.external_url) && (
            <div style={{ position: 'relative', width: '100%', maxWidth: 560, aspectRatio: '16/9', marginBottom: 14, borderRadius: 8, overflow: 'hidden', background: '#000' }}>
              <iframe
                src={toEmbedUrl(course.external_url)}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' }}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                title={course.title}
              />
            </div>
          )}
          {course.external_url && (
            <div style={{ fontSize: 13, marginBottom: 14 }}>
              <span style={{ color: 'var(--text-muted, #8b8fa3)' }}>External link:</span>{' '}
              <a href={course.external_url} target="_blank" rel="noopener noreferrer" style={{ color: '#5c6bc0', wordBreak: 'break-all' }}>
                {course.external_url}
              </a>
            </div>
          )}
        </div>

        <div style={{ flex: '0 0 220px', minWidth: 0, background: 'var(--surface-alt, #f8fafc)', borderRadius: 10, padding: 16, border: '1px solid var(--border, #e5e7eb)' }}>
          <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Configuration</h4>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Enabled</span>
            <label className="admin-toggle-switch">
              <input type="checkbox" checked={enabled} onChange={onToggleEnable} disabled={saving} />
              <span className="admin-toggle-slider" />
            </label>
          </div>

          {departments.length > 0 && (
            <div>
              <span style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 6 }}>Departments</span>
              <p style={{ fontSize: 11, color: 'var(--text-muted, #8b8fa3)', margin: '0 0 6px' }}>
                {targetDepts.length === 0 ? 'Visible to all departments' : `${targetDepts.length} department${targetDepts.length !== 1 ? 's' : ''} selected`}
              </p>
              <div style={{ maxHeight: 140, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {departments.map(dept => (
                  <label key={dept} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: enabled ? 'pointer' : 'default', opacity: enabled ? 1 : 0.5 }}>
                    <input type="checkbox" checked={targetDepts.includes(dept)} onChange={() => onToggleDept(dept)} disabled={!enabled} />
                    {dept}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ────── Course Form (shared by Core & Company) ────── */

function CourseForm({ form, setForm, isEdit, companies, selectedCompanyIds, onCompanyToggle }: { form: DbCourse; setForm: (fn: (prev: DbCourse) => DbCourse) => void; isEdit?: boolean; companies?: CompanyRow[]; selectedCompanyIds?: Set<string>; onCompanyToggle?: (companyId: string) => void }) {
  const [tagsInput, setTagsInput] = useState(form.tags.join(', '))

  useEffect(() => { setTagsInput(form.tags.join(', ')) }, [form.tags])

  function updateTags(val: string) {
    setTagsInput(val)
    setForm(p => ({ ...p, tags: val.split(',').map(t => t.trim()).filter(Boolean) }))
  }

  return (
    <div className="admin-el-form-grid">
      {!isEdit && (
        <div className="admin-el-form-field">
          <label>Course ID</label>
          <input className="admin-inline-input" value={form.id} onChange={e => setForm(p => ({ ...p, id: e.target.value }))} placeholder="auto-generated from title if blank" />
        </div>
      )}
      <div className="admin-el-form-field">
        <label>Title *</label>
        <input className="admin-inline-input" value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="Course title" />
      </div>
      <div className="admin-el-form-field admin-el-form-wide">
        <label>Description</label>
        <textarea className="admin-inline-input" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="Brief description" rows={2} style={{ resize: 'vertical' }} />
      </div>
      <div className="admin-el-form-field">
        <label>Category</label>
        <select className="admin-select" value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}>
          {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
        </select>
      </div>
      <div className="admin-el-form-field">
        <label>Type</label>
        <select className="admin-select" value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value as CourseType }))}>
          {TYPES.map(t => <option key={t} value={t}>{TYPE_ICONS[t]} {t}</option>)}
        </select>
      </div>
      <div className="admin-el-form-field">
        <label>Duration</label>
        <input className="admin-inline-input" value={form.duration} onChange={e => setForm(p => ({ ...p, duration: e.target.value }))} placeholder="e.g. 20 min" />
      </div>
      <div className="admin-el-form-field">
        <label>Industry</label>
        <select className="admin-select" value={form.industry || ''} onChange={e => setForm(p => ({ ...p, industry: e.target.value || null }))}>
          {INDUSTRIES.map(i => <option key={i} value={i}>{INDUSTRY_LABELS[i] || 'All Industries'}</option>)}
        </select>
      </div>
      <div className="admin-el-form-field">
        <label>Days to Complete</label>
        <input type="number" className="admin-inline-input" min="1" placeholder="e.g. 30" value={form.days_to_complete ?? ''} onChange={e => setForm(p => ({ ...p, days_to_complete: e.target.value ? parseInt(e.target.value) : null }))} />
        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Days from employee enrolment date</span>
      </div>
      <div className="admin-el-form-field">
        <label>External URL</label>
        <input className="admin-inline-input" value={form.external_url || ''} onChange={e => setForm(p => ({ ...p, external_url: e.target.value || null }))} placeholder="Optional link" />
      </div>
      <div className="admin-el-form-field admin-el-form-wide">
        <label>Tags (comma-separated)</label>
        <input className="admin-inline-input" value={tagsInput} onChange={e => updateTags(e.target.value)} placeholder="e.g. compliance, wellbeing" />
      </div>
      <div className="admin-el-form-field admin-el-form-checks">
        <label><input type="checkbox" checked={form.required} onChange={e => setForm(p => ({ ...p, required: e.target.checked }))} /> Required</label>
        <label><input type="checkbox" checked={form.annual_reminder} onChange={e => setForm(p => ({ ...p, annual_reminder: e.target.checked }))} /> Annual Reminder</label>
        <label><input type="checkbox" checked={form.is_active} onChange={e => setForm(p => ({ ...p, is_active: e.target.checked }))} /> Active</label>
      </div>
      {companies && companies.length > 0 && onCompanyToggle && selectedCompanyIds && (
        <div className="admin-el-form-field admin-el-form-wide">
          <label>Visible to Companies</label>
          <p style={{ fontSize: 11, color: 'var(--text-muted, #8b8fa3)', margin: '0 0 6px' }}>
            Select which companies can see this course. Leave all unchecked to manage visibility later.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 12px' }}>
            {companies.map(c => (
              <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={selectedCompanyIds.has(c.id)} onChange={() => onCompanyToggle(c.id)} />
                {c.name}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* ────── Department Picker (inline) ────── */

function DepartmentPicker({ departments, selected, onChange }: { departments: string[]; selected: string[]; onChange: (depts: string[]) => void }) {
  function toggle(dept: string) {
    onChange(selected.includes(dept) ? selected.filter(d => d !== dept) : [...selected, dept])
  }
  return (
    <div style={{ marginTop: 12 }}>
      <label style={{ fontWeight: 600, fontSize: 13, display: 'block', marginBottom: 6 }}>Target Departments</label>
      <p style={{ fontSize: 11, color: 'var(--text-muted, #8b8fa3)', margin: '0 0 8px' }}>
        Leave all unchecked to make this course available to all departments.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px' }}>
        {departments.map(dept => (
          <label key={dept} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={selected.includes(dept)} onChange={() => toggle(dept)} />
            {dept}
          </label>
        ))}
      </div>
    </div>
  )
}

/* ────── Department Dropdown (table inline) ────── */

function DepartmentDropdown({ courseId, departments, selectedDepartments, onToggle, onClose }: {
  courseId: string; departments: string[]; selectedDepartments: string[];
  onToggle: (courseId: string, dept: string) => void; onClose: () => void;
}) {
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (!target.closest('.admin-el-vis-dropdown')) onClose()
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  return (
    <div className="admin-el-vis-dropdown">
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border, #e5e7eb)', fontWeight: 600, fontSize: 12 }}>
        Department Targeting
      </div>
      <div style={{ padding: '6px 12px', fontSize: 11, color: 'var(--text-muted)', borderBottom: '1px solid var(--border, #e5e7eb)' }}>
        None selected = all departments
      </div>
      <div style={{ maxHeight: 200, overflowY: 'auto' }}>
        {departments.map(dept => (
          <label key={dept} className="admin-el-vis-item">
            <input type="checkbox" checked={selectedDepartments.includes(dept)} onChange={() => onToggle(courseId, dept)} />
            <span>{dept}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

/* ────── Company Visibility Dropdown (Super Admin) ────── */

function CompanyVisibilityDropdown({
  courseId, companies, enabledCompanyIds, onToggle, onClose,
}: {
  courseId: string; companies: CompanyRow[]; enabledCompanyIds: Set<string>;
  onToggle: (courseId: string, companyId: string) => void; onClose: () => void;
}) {
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (!target.closest('.admin-el-vis-dropdown')) onClose()
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  return (
    <div className="admin-el-vis-dropdown">
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border, #e5e7eb)', fontWeight: 600, fontSize: 12 }}>
        Company Visibility
      </div>
      <div style={{ maxHeight: 200, overflowY: 'auto' }}>
        {companies.map(company => (
          <label key={company.id} className="admin-el-vis-item">
            <input type="checkbox" checked={enabledCompanyIds.has(company.id)} onChange={() => onToggle(courseId, company.id)} />
            <span>{company.name}</span>
          </label>
        ))}
        {companies.length === 0 && <div style={{ padding: 12, fontSize: 12, opacity: 0.6 }}>No companies</div>}
      </div>
    </div>
  )
}
