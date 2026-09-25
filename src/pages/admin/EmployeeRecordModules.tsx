import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useFeatures } from '../../context/FeatureContext'
import { useAuth } from '../../context/AuthContext'

type Module = 'overview' | 'timeoff' | 'assets' | 'benefits' | 'dependents' | 'education' | 'grievances' | 'performance' | 'elearning' | 'onboarding' | 'expenses' | 'timesheets' | 'documents'

interface Employee {
  id: string
  employee_number: string
  first_name: string
  last_name: string
  email: string
  job_title: string | null
  department: string | null
  phone: string | null
  start_date: string
  is_active: boolean
  is_admin: boolean
  avatar_url: string | null
  date_of_birth: string | null
  gender: string | null
  nationality: string | null
  marital_status: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  county: string | null
  postcode: string | null
  country: string | null
  emergency_contact_name: string | null
  emergency_contact_phone: string | null
  emergency_contact_relationship: string | null
  ni_number: string | null
  bank_sort_code: string | null
  bank_account_number: string | null
  bank_account_name: string | null
  probation_end_date: string | null
  notice_period: string | null
  working_pattern: string | null
  weekly_hours: number | null
  location: string | null
  contract_type: string | null
  annual_salary: number | null
  tax_code: string | null
  payroll_id: string | null
  personal_email: string | null
  manager_name: string | null
  manager_email: string | null
  leave_allowance: number | null
  salary_group: string | null
  qualifications: string | null
  religion: string | null
}

interface Props {
  employee: Employee
  companyId: string
  lieuDays: number
  maskValue: (v: string | null, empId: string, field: string) => string
  toggleReveal: (empId: string, field: string) => void
  formatDate: (d: string | null) => string
}

