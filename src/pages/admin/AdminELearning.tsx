import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { COURSES, type Course, type CourseType } from '../ELearning'

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

export default function AdminELearning() {
  const { selectedCompanyId } = useAdminCompany()
  const [enabledIds, setEnabledIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterIndustry, setFilterIndustry] = useState('')

  const fetchEnabled = useCallback(async () => {
    if (!selectedCompanyId) return
    setLoading(true)
    const { data } = await supabase
      .from('company_elearning_courses')
      .select('course_id')
      .eq('company_id', selectedCompanyId)
      .eq('is_enabled', true)
    setEnabledIds(new Set((data || []).map((r: any) => r.course_id)))
    setLoading(false)
  }, [selectedCompanyId])

  useEffect(() => { fetchEnabled() }, [fetchEnabled])

  async function toggleCourse(courseId: string) {
    if (!selectedCompanyId) return
    setSaving(courseId)
    const isCurrentlyEnabled = enabledIds.has(courseId)

    await supabase
      .from('company_elearning_courses')
      .upsert(
        {
          company_id: selectedCompanyId,
          course_id: courseId,
          is_enabled: !isCurrentlyEnabled,
        },
        { onConflict: 'company_id,course_id' }
      )

    setEnabledIds(prev => {
      const next = new Set(prev)
      if (isCurrentlyEnabled) next.delete(courseId)
      else next.add(courseId)
      return next
    })
    setSaving(null)
  }

  async function enableAll() {
    if (!selectedCompanyId) return
    setSaving('__all__')
    const rows = filtered.map(c => ({
      company_id: selectedCompanyId,
      course_id: c.id,
      is_enabled: true,
    }))
    await supabase
      .from('company_elearning_courses')
      .upsert(rows, { onConflict: 'company_id,course_id' })
    setEnabledIds(prev => {
      const next = new Set(prev)
      filtered.forEach(c => next.add(c.id))
      return next
    })
    setSaving(null)
  }

  async function disableAll() {
    if (!selectedCompanyId) return
    setSaving('__all__')
    const rows = filtered.map(c => ({
      company_id: selectedCompanyId,
      course_id: c.id,
      is_enabled: false,
    }))
    await supabase
      .from('company_elearning_courses')
      .upsert(rows, { onConflict: 'company_id,course_id' })
    setEnabledIds(prev => {
      const next = new Set(prev)
      filtered.forEach(c => next.delete(c.id))
      return next
    })
    setSaving(null)
  }

  const filtered = COURSES.filter(c => {
    if (search && !c.titleKey.toLowerCase().includes(search.toLowerCase()) && !c.id.toLowerCase().includes(search.toLowerCase())) return false
    if (filterCategory && c.category !== filterCategory) return false
    if (filterIndustry && c.industry !== filterIndustry) return false
    return true
  })

  const enabledCount = filtered.filter(c => enabledIds.has(c.id)).length
  const categories = [...new Set(COURSES.map(c => c.category))]
  const industries = [...new Set(COURSES.filter(c => c.industry).map(c => c.industry!))]

  return (
    <div className="admin-section">
      <div className="admin-page-header">
        <h2>E-Learning Content Management</h2>
        <p>Enable or disable courses for the selected company. {enabledCount}/{filtered.length} enabled.</p>
      </div>

      {loading ? (
        <div className="admin-loading">Loading...</div>
      ) : (
        <>
          <div className="admin-filters">
            <input
              placeholder="Search courses..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="admin-input admin-search"
            />
            <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className="admin-select">
              <option value="">All Categories</option>
              {categories.map(cat => (
                <option key={cat} value={cat}>{CATEGORY_LABELS[cat] || cat}</option>
              ))}
            </select>
            <select value={filterIndustry} onChange={e => setFilterIndustry(e.target.value)} className="admin-select">
              <option value="">All Industries</option>
              {industries.map(ind => (
                <option key={ind} value={ind}>{INDUSTRY_LABELS[ind] || ind}</option>
              ))}
            </select>
            <button className="admin-btn admin-btn-primary" onClick={enableAll} disabled={saving === '__all__'}>
              Enable All
            </button>
            <button className="admin-btn admin-btn-secondary" onClick={disableAll} disabled={saving === '__all__'}>
              Disable All
            </button>
          </div>

          <div className="admin-table-wrap">
            <table className="admin-table admin-el-table">
              <thead>
                <tr>
                  <th>Enabled</th>
                  <th>Type</th>
                  <th>Course</th>
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
                  const isSaving = saving === course.id
                  return (
                    <tr key={course.id} className={!enabled ? 'admin-row-inactive' : ''}>
                      <td>
                        <label className="admin-toggle-switch">
                          <input
                            type="checkbox"
                            checked={enabled}
                            onChange={() => toggleCourse(course.id)}
                            disabled={isSaving}
                          />
                          <span className="admin-toggle-slider" />
                        </label>
                      </td>
                      <td><span className="admin-type-icon">{TYPE_ICONS[course.type]}</span> {course.type}</td>
                      <td className="admin-el-title-cell">
                        <div>
                          <strong>{course.titleKey.replace('elearning.c_', '').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()).replace(' Title', '').replace(' Desc', '')}</strong>
                          <br />
                          <span className="admin-td-desc">{course.id}</span>
                        </div>
                      </td>
                      <td className="admin-el-hide-mobile">
                        <span className="admin-tag-mini">{CATEGORY_LABELS[course.category] || course.category}</span>
                      </td>
                      <td className="admin-el-hide-mobile">
                        {course.industry
                          ? <span className="admin-tag-mini">{INDUSTRY_LABELS[course.industry] || course.industry}</span>
                          : <span style={{ opacity: 0.4 }}>—</span>}
                      </td>
                      <td className="admin-el-hide-mobile">{course.duration}</td>
                      <td className="admin-el-hide-tablet">{course.required ? '✓' : '—'}</td>
                      <td className="admin-el-hide-tablet">{course.annualReminder ? '🔔' : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {filtered.length === 0 && <div className="admin-empty">No courses match your filters</div>}
          </div>
        </>
      )}
    </div>
  )
}
