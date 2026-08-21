import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useLanguage } from '../context/LanguageContext'

interface DirectReport {
  id: string
  first_name: string
  last_name: string
  job_title: string | null
  department: string | null
  avatar_url: string | null
}

interface Goal {
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

interface GoalComment {
  id: string
  goal_id: string
  author_id: string
  body: string
  created_at: string
  author_name?: string
}

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active', color: '#2563eb', bg: '#dbeafe' },
  { value: 'completed', label: 'Completed', color: '#16a34a', bg: '#dcfce7' },
  { value: 'edited', label: 'Edited', color: '#d97706', bg: '#fef3c7' },
  { value: 'on_hold', label: 'On Hold', color: '#6b7280', bg: '#f3f4f6' },
  { value: 'cancelled', label: 'Cancelled', color: '#dc2626', bg: '#fee2e2' },
]

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

function statusStyle(status: string) {
  const s = STATUS_OPTIONS.find(o => o.value === status)
  return s ? { background: s.bg, color: s.color } : {}
}

function getFyRange(fyStartMonth: number): { start: string; end: string; label: string } {
  const now = new Date()
  const curMonth = now.getMonth() + 1
  const fyYear = curMonth >= fyStartMonth ? now.getFullYear() : now.getFullYear() - 1
  const start = `${fyYear}-${String(fyStartMonth).padStart(2, '0')}-01`
  const endMonth = fyStartMonth === 1 ? 12 : fyStartMonth - 1
  const endYear = fyStartMonth === 1 ? fyYear : fyYear + 1
  const endDay = new Date(endYear, endMonth, 0).getDate()
  const end = `${endYear}-${String(endMonth).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`
  const label = fyStartMonth === 1 ? `${fyYear}` : `${fyYear}/${fyYear + 1}`
  return { start, end, label }
}