const MODULES: { key: Module; label: string; icon: string }[] = [
  { key: 'overview', label: 'Overview', icon: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2|M12 7 4' },
  { key: 'timeoff', label: 'Time Off', icon: 'M19 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z|M16 2v4|M8 2v4|M3 10h18' },
  { key: 'assets', label: 'Assets', icon: 'M20 7h-9|M14 17H5|M17 17h0|M7 7h0|M7 12h10' },
  { key: 'benefits', label: 'Benefits & Subscriptions', icon: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' },
  { key: 'dependents', label: 'Dependents', icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2|M9 7 4|M23 21v-2a4 4 0 0 0-3-3.87|M16 3.13a4 4 0 0 1 0 7.75' },
  { key: 'education', label: 'Education & Skills', icon: 'M22 10v6M2 10l10-5 10 5-10 5z|M6 12v5c0 1 2 3 6 3s6-2 6-3v-5' },
  { key: 'grievances', label: 'Grievances', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z|M14 2v6h6|M16 13H8|M16 17H8|M10 9H8' },
  { key: 'performance', label: 'Performance & Goals', icon: 'M22 11.08V12a10 10 0 1 1-5.93-9.14|M22 4L12 14.01l-3-3' },
  { key: 'elearning', label: 'E-Learning', icon: 'M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z|M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z' },
  { key: 'onboarding', label: 'Onboarding', icon: 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2|M9 12l2 2 4-4|M15 2H9v2h6V2z' },
  { key: 'expenses', label: 'Expenses', icon: 'M12 1v22|M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6' },
  { key: 'timesheets', label: 'Timesheets', icon: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z|M12 6v6l4 2' },
  { key: 'documents', label: 'Documents', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z|M14 2v6h6|M12 18v-6|M9 15h6' },
]

const DOC_CATEGORIES: { key: string; label: string; expiryTracking?: boolean }[] = [
  { key: 'right_to_work', label: 'Right to Work & Identity', expiryTracking: true },
  { key: 'contracts', label: 'Contracts & Salary Terms' },
  { key: 'absence', label: 'Absence & Fit Notes' },
  { key: 'performance', label: 'Performance & Training' },
  { key: 'employee_relations', label: 'Employee Relations & Disciplinary' },
  { key: 'offboarding', label: 'Offboarding & Exit Records' },
]

const ACCEPTED_FILE_TYPES = '.pdf,.jpg,.jpeg,.png,.gif,.doc,.docx,.txt,.rtf,.odt,.xls,.xlsx,.csv'
const ACCEPTED_MIME_DISPLAY = 'PDF, JPEG, PNG, GIF, Word (.doc/.docx), Text (.txt/.rtf), OpenDocument (.odt), Excel (.xls/.xlsx), CSV'
const MAX_FILE_SIZE_MB = 10

function ModuleIcon({ icon }: { icon: string }) {
  const parts = icon.split('|')
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {parts.map((p, i) => {
        const trimmed = p.trim()
        if (trimmed.match(/^M\d+ \d+ \d+$/)) {
          const [, cx, cy, r] = trimmed.match(/^M(\d+) (\d+) (\d+)$/)!
          return <circle key={i} cx={cx} cy={cy} r={r} />
        }
        return <path key={i} d={trimmed} />
      })}
    </svg>
  )
}

function fmtUK(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  approved: { bg: '#e8f5e9', color: '#2e7d32' },
  pending: { bg: '#fff3e0', color: '#e65100' },
  rejected: { bg: '#ffebee', color: '#c62828' },
  cancelled: { bg: '#f5f5f5', color: '#666' },
  submitted: { bg: '#e3f2fd', color: '#1565c0' },
  active: { bg: '#e8f5e9', color: '#2e7d32' },
  completed: { bg: '#e8f5e9', color: '#2e7d32' },
  on_hold: { bg: '#f5f5f5', color: '#666' },
  edited: { bg: '#fff3e0', color: '#e65100' },
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_COLORS[status.toLowerCase()] || { bg: '#f5f5f5', color: '#666' }
  return <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, fontWeight: 600, background: s.bg, color: s.color }}>{status.charAt(0).toUpperCase() + status.slice(1)}</span>
}

export default function EmployeeRecordModules({ employee, companyId, lieuDays, maskValue, toggleReveal, formatDate }: Props) {
  const { features } = useFeatures()
  const { employeeName } = useAuth()
  const [activeModule, setActiveModule] = useState<Module>('overview')
  const [moduleData, setModuleData] = useState<Record<string, any>>({})
  const [loadingModule, setLoadingModule] = useState(false)
  const [docUploading, setDocUploading] = useState(false)
  const [docCategory, setDocCategory] = useState(DOC_CATEGORIES[0].key)
  const [docExpiry, setDocExpiry] = useState('')
  const [docNotes, setDocNotes] = useState('')
  const [docError, setDocError] = useState('')
  const [docDeleting, setDocDeleting] = useState<string | null>(null)
  const [expandedDocCat, setExpandedDocCat] = useState<string | null>(null)
  const [docVisibleToEmp, setDocVisibleToEmp] = useState(false)
  const docFileRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setActiveModule('overview'); setModuleData({}) }, [employee.id])

  useEffect(() => {
    if (activeModule === 'overview') return
    const cacheKey = `${employee.id}:${activeModule}`
    if (moduleData[cacheKey]) return
    loadModuleData(activeModule, cacheKey)
  }, [activeModule, employee.id])

  async function loadModuleData(mod: Module, cacheKey: string) {
    setLoadingModule(true)
    let data: any = null

    switch (mod) {
      case 'timeoff': {
        const [{ data: requests }, { data: balances }] = await Promise.all([
          supabase.from('leave_requests').select('*, leave_type:leave_types(name)').eq('employee_id', employee.id).eq('company_id', companyId).order('start_date', { ascending: false }).limit(50),
          supabase.from('leave_balances').select('*, leave_type:leave_types(name)').eq('employee_id', employee.id).eq('company_id', companyId).eq('year', new Date().getFullYear()),
        ])
        data = { requests: requests || [], balances: balances || [] }
        break
      }
      case 'assets': {
        const { data: assets } = await supabase.from('assets').select('*').eq('company_id', companyId).eq('assigned_to', employee.id).order('created_at', { ascending: false })
        data = { assets: assets || [] }
        break
      }
      case 'benefits': {
        const { data: subs } = await supabase.from('employee_benefits').select('*, benefit_type:benefit_types(title, monthly_cost, lock_period)').eq('employee_id', employee.id).eq('company_id', companyId).order('enrolled_at', { ascending: false })
        data = { subscriptions: subs || [] }
        break
      }
      case 'education': {
        const [{ data: skills }, { data: certs }, { data: langs }, { data: aspirations }] = await Promise.all([
          supabase.from('employee_skills').select('id, skill_id, proficiency, status, created_at, skill:skills(name)').eq('employee_id', employee.id).eq('company_id', companyId).order('created_at', { ascending: false }),
          supabase.from('employee_certifications').select('id, name, issuing_body, issue_date, expiry_date, credential_id, status').eq('employee_id', employee.id).eq('company_id', companyId).order('issue_date', { ascending: false }),
          supabase.from('employee_languages').select('id, language, proficiency').eq('employee_id', employee.id).eq('company_id', companyId).order('language'),
          supabase.from('employee_career_aspirations').select('target_role, target_department, timeframe, notes').eq('employee_id', employee.id).eq('company_id', companyId).maybeSingle(),
        ])
        data = { skills: skills || [], qualifications: employee.qualifications, certifications: certs || [], languages: langs || [], aspirations: aspirations || null }
        break
      }
      case 'performance': {
        const [{ data: reviews }, { data: goals }] = await Promise.all([
          supabase.from('performance_reviews').select('*').eq('employee_id', employee.id).eq('company_id', companyId).order('created_at', { ascending: false }).limit(20),
          supabase.from('goals').select('*').eq('employee_id', employee.id).eq('company_id', companyId).order('created_at', { ascending: false }).limit(30),
        ])
        data = { reviews: reviews || [], goals: goals || [] }
        break
      }
      case 'elearning': {
        const [{ data: enrolments }, { data: courses }] = await Promise.all([
          supabase.from('course_enrolments').select('*, course:elearning_courses(title, category, type, duration, required)').eq('employee_id', employee.id).eq('company_id', companyId).order('enrolled_at', { ascending: false }),
          supabase.from('elearning_courses').select('id, title, category, required').eq('company_id', companyId).eq('is_active', true),
        ])
        const completedIds = new Set((enrolments || []).filter((e: any) => e.completed_at).map((e: any) => e.course_id))
        const enrolledIds = new Set((enrolments || []).map((e: any) => e.course_id))
        const outstanding = (courses || []).filter((c: any) => c.required && !completedIds.has(c.id))
        data = { enrolments: enrolments || [], outstanding, enrolledIds }
        break
      }
      case 'onboarding': {
        const { data: record } = await supabase.from('onboarding').select('*').eq('user_email', employee.email).eq('company_id', companyId).maybeSingle()
        data = { record }
        break
      }
      case 'expenses': {
        const { data: claims } = await supabase.from('expense_claims').select('*').eq('employee_id', employee.id).eq('company_id', companyId).order('submitted_at', { ascending: false }).limit(50)
        data = { claims: claims || [] }
        break
      }
      case 'timesheets': {
        const { data: entries } = await supabase.from('timesheets').select('*, project:customer_projects!timesheets_project_id_fkey(name, customer_name)').eq('employee_id', employee.id).eq('company_id', companyId).order('date', { ascending: false }).limit(100)
        data = { entries: entries || [] }
        break
      }
      case 'documents': {
        const { data: docs } = await supabase.from('employee_documents').select('*').eq('employee_id', employee.id).eq('company_id', companyId).order('created_at', { ascending: false })
        data = { documents: docs || [] }
        break
      }
    }

    if (data) setModuleData(prev => ({ ...prev, [cacheKey]: data }))
    setLoadingModule(false)
  }

  const cacheKey = `${employee.id}:${activeModule}`
  const currentData = moduleData[cacheKey]

  const cardStyle: React.CSSProperties = { background: '#fff', borderRadius: 10, padding: 20, border: '1px solid #e8e8e8' }
  const headingStyle: React.CSSProperties = { margin: '0 0 16px', fontSize: 14, fontWeight: 700, color: '#1565c0' }
  const labelStyle: React.CSSProperties = { color: '#999', fontSize: 11, display: 'block' }
  const emptyStyle: React.CSSProperties = { padding: 32, textAlign: 'center', color: '#999', fontSize: 13 }
  const comingSoonStyle: React.CSSProperties = { ...emptyStyle, background: '#fafafa', borderRadius: 10, border: '1px dashed #ddd' }

  function renderModuleContent() {
    if (activeModule === 'overview') return renderOverview()
    if (activeModule === 'dependents') return <div style={comingSoonStyle}>Dependents tracking is not yet available. This feature is planned for a future release.</div>
    if (activeModule === 'grievances') return <div style={comingSoonStyle}>Grievance management is not yet available. This feature is planned for a future release.</div>
    if (loadingModule && !currentData) return <div style={emptyStyle}>Loading...</div>
    if (!currentData) return <div style={emptyStyle}>No data available</div>

    switch (activeModule) {
      case 'timeoff': return renderTimeOff()
      case 'assets': return renderAssets()
      case 'benefits': return renderBenefits()
      case 'education': return renderEducation()
      case 'performance': return renderPerformance()
      case 'elearning': return renderELearning()
      case 'onboarding': return renderOnboarding()
      case 'expenses': return renderExpenses()
      case 'timesheets': return renderTimesheets()
      case 'documents': return renderDocuments()
      default: return null
    }
  }

  function renderOverview() {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div style={cardStyle}>
          <h4 style={headingStyle}>Personal Details</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 16px', fontSize: 13 }}>
            <div><span style={labelStyle}>Date of Birth</span>{formatDate(employee.date_of_birth)}</div>
            <div><span style={labelStyle}>Gender</span>{employee.gender || '—'}</div>
            <div><span style={labelStyle}>Nationality</span>{employee.nationality || '—'}</div>
            <div><span style={labelStyle}>Marital Status</span>{employee.marital_status || '—'}</div>
            <div><span style={labelStyle}>Religion</span>{employee.religion || '—'}</div>
            <div><span style={labelStyle}>NI Number</span><span onClick={() => toggleReveal(employee.id, 'ni')} style={{ cursor: 'pointer' }} title="Click to reveal">{maskValue(employee.ni_number, employee.id, 'ni')}</span></div>
          </div>
        </div>
        <div style={cardStyle}>
          <h4 style={headingStyle}>Contact Information</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12, fontSize: 13 }}>
            <div><span style={labelStyle}>Work Email</span>{employee.email}</div>
            <div><span style={labelStyle}>Personal Email</span>{employee.personal_email || '—'}</div>
            <div><span style={labelStyle}>Phone</span>{employee.phone || '—'}</div>
          </div>
        </div>
        <div style={cardStyle}>
          <h4 style={headingStyle}>Address</h4>
          <div style={{ fontSize: 13, lineHeight: 1.6 }}>
            {employee.address_line1 || employee.city || employee.postcode ? (
              <>{employee.address_line1 && <div>{employee.address_line1}</div>}{employee.address_line2 && <div>{employee.address_line2}</div>}{employee.city && <div>{employee.city}</div>}{employee.county && <div>{employee.county}</div>}{employee.postcode && <div>{employee.postcode}</div>}{employee.country && <div>{employee.country}</div>}</>
            ) : <span style={{ color: '#999' }}>No address on file</span>}
          </div>
        </div>
        <div style={cardStyle}>
          <h4 style={headingStyle}>Emergency Contact</h4>
          {employee.emergency_contact_name ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12, fontSize: 13 }}>
              <div><span style={labelStyle}>Name</span>{employee.emergency_contact_name}</div>
              <div><span style={labelStyle}>Phone</span>{employee.emergency_contact_phone || '—'}</div>
              <div><span style={labelStyle}>Relationship</span>{employee.emergency_contact_relationship || '—'}</div>
            </div>
          ) : <span style={{ fontSize: 13, color: '#999' }}>No emergency contact on file</span>}
        </div>
        <div style={cardStyle}>
          <h4 style={headingStyle}>Employment</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 16px', fontSize: 13 }}>
            <div><span style={labelStyle}>Working Pattern</span>{employee.working_pattern || '—'}</div>
            <div><span style={labelStyle}>Weekly Hours</span>{employee.weekly_hours ?? '—'}</div>
            <div><span style={labelStyle}>Contract Type</span>{employee.contract_type || '—'}</div>
            <div><span style={labelStyle}>Notice Period</span>{employee.notice_period || '—'}</div>
            <div><span style={labelStyle}>Probation End</span>{formatDate(employee.probation_end_date)}</div>
            <div><span style={labelStyle}>Leave Allowance</span>{employee.leave_allowance ?? 15} days</div>
            <div><span style={labelStyle}>Lieu Days</span>{lieuDays} days</div>
            <div><span style={labelStyle}>Salary Group</span>{employee.salary_group || 'N/A'}</div>
            <div><span style={labelStyle}>Manager Email</span>{employee.manager_email || '—'}</div>
          </div>
        </div>
        <div style={cardStyle}>
          <h4 style={headingStyle}>Payroll & Banking</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 16px', fontSize: 13 }}>
            <div><span style={labelStyle}>Annual Salary</span>{employee.annual_salary ? `£${Number(employee.annual_salary).toLocaleString()}` : '—'}</div>
            <div><span style={labelStyle}>Tax Code</span>{employee.tax_code || '—'}</div>
            <div><span style={labelStyle}>Payroll ID</span>{employee.payroll_id || '—'}</div>
            <div><span style={labelStyle}>Bank Account</span>{employee.bank_account_name || '—'}</div>
            <div><span style={labelStyle}>Sort Code</span><span onClick={() => toggleReveal(employee.id, 'sc')} style={{ cursor: 'pointer' }} title="Click to reveal">{maskValue(employee.bank_sort_code, employee.id, 'sc')}</span></div>
            <div><span style={labelStyle}>Account Number</span><span onClick={() => toggleReveal(employee.id, 'ac')} style={{ cursor: 'pointer' }} title="Click to reveal">{maskValue(employee.bank_account_number, employee.id, 'ac')}</span></div>
          </div>
        </div>
        {employee.qualifications && (
          <div style={{ ...cardStyle, gridColumn: '1 / -1' }}>
            <h4 style={headingStyle}>Qualifications</h4>
            <div style={{ fontSize: 13, whiteSpace: 'pre-line', lineHeight: 1.6 }}>{employee.qualifications}</div>
          </div>
        )}
      </div>
    )
  }

  function renderTimeOff() {
    const { requests, balances } = currentData
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {balances.length > 0 && (
          <div style={cardStyle}>
            <h4 style={headingStyle}>Leave Balances ({new Date().getFullYear()})</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
              {balances.map((b: any) => (
                <div key={b.id} style={{ padding: 12, borderRadius: 8, background: '#f8f9fa', border: '1px solid #eee' }}>
                  <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>{b.leave_type?.name || 'Leave'}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: '#1a1a1a' }}>{b.used ?? 0} <span style={{ fontSize: 12, fontWeight: 400, color: '#999' }}>/ {b.allowance ?? employee.leave_allowance ?? 0} days used</span></div>
                  {(b.lieu_days ?? 0) > 0 && <div style={{ fontSize: 11, color: '#1565c0', marginTop: 4 }}>+{b.lieu_days} lieu days</div>}
                </div>
              ))}
            </div>
          </div>
        )}
        <div style={cardStyle}>
          <h4 style={headingStyle}>Leave History ({requests.length} requests)</h4>
          {requests.length === 0 ? <div style={emptyStyle}>No leave requests found</div> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ borderBottom: '2px solid #e8e8e8' }}>
                <th style={{ textAlign: 'left', padding: '8px 8px 8px 0', fontWeight: 600, color: '#666' }}>Type</th>
                <th style={{ textAlign: 'left', padding: 8, fontWeight: 600, color: '#666' }}>From</th>
                <th style={{ textAlign: 'left', padding: 8, fontWeight: 600, color: '#666' }}>To</th>
                <th style={{ textAlign: 'right', padding: 8, fontWeight: 600, color: '#666' }}>Days</th>
                <th style={{ textAlign: 'left', padding: 8, fontWeight: 600, color: '#666' }}>Status</th>
                <th style={{ textAlign: 'left', padding: 8, fontWeight: 600, color: '#666' }}>Reason</th>
              </tr></thead>
              <tbody>
                {requests.map((r: any) => (
                  <tr key={r.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '8px 8px 8px 0' }}>{r.leave_type?.name || '—'}</td>
                    <td style={{ padding: 8 }}>{fmtUK(r.start_date)}</td>
                    <td style={{ padding: 8 }}>{fmtUK(r.end_date)}</td>
                    <td style={{ padding: 8, textAlign: 'right' }}>{r.days_requested}</td>
                    <td style={{ padding: 8 }}><StatusBadge status={r.status} /></td>
                    <td style={{ padding: 8, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    )
  }

  function renderAssets() {
    if (!features.asset_management) return <div style={comingSoonStyle}>Asset Management is not enabled for this company.</div>
    const { assets } = currentData
    return (
      <div style={cardStyle}>
        <h4 style={headingStyle}>Assigned Assets ({assets.length})</h4>
        {assets.length === 0 ? <div style={emptyStyle}>No assets assigned to this employee</div> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ borderBottom: '2px solid #e8e8e8' }}>
              <th style={{ textAlign: 'left', padding: '8px 8px 8px 0', fontWeight: 600, color: '#666' }}>Asset</th>
              <th style={{ textAlign: 'left', padding: 8, fontWeight: 600, color: '#666' }}>Type</th>
              <th style={{ textAlign: 'left', padding: 8, fontWeight: 600, color: '#666' }}>Brand / Model</th>
              <th style={{ textAlign: 'left', padding: 8, fontWeight: 600, color: '#666' }}>Serial</th>
              <th style={{ textAlign: 'left', padding: 8, fontWeight: 600, color: '#666' }}>Status</th>
            </tr></thead>
            <tbody>
              {assets.map((a: any) => (
                <tr key={a.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '8px 8px 8px 0', fontWeight: 500 }}>{a.asset_name}</td>
                  <td style={{ padding: 8 }}>{a.asset_type}</td>
                  <td style={{ padding: 8 }}>{[a.brand, a.model].filter(Boolean).join(' ') || '—'}</td>
                  <td style={{ padding: 8, fontFamily: 'monospace', fontSize: 12 }}>{a.serial_number || '—'}</td>
                  <td style={{ padding: 8 }}><StatusBadge status={a.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    )
  }

  function renderBenefits() {
    if (!features.benefits) return <div style={comingSoonStyle}>Benefits & Subscriptions is not enabled for this company.</div>
    const { subscriptions } = currentData
    return (
      <div style={cardStyle}>
        <h4 style={headingStyle}>Benefit Enrolments ({subscriptions.length})</h4>
        {subscriptions.length === 0 ? <div style={emptyStyle}>No benefit enrolments found</div> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ borderBottom: '2px solid #e8e8e8' }}>
              <th style={{ textAlign: 'left', padding: '8px 8px 8px 0', fontWeight: 600, color: '#666' }}>Benefit</th>
              <th style={{ textAlign: 'left', padding: 8, fontWeight: 600, color: '#666' }}>Enrolled</th>
              <th style={{ textAlign: 'right', padding: 8, fontWeight: 600, color: '#666' }}>Monthly Cost</th>
              <th style={{ textAlign: 'left', padding: 8, fontWeight: 600, color: '#666' }}>Lock Period</th>
            </tr></thead>
            <tbody>
              {subscriptions.map((s: any) => (
                <tr key={s.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '8px 8px 8px 0', fontWeight: 500 }}>{s.benefit_type?.title || '—'}</td>
                  <td style={{ padding: 8 }}>{fmtUK(s.enrolled_at)}</td>
                  <td style={{ padding: 8, textAlign: 'right' }}>{s.benefit_type?.monthly_cost ? `£${Number(s.benefit_type.monthly_cost).toFixed(2)}` : '—'}</td>
                  <td style={{ padding: 8 }}>{s.benefit_type?.lock_period === 'none' ? 'None' : s.benefit_type?.lock_period || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    )
  }

  function renderEducation() {
    const { skills, qualifications, certifications, languages, aspirations } = currentData
    const profLabels = ['', 'Foundational', 'Developing', 'Proficient', 'Advanced', 'Expert']
    const langProfLabels: Record<string, string> = { basic: 'Basic', conversational: 'Conversational', professional: 'Professional', fluent: 'Fluent', native: 'Native' }
    const timeframeLabels: Record<string, string> = { '6_months': '6 months', '1_year': '1 year', '2_years': '2 years', '3_plus_years': '3+ years' }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {qualifications && (
          <div style={cardStyle}>
            <h4 style={headingStyle}>Qualifications</h4>
            <div style={{ fontSize: 13, whiteSpace: 'pre-line', lineHeight: 1.6 }}>{qualifications}</div>
          </div>
        )}
        <div style={cardStyle}>
          <h4 style={headingStyle}>Skills ({skills.length})</h4>
          {skills.length === 0 ? <div style={emptyStyle}>No skills recorded</div> : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {skills.map((s: any) => {
                const statusColors: Record<string, { bg: string; color: string }> = {
                  validated: { bg: '#e0e7ff', color: '#3730a3' },
                  pending_validation: { bg: '#fff3e0', color: '#e65100' },
                  self_declared: { bg: '#f3e5f5', color: '#7b1fa2' },
                }
                const sc = statusColors[s.status] || statusColors.self_declared
                const skillName = s.skill?.name || 'Unknown'
                return (
                  <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 16, fontSize: 12, background: sc.bg, color: sc.color, fontWeight: 500 }}>
                    {skillName}
                    <span style={{ fontSize: 10, opacity: 0.7 }}>({profLabels[s.proficiency] || '—'})</span>
                    {s.status !== 'validated' && <span style={{ fontSize: 9, textTransform: 'uppercase', opacity: 0.6 }}>{s.status.replace('_', ' ')}</span>}
                  </span>
                )
              })}
            </div>
          )}
        </div>
        <div style={cardStyle}>
          <h4 style={headingStyle}>Certifications ({certifications.length})</h4>
          {certifications.length === 0 ? <div style={emptyStyle}>No certifications recorded</div> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {certifications.map((c: any) => {
                const statusColors: Record<string, { bg: string; color: string }> = {
                  active: { bg: '#dcfce7', color: '#16a34a' },
                  expired: { bg: '#fee2e2', color: '#dc2626' },
                  revoked: { bg: '#f3f4f6', color: '#6b7280' },
                }
                const sc = statusColors[c.status] || statusColors.active
                return (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '8px 12px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fafafa' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{c.name}</div>
                      <div style={{ fontSize: 11, color: '#888' }}>{c.issuing_body}{c.credential_id ? ` — ${c.credential_id}` : ''}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      <span style={{ fontSize: 11, color: '#666' }}>
                        {new Date(c.issue_date).toLocaleDateString('en-GB')}
                        {c.expiry_date ? ` — ${new Date(c.expiry_date).toLocaleDateString('en-GB')}` : ''}
                      </span>
                      <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: sc.bg, color: sc.color, textTransform: 'capitalize' }}>{c.status}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
        <div style={cardStyle}>
          <h4 style={headingStyle}>Languages ({languages.length})</h4>
          {languages.length === 0 ? <div style={emptyStyle}>No languages recorded</div> : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {languages.map((l: any) => (
                <span key={l.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 16, fontSize: 12, background: '#dbeafe', color: '#1e40af', fontWeight: 500 }}>
                  {l.language}
                  <span style={{ fontSize: 10, opacity: 0.7 }}>({langProfLabels[l.proficiency] || l.proficiency})</span>
                </span>
              ))}
            </div>
          )}
        </div>
        <div style={cardStyle}>
          <h4 style={headingStyle}>Career Aspirations</h4>
          {!aspirations ? <div style={emptyStyle}>No career aspirations recorded</div> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
              {aspirations.target_role && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <span style={{ fontWeight: 600, color: '#555', minWidth: 120 }}>Target Role</span>
                  <span>{aspirations.target_role}</span>
                </div>
              )}
              {aspirations.target_department && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <span style={{ fontWeight: 600, color: '#555', minWidth: 120 }}>Department</span>
                  <span>{aspirations.target_department}</span>
                </div>
              )}
              {aspirations.timeframe && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <span style={{ fontWeight: 600, color: '#555', minWidth: 120 }}>Timeframe</span>
                  <span>{timeframeLabels[aspirations.timeframe] || aspirations.timeframe}</span>
                </div>
              )}
              {aspirations.notes && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <span style={{ fontWeight: 600, color: '#555', minWidth: 120 }}>Notes</span>
                  <span style={{ whiteSpace: 'pre-line', lineHeight: 1.5 }}>{aspirations.notes}</span>
                </div>
              )}
              {!aspirations.target_role && !aspirations.target_department && !aspirations.timeframe && !aspirations.notes && (
                <div style={emptyStyle}>Aspirations submitted but no details provided</div>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  function renderPerformance() {
    const { reviews, goals } = currentData
    const goalStatuses: Record<string, { label: string; bg: string; color: string }> = {
      active: { label: 'Active', bg: '#dbeafe', color: '#2563eb' },
      completed: { label: 'Completed', bg: '#dcfce7', color: '#16a34a' },
      edited: { label: 'Edited', bg: '#fef3c7', color: '#d97706' },
      on_hold: { label: 'On Hold', bg: '#f3f4f6', color: '#6b7280' },
      cancelled: { label: 'Cancelled', bg: '#fee2e2', color: '#dc2626' },
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={cardStyle}>
          <h4 style={headingStyle}>Performance Reviews ({reviews.length})</h4>
          {reviews.length === 0 ? <div style={emptyStyle}>No performance reviews found</div> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ borderBottom: '2px solid #e8e8e8' }}>
                <th style={{ textAlign: 'left', padding: '8px 8px 8px 0', fontWeight: 600, color: '#666' }}>Date</th>
                <th style={{ textAlign: 'left', padding: 8, fontWeight: 600, color: '#666' }}>Type</th>
                <th style={{ textAlign: 'left', padding: 8, fontWeight: 600, color: '#666' }}>Status</th>
                <th style={{ textAlign: 'left', padding: 8, fontWeight: 600, color: '#666' }}>Rating</th>
              </tr></thead>
              <tbody>
                {reviews.map((r: any) => (
                  <tr key={r.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '8px 8px 8px 0' }}>{fmtUK(r.review_date || r.created_at)}</td>
                    <td style={{ padding: 8 }}>{r.review_type || r.type || '—'}</td>
                    <td style={{ padding: 8 }}><StatusBadge status={r.status || 'completed'} /></td>
                    <td style={{ padding: 8 }}>{r.overall_rating || r.rating || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div style={cardStyle}>
          <h4 style={headingStyle}>Goals ({goals.length})</h4>
          {goals.length === 0 ? <div style={emptyStyle}>No goals set</div> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {goals.map((g: any) => {
                const gs = goalStatuses[g.status] || goalStatuses.active
                const progress = g.status === 'completed' ? 100 : g.grade ? Math.round(g.grade) : 0
                return (
                  <div key={g.id} style={{ padding: 14, borderRadius: 8, border: '1px solid #eee', background: '#fafafa' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 8 }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a' }}>{g.title}</div>
                        {g.description && <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>{g.description}</div>}
                      </div>
                      <span style={{ flexShrink: 0, fontSize: 11, padding: '2px 8px', borderRadius: 4, fontWeight: 600, background: gs.bg, color: gs.color }}>{gs.label}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: '#888' }}>
                      <span>Start: {fmtUK(g.start_date)}</span>
                      {g.due_date && <span>Due: {fmtUK(g.due_date)}</span>}
                      {g.completed_at && <span>Completed: {fmtUK(g.completed_at)}</span>}
                    </div>
                    <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, height: 6, borderRadius: 3, background: '#e5e7eb' }}>
                        <div style={{ height: '100%', borderRadius: 3, background: progress >= 100 ? '#16a34a' : '#3b82f6', width: `${Math.min(progress, 100)}%`, transition: 'width 0.3s' }} />
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#666', minWidth: 32 }}>{progress}%</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    )
  }

  function renderELearning() {
    if (!features.elearning) return <div style={comingSoonStyle}>E-Learning is not enabled for this company.</div>
    const { enrolments, outstanding } = currentData
    const completed = enrolments.filter((e: any) => e.completed_at)
    const inProgress = enrolments.filter((e: any) => !e.completed_at)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Summary tiles */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          <div style={{ padding: 16, borderRadius: 8, background: '#e8f5e9', textAlign: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#2e7d32' }}>{completed.length}</div>
            <div style={{ fontSize: 12, color: '#388e3c' }}>Completed</div>
          </div>
          <div style={{ padding: 16, borderRadius: 8, background: '#fff3e0', textAlign: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#e65100' }}>{inProgress.length}</div>
            <div style={{ fontSize: 12, color: '#ef6c00' }}>In Progress</div>
          </div>
          <div style={{ padding: 16, borderRadius: 8, background: '#ffebee', textAlign: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#c62828' }}>{outstanding.length}</div>
            <div style={{ fontSize: 12, color: '#d32f2f' }}>Outstanding Required</div>
          </div>
        </div>

        {outstanding.length > 0 && (
          <div style={{ ...cardStyle, borderColor: '#ffcdd2' }}>
            <h4 style={{ ...headingStyle, color: '#c62828' }}>Outstanding Required Courses</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {outstanding.map((c: any) => (
                <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderRadius: 6, background: '#fff5f5', border: '1px solid #ffcdd2' }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{c.title}</span>
                  <span style={{ fontSize: 11, color: '#999' }}>{c.category || '—'}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={cardStyle}>
          <h4 style={headingStyle}>Course History ({enrolments.length})</h4>
          {enrolments.length === 0 ? <div style={emptyStyle}>No course enrolments found</div> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ borderBottom: '2px solid #e8e8e8' }}>
                <th style={{ textAlign: 'left', padding: '8px 8px 8px 0', fontWeight: 600, color: '#666' }}>Course</th>
                <th style={{ textAlign: 'left', padding: 8, fontWeight: 600, color: '#666' }}>Category</th>
                <th style={{ textAlign: 'left', padding: 8, fontWeight: 600, color: '#666' }}>Enrolled</th>
                <th style={{ textAlign: 'left', padding: 8, fontWeight: 600, color: '#666' }}>Completed</th>
                <th style={{ textAlign: 'left', padding: 8, fontWeight: 600, color: '#666' }}>Required</th>
              </tr></thead>
              <tbody>
                {enrolments.map((e: any) => (
                  <tr key={e.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '8px 8px 8px 0', fontWeight: 500 }}>{e.course?.title || '—'}</td>
                    <td style={{ padding: 8 }}>{e.course?.category || '—'}</td>
                    <td style={{ padding: 8 }}>{fmtUK(e.enrolled_at)}</td>
                    <td style={{ padding: 8 }}>{e.completed_at ? fmtUK(e.completed_at) : <span style={{ color: '#e65100', fontWeight: 600 }}>In progress</span>}</td>
                    <td style={{ padding: 8 }}>{e.course?.required ? 'Yes' : 'No'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    )
  }

  function renderOnboarding() {
    const { record } = currentData
    if (!record) return <div style={emptyStyle}>No onboarding record found for this employee</div>
    const checklist = [
      { key: 'is_complete', label: 'Initial Setup Complete' },
      { key: 'first_day', label: 'First Day Completed' },
      { key: 'first_week', label: 'First Week Completed' },
      { key: 'first_month', label: 'First Month Completed' },
      { key: 'elearning', label: 'E-Learning Completed' },
    ]
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={cardStyle}>
          <h4 style={headingStyle}>Onboarding Record</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 16px', fontSize: 13 }}>
            <div><span style={labelStyle}>Onboarded By</span>{record.manager || '—'}</div>
            <div><span style={labelStyle}>Manager Email</span>{record.manager_email || '—'}</div>
            <div><span style={labelStyle}>Date Created</span>{fmtUK(record.created_at)}</div>
            <div><span style={labelStyle}>Start Date</span>{fmtUK(record.start_date)}</div>
            <div><span style={labelStyle}>Status</span><StatusBadge status={record.status || 'pending'} /></div>
            <div><span style={labelStyle}>Location</span>{record.location || '—'}</div>
            <div><span style={labelStyle}>Equipment Order</span>{record.equipment_order || '—'}</div>
            <div><span style={labelStyle}>Contract Type</span>{record.contract_type || '—'}</div>
          </div>
        </div>
        <div style={cardStyle}>
          <h4 style={headingStyle}>Onboarding Checklist</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {checklist.map(item => {
              const done = record[item.key] === true
              return (
                <div key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 6, background: done ? '#f0fdf4' : '#fefce8', border: `1px solid ${done ? '#bbf7d0' : '#fde68a'}` }}>
                  {done ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                  )}
                  <span style={{ fontSize: 13, fontWeight: 500, color: done ? '#166534' : '#92400e' }}>{item.label}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  function renderExpenses() {
    if (!features.expenses) return <div style={comingSoonStyle}>Expenses is not enabled for this company.</div>
    const { claims } = currentData
    const totalApproved = claims.filter((c: any) => c.status === 'approved').reduce((sum: number, c: any) => sum + (Number(c.amount) || 0), 0)
    const totalPending = claims.filter((c: any) => c.status === 'pending').reduce((sum: number, c: any) => sum + (Number(c.amount) || 0), 0)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          <div style={{ padding: 16, borderRadius: 8, background: '#f8f9fa', border: '1px solid #eee', textAlign: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#1a1a1a' }}>{claims.length}</div>
            <div style={{ fontSize: 12, color: '#666' }}>Total Claims</div>
          </div>
          <div style={{ padding: 16, borderRadius: 8, background: '#e8f5e9', textAlign: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#2e7d32' }}>£{totalApproved.toFixed(2)}</div>
            <div style={{ fontSize: 12, color: '#388e3c' }}>Approved</div>
          </div>
          <div style={{ padding: 16, borderRadius: 8, background: '#fff3e0', textAlign: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#e65100' }}>£{totalPending.toFixed(2)}</div>
            <div style={{ fontSize: 12, color: '#ef6c00' }}>Pending</div>
          </div>
        </div>
        <div style={cardStyle}>
          <h4 style={headingStyle}>Expense Claims</h4>
          {claims.length === 0 ? <div style={emptyStyle}>No expense claims found</div> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ borderBottom: '2px solid #e8e8e8' }}>
                <th style={{ textAlign: 'left', padding: '8px 8px 8px 0', fontWeight: 600, color: '#666' }}>Submitted</th>
                <th style={{ textAlign: 'left', padding: 8, fontWeight: 600, color: '#666' }}>Description</th>
                <th style={{ textAlign: 'right', padding: 8, fontWeight: 600, color: '#666' }}>Amount</th>
                <th style={{ textAlign: 'left', padding: 8, fontWeight: 600, color: '#666' }}>Status</th>
              </tr></thead>
              <tbody>
                {claims.map((c: any) => (
                  <tr key={c.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '8px 8px 8px 0' }}>{fmtUK(c.submitted_at || c.created_at)}</td>
                    <td style={{ padding: 8, maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.description || c.title || '—'}</td>
                    <td style={{ padding: 8, textAlign: 'right', fontWeight: 500 }}>£{Number(c.amount || 0).toFixed(2)}</td>
                    <td style={{ padding: 8 }}><StatusBadge status={c.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    )
  }

  function renderTimesheets() {
    if (!features.timesheets) return <div style={comingSoonStyle}>Timesheets is not enabled for this company.</div>
    const { entries } = currentData
    const totalHours = entries.reduce((sum: number, e: any) => sum + (Number(e.hours) || 0), 0)
    const pendingEntries = entries.filter((e: any) => e.status === 'pending' || e.status === 'submitted')
    const approvedEntries = entries.filter((e: any) => e.status === 'approved')

    const lateSubmissions = entries.filter((e: any) => {
      if (!e.date || !e.created_at) return false
      const entryDate = new Date(e.date)
      const createdDate = new Date(e.created_at)
      const diffDays = (createdDate.getTime() - entryDate.getTime()) / (1000 * 60 * 60 * 24)
      return diffDays > 7
    })

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <div style={{ padding: 16, borderRadius: 8, background: '#f8f9fa', border: '1px solid #eee', textAlign: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#1a1a1a' }}>{totalHours.toFixed(1)}</div>
            <div style={{ fontSize: 12, color: '#666' }}>Total Hours</div>
          </div>
          <div style={{ padding: 16, borderRadius: 8, background: '#e8f5e9', textAlign: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#2e7d32' }}>{approvedEntries.length}</div>
            <div style={{ fontSize: 12, color: '#388e3c' }}>Approved</div>
          </div>
          <div style={{ padding: 16, borderRadius: 8, background: '#fff3e0', textAlign: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#e65100' }}>{pendingEntries.length}</div>
            <div style={{ fontSize: 12, color: '#ef6c00' }}>Outstanding</div>
          </div>
          <div style={{ padding: 16, borderRadius: 8, background: lateSubmissions.length > 0 ? '#ffebee' : '#f8f9fa', textAlign: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: lateSubmissions.length > 0 ? '#c62828' : '#666' }}>{lateSubmissions.length}</div>
            <div style={{ fontSize: 12, color: lateSubmissions.length > 0 ? '#d32f2f' : '#666' }}>Late Submissions</div>
          </div>
        </div>
        <div style={cardStyle}>
          <h4 style={headingStyle}>Timesheet History (last {entries.length} entries)</h4>
          {entries.length === 0 ? <div style={emptyStyle}>No timesheet entries found</div> : (
            <div style={{ maxHeight: 400, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr style={{ borderBottom: '2px solid #e8e8e8', position: 'sticky', top: 0, background: '#fff' }}>
                  <th style={{ textAlign: 'left', padding: '8px 8px 8px 0', fontWeight: 600, color: '#666' }}>Date</th>
                  <th style={{ textAlign: 'left', padding: 8, fontWeight: 600, color: '#666' }}>Project</th>
                  <th style={{ textAlign: 'left', padding: 8, fontWeight: 600, color: '#666' }}>Location</th>
                  <th style={{ textAlign: 'left', padding: 8, fontWeight: 600, color: '#666' }}>Time</th>
                  <th style={{ textAlign: 'right', padding: 8, fontWeight: 600, color: '#666' }}>Hours</th>
                  <th style={{ textAlign: 'left', padding: 8, fontWeight: 600, color: '#666' }}>Status</th>
                </tr></thead>
                <tbody>
                  {entries.map((e: any) => (
                    <tr key={e.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={{ padding: '8px 8px 8px 0' }}>{fmtUK(e.date)}</td>
                      <td style={{ padding: 8 }}>{e.project?.name || e.customer || '—'}</td>
                      <td style={{ padding: 8 }}>{e.location || '—'}</td>
                      <td style={{ padding: 8 }}>{e.start_time || '—'} – {e.end_time || '—'}</td>
                      <td style={{ padding: 8, textAlign: 'right', fontWeight: 500 }}>{Number(e.hours).toFixed(1)}</td>
                      <td style={{ padding: 8 }}><StatusBadge status={e.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    )
  }

  async function uploadDocument(file: File) {
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      setDocError(`File too large. Maximum size is ${MAX_FILE_SIZE_MB}MB.`)
      return
    }
    setDocUploading(true)
    setDocError('')

    const ext = file.name.split('.').pop()?.toLowerCase() || ''
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const storagePath = `${companyId}/${employee.id}/${Date.now()}_${safeName}`

    const { error: uploadErr } = await supabase.storage
      .from('employee-documents')
      .upload(storagePath, file)

    if (uploadErr) {
      setDocError(uploadErr.message)
      setDocUploading(false)
      return
    }

    const { data: userData } = await supabase.auth.getUser()

    const { data: insertData, error: insertErr } = await supabase.from('employee_documents').insert({
      employee_id: employee.id,
      company_id: companyId,
      category: docCategory,
      file_name: file.name,
      file_path: storagePath,
      file_type: ext,
      file_size: file.size,
      expiry_date: docExpiry || null,
      notes: docNotes.trim() || null,
      uploaded_by: userData?.user?.id || null,
      uploaded_by_name: employeeName || null,
      scan_status: 'pending',
      visible_to_employee: docVisibleToEmp,
    }).select('id').single()

    if (insertErr) {
      setDocError(insertErr.message)
      setDocUploading(false)
      return
    }

    setDocExpiry('')
    setDocNotes('')
    setDocVisibleToEmp(false)
    if (docFileRef.current) docFileRef.current.value = ''

    const cacheKey = `${employee.id}:documents`
    setModuleData(prev => { const copy = { ...prev }; delete copy[cacheKey]; return copy })
    await loadModuleData('documents', cacheKey)
    setDocUploading(false)

    if (insertData?.id) {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.access_token) {
        fetch(`${(supabase as any).supabaseUrl}/functions/v1/scan-document`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
            apikey: (supabase as any).supabaseKey,
          },
          body: JSON.stringify({ storagePath, documentId: insertData.id }),
        }).then(async () => {
          setModuleData(prev => { const copy = { ...prev }; delete copy[cacheKey]; return copy })
          loadModuleData('documents', cacheKey)
        }).catch(() => {})
      }
    }
  }

  async function deleteDocument(doc: any) {
    if (!confirm(`Delete "${doc.file_name}"? This cannot be undone.`)) return
    setDocDeleting(doc.id)

    await supabase.storage.from('employee-documents').remove([doc.file_path])
    await supabase.from('employee_documents').delete().eq('id', doc.id)

    const cacheKey = `${employee.id}:documents`
    setModuleData(prev => { const copy = { ...prev }; delete copy[cacheKey]; return copy })
    await loadModuleData('documents', cacheKey)
    setDocDeleting(null)
  }

  async function downloadDocument(doc: any) {
    const { data, error } = await supabase.storage.from('employee-documents').download(doc.file_path)
    if (error || !data) { setDocError('Failed to download: ' + (error?.message || 'Unknown error')); return }
    const url = URL.createObjectURL(data)
    const a = document.createElement('a')
    a.href = url
    a.download = doc.file_name
    a.click()
    URL.revokeObjectURL(url)
  }

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  function isExpiringSoon(date: string): boolean {
    const exp = new Date(date)
    const now = new Date()
    const diff = (exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    return diff <= 30 && diff > 0
  }

  function isExpired(date: string): boolean {
    return new Date(date) < new Date()
  }

  function getFileIcon(type: string): string {
    if (['pdf'].includes(type)) return '📄'
    if (['jpg', 'jpeg', 'png', 'gif'].includes(type)) return '🖼️'
    if (['doc', 'docx'].includes(type)) return '📝'
    if (['xls', 'xlsx', 'csv'].includes(type)) return '📊'
    return '📎'
  }

  function renderDocuments() {
    const documents: any[] = currentData?.documents || []
    const catWithExpiry = DOC_CATEGORIES.find(c => c.key === docCategory)?.expiryTracking

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Upload section */}
        <div style={cardStyle}>
          <h4 style={headingStyle}>Upload Document</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ ...labelStyle, marginBottom: 4 }}>Category</label>
              <select
                value={docCategory}
                onChange={e => setDocCategory(e.target.value)}
                style={{ width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13 }}
              >
                {DOC_CATEGORIES.map(c => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </select>
            </div>
            {catWithExpiry && (
              <div>
                <label style={{ ...labelStyle, marginBottom: 4 }}>Expiry Date</label>
                <input
                  type="date"
                  value={docExpiry}
                  onChange={e => setDocExpiry(e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }}
                />
              </div>
            )}
            <div style={{ gridColumn: catWithExpiry ? 'span 2' : 'span 1' }}>
              <label style={{ ...labelStyle, marginBottom: 4 }}>Notes (optional)</label>
              <input
                type="text"
                value={docNotes}
                onChange={e => setDocNotes(e.target.value)}
                placeholder="e.g. Passport, BRP card, Contract amendment..."
                style={{ width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }}
              />
            </div>
            {!catWithExpiry && <div />}
          </div>
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', color: '#333' }}>
              <input
                type="checkbox"
                checked={docVisibleToEmp}
                onChange={e => setDocVisibleToEmp(e.target.checked)}
                style={{ width: 16, height: 16, accentColor: '#1565c0' }}
              />
              Visible to employee
            </label>
          </div>
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
            <input
              ref={docFileRef}
              type="file"
              accept={ACCEPTED_FILE_TYPES}
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) uploadDocument(f) }}
            />
            <button
              onClick={() => docFileRef.current?.click()}
              disabled={docUploading}
              style={{
                padding: '8px 20px', border: 'none', borderRadius: 6, background: '#1565c0', color: '#fff',
                fontSize: 13, fontWeight: 600, cursor: docUploading ? 'not-allowed' : 'pointer', opacity: docUploading ? 0.6 : 1,
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              {docUploading ? 'Uploading...' : 'Choose File & Upload'}
            </button>
            <span style={{ fontSize: 11, color: '#999' }}>Max {MAX_FILE_SIZE_MB}MB per file</span>
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: '#888' }}>
            Accepted formats: {ACCEPTED_MIME_DISPLAY}
          </div>
          {docError && <div style={{ marginTop: 8, fontSize: 12, color: '#c62828', background: '#ffebee', padding: '6px 10px', borderRadius: 4 }}>{docError}</div>}
        </div>

        {/* Document folders by category */}
        {DOC_CATEGORIES.map(cat => {
          const catDocs = documents.filter((d: any) => d.category === cat.key)
          const isExpanded = expandedDocCat === cat.key
          const hasExpiring = cat.expiryTracking && catDocs.some((d: any) => d.expiry_date && (isExpired(d.expiry_date) || isExpiringSoon(d.expiry_date)))

          return (
            <div key={cat.key} style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
              <button
                onClick={() => setExpandedDocCat(isExpanded ? null : cat.key)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px',
                  border: 'none', background: isExpanded ? '#e3f2fd' : '#fff', cursor: 'pointer', textAlign: 'left',
                  transition: 'background 0.15s',
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill={isExpanded ? '#1565c0' : '#999'} stroke="none">
                  <path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z"/>
                </svg>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: isExpanded ? '#1565c0' : '#333' }}>{cat.label}</span>
                {hasExpiring && (
                  <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, fontWeight: 600, background: '#ffebee', color: '#c62828' }}>
                    ⚠ Expiry
                  </span>
                )}
                <span style={{ fontSize: 11, color: '#999', fontWeight: 500 }}>{catDocs.length} {catDocs.length === 1 ? 'file' : 'files'}</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2" style={{ transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>

              {isExpanded && (
                <div style={{ borderTop: '1px solid #e8e8e8' }}>
                  {catDocs.length === 0 ? (
                    <div style={{ padding: 20, textAlign: 'center', color: '#999', fontSize: 12 }}>No documents in this category</div>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: '#f9f9f9' }}>
                          <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600, color: '#666' }}>File</th>
                          <th style={{ textAlign: 'left', padding: 8, fontWeight: 600, color: '#666' }}>Notes</th>
                          {cat.expiryTracking && <th style={{ textAlign: 'left', padding: 8, fontWeight: 600, color: '#666' }}>Expiry</th>}
                          <th style={{ textAlign: 'left', padding: 8, fontWeight: 600, color: '#666' }}>Size</th>
                          <th style={{ textAlign: 'left', padding: 8, fontWeight: 600, color: '#666' }}>Uploaded</th>
                          <th style={{ textAlign: 'center', padding: 8, fontWeight: 600, color: '#666' }}>Visible</th>
                          <th style={{ textAlign: 'right', padding: '8px 12px', fontWeight: 600, color: '#666' }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {catDocs.map((doc: any) => {
                          const expired = doc.expiry_date && isExpired(doc.expiry_date)
                          const expiring = doc.expiry_date && !expired && isExpiringSoon(doc.expiry_date)
                          return (
                            <tr key={doc.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                              <td style={{ padding: '8px 12px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                  <span>{getFileIcon(doc.file_type)}</span>
                                  <span style={{ fontWeight: 500, color: '#333', wordBreak: 'break-all' }}>{doc.file_name}</span>
                                  {doc.scan_status && doc.scan_status !== 'clean' && (
                                    <span style={{
                                      fontSize: 9, padding: '1px 6px', borderRadius: 3, fontWeight: 600,
                                      background: doc.scan_status === 'infected' ? '#ffebee' : doc.scan_status === 'scanning' || doc.scan_status === 'pending' ? '#e3f2fd' : doc.scan_status === 'skipped' ? '#f5f5f5' : '#fff3e0',
                                      color: doc.scan_status === 'infected' ? '#c62828' : doc.scan_status === 'scanning' || doc.scan_status === 'pending' ? '#1565c0' : doc.scan_status === 'skipped' ? '#888' : '#e65100',
                                    }}>
                                      {doc.scan_status === 'infected' ? '⚠ Malware detected' : doc.scan_status === 'scanning' ? 'Scanning…' : doc.scan_status === 'pending' ? 'Scan pending' : doc.scan_status === 'skipped' ? 'Scan skipped' : 'Scan ' + doc.scan_status}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td style={{ padding: 8, color: '#666' }}>{doc.notes || '—'}</td>
                              {cat.expiryTracking && (
                                <td style={{ padding: 8 }}>
                                  {doc.expiry_date ? (
                                    <span style={{
                                      fontSize: 11, padding: '2px 8px', borderRadius: 4, fontWeight: 600,
                                      background: expired ? '#ffebee' : expiring ? '#fff3e0' : '#e8f5e9',
                                      color: expired ? '#c62828' : expiring ? '#e65100' : '#2e7d32',
                                    }}>
                                      {expired ? 'Expired' : expiring ? 'Expiring soon' : 'Valid'} — {fmtUK(doc.expiry_date)}
                                    </span>
                                  ) : '—'}
                                </td>
                              )}
                              <td style={{ padding: 8, color: '#888' }}>{formatFileSize(doc.file_size)}</td>
                              <td style={{ padding: 8, color: '#888' }}>
                                <div>{fmtUK(doc.created_at)}</div>
                                <div style={{ fontSize: 10, color: '#aaa' }}>{doc.uploaded_by_name || ''}</div>
                              </td>
                              <td style={{ padding: 8, textAlign: 'center' }}>
                                <input
                                  type="checkbox"
                                  checked={!!doc.visible_to_employee}
                                  onChange={async () => {
                                    await supabase.from('employee_documents').update({ visible_to_employee: !doc.visible_to_employee }).eq('id', doc.id)
                                    const ck = `${employee.id}:documents`
                                    setModuleData(prev => { const copy = { ...prev }; delete copy[ck]; return copy })
                                    loadModuleData('documents', ck)
                                  }}
                                  style={{ width: 16, height: 16, accentColor: '#1565c0', cursor: 'pointer' }}
                                  title={doc.visible_to_employee ? 'Visible to employee — click to hide' : 'Hidden from employee — click to show'}
                                />
                              </td>
                              <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                                <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                                  <button
                                    onClick={() => downloadDocument(doc)}
                                    title="Download"
                                    style={{ padding: 4, border: 'none', background: 'none', cursor: 'pointer', color: '#1565c0', borderRadius: 4 }}
                                  >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                  </button>
                                  <button
                                    onClick={() => deleteDocument(doc)}
                                    disabled={docDeleting === doc.id}
                                    title="Delete"
                                    style={{ padding: 4, border: 'none', background: 'none', cursor: 'pointer', color: '#c62828', borderRadius: 4, opacity: docDeleting === doc.id ? 0.4 : 1 }}
                                  >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                                  </button>
                                </div>
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
        })}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
      {/* Module sidebar */}
      <div style={{ width: 200, flexShrink: 0 }}>
        <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e8e8e8', overflow: 'hidden' }}>
          {MODULES.map(m => {
            const isActive = activeModule === m.key
            const isDisabled = (m.key === 'assets' && !features.asset_management) ||
              (m.key === 'benefits' && !features.benefits) ||
              (m.key === 'elearning' && !features.elearning) ||
              (m.key === 'expenses' && !features.expenses) ||
              (m.key === 'timesheets' && !features.timesheets)
            return (
              <button
                key={m.key}
                onClick={() => setActiveModule(m.key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 14px',
                  border: 'none', borderBottom: '1px solid #f0f0f0', cursor: 'pointer', fontSize: 12,
                  fontWeight: isActive ? 600 : 400, textAlign: 'left',
                  background: isActive ? '#e3f2fd' : 'transparent',
                  color: isDisabled ? '#bbb' : isActive ? '#1565c0' : '#555',
                  transition: 'background 0.15s',
                }}
              >
                <ModuleIcon icon={m.icon} />
                {m.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Module content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {renderModuleContent()}
      </div>
    </div>
  )
}
