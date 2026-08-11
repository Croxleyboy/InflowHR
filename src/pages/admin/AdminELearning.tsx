import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import type { CourseType } from '../ELearning'

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

const CATEGORIES = ['onboarding', 'compliance', 'policies', 'role', 'development', 'wellbeing']
const TYPES: CourseType[] = ['video', 'article', 'quiz', 'policy']
const INDUSTRIES = ['', 'legal', 'education', 'accountancy']

const EMPTY_COURSE: Omit<DbCourse, 'id'> & { id: string } = {
  id: '', title: '', description: '', category: 'onboarding', type: 'article',
  duration: '10 min', required: false, deadline: null, days_to_complete: null, tags: [],
  annual_reminder: false, industry: null, external_url: null, is_active: true,
}

export default function AdminELearning() {
  const { selectedCompanyId } = useAdminCompany()
  const { isSuperAdmin } = useAuth()
  const { showError, showSuccess } = useToast()
  const [tab, setTab] = useState<'visibility' | 'courses'>(isSuperAdmin ? 'courses' : 'visibility')

  return (
    <div className="admin-section">
      <div className="admin-page-header">
        <h2>E-Learning Content Management</h2>
        <p>{isSuperAdmin ? 'Manage courses and company visibility' : 'Enable or disable courses for the selected company'}</p>
      </div>

      {isSuperAdmin && (
        <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '2px solid var(--border, #e5e7eb)' }}>
          <button
            onClick={() => setTab('courses')}
            style={{
              padding: '10px 24px', border: 'none', background: 'none', fontWeight: 700, fontSize: 14, cursor: 'pointer',
              borderBottom: tab === 'courses' ? '3px solid #5c6bc0' : '3px solid transparent',
              color: tab === 'courses' ? '#5c6bc0' : 'var(--text-muted, #8b8fa3)', marginBottom: -2,
            }}
          >
            Course Management
          </button>
          <button
            onClick={() => setTab('visibility')}
            style={{
              padding: '10px 24px', border: 'none', background: 'none', fontWeight: 700, fontSize: 14, cursor: 'pointer',
              borderBottom: tab === 'visibility' ? '3px solid #5c6bc0' : '3px solid transparent',
              color: tab === 'visibility' ? '#5c6bc0' : 'var(--text-muted, #8b8fa3)', marginBottom: -2,
            }}
          >
            Company Visibility
          </button>
        </div>
      )}

      {tab === 'visibility' && <VisibilityTab companyId={selectedCompanyId} />}
      {tab === 'courses' && isSuperAdmin && <CourseManagementTab showError={showError} showSuccess={showSuccess} />}
    </div>
  )
}

/* ────── Company Visibility Tab ────── */

