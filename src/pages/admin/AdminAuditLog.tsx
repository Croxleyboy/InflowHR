import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

interface AuditEntry {
  id: number
  performed_at: string
  actor_id: string
  actor_role: string
  company_id: string | null
  table_name: string
  record_id: string | null
  action: string
  old_data: any
  new_data: any
  metadata: any
}

const ACTION_COLORS: Record<string, { bg: string; color: string }> = {
  SELECT:         { bg: '#e3f2fd', color: '#1565c0' },
  INSERT:         { bg: '#e8f5e9', color: '#2e7d32' },
  UPDATE:         { bg: '#fff3e0', color: '#e65100' },
  DELETE:         { bg: '#ffebee', color: '#c62828' },
  EXPORT:         { bg: '#f3e5f5', color: '#7b1fa2' },
  ANONYMISE:      { bg: '#fce4ec', color: '#880e4f' },
  GRANT_ACCESS:   { bg: '#e0f7fa', color: '#00695c' },
  REVOKE_ACCESS:  { bg: '#fff8e1', color: '#f57f17' },
}

export default function AdminAuditLog() {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [expanded, setExpanded] = useState<number | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const PAGE_SIZE = 50

  async function loadEntries() {
    setLoading(true)
    let query = supabase
      .from('gdpr_audit_logs')
      .select('*')
      .order('performed_at', { ascending: false })
      .limit(100)

    if (filter) {
      query = query.eq('action', filter)
    }

    const { data } = await query
    setEntries((data as AuditEntry[]) || [])
    setCurrentPage(1)
    setLoading(false)
  }

  useEffect(() => { loadEntries() }, [filter])

  const totalPages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE))
  const paginatedEntries = entries.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  function renderPagination() {
    if (totalPages <= 1) return null
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
        <button
          className="admin-btn-sm"
          onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
          disabled={currentPage === 1}
          style={{ padding: '6px 12px', fontSize: 13 }}
        >
          Previous
        </button>
        {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
          <button
            key={page}
            onClick={() => setCurrentPage(page)}
            style={{
              padding: '6px 12px',
              fontSize: 13,
              fontWeight: currentPage === page ? 700 : 400,
              background: currentPage === page ? '#1565c0' : '#f5f5f5',
              color: currentPage === page ? '#fff' : '#333',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            {page}
          </button>
        ))}
        <button
          className="admin-btn-sm"
          onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
          disabled={currentPage === totalPages}
          style={{ padding: '6px 12px', fontSize: 13 }}
        >
          Next
        </button>
        <span style={{ fontSize: 12, color: '#888', marginLeft: 8 }}>
          Showing {((currentPage - 1) * PAGE_SIZE) + 1}–{Math.min(currentPage * PAGE_SIZE, entries.length)} of {entries.length}
        </span>
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>GDPR Audit Log</h3>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#8b8fa3' }}>
            Immutable record of all data access and modifications (Art. 30)
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: '#8b8fa3' }}>Filter:</label>
          <select
            className="admin-input"
            style={{ minWidth: 160, fontSize: 13 }}
            value={filter}
            onChange={e => setFilter(e.target.value)}
          >
            <option value="">All Actions</option>
            <option value="SELECT">SELECT</option>
            <option value="INSERT">INSERT</option>
            <option value="UPDATE">UPDATE</option>
            <option value="DELETE">DELETE</option>
            <option value="EXPORT">EXPORT</option>
            <option value="ANONYMISE">ANONYMISE</option>
            <option value="GRANT_ACCESS">GRANT_ACCESS</option>
            <option value="REVOKE_ACCESS">REVOKE_ACCESS</option>
          </select>
        </div>
      </div>

      <div style={{ padding: '10px 14px', background: '#f8f9fc', borderRadius: 8, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8b8fa3" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
        <span style={{ fontSize: 12, color: '#8b8fa3' }}>
          This log is append-only — entries cannot be edited or deleted. Showing the most recent entries.
        </span>
      </div>

      {loading ? (
        <div className="admin-loading">Loading...</div>
      ) : entries.length === 0 ? (
        <div className="admin-empty" style={{ padding: 40 }}>No audit log entries found</div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Table</th>
                <th>Record</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {paginatedEntries.map(e => {
                const colors = ACTION_COLORS[e.action] || { bg: '#f5f5f5', color: '#666' }
                const isExpanded = expanded === e.id
                return (
                  <>
                    <tr key={e.id} style={{ cursor: (e.old_data || e.new_data || e.metadata) ? 'pointer' : 'default' }}
                        onClick={() => setExpanded(isExpanded ? null : e.id)}>
                      <td style={{ fontSize: 12, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                        {new Date(e.performed_at).toLocaleDateString('en-GB')}{' '}
                        {new Date(e.performed_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </td>
                      <td>
                        <span style={{
                          fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
                          background: e.actor_role === 'super_admin' ? '#e3f2fd' : '#f5f5f5',
                          color: e.actor_role === 'super_admin' ? '#1565c0' : '#666',
                        }}>
                          {e.actor_role}
                        </span>
                      </td>
                      <td>
                        <span style={{
                          fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                          background: colors.bg, color: colors.color,
                        }}>
                          {e.action}
                        </span>
                      </td>
                      <td><code style={{ fontSize: 12 }}>{e.table_name}</code></td>
                      <td style={{ fontSize: 12, fontFamily: 'monospace', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {e.record_id ? e.record_id.substring(0, 12) + '...' : '-'}
                      </td>
                      <td style={{ fontSize: 12, color: '#8b8fa3' }}>
                        {(e.old_data || e.new_data || e.metadata) ? (isExpanded ? '▼' : '▶') : '-'}
                      </td>
                    </tr>
                    {isExpanded && (e.old_data || e.new_data || e.metadata) && (
                      <tr key={e.id + '-detail'}>
                        <td colSpan={6} style={{ padding: 0 }}>
                          <div style={{ padding: '12px 16px', background: '#f8f9fc', borderTop: '1px solid #e5e7eb' }}>
                            {e.metadata && (
                              <div style={{ marginBottom: 8 }}>
                                <strong style={{ fontSize: 11, color: '#8b8fa3', textTransform: 'uppercase' }}>Metadata</strong>
                                <pre style={{ fontSize: 11, margin: '4px 0', padding: 8, background: '#fff', borderRadius: 6, overflow: 'auto', maxHeight: 120 }}>
                                  {JSON.stringify(e.metadata, null, 2)}
                                </pre>
                              </div>
                            )}
                            {e.new_data && (
                              <div style={{ marginBottom: 8 }}>
                                <strong style={{ fontSize: 11, color: '#2e7d32', textTransform: 'uppercase' }}>New Data</strong>
                                <pre style={{ fontSize: 11, margin: '4px 0', padding: 8, background: '#fff', borderRadius: 6, overflow: 'auto', maxHeight: 200 }}>
                                  {JSON.stringify(e.new_data, null, 2)}
                                </pre>
                              </div>
                            )}
                            {e.old_data && (
                              <div>
                                <strong style={{ fontSize: 11, color: '#c62828', textTransform: 'uppercase' }}>Old Data</strong>
                                <pre style={{ fontSize: 11, margin: '4px 0', padding: 8, background: '#fff', borderRadius: 6, overflow: 'auto', maxHeight: 200 }}>
                                  {JSON.stringify(e.old_data, null, 2)}
                                </pre>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
        {renderPagination()}
      )}
    </div>
  )
}
