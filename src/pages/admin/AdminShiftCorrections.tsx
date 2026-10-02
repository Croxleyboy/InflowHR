import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

interface Correction {
  id: string
  company_id: string
  employee_id: string
  shift_assignment_id: string
  checkin_record_id: string | null
  correction_type: string
  shift_date: string
  expected_time: string | null
  actual_time: string | null
  variance_minutes: number
  employee_comment: string | null
  status: string
  admin_comment: string | null
  resolved_by: string | null
  resolved_at: string | null
  created_at: string
  employee?: { first_name: string; last_name: string }
  shift_template_name?: string
}

const TYPE_LABELS: Record<string, string> = {
  late_checkin: 'Late Check-in',
  early_checkout: 'Early Check-out',
  no_checkin: 'No Check-in',
  no_checkout: 'No Check-out',
}

const STATUS_COLOURS: Record<string, { bg: string; color: string }> = {
  pending: { bg: '#f5f5f5', color: '#666' },
  submitted: { bg: '#fff3e0', color: '#e65100' },
  approved: { bg: '#e8f5e9', color: '#2e7d32' },
  declined: { bg: '#fef2f2', color: '#dc2626' },
}

export default function AdminShiftCorrections() {
  const { companyUser, employeeId: adminEmpId } = useAuth()
  const [corrections, setCorrections] = useState<Correction[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [adminComments, setAdminComments] = useState<Record<string, string>>({})
  const [processing, setProcessing] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTimes, setEditTimes] = useState<{ checkIn: string; checkOut: string }>({ checkIn: '', checkOut: '' })
  const [approveTimes, setApproveTimes] = useState<Record<string, { checkIn: string; checkOut: string }>>({})

  const fetchCorrections = useCallback(async () => {
    if (!companyUser?.company_id) return
    setLoading(true)

    const { data: corrData } = await supabase
      .from('shift_corrections')
      .select('*')
      .eq('company_id', companyUser.company_id)
      .order('created_at', { ascending: false })

    const rows = (corrData || []) as Correction[]

    const empIds = [...new Set(rows.map(r => r.employee_id))]
    const assignIds = [...new Set(rows.map(r => r.shift_assignment_id))]

    const [empRes, assignRes] = await Promise.all([
      empIds.length > 0
        ? supabase.from('employees').select('id, first_name, last_name').in('id', empIds)
        : Promise.resolve({ data: [] }),
      assignIds.length > 0
        ? supabase.from('shift_assignments').select('id, shift_template:shift_templates(name)').in('id', assignIds)
        : Promise.resolve({ data: [] }),
    ])

    const empMap: Record<string, { first_name: string; last_name: string }> = {}
    for (const e of (empRes.data || []) as any[]) empMap[e.id] = { first_name: e.first_name, last_name: e.last_name }

    const tmplMap: Record<string, string> = {}
    for (const a of (assignRes.data || []) as any[]) {
      tmplMap[a.id] = a.shift_template?.name || 'Shift'
    }

    for (const r of rows) {
      r.employee = empMap[r.employee_id]
      r.shift_template_name = tmplMap[r.shift_assignment_id]
    }

    setCorrections(rows)
    setLoading(false)
  }, [companyUser?.company_id])

  useEffect(() => { fetchCorrections() }, [fetchCorrections])

  const handleApprove = async (c: Correction) => {
    if (!companyUser?.company_id || !adminEmpId) return
    const times = approveTimes[c.id]
    if (!times?.checkIn && !times?.checkOut) return
    setProcessing(c.id)

    const isCheckinType = c.correction_type === 'late_checkin' || c.correction_type === 'no_checkin'
    const isCheckoutType = c.correction_type === 'early_checkout' || c.correction_type === 'no_checkout'

    if (c.checkin_record_id) {
      const updates: Record<string, string> = {}
      if (isCheckinType && times.checkIn) updates.check_in_at = new Date(`${c.shift_date}T${times.checkIn}`).toISOString()
      if (isCheckoutType && times.checkOut) {
        updates.check_out_at = new Date(`${c.shift_date}T${times.checkOut}`).toISOString()
        updates.status = 'checked_out'
      }
      if (Object.keys(updates).length > 0) {
        await supabase.from('checkin_records').update(updates)
          .eq('id', c.checkin_record_id)
          .eq('company_id', companyUser.company_id)
      }
    } else {
      const row: Record<string, any> = {
        company_id: companyUser.company_id,
        employee_id: c.employee_id,
        source: 'shifts',
        shift_assignment_id: c.shift_assignment_id,
        status: 'checked_out',
      }
      if (times.checkIn) row.check_in_at = new Date(`${c.shift_date}T${times.checkIn}`).toISOString()
      if (times.checkOut) row.check_out_at = new Date(`${c.shift_date}T${times.checkOut}`).toISOString()
      const { data: newRec } = await supabase.from('checkin_records').insert(row).select('id').single()
      if (newRec) {
        await supabase.from('shift_corrections').update({ checkin_record_id: newRec.id }).eq('id', c.id)
      }
    }

    const commentParts: string[] = []
    if (times.checkIn) commentParts.push(`check-in corrected to ${times.checkIn}`)
    if (times.checkOut) commentParts.push(`check-out corrected to ${times.checkOut}`)

    await supabase.from('shift_corrections').update({
      status: 'approved',
      admin_comment: adminComments[c.id]?.trim() || commentParts.join(', '),
      resolved_by: adminEmpId,
      resolved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', c.id).eq('company_id', companyUser.company_id)

    setProcessing(null)
    setAdminComments(prev => { const n = { ...prev }; delete n[c.id]; return n })
    setApproveTimes(prev => { const n = { ...prev }; delete n[c.id]; return n })
    fetchCorrections()
  }

  const handleDecline = async (c: Correction) => {
    if (!companyUser?.company_id || !adminEmpId) return
    setProcessing(c.id)

    await supabase.from('shift_corrections').update({
      status: 'declined',
      admin_comment: adminComments[c.id]?.trim() || 'Speak to your shift manager regarding this shift.',
      resolved_by: adminEmpId,
      resolved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', c.id).eq('company_id', companyUser.company_id)

    await supabase.from('notifications').insert({
      company_id: companyUser.company_id,
      employee_id: c.employee_id,
      type: 'shift_correction',
      title: 'Shift Correction Declined',
      message: `Your ${TYPE_LABELS[c.correction_type] || c.correction_type} correction for ${new Date(c.shift_date + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} was declined. Please speak to your shift manager.`,
      is_read: false,
    })

    setProcessing(null)
    setAdminComments(prev => { const n = { ...prev }; delete n[c.id]; return n })
    fetchCorrections()
  }

  const handleManualCorrect = async (c: Correction) => {
    if (!companyUser?.company_id || !adminEmpId) return
    setProcessing(c.id)

    if (c.checkin_record_id) {
      const updates: Record<string, string> = {}
      if (editTimes.checkIn) updates.check_in_at = new Date(`${c.shift_date}T${editTimes.checkIn}`).toISOString()
      if (editTimes.checkOut) {
        updates.check_out_at = new Date(`${c.shift_date}T${editTimes.checkOut}`).toISOString()
        updates.status = 'checked_out'
      }
      if (Object.keys(updates).length > 0) {
        await supabase.from('checkin_records').update(updates)
          .eq('id', c.checkin_record_id)
          .eq('company_id', companyUser.company_id)
      }
    } else {
      const row: Record<string, any> = {
        company_id: companyUser.company_id,
        employee_id: c.employee_id,
        source: 'shifts',
        shift_assignment_id: c.shift_assignment_id,
        status: 'checked_out',
      }
      if (editTimes.checkIn) row.check_in_at = new Date(`${c.shift_date}T${editTimes.checkIn}`).toISOString()
      if (editTimes.checkOut) row.check_out_at = new Date(`${c.shift_date}T${editTimes.checkOut}`).toISOString()
      const { data: newRec } = await supabase.from('checkin_records').insert(row).select('id').single()
      if (newRec) {
        await supabase.from('shift_corrections').update({ checkin_record_id: newRec.id }).eq('id', c.id)
      }
    }

    await supabase.from('shift_corrections').update({
      status: 'approved',
      admin_comment: `Manually corrected${editTimes.checkIn ? ` check-in to ${editTimes.checkIn}` : ''}${editTimes.checkOut ? ` check-out to ${editTimes.checkOut}` : ''}`,
      resolved_by: adminEmpId,
      resolved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', c.id).eq('company_id', companyUser.company_id)

    setProcessing(null)
    setEditingId(null)
    setEditTimes({ checkIn: '', checkOut: '' })
    fetchCorrections()
  }

  const filtered = statusFilter === 'all' ? corrections : corrections.filter(c => c.status === statusFilter)

  if (loading) return <p className="claims-empty">Loading corrections...</p>

  return (
    <div style={{ padding: '16px 0' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {['all', 'submitted', 'pending', 'approved', 'declined'].map(s => (
          <button
            key={s}
            className={`admin-tab ${statusFilter === s ? 'admin-tab-active' : ''}`}
            onClick={() => setStatusFilter(s)}
            style={{ fontSize: 12, padding: '6px 12px' }}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
            {s !== 'all' && (
              <span style={{ marginLeft: 4, fontSize: 10, opacity: 0.7 }}>
                ({corrections.filter(c => c.status === s).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="claims-empty">No corrections found.</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Shift</th>
                <th>Date</th>
                <th>Type</th>
                <th>Expected</th>
                <th>Actual</th>
                <th>Variance</th>
                <th>Comment</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => {
                const st = STATUS_COLOURS[c.status] || STATUS_COLOURS.pending
                const fmtDate = new Date(c.shift_date + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                return (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 600 }}>{c.employee ? `${c.employee.first_name} ${c.employee.last_name}` : '-'}</td>
                    <td>{c.shift_template_name || '-'}</td>
                    <td>{fmtDate}</td>
                    <td>
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                        background: 'rgba(220,38,38,0.1)', color: '#dc2626', textTransform: 'uppercase',
                      }}>
                        {TYPE_LABELS[c.correction_type] || c.correction_type}
                      </span>
                    </td>
                    <td>{c.expected_time || '-'}</td>
                    <td>{c.actual_time || '-'}</td>
                    <td>{c.variance_minutes > 0 ? `${c.variance_minutes} mins` : '-'}</td>
                    <td style={{ maxWidth: 200, fontSize: 12 }}>
                      {c.employee_comment || '-'}
                      {c.admin_comment && <div style={{ color: '#666', marginTop: 4, fontStyle: 'italic' }}>Admin: {c.admin_comment}</div>}
                    </td>
                    <td>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: st.bg, color: st.color }}>
                        {c.status.charAt(0).toUpperCase() + c.status.slice(1)}
                      </span>
                    </td>
                    <td>
                      {c.status === 'submitted' && (() => {
                        const isIn = c.correction_type === 'late_checkin' || c.correction_type === 'no_checkin'
                        const isOut = c.correction_type === 'early_checkout' || c.correction_type === 'no_checkout'
                        const at = approveTimes[c.id] || { checkIn: '', checkOut: '' }
                        const hasTime = (isIn && at.checkIn) || (isOut && at.checkOut)
                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {isIn && (
                              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                <label style={{ fontSize: 10 }}>In:</label>
                                <input
                                  type="time"
                                  value={at.checkIn}
                                  onChange={e => setApproveTimes(prev => ({ ...prev, [c.id]: { ...at, checkIn: e.target.value } }))}
                                  style={{ fontSize: 11, padding: '2px 4px' }}
                                />
                              </div>
                            )}
                            {isOut && (
                              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                <label style={{ fontSize: 10 }}>Out:</label>
                                <input
                                  type="time"
                                  value={at.checkOut}
                                  onChange={e => setApproveTimes(prev => ({ ...prev, [c.id]: { ...at, checkOut: e.target.value } }))}
                                  style={{ fontSize: 11, padding: '2px 4px' }}
                                />
                              </div>
                            )}
                            <input
                              type="text"
                              placeholder="Admin comment (optional)"
                              value={adminComments[c.id] || ''}
                              onChange={e => setAdminComments(prev => ({ ...prev, [c.id]: e.target.value }))}
                              style={{ fontSize: 11, padding: '4px 6px', border: '1px solid var(--border)', borderRadius: 6, width: 160 }}
                            />
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button
                                className="admin-btn admin-btn-primary"
                                style={{ fontSize: 11, padding: '4px 10px' }}
                                disabled={processing === c.id || !hasTime}
                                onClick={() => handleApprove(c)}
                                title={!hasTime ? 'Set corrected time before approving' : ''}
                              >
                                Approve
                              </button>
                              <button
                                className="admin-btn"
                                style={{ fontSize: 11, padding: '4px 10px', background: '#dc2626', color: '#fff', border: 'none' }}
                                disabled={processing === c.id}
                                onClick={() => handleDecline(c)}
                              >
                                Decline
                              </button>
                            </div>
                          </div>
                        )
                      })()}
                      {c.status === 'declined' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {editingId === c.id ? (
                            <>
                              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                <label style={{ fontSize: 10 }}>In:</label>
                                <input type="time" value={editTimes.checkIn} onChange={e => setEditTimes(p => ({ ...p, checkIn: e.target.value }))} style={{ fontSize: 11, padding: '2px 4px' }} />
                              </div>
                              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                <label style={{ fontSize: 10 }}>Out:</label>
                                <input type="time" value={editTimes.checkOut} onChange={e => setEditTimes(p => ({ ...p, checkOut: e.target.value }))} style={{ fontSize: 11, padding: '2px 4px' }} />
                              </div>
                              <div style={{ display: 'flex', gap: 4 }}>
                                <button
                                  className="admin-btn admin-btn-primary"
                                  style={{ fontSize: 11, padding: '4px 10px' }}
                                  disabled={processing === c.id || (!editTimes.checkIn && !editTimes.checkOut)}
                                  onClick={() => handleManualCorrect(c)}
                                >
                                  Save
                                </button>
                                <button className="admin-btn" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => setEditingId(null)}>Cancel</button>
                              </div>
                            </>
                          ) : (
                            <button
                              className="admin-btn"
                              style={{ fontSize: 11, padding: '4px 10px' }}
                              onClick={() => {
                                setEditingId(c.id)
                                setEditTimes({ checkIn: c.expected_time || '', checkOut: '' })
                              }}
                            >
                              Edit &amp; Correct
                            </button>
                          )}
                        </div>
                      )}
                      {(c.status === 'approved' || c.status === 'pending') && <span style={{ fontSize: 11, color: '#999' }}>—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
