import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'

interface OnboardRecord {
  id: number
  firstname: string
  surname: string
  user_email: string
  job_title: string
  department: string
  start_date: string
  status: string
  manager: string
  manager_email: string
  personal_email: string
  location: string
  telephone: string
  employee_number: string
  contract_type: string
  equipment_order: string
  is_complete: boolean
  first_day: boolean
  first_week: boolean
  first_month: boolean
  elearning: boolean
  created_at: string
}

const WORKFLOW_STEPS = [
  { key: 'details', label: 'Create Starter Details', icon: '📋', description: 'Capture personal information, role details, start date and contract type for the new employee.' },
  { key: 'equipment', label: 'Order Equipment', icon: '💻', description: 'Raise equipment requests — laptop, monitor, keyboard, headset, building pass. Select device type and delivery address.' },
  { key: 'meeting', label: 'Organise First Meeting', icon: '🤝', description: 'Schedule welcome meeting with manager. Send calendar invite and prepare agenda covering first week expectations.' },
  { key: 'notify_manager', label: 'Notify Manager', icon: '📧', description: 'Inform the line manager of confirmed start date, equipment status and onboarding checklist. Share new starter profile.' },
  { key: 'plan_day1', label: 'Plan First Day', icon: '📅', description: 'Prepare day-one schedule: building access, desk assignment, welcome pack, team introductions and lunch arrangements.' },
  { key: 'inform_starter', label: 'Inform Starter', icon: '✉️', description: 'Send welcome email to the new starter with start date, office location, dress code, parking info and first day schedule.' },
  { key: 'accounts', label: 'Create Accounts & Licences', icon: '🔐', description: 'Create Active Directory / Entra account, assign Microsoft 365 licence, add to security groups and distribution lists. Generate temporary password.' },
  { key: 'day1_access', label: 'Day 1 Access Verification', icon: '✅', description: 'Confirm the new starter can log in, access email, Teams, shared drives and all required business applications on their first day.' },
]

