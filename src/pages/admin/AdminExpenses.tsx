import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { useLanguage } from '../../context/LanguageContext'
import { useToast } from '../../context/ToastContext'

interface Claim {
  id: number
  employee_id: string
  reference_number: string
  title: string
  amount: number
  status: string
  cost_center: string
  created_at: string
  submitted_at: string | null
  employee: { first_name: string; last_name: string; email: string } | null
  line_items?: LineItem[]
}
interface LineItem {
  id: number
  title: string
  expense_type: string
  amount: number
  date_of_purchase: string
  receipt_url: string | null
}

const STATUS_OPTIONS = ['draft', 'pending', 'approved', 'rejected']
const COST_CENTERS = ['External expenses', 'Internal costs', 'Travel & Transport', 'Client entertainment', 'Office supplies', 'IT & Software', 'Training & Development']
const EXPENSE_TYPES = [
  'Flights', 'Trains', 'Taxis', 'Car rental', 'Mileage', 'Parking and tolls',
  'Hotel stays for business', 'Meals while travelling', 'Client entertainment',
  'Stationery', 'Equipment or tools', 'Software or subscriptions',
  'Mobile phone usage', 'Internet/data charges', 'Course fees/certifications or conferences',
]

const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar']

export default function AdminExpenses() {
  const { selectedCompanyId } = useAdminCompany()
  const { t } = useLanguage()
  const { showError, showSuccess } = useToast()
  const [claims, setClaims] = useState<Claim[]>([])
  const [loading, setLoading] = useState(true)
  const [filterEmployee, setFilterEmployee] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<Partial<Claim>>({})
  const [editingLineId, setEditingLineId] = useState<number | null>(null)
  const [lineForm, setLineForm] = useState<Partial<LineItem>>({})
  const [tab, setTab] = useState<'claims' | 'settings' | 'chart'>('claims')
  const [costCenters, setCostCenters] = useState([...COST_CENTERS])
  const [expenseTypes, setExpenseTypes] = useState([...EXPENSE_TYPES])
  const [newCostCenter, setNewCostCenter] = useState('')
  const [newExpenseType, setNewExpenseType] = useState('')

  useEffect(() => { if (selectedCompanyId) loadClaims() }, [selectedCompanyId])

  async function loadClaims() {
    setLoading(true)
    const { data } = await supabase
      .from('expense_claims')
      .select('*, employee:employees!expense_claims_employee_id_fkey(first_name, last_name, email)')
      .eq('company_id', selectedCompanyId)
      .order('created_at', { ascending: false })
    setClaims((data as Claim[]) || [])
    setLoading(false)
  }

  async function loadLineItems(claimId: number) {
    const { data } = await supabase.from('expense_line_items').select('*').eq('expense_claim_id', claimId).order('date_of_purchase')
    if (data) {
      setClaims(prev => prev.map(c => c.id === claimId ? { ...c, line_items: data } : c))
    }
  }

  async function toggleExpand(id: number) {
    if (expandedId === id) { setExpandedId(null); return }
    setExpandedId(id)
    setEditingId(null)
    const claim = claims.find(c => c.id === id)
    if (!claim?.line_items) await loadLineItems(id)
  }

  function startEdit(claim: Claim) {
    setEditingId(claim.id)
    setEditForm({ title: claim.title, amount: claim.amount, status: claim.status, cost_center: claim.cost_center })
  }

  async function saveEdit(id: number) {
    const claim = claims.find(c => c.id === id)
    const oldStatus = claim?.status
    const newStatus = editForm.status

    const { error } = await supabase.from('expense_claims').update({
      title: editForm.title, amount: editForm.amount, status: newStatus, cost_center: editForm.cost_center,
      approved_at: newStatus === 'approved' ? new Date().toISOString() : null,
    }).eq('id', id)
    if (error) { showError('Failed to save expense claim: ' + error.message); return }

    if (claim && oldStatus === 'pending' && (newStatus === 'approved' || newStatus === 'rejected')) {
      const empName = claim.employee ? `${claim.employee.first_name} ${claim.employee.last_name}` : ''
      const empEmail = claim.employee?.email || ''
      const approved = newStatus === 'approved'
      const now = new Date().toISOString()
      const amountStr = `£${Number(claim.amount).toFixed(2)}`

      const { data: pendingWf } = await supabase.from('workflow_tracker')
        .select('assigned_to')
        .eq('record_type', 'Expense').eq('approval_id', id).eq('status', 'Pending')
        .eq('company_id', selectedCompanyId).limit(1).maybeSingle()
      const approverEmail = pendingWf?.assigned_to || ''

      await supabase.from('workflow_tracker').update({
        status: 'Complete',
        approval_status: approved ? 'Approved' : 'Declined',
        updated_at: now,
        task_description: approved
          ? `Expense claim ${claim.reference_number} approved - ${amountStr}`
          : `Expense claim ${claim.reference_number} declined`,
      }).eq('record_type', 'Expense').eq('approval_id', id).eq('status', 'Pending').eq('company_id', selectedCompanyId)

      await supabase.from('workflow_tracker').insert({
        emp_display_name: empName,
        step: 2, status: 'Complete', record_type: 'Expense',
        action: approved ? 'Expense approved' : 'Expense declined',
        employee_email: empEmail, assigned_to: empEmail,
        approval_id: id, reminder_count: 1,
        task_description: approved
          ? `Your expense claim ${claim.reference_number} (${amountStr}) has been approved by admin.`
          : `Your expense claim ${claim.reference_number} (${amountStr}) has been declined by admin. Please contact your manager.`,
        approval_status: approved ? 'Approved' : 'Declined',
        company_id: selectedCompanyId,
      })

      if (approverEmail) {
        await supabase.from('workflow_tracker').insert({
          emp_display_name: 'Admin',
          step: 2, status: 'Complete', record_type: 'Expense',
          action: approved ? 'Expense approved by admin' : 'Expense declined by admin',
          employee_email: approverEmail, assigned_to: approverEmail,
          approval_id: id, reminder_count: 1,
          task_description: `Admin ${approved ? 'approved' : 'declined'} expense claim ${claim.reference_number} (${amountStr}) for ${empName}`,
          approval_status: approved ? 'Approved' : 'Declined',
          company_id: selectedCompanyId,
        })
      }

      window.dispatchEvent(new Event('notifications-updated'))
    }

    setEditingId(null)
    loadClaims()
    showSuccess('Expense claim saved')
  }

  async function deleteClaim(id: number) {
    if (!confirm('Delete this expense claim and all line items?')) return
    const { error } = await supabase.from('expense_claims').delete().eq('id', id)
    if (error) { showError('Failed to delete expense claim: ' + error.message); return }
    setClaims(prev => prev.filter(c => c.id !== id))
    setExpandedId(null)
    showSuccess('Expense claim deleted')
  }

  function startLineEdit(item: LineItem) {
    setEditingLineId(item.id)
    setLineForm({ title: item.title, expense_type: item.expense_type, amount: item.amount, date_of_purchase: item.date_of_purchase })
  }

  async function saveLineEdit(lineId: number, claimId: number) {
    const { error } = await supabase.from('expense_line_items').update({
      title: lineForm.title, expense_type: lineForm.expense_type, amount: lineForm.amount, date_of_purchase: lineForm.date_of_purchase,
    }).eq('id', lineId)
    if (error) { showError('Failed to save line item: ' + error.message); return }
    setEditingLineId(null)
    await loadLineItems(claimId)
    const { data } = await supabase.from('expense_line_items').select('amount').eq('expense_claim_id', claimId)
    if (data) {
      const total = data.reduce((s, r) => s + Number(r.amount), 0)
      const { error: totalError } = await supabase.from('expense_claims').update({ amount: total }).eq('id', claimId)
      if (totalError) { showError('Failed to update claim total: ' + totalError.message); return }
      loadClaims()
    }
  }

  async function deleteLineItem(lineId: number, claimId: number) {
    if (!confirm('Delete this line item?')) return
    const { error } = await supabase.from('expense_line_items').delete().eq('id', lineId)
    if (error) { showError('Failed to delete line item: ' + error.message); return }
    await loadLineItems(claimId)
    const { data } = await supabase.from('expense_line_items').select('amount').eq('expense_claim_id', claimId)
    if (data) {
      const total = data.reduce((s, r) => s + Number(r.amount), 0)
      const { error: totalError } = await supabase.from('expense_claims').update({ amount: total }).eq('id', claimId)
      if (totalError) { showError('Failed to update claim total: ' + totalError.message); return }
      loadClaims()
    }
  }

  const employees = useMemo(() => {
    const names = new Set<string>()
    claims.forEach(c => { if (c.employee) names.add(`${c.employee.first_name} ${c.employee.last_name}`) })
    return Array.from(names).sort()
  }, [claims])

  const filtered = useMemo(() => {
    return claims.filter(c => {
      if (filterStatus && c.status !== filterStatus) return false
      if (filterEmployee && c.employee && `${c.employee.first_name} ${c.employee.last_name}` !== filterEmployee) return false
      return true
    })
  }, [claims, filterStatus, filterEmployee])

  const chartData = useMemo(() => {
    const now = new Date()
    const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
    const monthly = new Array(12).fill(0)
    claims.forEach(c => {
      const d = new Date(c.created_at)
      const m = d.getMonth()
      const y = d.getFullYear()
      let idx = -1
      if (m >= 3 && y === fyStart) idx = m - 3
      else if (m < 3 && y === fyStart + 1) idx = m + 9
      if (idx >= 0 && idx < 12) monthly[idx] += Number(c.amount)
    })
    const max = Math.max(...monthly, 1)
    const yearTotal = monthly.reduce((a, b) => a + b, 0)
    return { monthly, max, yearTotal, fyLabel: `${fyStart}/${fyStart + 1}` }
  }, [claims])

  return (
    <div className="admin-section">
      <div className="admin-page-header">
        <h2>Expense Management</h2>
        <p>{claims.length} total claims</p>
      </div>

      <div className="admin-tabs">
        <button className={`admin-tab ${tab === 'claims' ? 'admin-tab-active' : ''}`} onClick={() => setTab('claims')}>Claims</button>
        <button className={`admin-tab ${tab === 'chart' ? 'admin-tab-active' : ''}`} onClick={() => setTab('chart')}>Analytics</button>
        <button className={`admin-tab ${tab === 'settings' ? 'admin-tab-active' : ''}`} onClick={() => setTab('settings')}>Settings</button>
      </div>

      {tab === 'claims' && (
        <>
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
                <thead>
                  <tr>
                    <th>Ref</th><th>Employee</th><th>Title</th><th>Amount</th><th>Status</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(claim => (
                    <>
                      <tr key={claim.id} className={expandedId === claim.id ? 'admin-row-active' : ''}>
                        <td className="admin-td-mono">{claim.reference_number}</td>
                        <td>{claim.employee ? `${claim.employee.first_name} ${claim.employee.last_name}` : '—'}</td>
                        <td>{editingId === claim.id ? <input className="admin-inline-input" value={editForm.title || ''} onChange={e => setEditForm(p => ({...p, title: e.target.value}))} /> : claim.title}</td>
                        <td>{editingId === claim.id ? <input type="number" className="admin-inline-input admin-inline-sm" value={editForm.amount ?? ''} onChange={e => setEditForm(p => ({...p, amount: +e.target.value}))} /> : `£${Number(claim.amount).toFixed(2)}`}</td>
                        <td>{editingId === claim.id ? (
                          <select className="admin-inline-select" value={editForm.status || ''} onChange={e => setEditForm(p => ({...p, status: e.target.value}))}>
                            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        ) : <span className={`admin-badge admin-badge-${claim.status}`}>{claim.status}</span>}</td>
                        <td className="admin-actions">
                          {editingId === claim.id ? (
                            <>
                              <button className="admin-btn-sm admin-btn-save" onClick={() => saveEdit(claim.id)}>Save</button>
                              <button className="admin-btn-sm admin-btn-cancel" onClick={() => setEditingId(null)}>Cancel</button>
                            </>
                          ) : (
                            <>
                              <button className="admin-btn-icon" title="Expand" onClick={() => toggleExpand(claim.id)}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points={expandedId === claim.id ? "18 15 12 9 6 15" : "6 9 12 15 18 9"}/></svg>
                              </button>
                              <button className="admin-btn-icon" title="Edit" onClick={() => startEdit(claim)}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                              </button>
                              <button className="admin-btn-icon admin-btn-danger" title="Delete" onClick={() => deleteClaim(claim.id)}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                      {expandedId === claim.id && (
                        <tr key={`exp-${claim.id}`} className="admin-expanded-row">
                          <td colSpan={6}>
                            <div className="admin-expanded-content">
                              <div className="admin-detail-grid">
                                <div><strong>Cost Center:</strong> {claim.cost_center || '—'}</div>
                                <div><strong>Submitted:</strong> {claim.submitted_at ? new Date(claim.submitted_at).toLocaleDateString('en-GB') : '—'}</div>
                                <div><strong>Created:</strong> {new Date(claim.created_at).toLocaleDateString('en-GB')}</div>
                              </div>
                              <h4>Line Items</h4>
                              {(claim.line_items && claim.line_items.length > 0) ? (
                                <table className="admin-subtable">
                                  <thead><tr><th>Item</th><th>Type</th><th>Date</th><th>Amount</th><th>Receipt</th><th></th></tr></thead>
                                  <tbody>
                                    {claim.line_items.map(li => (
                                      <tr key={li.id}>
                                        <td>{editingLineId === li.id ? <input className="admin-inline-input" value={lineForm.title || ''} onChange={e => setLineForm(p => ({...p, title: e.target.value}))} /> : li.title}</td>
                                        <td>{editingLineId === li.id ? <input className="admin-inline-input" value={lineForm.expense_type || ''} onChange={e => setLineForm(p => ({...p, expense_type: e.target.value}))} /> : li.expense_type}</td>
                                        <td>{editingLineId === li.id ? <input type="date" className="admin-inline-input" value={lineForm.date_of_purchase || ''} onChange={e => setLineForm(p => ({...p, date_of_purchase: e.target.value}))} /> : new Date(li.date_of_purchase).toLocaleDateString('en-GB')}</td>
                                        <td>{editingLineId === li.id ? <input type="number" className="admin-inline-input admin-inline-sm" value={lineForm.amount ?? ''} onChange={e => setLineForm(p => ({...p, amount: +e.target.value}))} /> : `£${Number(li.amount).toFixed(2)}`}</td>
                                        <td>{li.receipt_url ? <a href={li.receipt_url} target="_blank" rel="noopener noreferrer" className="admin-link" title={t('common.view_receipt')}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#43a047" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg></a> : '—'}</td>
                                        <td className="admin-actions">
                                          {editingLineId === li.id ? (
                                            <>
                                              <button className="admin-btn-sm admin-btn-save" onClick={() => saveLineEdit(li.id, claim.id)}>Save</button>
                                              <button className="admin-btn-sm admin-btn-cancel" onClick={() => setEditingLineId(null)}>Cancel</button>
                                            </>
                                          ) : (
                                            <>
                                              <button className="admin-btn-icon" onClick={() => startLineEdit(li)}>
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                              </button>
                                              <button className="admin-btn-icon admin-btn-danger" onClick={() => deleteLineItem(li.id, claim.id)}>
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                                              </button>
                                            </>
                                          )}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              ) : <p className="admin-empty-text">No line items</p>}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && <div className="admin-empty">No expense claims found</div>}
            </div>
          )}
        </>
      )}

      {tab === 'chart' && (
        <div className="admin-chart-section">
          <h3>Monthly Expense Totals — FY {chartData.fyLabel}</h3>
          <div className="admin-bar-chart">
            {MONTHS.map((m, i) => (
              <div key={m} className="admin-bar-col">
                <span className="admin-bar-value">£{chartData.monthly[i] > 0 ? chartData.monthly[i].toFixed(0) : ''}</span>
                <div className="admin-bar" style={{ height: `${(chartData.monthly[i] / chartData.max) * 180}px` }} />
                <span className="admin-bar-label">{m}</span>
              </div>
            ))}
          </div>
          <div className="admin-chart-total">
            <strong>FY Total:</strong> £{chartData.yearTotal.toFixed(2)}
          </div>
        </div>
      )}

      {tab === 'settings' && (
        <div className="admin-settings-section">
          <div className="admin-settings-group">
            <h3>Cost Centers</h3>
            <div className="admin-tag-list">
              {costCenters.map(cc => (
                <div key={cc} className="admin-tag">
                  <span>{cc}</span>
                  <button onClick={() => setCostCenters(prev => prev.filter(x => x !== cc))}>×</button>
                </div>
              ))}
            </div>
            <div className="admin-add-row">
              <input placeholder="New cost center..." value={newCostCenter} onChange={e => setNewCostCenter(e.target.value)} className="admin-input" />
              <button className="admin-btn-sm admin-btn-save" onClick={() => { if (newCostCenter.trim()) { setCostCenters(prev => [...prev, newCostCenter.trim()]); setNewCostCenter('') } }}>Add</button>
            </div>
          </div>
          <div className="admin-settings-group">
            <h3>Expense Types</h3>
            <div className="admin-tag-list">
              {expenseTypes.map(et => (
                <div key={et} className="admin-tag">
                  <span>{et}</span>
                  <button onClick={() => setExpenseTypes(prev => prev.filter(x => x !== et))}>×</button>
                </div>
              ))}
            </div>
            <div className="admin-add-row">
              <input placeholder="New expense type..." value={newExpenseType} onChange={e => setNewExpenseType(e.target.value)} className="admin-input" />
              <button className="admin-btn-sm admin-btn-save" onClick={() => { if (newExpenseType.trim()) { setExpenseTypes(prev => [...prev, newExpenseType.trim()]); setNewExpenseType('') } }}>Add</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
