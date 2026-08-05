import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { useToast } from '../../context/ToastContext'

interface Company {
  id: string
  name: string
  domain: string
  microsoft_tenant_id: string | null
  is_active: boolean
  login_disabled: boolean
  created_at: string
  logo_url: string | null
}

interface Employee {
  id: string
  first_name: string
  last_name: string
  email: string
  is_admin: boolean
}

interface CompanyAdmin {
  employee_id: string | null
  employee: { first_name: string; last_name: string; email: string } | null
}

async function uploadCompanyLogo(companyId: string, file: File): Promise<string | null> {
  const ext = file.name.split('.').pop()?.toLowerCase() || 'png'
  const path = `${companyId}.${ext}`
  const { error } = await supabase.storage
    .from('company-logos')
    .upload(path, file, { upsert: true })
  if (error) return null
  const { data } = supabase.storage.from('company-logos').getPublicUrl(path)
  return data.publicUrl + '?t=' + Date.now()
}

export default function AdminCompanies() {
  const { company: myCompany } = useAuth()
  const { refreshCompanies } = useAdminCompany()
  const { showError, showSuccess } = useToast()
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', domain: '' })
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [admins, setAdmins] = useState<Record<string, CompanyAdmin>>({})
  const [employees, setEmployees] = useState<Record<string, Employee[]>>({})
  const [editingAdmin, setEditingAdmin] = useState<string | null>(null)
  const [savingAdmin, setSavingAdmin] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState<string | null>(null)
  const logoInputRef = useRef<HTMLInputElement>(null)
  const editLogoRef = useRef<HTMLInputElement>(null)

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('companies')
      .select('*')
      .order('created_at', { ascending: false })
    const cos = (data as Company[]) || []
    setCompanies(cos)

    const adminMap: Record<string, CompanyAdmin> = {}
    const companyIds = cos.map(co => co.id)
    if (companyIds.length > 0) {
      const { data: allAdmins } = await supabase
        .from('company_users')
        .select('company_id, employee_id, employee:employees!company_users_employee_id_fkey(first_name, last_name, email)')
        .in('company_id', companyIds)
        .eq('role', 'admin')
      for (const co of cos) {
        const cu = (allAdmins || []).find((a: any) => a.company_id === co.id)
        adminMap[co.id] = cu
          ? { employee_id: cu.employee_id, employee: (Array.isArray(cu.employee) ? cu.employee[0] : cu.employee) as CompanyAdmin['employee'] }
          : { employee_id: null, employee: null }
      }
    }
    setAdmins(adminMap)
    setLoading(false)
  }

  async function loadEmployees(companyId: string) {
    if (employees[companyId]) return
    const { data } = await supabase
      .from('employees')
      .select('id, first_name, last_name, email, is_admin')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .order('first_name')
    setEmployees(prev => ({ ...prev, [companyId]: (data as Employee[]) || [] }))
  }

  useEffect(() => { load() }, [])

  function handleLogoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setLogoFile(file)
    const reader = new FileReader()
    reader.onload = ev => setLogoPreview(ev.target?.result as string)
    reader.readAsDataURL(file)
  }

  async function addCompany() {
    if (!form.name.trim() || !form.domain.trim()) return
    setSaving(true)
    const domain = form.domain.trim().toLowerCase().replace(/^@/, '')
    const { data: newCo, error: insertError } = await supabase.from('companies').insert({
      name: form.name.trim(),
      domain,
      microsoft_tenant_id: `pending-${Date.now()}`,
      is_active: true,
    }).select('id').single()

    if (insertError) {
      alert(`Failed to add company: ${insertError.message}`)
      setSaving(false)
      return
    }

    if (newCo) {
      if (logoFile) {
        const logoUrl = await uploadCompanyLogo(newCo.id, logoFile)
        if (logoUrl) {
          const { error } = await supabase.from('companies').update({ logo_url: logoUrl }).eq('id', newCo.id)
          if (error) showError('Failed to save company logo: ' + error.message)
        }
      }

      const { error: leaveTypesError } = await supabase.from('leave_types').insert([
        { name: 'Annual Leave', company_id: newCo.id, deducts_from_allowance: true },
        { name: 'Sick Leave', company_id: newCo.id, deducts_from_allowance: false },
        { name: 'Jury Duty', company_id: newCo.id, deducts_from_allowance: false },
        { name: 'Bereavement', company_id: newCo.id, deducts_from_allowance: true },
        { name: 'Exam Leave', company_id: newCo.id, deducts_from_allowance: true },
        { name: 'Carers Leave', company_id: newCo.id, deducts_from_allowance: true },
        { name: 'Career Break', company_id: newCo.id, deducts_from_allowance: true },
        { name: 'Lieu Days', company_id: newCo.id, deducts_from_allowance: false },
      ])
      if (leaveTypesError) showError('Failed to create default leave types: ' + leaveTypesError.message)

      const { error: featuresError } = await supabase.from('company_features').insert([
        { company_id: newCo.id, feature_key: 'expenses', is_enabled: true },
        { company_id: newCo.id, feature_key: 'leave', is_enabled: true },
        { company_id: newCo.id, feature_key: 'kudos', is_enabled: true },
        { company_id: newCo.id, feature_key: 'elearning', is_enabled: true },
        { company_id: newCo.id, feature_key: 'timesheets', is_enabled: true },
        { company_id: newCo.id, feature_key: 'payroll', is_enabled: false },
        { company_id: newCo.id, feature_key: 'performance', is_enabled: false },
        { company_id: newCo.id, feature_key: 'shifts', is_enabled: false },
        { company_id: newCo.id, feature_key: 'benefits', is_enabled: false },
        { company_id: newCo.id, feature_key: 'legal_timesheets', is_enabled: false },
      ])
      if (featuresError) showError('Failed to create default company features: ' + featuresError.message)

      await supabase.from('announcements').insert({
        title: 'Welcome to your new HR App',
        body: "Take a look within 'Settings' and choose the guide to get to know your app and its features.",
        submitted_by_name: 'InflowHR',
        is_pinned: true,
        company_id: newCo.id,
      })
    }

    setForm({ name: '', domain: '' })
    setLogoFile(null)
    setLogoPreview(null)
    setShowForm(false)
    setSaving(false)
    load()
    refreshCompanies()
    showSuccess('Company registered successfully')
  }

  async function handleEditLogo(companyId: string, file: File) {
    setUploadingLogo(companyId)
    const logoUrl = await uploadCompanyLogo(companyId, file)
    if (logoUrl) {
      const { error } = await supabase.from('companies').update({ logo_url: logoUrl }).eq('id', companyId)
      if (error) {
        showError('Failed to save company logo: ' + error.message)
        setUploadingLogo(null)
        return
      }
    }
    setUploadingLogo(null)
    load()
  }

  async function removeLogo(companyId: string) {
    const { error } = await supabase.from('companies').update({ logo_url: null }).eq('id', companyId)
    if (error) { showError('Failed to remove logo: ' + error.message); return }
    load()
  }

  async function toggleActive(id: string, currentlyActive: boolean) {
    if (id === myCompany?.id && currentlyActive) {
      alert('You cannot disable your own company.')
      return
    }
    const { error } = await supabase.from('companies').update({ is_active: !currentlyActive }).eq('id', id)
    if (error) { showError('Failed to update company status: ' + error.message); return }
    load()
  }

  async function deleteCompany(id: string) {
    if (id === myCompany?.id) {
      alert('You cannot delete your own company.')
      return
    }
    const company = companies.find(c => c.id === id)
    if (!confirm(`Delete "${company?.name || 'this company'}" and ALL its data? This cannot be undone.`)) return
    await supabase.from('company_features').delete().eq('company_id', id)
    await supabase.from('company_elearning_courses').delete().eq('company_id', id)
    await supabase.from('benefits').delete().eq('company_id', id)
    await supabase.from('courses').delete().eq('company_id', id)
    const { error } = await supabase.rpc('delete_company_data' as any, { p_company_id: id })
    if (error) {
      alert('Error deleting company: ' + error.message)
      return
    }
    load()
  }

  async function toggleLoginDisabled(id: string, currentlyDisabled: boolean) {
    if (id === myCompany?.id && !currentlyDisabled) {
      alert('You cannot disable login for your own company.')
      return
    }
    const { error } = await supabase.from('companies').update({ login_disabled: !currentlyDisabled }).eq('id', id)
    if (error) { showError('Failed to update login status: ' + error.message); return }
    load()
  }

  async function startEditAdmin(companyId: string) {
    await loadEmployees(companyId)
    setEditingAdmin(companyId)
  }

  async function changeAdmin(companyId: string, newEmployeeId: string) {
    setSavingAdmin(true)

    const { error: demoteCuError } = await supabase
      .from('company_users')
      .update({ role: 'employee' })
      .eq('company_id', companyId)
      .eq('role', 'admin')
    if (demoteCuError) {
      showError('Failed to update previous admin: ' + demoteCuError.message)
      setSavingAdmin(false)
      return
    }

    const { error: demoteEmpError } = await supabase
      .from('employees')
      .update({ is_admin: false })
      .eq('company_id', companyId)
      .eq('is_admin', true)
    if (demoteEmpError) {
      showError('Failed to update previous admin: ' + demoteEmpError.message)
      setSavingAdmin(false)
      return
    }

    const { error: promoteEmpError } = await supabase
      .from('employees')
      .update({ is_admin: true })
      .eq('id', newEmployeeId)
    if (promoteEmpError) {
      showError('Failed to assign admin: ' + promoteEmpError.message)
      setSavingAdmin(false)
      return
    }

    const { data: emp } = await supabase
      .from('employees')
      .select('email')
      .eq('id', newEmployeeId)
      .single()

    const { data: cuByEmp } = await supabase
      .from('company_users')
      .select('id')
      .eq('company_id', companyId)
      .eq('employee_id', newEmployeeId)
      .maybeSingle()

    if (cuByEmp) {
      const { error } = await supabase
        .from('company_users')
        .update({ role: 'admin' })
        .eq('id', cuByEmp.id)
      if (error) {
        showError('Failed to assign admin: ' + error.message)
      }
    } else if (emp?.email) {
      const { error } = await supabase.rpc('link_and_promote_admin' as any, {
        p_company_id: companyId,
        p_employee_id: newEmployeeId,
        p_email: emp.email,
      })
      if (error) {
        showError('Failed to assign admin: ' + error.message)
      }
    }

    setEditingAdmin(null)
    setSavingAdmin(false)
    load()
    showSuccess('Company admin updated')
  }

  return (
    <div className="admin-section">
      <div className="admin-page-header">
        <h2>Company Management</h2>
        <p>Manage which organisations can access InflowHR</p>
      </div>

      <div style={{ marginBottom: 20 }}>
        {!showForm ? (
          <button className="admin-btn admin-btn-primary" onClick={() => setShowForm(true)}>
            + Register New Company
          </button>
        ) : (
          <div className="admin-add-form">
            <h3>Register New Company</h3>
            <p style={{ color: '#666', fontSize: 13, marginBottom: 16 }}>
              Add a company domain to allow their employees to sign in with Microsoft SSO.
              The Microsoft tenant ID will be captured automatically on first login.
            </p>
            <div className="admin-form-grid">
              <div className="admin-form-field">
                <label>Company Name</label>
                <input
                  className="admin-input"
                  placeholder="e.g. Acme Corp"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="admin-form-field">
                <label>Email Domain</label>
                <input
                  className="admin-input"
                  placeholder="e.g. acme.com"
                  value={form.domain}
                  onChange={e => setForm(f => ({ ...f, domain: e.target.value }))}
                />
              </div>
              <div className="admin-form-field">
                <label>Company Logo</label>
                <div className="admin-logo-upload">
                  {logoPreview ? (
                    <div className="admin-logo-preview-wrap">
                      <img src={logoPreview} alt="Logo preview" className="admin-logo-preview" />
                      <button className="admin-logo-remove" onClick={() => { setLogoFile(null); setLogoPreview(null) }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round">
                          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                  ) : (
                    <button className="admin-logo-upload-btn" onClick={() => logoInputRef.current?.click()}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                        <circle cx="8.5" cy="8.5" r="1.5" />
                        <polyline points="21 15 16 10 5 21" />
                      </svg>
                      <span>Upload logo</span>
                    </button>
                  )}
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={handleLogoSelect}
                  />
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="admin-btn admin-btn-primary" onClick={addCompany} disabled={saving}>
                {saving ? 'Saving...' : 'Register Company'}
              </button>
              <button className="admin-btn" onClick={() => { setShowForm(false); setLogoFile(null); setLogoPreview(null) }}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      {loading ? <div className="admin-loading">Loading...</div> : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Logo</th>
                <th>Company</th>
                <th>Domain</th>
                <th>Company Admin</th>
                <th>Status</th>
                <th>Login</th>
                <th>Registered</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {companies.map(c => {
                const admin = admins[c.id]
                const isEditing = editingAdmin === c.id
                const emps = employees[c.id] || []
                return (
                  <tr key={c.id}>
                    <td>
                      <div className="admin-logo-cell">
                        {c.logo_url ? (
                          <div className="admin-logo-cell-wrap">
                            <img src={c.logo_url} alt={c.name} className="admin-logo-thumb" />
                            <div className="admin-logo-cell-actions">
                              <button
                                className="admin-btn-icon"
                                title="Change logo"
                                onClick={() => {
                                  const input = editLogoRef.current
                                  if (input) {
                                    input.setAttribute('data-company-id', c.id)
                                    input.click()
                                  }
                                }}
                              >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                                </svg>
                              </button>
                              <button
                                className="admin-btn-icon admin-btn-danger"
                                title="Remove logo"
                                onClick={() => removeLogo(c.id)}
                              >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            className="admin-logo-upload-sm"
                            onClick={() => {
                              const input = editLogoRef.current
                              if (input) {
                                input.setAttribute('data-company-id', c.id)
                                input.click()
                              }
                            }}
                          >
                            {uploadingLogo === c.id ? '...' : '+'}
                          </button>
                        )}
                      </div>
                    </td>
                    <td><strong>{c.name}</strong></td>
                    <td>{c.domain}</td>
                    <td>
                      {isEditing ? (
                        <div className="admin-edit-admin-cell">
                          <select
                            className="admin-inline-select admin-admin-select"
                            defaultValue={admin?.employee_id || ''}
                            onChange={e => { if (e.target.value) changeAdmin(c.id, e.target.value) }}
                            disabled={savingAdmin}
                          >
                            <option value="">Select admin...</option>
                            {emps.map(emp => (
                              <option key={emp.id} value={emp.id}>
                                {emp.first_name} {emp.last_name} ({emp.email})
                              </option>
                            ))}
                          </select>
                          <button className="admin-btn-sm admin-btn-cancel" onClick={() => setEditingAdmin(null)}>
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="admin-view-admin-cell">
                          {admin?.employee ? (
                            <span>{admin.employee.first_name} {admin.employee.last_name}</span>
                          ) : (
                            <span className="admin-no-admin">No admin assigned</span>
                          )}
                          <button
                            className="admin-btn-icon"
                            title="Change admin"
                            onClick={() => startEditAdmin(c.id)}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                            </svg>
                          </button>
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={`admin-badge ${c.is_active ? 'admin-badge-approved' : 'admin-badge-rejected'}`}>
                        {c.is_active ? 'Active' : 'Disabled'}
                      </span>
                    </td>
                    <td>
                      <label className="admin-toggle-switch">
                        <input type="checkbox" checked={!c.login_disabled} onChange={() => toggleLoginDisabled(c.id, c.login_disabled)} />
                        <span className="admin-toggle-slider" />
                      </label>
                    </td>
                    <td>{new Date(c.created_at).toLocaleDateString('en-GB')}</td>
                    <td className="admin-actions">
                      <button
                        className={`admin-btn-sm ${c.is_active ? 'admin-btn-cancel' : 'admin-btn-save'}`}
                        onClick={() => toggleActive(c.id, c.is_active)}
                      >
                        {c.is_active ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        className="admin-btn-icon admin-btn-danger"
                        onClick={() => deleteCompany(c.id)}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {companies.length === 0 && <div className="admin-empty">No companies registered</div>}
        </div>
      )}

      <input
        ref={editLogoRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={e => {
          const file = e.target.files?.[0]
          const companyId = e.target.getAttribute('data-company-id')
          if (file && companyId) handleEditLogo(companyId, file)
          e.target.value = ''
        }}
      />
    </div>
  )
}
