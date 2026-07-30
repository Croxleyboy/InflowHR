import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useAdminCompany } from '../../context/AdminCompanyContext'

interface WorkflowRow {
  id: number
  emp_display_name: string
  step: number
  status: string
  record_type: string
  action: string
  employee_email: string
  assigned_to: string
  approval_id: number | null
  task_description: string | null
  approval_status: string | null
  created_at: string
  company_id: string
}

const STATUS_OPTIONS = ['Pending', 'Complete']
const TYPE_OPTIONS = ['Expense', 'Leave', 'Timesheet', 'Meeting', 'Birthday', 'Kudos']

function formatDateTime(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function defaultFrom() {
  const d = new Date()
  d.setDate(d.getDate() - 30)
  return d.toISOString().split('T')[0]
}
function defaultTo() {
  return new Date().toISOString().split('T')[0]
}

export default function AdminNotifications() {
  const { selectedCompanyId } = useAdminCompany()
  const [rows, setRows] = useState<WorkflowRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterEmployee, setFilterEmployee] = useState('')
  const [dateFrom, setDateFrom] = useState(defaultFrom)
  const [dateTo, setDateTo] = useState(defaultTo)

  useEffect(() => { if (selectedCompanyId) load() }, [selectedCompanyId])

  async function load() {
    setLoading(true)
    const fromISO = new Date(dateFrom).toISOString()
    const toDate = new Date(dateTo)
    toDate.setHours(23, 59, 59, 999)
    const toISO = toDate.toISOString()

    const { data } = await supabase
      .from('workflow_tracker')
      .select('*')
      .eq('company_id', selectedCompanyId)
      .gte('created_at', fromISO)
      .lte('created_at', toISO)
      .order('created_at', { ascending: false })
      .limit(500)
    setRows((data as WorkflowRow[]) || [])
    setLoading(false)
  }

  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (filterStatus && r.status !== filterStatus) return false
      if (filterType && r.record_type !== filterType) return false
      if (filterEmployee) {
        const q = filterEmployee.toLowerCase()
        const name = (r.emp_display_name || '').toLowerCase()
        const email = (r.employee_email || '').toLowerCase()
        if (!name.includes(q) && !email.includes(q)) return false
      }
      return true
    })
  }, [rows, filterStatus, filterType, filterEmployee])

  const stats = useMemo(() => ({
    total: rows.length,
    pending: rows.filter(r => r.status === 'Pending').length,
    complete: rows.filter(r => r.status === 'Complete').length,
  }), [rows])

  const statusBadge = (status: string) => {
    if (status === 'Pending') return 'admin-badge-pending'
    if (status === 'Complete') return 'admin-badge-approved'
    return ''
  }

  const typeBadge = (type: string) => {
    switch (type) {
      case 'Expense': return { bg: '#e3f2fd', color: '#1565c0' }
      case 'Leave': return { bg: '#fce4ec', color: '#c62828' }
      case 'Timesheet': return { bg: '#e8f5e9', color: '#2e7d32' }
      case 'Meeting': return { bg: '#f3e5f5', color: '#7b1fa2' }
      case 'Birthday': return { bg: '#fff8e1', color: '#f57f17' }
      case 'Kudos': return { bg: '#fff3e0', color: '#e65100' }
      default: return { bg: '#f5f5f5', color: '#616161' }
    }
  }

  return (
    <div className="admin-section">
      <div className="admin-section-header">
        <h2>Notifications / Benachrichtigungen</h2>
        <p className="admin-section-subtitle">All employee workflow notifications for the selected company / Alle Mitarbeiter-Benachrichtigungen für das ausgewählte Unternehmen</p>
      </div>

      <div className="admin-mini-stats">
        <div className="admin-mini-stat"><span className="admin-mini-value">{stats.total}</span><span>Total / Gesamt</span></div>
        <div className="admin-mini-stat"><span className="admin-mini-value" style={{ color: '#e65100' }}>{stats.pending}</span><span>Pending / Ausstehend</span></div>
        <div className="admin-mini-stat"><span className="admin-mini-value" style={{ color: '#43a047' }}>{stats.complete}</span><span>Complete / Abgeschlossen</span></div>
      </div>

      <div className="admin-filters">
        <div className="admin-filter-group">
          <label className="admin-filter-label">From / Von</label>
          <input type="date" className="admin-select" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        </div>
        <div className="admin-filter-group">
          <label className="admin-filter-label">To / Bis</label>
          <input type="date" className="admin-select" value={dateTo} onChange={e => setDateTo(e.target.value)} />
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="admin-select">
          <option value="">All Statuses / Alle Status</option>
          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filterType} onChange={e => setFilterType(e.target.value)} className="admin-select">
          <option value="">All Types / Alle Typen</option>
          {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <input
          type="text"
          placeholder="Search employee... / Mitarbeiter suchen..."
          value={filterEmployee}
          onChange={e => setFilterEmployee(e.target.value)}
          className="admin-select"
          style={{ minWidth: 200 }}
        />
        <button className="admin-btn-sm admin-btn-save" onClick={load}>Apply / Anwenden</button>
      </div>

      {loading ? <div className="admin-loading">Loading...</div> : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Date / Datum</th>
                <th>Employee / Mitarbeiter</th>
                <th>Type / Typ</th>
                <th>Status</th>
                <th>Action / Aktion</th>
                <th>Assigned To / Zugewiesen an</th>
                <th>Description / Beschreibung</th>
                <th>Approval / Genehmigung</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const tb = typeBadge(r.record_type)
                return (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(r.created_at)}</td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ fontWeight: 700 }}>{r.emp_display_name}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.employee_email}</span>
                      </div>
                    </td>
                    <td>
                      <span style={{ background: tb.bg, color: tb.color, padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 700 }}>
                        {r.record_type}
                      </span>
                    </td>
                    <td><span className={`admin-badge ${statusBadge(r.status)}`}>{r.status}</span></td>
                    <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.action}</td>
                    <td style={{ fontSize: 12 }}>{r.assigned_to}</td>
                    <td style={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>{r.task_description || '—'}</td>
                    <td>
                      {r.approval_status
                        ? <span className={`admin-badge ${r.approval_status === 'Approved' ? 'admin-badge-approved' : r.approval_status === 'Declined' ? 'admin-badge-rejected' : ''}`}>{r.approval_status}</span>
                        : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {filtered.length === 0 && <div className="admin-empty">No notifications found for this period / Keine Benachrichtigungen für diesen Zeitraum gefunden</div>}
        </div>
      )}
    </div>
  )
}
