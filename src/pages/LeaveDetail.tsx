import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../context/LanguageContext'

interface LeaveRequest {
  id: number
  employee_id: string
  leave_type_id: number
  start_date: string
  end_date: string
  days_requested: number
  status: string
  reason: string | null
  created_at: string
}

interface Employee {
  first_name: string
  last_name: string
}

interface LeaveType {
  name: string
}

const LEAVE_TYPE_KEY_MAP: Record<string, string> = {
  'Annual Leave': 'my_leave.annual_leave',
  'Sick Leave': 'my_leave.sick_leave',
  'Compassionate Leave': 'my_leave.compassionate_leave',
  'Parental Leave': 'my_leave.parental_leave',
  'Jury Duty': 'my_leave.jury_duty',
  'Bereavement': 'my_leave.bereavement',
  'Exam Leave': 'my_leave.exam_leave',
  'Carers Leave': 'my_leave.carers_leave',
  'Career Break': 'my_leave.career_break',
  'Lieu Days': 'my_leave.lieu_days',
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00')
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

function formatDateTime(dateStr: string) {
  const d = new Date(dateStr)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function LeaveDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t, tStatus } = useLanguage()
  const [request, setRequest] = useState<LeaveRequest | null>(null)
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [leaveType, setLeaveType] = useState<LeaveType | null>(null)
  const [loading, setLoading] = useState(true)

  function translateLeaveType(name: string): string {
    return LEAVE_TYPE_KEY_MAP[name] ? t(LEAVE_TYPE_KEY_MAP[name]) : name
  }

  const fetchData = useCallback(async () => {
    if (!id) return
    setLoading(true)
    const { data: req } = await supabase
      .from('leave_requests')
      .select('id, employee_id, leave_type_id, start_date, end_date, days_requested, status, reason, created_at')
      .eq('id', id)
      .single()

    if (req) {
      const r = req as LeaveRequest
      setRequest(r)
      const [empRes, typeRes] = await Promise.all([
        supabase.from('employees').select('first_name, last_name').eq('id', r.employee_id).single(),
        supabase.from('leave_types').select('name').eq('id', r.leave_type_id).single(),
      ])
      if (empRes.data) setEmployee(empRes.data as Employee)
      if (typeRes.data) setLeaveType(typeRes.data as LeaveType)
    }
    setLoading(false)
  }, [id])

  useEffect(() => { fetchData() }, [fetchData])

  if (loading) return <div className="feature-page"><p className="claims-empty">{t('common.loading')}</p></div>
  if (!request) return <div className="feature-page"><p className="claims-empty">{t('leave_detail.not_found')}</p></div>

  const empName = employee ? `${employee.first_name} ${employee.last_name}` : ''
  const empInitials = employee ? `${employee.first_name[0]}${employee.last_name[0]}` : ''
  const typeName = leaveType?.name || 'Leave'

  return (
    <div className="feature-page leave-detail-page">
      <header className="leave-detail-header">
        <div className="leave-detail-avatar-icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#3d6b99" strokeWidth="1.5">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </div>
        <div className="leave-detail-header-center">
          <h1 className="leave-detail-title">{t('leave_detail.title')} <span className="leave-detail-title-accent">{t('leave_detail.title_accent')}</span></h1>
          <p className="leave-detail-subtitle">{t('leave_detail.subtitle')}</p>
        </div>
        <button className="leave-detail-back" onClick={() => navigate('/leave/history')}>
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
            <circle cx="18" cy="18" r="17" stroke="#43a047" strokeWidth="2" />
            <path d="M21 12l-6 6 6 6" stroke="#43a047" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </header>

      <div className="leave-detail-card">
        <div className="leave-detail-emp-row">
          <div className="leave-detail-emp-avatar">{empInitials}</div>
          <div className="leave-detail-emp-info">
            <span className="leave-detail-emp-name">{empName}</span>
            <span className="leave-detail-emp-ref">{t('leave_detail.request_id')} &nbsp; {request.id}</span>
          </div>
          <span className={`leave-detail-badge status-${request.status}`}>
            {tStatus(request.status)}
          </span>
        </div>

        <div className="leave-detail-rows">
          <div className="leave-detail-row">
            <span className="leave-detail-label">{t('leave_detail.leave_type')}</span>
            <span className="leave-detail-value">{translateLeaveType(typeName)}</span>
          </div>
          <div className="leave-detail-row">
            <span className="leave-detail-label">{t('leave_detail.from')}</span>
            <span className="leave-detail-value">{formatDate(request.start_date)}</span>
          </div>
          <div className="leave-detail-row">
            <span className="leave-detail-label">{t('leave_detail.to')}</span>
            <span className="leave-detail-value">{formatDate(request.end_date)}</span>
          </div>
          <div className="leave-detail-row">
            <span className="leave-detail-label">{t('leave_detail.days_off')}</span>
            <span className="leave-detail-value">{request.days_requested}</span>
          </div>
          <div className="leave-detail-row leave-detail-desc-header">
            <span className="leave-detail-label">{t('leave_detail.description')}</span>
          </div>
          <div className="leave-detail-desc-body">
            {request.reason || ''}
          </div>
          <div className="leave-detail-row">
            <span className="leave-detail-label">{t('leave_detail.approval_date')}</span>
            <span className="leave-detail-value">{formatDateTime(request.created_at)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
