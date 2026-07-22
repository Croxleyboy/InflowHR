import { useState, useMemo } from 'react'

type Priority = 'low' | 'medium' | 'high' | 'urgent'
type TicketStatus = 'open' | 'in-progress' | 'resolved' | 'closed'
type TicketCategory = 'hr-query' | 'payroll' | 'leave' | 'onboarding' | 'offboarding' | 'system-access' | 'benefits' | 'other'

interface Ticket {
  id: string
  ref: string
  title: string
  description: string
  category: TicketCategory
  priority: Priority
  status: TicketStatus
  submittedBy: string
  assignedTo: string
  createdAt: string
  updatedAt: string
}

const INITIAL_TICKETS: Ticket[] = [
  { id: '1', ref: 'HR-001', title: 'Unable to access payslip for June', description: 'Employee reports payslip for June 2026 not showing in the app. Verified the payslip exists in the database but not rendering on the employee view.', category: 'payroll', priority: 'medium', status: 'open', submittedBy: 'Sarah Thompson', assignedTo: 'HR Team', createdAt: '2026-07-18', updatedAt: '2026-07-18' },
  { id: '2', ref: 'HR-002', title: 'New starter equipment not received', description: 'James Wilson joining on 28th July has not received laptop and monitor. Equipment order was raised 10 days ago. Need urgent chase with procurement.', category: 'onboarding', priority: 'high', status: 'in-progress', submittedBy: 'Lisa Chen', assignedTo: 'IT Support', createdAt: '2026-07-15', updatedAt: '2026-07-19' },
  { id: '3', ref: 'HR-003', title: 'Leave balance incorrect after carry-over', description: 'Employee annual leave balance shows 25 days but should be 27 after 2 days carry-over from previous year. Need to adjust leave_balances table.', category: 'leave', priority: 'medium', status: 'open', submittedBy: 'Andy Jones', assignedTo: 'HR Team', createdAt: '2026-07-14', updatedAt: '2026-07-14' },
  { id: '4', ref: 'HR-004', title: 'Benefits enrolment query — dental cover', description: 'Employee asking whether dental cover is included in the health insurance scheme or requires separate sign-up. Need clarification from provider.', category: 'benefits', priority: 'low', status: 'open', submittedBy: 'Emma Davies', assignedTo: 'Benefits Admin', createdAt: '2026-07-12', updatedAt: '2026-07-12' },
  { id: '5', ref: 'HR-005', title: 'Offboarding — revoke system access for leaver', description: 'Mark Robinson left on 11th July. Active Directory account and M365 licence still active. Need to disable account and retrieve equipment.', category: 'offboarding', priority: 'urgent', status: 'in-progress', submittedBy: 'HR Admin', assignedTo: 'IT Support', createdAt: '2026-07-11', updatedAt: '2026-07-20' },
  { id: '6', ref: 'HR-006', title: 'Expense claim stuck in pending', description: 'Expense claim EXP-2026-0042 submitted 3 weeks ago, still showing as pending. Manager says they approved it but status hasn\'t updated.', category: 'hr-query', priority: 'medium', status: 'resolved', submittedBy: 'Tom Harris', assignedTo: 'HR Team', createdAt: '2026-07-05', updatedAt: '2026-07-17' },
  { id: '7', ref: 'HR-007', title: 'Request for flexible working arrangement', description: 'Employee requesting to change to 4-day compressed hours from September. Needs manager approval and contract amendment.', category: 'hr-query', priority: 'low', status: 'closed', submittedBy: 'Rachel Green', assignedTo: 'HR Manager', createdAt: '2026-06-28', updatedAt: '2026-07-10' },
]

const PRIORITY_COLORS: Record<Priority, string> = { low: '#43a047', medium: '#ff9800', high: '#e53935', urgent: '#b71c1c' }
const STATUS_COLORS: Record<TicketStatus, string> = { open: '#ff9800', 'in-progress': '#5b9bd5', resolved: '#43a047', closed: '#78909c' }

