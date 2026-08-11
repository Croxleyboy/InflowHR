import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'

interface SupportGrant {
  id: string
  company_id: string
  company_name: string
  granted_by: string
  reason: string
  scope: string
  status: string
  expires_at: string
  created_at: string
  revoked_at: string | null
}

const RESTRICTED_TABLES = [
  'employees', 'expense_claims', 'expense_line_items',
  'leave_requests', 'leave_balances', 'onboarding',
  'kudos', 'announcements', 'payslips',
  'workflow_tracker', 'notifications', 'app_settings',
  'benefit_enrollments', 'shift_assignments', 'rotas',
  'shift_swap_requests', 'employee_availability',
  'legal_timesheet_entries',
  'hr_tickets', 'space_bookings', 'timesheets',
  'one_to_one_meetings', 'one_to_one_comments',
  'performance_reviews',
]

const CONFIG_TABLES = [
  'leave_types', 'benefit_types', 'benefit_options',
  'shift_templates', 'legal_clients', 'legal_matters',
  'company_elearning_courses', 'company_features',
  'customer_projects',
]

const UNRESTRICTED_TABLES = [
  'companies', 'company_users', 'subscription_pricing',
  'tenant_support_access', 'gdpr_audit_logs',
]

export default function AdminSupportAccess() {
  const { isSuperAdmin } = useAuth()
  const { showSuccess, showError } = useToast()
  const [grants, setGrants] = useState<SupportGrant[]>([])
  const [loading, setLoading] = useState(true)
  const [granting, setGranting] = useState(false)
  const [showInfo, setShowInfo] = useState(false)

  async function loadGrants() {
    setLoading(true)
    const { data, error } = await supabase
      .from('tenant_support_access')
      .select('*, companies:company_id(name)')
      .order('created_at', { ascending: false })

    if (error) {
      showError('Failed to load support access grants')
      setLoading(false)
      return
    }

    const mapped = (data || []).map((g: any) => ({
      ...g,
      company_name: g.companies?.name || 'Unknown',
    }))
    setGrants(mapped)
    setLoading(false)
  }

  useEffect(() => { loadGrants() }, [])

  async function grantAllAccess() {
    setGranting(true)
    const { data, error } = await supabase.rpc('ensure_super_admin_access', { p_hours: 48 })
    if (error) {
      showError('Failed to grant access: ' + error.message)
    } else {
      showSuccess(`Granted access to ${data} additional company(s)`)
    }
    await loadGrants()
    setGranting(false)
  }

  async function extendAccess(companyId: string) {
    const { error } = await supabase.rpc('extend_support_access', {
      p_company_id: companyId,
      p_hours: 48,
    })
    if (error) {
      showError('Failed to extend access: ' + error.message)
    } else {
      showSuccess('Access extended by 48 hours')
    }
    await loadGrants()
  }

  async function revokeAccess(grantId: string) {
    const { error } = await supabase.rpc('revoke_support_access', {
      p_grant_id: grantId,
    })
    if (error) {
      showError('Failed to revoke: ' + error.message)
    } else {
      showSuccess('Access revoked')
    }
    await loadGrants()
  }

  function formatExpiry(expiresAt: string, status: string) {
    if (status === 'revoked') return 'Revoked'
    if (status === 'expired') return 'Expired'
    const exp = new Date(expiresAt)
    const now = new Date()
    if (exp < now) return 'Expired'
    const diffMs = exp.getTime() - now.getTime()
    const hours = Math.floor(diffMs / 3600000)
    const mins = Math.floor((diffMs % 3600000) / 60000)
    if (hours > 24) return `${Math.floor(hours / 24)}d ${hours % 24}h remaining`
    if (hours > 0) return `${hours}h ${mins}m remaining`
    return `${mins}m remaining`
  }

  function statusBadge(status: string, expiresAt: string) {
    const isExpired = status === 'expired' || new Date(expiresAt) < new Date()
    if (status === 'revoked') return <span className="admin-badge admin-badge-rejected">Revoked</span>
    if (isExpired) return <span className="admin-badge" style={{ background: '#f5f5f5', color: '#888' }}>Expired</span>
    return <span className="admin-badge admin-badge-approved">Active</span>
  }

  const activeGrants = grants.filter(g => g.status === 'active' && new Date(g.expires_at) > new Date())
  const companies = [...new Set(grants.map(g => g.company_id))]
  const companiesWithAccess = [...new Set(activeGrants.map(g => g.company_id))]

  return (
    <div>
      <div className="sa-support-header">
        <div>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>GDPR Support Access Control</h3>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#8b8fa3' }}>
            Manage time-limited access to company tenant data (GDPR Art. 28)
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            className="admin-btn"
            style={{ fontSize: 12 }}
            onClick={() => setShowInfo(!showInfo)}
          >
            {showInfo ? 'Hide' : 'Show'} Restrictions Info
          </button>
          {isSuperAdmin && (
            <button
              className="admin-btn admin-btn-primary"
              onClick={grantAllAccess}
              disabled={granting}
            >
              {granting ? 'Granting...' : 'Grant All Companies (48h)'}
            </button>
          )}
        </div>
      </div>

      {/* Status summary */}
      <div className="sa-support-stats">
        <div className="sa-support-stat">
          <span className="sa-support-stat-value" style={{ color: '#2e7d32' }}>{companiesWithAccess.length}</span>
          <span className="sa-support-stat-label">Active Grants</span>
        </div>
        <div className="sa-support-stat">
          <span className="sa-support-stat-value" style={{ color: '#e65100' }}>{companies.length - companiesWithAccess.length}</span>
          <span className="sa-support-stat-label">No Access</span>
        </div>
        <div className="sa-support-stat">
          <span className="sa-support-stat-value" style={{ color: '#1565c0' }}>{grants.length}</span>
          <span className="sa-support-stat-label">Total Grants</span>
        </div>
      </div>

      {/* Restrictions info panel */}
      {showInfo && (
        <div className="sa-support-info">
          <h4 style={{ margin: '0 0 12px', fontSize: 14 }}>What the super admin loses access to without an active grant:</h4>
          <div className="sa-support-info-grid">
            <div>
              <h5 style={{ color: '#c62828', margin: '0 0 6px', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Restricted — Employee PII Data ({RESTRICTED_TABLES.length} tables)
              </h5>
              <p style={{ fontSize: 12, color: '#666', margin: '0 0 8px' }}>
                Cannot view, edit, or manage any data in these tables for companies without an active grant.
                Queries return empty results — no error shown.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {RESTRICTED_TABLES.map(t => (
                  <code key={t} style={{ fontSize: 11, padding: '2px 6px', background: '#ffebee', color: '#c62828', borderRadius: 4 }}>{t}</code>
                ))}
              </div>
            </div>
            <div>
              <h5 style={{ color: '#e65100', margin: '0 0 6px', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Restricted — Config Tables ({CONFIG_TABLES.length} tables)
              </h5>
              <p style={{ fontSize: 12, color: '#666', margin: '0 0 8px' }}>
                Company feature config, leave types, benefit setup. Also gated by support access.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {CONFIG_TABLES.map(t => (
                  <code key={t} style={{ fontSize: 11, padding: '2px 6px', background: '#fff3e0', color: '#e65100', borderRadius: 4 }}>{t}</code>
                ))}
              </div>
            </div>
            <div>
              <h5 style={{ color: '#2e7d32', margin: '0 0 6px', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Always Accessible ({UNRESTRICTED_TABLES.length} tables)
              </h5>
              <p style={{ fontSize: 12, color: '#666', margin: '0 0 8px' }}>
                Platform management tables — always visible to super admin regardless of grants.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {UNRESTRICTED_TABLES.map(t => (
                  <code key={t} style={{ fontSize: 11, padding: '2px 6px', background: '#e8f5e9', color: '#2e7d32', borderRadius: 4 }}>{t}</code>
                ))}
              </div>
            </div>
          </div>

          <div style={{ marginTop: 16, padding: '12px 14px', background: '#fff3e0', borderRadius: 8, borderLeft: '4px solid #e65100' }}>
            <strong style={{ fontSize: 13, color: '#e65100' }}>Super admin pages affected without access:</strong>
            <ul style={{ fontSize: 13, margin: '6px 0 0 18px', color: '#555' }}>
              <li><strong>Dashboard</strong> — employee counts, ticket counts, onboarder counts all return 0</li>
              <li><strong>Employees</strong> — empty table, cannot view/edit any employee records</li>
              <li><strong>Billing</strong> — company features not visible, cost breakdown shows £0</li>
              <li><strong>Benefits, Shifts, Legal Timesheets, Performance</strong> — all empty</li>
              <li><strong>Expenses, Leave, Kudos, Announcements, Tickets</strong> — all empty</li>
              <li><strong>Timesheets, Space Management, E-Learning</strong> — all empty</li>
              <li><strong>Subscriptions → Company Features</strong> — feature toggles not visible</li>
              <li><strong>Onboarding</strong> — cannot see or manage onboarders</li>
            </ul>
            <p style={{ fontSize: 12, color: '#888', marginTop: 8 }}>
              The Companies tab, Pricing tab, Demo Seed, and this Support Access page remain fully functional.
            </p>
          </div>
        </div>
      )}

      {/* Grants table */}
      {loading ? (
        <div className="admin-loading">Loading...</div>
      ) : (
        <div className="admin-table-wrap" style={{ marginTop: 16 }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Status</th>
                <th>Scope</th>
                <th>Reason</th>
                <th>Granted</th>
                <th>Expires</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {grants.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: 'center', color: '#888', padding: 24 }}>No support access grants found</td></tr>
              )}
              {grants.map(g => (
                <tr key={g.id}>
                  <td><strong>{g.company_name}</strong></td>
                  <td>{statusBadge(g.status, g.expires_at)}</td>
                  <td>
                    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: g.scope === 'full' ? '#e3f2fd' : '#f5f5f5', color: g.scope === 'full' ? '#1565c0' : '#666' }}>
                      {g.scope}
                    </span>
                  </td>
                  <td style={{ fontSize: 13, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.reason}</td>
                  <td>{new Date(g.created_at).toLocaleDateString('en-GB')}</td>
                  <td>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{formatExpiry(g.expires_at, g.status)}</span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {g.status === 'active' && new Date(g.expires_at) > new Date() && (
                        <>
                          <button
                            className="admin-btn-sm"
                            style={{ background: '#1565c0', color: '#fff', border: 'none' }}
                            onClick={() => extendAccess(g.company_id)}
                          >
                            Extend 48h
                          </button>
                          <button
                            className="admin-btn-sm admin-btn-cancel"
                            onClick={() => revokeAccess(g.id)}
                          >
                            Revoke
                          </button>
                        </>
                      )}
                      {(g.status !== 'active' || new Date(g.expires_at) <= new Date()) && (
                        <button
                          className="admin-btn-sm"
                          style={{ background: '#2e7d32', color: '#fff', border: 'none' }}
                          onClick={() => extendAccess(g.company_id)}
                        >
                          Re-grant 48h
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