export default function AdminOnboarding() {
  const [records, setRecords] = useState<OnboardRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'dashboard' | 'new' | 'list' | 'workflow'>('dashboard')
  const [filterStatus, setFilterStatus] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [workflowStep, setWorkflowStep] = useState(0)
  const [stepChecks, setStepChecks] = useState<Record<string, boolean>>({})
  const [stepSkips, setStepSkips] = useState<Record<string, boolean>>({})
  const [newForm, setNewForm] = useState<Record<string, string>>({
    firstname: '', surname: '', user_email: '', job_title: '', department: '',
    start_date: '', manager: '', manager_email: '', personal_email: '',
    location: '', telephone: '', employee_number: '', contract_type: 'Full-time',
  })

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('onboarding').select('*').order('created_at', { ascending: false })
    setRecords((data as OnboardRecord[]) || [])
    setLoading(false)
  }

  async function createStarter() {
    if (!newForm.firstname || !newForm.surname || !newForm.user_email) return
    const { data } = await supabase.from('onboarding').insert({
      ...newForm, status: 'new', is_complete: false,
    }).select().single()
    if (data) {
      setSelectedId(data.id)
      setWorkflowStep(0)
      setStepChecks({})
      setTab('workflow')
      load()
    }
  }

  async function updateOnboardStatus(id: number, updates: Record<string, any>) {
    await supabase.from('onboarding').update(updates).eq('id', id)
    load()
  }

  async function deleteRecord(id: number) {
    if (!confirm('Delete this onboarding record?')) return
    await supabase.from('onboarding').delete().eq('id', id)
    setRecords(prev => prev.filter(r => r.id !== id))
  }

  function openWorkflow(record: OnboardRecord) {
    setSelectedId(record.id)
    const checks: Record<string, boolean> = {
      details: true,
      equipment: record.equipment_order === 'Y',
      meeting: record.first_day,
      notify_manager: record.first_day,
      plan_day1: record.first_day,
      inform_starter: record.first_week,
      accounts: record.elearning,
      day1_access: record.is_complete,
    }
    setStepChecks(checks)
    const skipped = (record as any).skipped_steps
    setStepSkips(skipped && typeof skipped === 'object' ? skipped : {})
    const doneCount = WORKFLOW_STEPS.filter(s => checks[s.key] || (skipped && skipped[s.key])).length
    setWorkflowStep(record.is_complete ? WORKFLOW_STEPS.length - 1 : Math.min(doneCount, WORKFLOW_STEPS.length - 1))
    setTab('workflow')
  }

  async function completeStep(stepKey: string) {
    setStepChecks(prev => ({ ...prev, [stepKey]: true }))
    setStepSkips(prev => ({ ...prev, [stepKey]: false }))
    const record = records.find(r => r.id === selectedId)
    if (!record) return
    const updates: Record<string, any> = {}
    if (stepKey === 'equipment') updates.equipment_order = 'Y'
    if (stepKey === 'plan_day1' || stepKey === 'meeting' || stepKey === 'notify_manager') updates.first_day = true
    if (stepKey === 'inform_starter') updates.first_week = true
    if (stepKey === 'accounts') {
      updates.elearning = true
      await createEmployeeFromOnboard(record)
    }
    if (stepKey === 'day1_access') {
      updates.is_complete = true; updates.status = 'Onboarded'; updates.appstatus = 'active'
      await supabase.from('employees').update({ is_active: true }).eq('email', record.user_email)
    }
    if (!updates.status) updates.status = 'in-progress'
    const newSkips = { ...stepSkips, [stepKey]: false }
    updates.skipped_steps = newSkips
    updateOnboardStatus(record.id, updates)
    if (workflowStep < WORKFLOW_STEPS.length - 1) setWorkflowStep(workflowStep + 1)
  }

  function skipStep(stepKey: string) {
    setStepSkips(prev => ({ ...prev, [stepKey]: true }))
    const record = records.find(r => r.id === selectedId)
    if (!record) return
    const newSkips = { ...stepSkips, [stepKey]: true }
    updateOnboardStatus(record.id, { skipped_steps: newSkips, status: 'in-progress' })
    if (workflowStep < WORKFLOW_STEPS.length - 1) setWorkflowStep(workflowStep + 1)
  }

  function uncompleteStep(stepKey: string) {
    setStepChecks(prev => ({ ...prev, [stepKey]: false }))
    setStepSkips(prev => ({ ...prev, [stepKey]: false }))
  }

  async function createEmployeeFromOnboard(record: OnboardRecord) {
    const { data: existing } = await supabase.from('employees').select('id').eq('email', record.user_email).maybeSingle()
    if (existing) return
    const empNum = record.employee_number || `EMP-${Date.now().toString().slice(-6)}`
    await supabase.from('employees').insert({
      employee_number: empNum,
      first_name: record.firstname,
      last_name: record.surname,
      email: record.user_email,
      job_title: record.job_title || '',
      department: record.department || '',
      start_date: record.start_date || new Date().toISOString().split('T')[0],
      phone: record.telephone || '',
      is_admin: false,
      is_active: false,
    })
  }

  const stats = useMemo(() => {
    const now = new Date()
    const thisMonth = now.getMonth()
    const thisYear = now.getFullYear()
    return {
      total: records.length,
      thisMonth: records.filter(r => { const d = new Date(r.created_at); return d.getMonth() === thisMonth && d.getFullYear() === thisYear }).length,
      thisYear: records.filter(r => new Date(r.created_at).getFullYear() === thisYear).length,
      pending: records.filter(r => !r.is_complete).length,
      dueJoining: records.filter(r => !r.is_complete && r.start_date && new Date(r.start_date) > now).length,
      completed: records.filter(r => r.is_complete).length,
    }
  }, [records])

  const filtered = useMemo(() => {
    if (!filterStatus) return records
    if (filterStatus === 'pending') return records.filter(r => !r.is_complete)
    if (filterStatus === 'completed') return records.filter(r => r.is_complete)
    return records.filter(r => r.status === filterStatus)
  }, [records, filterStatus])

  const selectedRecord = records.find(r => r.id === selectedId)

  return (
    <div className="admin-section">
      <div className="admin-page-header">
        <h2>Onboarding Management</h2>
        <p>{records.length} onboarding records</p>
      </div>

      <div className="admin-tabs">
        <button className={`admin-tab ${tab === 'dashboard' ? 'admin-tab-active' : ''}`} onClick={() => setTab('dashboard')}>Dashboard</button>
        <button className={`admin-tab ${tab === 'new' ? 'admin-tab-active' : ''}`} onClick={() => setTab('new')}>New Starter</button>
        <button className={`admin-tab ${tab === 'list' ? 'admin-tab-active' : ''}`} onClick={() => setTab('list')}>All Records</button>
        {selectedId && <button className={`admin-tab ${tab === 'workflow' ? 'admin-tab-active' : ''}`} onClick={() => setTab('workflow')}>Workflow</button>}
      </div>

      {tab === 'dashboard' && (
        <div className="admin-onboard-dash">
          <div className="admin-mini-stats">
            <div className="admin-mini-stat"><span className="admin-mini-value">{stats.total}</span><span>Total</span></div>
            <div className="admin-mini-stat"><span className="admin-mini-value" style={{color:'#e91e63'}}>{stats.thisMonth}</span><span>This Month</span></div>
            <div className="admin-mini-stat"><span className="admin-mini-value" style={{color:'#5b9bd5'}}>{stats.thisYear}</span><span>This Year</span></div>
            <div className="admin-mini-stat"><span className="admin-mini-value" style={{color:'#ff9800'}}>{stats.pending}</span><span>Pending</span></div>
            <div className="admin-mini-stat"><span className="admin-mini-value" style={{color:'#7b1fa2'}}>{stats.dueJoining}</span><span>Due to Join</span></div>
            <div className="admin-mini-stat"><span className="admin-mini-value" style={{color:'#43a047'}}>{stats.completed}</span><span>Completed</span></div>
          </div>
        </div>
      )}

      {tab === 'new' && (
        <div className="admin-add-form">
          <h3>Create New Starter</h3>
          <div className="admin-form-grid">
            {[
              { key: 'firstname', label: 'First Name' }, { key: 'surname', label: 'Surname' },
              { key: 'user_email', label: 'Work Email' }, { key: 'personal_email', label: 'Personal Email' },
              { key: 'job_title', label: 'Job Title' }, { key: 'department', label: 'Department' },
              { key: 'manager', label: 'Manager Name' }, { key: 'manager_email', label: 'Manager Email' },
              { key: 'location', label: 'Location' }, { key: 'telephone', label: 'Phone' },
              { key: 'employee_number', label: 'Employee Number' },
            ].map(f => (
              <div key={f.key} className="admin-form-field">
                <label>{f.label}</label>
                <input className="admin-input" value={newForm[f.key]} onChange={e => setNewForm(p => ({...p, [f.key]: e.target.value}))} />
              </div>
            ))}
            <div className="admin-form-field">
              <label>Start Date</label>
              <input type="date" className="admin-input" value={newForm.start_date} onChange={e => setNewForm(p => ({...p, start_date: e.target.value}))} />
            </div>
            <div className="admin-form-field">
              <label>Contract Type</label>
              <select className="admin-select" value={newForm.contract_type} onChange={e => setNewForm(p => ({...p, contract_type: e.target.value}))}>
                <option>Full-time</option><option>Part-time</option><option>Contract</option><option>Guest</option>
              </select>
            </div>
          </div>
          <button className="admin-btn admin-btn-primary" onClick={createStarter}>Create & Start Workflow</button>
        </div>
      )}

      {tab === 'list' && (
        <>
          <div className="admin-filters">
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="admin-select">
              <option value="">All</option>
              <option value="pending">Pending</option>
              <option value="completed">Completed</option>
            </select>
          </div>
          {loading ? <div className="admin-loading">Loading...</div> : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>Name</th><th>Role</th><th>Start Date</th><th>Status</th><th>Progress</th><th>Actions</th></tr></thead>
                <tbody>
                  {filtered.map(r => {
                    const skipped = (r as any).skipped_steps || {}
                    const completedSteps = [true, r.equipment_order === 'Y', r.first_day, r.first_day, r.first_day, r.first_week, r.elearning, r.is_complete].filter(Boolean).length
                    const skippedCount = Object.values(skipped).filter(Boolean).length
                    const totalDone = completedSteps + skippedCount
                    return (
                      <tr key={r.id}>
                        <td><strong>{r.firstname} {r.surname}</strong></td>
                        <td>{r.job_title || '—'}</td>
                        <td>{r.start_date ? new Date(r.start_date).toLocaleDateString('en-GB') : '—'}</td>
                        <td><span className={`admin-badge ${r.is_complete ? 'admin-badge-approved' : 'admin-badge-pending'}`}>{r.is_complete ? 'Onboarded' : r.status}</span></td>
                        <td>
                          <div className="admin-progress-bar"><div className="admin-progress-fill" style={{width: `${(totalDone / WORKFLOW_STEPS.length) * 100}%`}} /></div>
                          <span className="admin-progress-text">{completedSteps}/{WORKFLOW_STEPS.length}{skippedCount > 0 ? ` (${skippedCount} skipped)` : ''}</span>
                        </td>
                        <td className="admin-actions">
                          <button className="admin-btn-sm admin-btn-save" onClick={() => openWorkflow(r)}>Workflow</button>
                          <button className="admin-btn-icon admin-btn-danger" onClick={() => deleteRecord(r.id)}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {filtered.length === 0 && <div className="admin-empty">No onboarding records</div>}
            </div>
          )}
        </>
      )}

      {tab === 'workflow' && selectedRecord && (
        <div className="admin-workflow">
          <div className="admin-workflow-header">
            <h3>{selectedRecord.firstname} {selectedRecord.surname}</h3>
            <p>{selectedRecord.job_title} · Starting {selectedRecord.start_date ? new Date(selectedRecord.start_date).toLocaleDateString('en-GB') : 'TBC'}</p>
          </div>
          <div className="admin-workflow-timeline">
            {WORKFLOW_STEPS.map((step, i) => {
              const done = stepChecks[step.key]
              const skipped = stepSkips[step.key]
              const isCurrent = i === workflowStep
              return (
                <div key={step.key} className={`admin-wf-step ${done ? 'admin-wf-done' : ''} ${skipped ? 'admin-wf-skipped' : ''} ${isCurrent ? 'admin-wf-current' : ''}`} onClick={() => setWorkflowStep(i)}>
                  <div className="admin-wf-connector" />
                  <div className="admin-wf-dot">{done ? '✓' : skipped ? '⏭' : step.icon}</div>
                  <div className="admin-wf-content">
                    <h4>{step.label}{skipped && <span className="admin-wf-skip-badge">Skipped</span>}</h4>
                    {isCurrent && (
                      <div className="admin-wf-detail">
                        <p>{step.description}</p>
                        <div className="admin-wf-actions">
                          {done ? (
                            <button className="admin-btn-sm admin-btn-cancel" onClick={e => { e.stopPropagation(); uncompleteStep(step.key) }}>Undo</button>
                          ) : skipped ? (
                            <>
                              <button className="admin-btn-sm admin-btn-save" onClick={e => { e.stopPropagation(); completeStep(step.key) }}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                                Mark Complete
                              </button>
                              <button className="admin-btn-sm admin-btn-cancel" onClick={e => { e.stopPropagation(); uncompleteStep(step.key) }}>Undo Skip</button>
                            </>
                          ) : (
                            <>
                              <button className="admin-btn-sm admin-btn-save" onClick={e => { e.stopPropagation(); completeStep(step.key) }}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                                Mark Complete
                              </button>
                              {step.key !== 'details' && (
                                <button className="admin-btn-sm admin-btn-skip" onClick={e => { e.stopPropagation(); skipStep(step.key) }}>
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5 4 15 12 5 20"/><line x1="19" y1="5" x2="19" y2="19"/></svg>
                                  Skip
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
