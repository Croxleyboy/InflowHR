import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { useToast } from '../../context/ToastContext'

interface Employee {
  id: string
  employee_number: string
  first_name: string
  last_name: string
  email: string
  job_title: string | null
  department: string | null
  phone: string | null
  start_date: string
  is_active: boolean
  is_admin: boolean
  avatar_url: string | null
  date_of_birth: string | null
  gender: string | null
  nationality: string | null
  marital_status: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  county: string | null
  postcode: string | null
  country: string | null
  emergency_contact_name: string | null
  emergency_contact_phone: string | null
  emergency_contact_relationship: string | null
  ni_number: string | null
  bank_sort_code: string | null
  bank_account_number: string | null
  bank_account_name: string | null
  probation_end_date: string | null
  notice_period: string | null
  working_pattern: string | null
  weekly_hours: number | null
  location: string | null
  contract_type: string | null
  annual_salary: number | null
  tax_code: string | null
  payroll_id: string | null
  personal_email: string | null
  manager_name: string | null
  manager_email: string | null
  leave_allowance: number | null
  salary_group: string | null
  qualifications: string | null
  religion: string | null
}

export default function AdminEmployees() {
  const { selectedCompanyId } = useAdminCompany()
  const { showError, showSuccess } = useToast()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [filterDept, setFilterDept] = useState('')
  const [filterActive, setFilterActive] = useState('')
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Record<string, any>>({})
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [uploading, setUploading] = useState<string | null>(null)

  useEffect(() => { if (selectedCompanyId) load() }, [selectedCompanyId])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('employees').select('*').eq('company_id', selectedCompanyId).order('last_name')
    setEmployees((data as Employee[]) || [])
    setLoading(false)
  }

  function startEdit(emp: Employee) {
    setEditingId(emp.id)
    setEditForm({
      first_name: emp.first_name, last_name: emp.last_name, email: emp.email,
      job_title: emp.job_title || '', department: emp.department || '', phone: emp.phone || '',
      is_active: emp.is_active, is_admin: emp.is_admin,
      date_of_birth: emp.date_of_birth || '', gender: emp.gender || '',
      nationality: emp.nationality || '', marital_status: emp.marital_status || '',
      address_line1: emp.address_line1 || '', address_line2: emp.address_line2 || '',
      city: emp.city || '', county: emp.county || '', postcode: emp.postcode || '',
      country: emp.country || 'United Kingdom',
      emergency_contact_name: emp.emergency_contact_name || '',
      emergency_contact_phone: emp.emergency_contact_phone || '',
      emergency_contact_relationship: emp.emergency_contact_relationship || '',
      ni_number: emp.ni_number || '',
      bank_sort_code: emp.bank_sort_code || '', bank_account_number: emp.bank_account_number || '',
      bank_account_name: emp.bank_account_name || '',
      probation_end_date: emp.probation_end_date || '', notice_period: emp.notice_period || '',
      working_pattern: emp.working_pattern || 'Full-time', weekly_hours: emp.weekly_hours ?? 37.5,
      location: emp.location || '', contract_type: emp.contract_type || 'Permanent',
      annual_salary: emp.annual_salary ?? '', tax_code: emp.tax_code || '',
      payroll_id: emp.payroll_id || '', personal_email: emp.personal_email || '',
      manager_name: emp.manager_name || '', manager_email: emp.manager_email || '',
      leave_allowance: emp.leave_allowance ?? 15,
      salary_group: emp.salary_group || 'N/A',
      qualifications: emp.qualifications || '',
      religion: emp.religion || '',
    })
  }

  async function saveEdit(id: string) {
    const dateFields = ['date_of_birth', 'probation_end_date', 'start_date']
    const numericFields = ['weekly_hours', 'annual_salary', 'leave_allowance']
    const payload: Record<string, any> = {}
    for (const [k, v] of Object.entries(editForm)) {
      if (dateFields.includes(k)) { payload[k] = v || null }
      else if (numericFields.includes(k)) { payload[k] = v !== '' && v != null ? parseFloat(v) : null }
      else if (typeof v === 'string') { payload[k] = v || null }
      else { payload[k] = v }
    }
    const { error } = await supabase.from('employees').update(payload).eq('id', id)
    if (error) { showError('Failed to save employee: ' + error.message); return }
    setEditingId(null)
    showSuccess('Employee updated')
    load()
  }

  async function deactivateEmployee(id: string) {
    if (!confirm('Deactivate this employee? This will mark them as inactive.')) return
    const { error } = await supabase.from('employees').update({ is_active: false }).eq('id', id)
    if (error) { showError('Failed to deactivate employee: ' + error.message); return }
    showSuccess('Employee deactivated')
    load()
  }

  async function permanentlyDeleteEmployee(emp: Employee) {
    if (!confirm(`Permanently delete ${emp.first_name} ${emp.last_name} and all their related records? This cannot be undone.`)) return

    const deletes: { table: string; column: string; value: string }[] = [
      { table: 'one_to_one_comments', column: 'author_id', value: emp.id },
      { table: 'one_to_one_meetings', column: 'employee_id', value: emp.id },
      { table: 'one_to_one_meetings', column: 'manager_id', value: emp.id },
      { table: 'performance_reviews', column: 'employee_id', value: emp.id },
      { table: 'performance_reviews', column: 'reviewer_id', value: emp.id },
      { table: 'course_enrolments', column: 'employee_id', value: emp.id },
      { table: 'benefit_enrollments', column: 'employee_id', value: emp.id },
      { table: 'kudos', column: 'from_employee_id', value: emp.id },
      { table: 'kudos', column: 'to_employee_id', value: emp.id },
      { table: 'notifications', column: 'employee_id', value: emp.id },
      { table: 'timesheets', column: 'employee_id', value: emp.id },
      { table: 'leave_requests', column: 'employee_id', value: emp.id },
      { table: 'leave_balances', column: 'employee_id', value: emp.id },
      { table: 'expense_line_items', column: 'claim_id', value: '__expense_claims__' },
      { table: 'expense_claims', column: 'employee_id', value: emp.id },
      { table: 'payslips', column: 'employee_id', value: emp.id },
      { table: 'company_users', column: 'employee_id', value: emp.id },
    ]

    // Null out approved_by / reviewer references that point to this employee
    await supabase.from('expense_claims').update({ approved_by: null }).eq('approved_by', emp.id)
    await supabase.from('leave_requests').update({ approved_by: null }).eq('approved_by', emp.id)
    await supabase.from('timesheets').update({ approved_by: null }).eq('approved_by', emp.id)
    await supabase.from('employees').update({ manager_id: null }).eq('manager_id', emp.id)

    // Delete expense_line_items for this employee's claims first
    const { data: claims } = await supabase.from('expense_claims').select('id').eq('employee_id', emp.id)
    if (claims && claims.length > 0) {
      const claimIds = claims.map(c => c.id)
      await supabase.from('expense_line_items').delete().in('claim_id', claimIds)
    }

    for (const d of deletes) {
      if (d.value === '__expense_claims__') continue
      const { error: err } = await supabase.from(d.table).delete().eq(d.column, d.value)
      if (err) { showError(`Failed to delete ${d.table}: ${err.message}`); return }
    }

    const { error: onboardingErr } = await supabase.from('onboarding').delete().eq('user_email', emp.email)
    if (onboardingErr) { showError('Failed to delete onboarding record: ' + onboardingErr.message); return }

    const { error } = await supabase.from('employees').delete().eq('id', emp.id)
    if (error) {
      showError(`Failed to delete: ${error.message}`)
      return
    }
    showSuccess('Employee deleted')
    load()
  }

  async function uploadPhoto(emp: Employee, file: File) {
    setUploading(emp.id)
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
    const path = `${emp.id}.${ext}`
    const { error: uploadErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true })
    if (uploadErr) { showError('Upload failed: ' + uploadErr.message); setUploading(null); return }
    const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path)
    const avatarUrl = urlData.publicUrl + '?t=' + Date.now()
    const { error: empErr } = await supabase.from('employees').update({ avatar_url: avatarUrl }).eq('id', emp.id)
    if (empErr) console.error('Employee update failed:', empErr)
    const { error: onbErr } = await supabase.from('onboarding').update({ avatar_url: avatarUrl }).eq('user_email', emp.email)
    if (onbErr) console.error('Onboarding update failed:', onbErr)
    if (empErr && onbErr) showError('Photo uploaded but database update failed. Check RLS policies.')
    else showSuccess('Photo updated')
    setUploading(null)
    load()
  }

  async function removePhoto(emp: Employee) {
    if (!confirm('Remove this employee photo?')) return
    const { error: empErr } = await supabase.from('employees').update({ avatar_url: null }).eq('id', emp.id)
    if (empErr) { showError('Failed to remove photo: ' + empErr.message); return }
    const { error: onbErr } = await supabase.from('onboarding').update({ avatar_url: null }).eq('user_email', emp.email)
    if (onbErr) console.error('Onboarding photo update failed:', onbErr)
    showSuccess('Photo removed')
    load()
  }

  const departments = useMemo(() => {
    const depts = new Set<string>()
    employees.forEach(e => { if (e.department) depts.add(e.department) })
    return Array.from(depts).sort()
  }, [employees])

  const filtered = useMemo(() => {
    return employees.filter(e => {
      if (filterDept && e.department !== filterDept) return false
      if (filterActive === 'active' && !e.is_active) return false
      if (filterActive === 'inactive' && e.is_active) return false
      if (search) {
        const q = search.toLowerCase()
        if (!`${e.first_name} ${e.last_name} ${e.email} ${e.employee_number}`.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [employees, filterDept, filterActive, search])

  return (
    <div className="admin-section">
      <div className="admin-page-header">
        <h2>Employee Management</h2>
        <p>{employees.length} employees · {employees.filter(e => e.is_active).length} active</p>
      </div>

      <div className="admin-filters">
        <input placeholder="Search name, email, ID..." value={search} onChange={e => setSearch(e.target.value)} className="admin-input admin-search" />
        <select value={filterDept} onChange={e => setFilterDept(e.target.value)} className="admin-select">
          <option value="">All Departments</option>
          {departments.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={filterActive} onChange={e => setFilterActive(e.target.value)} className="admin-select">
          <option value="">All</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {loading ? <div className="admin-loading">Loading...</div> : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>ID</th><th>Name</th><th>Email</th><th>Department</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {filtered.map(emp => (
                <>
                  <tr key={emp.id} className={expandedId === emp.id ? 'admin-row-active' : ''}>
                    <td className="admin-td-mono">{emp.employee_number}</td>
                    <td>{editingId === emp.id ? (
                      <div className="admin-name-inputs">
                        <input className="admin-inline-input" value={editForm.first_name} onChange={e => setEditForm(f => ({...f, first_name: e.target.value}))} placeholder="First" />
                        <input className="admin-inline-input" value={editForm.last_name} onChange={e => setEditForm(f => ({...f, last_name: e.target.value}))} placeholder="Last" />
                      </div>
                    ) : `${emp.first_name} ${emp.last_name}`}</td>
                    <td>{editingId === emp.id ? <input className="admin-inline-input" value={editForm.email} onChange={e => setEditForm(f => ({...f, email: e.target.value}))} /> : emp.email}</td>
                    <td>{editingId === emp.id ? <input className="admin-inline-input" value={editForm.department} onChange={e => setEditForm(f => ({...f, department: e.target.value}))} /> : (emp.department || '—')}</td>
                    <td>{editingId === emp.id ? <input className="admin-inline-input" value={editForm.job_title} onChange={e => setEditForm(f => ({...f, job_title: e.target.value}))} /> : (emp.job_title || '—')}</td>
                    <td><span className={`admin-badge ${emp.is_active ? 'admin-badge-approved' : 'admin-badge-rejected'}`}>{emp.is_active ? 'Active' : 'Inactive'}</span></td>
                    <td className="admin-actions">
                      {editingId === emp.id ? (
                        <>
                          <button className="admin-btn-sm admin-btn-save" onClick={() => saveEdit(emp.id)}>Save</button>
                          <button className="admin-btn-sm admin-btn-cancel" onClick={() => setEditingId(null)}>Cancel</button>
                        </>
                      ) : (
                        <>
                          <button className="admin-btn-icon" onClick={() => setExpandedId(expandedId === emp.id ? null : emp.id)}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points={expandedId === emp.id ? "18 15 12 9 6 15" : "6 9 12 15 18 9"}/></svg>
                          </button>
                          <button className="admin-btn-icon" onClick={() => startEdit(emp)}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                          </button>
                          <button className="admin-btn-icon" title="Deactivate" onClick={() => deactivateEmployee(emp.id)}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
                          </button>
                          <button className="admin-btn-icon admin-btn-danger" title="Delete permanently" onClick={() => permanentlyDeleteEmployee(emp)}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                  {expandedId === emp.id && (
                    <tr key={`exp-${emp.id}`} className="admin-expanded-row">
                      <td colSpan={7}>
                        <div className="admin-expanded-content" style={{display:'flex', gap:'20px', alignItems:'flex-start'}}>
                          <div className="admin-photo-section">
                            <div className="admin-photo-preview">
                              {emp.avatar_url ? (
                                <img src={emp.avatar_url} alt={`${emp.first_name} ${emp.last_name}`} className="admin-photo-img" />
                              ) : (
                                <div className="admin-photo-placeholder">
                                  <span>{emp.first_name[0]}{emp.last_name[0]}</span>
                                </div>
                              )}
                            </div>
                            <div className="admin-photo-actions">
                              <label className="admin-btn-sm admin-btn-save admin-photo-upload-label">
                                {uploading === emp.id ? 'Uploading...' : emp.avatar_url ? 'Change Photo' : 'Upload Photo'}
                                <input type="file" accept="image/*" style={{display:'none'}} disabled={uploading === emp.id}
                                  onChange={e => { const f = e.target.files?.[0]; if (f) uploadPhoto(emp, f); e.target.value = '' }} />
                              </label>
                              {emp.avatar_url && (
                                <button className="admin-btn-sm admin-btn-cancel" onClick={() => removePhoto(emp)}>Remove</button>
                              )}
                            </div>
                          </div>
                          <div style={{flex:1}}>
                            {editingId === emp.id ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                                <fieldset style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 16 }}>
                                  <legend style={{ fontWeight: 700, fontSize: 13, color: '#1565c0' }}>Personal Details</legend>
                                  <div className="admin-detail-grid admin-detail-grid-3">
                                    {[
                                      { k: 'date_of_birth', l: 'Date of Birth', t: 'date' },
                                      { k: 'gender', l: 'Gender', t: 'select', opts: ['', 'Male', 'Female', 'Non-binary', 'Prefer not to say'] },
                                      { k: 'nationality', l: 'Nationality' },
                                      { k: 'marital_status', l: 'Marital Status', t: 'select', opts: ['', 'Single', 'Married', 'Civil Partnership', 'Divorced', 'Widowed', 'Prefer not to say'] },
                                      { k: 'religion', l: 'Religion' },
                                      { k: 'ni_number', l: 'NI Number' },
                                      { k: 'personal_email', l: 'Personal Email' },
                                    ].map(f => (
                                      <div key={f.k} className="admin-form-field">
                                        <label style={{ fontSize: 12 }}>{f.l}</label>
                                        {f.t === 'select' ? (
                                          <select className="admin-select" value={editForm[f.k] || ''} onChange={e => setEditForm(p => ({...p, [f.k]: e.target.value}))}>
                                            {f.opts!.map(o => <option key={o} value={o}>{o || '—'}</option>)}
                                          </select>
                                        ) : (
                                          <input className="admin-inline-input" type={f.t || 'text'} value={editForm[f.k] || ''} onChange={e => setEditForm(p => ({...p, [f.k]: e.target.value}))} />
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </fieldset>
                                <fieldset style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 16 }}>
                                  <legend style={{ fontWeight: 700, fontSize: 13, color: '#1565c0' }}>Address</legend>
                                  <div className="admin-detail-grid admin-detail-grid-3">
                                    {[
                                      { k: 'address_line1', l: 'Address Line 1' }, { k: 'address_line2', l: 'Address Line 2' },
                                      { k: 'city', l: 'City' }, { k: 'county', l: 'County' },
                                      { k: 'postcode', l: 'Postcode' }, { k: 'country', l: 'Country' },
                                    ].map(f => (
                                      <div key={f.k} className="admin-form-field">
                                        <label style={{ fontSize: 12 }}>{f.l}</label>
                                        <input className="admin-inline-input" value={editForm[f.k] || ''} onChange={e => setEditForm(p => ({...p, [f.k]: e.target.value}))} />
                                      </div>
                                    ))}
                                  </div>
                                </fieldset>
                                <fieldset style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 16 }}>
                                  <legend style={{ fontWeight: 700, fontSize: 13, color: '#1565c0' }}>Employment</legend>
                                  <div className="admin-detail-grid admin-detail-grid-3">
                                    {[
                                      { k: 'location', l: 'Work Location' },
                                      { k: 'contract_type', l: 'Contract Type', t: 'select', opts: ['Permanent', 'Fixed-term', 'Full-time', 'Part-time', 'Contract', 'Apprentice', 'Intern', 'Guest'] },
                                      { k: 'working_pattern', l: 'Working Pattern', t: 'select', opts: ['Full-time', 'Part-time', 'Compressed', 'Flexible', 'Shift', 'Term-time'] },
                                      { k: 'weekly_hours', l: 'Weekly Hours', t: 'number' },
                                      { k: 'probation_end_date', l: 'Probation End Date', t: 'date' },
                                      { k: 'notice_period', l: 'Notice Period' },
                                      { k: 'manager_name', l: 'Manager Name' },
                                      { k: 'manager_email', l: 'Manager Email' },
                                      { k: 'leave_allowance', l: 'Leave Allowance (Days)', t: 'number' },
                                      { k: 'salary_group', l: 'Salary Group' },
                                    ].map(f => (
                                      <div key={f.k} className="admin-form-field">
                                        <label style={{ fontSize: 12 }}>{f.l}</label>
                                        {f.t === 'select' ? (
                                          <select className="admin-select" value={editForm[f.k] || ''} onChange={e => setEditForm(p => ({...p, [f.k]: e.target.value}))}>
                                            {f.opts!.map(o => <option key={o} value={o}>{o}</option>)}
                                          </select>
                                        ) : (
                                          <input className="admin-inline-input" type={f.t || 'text'} value={editForm[f.k] ?? ''} onChange={e => setEditForm(p => ({...p, [f.k]: e.target.value}))} />
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </fieldset>
                                <fieldset style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 16 }}>
                                  <legend style={{ fontWeight: 700, fontSize: 13, color: '#1565c0' }}>Qualifications</legend>
                                  <div className="admin-form-field">
                                    <label style={{ fontSize: 12 }}>Qualifications</label>
                                    <textarea className="admin-inline-input" rows={4} value={editForm.qualifications || ''} onChange={e => setEditForm(p => ({...p, qualifications: e.target.value}))} style={{ resize: 'vertical', fontFamily: 'inherit' }} />
                                  </div>
                                </fieldset>
                                <fieldset style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 16 }}>
                                  <legend style={{ fontWeight: 700, fontSize: 13, color: '#1565c0' }}>Payroll</legend>
                                  <div className="admin-detail-grid admin-detail-grid-3">
                                    {[
                                      { k: 'annual_salary', l: 'Annual Salary (£)', t: 'number' },
                                      { k: 'tax_code', l: 'Tax Code' },
                                      { k: 'payroll_id', l: 'Payroll ID' },
                                    ].map(f => (
                                      <div key={f.k} className="admin-form-field">
                                        <label style={{ fontSize: 12 }}>{f.l}</label>
                                        <input className="admin-inline-input" type={f.t || 'text'} value={editForm[f.k] ?? ''} onChange={e => setEditForm(p => ({...p, [f.k]: e.target.value}))} />
                                      </div>
                                    ))}
                                  </div>
                                </fieldset>
                                <fieldset style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 16 }}>
                                  <legend style={{ fontWeight: 700, fontSize: 13, color: '#1565c0' }}>Emergency Contact</legend>
                                  <div className="admin-detail-grid admin-detail-grid-3">
                                    {[
                                      { k: 'emergency_contact_name', l: 'Contact Name' },
                                      { k: 'emergency_contact_phone', l: 'Contact Phone' },
                                      { k: 'emergency_contact_relationship', l: 'Relationship' },
                                    ].map(f => (
                                      <div key={f.k} className="admin-form-field">
                                        <label style={{ fontSize: 12 }}>{f.l}</label>
                                        <input className="admin-inline-input" value={editForm[f.k] || ''} onChange={e => setEditForm(p => ({...p, [f.k]: e.target.value}))} />
                                      </div>
                                    ))}
                                  </div>
                                </fieldset>
                                <fieldset style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 16 }}>
                                  <legend style={{ fontWeight: 700, fontSize: 13, color: '#1565c0' }}>Bank Details</legend>
                                  <div className="admin-detail-grid admin-detail-grid-3">
                                    {[
                                      { k: 'bank_account_name', l: 'Account Name' },
                                      { k: 'bank_sort_code', l: 'Sort Code' },
                                      { k: 'bank_account_number', l: 'Account Number' },
                                    ].map(f => (
                                      <div key={f.k} className="admin-form-field">
                                        <label style={{ fontSize: 12 }}>{f.l}</label>
                                        <input className="admin-inline-input" value={editForm[f.k] || ''} onChange={e => setEditForm(p => ({...p, [f.k]: e.target.value}))} />
                                      </div>
                                    ))}
                                  </div>
                                </fieldset>
                              </div>
                            ) : (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                <div className="admin-detail-grid admin-detail-grid-3">
                                  <div><strong>Phone:</strong> {emp.phone || '—'}</div>
                                  <div><strong>Start Date:</strong> {emp.start_date ? new Date(emp.start_date).toLocaleDateString('en-GB') : '—'}</div>
                                  <div><strong>Admin:</strong> {emp.is_admin ? 'Yes' : 'No'}</div>
                                  <div><strong>Employee ID:</strong> {emp.employee_number}</div>
                                  <div><strong>Location:</strong> {emp.location || '—'}</div>
                                  <div><strong>Contract:</strong> {emp.contract_type || '—'}</div>
                                  <div><strong>DOB:</strong> {emp.date_of_birth ? new Date(emp.date_of_birth).toLocaleDateString('en-GB') : '—'}</div>
                                  <div><strong>Gender:</strong> {emp.gender || '—'}</div>
                                  <div><strong>Nationality:</strong> {emp.nationality || '—'}</div>
                                  <div><strong>Marital Status:</strong> {emp.marital_status || '—'}</div>
                                  <div><strong>Religion:</strong> {emp.religion || '—'}</div>
                                  <div><strong>NI Number:</strong> {emp.ni_number || '—'}</div>
                                  <div><strong>Personal Email:</strong> {emp.personal_email || '—'}</div>
                                </div>
                                {(emp.address_line1 || emp.city || emp.postcode) && (
                                  <div>
                                    <strong>Address:</strong> {[emp.address_line1, emp.address_line2, emp.city, emp.county, emp.postcode, emp.country].filter(Boolean).join(', ') || '—'}
                                  </div>
                                )}
                                <div className="admin-detail-grid admin-detail-grid-3">
                                  <div><strong>Working Pattern:</strong> {emp.working_pattern || '—'}</div>
                                  <div><strong>Weekly Hours:</strong> {emp.weekly_hours ?? '—'}</div>
                                  <div><strong>Notice Period:</strong> {emp.notice_period || '—'}</div>
                                  <div><strong>Probation End:</strong> {emp.probation_end_date ? new Date(emp.probation_end_date).toLocaleDateString('en-GB') : '—'}</div>
                                  <div><strong>Manager:</strong> {emp.manager_name || '—'}</div>
                                  <div><strong>Manager Email:</strong> {emp.manager_email || '—'}</div>
                                  <div><strong>Leave Allowance:</strong> {emp.leave_allowance ?? 15} days</div>
                                  <div><strong>Salary Group:</strong> {emp.salary_group || 'N/A'}</div>
                                </div>
                                {emp.qualifications && (
                                  <div>
                                    <strong>Qualifications:</strong> <span style={{ whiteSpace: 'pre-line' }}>{emp.qualifications}</span>
                                  </div>
                                )}
                                <div className="admin-detail-grid admin-detail-grid-3">
                                  <div><strong>Salary:</strong> {emp.annual_salary ? `£${Number(emp.annual_salary).toLocaleString()}` : '—'}</div>
                                  <div><strong>Tax Code:</strong> {emp.tax_code || '—'}</div>
                                  <div><strong>Payroll ID:</strong> {emp.payroll_id || '—'}</div>
                                </div>
                                {emp.emergency_contact_name && (
                                  <div className="admin-detail-grid admin-detail-grid-3">
                                    <div><strong>Emergency Contact:</strong> {emp.emergency_contact_name}</div>
                                    <div><strong>Emergency Phone:</strong> {emp.emergency_contact_phone || '—'}</div>
                                    <div><strong>Relationship:</strong> {emp.emergency_contact_relationship || '—'}</div>
                                  </div>
                                )}
                                {emp.bank_account_name && (
                                  <div className="admin-detail-grid admin-detail-grid-3">
                                    <div><strong>Bank Account:</strong> {emp.bank_account_name}</div>
                                    <div><strong>Sort Code:</strong> {emp.bank_sort_code || '—'}</div>
                                    <div><strong>Account No:</strong> {emp.bank_account_number || '—'}</div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <div className="admin-empty">No employees found</div>}
        </div>
      )}
    </div>
  )
}
