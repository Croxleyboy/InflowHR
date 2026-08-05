import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { useToast } from '../../context/ToastContext'
import { formatDate } from '../../lib/formatters'

interface Payslip {
  id: number
  reference_number: string
  pay_period_start: string
  pay_period_end: string
  gross_pay: number
  tax: number
  national_insurance: number
  pension: number
  other_deductions: number
  net_pay: number
  payment_date: string
  status: string
  tax_code: string
  annual_salary: number
  payroll_id: string
  overtime: number
  adjustments: number
  employee: { id: string; first_name: string; last_name: string } | null
}

interface Employee {
  id: string
  first_name: string
  last_name: string
  job_title: string
  department: string
}

const PAYROLL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export default function AdminPayroll() {
  const { selectedCompanyId } = useAdminCompany()
  const { showError, showSuccess } = useToast()
  const [payslips, setPayslips] = useState<Payslip[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'payslips' | 'schedule' | 'employees' | 'time_breakdown'>('payslips')
  const [filterEmployee, setFilterEmployee] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<Record<string, any>>({})
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [generating, setGenerating] = useState(false)
  const [empEditId, setEmpEditId] = useState<string | null>(null)
  const [empForm, setEmpForm] = useState<Record<string, any>>({})

  const [enabledFeatures, setEnabledFeatures] = useState({ timesheets: false, shifts: false, legal_timesheets: false })
  const [tbPeriodStart, setTbPeriodStart] = useState(() => {
    const d = new Date(); d.setDate(1); return d.toISOString().split('T')[0]
  })
  const [tbPeriodEnd, setTbPeriodEnd] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() + 1, 0); return d.toISOString().split('T')[0]
  })
  const [tbData, setTbData] = useState<Record<string, { shiftHrs: number; shiftEntries: any[]; tsHrs: number; tsEntries: any[]; legalHrs: number; legalEntries: any[] }>>({})
  const [tbLoading, setTbLoading] = useState(false)
  const [tbExpandedEmp, setTbExpandedEmp] = useState<string | null>(null)
  const [tbFilterEmp, setTbFilterEmp] = useState('')

  useEffect(() => { if (selectedCompanyId) loadAll() }, [selectedCompanyId])

  useEffect(() => {
    if (!selectedCompanyId) return
    supabase.from('company_features').select('feature_key, is_enabled').eq('company_id', selectedCompanyId)
      .in('feature_key', ['timesheets', 'shifts', 'legal_timesheets']).then(({ data }) => {
        const map: Record<string, boolean> = { timesheets: false, shifts: false, legal_timesheets: false }
        data?.forEach(r => { if (r.feature_key in map) map[r.feature_key] = r.is_enabled })
        setEnabledFeatures(map as any)
      })
  }, [selectedCompanyId])

  async function loadAll() {
    setLoading(true)
    const [pRes, eRes] = await Promise.all([
      supabase.from('payslips').select('*, employee:employees!payslips_employee_id_fkey(id, first_name, last_name)').eq('company_id', selectedCompanyId).order('payment_date', { ascending: false }),
      supabase.from('employees').select('id, first_name, last_name, job_title, department').eq('company_id', selectedCompanyId).eq('is_active', true).order('last_name'),
    ])
    setPayslips((pRes.data as Payslip[]) || [])
    setEmployees((eRes.data as Employee[]) || [])
    setLoading(false)
  }

  function startEdit(p: Payslip) {
    setEditingId(p.id)
    setEditForm({ gross_pay: p.gross_pay, tax: p.tax, national_insurance: p.national_insurance, pension: p.pension, other_deductions: p.other_deductions, net_pay: p.net_pay, status: p.status, tax_code: p.tax_code, overtime: p.overtime, adjustments: p.adjustments })
  }

  async function saveEdit(id: number) {
    const net = Number(editForm.gross_pay) + Number(editForm.overtime) + Number(editForm.adjustments) - Number(editForm.tax) - Number(editForm.national_insurance) - Number(editForm.pension) - Number(editForm.other_deductions)
    const { error } = await supabase.from('payslips').update({ ...editForm, net_pay: net }).eq('id', id)
    if (error) { showError('Failed to save payslip: ' + error.message); return }
    setEditingId(null)
    loadAll()
    showSuccess('Payslip saved')
  }

  async function deletePayslip(id: number) {
    if (!confirm('Delete this payslip?')) return
    const { error } = await supabase.from('payslips').delete().eq('id', id)
    if (error) { showError('Failed to delete payslip: ' + error.message); return }
    setPayslips(prev => prev.filter(p => p.id !== id))
    showSuccess('Payslip deleted')
  }

  async function generateNextPayroll() {
    setGenerating(true)
    const now = new Date()
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    const endOfMonth = new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0)
    const paymentDate = new Date(endOfMonth)
    paymentDate.setDate(paymentDate.getDate() - 3)
    const ref = `PAY-${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}`

    const errors: string[] = []
    for (const emp of employees) {
      const latest = payslips.find(p => p.employee?.id === emp.id)
      const gross = latest ? Number(latest.gross_pay) : 3500
      const tax = latest ? Number(latest.tax) : 700
      const ni = latest ? Number(latest.national_insurance) : 350
      const pension = latest ? Number(latest.pension) : 175

      const { error } = await supabase.from('payslips').insert({
        employee_id: emp.id,
        reference_number: `${ref}-${emp.id.slice(0, 4)}`,
        pay_period_start: nextMonth.toISOString().split('T')[0],
        pay_period_end: endOfMonth.toISOString().split('T')[0],
        gross_pay: gross, tax, national_insurance: ni, pension,
        other_deductions: 0,
        net_pay: gross - tax - ni - pension,
        payment_date: paymentDate.toISOString().split('T')[0],
        status: 'draft',
        tax_code: latest?.tax_code || '1257L',
        annual_salary: latest?.annual_salary || 42000,
        payroll_id: latest?.payroll_id || '',
      }).select()
      if (error) errors.push(`${emp.first_name} ${emp.last_name}: ${error.message}`)
    }
    setGenerating(false)
    if (errors.length > 0) {
      showError(`Failed to generate ${errors.length} payslip(s): ${errors[0]}`)
    } else {
      showSuccess('Next payroll generated')
    }
    loadAll()
  }

  const filtered = useMemo(() => {
    return payslips.filter(p => {
      if (filterStatus && p.status !== filterStatus) return false
      if (filterEmployee && p.employee && `${p.employee.first_name} ${p.employee.last_name}` !== filterEmployee) return false
      return true
    })
  }, [payslips, filterStatus, filterEmployee])

  const empNames = useMemo(() => {
    const names = new Set<string>()
    payslips.forEach(p => { if (p.employee) names.add(`${p.employee.first_name} ${p.employee.last_name}`) })
    return Array.from(names).sort()
  }, [payslips])

  const stats = useMemo(() => ({
    total: payslips.length,
    draft: payslips.filter(p => p.status === 'draft').length,
    processed: payslips.filter(p => p.status === 'processed').length,
    paid: payslips.filter(p => p.status === 'paid').length,
    totalGross: payslips.reduce((s, p) => s + Number(p.gross_pay), 0),
    totalNet: payslips.reduce((s, p) => s + Number(p.net_pay), 0),
  }), [payslips])

  const loadTimeBreakdown = useCallback(async () => {
    if (!selectedCompanyId) return
    setTbLoading(true)
    const result: Record<string, { shiftHrs: number; shiftEntries: any[]; tsHrs: number; tsEntries: any[]; legalHrs: number; legalEntries: any[] }> = {}
    for (const emp of employees) {
      result[emp.id] = { shiftHrs: 0, shiftEntries: [], tsHrs: 0, tsEntries: [], legalHrs: 0, legalEntries: [] }
    }

    const queries: Promise<void>[] = []

    if (enabledFeatures.timesheets) {
      queries.push((async () => {
        const { data } = await supabase.from('timesheets')
          .select('employee_id, date, end_date, start_time, end_time, location, role, status, hours')
          .eq('company_id', selectedCompanyId).neq('status', 'rejected')
          .gte('date', tbPeriodStart).lte('date', tbPeriodEnd)
        if (data) {
          for (const row of data) {
            if (!result[row.employee_id]) continue
            const hrs = Number(row.hours) || 0
            result[row.employee_id].tsHrs += hrs
            result[row.employee_id].tsEntries.push(row)
          }
        }
      })())
    }

    if (enabledFeatures.shifts) {
      queries.push((async () => {
        const { data } = await supabase.from('shift_assignments')
          .select('employee_id, date, shift_templates(name, start_time, end_time, break_minutes), rotas(status)')
          .eq('company_id', selectedCompanyId)
          .gte('date', tbPeriodStart).lte('date', tbPeriodEnd)
        if (data) {
          for (const row of data as any[]) {
            if (!result[row.employee_id]) continue
            const rota = row.rotas as any
            if (rota?.status === 'draft') continue
            const tmpl = row.shift_templates as any
            if (!tmpl) continue
            const startMins = parseInt(tmpl.start_time?.split(':')[0]) * 60 + parseInt(tmpl.start_time?.split(':')[1] || '0')
            const endMins = parseInt(tmpl.end_time?.split(':')[0]) * 60 + parseInt(tmpl.end_time?.split(':')[1] || '0')
            const hrs = Math.max(0, (endMins - startMins - (tmpl.break_minutes || 0)) / 60)
            result[row.employee_id].shiftHrs += hrs
            result[row.employee_id].shiftEntries.push({ ...row, shiftName: tmpl.name, start_time: tmpl.start_time, end_time: tmpl.end_time, breakMins: tmpl.break_minutes, hrs })
          }
        }
      })())
    }

    if (enabledFeatures.legal_timesheets) {
      queries.push((async () => {
        const { data } = await supabase.from('legal_timesheet_entries')
          .select('employee_id, date, duration_hrs, task_code, status, client_id, matter_id')
          .eq('company_id', selectedCompanyId).neq('status', 'rejected')
          .gte('date', tbPeriodStart).lte('date', tbPeriodEnd)
        if (data) {
          for (const row of data) {
            if (!result[row.employee_id]) continue
            const hrs = Number(row.duration_hrs) || 0
            result[row.employee_id].legalHrs += hrs
            result[row.employee_id].legalEntries.push(row)
          }
        }
      })())
    }

    await Promise.all(queries)
    setTbData(result)
    setTbLoading(false)
  }, [selectedCompanyId, tbPeriodStart, tbPeriodEnd, employees, enabledFeatures])

  useEffect(() => { if (tab === 'time_breakdown' && employees.length > 0) loadTimeBreakdown() }, [tab, loadTimeBreakdown])

  function startEmpEdit(emp: Employee) {
    setEmpEditId(emp.id)
    const latest = payslips.find(p => p.employee?.id === emp.id)
    setEmpForm({ annual_salary: latest?.annual_salary || 0, tax_code: latest?.tax_code || '1257L', pension_pct: latest ? (Number(latest.pension) / Number(latest.gross_pay) * 100).toFixed(1) : '5.0' })
  }

  return (
    <div className="admin-section">
      <div className="admin-page-header">
        <h2>Payroll Management</h2>
        <p>{payslips.length} payslips · {employees.length} employees</p>
      </div>

      <div className="admin-mini-stats">
        <div className="admin-mini-stat"><span className="admin-mini-value">{stats.total}</span><span>Total</span></div>
        <div className="admin-mini-stat"><span className="admin-mini-value" style={{color:'#ff9800'}}>{stats.draft}</span><span>Draft</span></div>
        <div className="admin-mini-stat"><span className="admin-mini-value" style={{color:'#5b9bd5'}}>{stats.processed}</span><span>Processed</span></div>
        <div className="admin-mini-stat"><span className="admin-mini-value" style={{color:'#43a047'}}>{stats.paid}</span><span>Paid</span></div>
      </div>

      <div className="admin-tabs">
        <button className={`admin-tab ${tab === 'payslips' ? 'admin-tab-active' : ''}`} onClick={() => setTab('payslips')}>Payslips</button>
        <button className={`admin-tab ${tab === 'employees' ? 'admin-tab-active' : ''}`} onClick={() => setTab('employees')}>Employee Pay</button>
        <button className={`admin-tab ${tab === 'schedule' ? 'admin-tab-active' : ''}`} onClick={() => setTab('schedule')}>Payroll Schedule</button>
        {(enabledFeatures.timesheets || enabledFeatures.shifts || enabledFeatures.legal_timesheets) && (
          <button className={`admin-tab ${tab === 'time_breakdown' ? 'admin-tab-active' : ''}`} onClick={() => setTab('time_breakdown')}>Time Breakdown</button>
        )}
      </div>

      {tab === 'payslips' && (
        <>
          <div className="admin-filters">
            <select value={filterEmployee} onChange={e => setFilterEmployee(e.target.value)} className="admin-select">
              <option value="">All Employees</option>
              {empNames.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="admin-select">
              <option value="">All Statuses</option>
              <option value="draft">Draft</option><option value="processed">Processed</option><option value="paid">Paid</option>
            </select>
            <button className="admin-btn admin-btn-primary" onClick={generateNextPayroll} disabled={generating}>
              {generating ? 'Generating...' : '+ Generate Next Payroll'}
            </button>
          </div>

          {loading ? <div className="admin-loading">Loading...</div> : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>Ref</th><th>Employee</th><th>Period</th><th>Gross</th><th>Net</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {filtered.map(p => (
                    <>
                      <tr key={p.id} className={expandedId === p.id ? 'admin-row-active' : ''}>
                        <td className="admin-td-mono">{p.reference_number}</td>
                        <td>{p.employee ? `${p.employee.first_name} ${p.employee.last_name}` : '—'}</td>
                        <td>{new Date(p.pay_period_start).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}</td>
                        <td>{editingId === p.id ? <input type="number" className="admin-inline-input admin-inline-sm" value={editForm.gross_pay} onChange={e => setEditForm(f => ({...f, gross_pay: +e.target.value}))} /> : `£${Number(p.gross_pay).toFixed(2)}`}</td>
                        <td>£{Number(p.net_pay).toFixed(2)}</td>
                        <td>{editingId === p.id ? (
                          <select className="admin-inline-select" value={editForm.status} onChange={e => setEditForm(f => ({...f, status: e.target.value}))}>
                            <option value="draft">Draft</option><option value="processed">Processed</option><option value="paid">Paid</option>
                          </select>
                        ) : <span className={`admin-badge admin-badge-${p.status}`}>{p.status}</span>}</td>
                        <td className="admin-actions">
                          {editingId === p.id ? (
                            <>
                              <button className="admin-btn-sm admin-btn-save" onClick={() => saveEdit(p.id)}>Save</button>
                              <button className="admin-btn-sm admin-btn-cancel" onClick={() => setEditingId(null)}>Cancel</button>
                            </>
                          ) : (
                            <>
                              <button className="admin-btn-icon" onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points={expandedId === p.id ? "18 15 12 9 6 15" : "6 9 12 15 18 9"}/></svg>
                              </button>
                              <button className="admin-btn-icon" onClick={() => startEdit(p)}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                              </button>
                              <button className="admin-btn-icon admin-btn-danger" onClick={() => deletePayslip(p.id)}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                      {expandedId === p.id && (
                        <tr key={`exp-${p.id}`} className="admin-expanded-row">
                          <td colSpan={7}>
                            <div className="admin-detail-grid admin-detail-grid-4">
                              <div><strong>Tax Code:</strong> {p.tax_code}</div>
                              <div><strong>Annual Salary:</strong> £{Number(p.annual_salary || 0).toLocaleString()}</div>
                              <div><strong>Tax:</strong> £{Number(p.tax).toFixed(2)}</div>
                              <div><strong>NI:</strong> £{Number(p.national_insurance).toFixed(2)}</div>
                              <div><strong>Pension:</strong> £{Number(p.pension).toFixed(2)}</div>
                              <div><strong>Overtime:</strong> £{Number(p.overtime || 0).toFixed(2)}</div>
                              <div><strong>Adjustments:</strong> £{Number(p.adjustments || 0).toFixed(2)}</div>
                              <div><strong>Payment Date:</strong> {new Date(p.payment_date).toLocaleDateString('en-GB')}</div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && <div className="admin-empty">No payslips found</div>}
            </div>
          )}
        </>
      )}

      {tab === 'employees' && (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Employee</th><th>Department</th><th>Role</th><th>Annual Salary</th><th>Tax Code</th><th>Pension %</th><th></th></tr></thead>
            <tbody>
              {employees.map(emp => {
                const latest = payslips.find(p => p.employee?.id === emp.id)
                return (
                  <tr key={emp.id}>
                    <td>{emp.first_name} {emp.last_name}</td>
                    <td>{emp.department || '—'}</td>
                    <td>{emp.job_title || '—'}</td>
                    <td>{empEditId === emp.id ? <input type="number" className="admin-inline-input admin-inline-sm" value={empForm.annual_salary} onChange={e => setEmpForm(f => ({...f, annual_salary: +e.target.value}))} /> : `£${Number(latest?.annual_salary || 0).toLocaleString()}`}</td>
                    <td>{empEditId === emp.id ? <input className="admin-inline-input admin-inline-sm" value={empForm.tax_code} onChange={e => setEmpForm(f => ({...f, tax_code: e.target.value}))} /> : (latest?.tax_code || '—')}</td>
                    <td>{empEditId === emp.id ? <input type="number" step="0.1" className="admin-inline-input admin-inline-sm" value={empForm.pension_pct} onChange={e => setEmpForm(f => ({...f, pension_pct: e.target.value}))} /> : (latest ? `${(Number(latest.pension) / Number(latest.gross_pay) * 100).toFixed(1)}%` : '—')}</td>
                    <td className="admin-actions">
                      {empEditId === emp.id ? (
                        <>
                          <button className="admin-btn-sm admin-btn-save" onClick={() => setEmpEditId(null)}>Save</button>
                          <button className="admin-btn-sm admin-btn-cancel" onClick={() => setEmpEditId(null)}>Cancel</button>
                        </>
                      ) : (
                        <button className="admin-btn-icon" onClick={() => startEmpEdit(emp)}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'schedule' && (
        <div className="admin-schedule">
          <h3>Payroll Calendar — FY 2026/2027</h3>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Month</th><th>Period Start</th><th>Period End</th><th>Payment Date</th><th>Cutoff</th><th>Status</th></tr></thead>
              <tbody>
                {PAYROLL_MONTHS.map((month, i) => {
                  const fyMonth = (i + 3) % 12
                  const year = fyMonth >= 3 ? 2026 : 2027
                  const start = new Date(year, fyMonth, 1)
                  const end = new Date(year, fyMonth + 1, 0)
                  const payDate = new Date(end)
                  payDate.setDate(payDate.getDate() - 2)
                  const cutoff = new Date(end)
                  cutoff.setDate(cutoff.getDate() - 5)
                  const isPast = end < new Date()
                  return (
                    <tr key={month} className={isPast ? 'admin-row-muted' : ''}>
                      <td><strong>{PAYROLL_MONTHS[fyMonth]}</strong></td>
                      <td>{start.toLocaleDateString('en-GB')}</td>
                      <td>{end.toLocaleDateString('en-GB')}</td>
                      <td>{payDate.toLocaleDateString('en-GB')}</td>
                      <td>{cutoff.toLocaleDateString('en-GB')}</td>
                      <td><span className={`admin-badge ${isPast ? 'admin-badge-paid' : 'admin-badge-pending'}`}>{isPast ? 'Completed' : 'Upcoming'}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'time_breakdown' && (
        <>
          <div className="admin-filters">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ fontSize: 13, fontWeight: 600 }}>Period:</label>
              <input type="date" className="admin-select" value={tbPeriodStart} onChange={e => setTbPeriodStart(e.target.value)} />
              <span>to</span>
              <input type="date" className="admin-select" value={tbPeriodEnd} onChange={e => setTbPeriodEnd(e.target.value)} />
            </div>
            <select className="admin-select" value={tbFilterEmp} onChange={e => setTbFilterEmp(e.target.value)}>
              <option value="">All Employees</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>)}
            </select>
            <button className="admin-btn admin-btn-primary" onClick={loadTimeBreakdown} disabled={tbLoading}>
              {tbLoading ? 'Loading...' : 'Refresh'}
            </button>
          </div>

          {tbLoading ? <div className="admin-loading">Loading time data...</div> : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    {enabledFeatures.shifts && <th>Shift Hours</th>}
                    {enabledFeatures.timesheets && <th>Timesheet Hours</th>}
                    {enabledFeatures.legal_timesheets && <th>Legal Hours</th>}
                    <th>Total Hours</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {employees.filter(e => !tbFilterEmp || e.id === tbFilterEmp).map(emp => {
                    const data = tbData[emp.id]
                    if (!data) return null
                    const total = data.shiftHrs + data.tsHrs + data.legalHrs
                    if (total === 0 && !tbFilterEmp) return null
                    const isExpanded = tbExpandedEmp === emp.id
                    return (
                      <>
                        <tr key={emp.id} className={isExpanded ? 'admin-row-active' : ''}>
                          <td><strong>{emp.first_name} {emp.last_name}</strong><br /><span style={{ fontSize: 12, color: '#888' }}>{emp.department} · {emp.job_title}</span></td>
                          {enabledFeatures.shifts && <td>{data.shiftHrs.toFixed(1)}h <span style={{ fontSize: 12, color: '#888' }}>({data.shiftEntries.length} shifts)</span></td>}
                          {enabledFeatures.timesheets && <td>{data.tsHrs.toFixed(1)}h <span style={{ fontSize: 12, color: '#888' }}>({data.tsEntries.length} entries)</span></td>}
                          {enabledFeatures.legal_timesheets && <td>{data.legalHrs.toFixed(1)}h <span style={{ fontSize: 12, color: '#888' }}>({data.legalEntries.length} entries)</span></td>}
                          <td><strong>{total.toFixed(1)}h</strong></td>
                          <td>
                            <button className="admin-btn-icon" onClick={() => setTbExpandedEmp(isExpanded ? null : emp.id)}>
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points={isExpanded ? '18 15 12 9 6 15' : '6 9 12 15 18 9'} /></svg>
                            </button>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr key={`tb-exp-${emp.id}`} className="admin-expanded-row">
                            <td colSpan={2 + (enabledFeatures.shifts ? 1 : 0) + (enabledFeatures.timesheets ? 1 : 0) + (enabledFeatures.legal_timesheets ? 1 : 0)}>
                              <div className="admin-tb-detail">
                                {enabledFeatures.shifts && data.shiftEntries.length > 0 && (
                                  <div className="admin-tb-section">
                                    <h4 className="admin-tb-section-title">Shifts ({data.shiftHrs.toFixed(1)}h)</h4>
                                    <table className="admin-table admin-table-nested">
                                      <thead><tr><th>Date</th><th>Shift</th><th>Time</th><th>Break</th><th>Hours</th></tr></thead>
                                      <tbody>
                                        {data.shiftEntries.sort((a: any, b: any) => a.date.localeCompare(b.date)).map((s: any, i: number) => (
                                          <tr key={i}>
                                            <td>{formatDate(s.date)}</td>
                                            <td>{s.shiftName}</td>
                                            <td>{s.start_time?.slice(0, 5)} - {s.end_time?.slice(0, 5)}</td>
                                            <td>{s.breakMins || 0} mins</td>
                                            <td>{s.hrs.toFixed(1)}h</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}

                                {enabledFeatures.timesheets && data.tsEntries.length > 0 && (
                                  <div className="admin-tb-section">
                                    <h4 className="admin-tb-section-title">Timesheets ({data.tsHrs.toFixed(1)}h)</h4>
                                    <table className="admin-table admin-table-nested">
                                      <thead><tr><th>Date</th><th>Location</th><th>Role</th><th>Time</th><th>Hours</th><th>Status</th></tr></thead>
                                      <tbody>
                                        {data.tsEntries.sort((a: any, b: any) => a.date.localeCompare(b.date)).map((ts: any, i: number) => (
                                          <tr key={i}>
                                            <td>{ts.end_date && ts.end_date !== ts.date ? `${formatDate(ts.date)} – ${formatDate(ts.end_date)}` : formatDate(ts.date)}</td>
                                            <td>{ts.location}</td>
                                            <td>{ts.role}</td>
                                            <td>{ts.start_time?.slice(0, 5)} - {ts.end_time?.slice(0, 5)}</td>
                                            <td>{Number(ts.hours).toFixed(1)}h</td>
                                            <td><span className={`admin-badge admin-badge-${ts.status}`}>{ts.status}</span></td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}

                                {enabledFeatures.legal_timesheets && data.legalEntries.length > 0 && (
                                  <div className="admin-tb-section">
                                    <h4 className="admin-tb-section-title">Legal Timesheets ({data.legalHrs.toFixed(1)}h)</h4>
                                    <table className="admin-table admin-table-nested">
                                      <thead><tr><th>Date</th><th>Task Code</th><th>Hours</th><th>Status</th></tr></thead>
                                      <tbody>
                                        {data.legalEntries.sort((a: any, b: any) => a.date.localeCompare(b.date)).map((lt: any, i: number) => (
                                          <tr key={i}>
                                            <td>{formatDate(lt.date)}</td>
                                            <td>{lt.task_code}</td>
                                            <td>{Number(lt.duration_hrs).toFixed(1)}h</td>
                                            <td><span className={`admin-badge admin-badge-${lt.status}`}>{lt.status}</span></td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}

                                {data.shiftEntries.length === 0 && data.tsEntries.length === 0 && data.legalEntries.length === 0 && (
                                  <p style={{ color: '#888', fontStyle: 'italic' }}>No time entries for this period</p>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    )
                  })}
                </tbody>
              </table>
              {Object.values(tbData).every(d => d.shiftHrs + d.tsHrs + d.legalHrs === 0) && !tbFilterEmp && (
                <div className="admin-empty">No time entries found for this period</div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
