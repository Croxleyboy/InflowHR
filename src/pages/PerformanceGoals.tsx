import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'

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

export default function PerformanceGoals() {
  const navigate = useNavigate()
  const { employeeId, companyUser } = useAuth()
  const { showError, showSuccess } = useToast()

  const [reports, setReports] = useState<DirectReport[]>([])
  const [goals, setGoals] = useState<Goal[]>([])
  const [loading, setLoading] = useState(true)
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

  const fetchData = useCallback(async () => {
    if (!employeeId || !companyUser?.company_id) return
    setLoading(true)

    const [repRes, goalRes] = await Promise.all([
      supabase.from('employees')
        .select('id, first_name, last_name, job_title, department, avatar_url')
        .eq('manager_id', employeeId)
        .eq('company_id', companyUser.company_id)
        .eq('is_active', true)
        .order('first_name'),
      supabase.from('performance_goals')
        .select('*')
        .eq('manager_id', employeeId)
        .eq('company_id', companyUser.company_id)
        .order('created_at', { ascending: false }),
    ])

    const dr = (repRes.data || []) as DirectReport[]
    setReports(dr)
    setGoals((goalRes.data || []) as Goal[])

    if (dr.length > 0 && !selectedEmpId) {
      setSelectedEmpId(dr[0].id)
    }

    setLoading(false)
  }, [employeeId, companyUser?.company_id])

  useEffect(() => { fetchData() }, [fetchData])

  const selectedReport = reports.find(r => r.id === selectedEmpId)
  const empGoals = goals.filter(g => g.employee_id === selectedEmpId)
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
    if (!formTitle.trim() || !selectedEmpId) return
    setSaving(true)

    const payload = {
      title: formTitle.trim(),
      description: formDesc.trim() || null,
      status: formStatus,
      grade: formGrade,
      start_date: formStart,
      due_date: formDue || null,
      completed_at: formStatus === 'completed' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }

    if (editingGoal) {
      const newStatus = formStatus !== editingGoal.status && formStatus !== 'completed' ? 'edited' : formStatus
      const { error } = await supabase.from('performance_goals')
        .update({ ...payload, status: newStatus })
        .eq('id', editingGoal.id)
        .eq('company_id', companyUser?.company_id)
      if (error) { showError('Failed to update goal'); setSaving(false); return }
      showSuccess('Goal updated')
    } else {
      const { error } = await supabase.from('performance_goals')
        .insert({
          ...payload,
          employee_id: selectedEmpId,
          manager_id: employeeId,
          company_id: companyUser?.company_id,
        })
      if (error) { showError('Failed to create goal'); setSaving(false); return }
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
    setGoals(prev => prev.map(g => g.id === goalId ? { ...g, grade } : g))
  }

  function getInitials(r: DirectReport) {
    return `${(r.first_name || '')[0] || ''}${(r.last_name || '')[0] || ''}`.toUpperCase()
  }

  if (loading) return <div className="pg-page"><p style={{ textAlign: 'center', padding: 40, opacity: 0.6 }}>Loading...</p></div>

  return (
    <>
      <style>{CSS}</style>
      <div className="pg-page">
        <header className="pg-header">
          <button className="pg-back" onClick={() => navigate('/one-to-ones')}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
          <div>
            <h1 className="pg-header-title">Goals & Objectives</h1>
            <p className="pg-header-sub">Manage performance goals for your team</p>
          </div>
        </header>

        <div className="pg-layout">
          {/* ── Left: employee list ── */}
          <div className="pg-sidebar">
            <h3 className="pg-sidebar-title">Managed Employees</h3>
            {reports.length === 0 && <p className="pg-sidebar-empty">No direct reports</p>}
            {reports.map(r => (
              <button
                key={r.id}
                className={`pg-emp-btn ${r.id === selectedEmpId ? 'pg-emp-active' : ''}`}
                onClick={() => { setSelectedEmpId(r.id); setShowForm(false) }}
              >
                {r.avatar_url
                  ? <img className="pg-emp-avatar" src={r.avatar_url} alt="" />
                  : <div className="pg-emp-initials">{getInitials(r)}</div>
                }
                <div className="pg-emp-info">
                  <span className="pg-emp-name">{r.first_name} {r.last_name}</span>
                  <span className="pg-emp-role">{r.job_title || r.department || ''}</span>
                </div>
                <span className="pg-emp-count">{goals.filter(g => g.employee_id === r.id).length}</span>
              </button>
            ))}
          </div>

          {/* ── Right: goals panel ── */}
          <div className="pg-main">
            {selectedReport ? (
              <>
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
                  <div className="pg-main-stats">
                    <div className="pg-stat">
                      <span className="pg-stat-val">{empGoals.length}</span>
                      <span className="pg-stat-lbl">Goals</span>
                    </div>
                    <div className="pg-stat">
                      <span className="pg-stat-val">{empGoals.filter(g => g.status === 'completed').length}</span>
                      <span className="pg-stat-lbl">Done</span>
                    </div>
                    <div className="pg-stat pg-stat-grade">
                      <span className="pg-stat-val">{overallGrade || '—'}</span>
                      <span className="pg-stat-lbl">Overall</span>
                    </div>
                  </div>
                  <button className="pg-add-btn" onClick={openNewGoal}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    New Goal
                  </button>
                </div>

                {empGoals.length === 0 && !showForm && (
                  <div className="pg-empty">
                    <p>No goals set yet for {selectedReport.first_name}.</p>
                    <button className="pg-add-btn" onClick={openNewGoal}>Create First Goal</button>
                  </div>
                )}

                {empGoals.map(g => (
                  <div key={g.id} className="pg-goal-card">
                    <div className="pg-goal-top">
                      <div className="pg-goal-info">
                        <h4 className="pg-goal-title">{g.title}</h4>
                        {g.description && <p className="pg-goal-desc">{g.description}</p>}
                        <div className="pg-goal-meta">
                          <span className="pg-goal-status" style={statusStyle(g.status)}>
                            {STATUS_OPTIONS.find(o => o.value === g.status)?.label || g.status}
                          </span>
                          <span className="pg-goal-dates">
                            {fmtDate(g.start_date)}{g.due_date ? ` — ${fmtDate(g.due_date)}` : ''}
                          </span>
                        </div>
                      </div>
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
                    </div>
                    <div className="pg-goal-actions">
                      <button className="pg-edit-btn" onClick={() => openEditGoal(g)}>Edit</button>
                      <button className="pg-del-btn" onClick={() => handleDelete(g.id)}>Delete</button>
                    </div>
                  </div>
                ))}

                {/* ── Create / Edit form ── */}
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
                      <div className="pg-form-row">
                        <label className="pg-form-label">Grade (1–10)</label>
                        <select className="pg-form-input" value={formGrade ?? ''} onChange={e => setFormGrade(e.target.value ? Number(e.target.value) : null)}>
                          <option value="">Not graded</option>
                          {[1,2,3,4,5,6,7,8,9,10].map(n => <option key={n} value={n}>{n}</option>)}
                        </select>
                      </div>
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
              </>
            ) : (
              <div className="pg-empty"><p>Select an employee to manage their goals.</p></div>
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
  color: var(--text-primary, #1a1a2e);
  min-height: 100vh;
  background: var(--card-bg, #f7f8fa);
}

.pg-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px 24px;
  background: linear-gradient(135deg, #1e3a5f, #2563eb);
  color: #fff;
}
.pg-back {
  background: rgba(255,255,255,0.15);
  border: none;
  border-radius: 10px;
  padding: 6px;
  cursor: pointer;
  display: flex;
}
.pg-header-title { margin: 0; font-size: 20px; font-weight: 700; }
.pg-header-sub { margin: 2px 0 0; font-size: 13px; opacity: 0.8; }

.pg-layout {
  display: flex;
  gap: 0;
  max-width: 1200px;
  margin: 0 auto;
  min-height: calc(100vh - 80px);
}

.pg-sidebar {
  width: 280px;
  min-width: 280px;
  border-right: 1px solid var(--border-color, #e5e7eb);
  padding: 20px 0;
  background: #fff;
  overflow-y: auto;
}
.pg-sidebar-title {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary, #6b7280);
  padding: 0 16px;
  margin: 0 0 12px;
}
.pg-sidebar-empty {
  padding: 16px;
  color: var(--text-secondary, #6b7280);
  font-size: 13px;
}

.pg-emp-btn {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px 16px;
  border: none;
  background: none;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  transition: background 0.15s;
}
.pg-emp-btn:hover { background: #f3f4f6; }
.pg-emp-active { background: #eff6ff !important; border-right: 3px solid #2563eb; }
.pg-emp-avatar { width: 36px; height: 36px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }
.pg-emp-initials {
  width: 36px; height: 36px; border-radius: 50%;
  background: var(--border-color, #e5e7eb);
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 700; color: var(--text-secondary, #6b7280);
  flex-shrink: 0;
}
.pg-emp-info { flex: 1; min-width: 0; }
.pg-emp-name { display: block; font-size: 14px; font-weight: 600; color: var(--text-primary, #1a1a2e); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pg-emp-role { display: block; font-size: 12px; color: var(--text-secondary, #6b7280); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pg-emp-count {
  background: #e5e7eb; color: #374151;
  font-size: 11px; font-weight: 700;
  padding: 2px 8px; border-radius: 100px;
  flex-shrink: 0;
}
.pg-emp-active .pg-emp-count { background: #2563eb; color: #fff; }

.pg-main {
  flex: 1;
  padding: 24px;
  overflow-y: auto;
}

.pg-main-header {
  display: flex;
  align-items: center;
  gap: 20px;
  margin-bottom: 24px;
  flex-wrap: wrap;
}
.pg-main-person { display: flex; align-items: center; gap: 14px; flex: 1; min-width: 0; }
.pg-main-avatar { width: 48px; height: 48px; border-radius: 50%; object-fit: cover; }
.pg-main-initials {
  width: 48px; height: 48px; border-radius: 50%;
  background: var(--border-color, #e5e7eb);
  display: flex; align-items: center; justify-content: center;
  font-size: 16px; font-weight: 700; color: var(--text-secondary, #6b7280);
}
.pg-main-name { margin: 0; font-size: 18px; font-weight: 700; }
.pg-main-role { margin: 2px 0 0; font-size: 13px; color: var(--text-secondary, #6b7280); }

.pg-main-stats { display: flex; gap: 16px; }
.pg-stat {
  text-align: center;
  padding: 8px 16px;
  background: #fff;
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 12px;
}
.pg-stat-val { display: block; font-size: 22px; font-weight: 800; color: var(--text-primary, #1a1a2e); }
.pg-stat-lbl { font-size: 11px; color: var(--text-secondary, #6b7280); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
.pg-stat-grade .pg-stat-val { color: #2563eb; }

.pg-add-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 20px;
  background: #2563eb;
  color: #fff;
  border: none;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.2s;
}
.pg-add-btn:hover { background: #1d4ed8; }

.pg-empty {
  text-align: center;
  padding: 60px 20px;
  color: var(--text-secondary, #6b7280);
}
.pg-empty p { margin: 0 0 16px; }

/* Goal card */
.pg-goal-card {
  background: #fff;
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 14px;
  padding: 20px;
  margin-bottom: 12px;
  transition: box-shadow 0.2s;
}
.pg-goal-card:hover { box-shadow: 0 4px 16px rgba(0,0,0,0.06); }
.pg-goal-top { display: flex; gap: 20px; align-items: flex-start; }
.pg-goal-info { flex: 1; min-width: 0; }
.pg-goal-title { margin: 0 0 4px; font-size: 15px; font-weight: 700; }
.pg-goal-desc { margin: 0 0 8px; font-size: 13px; color: var(--text-secondary, #6b7280); line-height: 1.5; }
.pg-goal-meta { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.pg-goal-status {
  font-size: 11px; font-weight: 700; padding: 3px 10px;
  border-radius: 6px; text-transform: uppercase; letter-spacing: 0.03em;
}
.pg-goal-dates { font-size: 12px; color: var(--text-secondary, #6b7280); }

.pg-goal-grade-wrap {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.pg-grade-select {
  width: 52px; padding: 6px 4px; text-align: center;
  border: 2px solid var(--border-color, #e5e7eb);
  border-radius: 8px; font-size: 18px; font-weight: 800;
  font-family: inherit; color: #2563eb; cursor: pointer;
  background: #fff;
}
.pg-grade-select:focus { border-color: #2563eb; outline: none; }
.pg-grade-label { font-size: 13px; color: var(--text-secondary, #6b7280); font-weight: 600; }

.pg-goal-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border-color, #e5e7eb);
}
.pg-edit-btn, .pg-del-btn {
  padding: 6px 14px; border-radius: 8px; font-size: 12px; font-weight: 600;
  cursor: pointer; border: none; font-family: inherit; transition: background 0.15s;
}
.pg-edit-btn { background: #eff6ff; color: #2563eb; }
.pg-edit-btn:hover { background: #dbeafe; }
.pg-del-btn { background: #fef2f2; color: #dc2626; }
.pg-del-btn:hover { background: #fee2e2; }

/* Form */
.pg-form-card {
  background: #fff;
  border: 2px solid #2563eb;
  border-radius: 14px;
  padding: 24px;
  margin-top: 16px;
}
.pg-form-title { margin: 0 0 16px; font-size: 16px; font-weight: 700; }
.pg-form-row { margin-bottom: 14px; }
.pg-form-label { display: block; font-size: 12px; font-weight: 700; margin-bottom: 4px; color: var(--text-secondary, #6b7280); text-transform: uppercase; letter-spacing: 0.04em; }
.pg-form-input, .pg-form-textarea {
  width: 100%; padding: 10px 12px; border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 8px; font-size: 14px; font-family: inherit;
  color: var(--text-primary, #1a1a2e); background: var(--card-bg, #f7f8fa);
  box-sizing: border-box;
}
.pg-form-input:focus, .pg-form-textarea:focus { border-color: #2563eb; outline: none; }
.pg-form-textarea { resize: vertical; }
.pg-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.pg-form-actions { display: flex; gap: 10px; margin-top: 16px; }
.pg-save-btn {
  padding: 10px 24px; background: #2563eb; color: #fff; border: none;
  border-radius: 10px; font-size: 14px; font-weight: 700; cursor: pointer;
  font-family: inherit; transition: background 0.2s;
}
.pg-save-btn:hover:not(:disabled) { background: #1d4ed8; }
.pg-save-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.pg-cancel-btn {
  padding: 10px 24px; background: #f3f4f6; color: var(--text-primary, #1a1a2e);
  border: none; border-radius: 10px; font-size: 14px; font-weight: 600;
  cursor: pointer; font-family: inherit;
}
.pg-cancel-btn:hover { background: #e5e7eb; }
`
