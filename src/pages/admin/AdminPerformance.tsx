import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { useFeatures } from '../../context/FeatureContext'
import { useToast } from '../../context/ToastContext'
import { formatDate } from '../../lib/formatters'

interface Employee {
  id: string
  first_name: string
  last_name: string
  job_title: string | null
  department: string | null
  email: string
  manager_id: string | null
  avatar_url: string | null
}

interface Meeting {
  id: number
  manager_id: string
  employee_id: string
  scheduled_date: string
  scheduled_time: string
  status: string
  summary: string | null
  employee_name?: string
}

interface ELCourse {
  id: string
  title: string
  required: boolean
  category: string
  type: string
  duration: string
}

interface ELCompletion {
  employee_id: string
  course_id: string
  completed_at: string
}

interface GoalRow {
  employee_id: string
  status: string
}

interface AdminGoal {
  id: string
  employee_id: string
  manager_id: string | null
  title: string
  description: string | null
  status: string
  grade: number | null
  start_date: string
  due_date: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

interface AdminGoalComment {
  id: string
  goal_id: string
  author_id: string
  body: string
  created_at: string
  author_name?: string
}

const GOAL_STATUS_OPTIONS = [
  { value: 'active', label: 'Active', color: '#2563eb', bg: '#dbeafe' },
  { value: 'completed', label: 'Completed', color: '#16a34a', bg: '#dcfce7' },
  { value: 'edited', label: 'Edited', color: '#d97706', bg: '#fef3c7' },
  { value: 'on_hold', label: 'On Hold', color: '#6b7280', bg: '#f3f4f6' },
  { value: 'cancelled', label: 'Cancelled', color: '#dc2626', bg: '#fee2e2' },
]

function goalStatusStyle(status: string) {
  const s = GOAL_STATUS_OPTIONS.find(o => o.value === status)
  return s ? { background: s.bg, color: s.color } : {}
}

function fmtDateUK(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

const MONTH_NAMES_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December']

function getFYMonths(fyStartMonth: number): { year: number; month: number; label: string }[] {
  const now = new Date()
  const currentMonth = now.getMonth() + 1
  const startYear = currentMonth >= fyStartMonth ? now.getFullYear() : now.getFullYear() - 1
  const months: { year: number; month: number; label: string }[] = []
  for (let i = 0; i < 12; i++) {
    const m = (fyStartMonth - 1 + i) % 12
    const y = startYear + (fyStartMonth - 1 + i >= 12 ? 1 : 0)
    months.push({ year: y, month: m, label: `${MONTH_NAMES_FULL[m]} ${y}` })
  }
  return months
}

export default function AdminPerformance() {
  const { selectedCompanyId, selectedCompany } = useAdminCompany()
  const { companyFeatures } = useFeatures()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedManager, setExpandedManager] = useState<string | null>(null)
  const [expandedMeeting, setExpandedMeeting] = useState<number | null>(null)
  const [reassignModal, setReassignModal] = useState<{ employee: Employee; currentManagerId: string | null } | null>(null)
  const [newManagerId, setNewManagerId] = useState('')
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState<'overview' | 'reports' | 'goals'>('overview')

  const [courses, setCourses] = useState<ELCourse[]>([])
  const [completions, setCompletions] = useState<ELCompletion[]>([])
  const [enabledCourseIds, setEnabledCourseIds] = useState<Set<string> | null>(null)
  const [elModal, setElModal] = useState<{ employee: Employee } | null>(null)
  const [goals, setGoals] = useState<GoalRow[]>([])
  const [adminGoals, setAdminGoals] = useState<AdminGoal[]>([])
  const [goalComments, setGoalComments] = useState<AdminGoalComment[]>([])

  const elearningEnabled = companyFeatures.elearning

  const fetchData = useCallback(async () => {
    setLoading(true)
    let q = supabase.from('employees')
      .select('id, first_name, last_name, job_title, department, email, manager_id, avatar_url')
      .eq('is_active', true)
      .order('first_name')
    if (selectedCompanyId) q = q.eq('company_id', selectedCompanyId)
    const { data: emps } = await q

    let mq = supabase.from('one_to_one_meetings')
      .select('*')
      .order('scheduled_date', { ascending: false })
    if (selectedCompanyId) mq = mq.eq('company_id', selectedCompanyId)
    const { data: mtgs } = await mq

    setEmployees((emps || []) as Employee[])
    setMeetings((mtgs || []) as Meeting[])

    if (elearningEnabled) {
      const { data: courseData } = await supabase
        .from('elearning_courses')
        .select('id, title, required, category, type, duration')
        .eq('is_active', true)
        .order('title')
      setCourses((courseData || []) as ELCourse[])

      if (selectedCompanyId) {
        const [compRes, enRes] = await Promise.all([
          supabase.from('elearning_completions')
            .select('employee_id, course_id, completed_at')
            .eq('company_id', selectedCompanyId),
          supabase.from('company_elearning_courses')
            .select('course_id')
            .eq('company_id', selectedCompanyId)
            .eq('is_enabled', true),
        ])
        setCompletions((compRes.data || []) as ELCompletion[])
        if (enRes.data) {
          setEnabledCourseIds(new Set(enRes.data.map((r: any) => r.course_id)))
        }
      }
    }

    if (selectedCompanyId) {
      const fyStart = selectedCompany?.fy_start_month || 4
      const now = new Date()
      const curMonth = now.getMonth() + 1
      const fyYear = curMonth >= fyStart ? now.getFullYear() : now.getFullYear() - 1
      const fyStartDate = `${fyYear}-${String(fyStart).padStart(2, '0')}-01`
      const endMonth = fyStart === 1 ? 12 : fyStart - 1
      const endYear = fyStart === 1 ? fyYear : fyYear + 1
      const endDay = new Date(endYear, endMonth, 0).getDate()
      const fyEndDate = `${endYear}-${String(endMonth).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`

      const { data: goalData } = await supabase.from('performance_goals')
        .select('employee_id, status')
        .eq('company_id', selectedCompanyId)
        .gte('start_date', fyStartDate)
        .lte('start_date', fyEndDate)
      setGoals((goalData || []) as GoalRow[])

      const { data: fullGoals } = await supabase.from('performance_goals')
        .select('*')
        .eq('company_id', selectedCompanyId)
        .order('created_at', { ascending: false })
      setAdminGoals((fullGoals || []) as AdminGoal[])

      if (fullGoals && fullGoals.length > 0) {
        const goalIds = fullGoals.map((g: any) => g.id)
        const { data: cmts } = await supabase.from('performance_goal_comments')
          .select('*')
          .eq('company_id', selectedCompanyId)
          .in('goal_id', goalIds)
          .order('created_at', { ascending: true })
        if (cmts) {
          const authorIds = [...new Set(cmts.map((c: any) => c.author_id))]
          if (authorIds.length > 0) {
            const { data: authors } = await supabase.from('employees')
              .select('id, first_name, last_name')
              .in('id', authorIds)
            const aMap: Record<string, string> = {}
            ;(authors || []).forEach((a: any) => { aMap[a.id] = `${a.first_name} ${a.last_name}` })
            setGoalComments(cmts.map((c: any) => ({ ...c, author_name: aMap[c.author_id] || 'Unknown' })))
          } else {
            setGoalComments(cmts as AdminGoalComment[])
          }
        }
      } else {
        setGoalComments([])
      }
    }

    setLoading(false)
  }, [selectedCompanyId, selectedCompany, elearningEnabled])

  useEffect(() => { fetchData() }, [fetchData])

  const managers = employees.filter(e => employees.some(r => r.manager_id === e.id))
  const getReports = (managerId: string) => employees.filter(e => e.manager_id === managerId)
  const getManagerMeetings = (managerId: string, empId: string) =>
    meetings.filter(m => m.manager_id === managerId && m.employee_id === empId)
  const nameMap: Record<string, string> = {}
  employees.forEach(e => { nameMap[e.id] = `${e.first_name} ${e.last_name}` })

  const mandatoryCourses = enabledCourseIds !== null
    ? courses.filter(c => c.required && enabledCourseIds.has(c.id))
    : courses.filter(c => c.required)

  function getELStats(empId: string): { required: number; completed: number } {
    const required = mandatoryCourses.length
    const empCompletions = completions.filter(c => c.employee_id === empId)
    const completedIds = new Set(empCompletions.map(c => c.course_id))
    const completed = mandatoryCourses.filter(c => completedIds.has(c.id)).length
    return { required, completed }
  }

  function getGoalStats(empId: string) {
    const empGoals = goals.filter(g => g.employee_id === empId)
    return {
      total: empGoals.length,
      active: empGoals.filter(g => g.status === 'active').length,
      completed: empGoals.filter(g => g.status === 'completed').length,
    }
  }

  function getELCourseList(empId: string): { course: ELCourse; completed: boolean; completedAt: string | null }[] {
    const empCompletions = completions.filter(c => c.employee_id === empId)
    const completionMap = new Map(empCompletions.map(c => [c.course_id, c.completed_at]))
    return mandatoryCourses.map(c => ({
      course: c,
      completed: completionMap.has(c.id),
      completedAt: completionMap.get(c.id) || null,
    }))
  }

  async function handleReassign() {
    if (!reassignModal || !newManagerId) return
    setSaving(true)
    const resolvedId = newManagerId === '__none__' ? null : newManagerId
    await supabase.from('employees')
      .update({ manager_id: resolvedId })
      .eq('id', reassignModal.employee.id)
    const empEmail = reassignModal.employee.email
    if (empEmail) {
      const managerName = resolvedId ? (nameMap[resolvedId] || null) : null
      await supabase.from('onboarding')
        .update({ manager: managerName })
        .eq('user_email', empEmail)
        .eq('company_id', selectedCompanyId)
    }
    setSaving(false)
    setReassignModal(null)
    setNewManagerId('')
    fetchData()
  }

  function renderELButton(emp: Employee) {
    if (!elearningEnabled) return null
    const stats = getELStats(emp.id)
    const allDone = stats.completed === stats.required && stats.required > 0
    return (
      <button
        className="admin-perf-el-btn"
        style={{
          background: allDone ? '#e8f5e9' : '#fff3e0',
          color: allDone ? '#2e7d32' : '#e65100',
          border: `1px solid ${allDone ? '#a5d6a7' : '#ffcc80'}`,
          borderRadius: 6, padding: '3px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 4,
        }}
        onClick={e => { e.stopPropagation(); setElModal({ employee: emp }) }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
        {stats.required}/{stats.completed}
      </button>
    )
  }

  if (loading) return <div className="admin-page"><p className="claims-empty">Loading...</p></div>

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Performance — 1:1 Meetings and Data</h1>
        <p className="admin-page-subtitle">Manager hierarchy, direct reports, and meeting history</p>
      </div>

      <div className="admin-tabs" style={{ marginBottom: 16 }}>
        <button className={`admin-tab ${tab === 'overview' ? 'admin-tab-active' : ''}`} onClick={() => setTab('overview')}>Overview</button>
        <button className={`admin-tab ${tab === 'reports' ? 'admin-tab-active' : ''}`} onClick={() => setTab('reports')}>Reports</button>
        <button className={`admin-tab ${tab === 'goals' ? 'admin-tab-active' : ''}`} onClick={() => setTab('goals')}>Goals</button>
      </div>

      {tab === 'overview' && (
        <>
          <div className="admin-stat-grid">
            <div className="admin-stat-card">
              <div className="admin-stat-icon" style={{ background: '#7c3aed' }}>👥</div>
              <div className="admin-stat-info">
                <span className="admin-stat-value">{managers.length}</span>
                <span className="admin-stat-label">Managers</span>
              </div>
            </div>
            <div className="admin-stat-card">
              <div className="admin-stat-icon" style={{ background: '#2563eb' }}>👤</div>
              <div className="admin-stat-info">
                <span className="admin-stat-value">{employees.filter(e => e.manager_id).length}</span>
                <span className="admin-stat-label">Managed Employees</span>
              </div>
            </div>
            <div className="admin-stat-card">
              <div className="admin-stat-icon" style={{ background: '#059669' }}>✅</div>
              <div className="admin-stat-info">
                <span className="admin-stat-value">{meetings.filter(m => m.status === 'completed').length}</span>
                <span className="admin-stat-label">Completed 1:1s</span>
              </div>
            </div>
            <div className="admin-stat-card">
              <div className="admin-stat-icon" style={{ background: '#d97706' }}>📅</div>
              <div className="admin-stat-info">
                <span className="admin-stat-value">{meetings.filter(m => ['pending', 'accepted'].includes(m.status)).length}</span>
                <span className="admin-stat-label">Upcoming 1:1s</span>
              </div>
            </div>
          </div>

          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th style={{ width: 40 }}></th>
                  <th>Manager</th>
                  <th>Department</th>
                  <th>Direct Reports</th>
                  <th>Total 1:1s</th>
                </tr>
              </thead>
              <tbody>
                {managers.map(mgr => {
                  const reports = getReports(mgr.id)
                  const mgrMeetings = meetings.filter(m => m.manager_id === mgr.id)
                  const isExpanded = expandedManager === mgr.id
                  return (
                    <>
                      <tr key={mgr.id} className="admin-perf-manager-row" onClick={() => setExpandedManager(isExpanded ? null : mgr.id)}>
                        <td>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                            style={{ transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}>
                            <path d="M9 18l6-6-6-6" />
                          </svg>
                        </td>
                        <td>
                          <span className="admin-inline-avatar">{mgr.avatar_url ? <img src={mgr.avatar_url} alt="" /> : <span className="admin-avatar-initials">{mgr.first_name[0]}{mgr.last_name[0]}</span>}<strong>{mgr.first_name} {mgr.last_name}</strong></span>
                          <br /><span style={{ fontSize: '0.8em', opacity: 0.7 }}>{mgr.job_title}</span>
                        </td>
                        <td>{mgr.department}</td>
                        <td>{reports.length}</td>
                        <td>{mgrMeetings.length}</td>
                      </tr>
                      {isExpanded && reports.map(rep => {
                        const repMeetings = getManagerMeetings(mgr.id, rep.id)
                        return (
                          <>
                            <tr key={`${mgr.id}-${rep.id}`} className="admin-perf-report-row">
                              <td></td>
                              <td style={{ paddingLeft: 32 }}>
                                <span className="admin-inline-avatar">{rep.avatar_url ? <img src={rep.avatar_url} alt="" /> : <span className="admin-avatar-initials">{rep.first_name[0]}{rep.last_name[0]}</span>}<span className="admin-perf-report-name">{rep.first_name} {rep.last_name}</span></span>
                                <br /><span style={{ fontSize: '0.8em', opacity: 0.7 }}>{rep.job_title}</span>
                              </td>
                              <td>{rep.department}</td>
                              <td>
                                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                                  <button className="admin-perf-reassign-btn" onClick={e => { e.stopPropagation(); setReassignModal({ employee: rep, currentManagerId: mgr.id }); setNewManagerId('') }}>
                                    Reassign
                                  </button>
                                  {renderELButton(rep)}
                                  {(() => {
                                    const gs = getGoalStats(rep.id)
                                    if (gs.total === 0) return null
                                    return (
                                      <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 6, background: '#eff6ff', color: '#2563eb', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                        🎯 {gs.total} goals · {gs.active} active · {gs.completed} done
                                      </span>
                                    )
                                  })()}
                                </div>
                              </td>
                              <td>{repMeetings.length} meetings</td>
                            </tr>
                            {repMeetings.map(mtg => (
                              <tr key={`mtg-${mtg.id}`} className="admin-perf-meeting-row">
                                <td></td>
                                <td style={{ paddingLeft: 56 }}>
                                  <span className={`admin-perf-meeting-status admin-perf-status-${mtg.status}`}>{mtg.status}</span>
                                  <span className="admin-perf-meeting-date">{formatDate(mtg.scheduled_date)} {mtg.scheduled_time.slice(0, 5)}</span>
                                </td>
                                <td colSpan={3}>
                                  {mtg.summary ? (
                                    <button className="admin-perf-summary-toggle" onClick={() => setExpandedMeeting(expandedMeeting === mtg.id ? null : mtg.id)}>
                                      {expandedMeeting === mtg.id ? 'Hide notes' : 'View notes'}
                                    </button>
                                  ) : (
                                    <span style={{ opacity: 0.5, fontSize: '0.85em' }}>No notes</span>
                                  )}
                                  {expandedMeeting === mtg.id && mtg.summary && (
                                    <div className="admin-perf-summary-text">{mtg.summary}</div>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </>
                        )
                      })}
                    </>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Unmanaged employees */}
          {employees.filter(e => !e.manager_id).length > 0 && (
            <>
              <h2 style={{ margin: '24px 0 12px', fontSize: '1.1em' }}>Unmanaged Employees</h2>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Job Title</th>
                      <th>Department</th>
                      {elearningEnabled && <th>E-Learning</th>}
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employees.filter(e => !e.manager_id).map(emp => (
                      <tr key={emp.id}>
                        <td><span className="admin-inline-avatar">{emp.avatar_url ? <img src={emp.avatar_url} alt="" /> : <span className="admin-avatar-initials">{emp.first_name[0]}{emp.last_name[0]}</span>}<strong>{emp.first_name} {emp.last_name}</strong></span></td>
                        <td>{emp.job_title}</td>
                        <td>{emp.department}</td>
                        {elearningEnabled && <td>{renderELButton(emp)}</td>}
                        <td>
                          <button className="admin-perf-reassign-btn" onClick={() => { setReassignModal({ employee: emp, currentManagerId: null }); setNewManagerId('') }}>
                            Assign Manager
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {tab === 'reports' && (
        <PerformanceReports
          employees={employees}
          meetings={meetings}
          managers={managers}
          nameMap={nameMap}
          fyStartMonth={selectedCompany?.fy_start_month || 4}
        />
      )}

      {tab === 'goals' && (
        <GoalsReport
          employees={employees}
          goals={adminGoals}
          comments={goalComments}
          nameMap={nameMap}
          companyId={selectedCompanyId}
          onRefresh={fetchData}
        />
      )}

      {/* Reassign modal */}
      {reassignModal && (
        <div className="admin-modal-overlay" onClick={() => setReassignModal(null)}>
          <div className="admin-modal" onClick={e => e.stopPropagation()}>
            <h2>Reassign {reassignModal.employee.first_name} {reassignModal.employee.last_name}</h2>
            <p style={{ margin: '8px 0 16px', opacity: 0.7 }}>
              {reassignModal.currentManagerId
                ? `Currently reports to ${nameMap[reassignModal.currentManagerId] || 'Unknown'}`
                : 'No current manager'}
            </p>
            <p style={{ margin: '0 0 8px', fontSize: '0.85em', opacity: 0.6 }}>
              The new manager will see all previous 1:1 meeting history for this employee.
            </p>
            <label style={{ display: 'block', marginBottom: 8, fontWeight: 600 }}>New Manager</label>
            <select className="ts-input" value={newManagerId} onChange={e => setNewManagerId(e.target.value)} style={{ marginBottom: 16 }}>
              <option value="">Select manager...</option>
              <option value="__none__">No manager (unmanaged)</option>
              {employees
                .filter(e => e.id !== reassignModal.employee.id && e.id !== reassignModal.currentManagerId)
                .map(e => (
                  <option key={e.id} value={e.id}>{e.first_name} {e.last_name} — {e.job_title}</option>
                ))}
            </select>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="leave-approve-btn" onClick={handleReassign} disabled={saving || !newManagerId} style={{ flex: 1 }}>
                {saving ? 'Saving...' : 'Confirm Reassignment'}
              </button>
              <button className="leave-decline-btn" onClick={() => setReassignModal(null)} style={{ flex: 1 }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* E-Learning modal */}
      {elModal && (
        <div className="admin-modal-overlay" onClick={() => setElModal(null)}>
          <div className="admin-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <h2 style={{ marginBottom: 4 }}>{elModal.employee.first_name} {elModal.employee.last_name}</h2>
            <p style={{ margin: '0 0 16px', opacity: 0.7, fontSize: '0.9em' }}>Mandatory E-Learning Courses</p>
            {(() => {
              const list = getELCourseList(elModal.employee.id)
              const stats = getELStats(elModal.employee.id)
              return (
                <>
                  <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                    <span style={{ background: '#e8f5e9', color: '#2e7d32', padding: '4px 12px', borderRadius: 6, fontWeight: 700, fontSize: 13 }}>
                      {stats.completed} completed
                    </span>
                    <span style={{ background: stats.completed < stats.required ? '#fff3e0' : '#e8f5e9', color: stats.completed < stats.required ? '#e65100' : '#2e7d32', padding: '4px 12px', borderRadius: 6, fontWeight: 700, fontSize: 13 }}>
                      {stats.required - stats.completed} remaining
                    </span>
                  </div>
                  <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                    <table className="admin-table" style={{ fontSize: 13 }}>
                      <thead>
                        <tr><th>Course</th><th>Category</th><th>Status</th></tr>
                      </thead>
                      <tbody>
                        {list.map(item => (
                          <tr key={item.course.id}>
                            <td><strong>{item.course.title}</strong></td>
                            <td style={{ textTransform: 'capitalize' }}>{item.course.category}</td>
                            <td>
                              {item.completed ? (
                                <span style={{ color: '#2e7d32', fontWeight: 600 }}>
                                  ✓ {new Date(item.completedAt!).toLocaleDateString('en-GB')}
                                </span>
                              ) : (
                                <span style={{ color: '#e65100', fontWeight: 600 }}>Not completed</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {list.length === 0 && <p style={{ textAlign: 'center', opacity: 0.5, padding: 16 }}>No mandatory courses configured</p>}
                  </div>
                </>
              )
            })()}
            <div style={{ marginTop: 16, textAlign: 'right' }}>
              <button className="leave-decline-btn" onClick={() => setElModal(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── Performance Reports ─── */

function PerformanceReports({ employees, meetings, managers, nameMap, fyStartMonth }: {
  employees: Employee[]
  meetings: Meeting[]
  managers: Employee[]
  nameMap: Record<string, string>
  fyStartMonth: number
}) {
  const [reportTab, setReportTab] = useState<'pending' | 'no_meetings'>('pending')

  return (
    <div>
      <div className="admin-tabs" style={{ marginBottom: 12 }}>
        <button className={`admin-tab ${reportTab === 'pending' ? 'admin-tab-active' : ''}`} onClick={() => setReportTab('pending')}>Pending 1:1 Approvals</button>
        <button className={`admin-tab ${reportTab === 'no_meetings' ? 'admin-tab-active' : ''}`} onClick={() => setReportTab('no_meetings')}>No 1:1s by Month</button>
      </div>

      {reportTab === 'pending' && (
        <PendingApprovalsReport meetings={meetings} nameMap={nameMap} managers={managers} />
      )}
      {reportTab === 'no_meetings' && (
        <NoMeetingsReport employees={employees} meetings={meetings} fyStartMonth={fyStartMonth} />
      )}
    </div>
  )
}

/* ─── Report: Pending 1:1 Approvals ─── */

function PendingApprovalsReport({ meetings, nameMap, managers }: {
  meetings: Meeting[]
  nameMap: Record<string, string>
  managers: Employee[]
}) {
  const pendingMeetings = meetings.filter(m => m.status === 'pending')

  const managerPending = useMemo(() => {
    const map: Record<string, { manager: Employee; meetings: Meeting[] }> = {}
    pendingMeetings.forEach(m => {
      const mgr = managers.find(e => e.id === m.manager_id)
      if (!mgr) return
      if (!map[mgr.id]) map[mgr.id] = { manager: mgr, meetings: [] }
      map[mgr.id].meetings.push(m)
    })
    return Object.values(map).sort((a, b) => b.meetings.length - a.meetings.length)
  }, [pendingMeetings, managers])

  return (
    <div>
      <p style={{ fontSize: 12, color: 'var(--text-muted, #888)', marginBottom: 12 }}>
        Managers who have scheduled 1:1 meetings awaiting response from employees.
      </p>

      {managerPending.length === 0 ? (
        <div className="admin-empty">No pending 1:1 approvals</div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Manager</th>
                <th>Department</th>
                <th>Pending Count</th>
                <th>Employees Awaiting</th>
              </tr>
            </thead>
            <tbody>
              {managerPending.map(({ manager, meetings: mts }) => (
                <tr key={manager.id}>
                  <td>
                    <span className="admin-inline-avatar">
                      {manager.avatar_url ? <img src={manager.avatar_url} alt="" /> : <span className="admin-avatar-initials">{manager.first_name[0]}{manager.last_name[0]}</span>}
                      <strong>{manager.first_name} {manager.last_name}</strong>
                    </span>
                  </td>
                  <td>{manager.department || '—'}</td>
                  <td><span style={{ fontWeight: 700, color: '#d97706' }}>{mts.length}</span></td>
                  <td>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {mts.map(m => (
                        <span key={m.id} style={{
                          fontSize: 11, padding: '2px 8px', borderRadius: 4,
                          background: '#fff3e0', color: '#e65100', fontWeight: 600,
                        }}>
                          {nameMap[m.employee_id] || 'Unknown'} — {formatDate(m.scheduled_date)}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/* ─── Goals Report ─── */

function GoalsReport({ employees, goals, comments, nameMap, companyId, onRefresh }: {
  employees: Employee[]
  goals: AdminGoal[]
  comments: AdminGoalComment[]
  nameMap: Record<string, string>
  companyId: string | null
  onRefresh: () => void
}) {
  const PAGE_SIZE = 30
  const { showError, showSuccess } = useToast()
  const [expandedEmp, setExpandedEmp] = useState<string | null>(null)
  const [editingGoal, setEditingGoal] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<Partial<AdminGoal>>({})
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const employeesWithGoals = useMemo(() => {
    const empIds = [...new Set(goals.map(g => g.employee_id))]
    return empIds.map(id => {
      const emp = employees.find(e => e.id === id)
      const empGoals = goals.filter(g => g.employee_id === id)
      return {
        id,
        name: emp ? `${emp.first_name} ${emp.last_name}` : nameMap[id] || 'Unknown',
        job_title: emp?.job_title || '',
        department: emp?.department || '',
        avatar_url: emp?.avatar_url || null,
        goals: empGoals,
        activeCount: empGoals.filter(g => g.status === 'active').length,
        completedCount: empGoals.filter(g => g.status === 'completed').length,
      }
    }).sort((a, b) => a.name.localeCompare(b.name))
  }, [employees, goals, nameMap])

  const filtered = useMemo(() => {
    if (!search.trim()) return employeesWithGoals
    const q = search.toLowerCase()
    return employeesWithGoals.filter(emp =>
      emp.name.toLowerCase().includes(q) ||
      emp.job_title?.toLowerCase().includes(q) ||
      emp.department?.toLowerCase().includes(q) ||
      emp.goals.some(g =>
        g.title.toLowerCase().includes(q) ||
        g.status.toLowerCase().includes(q) ||
        (g.description && g.description.toLowerCase().includes(q))
      )
    )
  }, [employeesWithGoals, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  useEffect(() => { setPage(1) }, [search])

  function startEdit(goal: AdminGoal) {
    setEditingGoal(goal.id)
    setEditDraft({
      title: goal.title,
      description: goal.description,
      status: goal.status,
      grade: goal.grade,
      start_date: goal.start_date,
      due_date: goal.due_date,
    })
  }

  async function saveEdit(goalId: string) {
    if (!companyId) return
    setSaving(true)
    const { error } = await supabase.from('performance_goals').update({
      title: editDraft.title,
      description: editDraft.description || null,
      status: editDraft.status,
      grade: editDraft.grade,
      start_date: editDraft.start_date,
      due_date: editDraft.due_date || null,
      completed_at: editDraft.status === 'completed' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }).eq('id', goalId).eq('company_id', companyId)
    setSaving(false)
    if (error) { showError('Failed to save: ' + error.message); return }
    showSuccess('Goal updated')
    setEditingGoal(null)
    onRefresh()
  }

  return (
    <div>
      <p style={{ fontSize: 12, color: 'var(--text-muted, #888)', marginBottom: 12 }}>
        All performance goals across employees — both manager-set and self-set. Click an employee to view and edit their goals.
      </p>

      <input
        className="admin-input"
        placeholder="Search goals..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{ marginBottom: 12, width: '100%', maxWidth: 320 }}
      />

      {filtered.length === 0 ? (
        <div className="admin-empty">No goals found</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {paginated.map(emp => {
            const isExpanded = expandedEmp === emp.id
            return (
              <div key={emp.id} style={{ border: '1px solid var(--border, #e5e7eb)', borderRadius: 8, overflow: 'hidden' }}>
                <button
                  onClick={() => setExpandedEmp(isExpanded ? null : emp.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, width: '100%',
                    padding: '12px 16px', background: 'var(--bg-card, #fff)',
                    border: 'none', cursor: 'pointer', textAlign: 'left',
                    color: 'var(--text, #1a1a1a)',
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                    style={{ transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }}>
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                  {emp.avatar_url
                    ? <img src={emp.avatar_url} alt="" style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }} />
                    : <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#7c3aed', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700 }}>
                        {emp.name.split(' ').map(n => n[0]).join('').toUpperCase()}
                      </div>
                  }
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ fontSize: 14 }}>{emp.name}</strong>
                    {emp.job_title && <span style={{ fontSize: 12, opacity: 0.6, marginLeft: 8 }}>{emp.job_title}</span>}
                    {emp.department && <span style={{ fontSize: 12, opacity: 0.5, marginLeft: 8 }}>({emp.department})</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 6, background: '#dbeafe', color: '#2563eb' }}>
                      {emp.goals.length} goal{emp.goals.length !== 1 ? 's' : ''}
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 6, background: '#dcfce7', color: '#16a34a' }}>
                      {emp.completedCount} done
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 6, background: '#fef3c7', color: '#d97706' }}>
                      {emp.activeCount} active
                    </span>
                  </div>
                </button>

                {isExpanded && (
                  <div style={{ padding: '0 16px 16px', background: 'var(--bg-card, #fff)' }}>
                    {emp.goals.map(goal => {
                      const isEditing = editingGoal === goal.id
                      const goalCmts = comments.filter(c => c.goal_id === goal.id)
                      const setBy = goal.manager_id ? (nameMap[goal.manager_id] || 'Manager') : 'Self-set'
                      return (
                        <div key={goal.id} style={{
                          border: '1px solid var(--border, #e5e7eb)', borderRadius: 8,
                          padding: 16, marginTop: 8, background: 'var(--bg, #fafafa)',
                        }}>
                          {isEditing ? (
                            <>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                                <div>
                                  <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Title</label>
                                  <input className="ts-input" value={editDraft.title || ''} onChange={e => setEditDraft(d => ({ ...d, title: e.target.value }))} style={{ width: '100%' }} />
                                </div>
                                <div>
                                  <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Status</label>
                                  <select className="ts-input" value={editDraft.status || ''} onChange={e => setEditDraft(d => ({ ...d, status: e.target.value }))}>
                                    {GOAL_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                  </select>
                                </div>
                                <div>
                                  <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Start Date</label>
                                  <input className="ts-input" type="date" value={editDraft.start_date || ''} onChange={e => setEditDraft(d => ({ ...d, start_date: e.target.value }))} style={{ width: '100%', boxSizing: 'border-box' }} />
                                </div>
                                <div>
                                  <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>End Date</label>
                                  <input className="ts-input" type="date" value={editDraft.due_date || ''} onChange={e => setEditDraft(d => ({ ...d, due_date: e.target.value }))} style={{ width: '100%', boxSizing: 'border-box' }} />
                                </div>
                                <div>
                                  <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Score (1–10)</label>
                                  <select className="ts-input" value={editDraft.grade ?? ''} onChange={e => setEditDraft(d => ({ ...d, grade: e.target.value ? Number(e.target.value) : null }))}>
                                    <option value="">No score</option>
                                    {[1,2,3,4,5,6,7,8,9,10].map(n => <option key={n} value={n}>{n}</option>)}
                                  </select>
                                </div>
                              </div>
                              <div style={{ marginBottom: 12 }}>
                                <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Description</label>
                                <textarea className="ts-input" rows={3} value={editDraft.description || ''} onChange={e => setEditDraft(d => ({ ...d, description: e.target.value }))} style={{ width: '100%', resize: 'vertical' }} />
                              </div>
                              <div style={{ display: 'flex', gap: 8 }}>
                                <button className="leave-approve-btn" onClick={() => saveEdit(goal.id)} disabled={saving || !editDraft.title?.trim()} style={{ fontSize: 12, padding: '6px 16px' }}>
                                  {saving ? 'Saving...' : 'Save'}
                                </button>
                                <button className="leave-decline-btn" onClick={() => setEditingGoal(null)} style={{ fontSize: 12, padding: '6px 16px' }}>
                                  Cancel
                                </button>
                              </div>
                            </>
                          ) : (
                            <>
                              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
                                <div style={{ flex: 1 }}>
                                  <strong style={{ fontSize: 14 }}>{goal.title}</strong>
                                  <span style={{ fontSize: 11, opacity: 0.5, marginLeft: 8 }}>Set by: {setBy}</span>
                                </div>
                                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                                  <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 4, ...goalStatusStyle(goal.status) }}>
                                    {GOAL_STATUS_OPTIONS.find(o => o.value === goal.status)?.label || goal.status}
                                  </span>
                                  <button onClick={() => startEdit(goal)} style={{
                                    background: 'none', border: '1px solid var(--border, #d1d5db)',
                                    borderRadius: 4, padding: '3px 10px', fontSize: 11, cursor: 'pointer',
                                    color: 'var(--text, #333)', fontWeight: 600,
                                  }}>
                                    Edit
                                  </button>
                                </div>
                              </div>

                              {goal.description && (
                                <p style={{ fontSize: 13, opacity: 0.8, margin: '0 0 8px', lineHeight: 1.5 }}>{goal.description}</p>
                              )}

                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 12, opacity: 0.7, marginBottom: goalCmts.length > 0 ? 12 : 0 }}>
                                <span>Start: {fmtDateUK(goal.start_date)}</span>
                                <span>End: {fmtDateUK(goal.due_date)}</span>
                                {goal.grade !== null && <span>Score: <strong>{goal.grade}/10</strong></span>}
                                {goal.completed_at && <span>Completed: {fmtDateUK(goal.completed_at)}</span>}
                              </div>

                              {goalCmts.length > 0 && (
                                <div style={{ borderTop: '1px solid var(--border, #e5e7eb)', paddingTop: 8, marginTop: 4 }}>
                                  <span style={{ fontSize: 11, fontWeight: 600, opacity: 0.6, display: 'block', marginBottom: 6 }}>Updates ({goalCmts.length})</span>
                                  {goalCmts.map(c => (
                                    <div key={c.id} style={{ fontSize: 12, padding: '4px 0', display: 'flex', gap: 8 }}>
                                      <span style={{ fontWeight: 600, flexShrink: 0 }}>{c.author_name || 'Unknown'}</span>
                                      <span style={{ opacity: 0.5, flexShrink: 0 }}>{fmtDateUK(c.created_at)}</span>
                                      <span style={{ opacity: 0.8 }}>{c.body}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 16, fontSize: 13 }}>
          <button className="admin-btn" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</button>
          <span>Page {page} of {totalPages}</span>
          <button className="admin-btn" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</button>
        </div>
      )}
    </div>
  )
}

/* ─── Report: No 1:1s by FY Month ─── */

function NoMeetingsReport({ employees, meetings, fyStartMonth }: {
  employees: Employee[]
  meetings: Meeting[]
  fyStartMonth: number
}) {
  const fyMonths = useMemo(() => getFYMonths(fyStartMonth), [fyStartMonth])

  const monthData = useMemo(() => {
    return fyMonths.map(({ year, month, label }) => {
      const startStr = `${year}-${String(month + 1).padStart(2, '0')}-01`
      const endDate = new Date(year, month + 1, 0)
      const endStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`

      const monthMeetings = meetings.filter(m => {
        return m.scheduled_date >= startStr && m.scheduled_date <= endStr &&
          ['completed', 'accepted', 'pending'].includes(m.status)
      })

      const employeesWithMeetings = new Set<string>()
      monthMeetings.forEach(m => {
        employeesWithMeetings.add(m.employee_id)
      })

      const managedEmployees = employees.filter(e => e.manager_id)
      const noMeetings = managedEmployees.filter(e => !employeesWithMeetings.has(e.id))

      return { label, noMeetings, total: managedEmployees.length }
    })
  }, [fyMonths, employees, meetings])

  const now = new Date()
  const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  return (
    <div>
      <p style={{ fontSize: 12, color: 'var(--text-muted, #888)', marginBottom: 12 }}>
        Managed employees who have not had any 1:1 meetings (completed, accepted, or pending) in each month of the financial year.
      </p>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Month</th>
              <th>No 1:1s</th>
              <th>Coverage</th>
              <th>Employees Without 1:1</th>
            </tr>
          </thead>
          <tbody>
            {monthData.map((m, i) => {
              const fyMonth = fyMonths[i]
              const monthKey = `${fyMonth.year}-${String(fyMonth.month + 1).padStart(2, '0')}`
              const isFuture = monthKey > currentMonthStr
              if (isFuture) return (
                <tr key={i} style={{ opacity: 0.4 }}>
                  <td>{m.label}</td>
                  <td colSpan={3} style={{ fontStyle: 'italic', fontSize: 12 }}>Future month</td>
                </tr>
              )
              const coveragePct = m.total > 0 ? ((m.total - m.noMeetings.length) / m.total * 100) : 100
              const coverageColor = coveragePct >= 80 ? '#16a34a' : coveragePct >= 50 ? '#d97706' : '#dc2626'
              return (
                <tr key={i}>
                  <td><strong>{m.label}</strong></td>
                  <td>
                    <span style={{ fontWeight: 700, color: m.noMeetings.length > 0 ? '#dc2626' : '#16a34a' }}>
                      {m.noMeetings.length}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted, #888)' }}> / {m.total}</span>
                  </td>
                  <td>
                    <span style={{ fontWeight: 600, color: coverageColor }}>{coveragePct.toFixed(0)}%</span>
                  </td>
                  <td>
                    {m.noMeetings.length === 0 ? (
                      <span style={{ color: '#16a34a', fontSize: 12 }}>All covered</span>
                    ) : (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 60, overflowY: 'auto' }}>
                        {m.noMeetings.slice(0, 10).map(emp => (
                          <span key={emp.id} style={{
                            fontSize: 11, padding: '2px 8px', borderRadius: 4,
                            background: '#fef2f2', color: '#dc2626', fontWeight: 500,
                          }}>
                            {emp.first_name} {emp.last_name}
                          </span>
                        ))}
                        {m.noMeetings.length > 10 && (
                          <span style={{ fontSize: 11, color: 'var(--text-muted, #888)' }}>+{m.noMeetings.length - 10} more</span>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
