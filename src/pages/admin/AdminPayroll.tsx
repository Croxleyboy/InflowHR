import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useAdminCompany } from '../../context/AdminCompanyContext'

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
  const [payslips, setPayslips] = useState<Payslip[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'payslips' | 'schedule' | 'employees'>('payslips')
  const [filterEmployee, setFilterEmployee] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<Record<string, any>>({})
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [generating, setGenerating] = useState(false)
  const [empEditId, setEmpEditId] = useState<string | null>(null)
  const [empForm, setEmpForm] = useState<Record<string, any>>({})

  useEffect(() => { if (selectedCompanyId) loadAll() }, [selectedCompanyId])

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
    await supabase.from('payslips').update({ ...editForm, net_pay: net }).eq('id', id)
    setEditingId(null)
    loadAll()
  }

  async function deletePayslip(id: number) {
    if (!confirm('Delete this payslip?')) return
    await supabase.from('payslips').delete().eq('id', id)
    setPayslips(prev => prev.filter(p => p.id !== id))
  }

  async function generateNextPayroll() {
    setGenerating(true)
    const now = new Date()
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    const endOfMonth = new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0)
    const paymentDate = new Date(endOfMonth)
    paymentDate.setDate(paymentDate.getDate() - 3)
    const ref = `PAY-${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}`

    for (const emp of employees) {
      const latest = payslips.find(p => p.employee?.id === emp.id)
      const gross = latest ? Number(latest.gross_pay) : 3500
      const tax = latest ? Number(latest.tax) : 700
      const ni = latest ? Number(latest.national_insurance) : 350
      const pension = latest ? Number(latest.pension) : 175

      await supabase.from('payslips').insert({
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
    }
    setGenerating(false)
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
    </div>
  )
}
