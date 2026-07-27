import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAdminCompany } from '../../context/AdminCompanyContext'

interface Employee {
  id: string
  first_name: string
  last_name: string
  job_title: string | null
  department: string | null
  email: string
  manager_id: string | null
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

export default function AdminPerformance() {
  const { selectedCompanyId } = useAdminCompany()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedManager, setExpandedManager] = useState<string | null>(null)
  const [expandedMeeting, setExpandedMeeting] = useState<number | null>(null)
  const [reassignModal, setReassignModal] = useState<{ employee: Employee; currentManagerId: string | null } | null>(null)
  const [newManagerId, setNewManagerId] = useState('')
  const [saving, setSaving] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    let q = supabase.from('employees')
      .select('id, first_name, last_name, job_title, department, email, manager_id')
      .eq('is_active', true)
      .order('first_name')
    if (selectedCompanyId) q = q.eq('company_id', selectedCompanyId)
    const { data: emps } = await q
    setEmployees((emps || []) as Employee[])

    let mq = supabase.from('one_to_one_meetings')
      .select('*')
      .order('scheduled_date', { ascending: false })
    if (selectedCompanyId) mq = mq.eq('company_id', selectedCompanyId)
    const { data: mtgs } = await mq
    setMeetings((mtgs || []) as Meeting[])
    setLoading(false)
  }, [selectedCompanyId])

  useEffect(() => { fetchData() }, [fetchData])

  const managers = employees.filter(e => employees.some(r => r.manager_id === e.id))
  const getReports = (managerId: string) => employees.filter(e => e.manager_id === managerId)
  const getManagerMeetings = (managerId: string, empId: string) =>
    meetings.filter(m => m.manager_id === managerId && m.employee_id === empId)
  const nameMap: Record<string, string> = {}
  employees.forEach(e => { nameMap[e.id] = `${e.first_name} ${e.last_name}` })

  async function handleReassign() {
    if (!reassignModal || !newManagerId) return
    setSaving(true)
    await supabase.from('employees')
      .update({ manager_id: newManagerId === '__none__' ? null : newManagerId })
      .eq('id', reassignModal.employee.id)
    setSaving(false)
    setReassignModal(null)
    setNewManagerId('')
    fetchData()
  }

  function formatDate(dateStr: string) {
    const d = new Date(dateStr + 'T00:00:00')
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
  }

  if (loading) return <div className="admin-page"><p className="claims-empty">Loading...</p></div>

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Performance &amp; 1:1 Meetings</h1>
        <p className="admin-page-subtitle">Manager hierarchy, direct reports, and meeting history</p>
      </div>

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

      <div className="admin-table-wrapper">
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
                      <strong>{mgr.first_name} {mgr.last_name}</strong>
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
                            <span className="admin-perf-report-name">{rep.first_name} {rep.last_name}</span>
                            <br /><span style={{ fontSize: '0.8em', opacity: 0.7 }}>{rep.job_title}</span>
                          </td>
                          <td>{rep.department}</td>
                          <td>
                            <button className="admin-perf-reassign-btn" onClick={e => { e.stopPropagation(); setReassignModal({ employee: rep, currentManagerId: mgr.id }); setNewManagerId('') }}>
                              Reassign
                            </button>
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
          <div className="admin-table-wrapper">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Job Title</th>
                  <th>Department</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {employees.filter(e => !e.manager_id).map(emp => (
                  <tr key={emp.id}>
                    <td><strong>{emp.first_name} {emp.last_name}</strong></td>
                    <td>{emp.job_title}</td>
                    <td>{emp.department}</td>
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
    </div>
  )
}