function VisibilityTab({ companyId }: { companyId: string }) {
  const [courses, setCourses] = useState<DbCourse[]>([])
  const [enabledIds, setEnabledIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterIndustry, setFilterIndustry] = useState('')

  const fetchData = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    const [coursesRes, enabledRes] = await Promise.all([
      supabase.from('elearning_courses').select('*').eq('is_active', true).order('category').order('title'),
      supabase.from('company_elearning_courses').select('course_id').eq('company_id', companyId).eq('is_enabled', true),
    ])
    setCourses((coursesRes.data as DbCourse[]) || [])
    setEnabledIds(new Set((enabledRes.data || []).map((r: any) => r.course_id)))
    setLoading(false)
  }, [companyId])

  useEffect(() => { fetchData() }, [fetchData])

  async function toggleCourse(courseId: string) {
    if (!companyId) return
    setSaving(courseId)
    const isCurrentlyEnabled = enabledIds.has(courseId)
    await supabase.from('company_elearning_courses').upsert(
      { company_id: companyId, course_id: courseId, is_enabled: !isCurrentlyEnabled },
      { onConflict: 'company_id,course_id' }
    )
    setEnabledIds(prev => {
      const next = new Set(prev)
      if (isCurrentlyEnabled) next.delete(courseId); else next.add(courseId)
      return next
    })
    setSaving(null)
  }

  async function bulkToggle(enable: boolean) {
    if (!companyId) return
    setSaving('__all__')
    const rows = filtered.map(c => ({ company_id: companyId, course_id: c.id, is_enabled: enable }))
    await supabase.from('company_elearning_courses').upsert(rows, { onConflict: 'company_id,course_id' })
    setEnabledIds(prev => {
      const next = new Set(prev)
      filtered.forEach(c => enable ? next.add(c.id) : next.delete(c.id))
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

  const enabledCount = filtered.filter(c => enabledIds.has(c.id)).length
  const categories = [...new Set(courses.map(c => c.category))]
  const industries = [...new Set(courses.filter(c => c.industry).map(c => c.industry!))]

  if (loading) return <div className="admin-loading">Loading...</div>

  return (
    <>
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
              <th className="admin-el-hide-tablet">Annual</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(course => {
              const enabled = enabledIds.has(course.id)
              return (
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
                      <span className="admin-td-desc">{course.id}</span>
                    </div>
                  </td>
                  <td className="admin-el-hide-mobile"><span className="admin-tag-mini">{CATEGORY_LABELS[course.category] || course.category}</span></td>
                  <td className="admin-el-hide-mobile">
                    {course.industry ? <span className="admin-tag-mini">{INDUSTRY_LABELS[course.industry] || course.industry}</span> : <span style={{ opacity: 0.4 }}>—</span>}
                  </td>
                  <td className="admin-el-hide-mobile">{course.duration}</td>
                  <td className="admin-el-hide-tablet">{course.required ? '✓' : '—'}</td>
                  <td className="admin-el-hide-tablet">{course.annual_reminder ? '🔔' : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="admin-empty">No courses match your filters</div>}
      </div>
    </>
  )
}

/* ────── Course Management Tab (Super Admin Only) ────── */

function CourseManagementTab({ showError, showSuccess }: { showError: (m: string) => void; showSuccess: (m: string) => void }) {
  const [courses, setCourses] = useState<DbCourse[]>([])
  const [companies, setCompanies] = useState<CompanyRow[]>([])
  const [visibilityMap, setVisibilityMap] = useState<Record<string, Set<string>>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<DbCourse>({ ...EMPTY_COURSE } as DbCourse)
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState<DbCourse>({ ...EMPTY_COURSE } as DbCourse)
  const [addCompanyIds, setAddCompanyIds] = useState<Set<string>>(new Set())
  const [visDropdownOpen, setVisDropdownOpen] = useState<string | null>(null)

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

  const filtered = useMemo(() => courses.filter(c => {
    if (search && !c.title.toLowerCase().includes(search.toLowerCase()) && !c.id.toLowerCase().includes(search.toLowerCase())) return false
    if (filterCategory && c.category !== filterCategory) return false
    return true
  }), [courses, search, filterCategory])

  function generateId(title: string): string {
    return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 40) || 'new-course'
  }

  async function saveCourse() {
    const form = addForm
    const id = form.id.trim() || generateId(form.title)
    if (!form.title.trim()) { showError('Title is required'); return }
    if (courses.some(c => c.id === id)) { showError('A course with this ID already exists'); return }
    const { error } = await supabase.from('elearning_courses').insert({
      id,
      title: form.title.trim(),
      description: form.description.trim(),
      category: form.category,
      type: form.type,
      duration: form.duration,
      required: form.required,
      deadline: form.deadline || null,
      days_to_complete: form.days_to_complete || null,
      tags: form.tags,
      annual_reminder: form.annual_reminder,
      industry: form.industry || null,
      external_url: form.external_url || null,
      is_active: form.is_active,
    })
    if (error) { showError('Failed to create course: ' + error.message); return }
    if (addCompanyIds.size > 0) {
      const rows = Array.from(addCompanyIds).map(cid => ({ company_id: cid, course_id: id, is_enabled: true }))
      await supabase.from('company_elearning_courses').upsert(rows, { onConflict: 'company_id,course_id' })
    }
    showSuccess('Course created')
    setAddForm({ ...EMPTY_COURSE } as DbCourse)
    setAddCompanyIds(new Set())
    setShowAdd(false)
    loadAll()
  }

  async function updateCourse() {
    if (!editingId) return
    const form = editForm
    if (!form.title.trim()) { showError('Title is required'); return }
    const { error } = await supabase.from('elearning_courses').update({
      title: form.title.trim(),
      description: form.description.trim(),
      category: form.category,
      type: form.type,
      duration: form.duration,
      required: form.required,
      deadline: form.deadline || null,
      days_to_complete: form.days_to_complete || null,
      tags: form.tags,
      annual_reminder: form.annual_reminder,
      industry: form.industry || null,
      external_url: form.external_url || null,
      is_active: form.is_active,
    }).eq('id', editingId)
    if (error) { showError('Failed to update course: ' + error.message); return }
    showSuccess('Course updated')
    setEditingId(null)
    loadAll()
  }

  async function deleteCourse(id: string) {
    if (!confirm('Delete this course? This will also remove it from all company visibility settings.')) return
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
          {showAdd ? 'Cancel' : '+ New Course'}
        </button>
      </div>

      {/* ── Add Course Form ── */}
      {showAdd && (
        <div className="admin-el-editor" style={{ marginBottom: 20 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>Create New Course</h3>
          <CourseForm form={addForm} setForm={setAddForm as any} companies={companies} selectedCompanyIds={addCompanyIds} onCompanyToggle={(cid) => setAddCompanyIds(prev => { const next = new Set(prev); if (next.has(cid)) next.delete(cid); else next.add(cid); return next })} />
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="admin-btn-sm admin-btn-save" onClick={saveCourse}>Create Course</button>
            <button className="admin-btn-sm admin-btn-cancel" onClick={() => setShowAdd(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── Edit Course Form ── */}
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

      {/* ── Courses Table ── */}
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
            {filtered.map(course => {
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
    </>
  )
}

/* ────── Course Form (shared by Add & Edit) ────── */

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

/* ────── Company Visibility Dropdown ────── */

function CompanyVisibilityDropdown({
  courseId, companies, enabledCompanyIds, onToggle, onClose,
}: {
  courseId: string
  companies: CompanyRow[]
  enabledCompanyIds: Set<string>
  onToggle: (courseId: string, companyId: string) => void
  onClose: () => void
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
            <input
              type="checkbox"
              checked={enabledCompanyIds.has(company.id)}
              onChange={() => onToggle(courseId, company.id)}
            />
            <span>{company.name}</span>
          </label>
        ))}
        {companies.length === 0 && <div style={{ padding: 12, fontSize: 12, opacity: 0.6 }}>No companies</div>}
      </div>
    </div>
  )
}
