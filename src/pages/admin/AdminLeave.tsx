import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { useLanguage } from '../../context/LanguageContext'

interface LeaveRequest {
  id: number
  start_date: string
  end_date: string
  days_requested: number
  status: string
  reason: string | null
  created_at: string
  leave_type: { name: string } | null
  employee: { first_name: string; last_name: string } | null
}

const STATUS_OPTIONS = ['pending', 'approved', 'rejected', 'cancelled']

export default function AdminLeave() {
  const { selectedCompanyId } = useAdminCompany()
  const { t } = useLanguage()
  const [requests, setRequests] = useState<LeaveRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [filterEmployee, setFilterEmployee] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<Record<string, any>>({})
  const [weekendsAsWorkdays, setWeekendsAsWorkdays] = useState(false)
  const [savingWeekend, setSavingWeekend] = useState(false)
  const [leaveTypeSettings, setLeaveTypeSettings] = useState<{ id: number; name: string; deducts_from_allowance: boolean }[]>([])
  const [savingDeduct, setSavingDeduct] = useState<number | null>(null)

  const loadWeekendSetting = useCallback(async () => {
    if (!selectedCompanyId) return
    const { data } = await supabase
      .from('companies')
      .select('weekends_as_workdays')
      .eq('id', selectedCompanyId)
      .single()
    setWeekendsAsWorkdays(data?.weekends_as_workdays === true)
  }, [selectedCompanyId])

  async function toggleWeekends() {
    if (!selectedCompanyId) return
    setSavingWeekend(true)
    const newVal = !weekendsAsWorkdays
    await supabase.from('companies').update({ weekends_as_workdays: newVal }).eq('id', selectedCompanyId)
    setWeekendsAsWorkdays(newVal)
    setSavingWeekend(false)
  }

  const loadLeaveTypeSettings = useCallback(async () => {
    if (!selectedCompanyId) return
    const { data } = await supabase
      .from('leave_types')
      .select('id, name, deducts_from_allowance')
      .eq('company_id', selectedCompanyId)
      .order('name')
    if (data) setLeaveTypeSettings(data.map(r => ({ ...r, deducts_from_allowance: r.deducts_from_allowance !== false })))
  }, [selectedCompanyId])

  async function toggleDeductsFromAllowance(typeId: number, currentVal: boolean) {
    setSavingDeduct(typeId)
    await supabase.from('leave_types').update({ deducts_from_allowance: !currentVal }).eq('id', typeId)
    setLeaveTypeSettings(prev => prev.map(t => t.id === typeId ? { ...t, deducts_from_allowance: !currentVal } : t))
    setSavingDeduct(null)
  }

  useEffect(() => { if (selectedCompanyId) { load(); loadWeekendSetting(); loadLeaveTypeSettings() } }, [selectedCompanyId, loadWeekendSetting, loadLeaveTypeSettings])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('leave_requests')
      .select('*, leave_type:leave_types(name), employee:employees!leave_requests_employee_id_fkey(first_name, last_name)')
      .eq('company_id', selectedCompanyId)
      .order('created_at', { ascending: false })
    setRequests((data as LeaveRequest[]) || [])
    setLoading(false)
  }

  function startEdit(r: LeaveRequest) {
    setEditingId(r.id)
    setEditForm({ status: r.status, days_requested: r.days_requested, start_date: r.start_date, end_date: r.end_date, reason: r.reason || '' })
  }

  async function saveEdit(id: number) {
    await supabase.from('leave_requests').update({
      status: editForm.status,
      days_requested: editForm.days_requested,
      start_date: editForm.start_date,
      end_date: editForm.end_date,
      reason: editForm.reason || null,
    }).eq('id', id)

    if (editForm.status === 'approved') {
      const req = requests.find(r => r.id === id)
      if (req) {
        const typeSetting = leaveTypeSettings.find(t => t.name === req.leave_type?.name)
        if (!typeSetting || typeSetting.deducts_from_allowance) {
          const year = new Date(req.start_date).getFullYear()
          const { data: balance } = await supabase
            .from('leave_balances')
            .select('id, used')
            .eq('employee_id', (req as any).employee_id)
            .eq('year', year)
            .limit(1)
            .single()
          if (balance) {
            await supabase.from('leave_balances')
              .update({ used: balance.used + Number(editForm.days_requested) })
              .eq('id', balance.id)
          }
        }
      }
    }
    setEditingId(null)
    load()
  }

  async function deleteRequest(id: number) {
    if (!confirm('Delete this leave request?')) return
    await supabase.from('leave_requests').delete().eq('id', id)
    setRequests(prev => prev.filter(r => r.id !== id))
  }

  const employees = useMemo(() => {
    const names = new Set<string>()
    requests.forEach(r => { if (r.employee) names.add(`${r.employee.first_name} ${r.employee.last_name}`) })
    return Array.from(names).sort()
  }, [requests])

  const filtered = useMemo(() => {
    return requests.filter(r => {
      if (filterStatus && r.status !== filterStatus) return false
      if (filterEmployee && r.employee && `${r.employee.first_name} ${r.employee.last_name}` !== filterEmployee) return false
      return true
    })
  }, [requests, filterStatus, filterEmployee])

  const stats = useMemo(() => ({
    total: requests.length,
    pending: requests.filter(r => r.status === 'pending').length,
    approved: requests.filter(r => r.status === 'approved').length,
    rejected: requests.filter(r => r.status === 'rejected').length,
    totalDays: requests.filter(r => r.status === 'approved').reduce((s, r) => s + Number(r.days_requested), 0),
  }), [requests])

  return (
    <div className="admin-section">
      <div className="admin-page-header">
        <h2>Leave Management</h2>
        <p>{requests.length} total requests</p>
      </div>

      <div className="admin-mini-stats">
        <div className="admin-mini-stat"><span className="admin-mini-value">{stats.total}</span><span>Total</span></div>
        <div className="admin-mini-stat"><span className="admin-mini-value" style={{color:'#ff9800'}}>{stats.pending}</span><span>Pending</span></div>
        <div className="admin-mini-stat"><span className="admin-mini-value" style={{color:'#43a047'}}>{stats.approved}</span><span>Approved</span></div>
        <div className="admin-mini-stat"><span className="admin-mini-value" style={{color:'#e53935'}}>{stats.rejected}</span><span>Rejected</span></div>
        <div className="admin-mini-stat"><span className="admin-mini-value" style={{color:'#5b9bd5'}}>{stats.totalDays}</span><span>Days Used</span></div>
      </div>

      <div className="admin-weekend-toggle">
        <label className="admin-toggle-label">
          <input
            type="checkbox"
            checked={weekendsAsWorkdays}
            onChange={toggleWeekends}
            disabled={savingWeekend}
          />
          <span>Count weekends as working days</span>
        </label>
        <span className="admin-toggle-hint">
          {weekendsAsWorkdays
            ? 'Weekends will be included when employees request leave'
            : 'Weekends are excluded from leave day calculations (UK bank holidays always excluded)'}
        </span>
      </div>

      {leaveTypeSettings.length > 0 && (
        <div className="admin-weekend-toggle" style={{ marginTop: 12 }}>
          <h4 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600 }}>{t('leave.deductions_title')}</h4>
          <span className="admin-toggle-hint" style={{ marginBottom: 12, display: 'block' }}>
            {t('leave.deductions_hint')}
          </span>
          {leaveTypeSettings
            .filter(lt => ['Bereavement', 'Exam Leave', 'Carers Leave'].includes(lt.name))
            .map(lt => (
              <label key={lt.id} className="admin-toggle-label" style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                <input
                  type="checkbox"
                  checked={lt.deducts_from_allowance}
                  onChange={() => toggleDeductsFromAllowance(lt.id, lt.deducts_from_allowance)}
                  disabled={savingDeduct === lt.id}
                />
                <span>{lt.name} — {lt.deducts_from_allowance ? t('leave.deducts_from_allowance') : t('leave.does_not_deduct')}</span>
              </label>
            ))}
        </div>
      )}

      <div className="admin-filters">
        <select value={filterEmployee} onChange={e => setFilterEmployee(e.target.value)} className="admin-select">
          <option value="">All Employees</option>
          {employees.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="admin-select">
          <option value="">All Statuses</option>
          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
        </select>
      </div>

      {loading ? <div className="admin-loading">Loading...</div> : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Employee</th><th>Type</th><th>Dates</th><th>Days</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id}>
                  <td>{r.employee ? `${r.employee.first_name} ${r.employee.last_name}` : '—'}</td>
                  <td>{r.leave_type?.name || '—'}</td>
                  <td>{editingId === r.id ? (
                    <div className="admin-date-inputs">
                      <input type="date" className="admin-inline-input" value={editForm.start_date} onChange={e => setEditForm(p => ({...p, start_date: e.target.value}))} />
                      <input type="date" className="admin-inline-input" value={editForm.end_date} onChange={e => setEditForm(p => ({...p, end_date: e.target.value}))} />
                    </div>
                  ) : `${new Date(r.start_date).toLocaleDateString('en-GB')} – ${new Date(r.end_date).toLocaleDateString('en-GB')}`}</td>
                  <td>{editingId === r.id ? <input type="number" step="0.5" className="admin-inline-input admin-inline-sm" value={editForm.days_requested} onChange={e => setEditForm(p => ({...p, days_requested: +e.target.value}))} /> : r.days_requested}</td>
                  <td>{editingId === r.id ? (
                    <select className="admin-inline-select" value={editForm.status} onChange={e => setEditForm(p => ({...p, status: e.target.value}))}>
                      {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  ) : <span className={`admin-badge admin-badge-${r.status}`}>{r.status}</span>}</td>
                  <td className="admin-actions">
                    {editingId === r.id ? (
                      <>
                        <button className="admin-btn-sm admin-btn-save" onClick={() => saveEdit(r.id)}>Save</button>
                        <button className="admin-btn-sm admin-btn-cancel" onClick={() => setEditingId(null)}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button className="admin-btn-icon" title="Edit" onClick={() => startEdit(r)}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                        <button className="admin-btn-icon admin-btn-danger" title="Delete" onClick={() => deleteRequest(r.id)}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <div className="admin-empty">No leave requests found</div>}
        </div>
      )}
    </div>
  )
}
