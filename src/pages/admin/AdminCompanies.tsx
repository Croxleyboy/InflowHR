import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

interface Company {
  id: string
  name: string
  domain: string
  microsoft_tenant_id: string | null
  is_active: boolean
  created_at: string
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

export default function AdminCompanies() {
  const { company: myCompany } = useAuth()
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', domain: '' })
  const [saving, setSaving] = useState(false)
  const [admins, setAdmins] = useState<Record<string, CompanyAdmin>>({})
  const [employees, setEmployees] = useState<Record<string, Employee[]>>({})
  const [editingAdmin, setEditingAdmin] = useState<string | null>(null)
  const [savingAdmin, setSavingAdmin] = useState(false)

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('companies')
      .select('*')
      .order('created_at', { ascending: false })
    const cos = (data as Company[]) || []
    setCompanies(cos)

    const adminMap: Record<string, CompanyAdmin> = {}
    for (const co of cos) {
      const { data: cu } = await supabase
        .from('company_users')
        .select('employee_id, employee:employees!company_users_employee_id_fkey(first_name, last_name, email)')
        .eq('company_id', co.id)
        .eq('role', 'admin')
        .limit(1)
        .maybeSingle()
      adminMap[co.id] = cu
        ? { employee_id: cu.employee_id, employee: cu.employee as any }
        : { employee_id: null, employee: null }
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

  async function addCompany() {
    if (!form.name.trim() || !form.domain.trim()) return
    setSaving(true)
    const domain = form.domain.trim().toLowerCase().replace(/^@/, '')
    await supabase.from('companies').insert({
      name: form.name.trim(),
      domain,
      microsoft_tenant_id: '',
      is_active: true,
    })
    setForm({ name: '', domain: '' })
    setShowForm(false)
    setSaving(false)
    load()
  }

  async function toggleActive(id: string, currentlyActive: boolean) {
    if (id === myCompany?.id && currentlyActive) {
      alert('You cannot disable your own company.')
      return
    }
    await supabase.from('companies').update({ is_active: !currentlyActive }).eq('id', id)
    load()
  }

  async function deleteCompany(id: string) {
    if (id === myCompany?.id) {
      alert('You cannot delete your own company.')
      return
    }
    if (!confirm('Delete this company? All associated users will lose access.')) return
    await supabase.from('company_users').delete().eq('company_id', id)
    await supabase.from('companies').delete().eq('id', id)
    load()
  }

  async function startEditAdmin(companyId: string) {
    await loadEmployees(companyId)
    setEditingAdmin(companyId)
  }

  async function changeAdmin(companyId: string, newEmployeeId: string) {
    setSavingAdmin(true)

    // Remove admin role from current admin(s) for this company
    await supabase
      .from('company_users')
      .update({ role: 'employee' })
      .eq('company_id', companyId)
      .eq('role', 'admin')

    // Also update employees table: unset current admin
    await supabase
      .from('employees')
      .update({ is_admin: false })
      .eq('company_id', companyId)
      .eq('is_admin', true)

    // Set new admin on employees table
    await supabase
      .from('employees')
      .update({ is_admin: true })
      .eq('id', newEmployeeId)

    // Check if new admin has a company_users row
    const { data: existingCu } = await supabase
      .from('company_users')
      .select('id')
      .eq('company_id', companyId)
      .eq('employee_id', newEmployeeId)
      .maybeSingle()

    if (existingCu) {
      await supabase
        .from('company_users')
        .update({ role: 'admin' })
        .eq('id', existingCu.id)
    } else {
      await supabase
        .from('company_users')
        .insert({ company_id: companyId, employee_id: newEmployeeId, role: 'admin', is_active: true })
    }

    setEditingAdmin(null)
    setSavingAdmin(false)
    load()
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
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="admin-btn admin-btn-primary" onClick={addCompany} disabled={saving}>
                {saving ? 'Saving...' : 'Register Company'}
              </button>
              <button className="admin-btn" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      {loading ? <div className="admin-loading">Loading...</div> : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Domain</th>
                <th>Company Admin</th>
                <th>Status</th>
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
                    <td><strong>{c.name}</strong></td>
                    <td>{c.domain}</td>
                    <td>
                      {isEditing ? (
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <select
                            className="admin-inline-select"
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
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          {admin?.employee ? (
                            <span>{admin.employee.first_name} {admin.employee.last_name}</span>
                          ) : (
                            <span style={{ color: '#999', fontStyle: 'italic' }}>No admin assigned</span>
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
    </div>
  )
}
