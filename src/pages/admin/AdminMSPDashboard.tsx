import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { useToast } from '../../context/ToastContext'
import { useNavigate } from 'react-router-dom'

interface ManagedCompany {
  id: string
  name: string
  domain: string
  is_active: boolean
  is_trial: boolean
  employee_count: number
  onboarded_at: string | null
}

interface MspUserAccessRow {
  id: string
  employee_id: string
  managed_company_id: string
  permissions: Record<string, boolean>
  is_active: boolean
  employee_name: string
  employee_email: string
}

interface MspStats {
  managed_count: number
  total_employees: number
  active_companies: number
  trial_companies: number
}

export default function AdminMSPDashboard() {
  const { isSuperAdmin, isMspAdmin, mspCompanyId } = useAuth()
  const { setSelectedCompanyId } = useAdminCompany()
  const { showToast } = useToast()
  const navigate = useNavigate()

  const [managedCompanies, setManagedCompanies] = useState<ManagedCompany[]>([])
  const [mspUsers, setMspUsers] = useState<MspUserAccessRow[]>([])
  const [stats, setStats] = useState<MspStats>({ managed_count: 0, total_employees: 0, active_companies: 0, trial_companies: 0 })
  const [loading, setLoading] = useState(true)
  const [mspCompanyName, setMspCompanyName] = useState('')
  const [mspTier, setMspTier] = useState<string | null>(null)
  const [mspDiscount, setMspDiscount] = useState<number | null>(null)
  const [activeTab, setActiveTab] = useState<'companies' | 'users'>('companies')

  const [grantEmail, setGrantEmail] = useState('')
  const [grantCompanyId, setGrantCompanyId] = useState('')
  const [granting, setGranting] = useState(false)

  const loadData = useCallback(async () => {
    if (!mspCompanyId && !isSuperAdmin) return
    setLoading(true)
    try {
      if (isSuperAdmin && !mspCompanyId) {
        const { data } = await supabase.rpc('get_msp_dashboard' as any)
        if (data) {
          setManagedCompanies(data.companies || [])
          setStats(data.stats || { managed_count: 0, total_employees: 0, active_companies: 0, trial_companies: 0 })
        }
        setLoading(false)
        return
      }

      const { data: mspCo } = await supabase
        .from('companies')
        .select('name, msp_tier, msp_wholesale_discount')
        .eq('id', mspCompanyId!)
        .single()
      if (mspCo) {
        setMspCompanyName((mspCo as any).name || '')
        setMspTier((mspCo as any).msp_tier || null)
        setMspDiscount((mspCo as any).msp_wholesale_discount || null)
      }

      const { data: managed } = await supabase
        .from('msp_managed_companies')
        .select('managed_company_id, onboarded_at, companies:managed_company_id(id, name, domain, is_active, is_trial)')
        .eq('msp_company_id', mspCompanyId!)
        .eq('is_active', true)

      const companies: ManagedCompany[] = []
      for (const row of (managed || []) as any[]) {
        const co = row.companies
        if (!co) continue
        const { count } = await supabase
          .from('employees')
          .select('id', { count: 'exact', head: true })
          .eq('company_id', co.id)
          .eq('status', 'active')
        companies.push({
          id: co.id,
          name: co.name,
          domain: co.domain,
          is_active: co.is_active,
          is_trial: co.is_trial,
          employee_count: count || 0,
          onboarded_at: row.onboarded_at,
        })
      }
      setManagedCompanies(companies)

      const totalEmps = companies.reduce((sum, c) => sum + c.employee_count, 0)
      setStats({
        managed_count: companies.length,
        total_employees: totalEmps,
        active_companies: companies.filter(c => c.is_active && !c.is_trial).length,
        trial_companies: companies.filter(c => c.is_trial).length,
      })

      const { data: users } = await supabase
        .from('msp_user_access')
        .select('id, employee_id, managed_company_id, permissions, is_active, employees:employee_id(first_name, last_name, email)')
        .eq('msp_company_id', mspCompanyId!)
        .eq('is_active', true)

      const userRows: MspUserAccessRow[] = ((users || []) as any[]).map(u => ({
        id: u.id,
        employee_id: u.employee_id,
        managed_company_id: u.managed_company_id,
        permissions: u.permissions || {},
        is_active: u.is_active,
        employee_name: u.employees ? `${u.employees.first_name} ${u.employees.last_name}` : 'Unknown',
        employee_email: u.employees?.email || '',
      }))
      setMspUsers(userRows)
    } catch (err) {
      console.error('MSP dashboard load error:', err)
    }
    setLoading(false)
  }, [mspCompanyId, isSuperAdmin])

  useEffect(() => { loadData() }, [loadData])

  const handleManageCompany = (companyId: string) => {
    setSelectedCompanyId(companyId)
    navigate('/admin')
    showToast('Switched to managed company', 'success')
  }

  const handleGrantAccess = async () => {
    if (!grantEmail || !grantCompanyId || !mspCompanyId) return
    setGranting(true)
    try {
      const { error } = await supabase.rpc('grant_msp_user_access' as any, {
        p_msp_company_id: mspCompanyId,
        p_employee_email: grantEmail,
        p_managed_company_id: grantCompanyId,
        p_permissions: { full_access: true },
      })
      if (error) throw error
      showToast('Access granted successfully', 'success')
      setGrantEmail('')
      setGrantCompanyId('')
      loadData()
    } catch (err: any) {
      showToast(err.message || 'Failed to grant access', 'error')
    }
    setGranting(false)
  }

  const handleRevokeAccess = async (accessId: string) => {
    if (!mspCompanyId) return
    try {
      const { error } = await supabase.rpc('revoke_msp_user_access' as any, {
        p_access_id: accessId,
      })
      if (error) throw error
      showToast('Access revoked', 'success')
      loadData()
    } catch (err: any) {
      showToast(err.message || 'Failed to revoke access', 'error')
    }
  }

  const formatDate = (d: string | null) => {
    if (!d) return '—'
    const dt = new Date(d)
    return `${dt.getDate().toString().padStart(2, '0')}/${(dt.getMonth() + 1).toString().padStart(2, '0')}/${dt.getFullYear()}`
  }

  if (!isMspAdmin && !isSuperAdmin) {
    return <div style={{ padding: 32, textAlign: 'center', color: '#666' }}>You do not have MSP access.</div>
  }

  if (loading) {
    return <div style={{ padding: 32, textAlign: 'center' }}>Loading MSP Dashboard...</div>
  }

  const tierLabel = mspTier === 'gold' ? 'Gold' : mspTier === 'silver' ? 'Silver' : mspTier === 'bronze' ? 'Bronze' : 'Standard'

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>MSP Partner Dashboard</h1>
        {mspCompanyName && (
          <p style={{ margin: '4px 0 0', color: '#666', fontSize: 14 }}>
            {mspCompanyName} — {tierLabel} Partner
            {mspDiscount != null && ` (${mspDiscount}% wholesale discount)`}
          </p>
        )}
      </div>

      {/* Stats cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24 }}>
        <StatCard label="Managed Companies" value={stats.managed_count} color="#4f46e5" />
        <StatCard label="Total Employees" value={stats.total_employees} color="#0891b2" />
        <StatCard label="Active Companies" value={stats.active_companies} color="#16a34a" />
        <StatCard label="Trial Companies" value={stats.trial_companies} color="#d97706" />
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid #e5e7eb', marginBottom: 20 }}>
        <TabBtn label="Managed Companies" active={activeTab === 'companies'} onClick={() => setActiveTab('companies')} />
        <TabBtn label="MSP Users" active={activeTab === 'users'} onClick={() => setActiveTab('users')} />
      </div>

      {activeTab === 'companies' && (
        <div>
          {managedCompanies.length === 0 ? (
            <p style={{ color: '#666', textAlign: 'center', padding: 32 }}>No managed companies yet.</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
              {managedCompanies.map(co => (
                <div key={co.id} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 20, background: '#fff' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                    <div>
                      <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{co.name}</h3>
                      <p style={{ margin: '2px 0 0', fontSize: 13, color: '#888' }}>{co.domain}</p>
                    </div>
                    <span style={{
                      fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 12,
                      background: co.is_trial ? '#fef3c7' : co.is_active ? '#dcfce7' : '#fee2e2',
                      color: co.is_trial ? '#92400e' : co.is_active ? '#166534' : '#991b1b',
                    }}>
                      {co.is_trial ? 'Trial' : co.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 20, fontSize: 13, color: '#555', marginBottom: 14 }}>
                    <span>{co.employee_count} employee{co.employee_count !== 1 ? 's' : ''}</span>
                    <span>Onboarded: {formatDate(co.onboarded_at)}</span>
                  </div>
                  <button
                    onClick={() => handleManageCompany(co.id)}
                    style={{
                      width: '100%', padding: '8px 0', background: '#4f46e5', color: '#fff',
                      border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13,
                    }}
                  >
                    Manage Company
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'users' && (
        <div>
          {/* Grant access form */}
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 20, marginBottom: 20, background: '#f9fafb' }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 12px' }}>Grant MSP User Access</h3>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Employee Email</label>
                <input
                  type="email"
                  value={grantEmail}
                  onChange={e => setGrantEmail(e.target.value)}
                  placeholder="user@yourcompany.com"
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14 }}
                />
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Client Company</label>
                <select
                  value={grantCompanyId}
                  onChange={e => setGrantCompanyId(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, background: '#fff' }}
                >
                  <option value="">Select company...</option>
                  {managedCompanies.map(co => (
                    <option key={co.id} value={co.id}>{co.name}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={handleGrantAccess}
                disabled={granting || !grantEmail || !grantCompanyId}
                style={{
                  padding: '8px 20px', background: granting ? '#9ca3af' : '#4f46e5', color: '#fff',
                  border: 'none', borderRadius: 6, cursor: granting ? 'default' : 'pointer', fontWeight: 600, fontSize: 13,
                  whiteSpace: 'nowrap',
                }}
              >
                {granting ? 'Granting...' : 'Grant Access'}
              </button>
            </div>
          </div>

          {/* User list */}
          {mspUsers.length === 0 ? (
            <p style={{ color: '#666', textAlign: 'center', padding: 32 }}>No MSP user access records.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                  <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600 }}>Name</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600 }}>Email</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600 }}>Client Company</th>
                  <th style={{ textAlign: 'right', padding: '8px 12px', fontWeight: 600 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {mspUsers.map(u => {
                  const companyName = managedCompanies.find(c => c.id === u.managed_company_id)?.name || u.managed_company_id
                  return (
                    <tr key={u.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '8px 12px' }}>{u.employee_name}</td>
                      <td style={{ padding: '8px 12px', color: '#666' }}>{u.employee_email}</td>
                      <td style={{ padding: '8px 12px' }}>{companyName}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                        <button
                          onClick={() => handleRevokeAccess(u.id)}
                          style={{
                            padding: '4px 12px', background: '#fee2e2', color: '#991b1b',
                            border: '1px solid #fecaca', borderRadius: 4, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                          }}
                        >
                          Revoke
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: '16px 20px', background: '#fff' }}>
      <p style={{ margin: 0, fontSize: 12, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</p>
      <p style={{ margin: '6px 0 0', fontSize: 28, fontWeight: 700, color }}>{value}</p>
    </div>
  )
}

function TabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '10px 20px', background: 'none', border: 'none', borderBottom: active ? '2px solid #4f46e5' : '2px solid transparent',
        color: active ? '#4f46e5' : '#6b7280', fontWeight: 600, fontSize: 14, cursor: 'pointer',
        marginBottom: -2,
      }}
    >
      {label}
    </button>
  )
}
