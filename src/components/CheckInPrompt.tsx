import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useCheckIn } from '../context/CheckInContext'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { supabase } from '../lib/supabase'
import { toLocalDateStr } from '../lib/formatters'

export default function CheckInPrompt() {
  const { settings, activeCheckin, checkIn, loading } = useCheckIn()
  const { companyUser, employeeId } = useAuth()
  const { showSuccess, showError } = useToast()
  const navigate = useNavigate()
  const location = useLocation()

  const [visible, setVisible] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [acting, setActing] = useState(false)
  const [shiftAssignmentId, setShiftAssignmentId] = useState<string | null>(null)

  const tsEnabled = !!settings?.timesheets_checkin_enabled
  const shiftEnabled = !!settings?.shifts_checkin_enabled
  const enabled = tsEnabled || shiftEnabled
  const source: 'timesheets' | 'shifts' = tsEnabled ? 'timesheets' : 'shifts'
  const sourceLabel = tsEnabled ? 'Timesheet' : 'Shift'

  const fetchShiftAssignment = useCallback(async () => {
    if (!shiftEnabled || tsEnabled || !employeeId || !companyUser?.company_id) return
    const todayStr = toLocalDateStr()
    const { data } = await supabase.from('shift_assignments')
      .select('id, rota:rotas(status)')
      .eq('employee_id', employeeId)
      .eq('company_id', companyUser.company_id)
      .eq('date', todayStr)

    const row = (data || []).find((r: any) => r.rota?.status === 'published' || r.rota?.status === 'draft') as any
    if (row) setShiftAssignmentId(row.id)
  }, [shiftEnabled, tsEnabled, employeeId, companyUser?.company_id])

  useEffect(() => {
    if (loading || !employeeId || !companyUser || dismissed || activeCheckin || !enabled) return
    if (location.pathname.includes('/checkin') || location.pathname.startsWith('/admin')) return
    const key = `checkin_dismissed_${employeeId}_${toLocalDateStr()}`
    if (sessionStorage.getItem(key)) return

    let timer: ReturnType<typeof setTimeout>
    fetchShiftAssignment().then(() => {
      timer = setTimeout(() => setVisible(true), 1500)
    })
    return () => { if (timer) clearTimeout(timer) }
  }, [loading, employeeId, companyUser, dismissed, activeCheckin, enabled, location.pathname, fetchShiftAssignment])

  if (!visible || !enabled || activeCheckin) return null

  function dismiss(remember: boolean) {
    setVisible(false)
    setDismissed(true)
    if (remember && employeeId) {
      sessionStorage.setItem(`checkin_dismissed_${employeeId}_${toLocalDateStr()}`, '1')
    }
  }

  async function handleCheckIn() {
    setActing(true)
    const result = await checkIn(source, source === 'shifts' ? shiftAssignmentId || undefined : undefined)
    if (result.ok) {
      showSuccess(result.wfh ? 'Checked in from home' : `Checked in to ${source}`)
      setVisible(false)
      setDismissed(true)
    } else {
      showError(result.error || 'Check-in failed')
    }
    setActing(false)
  }

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <>
      <style>{`
        .cip-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 9999; display: flex; align-items: center; justify-content: center; padding: 20px; animation: cip-fade 0.2s ease; }
        @keyframes cip-fade { from { opacity: 0; } to { opacity: 1; } }
        .cip-modal { background: var(--card-bg, #fff); border-radius: 16px; padding: 28px 24px; max-width: 360px; width: 100%; text-align: center; box-shadow: 0 20px 60px rgba(0,0,0,0.2); animation: cip-slide 0.25s ease; }
        @keyframes cip-slide { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        .cip-icon { font-size: 40px; margin-bottom: 12px; }
        .cip-greeting { font-size: 20px; font-weight: 700; color: var(--text); margin-bottom: 4px; }
        .cip-sub { font-size: 14px; color: var(--text-muted, #888); margin-bottom: 20px; }
        .cip-btn { width: 100%; padding: 13px; border-radius: 10px; font-size: 15px; font-weight: 600; border: none; cursor: pointer; font-family: inherit; margin-bottom: 8px; }
        .cip-btn-primary { background: #16a34a; color: #fff; }
        .cip-btn-primary:hover { background: #15803d; }
        .cip-btn-primary:disabled { opacity: 0.6; cursor: wait; }
        .cip-btn-secondary { background: transparent; color: var(--text-muted, #888); }
        .cip-btn-secondary:hover { color: var(--text); }
        .cip-link { font-size: 13px; color: var(--text-muted, #999); cursor: pointer; background: none; border: none; font-family: inherit; margin-top: 4px; }
        .cip-link:hover { text-decoration: underline; }
      `}</style>
      <div className="cip-overlay" onClick={() => dismiss(false)}>
        <div className="cip-modal" onClick={e => e.stopPropagation()}>
          <div className="cip-icon">📍</div>
          <div className="cip-greeting">{greeting}!</div>
          <div className="cip-sub">{sourceLabel} Check-In</div>

          <button className="cip-btn cip-btn-primary" onClick={handleCheckIn} disabled={acting}
            style={source === 'shifts' ? { background: '#e65100' } : undefined}>
            {acting ? 'Checking in...' : `${sourceLabel} Check-In`}
          </button>

          <button className="cip-btn cip-btn-secondary" onClick={() => dismiss(false)}>
            Remind Me Later
          </button>
          <button className="cip-link" onClick={() => dismiss(true)}>
            Skip for today
          </button>
          <button className="cip-link" onClick={() => {
            dismiss(false)
            navigate(tsEnabled ? '/timesheets/checkin' : '/shifts/checkin')
          }} style={{ display: 'block', margin: '8px auto 0' }}>
            View check-in details →
          </button>
        </div>
      </div>
    </>
  )
}