export default function PerformanceGoals() {
  const navigate = useNavigate()
  const { employeeId, employeeName, companyUser, isManager } = useAuth()
  const { showError, showSuccess } = useToast()
  const { fyStartMonth } = useLanguage()

  const [reports, setReports] = useState<DirectReport[]>([])
  const [allGoals, setAllGoals] = useState<Goal[]>([])
  const [comments, setComments] = useState<GoalComment[]>([])
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<'manager' | 'my'>('my')
  const [selectedEmpId, setSelectedEmpId] = useState<string | null>(null)

  const [showForm, setShowForm] = useState(false)
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null)
  const [formTitle, setFormTitle] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [formStatus, setFormStatus] = useState('active')
  const [formGrade, setFormGrade] = useState<number | null>(null)
  const [formStart, setFormStart] = useState(new Date().toISOString().split('T')[0])
  const [formDue, setFormDue] = useState('')
  const [saving, setSaving] = useState(false)

  const [expandedGoal, setExpandedGoal] = useState<string | null>(null)
  const [newComment, setNewComment] = useState('')
  const [commentSaving, setCommentSaving] = useState(false)

  const fy = getFyRange(fyStartMonth)

  const fetchData = useCallback(async () => {
    if (!employeeId || !companyUser?.company_id) return
    setLoading(true)
    const cid = companyUser.company_id

    const [repRes, goalRes, cmtRes] = await Promise.all([
      supabase.from('employees')
        .select('id, first_name, last_name, job_title, department, avatar_url')
        .eq('manager_id', employeeId)
        .eq('company_id', cid)
        .eq('is_active', true)
        .order('first_name'),
      supabase.from('performance_goals')
        .select('*')
        .eq('company_id', cid)
        .or(`manager_id.eq.${employeeId},employee_id.eq.${employeeId}`)
        .gte('start_date', fy.start)
        .lte('start_date', fy.end)
        .order('created_at', { ascending: false }),
      supabase.from('performance_goal_comments')
        .select('*')
        .eq('company_id', cid)
        .order('created_at', { ascending: true }),
    ])

    const dr = (repRes.data || []) as DirectReport[]
    setReports(dr)
    setAllGoals((goalRes.data || []) as Goal[])

    const rawComments = (cmtRes.data || []) as GoalComment[]
    const authorIds = [...new Set(rawComments.map(c => c.author_id))]
    if (authorIds.length > 0) {
      const { data: authors } = await supabase.from('employees')
        .select('id, first_name, last_name').in('id', authorIds).eq('company_id', cid)
      const nameMap = new Map((authors || []).map((a: any) => [a.id, `${a.first_name} ${a.last_name}`]))
      setComments(rawComments.map(c => ({ ...c, author_name: nameMap.get(c.author_id) || 'Unknown' })))
    } else {
      setComments([])
    }

    if (isManager && dr.length > 0) {
      setMode('manager')
      if (!selectedEmpId) setSelectedEmpId(dr[0].id)
    } else {
      setMode('my')
      setSelectedEmpId(employeeId)
    }

    setLoading(false)
  }, [employeeId, companyUser?.company_id, fy.start, fy.end])

  useEffect(() => { fetchData() }, [fetchData])

  const isManagerMode = mode === 'manager'
  const viewingEmpId = isManagerMode ? selectedEmpId : employeeId
  const selectedReport = reports.find(r => r.id === selectedEmpId)
  const empGoals = allGoals.filter(g => g.employee_id === viewingEmpId)
  const gradedGoals = empGoals.filter(g => g.grade !== null)
  const overallGrade = gradedGoals.length > 0
    ? (gradedGoals.reduce((sum, g) => sum + (g.grade || 0), 0) / gradedGoals.length).toFixed(1)
    : null

  function openNewGoal() {
    setEditingGoal(null)
    setFormTitle('')
    setFormDesc('')
    setFormStatus('active')
    setFormGrade(null)
    setFormStart(new Date().toISOString().split('T')[0])
    setFormDue('')
    setShowForm(true)
  }

  function openEditGoal(g: Goal) {
    setEditingGoal(g)
    setFormTitle(g.title)
    setFormDesc(g.description || '')
    setFormStatus(g.status)
    setFormGrade(g.grade)
    setFormStart(g.start_date)
    setFormDue(g.due_date || '')
    setShowForm(true)
  }

  async function handleSave() {
    if (!formTitle.trim() || !viewingEmpId) return
    setSaving(true)

    const isSelfGoal = !isManagerMode
    const payload = {
      title: formTitle.trim(),
      description: formDesc.trim() || null,
      status: formStatus,
      grade: isSelfGoal ? null : formGrade,
      start_date: formStart,
      due_date: formDue || null,
      completed_at: formStatus === 'completed' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }

    if (editingGoal) {
      const updatePayload: any = { ...payload }
      if (isSelfGoal) delete updatePayload.grade
      const { error } = await supabase.from('performance_goals')
        .update(updatePayload)
        .eq('id', editingGoal.id)
        .eq('company_id', companyUser?.company_id)
      if (error) { showError('Failed to update goal'); setSaving(false); return }
      showSuccess('Goal updated')
    } else {
      const { error } = await supabase.from('performance_goals')
        .insert({
          ...payload,
          employee_id: viewingEmpId,
          manager_id: isSelfGoal ? null : employeeId,
          company_id: companyUser?.company_id,
        })
      if (error) { showError('Failed to create goal'); setSaving(false); return }

      if (isManagerMode && selectedEmpId) {
        const empName = selectedReport ? `${selectedReport.first_name} ${selectedReport.last_name}` : ''
        const { data: empData } = await supabase.from('employees')
          .select('email').eq('id', selectedEmpId).eq('company_id', companyUser?.company_id).single()
        if (empData) {
          await supabase.from('workflow_tracker').insert({
            emp_display_name: empName,
            step: 1,
            status: 'Complete',
            record_type: 'Goal',
            action: 'Performance goal set',
            employee_email: empData.email,
            assigned_to: empData.email,
            approval_id: null,
            reminder_count: 1,
            task_description: `${employeeName} set a new performance goal for you: "${formTitle.trim().slice(0, 80)}"`,
            approval_status: 'Approved',
            company_id: companyUser?.company_id,
          })
          window.dispatchEvent(new Event('notifications-updated'))
        }
      }
      showSuccess('Goal created')
    }

    setSaving(false)
    setShowForm(false)
    fetchData()
  }

  async function handleDelete(goalId: string) {
    if (!confirm('Delete this goal?')) return
    await supabase.from('performance_goals').delete().eq('id', goalId).eq('company_id', companyUser?.company_id)
    fetchData()
  }

  async function handleGradeChange(goalId: string, grade: number | null) {
    await supabase.from('performance_goals')
      .update({ grade, updated_at: new Date().toISOString() })
      .eq('id', goalId).eq('company_id', companyUser?.company_id)
    setAllGoals(prev => prev.map(g => g.id === goalId ? { ...g, grade } : g))
  }

  async function handleAddComment(goalId: string) {
    if (!newComment.trim()) return
    setCommentSaving(true)
    const { error } = await supabase.from('performance_goal_comments').insert({
      goal_id: goalId,
      author_id: employeeId,
      body: newComment.trim(),
      company_id: companyUser?.company_id,
    })
    if (error) { showError('Failed to add comment'); setCommentSaving(false); return }
    setNewComment('')
    setCommentSaving(false)
    fetchData()
  }

  function getInitials(r: { first_name: string; last_name: string }) {
    return `${(r.first_name || '')[0] || ''}${(r.last_name || '')[0] || ''}`.toUpperCase()
  }

  function canEditGoal(g: Goal): boolean {
    return g.manager_id === employeeId || (g.employee_id === employeeId && !g.manager_id)
  }

  if (loading) return <><style>{CSS}</style><div className="pg-page"><p style={{ textAlign: 'center', padding: 40, opacity: 0.6 }}>Loading...</p></div></>

  return (
    <>
      <style>{CSS}</style>
      <div className="pg-page">
        <header className="pg-header">
          <button className="pg-back" onClick={() => navigate('/one-to-ones')}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
          <div style={{ flex: 1 }}>
            <h1 className="pg-header-title">Goals &amp; Objectives</h1>
            <p className="pg-header-sub">FY {fy.label}</p>
          </div>
          {isManager && (
            <div className="pg-mode-toggle">
              <button className={`pg-mode-btn ${mode === 'my' ? 'pg-mode-active' : ''}`} onClick={() => { setMode('my'); setSelectedEmpId(employeeId!); setShowForm(false) }}>My Goals</button>
              <button className={`pg-mode-btn ${mode === 'manager' ? 'pg-mode-active' : ''}`} onClick={() => { setMode('manager'); setSelectedEmpId(reports[0]?.id || null); setShowForm(false) }}>Team Goals</button>
            </div>
          )}
        </header>

        {/* ── Summary bar ── */}
        <div className="pg-summary-bar">
          <div className="pg-summary-item">
            <span className="pg-summary-val">{empGoals.length}</span>
            <span className="pg-summary-lbl">Total Goals</span>
          </div>
          <div className="pg-summary-item">
            <span className="pg-summary-val" style={{ color: '#2563eb' }}>{empGoals.filter(g => g.status === 'active').length}</span>
            <span className="pg-summary-lbl">Active</span>
          </div>
          <div className="pg-summary-item">
            <span className="pg-summary-val" style={{ color: '#16a34a' }}>{empGoals.filter(g => g.status === 'completed').length}</span>
            <span className="pg-summary-lbl">Completed</span>
          </div>
          {isManagerMode && overallGrade && (
            <div className="pg-summary-item">
              <span className="pg-summary-val" style={{ color: '#7c3aed' }}>{overallGrade}</span>
              <span className="pg-summary-lbl">Avg Grade</span>
            </div>
          )}
        </div>

        <div className="pg-layout">
          {/* ── Left sidebar (desktop) / dropdown (mobile) ── */}
          {isManagerMode && (
            <>
              <div className="pg-sidebar pg-desktop-only">
                <h3 className="pg-sidebar-title">Managed Employees</h3>
                {reports.length === 0 && <p className="pg-sidebar-empty">No direct reports</p>}
                {reports.map(r => {
                  const rGoals = allGoals.filter(g => g.employee_id === r.id)
                  return (
                    <button
                      key={r.id}
                      className={`pg-emp-btn ${r.id === selectedEmpId ? 'pg-emp-active' : ''}`}
                      onClick={() => { setSelectedEmpId(r.id); setShowForm(false); setExpandedGoal(null) }}
                    >
                      {r.avatar_url
                        ? <img className="pg-emp-avatar" src={r.avatar_url} alt="" />
                        : <div className="pg-emp-initials">{getInitials(r)}</div>
                      }
                      <div className="pg-emp-info">
                        <span className="pg-emp-name">{r.first_name} {r.last_name}</span>
                        <span className="pg-emp-role">{r.job_title || r.department || ''}</span>
                      </div>
                      <span className="pg-emp-count">{rGoals.length}</span>
                    </button>
                  )
                })}
              </div>
              <div className="pg-mobile-emp-select pg-mobile-only">
                <select
                  className="pg-form-input"
                  value={selectedEmpId || ''}
                  onChange={e => { setSelectedEmpId(e.target.value); setShowForm(false); setExpandedGoal(null) }}
                >
                  {reports.map(r => (
                    <option key={r.id} value={r.id}>
                      {r.first_name} {r.last_name} — {allGoals.filter(g => g.employee_id === r.id).length} goals
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {/* ── Right: goals panel ── */}
          <div className="pg-main">
            {isManagerMode && selectedReport && (
              <div className="pg-main-header">
                <div className="pg-main-person">
                  {selectedReport.avatar_url
                    ? <img className="pg-main-avatar" src={selectedReport.avatar_url} alt="" />
                    : <div className="pg-main-initials">{getInitials(selectedReport)}</div>
                  }
                  <div>
                    <h2 className="pg-main-name">{selectedReport.first_name} {selectedReport.last_name}</h2>
                    <p className="pg-main-role">{selectedReport.job_title}{selectedReport.department ? ` · ${selectedReport.department}` : ''}</p>
                  </div>
                </div>
                <button className="pg-add-btn" onClick={openNewGoal}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  New Goal
                </button>
              </div>
            )}

            {!isManagerMode && (
              <div className="pg-main-header">
                <h2 className="pg-main-name" style={{ margin: 0 }}>My Goals</h2>
                <button className="pg-add-btn" onClick={openNewGoal}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  New Goal
                </button>
              </div>
            )}

            {empGoals.length === 0 && !showForm && (
              <div className="pg-empty">
                <p>No goals for this financial year yet.</p>
                <button className="pg-add-btn" onClick={openNewGoal}>Create First Goal</button>
              </div>
            )}

            {empGoals.map(g => {
              const goalComments = comments.filter(c => c.goal_id === g.id)
              const isExpanded = expandedGoal === g.id
              const editable = canEditGoal(g)
              const isMgrGoal = !!g.manager_id
              return (
                <div key={g.id} className="pg-goal-card">
                  <div className="pg-goal-top">
                    <div className="pg-goal-info">
                      <div className="pg-goal-title-row">
                        <h4 className="pg-goal-title">{g.title}</h4>
                        {isMgrGoal && <span className="pg-goal-source">Manager</span>}
                        {!isMgrGoal && <span className="pg-goal-source pg-goal-source-self">Self</span>}
                      </div>
                      {g.description && <p className="pg-goal-desc">{g.description}</p>}
                      <div className="pg-goal-meta">
                        <span className="pg-goal-status" style={statusStyle(g.status)}>
                          {STATUS_OPTIONS.find(o => o.value === g.status)?.label || g.status}
                        </span>
                        <span className="pg-goal-dates">
                          {fmtDate(g.start_date)}{g.due_date ? ` — ${fmtDate(g.due_date)}` : ''}
                        </span>
                        {goalComments.length > 0 && (
                          <span className="pg-goal-comment-count">{goalComments.length} update{goalComments.length !== 1 ? 's' : ''}</span>
                        )}
                      </div>
                    </div>
                    {isManagerMode && (
                      <div className="pg-goal-grade-wrap">
                        <select
                          className="pg-grade-select"
                          value={g.grade ?? ''}
                          onChange={e => handleGradeChange(g.id, e.target.value ? Number(e.target.value) : null)}
                        >
                          <option value="">—</option>
                          {[1,2,3,4,5,6,7,8,9,10].map(n => (
                            <option key={n} value={n}>{n}</option>
                          ))}
                        </select>
                        <span className="pg-grade-label">/ 10</span>
                      </div>
                    )}
                    {!isManagerMode && g.grade !== null && (
                      <div className="pg-goal-grade-readonly">
                        <span className="pg-grade-val">{g.grade}</span>
                        <span className="pg-grade-label">/ 10</span>
                      </div>
                    )}
                  </div>

                  <div className="pg-goal-actions">
                    {editable && <button className="pg-edit-btn" onClick={() => openEditGoal(g)}>Edit</button>}
                    {editable && <button className="pg-del-btn" onClick={() => handleDelete(g.id)}>Delete</button>}
                    <button className="pg-comment-toggle" onClick={() => { setExpandedGoal(isExpanded ? null : g.id); setNewComment('') }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                      {isExpanded ? 'Hide Updates' : `Updates (${goalComments.length})`}
                    </button>
                  </div>

                  {isExpanded && (
                    <div className="pg-comments-section">
                      {goalComments.map(c => (
                        <div key={c.id} className="pg-comment">
                          <div className="pg-comment-head">
                            <strong>{c.author_name}</strong>
                            <span className="pg-comment-date">{fmtDate(c.created_at)}</span>
                          </div>
                          <p className="pg-comment-body">{c.body}</p>
                        </div>
                      ))}
                      {goalComments.length === 0 && <p className="pg-comment-empty">No updates yet</p>}
                      <div className="pg-comment-add">
                        <textarea
                          className="pg-comment-input"
                          placeholder="Add an update..."
                          value={newComment}
                          onChange={e => setNewComment(e.target.value)}
                          rows={2}
                        />
                        <button className="pg-comment-submit" onClick={() => handleAddComment(g.id)} disabled={commentSaving || !newComment.trim()}>
                          {commentSaving ? 'Posting...' : 'Post Update'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}

            {showForm && (
              <div className="pg-form-card">
                <h3 className="pg-form-title">{editingGoal ? 'Edit Goal' : 'New Goal'}</h3>
                <div className="pg-form-row">
                  <label className="pg-form-label">Title *</label>
                  <input className="pg-form-input" value={formTitle} onChange={e => setFormTitle(e.target.value)} placeholder="e.g. Achieve New Sales Target" />
                </div>
                <div className="pg-form-row">
                  <label className="pg-form-label">Description</label>
                  <textarea className="pg-form-textarea" value={formDesc} onChange={e => setFormDesc(e.target.value)} rows={3} placeholder="Details about this goal..." />
                </div>
                <div className="pg-form-grid">
                  <div className="pg-form-row">
                    <label className="pg-form-label">Status</label>
                    <select className="pg-form-input" value={formStatus} onChange={e => setFormStatus(e.target.value)}>
                      {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  {isManagerMode && (
                    <div className="pg-form-row">
                      <label className="pg-form-label">Grade (1–10)</label>
                      <select className="pg-form-input" value={formGrade ?? ''} onChange={e => setFormGrade(e.target.value ? Number(e.target.value) : null)}>
                        <option value="">Not graded</option>
                        {[1,2,3,4,5,6,7,8,9,10].map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </div>
                  )}
                  <div className="pg-form-row">
                    <label className="pg-form-label">Start Date</label>
                    <input className="pg-form-input" type="date" value={formStart} onChange={e => setFormStart(e.target.value)} />
                  </div>
                  <div className="pg-form-row">
                    <label className="pg-form-label">Due Date</label>
                    <input className="pg-form-input" type="date" value={formDue} onChange={e => setFormDue(e.target.value)} />
                  </div>
                </div>
                <div className="pg-form-actions">
                  <button className="pg-save-btn" onClick={handleSave} disabled={saving || !formTitle.trim()}>
                    {saving ? 'Saving...' : (editingGoal ? 'Update Goal' : 'Create Goal')}
                  </button>
                  <button className="pg-cancel-btn" onClick={() => setShowForm(false)}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

const CSS = `
.pg-page {
  font-family: var(--sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
  color: var(--text);
  min-height: 100vh;
  background: var(--bg);
}
.pg-header {
  display: flex; align-items: center; gap: 16px;
  padding: 20px 24px;
  background: linear-gradient(135deg, #1e3a5f, #2563eb);
  color: #fff;
}
.pg-back { background: rgba(255,255,255,0.15); border: none; border-radius: 10px; padding: 6px; cursor: pointer; display: flex; }
.pg-header-title { margin: 0; font-size: 20px; font-weight: 700; }
.pg-header-sub { margin: 2px 0 0; font-size: 13px; opacity: 0.8; }

.pg-mode-toggle { display: flex; background: rgba(255,255,255,0.15); border-radius: 10px; overflow: hidden; }
.pg-mode-btn { padding: 8px 18px; border: none; background: none; color: rgba(255,255,255,0.7); font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; transition: all 0.2s; }
.pg-mode-active { background: rgba(255,255,255,0.25); color: #fff; }

.pg-summary-bar {
  display: flex; gap: 24px; padding: 16px 24px;
  background: var(--bg-card); border-bottom: 1px solid var(--border);
}
.pg-summary-item { text-align: center; }
.pg-summary-val { display: block; font-size: 24px; font-weight: 800; color: var(--text); }
.pg-summary-lbl { font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }

.pg-layout { display: flex; gap: 0; min-height: calc(100vh - 140px); }

.pg-sidebar {
  width: 280px; min-width: 280px;
  border-right: 1px solid var(--border);
  padding: 20px 0; background: var(--bg-card); overflow-y: auto;
}
.pg-sidebar-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); padding: 0 16px; margin: 0 0 12px; }
.pg-sidebar-empty { padding: 16px; color: var(--text-muted); font-size: 13px; }

.pg-emp-btn { display: flex; align-items: center; gap: 12px; width: 100%; padding: 12px 16px; border: none; background: none; cursor: pointer; text-align: left; font-family: inherit; transition: background 0.15s; color: var(--text); }
.pg-emp-btn:hover { background: var(--border); }
.pg-emp-active { background: #eff6ff !important; border-right: 3px solid #2563eb; }
[data-theme="dark"] .pg-emp-active { background: #1e3a5f !important; }
.pg-emp-avatar { width: 36px; height: 36px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }
.pg-emp-initials { width: 36px; height: 36px; border-radius: 50%; background: var(--border); display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; color: var(--text-muted); flex-shrink: 0; }
.pg-emp-info { flex: 1; min-width: 0; }
.pg-emp-name { display: block; font-size: 14px; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pg-emp-role { display: block; font-size: 12px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pg-emp-count { background: var(--border); color: var(--text); font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 100px; flex-shrink: 0; }
.pg-emp-active .pg-emp-count { background: #2563eb; color: #fff; }

.pg-main { flex: 1; padding: 24px; overflow-y: auto; max-width: 100%; }

.pg-main-header { display: flex; align-items: center; gap: 20px; margin-bottom: 24px; flex-wrap: wrap; }
.pg-main-person { display: flex; align-items: center; gap: 14px; flex: 1; min-width: 0; }
.pg-main-avatar { width: 48px; height: 48px; border-radius: 50%; object-fit: cover; }
.pg-main-initials { width: 48px; height: 48px; border-radius: 50%; background: var(--border); display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: 700; color: var(--text-muted); }
.pg-main-name { margin: 0; font-size: 18px; font-weight: 700; color: var(--text); }
.pg-main-role { margin: 2px 0 0; font-size: 13px; color: var(--text-muted); }

.pg-add-btn { display: inline-flex; align-items: center; gap: 6px; padding: 10px 20px; background: #2563eb; color: #fff; border: none; border-radius: 10px; font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit; transition: background 0.2s; flex-shrink: 0; }
.pg-add-btn:hover { background: #1d4ed8; }

.pg-empty { text-align: center; padding: 60px 20px; color: var(--text-muted); }
.pg-empty p { margin: 0 0 16px; }

/* Goal card */
.pg-goal-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 14px; padding: 20px 24px; margin-bottom: 14px; transition: box-shadow 0.2s; }
.pg-goal-card:hover { box-shadow: 0 4px 16px rgba(0,0,0,0.06); }
[data-theme="dark"] .pg-goal-card:hover { box-shadow: 0 4px 16px rgba(0,0,0,0.3); }
.pg-goal-top { display: flex; gap: 20px; align-items: flex-start; }
.pg-goal-info { flex: 1; min-width: 0; }
.pg-goal-title-row { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.pg-goal-title { margin: 0; font-size: 16px; font-weight: 700; color: var(--text); }
.pg-goal-source { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 4px; background: #eff6ff; color: #2563eb; text-transform: uppercase; letter-spacing: 0.04em; flex-shrink: 0; }
.pg-goal-source-self { background: #f0fdf4; color: #16a34a; }
[data-theme="dark"] .pg-goal-source { background: #1e3a5f; color: #60a5fa; }
[data-theme="dark"] .pg-goal-source-self { background: #14532d; color: #4ade80; }
.pg-goal-desc { margin: 0 0 10px; font-size: 14px; color: var(--text-muted); line-height: 1.6; }
.pg-goal-meta { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.pg-goal-status { font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 6px; text-transform: uppercase; letter-spacing: 0.03em; }
.pg-goal-dates { font-size: 13px; color: var(--text-muted); }
.pg-goal-comment-count { font-size: 12px; color: #7c3aed; font-weight: 600; }

.pg-goal-grade-wrap { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.pg-grade-select { width: 52px; padding: 6px 4px; text-align: center; border: 2px solid var(--border); border-radius: 8px; font-size: 18px; font-weight: 800; font-family: inherit; color: #2563eb; cursor: pointer; background: var(--bg-card); }
.pg-grade-select:focus { border-color: #2563eb; outline: none; }
.pg-grade-label { font-size: 13px; color: var(--text-muted); font-weight: 600; }
.pg-goal-grade-readonly { display: flex; align-items: baseline; gap: 2px; flex-shrink: 0; }
.pg-grade-val { font-size: 24px; font-weight: 800; color: #2563eb; }

.pg-goal-actions { display: flex; gap: 8px; align-items: center; margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--border); }
.pg-edit-btn, .pg-del-btn, .pg-comment-toggle { padding: 6px 14px; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; border: none; font-family: inherit; transition: background 0.15s; display: inline-flex; align-items: center; gap: 5px; }
.pg-edit-btn { background: #eff6ff; color: #2563eb; }
.pg-edit-btn:hover { background: #dbeafe; }
.pg-del-btn { background: #fef2f2; color: #dc2626; }
.pg-del-btn:hover { background: #fee2e2; }
.pg-comment-toggle { background: #f5f3ff; color: #7c3aed; margin-left: auto; }
.pg-comment-toggle:hover { background: #ede9fe; }
[data-theme="dark"] .pg-edit-btn { background: #1e3a5f; color: #60a5fa; }
[data-theme="dark"] .pg-edit-btn:hover { background: #1e4976; }
[data-theme="dark"] .pg-del-btn { background: #451a1a; color: #fca5a5; }
[data-theme="dark"] .pg-del-btn:hover { background: #5c1e1e; }
[data-theme="dark"] .pg-comment-toggle { background: #2e1065; color: #c4b5fd; }
[data-theme="dark"] .pg-comment-toggle:hover { background: #3b1580; }

/* Comments */
.pg-comments-section { margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--border); }
.pg-comment { padding: 10px 0; border-bottom: 1px solid var(--border); }
.pg-comment:last-of-type { border-bottom: none; }
.pg-comment-head { display: flex; gap: 8px; align-items: center; margin-bottom: 4px; }
.pg-comment-head strong { font-size: 13px; color: var(--text); }
.pg-comment-date { font-size: 11px; color: var(--text-muted); }
.pg-comment-body { margin: 0; font-size: 14px; line-height: 1.5; color: var(--text); }
.pg-comment-empty { font-size: 13px; color: var(--text-muted); text-align: center; padding: 12px; }
.pg-comment-add { display: flex; gap: 8px; margin-top: 10px; }
.pg-comment-input { flex: 1; padding: 8px 12px; border: 1px solid var(--border); border-radius: 8px; font-size: 13px; font-family: inherit; resize: none; background: var(--bg); color: var(--text); }
.pg-comment-input:focus { border-color: #7c3aed; outline: none; }
.pg-comment-submit { padding: 8px 16px; background: #7c3aed; color: #fff; border: none; border-radius: 8px; font-size: 12px; font-weight: 700; cursor: pointer; font-family: inherit; white-space: nowrap; align-self: flex-end; }
.pg-comment-submit:disabled { opacity: 0.5; cursor: not-allowed; }

/* Form */
.pg-form-card { background: var(--bg-card); border: 2px solid #2563eb; border-radius: 14px; padding: 24px; margin-top: 16px; }
.pg-form-title { margin: 0 0 16px; font-size: 16px; font-weight: 700; color: var(--text); }
.pg-form-row { margin-bottom: 14px; }
.pg-form-label { display: block; font-size: 12px; font-weight: 700; margin-bottom: 4px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
.pg-form-input, .pg-form-textarea { width: 100%; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; font-size: 14px; font-family: inherit; color: var(--text); background: var(--bg); box-sizing: border-box; }
.pg-form-input:focus, .pg-form-textarea:focus { border-color: #2563eb; outline: none; }
.pg-form-textarea { resize: vertical; }
.pg-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.pg-form-actions { display: flex; gap: 10px; margin-top: 16px; }
.pg-save-btn { padding: 10px 24px; background: #2563eb; color: #fff; border: none; border-radius: 10px; font-size: 14px; font-weight: 700; cursor: pointer; font-family: inherit; transition: background 0.2s; }
.pg-save-btn:hover:not(:disabled) { background: #1d4ed8; }
.pg-save-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.pg-cancel-btn { padding: 10px 24px; background: var(--border); color: var(--text); border: none; border-radius: 10px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit; }
.pg-cancel-btn:hover { background: var(--text-muted); color: #fff; }

/* Mobile / Desktop visibility */
.pg-mobile-only { display: none; }
.pg-mobile-emp-select { padding: 0 16px 12px; }

@media (max-width: 768px) {
  .pg-desktop-only { display: none !important; }
  .pg-mobile-only { display: block !important; }

  .pg-header { padding: 14px 16px; gap: 10px; flex-wrap: wrap; }
  .pg-header-title { font-size: 17px; }
  .pg-mode-toggle { width: 100%; justify-content: center; }
  .pg-mode-btn { flex: 1; text-align: center; padding: 8px 12px; }

  .pg-summary-bar { gap: 0; padding: 12px 16px; justify-content: space-around; }
  .pg-summary-val { font-size: 20px; }
  .pg-summary-lbl { font-size: 10px; }

  .pg-layout { flex-direction: column; min-height: auto; }
  .pg-main { padding: 16px; }

  .pg-main-header { gap: 12px; }
  .pg-main-person { gap: 10px; }
  .pg-main-avatar, .pg-main-initials { width: 38px; height: 38px; }
  .pg-main-name { font-size: 16px; }
  .pg-add-btn { width: 100%; justify-content: center; padding: 12px; font-size: 14px; }

  .pg-goal-card { padding: 14px 16px; border-radius: 12px; }
  .pg-goal-top { flex-direction: column; gap: 10px; }
  .pg-goal-title-row { flex-wrap: wrap; }
  .pg-goal-title { font-size: 15px; }
  .pg-goal-meta { gap: 8px; }
  .pg-goal-grade-wrap { align-self: flex-start; }
  .pg-goal-grade-readonly { align-self: flex-start; }
  .pg-grade-val { font-size: 20px; }

  .pg-goal-actions { flex-wrap: wrap; gap: 6px; }
  .pg-comment-toggle { margin-left: 0; width: 100%; justify-content: center; }

  .pg-comment-add { flex-direction: column; }
  .pg-comment-submit { align-self: stretch; text-align: center; }

  .pg-form-card { padding: 16px; border-radius: 12px; }
  .pg-form-grid { grid-template-columns: 1fr; }
  .pg-form-actions { flex-direction: column; }
  .pg-save-btn, .pg-cancel-btn { width: 100%; text-align: center; }

  .pg-empty { padding: 40px 16px; }
}
`
