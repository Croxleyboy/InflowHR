import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { useLanguage } from '../../context/LanguageContext'
import { useToast } from '../../context/ToastContext'
import * as XLSX from 'xlsx'
import CompanySetupWizard from './CompanySetupWizard'

interface OnboardRecord {
  id: number
  firstname: string
  surname: string
  user_email: string
  job_title: string
  department: string
  start_date: string
  status: string
  manager: string
  manager_email: string
  personal_email: string
  location: string
  telephone: string
  employee_number: string
  contract_type: string
  equipment_order: string
  is_complete: boolean
  first_day: boolean
  first_week: boolean
  first_month: boolean
  elearning: boolean
  created_at: string
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
  annual_salary: number | null
  tax_code: string | null
  payroll_id: string | null
  skipped_steps: Record<string, boolean> | null
}

const WORKFLOW_STEPS = [
  { key: 'details', label: 'Create Starter Details', icon: '📋', description: 'Capture personal information, role details, start date and contract type for the new employee.' },
  { key: 'equipment', label: 'Order Equipment', icon: '💻', description: 'Raise equipment requests — laptop, monitor, keyboard, headset, building pass. Select device type and delivery address.' },
  { key: 'meeting', label: 'Organise First Meeting', icon: '🤝', description: 'Schedule welcome meeting with manager. Send calendar invite and prepare agenda covering first week expectations.' },
  { key: 'notify_manager', label: 'Notify Manager', icon: '📧', description: 'Inform the line manager of confirmed start date, equipment status and onboarding checklist. Share new starter profile.' },
  { key: 'plan_day1', label: 'Plan First Day', icon: '📅', description: 'Prepare day-one schedule: building access, desk assignment, welcome pack, team introductions and lunch arrangements.' },
  { key: 'inform_starter', label: 'Inform Starter', icon: '✉️', description: 'Send welcome email to the new starter with start date, office location, dress code, parking info and first day schedule.' },
  { key: 'accounts', label: 'Create Accounts & Licences', icon: '🔐', description: 'Create Active Directory / Entra account, assign Microsoft 365 licence, add to security groups and distribution lists. Generate temporary password.' },
  { key: 'day1_access', label: 'Day 1 Access Verification', icon: '✅', description: 'Confirm the new starter can log in, access email, Teams, shared drives and all required business applications on their first day.' },
]

