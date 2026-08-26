import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { useLanguage } from '../../context/LanguageContext'
import { useToast } from '../../context/ToastContext'
import { formatDate } from '../../lib/formatters'

interface LeaveRequest {
  id: number
  employee_id: string
  start_date: string
  end_date: string
  days_requested: number
  status: string
  reason: string | null
  created_at: string
  leave_type: { name: string } | null
  employee: { first_name: string; last_name: string; email: string; avatar_url: string | null } | null
}

const STATUS_OPTIONS = ['pending', 'approved', 'rejected', 'cancelled']
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const LEAVE_TYPE_COLOURS: Record<string, string> = {
  'Annual Leave': '#5b9bd5', 'Sick Leave': '#e53935', 'Unpaid Leave': '#ff9800',
  'Compassionate': '#ab47bc', 'Parental': '#26a69a', 'Bereavement': '#78909c',
  'Exam Leave': '#7e57c2', 'Carers Leave': '#ef6c00',
}

const PAGE_SIZE = 30

export default function AdminLeave() {
  const { selectedCompanyId } = useAdminCompany()
  const { t } = useLanguage()
  const { showError } = useToast()
  const [requests, setRequests] = useState<LeaveRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [filterEmployee, setFilterEmployee] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<Record<string, any>>({})
  const [weekendsAsWorkdays, setWeekendsAsWorkdays] = useState(false)
  const [savingWeekend, setSavingWeekend] = useState(false)
  const [leaveTypeSettings, setLeaveTypeSettings] = useState<{ id: number; name: string; deducts_from_allowance: boolean; max_carry_over_days: number }[]>([])
  const [savingDeduct, setSavingDeduct] = useState<number | null>(null)
  const [savingCarry, setSavingCarry] = useState<number | null>(null)
  const [fyStartMonth, setFyStartMonth] = useState(4)

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
    const { error } = await supabase.from('companies').update({ weekends_as_workdays: newVal }).eq('id', selectedCompanyId)
    if (error) { showError('Failed to update weekend setting: ' + error.message); setSavingWeekend(false); return }
    setWeekendsAsWorkdays(newVal)
    setSavingWeekend(false)
  }

  const loadLeaveTypeSettings = useCallback(async () => {
    if (!selectedCompanyId) return
    const { data } = await supabase
      .from('leave_types')
      .select('id, name, deducts_from_allowance, max_carry_over_days')
      .eq('company_id', selectedCompanyId)
      .order('name')
    if (data) setLeaveTypeSettings(data.map(r => ({ ...r, deducts_from_allowance: r.deducts_from_allowance !== false, max_carry_over_days: r.max_carry_over_days ?? 0 })))
  }, [selectedCompanyId])

  async function toggleDeductsFromAllowance(typeId: number, currentVal: boolean) {
    setSavingDeduct(typeId)
    const { error } = await supabase.from('leave_types').update({ deducts_from_allowance: !currentVal }).eq('id', typeId)
    if (error) { showError('Failed to update leave type: ' + error.message); setSavingDeduct(null); return }
    setLeaveTypeSettings(prev => prev.map(t => t.id === typeId ? { ...t, deducts_from_allowance: !currentVal } : t))
    setSavingDeduct(null)
  }

  async function updateCarryOverDays(typeId: number, days: number) {
    setSavingCarry(typeId)
    const { error } = await supabase.from('leave_types').update({ max_carry_over_days: days }).eq('id', typeId)
    if (error) { showError('Failed to update carry-over days: ' + error.message); setSavingCarry(null); return }
    setLeaveTypeSettings(prev => prev.map(t => t.id === typeId ? { ...t, max_carry_over_days: days } : t))
    setSavingCarry(null)
  }

  useEffect(() => {
    if (selectedCompanyId) {
      load(); loadWeekendSetting(); loadLeaveTypeSettings()
      supabase.from('companies').select('fy_start_month').eq('id', selectedCompanyId).single()
        .then(({ data }) => { if (data?.fy_start_month) setFyStartMonth(data.fy_start_month) })
    }
  }, [selectedCompanyId, loadWeekendSetting, loadLeaveTypeSettings])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('leave_requests')
      .select('*, leave_type:leave_types(name), employee:employees!leave_requests_employee_id_fkey(first_name, last_name, email, avatar_url)')
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
    const req = requests.find(r => r.id === id)
    const oldStatus = req?.status
    const newStatus = editForm.status

    const { error } = await supabase.from('leave_requests').update({
      status: newStatus,
      days_requested: editForm.days_requested,
      start_date: editForm.start_date,
      end_date: editForm.end_date,
      reason: editForm.reason || null,
      approved_at: newStatus === 'approved' ? new Date().toISOString() : null,
    }).eq('id', id)
    if (error) { showError('Failed to update leave request: ' + error.message); return }

    if (newStatus === 'approved' && req) {
      const typeSetting = leaveTypeSettings.find(t => t.name === req.leave_type?.name)
      if (!typeSetting || typeSetting.deducts_from_allowance) {
        const year = new Date(req.start_date).getFullYear()
        const { data: balance } = await supabase
          .from('leave_balances')
          .select('id, used')
          .eq('employee_id', req.employee_id)
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

    if (req && oldStatus === 'pending' && (newStatus === 'approved' || newStatus === 'rejected')) {
      const empName = req.employee ? `${req.employee.first_name} ${req.employee.last_name}` : ''
      const empEmail = req.employee?.email || ''
      const typeName = req.leave_type?.name || 'Leave'
      const approved = newStatus === 'approved'
      const now = new Date().toISOString()
      const dateRange = `${formatDate(editForm.start_date || req.start_date)} to ${formatDate(editForm.end_date || req.end_date)}`

      const { data: pendingWf } = await supabase.from('workflow_tracker')
        .select('assigned_to')
        .eq('record_type', 'Leave').eq('approval_id', id).eq('status', 'Pending')
        .eq('company_id', selectedCompanyId).limit(1).maybeSingle()
      const approverEmail = pendingWf?.assigned_to || ''

      await supabase.from('workflow_tracker').update({
        status: 'Complete',
        approval_status: approved ? 'Approved' : 'Declined',
        updated_at: now,
        task_description: approved
          ? `${typeName} approved - ${dateRange}`
          : `${typeName} declined`,
      }).eq('record_type', 'Leave').eq('approval_id', id).eq('status', 'Pending').eq('company_id', selectedCompanyId)

      await supabase.from('workflow_tracker').insert({
        emp_display_name: empName,
        step: 2, status: 'Complete', record_type: 'Leave',
        action: approved ? 'Leave approved' : 'Leave declined',
        employee_email: empEmail, assigned_to: empEmail,
        approval_id: id, reminder_count: 1,
        task_description: approved
          ? `Your ${typeName} from ${dateRange} has been approved by admin.`
          : `Your ${typeName} request from ${dateRange} has been declined by admin. Please contact your manager.`,
        approval_status: approved ? 'Approved' : 'Declined',
        company_id: selectedCompanyId,
      })

      if (approverEmail) {
        await supabase.from('workflow_tracker').insert({
          emp_display_name: 'Admin',
          step: 2, status: 'Complete', record_type: 'Leave',
          action: approved ? 'Leave approved by admin' : 'Leave declined by admin',
          employee_email: approverEmail, assigned_to: approverEmail,
          approval_id: id, reminder_count: 1,
          task_description: `Admin ${approved ? 'approved' : 'declined'} ${typeName} for ${empName} - ${dateRange}`,
          approval_status: approved ? 'Approved' : 'Declined',
          company_id: selectedCompanyId,
        })
      }

      window.dispatchEvent(new Event('notifications-updated'))
    }

    setEditingId(null)
    load()
  }

  async function deleteRequest(id: number) {
    if (!confirm('Delete this leave request?')) return

    const req = requests.find(r => r.id === id)

    if (req && req.status === 'approved') {
      const typeSetting = leaveTypeSettings.find(t => t.name === req.leave_type?.name)
      if (!typeSetting || typeSetting.deducts_from_allowance) {
        const year = new Date(req.start_date).getFullYear()
        const { data: balance } = await supabase
          .from('leave_balances')
          .select('id, used')
          .eq('employee_id', req.employee_id)
          .eq('year', year)
          .limit(1)
          .single()
        if (balance) {
          const newUsed = Math.max(0, balance.used - Number(req.days_requested))
          await supabase.from('leave_balances').update({ used: newUsed }).eq('id', balance.id)
        }
      }
    }

    const { error } = await supabase.from('leave_requests').delete().eq('id', id)
    if (error) { showError('Failed to delete leave request: ' + error.message); return }

    if (req) {
      const empName = req.employee ? `${req.employee.first_name} ${req.employee.last_name}` : ''
      const typeName = req.leave_type?.name || 'Leave'
      const dateRange = `${formatDate(req.start_date)} to ${formatDate(req.end_date)}`

      await supabase.from('notifications').insert({
        employee_id: req.employee_id,
        title: `${typeName} request deleted`,
        message: `Your ${typeName} request for ${dateRange} (${req.days_requested} days) has been deleted by an administrator.`,
        type: 'warning',
        link: '/leave',
        is_read: false,
        company_id: selectedCompanyId,
      })

      await supabase.from('workflow_tracker').insert({
        emp_display_name: empName,
        step: 1,
        status: 'Complete',
        record_type: 'Leave',
        action: 'Leave request deleted',
        employee_email: req.employee?.email || '',
        assigned_to: req.employee?.email || '',
        approval_id: id,
        reminder_count: 0,
        task_description: `${typeName} request for ${dateRange} has been deleted by an administrator.`,
        approval_status: 'Deleted',
        company_id: selectedCompanyId,
      })

      window.dispatchEvent(new Event('notifications-updated'))
    }

    setRequests(prev => prev.filter(r => r.id !== id))
  }

  const employees = useMemo(() => {
    const names = new Set<string>()
    requests.forEach(r => { if (r.employee) names.add(`${r.employee.first_name} ${r.employee.last_name}`) })
    return Array.from(names).sort()
  }, [requests])

  const filtered = useMemo(() => {
    setPage(1)
    return requests.filter(r => {
      if (filterStatus && r.status !== filterStatus) return false
      if (filterEmployee && r.employee && `${r.employee.first_name} ${r.employee.last_name}` !== filterEmployee) return false
      if (search) {
        const q = search.toLowerCase()
        const name = r.employee ? `${r.employee.first_name} ${r.employee.last_name}`.toLowerCase() : ''
        const type = (r.leave_type?.name || '').toLowerCase()
        const status = r.status.toLowerCase()
        const reason = (r.reason || '').toLowerCase()
        if (!name.includes(q) && !type.includes(q) && !status.includes(q) && !reason.includes(q)) return false
      }
      return true
    })
  }, [requests, filterStatus, filterEmployee, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const stats = useMemo(() => ({
    total: requests.length,
    pending: requests.filter(r => r.status === 'pending').length,
    approved: requests.filter(r => r.status === 'approved').length,
    rejected: requests.filter(r => r.status === 'rejected').length,
    totalDays: requests.filter(r => r.status === 'approved').reduce((s, r) => s + Number(r.days_requested), 0),
  }), [requests])

  const chartData = useMemo(() => {
    const fyMonths: number[] = []
    for (let i = 0; i < 12; i++) fyMonths.push((fyStartMonth - 1 + i) % 12)

    const now = new Date()
    const fyYear = now.getMonth() + 1 >= fyStartMonth ? now.getFullYear() : now.getFullYear() - 1

    const approved = requests.filter(r => r.status === 'approved')
    const monthData: { month: number; label: string; byType: Record<string, number>; total: number }[] = fyMonths.map(m => ({
      month: m, label: MONTH_LABELS[m], byType: {}, total: 0,
    }))

    for (const r of approved) {
      const startD = new Date(r.start_date + 'T00:00:00')
      const startMonth = startD.getMonth()

      const fyStartDate = new Date(fyYear, fyStartMonth - 1, 1)
      const fyEndDate = new Date(fyYear + 1, fyStartMonth - 1, 0)
      if (startD < fyStartDate || startD > fyEndDate) continue

      const idx = fyMonths.indexOf(startMonth)
      if (idx === -1) continue
      const typeName = r.leave_type?.name || 'Other'
      const days = Number(r.days_requested) || 0
      monthData[idx].byType[typeName] = (monthData[idx].byType[typeName] || 0) + days
      monthData[idx].total += days
    }

    const maxTotal = Math.max(...monthData.map(d => d.total), 1)
    const leaveTypes = Array.from(new Set(approved.map(r => r.leave_type?.name || 'Other')))

    const fyLabel = `${MONTH_LABELS[fyStartMonth - 1]} ${fyYear} – ${MONTH_LABELS[(fyStartMonth - 2 + 12) % 12]} ${fyYear + 1}`

    return { monthData, maxTotal, leaveTypes, fyLabel }
  }, [requests, fyStartMonth])

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

      {!loading && chartData.monthData.some(d => d.total > 0) && (
        <div style={{ background: 'var(--card-bg, #fff)', borderRadius: 10, padding: '16px 16px 12px', marginBottom: 16, border: '1px solid var(--border-color, #e0e0e0)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Approved Leave Distribution</h3>
            <span style={{ fontSize: 12, color: '#888' }}>{chartData.fyLabel}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 160 }}>
            {chartData.monthData.map((d, i) => (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end' }}>
                {d.total > 0 && (
                  <span style={{ fontSize: 11, fontWeight: 600, marginBottom: 2, color: 'var(--text-color, #333)' }}>{d.total}</span>
                )}
                <div style={{ width: '100%', maxWidth: 40, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', borderRadius: '3px 3px 0 0', overflow: 'hidden' }}>
                  {chartData.leaveTypes.map(type => {
                    const val = d.byType[type] || 0
                    if (val === 0) return null
                    const pct = (val / chartData.maxTotal) * 140
                    return (
                      <div
                        key={type}
                        title={`${type}: ${val} day${val !== 1 ? 's' : ''}`}
                        style={{
                          height: pct,
                          background: LEAVE_TYPE_COLOURS[type] || '#90a4ae',
                          minHeight: val > 0 ? 3 : 0,
                        }}
                      />
                    )
                  })}
                </div>
                <span style={{ fontSize: 11, marginTop: 4, color: '#888' }}>{d.label}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginTop: 10 }}>
            {chartData.leaveTypes.map(type => (
              <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#666' }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: LEAVE_TYPE_COLOURS[type] || '#90a4ae', flexShrink: 0 }} />
                {type}
              </div>
            ))}
          </div>
        </div>
      )}

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
          {leaveTypeSettings.filter(lt => ['Sick Leave', 'Jury Duty', 'Compassionate Leave', 'Bereavement', 'Exam Leave', 'Carers Leave'].includes(lt.name)).map(lt => (
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

      {leaveTypeSettings.length > 0 && (
        <div className="admin-weekend-toggle" style={{ marginTop: 12 }}>
          <h4 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600 }}>Carry-Over Days</h4>
          <span className="admin-toggle-hint" style={{ marginBottom: 12, display: 'block' }}>
            Set the maximum number of unused leave days that can be carried over into the next financial year per leave type. Set to 0 for no carry-over.
          </span>
          {leaveTypeSettings.filter(lt => lt.deducts_from_allowance).map(lt => (
            <div key={lt.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ minWidth: 140, fontSize: 13 }}>{lt.name}</span>
              <input
                type="number"
                min={0}
                max={365}
                className="admin-inline-input admin-inline-sm"
                value={lt.max_carry_over_days}
                onChange={e => {
                  const val = Math.max(0, Number(e.target.value) || 0)
                  setLeaveTypeSettings(prev => prev.map(t => t.id === lt.id ? { ...t, max_carry_over_days: val } : t))
                }}
                onBlur={e => updateCarryOverDays(lt.id, Math.max(0, Number(e.target.value) || 0))}
                disabled={savingCarry === lt.id}
                style={{ width: 70, textAlign: 'center' }}
              />
              <span style={{ fontSize: 12, color: '#888' }}>days max</span>
            </div>
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

      <input
        className="admin-input"
        placeholder="Search leave requests..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{ marginBottom: 12, width: '100%', maxWidth: 320 }}
      />

      {loading ? <div className="admin-loading">Loading...</div> : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Employee</th><th>Type</th><th>Dates</th><th>Days</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {paginated.map(r => (
                <tr key={r.id}>
                  <td>{r.employee ? <span className="admin-inline-avatar">{r.employee.avatar_url ? <img src={r.employee.avatar_url} alt="" /> : <span className="admin-avatar-initials">{r.employee.first_name[0]}{r.employee.last_name[0]}</span>}{r.employee.first_name} {r.employee.last_name}</span> : '—'}</td>
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
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 16, fontSize: 13 }}>
              <button className="admin-btn-sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Prev</button>
              <span>Page {page} of {totalPages}</span>
              <button className="admin-btn-sm" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
