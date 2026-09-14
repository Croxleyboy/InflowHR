import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../context/ToastContext'

interface CancellationRequest {
  id: string
  company_id: string
  requested_at: string
  reason: string | null
  status: string
  billing_end_date: string
  accepted_at: string | null
  data_frozen_at: string | null
  data_exported_at: string | null
  export_storage_path: string | null
  export_sent_at: string | null
  purge_after: string | null
  companies: { name: string } | null
}

const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  pending:   { bg: '#fef3c7', text: '#92400e', label: 'Pending Review' },
  accepted:  { bg: '#dbeafe', text: '#1e40af', label: 'Accepted — Awaiting Freeze' },
  frozen:    { bg: '#e0e7ff', text: '#3730a3', label: 'Frozen — Export Required' },
  exported:  { bg: '#fce7f3', text: '#9d174d', label: 'Exported — Send to Customer' },
  completed: { bg: '#d1fae5', text: '#065f46', label: 'Completed — Data Sent' },
  cancelled: { bg: '#f3f4f6', text: '#6b7280', label: 'Cancelled' },
}

function formatDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function AdminCancellations() {
  const { showError, showSuccess } = useToast()
  const [requests, setRequests] = useState<CancellationRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [exportingId, setExportingId] = useState<string | null>(null)

  const loadRequests = useCallback(async () => {
    const { data, error } = await supabase
      .from('cancellation_requests')
      .select('*, companies:company_id(name)')
      .order('created_at', { ascending: false })
    if (error) { showError('Failed to load cancellation requests'); return }
    setRequests((data || []) as CancellationRequest[])
    setLoading(false)
  }, [showError])

  useEffect(() => { loadRequests() }, [loadRequests])

  const handleAccept = useCallback(async (requestId: string) => {
    setActionLoading(requestId)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase.rpc('accept_company_cancellation' as any, { p_request_id: requestId })
    if (error) { showError('Failed to accept: ' + error.message); setActionLoading(null); return }
    showSuccess('Cancellation accepted')
    setActionLoading(null)
    loadRequests()
  }, [showError, showSuccess, loadRequests])

  const handleFreeze = useCallback(async (requestId: string) => {
    setActionLoading(requestId)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase.rpc('freeze_cancelled_company' as any, { p_request_id: requestId })
    if (error) { showError('Failed to freeze: ' + error.message); setActionLoading(null); return }
    showSuccess('Company data frozen and logins blocked')
    setActionLoading(null)
    loadRequests()
  }, [showError, showSuccess, loadRequests])

  const handleExport = useCallback(async (requestId: string, companyId: string, companyName: string) => {
    setExportingId(requestId)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await supabase.rpc('export_company_data' as any, { p_company_id: companyId })
      if (error) { showError('Export failed: ' + error.message); setExportingId(null); return }

      const timestamp = new Date().toISOString().split('T')[0]
      const jsonBlob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const storagePath = `cancellations/${companyId}/${timestamp}`
      const jsonFileName = `${storagePath}/${companyName.replace(/[^a-zA-Z0-9]/g, '_')}_export.json`

      const { error: uploadError } = await supabase.storage
        .from('receipts')
        .upload(jsonFileName, jsonBlob, { contentType: 'application/json', upsert: true })

      if (uploadError) {
        showError('Failed to upload export to storage: ' + uploadError.message)
        // Still allow download even if storage upload fails
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await supabase.rpc('mark_cancellation_exported' as any, {
        p_request_id: requestId,
        p_storage_path: jsonFileName,
      })

      // Trigger browser download
      const url = URL.createObjectURL(jsonBlob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${companyName.replace(/[^a-zA-Z0-9]/g, '_')}_cancellation_export_${timestamp}.json`
      a.click()
      URL.revokeObjectURL(url)

      showSuccess('Company data exported and saved to storage')
      loadRequests()
    } catch {
      showError('Export failed — please try again')
    }
    setExportingId(null)
  }, [showError, showSuccess, loadRequests])

  const handleMarkSent = useCallback(async (requestId: string) => {
    if (!window.confirm('Confirm that the data export has been delivered to the customer. After this, the 30-day purge countdown begins.')) return
    setActionLoading(requestId)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase.rpc('mark_cancellation_data_sent' as any, { p_request_id: requestId })
    if (error) { showError('Failed: ' + error.message); setActionLoading(null); return }
    showSuccess('Marked as sent — purge will occur in 30 days')
    setActionLoading(null)
    loadRequests()
  }, [showError, showSuccess, loadRequests])

  if (loading) return <div className="admin-page"><h1>Cancellations</h1><p>Loading…</p></div>

  const active = requests.filter(r => !['completed', 'cancelled'].includes(r.status))
  const history = requests.filter(r => ['completed', 'cancelled'].includes(r.status))

  return (
    <div className="admin-page">
      <h1>Company Cancellations</h1>

      {active.length === 0 && history.length === 0 && (
        <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>
          <p>No cancellation requests</p>
        </div>
      )}

      {active.length > 0 && (
        <>
          <h2 style={{ fontSize: 16, margin: '20px 0 12px', color: '#dc2626' }}>Active Requests</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {active.map(req => {
              const status = STATUS_COLORS[req.status] || STATUS_COLORS.pending
              const isActioning = actionLoading === req.id
              const isExporting = exportingId === req.id
              return (
                <div key={req.id} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 20, background: '#fff' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: 18 }}>{req.companies?.name || 'Unknown Company'}</h3>
                      <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748b' }}>
                        Requested {formatDate(req.requested_at)}
                      </p>
                    </div>
                    <span style={{ display: 'inline-block', padding: '4px 12px', borderRadius: 20, fontSize: 13, fontWeight: 600, background: status.bg, color: status.text }}>
                      {status.label}
                    </span>
                  </div>

                  {req.reason && (
                    <p style={{ margin: '12px 0 0', fontSize: 14, color: '#374151', background: '#f9fafb', padding: 10, borderRadius: 6, borderLeft: '3px solid #d1d5db' }}>
                      <strong>Reason:</strong> {req.reason}
                    </p>
                  )}

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginTop: 16, fontSize: 14 }}>
                    <div><span style={{ color: '#64748b' }}>Billing ends:</span> <strong>{formatDate(req.billing_end_date)}</strong></div>
                    <div><span style={{ color: '#64748b' }}>Accepted:</span> <strong>{formatDate(req.accepted_at)}</strong></div>
                    <div><span style={{ color: '#64748b' }}>Frozen:</span> <strong>{formatDate(req.data_frozen_at)}</strong></div>
                    <div><span style={{ color: '#64748b' }}>Exported:</span> <strong>{formatDate(req.data_exported_at)}</strong></div>
                    <div><span style={{ color: '#64748b' }}>Sent:</span> <strong>{formatDate(req.export_sent_at)}</strong></div>
                    <div><span style={{ color: '#64748b' }}>Purge after:</span> <strong>{formatDate(req.purge_after)}</strong></div>
                  </div>

                  <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
                    {req.status === 'pending' && (
                      <button
                        onClick={() => handleAccept(req.id)}
                        disabled={isActioning}
                        style={{ padding: '8px 20px', borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}
                      >
                        {isActioning ? 'Accepting…' : 'Accept Cancellation'}
                      </button>
                    )}

                    {req.status === 'accepted' && (
                      <button
                        onClick={() => handleFreeze(req.id)}
                        disabled={isActioning}
                        style={{ padding: '8px 20px', borderRadius: 6, border: 'none', background: '#7c3aed', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}
                      >
                        {isActioning ? 'Freezing…' : 'Freeze Company Now'}
                      </button>
                    )}

                    {req.status === 'frozen' && (
                      <button
                        onClick={() => handleExport(req.id, req.company_id, req.companies?.name || 'company')}
                        disabled={isExporting}
                        style={{ padding: '8px 20px', borderRadius: 6, border: 'none', background: '#059669', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}
                      >
                        {isExporting ? 'Exporting…' : 'Export & Download Data'}
                      </button>
                    )}

                    {req.status === 'exported' && (
                      <>
                        {req.export_storage_path && (
                          <button
                            onClick={async () => {
                              const { data } = await supabase.storage.from('receipts').createSignedUrl(req.export_storage_path!, 3600)
                              if (data?.signedUrl) window.open(data.signedUrl, '_blank')
                              else showError('Failed to generate download link')
                            }}
                            style={{ padding: '8px 20px', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: 14 }}
                          >
                            Re-download Export
                          </button>
                        )}
                        <button
                          onClick={() => handleMarkSent(req.id)}
                          disabled={isActioning}
                          style={{ padding: '8px 20px', borderRadius: 6, border: 'none', background: '#dc2626', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}
                        >
                          {isActioning ? 'Confirming…' : 'Confirm Data Sent to Customer'}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {history.length > 0 && (
        <>
          <h2 style={{ fontSize: 16, margin: '28px 0 12px', color: '#64748b' }}>History</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
                <th style={{ padding: 8 }}>Company</th>
                <th style={{ padding: 8 }}>Requested</th>
                <th style={{ padding: 8 }}>Status</th>
                <th style={{ padding: 8 }}>Data Sent</th>
                <th style={{ padding: 8 }}>Purge After</th>
              </tr>
            </thead>
            <tbody>
              {history.map(req => {
                const status = STATUS_COLORS[req.status] || STATUS_COLORS.cancelled
                return (
                  <tr key={req.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: 8 }}>{req.companies?.name || 'Unknown'}</td>
                    <td style={{ padding: 8 }}>{formatDate(req.requested_at)}</td>
                    <td style={{ padding: 8 }}>
                      <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: 12, fontWeight: 600, background: status.bg, color: status.text }}>
                        {status.label}
                      </span>
                    </td>
                    <td style={{ padding: 8 }}>{formatDate(req.export_sent_at)}</td>
                    <td style={{ padding: 8 }}>{formatDate(req.purge_after)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}
