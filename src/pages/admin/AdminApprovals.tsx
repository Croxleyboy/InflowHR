import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'

interface ApprovalRecord {
  id: string
  company_id: string
  category: string
  action: string
  status: string
  record_id: string | null
  record_summary: Record<string, unknown>
  requested_by: string
  requester_name: string | null
  approved_by: string | null
  approver_name: string | null
  approved_at: string | null
  reject_reason: string | null
  created_at: string
  updated_at: string
}

interface AuditEntry {
  id: string
  approval_id: string
  action: string
  detail: string | null
  performer_name: string | null
  created_at: string
}

const CATEGORY_LABELS: Record<string, string> = {
  legal_timesheet: 'Legal Timesheet',
  timesheet: 'Timesheet',
  shift_rota: 'Shift / Rota',
  access_request: 'Access',
  payroll_month: 'Payroll Month',
}

const STATUS_COLOURS: Record<string, { bg: string; text: string }> = {
  pending: { bg: '#fef3c7', text: '#92400e' },
  approved: { bg: '#d1fae5', text: '#065f46' },
  rejected: { bg: '#fee2e2', text: '#991b1b' },
  restored: { bg: '#dbeafe', text: '#1e40af' },
}

const cardStyle: React.CSSProperties = {
  background: 'var(--card-bg, #fff)',
  borderRadius: 16,
  padding: 28,
  boxShadow: '0 1px 4px rgba(0,0,0,.06)',
  border: '1px solid var(--border, #e2e8f0)',
}

function formatDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