export default function AdminTickets() {
  const [tickets, setTickets] = useState<Ticket[]>(INITIAL_TICKETS)
  const [filterStatus, setFilterStatus] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterPriority, setFilterPriority] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Record<string, any>>({})

  function startEdit(t: Ticket) {
    setEditingId(t.id)
    setEditForm({ title: t.title, description: t.description, category: t.category, priority: t.priority, status: t.status, assignedTo: t.assignedTo })
  }

  function saveEdit(id: string) {
    setTickets(prev => prev.map(t => t.id === id ? { ...t, ...editForm, updatedAt: new Date().toISOString().split('T')[0] } as Ticket : t))
    setEditingId(null)
  }

  function deleteTicket(id: string) {
    if (!confirm('Delete this ticket?')) return
    setTickets(prev => prev.filter(t => t.id !== id))
  }

  const filtered = useMemo(() => {
    return tickets.filter(t => {
      if (filterStatus && t.status !== filterStatus) return false
      if (filterCategory && t.category !== filterCategory) return false
      if (filterPriority && t.priority !== filterPriority) return false
      return true
    })
  }, [tickets, filterStatus, filterCategory, filterPriority])

  const stats = useMemo(() => ({
    total: tickets.length,
    open: tickets.filter(t => t.status === 'open').length,
    inProgress: tickets.filter(t => t.status === 'in-progress').length,
    resolved: tickets.filter(t => t.status === 'resolved').length,
    urgent: tickets.filter(t => t.priority === 'urgent' && t.status !== 'closed').length,
  }), [tickets])

  return (
    <div className="admin-section">
      <div className="admin-page-header">
        <h2>HR Ticket Dashboard</h2>
        <p>{tickets.length} tickets</p>
      </div>

      <div className="admin-mini-stats">
        <div className="admin-mini-stat"><span className="admin-mini-value">{stats.total}</span><span>Total</span></div>
        <div className="admin-mini-stat"><span className="admin-mini-value" style={{color:'#ff9800'}}>{stats.open}</span><span>Open</span></div>
        <div className="admin-mini-stat"><span className="admin-mini-value" style={{color:'#5b9bd5'}}>{stats.inProgress}</span><span>In Progress</span></div>
        <div className="admin-mini-stat"><span className="admin-mini-value" style={{color:'#43a047'}}>{stats.resolved}</span><span>Resolved</span></div>
        <div className="admin-mini-stat"><span className="admin-mini-value" style={{color:'#b71c1c'}}>{stats.urgent}</span><span>Urgent</span></div>
      </div>

      <div className="admin-filters">
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="admin-select">
          <option value="">All Statuses</option>
          <option value="open">Open</option><option value="in-progress">In Progress</option><option value="resolved">Resolved</option><option value="closed">Closed</option>
        </select>
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className="admin-select">
          <option value="">All Categories</option>
          <option value="hr-query">HR Query</option><option value="payroll">Payroll</option><option value="leave">Leave</option>
          <option value="onboarding">Onboarding</option><option value="offboarding">Offboarding</option>
          <option value="system-access">System Access</option><option value="benefits">Benefits</option><option value="other">Other</option>
        </select>
        <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)} className="admin-select">
          <option value="">All Priorities</option>
          <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option>
        </select>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead><tr><th>Ref</th><th>Title</th><th>Category</th><th>Priority</th><th>Status</th><th>Assigned</th><th>Actions</th></tr></thead>
          <tbody>
            {filtered.map(t => (
              <>
                <tr key={t.id} className={expandedId === t.id ? 'admin-row-active' : ''}>
                  <td className="admin-td-mono">{t.ref}</td>
                  <td>{editingId === t.id ? <input className="admin-inline-input" value={editForm.title} onChange={e => setEditForm(f => ({...f, title: e.target.value}))} /> : t.title}</td>
                  <td>{editingId === t.id ? (
                    <select className="admin-inline-select" value={editForm.category} onChange={e => setEditForm(f => ({...f, category: e.target.value}))}>
                      <option value="hr-query">HR Query</option><option value="payroll">Payroll</option><option value="leave">Leave</option>
                      <option value="onboarding">Onboarding</option><option value="offboarding">Offboarding</option>
                      <option value="system-access">System Access</option><option value="benefits">Benefits</option><option value="other">Other</option>
                    </select>
                  ) : <span className="admin-badge admin-badge-info">{t.category.replace('-', ' ')}</span>}</td>
                  <td>{editingId === t.id ? (
                    <select className="admin-inline-select" value={editForm.priority} onChange={e => setEditForm(f => ({...f, priority: e.target.value}))}>
                      <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option>
                    </select>
                  ) : <span className="admin-badge" style={{background: PRIORITY_COLORS[t.priority], color: '#fff'}}>{t.priority}</span>}</td>
                  <td>{editingId === t.id ? (
                    <select className="admin-inline-select" value={editForm.status} onChange={e => setEditForm(f => ({...f, status: e.target.value}))}>
                      <option value="open">Open</option><option value="in-progress">In Progress</option><option value="resolved">Resolved</option><option value="closed">Closed</option>
                    </select>
                  ) : <span className="admin-badge" style={{background: STATUS_COLORS[t.status], color: '#fff'}}>{t.status}</span>}</td>
                  <td>{editingId === t.id ? <input className="admin-inline-input" value={editForm.assignedTo} onChange={e => setEditForm(f => ({...f, assignedTo: e.target.value}))} /> : t.assignedTo}</td>
                  <td className="admin-actions">
                    {editingId === t.id ? (
                      <>
                        <button className="admin-btn-sm admin-btn-save" onClick={() => saveEdit(t.id)}>Save</button>
                        <button className="admin-btn-sm admin-btn-cancel" onClick={() => setEditingId(null)}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button className="admin-btn-icon" onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points={expandedId === t.id ? "18 15 12 9 6 15" : "6 9 12 15 18 9"}/></svg>
                        </button>
                        <button className="admin-btn-icon" onClick={() => startEdit(t)}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                        <button className="admin-btn-icon admin-btn-danger" onClick={() => deleteTicket(t.id)}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                      </>
                    )}
                  </td>
                </tr>
                {expandedId === t.id && (
                  <tr key={`exp-${t.id}`} className="admin-expanded-row">
                    <td colSpan={7}>
                      <div className="admin-expanded-content">
                        <p><strong>Description:</strong> {editingId === t.id ? <textarea className="admin-inline-textarea" value={editForm.description} onChange={e => setEditForm(f => ({...f, description: e.target.value}))} /> : t.description}</p>
                        <div className="admin-detail-grid">
                          <div><strong>Submitted by:</strong> {t.submittedBy}</div>
                          <div><strong>Created:</strong> {new Date(t.createdAt).toLocaleDateString('en-GB')}</div>
                          <div><strong>Updated:</strong> {new Date(t.updatedAt).toLocaleDateString('en-GB')}</div>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="admin-empty">No tickets found</div>}
      </div>
    </div>
  )
}
