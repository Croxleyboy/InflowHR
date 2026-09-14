import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { useAuth } from '../../context/AuthContext'
import { useFeatures } from '../../context/FeatureContext'
import { useToast } from '../../context/ToastContext'

interface Employee {
  id: string
  first_name: string
  last_name: string
  email: string
  avatar_url: string | null
  department: string | null
  job_title: string | null
}

interface AccessRow {
  id: number
  employee_id: string
  role_key: string
  granted_by: string | null
  created_at: string
}

interface RolePerms {
  id?: number
  role_key: string
  role_label: string
  permissions: Record<string, boolean>
}

const ROLE_KEYS = ['read_only', 'accounting', 'management', 'support', 'company_admin'] as const
const ROLE_LABELS: Record<string, string> = {
  read_only: 'Read Only View',
  accounting: 'Accounting',
  management: 'Management',
  support: 'Support',
  company_admin: 'Company Admin',
}

const FEATURE_KEYS = [
  { key: 'expenses', label: 'Expenses' },
  { key: 'leave', label: 'Leave' },
  { key: 'payroll', label: 'Payroll' },
  { key: 'employees', label: 'Employees' },
  { key: 'kudos', label: 'Kudos' },
  { key: 'elearning', label: 'E-Learning' },
  { key: 'announcements', label: 'Announcements' },
  { key: 'onboarding', label: 'Onboard / Offboard' },
  { key: 'tickets', label: 'HR Tickets' },
  { key: 'benefits', label: 'Benefits' },
  { key: 'timesheets', label: 'Timesheets' },
  { key: 'performance', label: 'Performance' },
  { key: 'shifts', label: 'Shifts & Rotas' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'billing', label: 'Billing' },
  { key: 'legal_timesheets', label: 'Legal Timesheets' },
  { key: 'space_management', label: 'Space Management' },
  { key: 'assets', label: 'Asset Management' },
  { key: 'talent_intelligence', label: 'Talent Intelligence' },
  { key: 'user_guides', label: 'User Guides' },
  { key: 'access', label: 'Access Management' },
]

function defaultPerms(roleKey: string): Record<string, boolean> {
  if (roleKey === 'company_admin') {
    const p: Record<string, boolean> = {}
    FEATURE_KEYS.forEach(f => { p[f.key] = true })
    return p
  }
  const p: Record<string, boolean> = {}
  FEATURE_KEYS.forEach(f => { p[f.key] = false })
  return p
}