export default function AdminOnboarding() {
  const { isSuperAdmin } = useAuth()
  const { selectedCompanyId, refreshCompanies } = useAdminCompany()
  const { fyStartMonth } = useLanguage()
  const { showError, showSuccess } = useToast()
  const [records, setRecords] = useState<OnboardRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'dashboard' | 'new' | 'list' | 'workflow' | 'upload' | 'setup'>('dashboard')
  const [filterStatus, setFilterStatus] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [workflowStep, setWorkflowStep] = useState(0)
  const [stepChecks, setStepChecks] = useState<Record<string, boolean>>({})
  const [stepSkips, setStepSkips] = useState<Record<string, boolean>>({})
  const [newForm, setNewForm] = useState<Record<string, string>>({
    firstname: '', surname: '', user_email: '', job_title: '', department: '',
    start_date: '', manager: '', manager_email: '', personal_email: '',
    location: '', telephone: '', employee_number: '', contract_type: 'Full-time',
    date_of_birth: '', gender: '', nationality: '', marital_status: '',
    address_line1: '', address_line2: '', city: '', county: '', postcode: '', country: 'United Kingdom',
    emergency_contact_name: '', emergency_contact_phone: '', emergency_contact_relationship: '',
    ni_number: '', bank_sort_code: '', bank_account_number: '', bank_account_name: '',
    probation_end_date: '', notice_period: '', working_pattern: 'Full-time', weekly_hours: '37.5',
    annual_salary: '', tax_code: '', payroll_id: '',
  })

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadRows, setUploadRows] = useState<Record<string, string>[]>([])
  const [uploadErrors, setUploadErrors] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState<{ success: number; failed: number } | null>(null)


  const COLUMN_MAP: Record<string, string> = {
    'first name': 'firstname', 'surname': 'surname', 'work email': 'user_email',
    'personal email': 'personal_email', 'job title': 'job_title', 'department': 'department',
    'manager name': 'manager', 'manager email': 'manager_email', 'location': 'location',
    'phone': 'telephone', 'employee number': 'employee_number', 'start date': 'start_date',
    'contract type': 'contract_type', 'date of birth': 'date_of_birth', 'gender': 'gender',
    'nationality': 'nationality', 'marital status': 'marital_status',
    'address line 1': 'address_line1', 'address line 2': 'address_line2',
    'city': 'city', 'county': 'county', 'postcode': 'postcode', 'country': 'country',
    'emergency contact name': 'emergency_contact_name', 'emergency contact phone': 'emergency_contact_phone',
    'emergency contact relationship': 'emergency_contact_relationship',
    'ni number': 'ni_number', 'bank sort code': 'bank_sort_code',
    'bank account number': 'bank_account_number', 'bank account name': 'bank_account_name',
    'probation end date': 'probation_end_date', 'notice period': 'notice_period',
    'working pattern': 'working_pattern', 'weekly hours': 'weekly_hours',
    'annual salary': 'annual_salary', 'tax code': 'tax_code', 'payroll id': 'payroll_id',
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadErrors([])
    setUploadResult(null)

    const reader = new FileReader()
    reader.onload = (evt) => {
      const data = new Uint8Array(evt.target!.result as ArrayBuffer)
      const workbook = XLSX.read(data, { type: 'array' })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const raw: Record<string, any>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' })

      if (raw.length === 0) {
        setUploadErrors(['The spreadsheet is empty or has no data rows.'])
        return
      }

      const errors: string[] = []
      const mapped = raw.map((row, i) => {
        const out: Record<string, string> = { contract_type: 'Full-time' }
        for (const [excelCol, val] of Object.entries(row)) {
          const key = COLUMN_MAP[excelCol.toLowerCase().trim()]
          if (key) {
            let strVal = String(val).trim()
            const dateFields = ['start_date', 'date_of_birth', 'probation_end_date']
            if (dateFields.includes(key) && typeof val === 'number') {
              const d = XLSX.SSF.parse_date_code(val)
              strVal = `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
            } else if (dateFields.includes(key) && typeof val === 'string') {
              const ddmmyyyy = strVal.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/)
              if (ddmmyyyy) strVal = `${ddmmyyyy[3]}-${ddmmyyyy[2].padStart(2, '0')}-${ddmmyyyy[1].padStart(2, '0')}`
            }
            out[key] = strVal
          }
        }
        if (!out.firstname) errors.push(`Row ${i + 2}: Missing First Name`)
        if (!out.surname) errors.push(`Row ${i + 2}: Missing Surname`)
        if (!out.user_email) errors.push(`Row ${i + 2}: Missing Work Email`)
        else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.user_email))
          errors.push(`Row ${i + 2}: Invalid email "${out.user_email}"`)
        return out
      })

      setUploadErrors(errors)
      setUploadRows(mapped)
    }
    reader.readAsArrayBuffer(file)
    e.target.value = ''
  }

  async function submitUpload() {
    if (uploadErrors.length > 0 || uploadRows.length === 0) return
    setUploading(true)
    let success = 0, failed = 0

    const toInsert = uploadRows.map(row => {
      const s = sanitisePayload(row)
      if (s.emergency_contact_phone) s.emergency_contact_number = s.emergency_contact_phone
      if (s.emergency_contact_relationship) s.relationship = s.emergency_contact_relationship
      return { ...s, status: 'new', is_complete: false, company_id: selectedCompanyId }
    })
    const { error } = await supabase.from('onboarding').insert(toInsert)
    if (error) { failed = uploadRows.length; showError('Bulk upload failed: ' + error.message) }
    else { success = uploadRows.length; showSuccess(`${success} starter${success !== 1 ? 's' : ''} created`) }

    setUploadResult({ success, failed })
    setUploading(false)
    if (success > 0) load()
  }

  function clearUpload() {
    setUploadRows([])
    setUploadErrors([])
    setUploadResult(null)
  }

  function generateBulkTemplate() {
    const headers = ['First Name', 'Surname', 'Work Email', 'Personal Email', 'Job Title', 'Department', 'Manager Name', 'Manager Email', 'Location', 'Phone', 'Employee Number', 'Start Date', 'Contract Type', 'Date of Birth', 'Gender', 'Nationality', 'Marital Status', 'NI Number', 'Address Line 1', 'Address Line 2', 'City', 'County', 'Postcode', 'Country', 'Working Pattern', 'Weekly Hours', 'Probation End Date', 'Notice Period', 'Annual Salary', 'Tax Code', 'Payroll ID', 'Emergency Contact Name', 'Emergency Contact Phone', 'Emergency Contact Relationship', 'Bank Account Name', 'Bank Sort Code', 'Bank Account Number']
    const ws = XLSX.utils.aoa_to_sheet([headers])
    ws['!cols'] = headers.map(() => ({ wch: 20 }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'New Starters')
    XLSX.writeFile(wb, 'new-starter-template.xlsx')
  }

  useEffect(() => { if (selectedCompanyId) load() }, [selectedCompanyId])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('onboarding').select('*').eq('company_id', selectedCompanyId).order('created_at', { ascending: false })
    setRecords((data as OnboardRecord[]) || [])
    setLoading(false)
  }

  function sanitisePayload(form: Record<string, string>): Record<string, any> {
    const dateFields = ['start_date', 'date_of_birth', 'probation_end_date']
    const numericFields = ['weekly_hours', 'annual_salary']
    const out: Record<string, any> = {}
    for (const [k, v] of Object.entries(form)) {
      if (dateFields.includes(k)) { out[k] = v || null }
      else if (numericFields.includes(k)) { out[k] = v ? parseFloat(v) : null }
      else { out[k] = v || null }
    }
    return out
  }

  async function createStarter() {
    if (!newForm.firstname || !newForm.surname || !newForm.user_email || !selectedCompanyId) return
    const sanitised = sanitisePayload(newForm)
    if (sanitised.emergency_contact_phone) sanitised.emergency_contact_number = sanitised.emergency_contact_phone
    if (sanitised.emergency_contact_relationship) sanitised.relationship = sanitised.emergency_contact_relationship
    const payload = { ...sanitised, status: 'new', is_complete: false, company_id: selectedCompanyId }
    const { data, error } = await supabase.from('onboarding').insert(payload).select().single()
    if (error) { showError('Failed to create starter: ' + error.message); return }
    if (data) {
      setSelectedId(data.id)
      setWorkflowStep(0)
      setStepChecks({})
      setTab('workflow')
      showSuccess('Starter created')
      load()
    }
  }

  async function updateOnboardStatus(id: number, updates: Record<string, any>) {
    const { error } = await supabase.from('onboarding').update(updates).eq('id', id)
    if (error) { showError('Failed to update onboarding record: ' + error.message); return }
    load()
  }

  async function deleteRecord(id: number) {
    if (!confirm('Delete this onboarding record?')) return
    const { error } = await supabase.from('onboarding').delete().eq('id', id)
    if (error) { showError('Failed to delete record: ' + error.message); return }
    setRecords(prev => prev.filter(r => r.id !== id))
    showSuccess('Record deleted')
  }

  function openWorkflow(record: OnboardRecord) {
    setSelectedId(record.id)
    const checks: Record<string, boolean> = {
      details: true,
      equipment: record.equipment_order === 'Y',
      meeting: record.first_day,
      notify_manager: record.first_day,
      plan_day1: record.first_day,
      inform_starter: record.first_week,
      accounts: record.elearning,
      day1_access: record.is_complete,
    }
    setStepChecks(checks)
    const skipped = record.skipped_steps
    setStepSkips(skipped && typeof skipped === 'object' ? skipped : {})
    const doneCount = WORKFLOW_STEPS.filter(s => checks[s.key] || (skipped && skipped[s.key])).length
    setWorkflowStep(record.is_complete ? WORKFLOW_STEPS.length - 1 : Math.min(doneCount, WORKFLOW_STEPS.length - 1))
    setTab('workflow')
  }

  async function completeStep(stepKey: string) {
    setStepChecks(prev => ({ ...prev, [stepKey]: true }))
    setStepSkips(prev => ({ ...prev, [stepKey]: false }))
    const record = records.find(r => r.id === selectedId)
    if (!record) return
    const updates: Record<string, any> = {}
    if (stepKey === 'equipment') updates.equipment_order = 'Y'
    if (stepKey === 'plan_day1' || stepKey === 'meeting' || stepKey === 'notify_manager') updates.first_day = true
    if (stepKey === 'inform_starter') updates.first_week = true
    if (stepKey === 'accounts') {
      const created = await createEmployeeFromOnboard(record)
      if (!created) return
      updates.elearning = true
    }
    if (stepKey === 'day1_access') {
      updates.is_complete = true; updates.status = 'Onboarded'; updates.appstatus = 'active'
      const { data: emp } = await supabase.from('employees').select('id').eq('email', record.user_email).eq('company_id', selectedCompanyId).maybeSingle()
      if (!emp) {
        const created = await createEmployeeFromOnboard(record)
        if (!created) return
      }
      const { error: activateErr } = await supabase.from('employees').update({ is_active: true }).eq('email', record.user_email).eq('company_id', selectedCompanyId)
      if (activateErr) { showError('Failed to activate employee: ' + activateErr.message); return }
    }
    if (!updates.status) updates.status = 'in-progress'
    const newSkips = { ...stepSkips, [stepKey]: false }
    updates.skipped_steps = newSkips
    updateOnboardStatus(record.id, updates)
    if (workflowStep < WORKFLOW_STEPS.length - 1) setWorkflowStep(workflowStep + 1)
  }

  function skipStep(stepKey: string) {
    setStepSkips(prev => ({ ...prev, [stepKey]: true }))
    const record = records.find(r => r.id === selectedId)
    if (!record) return
    const newSkips = { ...stepSkips, [stepKey]: true }
    updateOnboardStatus(record.id, { skipped_steps: newSkips, status: 'in-progress' })
    if (workflowStep < WORKFLOW_STEPS.length - 1) setWorkflowStep(workflowStep + 1)
  }

  function uncompleteStep(stepKey: string) {
    setStepChecks(prev => ({ ...prev, [stepKey]: false }))
    setStepSkips(prev => ({ ...prev, [stepKey]: false }))
  }

  async function createEmployeeFromOnboard(record: OnboardRecord): Promise<boolean> {
    const { data: existing } = await supabase.from('employees').select('id').eq('email', record.user_email).eq('company_id', selectedCompanyId).maybeSingle()
    if (existing) return true
    let empNum = record.employee_number || `EMP-${Date.now().toString().slice(-8)}`
    const { data: numClash } = await supabase.from('employees').select('id').eq('employee_number', empNum).maybeSingle()
    if (numClash) empNum = `EMP-${Date.now()}-${Math.floor(Math.random() * 1000)}`
    const { error } = await supabase.from('employees').insert({
      employee_number: empNum,
      first_name: record.firstname,
      last_name: record.surname,
      email: record.user_email,
      job_title: record.job_title || '',
      department: record.department || '',
      start_date: record.start_date || new Date().toISOString().split('T')[0],
      phone: record.telephone || '',
      is_admin: false,
      is_active: false,
      company_id: selectedCompanyId,
      location: record.location || '',
      contract_type: record.contract_type || '',
      personal_email: record.personal_email || '',
      manager_name: record.manager || '',
      manager_email: record.manager_email || '',
      date_of_birth: record.date_of_birth || null,
      gender: record.gender || null,
      nationality: record.nationality || null,
      marital_status: record.marital_status || null,
      address_line1: record.address_line1 || null,
      address_line2: record.address_line2 || null,
      city: record.city || null,
      county: record.county || null,
      postcode: record.postcode || null,
      country: record.country || null,
      emergency_contact_name: record.emergency_contact_name || null,
      emergency_contact_phone: record.emergency_contact_phone || null,
      emergency_contact_relationship: record.emergency_contact_relationship || null,
      ni_number: record.ni_number || null,
      bank_sort_code: record.bank_sort_code || null,
      bank_account_number: record.bank_account_number || null,
      bank_account_name: record.bank_account_name || null,
      probation_end_date: record.probation_end_date || null,
      notice_period: record.notice_period || null,
      working_pattern: record.working_pattern || null,
      weekly_hours: record.weekly_hours || null,
      annual_salary: record.annual_salary || null,
      tax_code: record.tax_code || null,
      payroll_id: record.payroll_id || null,
    })
    if (error) {
      showError(`Failed to create employee record: ${error.message}`)
      return false
    }
    return true
  }

  const stats = useMemo(() => {
    const now = new Date()
    const today = now.toISOString().split('T')[0]

    const fyStart = new Date(now.getFullYear(), fyStartMonth - 1, 1)
    if (fyStart > now) fyStart.setFullYear(fyStart.getFullYear() - 1)
    const fyEnd = new Date(fyStart.getFullYear() + 1, fyStart.getMonth(), 0)

    const fyRecords = records.filter(r => {
      if (!r.start_date) return false
      return r.start_date >= fyStart.toISOString().split('T')[0] && r.start_date <= fyEnd.toISOString().split('T')[0]
    })

    const monthNames = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar']
    const monthlyBreakdown = monthNames.map((label, i) => {
      const m = (fyStartMonth - 1 + i) % 12
      const y = m < fyStartMonth - 1 ? fyStart.getFullYear() + 1 : fyStart.getFullYear()
      const count = fyRecords.filter(r => {
        const d = new Date(r.start_date)
        return d.getMonth() === m && d.getFullYear() === y
      }).length
      return { label, count }
    })

    const overdue = records.filter(r => !r.is_complete && r.start_date && r.start_date < today).length

    const stageMap: Record<string, number> = {}
    WORKFLOW_STEPS.forEach(s => { stageMap[s.key] = 0 })
    stageMap['complete'] = 0
    records.filter(r => !r.is_complete).forEach(r => {
      if (r.status === 'new') { stageMap['details'] = (stageMap['details'] || 0) + 1; return }
      const checks: Record<string, boolean> = {
        details: true, equipment: r.equipment_order === 'Y',
        meeting: r.first_day, notify_manager: r.first_day, plan_day1: r.first_day,
        inform_starter: r.first_week, accounts: r.elearning, day1_access: r.is_complete,
      }
      const skipped = r.skipped_steps
      const doneCount = WORKFLOW_STEPS.filter(s => checks[s.key] || (skipped && skipped[s.key])).length
      const currentIdx = Math.min(doneCount, WORKFLOW_STEPS.length - 1)
      const stepKey = WORKFLOW_STEPS[currentIdx].key
      stageMap[stepKey] = (stageMap[stepKey] || 0) + 1
    })
    stageMap['complete'] = records.filter(r => r.is_complete).length

    return {
      total: records.length,
      fyTotal: fyRecords.length,
      pending: records.filter(r => !r.is_complete).length,
      dueJoining: records.filter(r => !r.is_complete && r.start_date && r.start_date > today).length,
      overdue,
      completed: records.filter(r => r.is_complete).length,
      monthlyBreakdown,
      stageMap,
      fyLabel: `${fyStart.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })} – ${fyEnd.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}`,
    }
  }, [records, fyStartMonth])

  const filtered = useMemo(() => {
    if (!filterStatus) return records
    if (filterStatus === 'pending') return records.filter(r => !r.is_complete)
    if (filterStatus === 'completed') return records.filter(r => r.is_complete)
    return records.filter(r => r.status === filterStatus)
  }, [records, filterStatus])

  const selectedRecord = records.find(r => r.id === selectedId)

  return (
    <div className="admin-section">
      <div className="admin-page-header">
        <h2>Onboarding Management</h2>
        <p>{records.length} onboarding records</p>
      </div>

      <div className="admin-tabs">
        <button className={`admin-tab ${tab === 'dashboard' ? 'admin-tab-active' : ''}`} onClick={() => setTab('dashboard')}>Dashboard</button>
        <button className={`admin-tab ${tab === 'new' ? 'admin-tab-active' : ''}`} onClick={() => setTab('new')}>New Starter</button>
        <button className={`admin-tab ${tab === 'upload' ? 'admin-tab-active' : ''}`} onClick={() => setTab('upload')}>Bulk Upload</button>
        <button className={`admin-tab ${tab === 'list' ? 'admin-tab-active' : ''}`} onClick={() => setTab('list')}>All Records</button>
        {selectedId && <button className={`admin-tab ${tab === 'workflow' ? 'admin-tab-active' : ''}`} onClick={() => setTab('workflow')}>Workflow</button>}
        {isSuperAdmin && (
          <button className={`admin-tab ${tab === 'setup' ? 'admin-tab-active' : ''}`} onClick={() => setTab('setup')} style={{ borderColor: '#7b1fa2', color: tab === 'setup' ? '#fff' : '#7b1fa2', background: tab === 'setup' ? '#7b1fa2' : undefined }}>
            Company Setup
          </button>
        )}
      </div>

      {tab === 'dashboard' && (
        <div className="admin-onboard-dash">
          <div className="admin-mini-stats">
            <div className="admin-mini-stat"><span className="admin-mini-value">{stats.total}</span><span>Total</span></div>
            <div className="admin-mini-stat"><span className="admin-mini-value" style={{color:'#5b9bd5'}}>{stats.fyTotal}</span><span>This FY</span></div>
            <div className="admin-mini-stat"><span className="admin-mini-value" style={{color:'#ff9800'}}>{stats.pending}</span><span>In Progress</span></div>
            <div className="admin-mini-stat"><span className="admin-mini-value" style={{color:'#7b1fa2'}}>{stats.dueJoining}</span><span>Due to Join</span></div>
            <div className="admin-mini-stat"><span className="admin-mini-value" style={{color: stats.overdue > 0 ? '#c62828' : '#43a047'}}>{stats.overdue}</span><span>Overdue</span></div>
            <div className="admin-mini-stat"><span className="admin-mini-value" style={{color:'#43a047'}}>{stats.completed}</span><span>Completed</span></div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginTop: 24 }}>
            <div style={{ background: 'var(--admin-card-bg, #fff)', borderRadius: 12, padding: 20, border: '1px solid var(--admin-border, #e0e0e0)' }}>
              <h4 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 600 }}>Onboarders per Month</h4>
              <p style={{ margin: '0 0 16px', fontSize: 12, color: '#888' }}>{stats.fyLabel}</p>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 120 }}>
                {stats.monthlyBreakdown.map((m, i) => {
                  const max = Math.max(...stats.monthlyBreakdown.map(x => x.count), 1)
                  const h = m.count > 0 ? Math.max((m.count / max) * 100, 12) : 4
                  return (
                    <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                      {m.count > 0 && <span style={{ fontSize: 11, fontWeight: 600, color: '#1565c0' }}>{m.count}</span>}
                      <div style={{ width: '100%', height: h, background: m.count > 0 ? '#1565c0' : '#e0e0e0', borderRadius: 4 }} />
                      <span style={{ fontSize: 10, color: '#888' }}>{m.label}</span>
                    </div>
                  )
                })}
              </div>
            </div>

            <div style={{ background: 'var(--admin-card-bg, #fff)', borderRadius: 12, padding: 20, border: '1px solid var(--admin-border, #e0e0e0)' }}>
              <h4 style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 600 }}>Onboarding Pipeline</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {WORKFLOW_STEPS.map((step) => {
                  const count = stats.stageMap[step.key] || 0
                  return (
                    <div key={step.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                      <span style={{ width: 24, textAlign: 'center' }}>{step.icon}</span>
                      <span style={{ flex: 1, color: count > 0 ? '#333' : '#bbb' }}>{step.label}</span>
                      <span style={{ fontWeight: 600, minWidth: 20, textAlign: 'right', color: count > 0 ? '#1565c0' : '#ccc' }}>{count}</span>
                    </div>
                  )
                })}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, borderTop: '1px solid #e0e0e0', paddingTop: 6, marginTop: 2 }}>
                  <span style={{ width: 24, textAlign: 'center' }}>✅</span>
                  <span style={{ flex: 1, fontWeight: 600 }}>Completed</span>
                  <span style={{ fontWeight: 600, minWidth: 20, textAlign: 'right', color: '#43a047' }}>{stats.stageMap['complete'] || 0}</span>
                </div>
              </div>
            </div>
          </div>

          {stats.overdue > 0 && (
            <div style={{ marginTop: 20, background: '#fff3e0', border: '1px solid #ff9800', borderRadius: 12, padding: 16 }}>
              <h4 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600, color: '#e65100' }}>Overdue Onboarding ({stats.overdue})</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {records.filter(r => !r.is_complete && r.start_date && r.start_date < new Date().toISOString().split('T')[0]).map(r => {
                  const daysOver = Math.floor((Date.now() - new Date(r.start_date).getTime()) / 86400000)
                  return (
                    <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 13, padding: '6px 0', borderBottom: '1px solid #ffe0b2' }}>
                      <span style={{ fontWeight: 600 }}>{r.firstname} {r.surname}</span>
                      <span style={{ color: '#666' }}>{r.job_title}</span>
                      <span style={{ marginLeft: 'auto', color: '#c62828', fontWeight: 600 }}>{daysOver} day{daysOver !== 1 ? 's' : ''} overdue</span>
                      <button className="admin-btn-sm admin-btn-save" onClick={() => openWorkflow(r)}>View</button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'new' && (
        <div className="admin-add-form">
          <h3>Create New Starter</h3>
          <fieldset style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <legend style={{ fontWeight: 700, fontSize: 13, color: '#1565c0' }}>Basic Details</legend>
            <div className="admin-form-grid">
              {[
                { key: 'firstname', label: 'First Name *' }, { key: 'surname', label: 'Surname *' },
                { key: 'user_email', label: 'Work Email *' }, { key: 'personal_email', label: 'Personal Email' },
                { key: 'job_title', label: 'Job Title' }, { key: 'department', label: 'Department' },
                { key: 'manager', label: 'Manager Name' }, { key: 'manager_email', label: 'Manager Email' },
                { key: 'location', label: 'Work Location' }, { key: 'telephone', label: 'Phone' },
                { key: 'employee_number', label: 'Employee Number' },
              ].map(f => (
                <div key={f.key} className="admin-form-field">
                  <label>{f.label}</label>
                  <input className="admin-input" value={newForm[f.key]} onChange={e => setNewForm(p => ({...p, [f.key]: e.target.value}))} />
                </div>
              ))}
              <div className="admin-form-field">
                <label>Start Date</label>
                <input type="date" className="admin-input" value={newForm.start_date} onChange={e => setNewForm(p => ({...p, start_date: e.target.value}))} />
              </div>
              <div className="admin-form-field">
                <label>Contract Type</label>
                <select className="admin-select" value={newForm.contract_type} onChange={e => setNewForm(p => ({...p, contract_type: e.target.value}))}>
                  <option>Full-time</option><option>Part-time</option><option>Contract</option><option>Apprentice</option><option>Intern</option><option>Guest</option>
                </select>
              </div>
            </div>
          </fieldset>
          <fieldset style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <legend style={{ fontWeight: 700, fontSize: 13, color: '#1565c0' }}>Personal Information</legend>
            <div className="admin-form-grid">
              <div className="admin-form-field">
                <label>Date of Birth</label>
                <input type="date" className="admin-input" value={newForm.date_of_birth} onChange={e => setNewForm(p => ({...p, date_of_birth: e.target.value}))} />
              </div>
              <div className="admin-form-field">
                <label>Gender</label>
                <select className="admin-select" value={newForm.gender} onChange={e => setNewForm(p => ({...p, gender: e.target.value}))}>
                  <option value="">—</option><option>Male</option><option>Female</option><option>Non-binary</option><option>Prefer not to say</option>
                </select>
              </div>
              <div className="admin-form-field">
                <label>Nationality</label>
                <input className="admin-input" value={newForm.nationality} onChange={e => setNewForm(p => ({...p, nationality: e.target.value}))} />
              </div>
              <div className="admin-form-field">
                <label>Marital Status</label>
                <select className="admin-select" value={newForm.marital_status} onChange={e => setNewForm(p => ({...p, marital_status: e.target.value}))}>
                  <option value="">—</option><option>Single</option><option>Married</option><option>Civil Partnership</option><option>Divorced</option><option>Widowed</option><option>Prefer not to say</option>
                </select>
              </div>
              <div className="admin-form-field">
                <label>NI Number</label>
                <input className="admin-input" value={newForm.ni_number} onChange={e => setNewForm(p => ({...p, ni_number: e.target.value}))} />
              </div>
            </div>
          </fieldset>
          <fieldset style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <legend style={{ fontWeight: 700, fontSize: 13, color: '#1565c0' }}>Address</legend>
            <div className="admin-form-grid">
              {[
                { key: 'address_line1', label: 'Address Line 1' }, { key: 'address_line2', label: 'Address Line 2' },
                { key: 'city', label: 'City' }, { key: 'county', label: 'County' },
                { key: 'postcode', label: 'Postcode' }, { key: 'country', label: 'Country' },
              ].map(f => (
                <div key={f.key} className="admin-form-field">
                  <label>{f.label}</label>
                  <input className="admin-input" value={newForm[f.key]} onChange={e => setNewForm(p => ({...p, [f.key]: e.target.value}))} />
                </div>
              ))}
            </div>
          </fieldset>
          <fieldset style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <legend style={{ fontWeight: 700, fontSize: 13, color: '#1565c0' }}>Employment</legend>
            <div className="admin-form-grid">
              <div className="admin-form-field">
                <label>Working Pattern</label>
                <select className="admin-select" value={newForm.working_pattern} onChange={e => setNewForm(p => ({...p, working_pattern: e.target.value}))}>
                  <option>Full-time</option><option>Part-time</option><option>Compressed</option><option>Flexible</option><option>Shift</option><option>Term-time</option>
                </select>
              </div>
              <div className="admin-form-field">
                <label>Weekly Hours</label>
                <input type="number" step="0.5" className="admin-input" value={newForm.weekly_hours} onChange={e => setNewForm(p => ({...p, weekly_hours: e.target.value}))} />
              </div>
              <div className="admin-form-field">
                <label>Probation End Date</label>
                <input type="date" className="admin-input" value={newForm.probation_end_date} onChange={e => setNewForm(p => ({...p, probation_end_date: e.target.value}))} />
              </div>
              <div className="admin-form-field">
                <label>Notice Period</label>
                <input className="admin-input" placeholder="e.g. 1 month" value={newForm.notice_period} onChange={e => setNewForm(p => ({...p, notice_period: e.target.value}))} />
              </div>
              <div className="admin-form-field">
                <label>Annual Salary (£)</label>
                <input type="number" className="admin-input" value={newForm.annual_salary} onChange={e => setNewForm(p => ({...p, annual_salary: e.target.value}))} />
              </div>
              <div className="admin-form-field">
                <label>Tax Code</label>
                <input className="admin-input" value={newForm.tax_code} onChange={e => setNewForm(p => ({...p, tax_code: e.target.value}))} />
              </div>
              <div className="admin-form-field">
                <label>Payroll ID</label>
                <input className="admin-input" value={newForm.payroll_id} onChange={e => setNewForm(p => ({...p, payroll_id: e.target.value}))} />
              </div>
            </div>
          </fieldset>
          <fieldset style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <legend style={{ fontWeight: 700, fontSize: 13, color: '#1565c0' }}>Emergency Contact</legend>
            <div className="admin-form-grid">
              {[
                { key: 'emergency_contact_name', label: 'Contact Name' },
                { key: 'emergency_contact_phone', label: 'Contact Phone' },
                { key: 'emergency_contact_relationship', label: 'Relationship' },
              ].map(f => (
                <div key={f.key} className="admin-form-field">
                  <label>{f.label}</label>
                  <input className="admin-input" value={newForm[f.key]} onChange={e => setNewForm(p => ({...p, [f.key]: e.target.value}))} />
                </div>
              ))}
            </div>
          </fieldset>
          <fieldset style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <legend style={{ fontWeight: 700, fontSize: 13, color: '#1565c0' }}>Bank Details</legend>
            <div className="admin-form-grid">
              {[
                { key: 'bank_account_name', label: 'Account Name' },
                { key: 'bank_sort_code', label: 'Sort Code' },
                { key: 'bank_account_number', label: 'Account Number' },
              ].map(f => (
                <div key={f.key} className="admin-form-field">
                  <label>{f.label}</label>
                  <input className="admin-input" value={newForm[f.key]} onChange={e => setNewForm(p => ({...p, [f.key]: e.target.value}))} />
                </div>
              ))}
            </div>
          </fieldset>
          <button className="admin-btn admin-btn-primary" onClick={createStarter}>Create & Start Workflow</button>
        </div>
      )}

      {tab === 'upload' && (
        <div className="admin-add-form">
          <h3>Bulk Upload New Starters</h3>
          <p style={{ color: '#666', marginBottom: 16 }}>Upload an Excel file (.xlsx) to create multiple new starter records at once.</p>

          <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
            <button className="admin-btn admin-btn-primary" onClick={generateBulkTemplate} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Download Template
            </button>
            <button className="admin-btn" style={{ background: '#43a047', color: '#fff' }} onClick={() => fileInputRef.current?.click()}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6 }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              Upload Excel File
            </button>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={handleFileSelect} style={{ display: 'none' }} />
          </div>

          {uploadErrors.length > 0 && (
            <div style={{ background: '#fff3e0', border: '1px solid #ff9800', borderRadius: 8, padding: 12, marginBottom: 16 }}>
              <strong style={{ color: '#e65100' }}>Validation Errors ({uploadErrors.length})</strong>
              <ul style={{ margin: '8px 0 0', paddingLeft: 20, color: '#bf360c', fontSize: 13 }}>
                {uploadErrors.map((err, i) => <li key={i}>{err}</li>)}
              </ul>
              <p style={{ fontSize: 13, color: '#e65100', marginTop: 8 }}>Fix these errors in your spreadsheet and re-upload.</p>
            </div>
          )}

          {uploadResult && (
            <div style={{ background: uploadResult.failed > 0 ? '#fff3e0' : '#e8f5e9', border: `1px solid ${uploadResult.failed > 0 ? '#ff9800' : '#43a047'}`, borderRadius: 8, padding: 12, marginBottom: 16 }}>
              <strong style={{ color: uploadResult.failed > 0 ? '#e65100' : '#2e7d32' }}>
                Upload Complete: {uploadResult.success} created{uploadResult.failed > 0 ? `, ${uploadResult.failed} failed` : ''}
              </strong>
            </div>
          )}

          {uploadRows.length > 0 && !uploadResult && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <h4 style={{ margin: 0 }}>Preview ({uploadRows.length} row{uploadRows.length !== 1 ? 's' : ''})</h4>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="admin-btn" style={{ background: '#e0e0e0', color: '#333' }} onClick={clearUpload}>Clear</button>
                  <button
                    className="admin-btn admin-btn-primary"
                    onClick={submitUpload}
                    disabled={uploading || uploadErrors.length > 0}
                  >
                    {uploading ? 'Uploading...' : `Create ${uploadRows.length} Starter${uploadRows.length !== 1 ? 's' : ''}`}
                  </button>
                </div>
              </div>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>#</th><th>Name</th><th>Work Email</th><th>Job Title</th>
                      <th>Department</th><th>Start Date</th><th>Contract</th>
                    </tr>
                  </thead>
                  <tbody>
                    {uploadRows.map((row, i) => {
                      const hasError = !row.firstname || !row.surname || !row.user_email
                      return (
                        <tr key={i} style={hasError ? { background: '#fff3e0' } : undefined}>
                          <td>{i + 1}</td>
                          <td><strong>{row.firstname} {row.surname}</strong></td>
                          <td>{row.user_email}</td>
                          <td>{row.job_title || '—'}</td>
                          <td>{row.department || '—'}</td>
                          <td>{row.start_date || '—'}</td>
                          <td>{row.contract_type || '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {uploadRows.length === 0 && !uploadResult && (
            <div style={{ border: '2px dashed #ccc', borderRadius: 12, padding: '40px 20px', textAlign: 'center', color: '#999', cursor: 'pointer' }} onClick={() => fileInputRef.current?.click()}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="1.5" style={{ marginBottom: 8 }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              <p style={{ margin: 0, fontSize: 15 }}>Click to select an Excel file or use the button above</p>
              <p style={{ margin: '4px 0 0', fontSize: 13 }}>Accepts .xlsx files</p>
            </div>
          )}
        </div>
      )}

      {tab === 'list' && (
        <>
          <div className="admin-filters">
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="admin-select">
              <option value="">All</option>
              <option value="pending">Pending</option>
              <option value="completed">Completed</option>
            </select>
          </div>
          {loading ? <div className="admin-loading">Loading...</div> : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>Name</th><th>Role</th><th>Start Date</th><th>Status</th><th>Progress</th><th>Actions</th></tr></thead>
                <tbody>
                  {filtered.map(r => {
                    const skipped = r.skipped_steps || {}
                    const completedSteps = [true, r.equipment_order === 'Y', r.first_day, r.first_day, r.first_day, r.first_week, r.elearning, r.is_complete].filter(Boolean).length
                    const skippedCount = Object.values(skipped).filter(Boolean).length
                    const totalDone = completedSteps + skippedCount
                    return (
                      <tr key={r.id}>
                        <td><strong>{r.firstname} {r.surname}</strong></td>
                        <td>{r.job_title || '—'}</td>
                        <td>{r.start_date ? new Date(r.start_date).toLocaleDateString('en-GB') : '—'}</td>
                        <td><span className={`admin-badge ${r.is_complete ? 'admin-badge-approved' : 'admin-badge-pending'}`}>{r.is_complete ? 'Onboarded' : r.status}</span></td>
                        <td>
                          <div className="admin-progress-bar"><div className="admin-progress-fill" style={{width: `${(totalDone / WORKFLOW_STEPS.length) * 100}%`}} /></div>
                          <span className="admin-progress-text">{completedSteps}/{WORKFLOW_STEPS.length}{skippedCount > 0 ? ` (${skippedCount} skipped)` : ''}</span>
                        </td>
                        <td className="admin-actions">
                          <button className="admin-btn-sm admin-btn-save" onClick={() => openWorkflow(r)}>Workflow</button>
                          <button className="admin-btn-icon admin-btn-danger" onClick={() => deleteRecord(r.id)}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {filtered.length === 0 && <div className="admin-empty">No onboarding records</div>}
            </div>
          )}
        </>
      )}

      {tab === 'workflow' && selectedRecord && (
        <div className="admin-workflow">
          <div className="admin-workflow-header">
            <h3>{selectedRecord.firstname} {selectedRecord.surname}</h3>
            <p>{selectedRecord.job_title} · Starting {selectedRecord.start_date ? new Date(selectedRecord.start_date).toLocaleDateString('en-GB') : 'TBC'}</p>
          </div>
          <div className="admin-workflow-timeline">
            {WORKFLOW_STEPS.map((step, i) => {
              const done = stepChecks[step.key]
              const skipped = stepSkips[step.key]
              const isCurrent = i === workflowStep
              return (
                <div key={step.key} className={`admin-wf-step ${done ? 'admin-wf-done' : ''} ${skipped ? 'admin-wf-skipped' : ''} ${isCurrent ? 'admin-wf-current' : ''}`} onClick={() => setWorkflowStep(i)}>
                  <div className="admin-wf-connector" />
                  <div className="admin-wf-dot">{done ? '✓' : skipped ? '⏭' : step.icon}</div>
                  <div className="admin-wf-content">
                    <h4>{step.label}{skipped && <span className="admin-wf-skip-badge">Skipped</span>}</h4>
                    {isCurrent && (
                      <div className="admin-wf-detail">
                        <p>{step.description}</p>
                        <div className="admin-wf-actions">
                          {done ? (
                            <button className="admin-btn-sm admin-btn-cancel" onClick={e => { e.stopPropagation(); uncompleteStep(step.key) }}>Undo</button>
                          ) : skipped ? (
                            <>
                              <button className="admin-btn-sm admin-btn-save" onClick={e => { e.stopPropagation(); completeStep(step.key) }}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                                Mark Complete
                              </button>
                              <button className="admin-btn-sm admin-btn-cancel" onClick={e => { e.stopPropagation(); uncompleteStep(step.key) }}>Undo Skip</button>
                            </>
                          ) : (
                            <>
                              <button className="admin-btn-sm admin-btn-save" onClick={e => { e.stopPropagation(); completeStep(step.key) }}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                                Mark Complete
                              </button>
                              {step.key !== 'details' && (
                                <button className="admin-btn-sm admin-btn-skip" onClick={e => { e.stopPropagation(); skipStep(step.key) }}>
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5 4 15 12 5 20"/><line x1="19" y1="5" x2="19" y2="19"/></svg>
                                  Skip
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {tab === 'setup' && (
        <CompanySetupWizard onSetupComplete={(companyId) => { refreshCompanies(companyId); load() }} />
      )}
    </div>
  )
}
