import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'

interface ShiftAssignment {
  id: string
  date: string
  shift_template: {
    name: string
    start_time: string
    end_time: string
    colour: string
  } | null
  rota: {
    name: string
    status: string
  } | null
}

interface Employee {
  id: string
  first_name: string
  last_name: string
}

interface SwapRequest {
  id: string
  shift_assignment_id: string
  target_employee_id: string
  status: string
  reason: string | null
  created_at: string
  shift_assignment: {
    date: string
    shift_template: {
      name: string
    } | null
  } | null
  target_employee: {
    first_name: string
    last_name: string
  } | null
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  return `${dd}/${mm}/${yyyy}`
}

function formatTime(time: string): string {
  return time?.slice(0, 5) || ''
}

const statusColor: Record<string, string> = {
  pending: '#ff9800',
  approved: '#4caf50',
  rejected: '#f44336',
}

export default function ShiftSwap() {
  const navigate = useNavigate()
  const { t } = useLanguage()
  const { employeeId, companyUser } = useAuth()
  const [shifts, setShifts] = useState<ShiftAssignment[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [swapRequests, setSwapRequests] = useState<SwapRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null)
  const [targetEmployeeId, setTargetEmployeeId] = useState('')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const fetchData = useCallback(async () => {
    if (!employeeId || !companyUser?.company_id) return
    setLoading(true)

    const today = new Date().toISOString().split('T')[0]

    const [shiftsRes, employeesRes, swapsRes] = await Promise.all([
      supabase
        .from('shift_assignments')
        .select('*, shift_template:shift_templates(name, start_time, end_time, colour), rota:rotas(name, status)')
        .eq('employee_id', employeeId)
        .eq('company_id', companyUser.company_id)
        .gte('date', today),
      supabase
        .from('employees')
        .select('id, first_name, last_name')
        .eq('company_id', companyUser.company_id)
        .neq('id', employeeId),
      supabase
        .from('shift_swap_requests')
        .select('*, shift_assignment:shift_assignments(date, shift_template:shift_templates(name)), target_employee:employees!shift_swap_requests_target_employee_id_fkey(first_name, last_name)')
        .eq('requesting_employee_id', employeeId)
        .eq('company_id', companyUser.company_id)
        .order('created_at', { ascending: false }),
    ])

    const published = (shiftsRes.data || []).filter((s: any) => s.rota?.status === 'published')
    setShifts(published as ShiftAssignment[])
    setEmployees((employeesRes.data || []) as Employee[])
    setSwapRequests((swapsRes.data || []) as SwapRequest[])
    setLoading(false)
  }, [employeeId, companyUser?.company_id])

  useEffect(() => { fetchData() }, [fetchData])

  async function handleSubmitSwap() {
    if (!selectedShiftId || !targetEmployeeId || !companyUser?.company_id) return
    setSubmitting(true)

    await supabase.from('shift_swap_requests').insert({
      company_id: companyUser.company_id,
      shift_assignment_id: selectedShiftId,
      requesting_employee_id: employeeId,
      target_employee_id: targetEmployeeId,
      status: 'pending',
      reason: reason || null,
    })

    setSelectedShiftId(null)
    setTargetEmployeeId('')
    setReason('')
    setSubmitting(false)
    fetchData()
  }

  if (loading) {
    return (
      <div className="feature-page">
        <p className="claims-empty">{t('common.loading')}</p>
      </div>
    )
  }

  return (
    <div className="feature-page">
      <header className="feature-header">
        <button className="feature-back" onClick={() => navigate('/shifts')}>
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
            <circle cx="18" cy="18" r="17" stroke="#c62828" strokeWidth="2" />
            <path d="M21 12l-6 6 6 6" stroke="#c62828" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="feature-header-center">
          <h1 className="feature-title">{t('shifts.swap_title')}</h1>
        </div>
        <button className="feature-refresh" onClick={fetchData}>
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="14" stroke="#c62828" strokeWidth="2" />
            <path d="M22 14a6.5 6.5 0 0 0-11.3-1.5M10 18a6.5 6.5 0 0 0 11.3 1.5" stroke="#c62828" strokeWidth="2" strokeLinecap="round" />
            <path d="M22 10v4h-4M10 22v-4h4" stroke="#c62828" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </header>

      <div className="claims-list">
        {shifts.length === 0 ? (
          <p className="claims-empty">{t('shifts.no_upcoming')}</p>
        ) : (
          shifts
            .sort((a, b) => a.date.localeCompare(b.date))
            .map(s => (
              <div key={s.id} className="claim-card" style={{ borderLeft: `4px solid ${s.shift_template?.colour || '#999'}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <strong>{s.shift_template?.name || 'Shift'}</strong>
                    <p style={{ margin: '2px 0', fontSize: 14, color: 'var(--text-secondary)' }}>
                      {formatDate(s.date)} &middot; {formatTime(s.shift_template?.start_time || '')} &ndash; {formatTime(s.shift_template?.end_time || '')}
                    </p>
                    {s.rota?.name && (
                      <p style={{ margin: '2px 0', fontSize: 12, color: 'var(--text-muted)' }}>{s.rota.name}</p>
                    )}
                  </div>
                  <button
                    className="claim-action-btn"
                    style={{ background: '#c62828', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer' }}
                    onClick={() => setSelectedShiftId(selectedShiftId === s.id ? null : s.id)}
                  >
                    {t('shifts.request_swap')}
                  </button>
                </div>

                {selectedShiftId === s.id && (
                  <div style={{ marginTop: 12, padding: 12, background: 'var(--bg-secondary, #f5f5f5)', borderRadius: 8 }}>
                    <label style={{ display: 'block', marginBottom: 8, fontSize: 14, fontWeight: 600 }}>
                      {t('shifts.swap_with')}
                    </label>
                    <select
                      value={targetEmployeeId}
                      onChange={e => setTargetEmployeeId(e.target.value)}
                      style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid var(--border-color, #ddd)', fontSize: 14, marginBottom: 10 }}
                    >
                      <option value="">--</option>
                      {employees.map(emp => (
                        <option key={emp.id} value={emp.id}>
                          {emp.first_name} {emp.last_name}
                        </option>
                      ))}
                    </select>

                    <label style={{ display: 'block', marginBottom: 8, fontSize: 14, fontWeight: 600 }}>
                      {t('shifts.swap_reason')}
                    </label>
                    <textarea
                      value={reason}
                      onChange={e => setReason(e.target.value)}
                      rows={3}
                      style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid var(--border-color, #ddd)', fontSize: 14, resize: 'vertical', marginBottom: 10 }}
                    />

                    <button
                      onClick={handleSubmitSwap}
                      disabled={!targetEmployeeId || submitting}
                      style={{
                        width: '100%',
                        padding: 12,
                        borderRadius: 10,
                        border: 'none',
                        background: !targetEmployeeId ? '#ccc' : '#c62828',
                        color: '#fff',
                        fontWeight: 700,
                        fontSize: 15,
                        cursor: !targetEmployeeId ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {submitting ? t('shifts.swap_submitting') : t('shifts.swap_submit')}
                    </button>
                  </div>
                )}
              </div>
            ))
        )}
      </div>

      <div style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 12 }}>{t('shifts.my_swap_requests')}</h2>
        {swapRequests.length === 0 ? (
          <p className="claims-empty">{t('shifts.no_swaps')}</p>
        ) : (
          <div className="claims-list">
            {swapRequests.map(sr => (
              <div key={sr.id} className="claim-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <strong>{sr.shift_assignment?.shift_template?.name || 'Shift'}</strong>
                    {sr.shift_assignment?.date && (
                      <p style={{ margin: '2px 0', fontSize: 14, color: 'var(--text-secondary)' }}>
                        {formatDate(sr.shift_assignment.date)}
                      </p>
                    )}
                    {sr.target_employee && (
                      <p style={{ margin: '2px 0', fontSize: 13, color: 'var(--text-muted)' }}>
                        {t('shifts.swap_with')}: {sr.target_employee.first_name} {sr.target_employee.last_name}
                      </p>
                    )}
                    {sr.reason && (
                      <p style={{ margin: '2px 0', fontSize: 12, color: 'var(--text-muted)' }}>{sr.reason}</p>
                    )}
                  </div>
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '4px 12px',
                      borderRadius: 20,
                      fontSize: 12,
                      fontWeight: 700,
                      color: '#fff',
                      background: statusColor[sr.status] || '#999',
                    }}
                  >
                    {sr.status === 'pending' && t('shifts.swap_pending')}
                    {sr.status === 'approved' && t('shifts.swap_approved')}
                    {sr.status === 'rejected' && t('shifts.swap_rejected')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