export default function AdminAccess() {
  const { selectedCompanyId } = useAdminCompany()
  const { employeeName, isSuperAdmin, companyUser } = useAuth()
  const { companyFeatures } = useFeatures()
  const { showError, showSuccess } = useToast()

  const [tab, setTab] = useState<'access' | 'permissions'>('access')
  const [employees, setEmployees] = useState<Employee[]>([])
  const [accessList, setAccessList] = useState<AccessRow[]>([])
  const [roles, setRoles] = useState<RolePerms[]>([])
  const [loading, setLoading] = useState(true)

  const [selectedEmployee, setSelectedEmployee] = useState('')
  const [selectedRole, setSelectedRole] = useState('read_only')
  const [saving, setSaving] = useState(false)
  const [supportAccessAuthorised, setSupportAccessAuthorised] = useState(false)
  const [supportAccessLoading, setSupportAccessLoading] = useState(false)

  const isCompanyAdmin = isSuperAdmin || companyUser?.role === 'admin'

  const loadData = useCallback(async () => {
    if (!selectedCompanyId) return
    setLoading(true)
    const [empRes, accessRes, rolesRes, companyRes] = await Promise.all([
      supabase.from('employees')
        .select('id, first_name, last_name, email, avatar_url, department, job_title')
        .eq('company_id', selectedCompanyId).eq('is_active', true)
        .order('first_name'),
      supabase.from('admin_portal_access')
        .select('*')
        .eq('company_id', selectedCompanyId)
        .order('created_at', { ascending: false }),
      supabase.from('admin_portal_roles')
        .select('*')
        .eq('company_id', selectedCompanyId),
      supabase.from('companies')
        .select('support_access_authorised')
        .eq('id', selectedCompanyId)
        .single(),
    ])
    setEmployees((empRes.data as Employee[]) || [])
    setAccessList((accessRes.data as AccessRow[]) || [])
    if (companyRes.data) setSupportAccessAuthorised(companyRes.data.support_access_authorised ?? false)

    const existing = (rolesRes.data || []) as { id: number; role_key: string; role_label: string; permissions: Record<string, boolean> }[]
    const merged: RolePerms[] = ROLE_KEYS.map(rk => {
      const found = existing.find(r => r.role_key === rk)
      return found
        ? { id: found.id, role_key: found.role_key, role_label: found.role_label, permissions: { ...defaultPerms(rk), ...found.permissions } }
        : { role_key: rk, role_label: ROLE_LABELS[rk], permissions: defaultPerms(rk) }
    })
    setRoles(merged)
    setLoading(false)
  }, [selectedCompanyId])

  useEffect(() => { loadData() }, [loadData])

  const empMap = useMemo(() => {
    const m = new Map<string, Employee>()
    employees.forEach(e => m.set(e.id, e))
    return m
  }, [employees])

  const assignedIds = useMemo(() => new Set(accessList.map(a => a.employee_id)), [accessList])

  const availableEmployees = useMemo(() =>
    employees.filter(e => !assignedIds.has(e.id)),
  [employees, assignedIds])

  async function grantAccess() {
    if (!selectedEmployee || !selectedCompanyId) return
    setSaving(true)
    const { error } = await supabase.from('admin_portal_access').insert({
      company_id: selectedCompanyId,
      employee_id: selectedEmployee,
      role_key: selectedRole,
      granted_by: employeeName,
    })
    if (error) { showError('Failed to grant access: ' + error.message); setSaving(false); return }
    showSuccess('Access granted')
    setSelectedEmployee('')
    setSelectedRole('read_only')
    setSaving(false)
    loadData()
  }

  async function revokeAccess(id: number) {
    if (!confirm('Revoke this employee\'s admin portal access?')) return
    const { error } = await supabase.from('admin_portal_access').delete().eq('id', id)
    if (error) { showError('Failed to revoke: ' + error.message); return }
    showSuccess('Access revoked')
    loadData()
  }

  async function updateAccessRole(id: number, newRole: string) {
    const { error } = await supabase.from('admin_portal_access')
      .update({ role_key: newRole })
      .eq('id', id)
    if (error) { showError('Failed to update role: ' + error.message); return }
    showSuccess('Role updated')
    loadData()
  }

  function togglePerm(roleKey: string, featureKey: string) {
    if (roleKey === 'company_admin') return
    setRoles(prev => prev.map(r => {
      if (r.role_key !== roleKey) return r
      return { ...r, permissions: { ...r.permissions, [featureKey]: !r.permissions[featureKey] } }
    }))
  }

  async function savePermissions() {
    if (!selectedCompanyId) return
    setSaving(true)
    for (const role of roles) {
      if (role.id) {
        await supabase.from('admin_portal_roles')
          .update({ permissions: role.permissions, updated_at: new Date().toISOString() })
          .eq('id', role.id)
      } else {
        await supabase.from('admin_portal_roles').insert({
          company_id: selectedCompanyId,
          role_key: role.role_key,
          role_label: role.role_label,
          permissions: role.permissions,
        })
      }
    }
    setSaving(false)
    showSuccess('Permissions saved')
    loadData()
  }

  async function toggleSupportAccess() {
    if (!selectedCompanyId) return
    setSupportAccessLoading(true)
    const newValue = !supportAccessAuthorised
    const { error } = await supabase.from('companies')
      .update({ support_access_authorised: newValue })
      .eq('id', selectedCompanyId)
    if (error) { showError('Failed to update support access: ' + error.message); setSupportAccessLoading(false); return }
    setSupportAccessAuthorised(newValue)
    showSuccess(newValue ? 'Support access authorised' : 'Support access revoked')
    setSupportAccessLoading(false)
  }

  const subscribedFeatures = useMemo(() => {
    const featureMap: Record<string, string> = {
      expenses: 'expenses', leave: 'leave', payroll: 'payslips',
      kudos: 'kudos', elearning: 'elearning', benefits: 'benefits',
      timesheets: 'timesheets', performance: 'performance', shifts: 'shifts',
      legal_timesheets: 'legal_timesheets', space_management: 'space_booking',
      assets: 'asset_management', talent_intelligence: 'skills_passport',
    }
    return FEATURE_KEYS.filter(f => {
      const cfKey = featureMap[f.key]
      if (!cfKey) return true
      return isSuperAdmin || companyFeatures[cfKey as keyof typeof companyFeatures]
    })
  }, [companyFeatures, isSuperAdmin])

  return (
    <div className="admin-section">
      <div className="admin-page-header">
        <h2>Access Management</h2>
        <p>Manage who can access the admin portal and what they can see</p>
      </div>

      <div className="admin-tabs">
        <button className={`admin-tab ${tab === 'access' ? 'admin-tab-active' : ''}`} onClick={() => setTab('access')}>Access</button>
        <button className={`admin-tab ${tab === 'permissions' ? 'admin-tab-active' : ''}`} onClick={() => setTab('permissions')}>Permissions</button>
      </div>

      {loading && <div className="admin-loading">Loading...</div>}

      {!loading && tab === 'access' && (
        <>
          {isCompanyAdmin && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 20, padding: 16, background: '#f8fafc', borderRadius: 12, border: '1px solid #e5e7eb' }}>
              <div style={{ flex: 2, minWidth: 200 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Employee</label>
                <select
                  value={selectedEmployee}
                  onChange={e => setSelectedEmployee(e.target.value)}
                  className="admin-select"
                  style={{ width: '100%' }}
                >
                  <option value="">Select an employee…</option>
                  {availableEmployees.map(e => (
                    <option key={e.id} value={e.id}>{e.first_name} {e.last_name} — {e.email}</option>
                  ))}
                </select>
              </div>
              <div style={{ flex: 1, minWidth: 160 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Role</label>
                <select
                  value={selectedRole}
                  onChange={e => setSelectedRole(e.target.value)}
                  className="admin-select"
                  style={{ width: '100%' }}
                >
                  {ROLE_KEYS.map(rk => (
                    <option key={rk} value={rk}>{ROLE_LABELS[rk]}</option>
                  ))}
                </select>
              </div>
              <button
                className="admin-btn-sm admin-btn-save"
                onClick={grantAccess}
                disabled={saving || !selectedEmployee}
                style={{ height: 38 }}
              >
                {saving ? 'Saving…' : 'Grant Access'}
              </button>
            </div>
          )}

          {accessList.length === 0 ? (
            <div className="admin-empty">No employees have been granted admin portal access yet</div>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Email</th>
                    <th>Department</th>
                    <th>Role</th>
                    <th>Granted By</th>
                    <th>Date</th>
                    {isCompanyAdmin && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {accessList.map(a => {
                    const emp = empMap.get(a.employee_id)
                    return (
                      <tr key={a.id}>
                        <td>
                          {emp ? (
                            <span className="admin-inline-avatar">
                              {emp.avatar_url
                                ? <img src={emp.avatar_url} alt="" />
                                : <span className="admin-avatar-initials">{emp.first_name[0]}{emp.last_name[0]}</span>
                              }
                              {emp.first_name} {emp.last_name}
                            </span>
                          ) : '—'}
                        </td>
                        <td>{emp?.email || '—'}</td>
                        <td>{emp?.department || '—'}</td>
                        <td>
                          {isCompanyAdmin ? (
                            <select
                              value={a.role_key}
                              onChange={e => updateAccessRole(a.id, e.target.value)}
                              className="admin-inline-select"
                            >
                              {ROLE_KEYS.map(rk => (
                                <option key={rk} value={rk}>{ROLE_LABELS[rk]}</option>
                              ))}
                            </select>
                          ) : (
                            <span className={`admin-badge ${a.role_key === 'company_admin' ? 'admin-badge-approved' : 'admin-badge-pending'}`}>
                              {ROLE_LABELS[a.role_key] || a.role_key}
                            </span>
                          )}
                        </td>
                        <td style={{ fontSize: 13, color: '#64748b' }}>{a.granted_by || '—'}</td>
                        <td style={{ fontSize: 13, color: '#64748b' }}>{new Date(a.created_at).toLocaleDateString('en-GB')}</td>
                        {isCompanyAdmin && (
                          <td className="admin-actions">
                            <button className="admin-btn-icon admin-btn-danger" title="Revoke access" onClick={() => revokeAccess(a.id)}>
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                            </button>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {isCompanyAdmin && (
            <div style={{ marginTop: 28, padding: 20, background: '#f8fafc', borderRadius: 12, border: '1px solid #e5e7eb' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                </svg>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Service Provider Support Access</h3>
              </div>
              <p style={{ fontSize: 13, color: '#64748b', marginBottom: 14, lineHeight: 1.5 }}>
                When enabled, the InflowHR service team can access your company's data for support and troubleshooting purposes. Access is logged in the audit trail and limited to 48-hour sessions. You can revoke this at any time.
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button
                  className={`toggle-switch ${supportAccessAuthorised ? 'toggle-on' : 'toggle-off'}`}
                  onClick={toggleSupportAccess}
                  disabled={supportAccessLoading}
                  role="switch"
                  aria-checked={supportAccessAuthorised}
                  style={{ flexShrink: 0 }}
                >
                  <span className="toggle-knob" />
                </button>
                <span style={{ fontSize: 13, fontWeight: 600, color: supportAccessAuthorised ? '#059669' : '#64748b' }}>
                  {supportAccessLoading ? 'Updating…' : supportAccessAuthorised ? 'Authorised' : 'Not authorised'}
                </span>
              </div>
            </div>
          )}
        </>
      )}

      {!loading && tab === 'permissions' && (
        <div style={{ overflowX: 'auto' }}>
          <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
            Configure which admin portal features each role can access. Company Admin has full access by default.
          </p>
          <table className="admin-table" style={{ minWidth: 700 }}>
            <thead>
              <tr>
                <th style={{ position: 'sticky', left: 0, background: '#fff', zIndex: 1 }}>Feature</th>
                {roles.map(r => (
                  <th key={r.role_key} style={{ textAlign: 'center', fontSize: 12, minWidth: 100 }}>{r.role_label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {subscribedFeatures.map(f => (
                <tr key={f.key}>
                  <td style={{ fontWeight: 600, fontSize: 13, position: 'sticky', left: 0, background: '#fff', zIndex: 1 }}>{f.label}</td>
                  {roles.map(r => {
                    const checked = r.permissions[f.key] ?? false
                    const isAdmin = r.role_key === 'company_admin'
                    return (
                      <td key={r.role_key} style={{ textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => togglePerm(r.role_key, f.key)}
                          disabled={isAdmin}
                          style={{ width: 18, height: 18, accentColor: '#4f46e5', cursor: isAdmin ? 'not-allowed' : 'pointer' }}
                        />
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {isCompanyAdmin && (
            <button
              className="admin-btn-sm admin-btn-save"
              onClick={savePermissions}
              disabled={saving}
              style={{ marginTop: 16 }}
            >
              {saving ? 'Saving…' : 'Save Permissions'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