export default function AdminApprovals() {
  const { selectedCompanyId } = useAdminCompany()
  const { session, isSuperAdmin } = useAuth()
  const { showToast } = useToast()

  const [tab, setTab] = useState<'pending' | 'history'>('pending')
  const [approvals, setApprovals] = useState<ApprovalRecord[]>([])
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [nominatedEmail, setNominatedEmail] = useState<string | null>(null)
  const [actionModal, setActionModal] = useState<{ approval: ApprovalRecord; type: 'approve' | 'reject' | 'restore' } | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [processing, setProcessing] = useState(false)

  const loadApprovals = useCallback(async () => {
    if (!selectedCompanyId) return
    setLoading(true)
    const { data } = await supabase
      .from('admin_approvals')
      .select('*')
      .eq('company_id', selectedCompanyId)
      .order('created_at', { ascending: false })
    setApprovals(data || [])

    const { data: companyData } = await supabase
      .from('companies')
      .select('approval_nominated_email')
      .eq('id', selectedCompanyId)
      .single()
    setNominatedEmail(companyData?.approval_nominated_email || null)

    setLoading(false)
  }, [selectedCompanyId])

  const loadAudit = useCallback(async () => {
    if (!selectedCompanyId) return
    const { data } = await supabase
      .from('admin_approval_audit')
      .select('*')
      .eq('company_id', selectedCompanyId)
      .order('created_at', { ascending: false })
      .limit(200)
    setAudit(data || [])
  }, [selectedCompanyId])

  useEffect(() => { loadApprovals() }, [loadApprovals])
  useEffect(() => { if (tab === 'history') loadAudit() }, [tab, loadAudit])

  const userEmail = session?.user?.email || ''
  const canApprove = isSuperAdmin || (nominatedEmail && userEmail.toLowerCase() === nominatedEmail.toLowerCase())

  async function getUserDisplayName(): Promise<string> {
    const { data } = await supabase
      .from('employees')
      .select('first_name, last_name')
      .eq('user_id', session?.user?.id)
      .maybeSingle()
    if (data) return `${data.first_name} ${data.last_name}`.trim()
    return session?.user?.email || 'Unknown'
  }

  async function writeAuditLog(approvalId: string, action: string, detail: string) {
    const performerName = await getUserDisplayName()
    await supabase.from('admin_approval_audit').insert({
      company_id: selectedCompanyId,
      approval_id: approvalId,
      action,
      detail,
      performed_by: session?.user?.id,
      performer_name: performerName,
    })
  }

  async function handleApprove(approval: ApprovalRecord) {
    if (!canApprove) {
      showToast('Only the nominated approver can approve requests', 'error')
      return
    }
    setProcessing(true)
    const approverName = await getUserDisplayName()
    const { error } = await supabase
      .from('admin_approvals')
      .update({
        status: 'approved',
        approved_by: session?.user?.id,
        approver_name: approverName,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', approval.id)
      .eq('company_id', selectedCompanyId)

    if (error) {
      showToast('Failed to approve request', 'error')
    } else {
      await writeAuditLog(approval.id, 'approved', `Approved ${CATEGORY_LABELS[approval.category] || approval.category} ${approval.action} request`)
      await executeApproval(approval)
      showToast('Request approved and action completed', 'success')
      loadApprovals()
    }
    setProcessing(false)
    setActionModal(null)
  }

  async function executeApproval(approval: ApprovalRecord) {
    const summary = approval.record_summary as Record<string, unknown>

    if (approval.category === 'legal_timesheet' && approval.action === 'delete') {
      await supabase
        .from('legal_timesheet_entries')
        .delete()
        .eq('id', approval.record_id)
        .eq('company_id', selectedCompanyId)
    }

    if (approval.category === 'timesheet' && approval.action === 'delete') {
      await supabase.from('workflow_tracker').delete().eq('timesheet_id', approval.record_id)
      await supabase
        .from('timesheets')
        .delete()
        .eq('id', approval.record_id)
        .eq('company_id', selectedCompanyId)
    }

    if (approval.category === 'shift_rota' && approval.action === 'delete') {
      await supabase.from('shift_assignments').delete().eq('rota_id', approval.record_id)
      await supabase
        .from('rotas')
        .delete()
        .eq('id', approval.record_id)
        .eq('company_id', selectedCompanyId)
    }

    if (approval.category === 'access_request' && approval.action === 'revoke') {
      await supabase
        .from('admin_portal_access')
        .delete()
        .eq('id', approval.record_id)
        .eq('company_id', selectedCompanyId)
    }

    if (approval.category === 'payroll_month' && approval.action === 'delete') {
      const year = (summary.year as number) || 0
      const monthIndex = (summary.month_index as number) ?? -1

      if (year && monthIndex >= 0) {
        const key = `${year}-${String(monthIndex + 1).padStart(2, '0')}`

        const rangeStart = `${key}-01`
        const nextMonth = monthIndex + 2 > 12 ? 1 : monthIndex + 2
        const nextYear = monthIndex + 2 > 12 ? year + 1 : year
        const rangeEnd = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`

        const { error: psErr, count: psCount } = await supabase
          .from('payslips')
          .delete({ count: 'exact' })
          .eq('company_id', selectedCompanyId)
          .gte('pay_period_start', rangeStart)
          .lt('pay_period_start', rangeEnd)

        const { error: prErr, count: prCount } = await supabase
          .from('pay_runs')
          .delete({ count: 'exact' })
          .eq('company_id', selectedCompanyId)
          .gte('period_start', rangeStart)
          .lt('period_start', rangeEnd)

        if (psErr || prErr) {
          showToast(`Delete errors — payslips: ${psErr?.message || 'none'}, pay_runs: ${prErr?.message || 'none'}`, 'error')
        } else {
          showToast(`Deleted ${psCount ?? 0} payslips, ${prCount ?? 0} pay runs for ${key}`, 'success')
        }

        const approverName = await getUserDisplayName()
        await supabase.from('payroll_audit_log').insert({
          company_id: selectedCompanyId,
          action: 'payroll_month_deleted',
          detail: `Deleted ${psCount ?? 0} payslips, ${prCount ?? 0} pay runs for ${key} (${summary.month || 'Unknown'} ${year})`,
          performed_by: session?.user?.id,
          performer_name: approverName,
        })
        window.dispatchEvent(new Event('payroll-data-changed'))
      } else {
        showToast(`Cannot delete: invalid month data (year=${year}, monthIndex=${monthIndex})`, 'error')
      }
    }
  }

  async function handleReject(approval: ApprovalRecord) {
    if (!canApprove) {
      showToast('Only the nominated approver can reject requests', 'error')
      return
    }
    setProcessing(true)
    const { error } = await supabase
      .from('admin_approvals')
      .update({
        status: 'rejected',
        reject_reason: rejectReason.trim() || null,
        approved_by: session?.user?.id,
        approver_name: await getUserDisplayName(),
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', approval.id)
      .eq('company_id', selectedCompanyId)

    if (error) {
      showToast('Failed to reject request', 'error')
    } else {
      await writeAuditLog(approval.id, 'rejected', `Rejected: ${rejectReason.trim() || 'No reason given'}`)
      showToast('Request rejected', 'success')
      loadApprovals()
    }
    setProcessing(false)
    setRejectReason('')
    setActionModal(null)
  }

  async function handleRestore(approval: ApprovalRecord) {
    if (!canApprove) {
      showToast('Only the nominated approver can restore requests', 'error')
      return
    }
    setProcessing(true)
    const { error } = await supabase
      .from('admin_approvals')
      .update({
        status: 'restored',
        updated_at: new Date().toISOString(),
      })
      .eq('id', approval.id)
      .eq('company_id', selectedCompanyId)

    if (error) {
      showToast('Failed to restore request', 'error')
    } else {
      await writeAuditLog(approval.id, 'restored', `Restored ${CATEGORY_LABELS[approval.category] || approval.category} request back to pending review`)
      showToast('Request restored — no data was deleted', 'success')
      loadApprovals()
    }
    setProcessing(false)
    setActionModal(null)
  }

  const pendingApprovals = approvals.filter(a => a.status === 'pending')
  const completedApprovals = approvals.filter(a => a.status !== 'pending')

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
        <div className="admin-spinner" />
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--text, #1a1a2e)' }}>Admin Approvals</h1>
        <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--text-muted, #64748b)' }}>
          Review and manage 2-step approval requests for destructive actions.
          {nominatedEmail && (
            <span style={{ marginLeft: 8, fontSize: 12, background: '#f0fdf4', color: '#166534', padding: '2px 8px', borderRadius: 6 }}>
              Nominated approver: {nominatedEmail}
            </span>
          )}
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '2px solid var(--border, #e2e8f0)' }}>
        {(['pending', 'history'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '10px 24px',
              fontSize: 14,
              fontWeight: tab === t ? 700 : 500,
              color: tab === t ? 'var(--primary, #6c5ce7)' : 'var(--text-muted, #64748b)',
              background: 'transparent',
              border: 'none',
              borderBottom: tab === t ? '2px solid var(--primary, #6c5ce7)' : '2px solid transparent',
              marginBottom: -2,
              cursor: 'pointer',
            }}
          >
            {t === 'pending' ? `Pending (${pendingApprovals.length})` : 'History & Audit'}
          </button>
        ))}
      </div>

      {/* Pending Tab */}
      {tab === 'pending' && (
        <>
          {pendingApprovals.length === 0 ? (
            <div style={{ ...cardStyle, textAlign: 'center', padding: 48 }}>
              <p style={{ margin: 0, fontSize: 15, color: 'var(--text-muted, #64748b)' }}>No pending approval requests.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {pendingApprovals.map(a => {
                const summary = a.record_summary as Record<string, unknown>
                return (
                  <div key={a.id} style={cardStyle}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 240 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          <span style={{
                            fontSize: 11,
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                            padding: '2px 8px',
                            borderRadius: 4,
                            background: STATUS_COLOURS.pending.bg,
                            color: STATUS_COLOURS.pending.text,
                          }}>Pending</span>
                          <span style={{
                            fontSize: 11,
                            fontWeight: 600,
                            padding: '2px 8px',
                            borderRadius: 4,
                            background: '#f1f5f9',
                            color: '#475569',
                          }}>{CATEGORY_LABELS[a.category] || a.category}</span>
                          <span style={{ fontSize: 12, color: 'var(--text-muted, #94a3b8)' }}>
                            {a.action === 'delete' ? 'Delete' : 'Revoke'}
                          </span>
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text, #1a1a2e)', marginBottom: 4 }}>
                          {(summary.description as string) || (summary.employee_name as string) || `Record ${a.record_id?.slice(0, 8) || 'N/A'}`}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted, #94a3b8)' }}>
                          Requested by {a.requester_name || 'Unknown'} on {formatDate(a.created_at)}
                        </div>
                        {(summary.warning as string) && (
                          <div style={{
                            marginTop: 8,
                            padding: '8px 12px',
                            borderRadius: 8,
                            background: '#fef3c7',
                            border: '1px solid #fcd34d',
                            fontSize: 13,
                            color: '#92400e',
                          }}>
                            {summary.warning as string}
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                        <button
                          className="admin-btn"
                          onClick={() => setActionModal({ approval: a, type: 'restore' })}
                          style={{
                            padding: '6px 14px',
                            fontSize: 13,
                            background: '#dbeafe',
                            color: '#1e40af',
                            border: 'none',
                            borderRadius: 8,
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >Dismiss</button>
                        <button
                          className="admin-btn"
                          onClick={() => setActionModal({ approval: a, type: 'reject' })}
                          style={{
                            padding: '6px 14px',
                            fontSize: 13,
                            background: '#fee2e2',
                            color: '#991b1b',
                            border: 'none',
                            borderRadius: 8,
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >Reject</button>
                        <button
                          className="admin-btn"
                          onClick={() => setActionModal({ approval: a, type: 'approve' })}
                          disabled={!canApprove}
                          title={!canApprove ? 'Only the nominated approver can approve' : ''}
                          style={{
                            padding: '6px 14px',
                            fontSize: 13,
                            background: canApprove ? '#d1fae5' : '#e2e8f0',
                            color: canApprove ? '#065f46' : '#94a3b8',
                            border: 'none',
                            borderRadius: 8,
                            fontWeight: 600,
                            cursor: canApprove ? 'pointer' : 'not-allowed',
                          }}
                        >Approve & Delete</button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Completed approvals summary */}
          {completedApprovals.length > 0 && (
            <div style={{ marginTop: 28 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text, #1a1a2e)', marginBottom: 12 }}>
                Completed ({completedApprovals.length})
              </h3>
              <div style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: 'var(--table-header-bg, #f8fafc)' }}>
                      <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted, #64748b)' }}>Status</th>
                      <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted, #64748b)' }}>Category</th>
                      <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted, #64748b)' }}>Description</th>
                      <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted, #64748b)' }}>Actioned By</th>
                      <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted, #64748b)' }}>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {completedApprovals.map(a => {
                      const sc = STATUS_COLOURS[a.status] || STATUS_COLOURS.pending
                      const summary = a.record_summary as Record<string, unknown>
                      return (
                        <tr key={a.id} style={{ borderTop: '1px solid var(--border, #e2e8f0)' }}>
                          <td style={{ padding: '10px 14px' }}>
                            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px', borderRadius: 4, background: sc.bg, color: sc.text }}>
                              {a.status}
                            </span>
                          </td>
                          <td style={{ padding: '10px 14px' }}>{CATEGORY_LABELS[a.category] || a.category}</td>
                          <td style={{ padding: '10px 14px' }}>{(summary.description as string) || `Record ${a.record_id?.slice(0, 8) || 'N/A'}`}</td>
                          <td style={{ padding: '10px 14px' }}>{a.approver_name || '—'}</td>
                          <td style={{ padding: '10px 14px' }}>{a.approved_at ? formatDate(a.approved_at) : '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* History & Audit Tab */}
      {tab === 'history' && (
        <div style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
          {audit.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 48 }}>
              <p style={{ margin: 0, fontSize: 15, color: 'var(--text-muted, #64748b)' }}>No audit entries yet.</p>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--table-header-bg, #f8fafc)' }}>
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted, #64748b)' }}>Action</th>
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted, #64748b)' }}>Detail</th>
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted, #64748b)' }}>Performed By</th>
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted, #64748b)' }}>Date</th>
                </tr>
              </thead>
              <tbody>
                {audit.map(a => (
                  <tr key={a.id} style={{ borderTop: '1px solid var(--border, #e2e8f0)' }}>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{
                        fontSize: 11,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        padding: '2px 8px',
                        borderRadius: 4,
                        background: (STATUS_COLOURS[a.action] || { bg: '#f1f5f9' }).bg,
                        color: (STATUS_COLOURS[a.action] || { text: '#475569' }).text,
                      }}>{a.action}</span>
                    </td>
                    <td style={{ padding: '10px 14px' }}>{a.detail || '—'}</td>
                    <td style={{ padding: '10px 14px' }}>{a.performer_name || '—'}</td>
                    <td style={{ padding: '10px 14px' }}>{formatDate(a.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Confirmation Modal */}
      {actionModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,.45)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
        }} onClick={() => { if (!processing) setActionModal(null) }}>
          <div
            style={{
              background: 'var(--card-bg, #fff)',
              borderRadius: 16,
              padding: 28,
              maxWidth: 480,
              width: '90%',
              boxShadow: '0 8px 30px rgba(0,0,0,.18)',
            }}
            onClick={e => e.stopPropagation()}
          >
            {actionModal.type === 'approve' && (
              <>
                <h3 style={{ margin: '0 0 12px', fontSize: 17, fontWeight: 700, color: 'var(--text, #1a1a2e)' }}>Confirm Approval</h3>
                <p style={{ margin: '0 0 8px', fontSize: 14, color: 'var(--text, #1a1a2e)' }}>
                  This will permanently {actionModal.approval.action === 'delete' ? 'delete' : 'revoke'} the following:
                </p>
                <div style={{ padding: '10px 14px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', marginBottom: 16, fontSize: 13 }}>
                  <strong>{CATEGORY_LABELS[actionModal.approval.category]}:</strong>{' '}
                  {(actionModal.approval.record_summary as Record<string, unknown>).description as string || `Record ${actionModal.approval.record_id?.slice(0, 8) || 'N/A'}`}
                </div>
                {(actionModal.approval.record_summary as Record<string, unknown>).warning && (
                  <div style={{ padding: '10px 14px', borderRadius: 8, background: '#fef3c7', border: '1px solid #fcd34d', marginBottom: 16, fontSize: 13, color: '#92400e' }}>
                    {(actionModal.approval.record_summary as Record<string, unknown>).warning as string}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button
                    className="admin-btn"
                    onClick={() => setActionModal(null)}
                    disabled={processing}
                    style={{ padding: '8px 20px', fontSize: 13, borderRadius: 8, background: '#f1f5f9', color: '#475569', border: 'none', cursor: 'pointer' }}
                  >Cancel</button>
                  <button
                    className="admin-btn admin-btn-danger"
                    onClick={() => handleApprove(actionModal.approval)}
                    disabled={processing}
                    style={{ padding: '8px 20px', fontSize: 13, borderRadius: 8, background: '#dc2626', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer' }}
                  >{processing ? 'Processing...' : 'Approve & Delete'}</button>
                </div>
              </>
            )}

            {actionModal.type === 'reject' && (
              <>
                <h3 style={{ margin: '0 0 12px', fontSize: 17, fontWeight: 700, color: 'var(--text, #1a1a2e)' }}>Reject Request</h3>
                <p style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--text-muted, #64748b)' }}>
                  Optionally provide a reason for rejecting this request.
                </p>
                <textarea
                  value={rejectReason}
                  onChange={e => setRejectReason(e.target.value)}
                  placeholder="Reason for rejection (optional)"
                  rows={3}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: 10,
                    border: '1px solid var(--border, #d1d5db)',
                    fontSize: 14,
                    color: 'var(--text, #1a1a2e)',
                    background: 'var(--input-bg, #fff)',
                    resize: 'vertical',
                    boxSizing: 'border-box',
                    marginBottom: 16,
                  }}
                />
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button
                    className="admin-btn"
                    onClick={() => { setActionModal(null); setRejectReason('') }}
                    disabled={processing}
                    style={{ padding: '8px 20px', fontSize: 13, borderRadius: 8, background: '#f1f5f9', color: '#475569', border: 'none', cursor: 'pointer' }}
                  >Cancel</button>
                  <button
                    className="admin-btn"
                    onClick={() => handleReject(actionModal.approval)}
                    disabled={processing}
                    style={{ padding: '8px 20px', fontSize: 13, borderRadius: 8, background: '#fee2e2', color: '#991b1b', border: 'none', fontWeight: 600, cursor: 'pointer' }}
                  >{processing ? 'Processing...' : 'Reject'}</button>
                </div>
              </>
            )}

            {actionModal.type === 'restore' && (
              <>
                <h3 style={{ margin: '0 0 12px', fontSize: 17, fontWeight: 700, color: 'var(--text, #1a1a2e)' }}>Dismiss Request</h3>
                <p style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--text-muted, #64748b)' }}>
                  This will dismiss the approval request without deleting any data. The original record will remain unchanged.
                </p>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button
                    className="admin-btn"
                    onClick={() => setActionModal(null)}
                    disabled={processing}
                    style={{ padding: '8px 20px', fontSize: 13, borderRadius: 8, background: '#f1f5f9', color: '#475569', border: 'none', cursor: 'pointer' }}
                  >Cancel</button>
                  <button
                    className="admin-btn"
                    onClick={() => handleRestore(actionModal.approval)}
                    disabled={processing}
                    style={{ padding: '8px 20px', fontSize: 13, borderRadius: 8, background: '#dbeafe', color: '#1e40af', border: 'none', fontWeight: 600, cursor: 'pointer' }}
                  >{processing ? 'Processing...' : 'Dismiss'}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
