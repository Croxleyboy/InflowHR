import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase, callRpcDirect } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { useLanguage } from '../../context/LanguageContext'
import { useToast } from '../../context/ToastContext'
import { useFeatures } from '../../context/FeatureContext'
import * as XLSX from 'xlsx'
import CompanySetupWizard from './CompanySetupWizard'
import { validateNINumber, validateSortCode, validateAccountNumber } from '../../lib/validators'
import { toLocalDateStr, currencySymbol } from '../../lib/formatters'

const PAGE_SIZE = 30

interface OffboardRecord {
  id: number
  company_id: string
  employee_id: string
  employee_name: string
  employee_email: string
  job_title: string | null
  department: string | null
  end_date: string | null
  reason: string | null
  status: string
  workflow_steps: Record<string, boolean>
  skipped_steps: Record<string, boolean>
  is_complete: boolean
  frozen_at: string | null
  created_at: string
  data_export_url: string | null
  data_exported_at: string | null
  cleanup_bookings_done: boolean
  cleanup_shifts_done: boolean
  cleanup_benefits_done: boolean
  cleanup_assets_done: boolean
  custom_steps_completed: Record<string, boolean>
}

interface FrozenEmployee {
  id: number
  company_id: string
  employee_id: string
  employee_name: string
  employee_email: string
  frozen_at: string
  deletion_date: string
  status: string
  recovered_at: string | null
  extended_at: string | null
  extension_days: number
  data_export_url: string | null
  payroll_cleared: boolean
}

interface DeletionCertificate {
  id: string
  company_id: string
  employee_name: string
  employee_email: string
  employee_id: string
  leaving_date: string | null
  leaving_reason: string | null
  frozen_at: string | null
  deleted_at: string
  retention_days: number
  data_export_provided: boolean
  data_categories_held: string[]
  deletion_summary: Record<string, number>
  certificate_reference: string
  created_at: string
}

const OFFBOARD_STEPS = [
  { key: 'approve_resignation', label: 'Approve Resignation', icon: '📝', description: 'Review and formally approve the employee resignation or termination. Update HR records with the leaving reason and confirm final working date.', role: 'HR' },
  { key: 'recover_equipment', label: 'Recover Equipment', icon: '💻', description: 'Collect all company equipment — laptop, monitor, phone, building pass, keys, parking permit. Complete the asset return checklist and update the inventory register.', role: 'HR' },
  { key: 'leaving_meeting', label: 'Organise Leaving Meeting', icon: '🤝', description: 'Schedule an exit interview and farewell meeting with the line manager. Cover handover tasks, knowledge transfer, and gather feedback on their experience.', role: 'Manager' },
  { key: 'convert_shared_mailbox', label: 'Convert to Shared Mailbox', icon: '📬', description: 'Convert the leaver\'s mailbox to a shared mailbox so colleagues can continue to access their emails without consuming a licence. This step can be skipped if not required.', role: 'HR' },
  { key: 'forward_to_manager', label: 'Forward to Manager', icon: '📧', description: 'Set up email forwarding from the leaver\'s mailbox to their line manager so that incoming messages are not missed during the transition period. This step can be skipped if not required.', role: 'HR' },
  { key: 'remove_accounts', label: 'Remove Accounts & Licences', icon: '🔐', description: 'Disable the Microsoft 365 account, revoke licence, remove from security groups and distribution lists. Archive mailbox if required.', role: 'HR' },
  { key: 'review_shifts', label: 'Review Future Shifts', icon: '📅', description: 'Review and cancel any future shift assignments for this employee. Unassigned shifts can be reassigned to other team members via the rota.', role: 'HR' },
  { key: 'review_bookings', label: 'Review Future Bookings', icon: '🏢', description: 'Review and cancel any future desk or room bookings made by this employee. This frees up the spaces for other team members.', role: 'HR' },
  { key: 'review_benefits', label: 'Review Benefit Enrolments', icon: '🎁', description: 'Unenrol the employee from all active company benefits. If payroll is connected, benefit deductions will stop from the next pay run.', role: 'HR' },
  { key: 'review_assets', label: 'Review Company Assets', icon: '📦', description: 'Confirm all company assets assigned to this employee have been accounted for and returned. Cross-reference with the asset register.', role: 'HR' },
  { key: 'export_data', label: 'Export Employee Data (GDPR)', icon: '📥', description: 'Generate and download the GDPR data export pack containing all personal data held for this employee. This is also auto-generated when the account is frozen.', role: 'HR' },
  { key: 'reassign_reports', label: 'Reassign Direct Reports', icon: '👥', description: 'Reassign any employees who report to this person to a new manager. This also transfers all pending approval actions (leave, expenses, timesheets) to the new manager.', role: 'HR' },
  { key: 'confirm_payments', label: 'Agree / Confirm Last Payments', icon: '💷', description: 'Calculate final salary payment including outstanding holiday pay, expenses, bonuses and any deductions. Confirm P45 will be issued and pension contributions ceased.', role: 'HR' },
]

interface OnboardRecord {
  id: number
  company_id: string
  company?: { name: string } | null
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
  employment_category: string | null
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
  weekly_hours: number | null
  annual_salary: number | null
  tax_code: string | null
  payroll_id: string | null
  leave_allowance: number | null
  skipped_steps: Record<string, boolean> | null
  custom_steps_completed: Record<string, boolean> | null
}

const WORKFLOW_STEPS = [
  { key: 'details', label: 'Create Starter Details', icon: '📋', description: 'Capture personal information, role details, start date and contract type for the new employee.' },
  { key: 'equipment', label: 'Order Equipment', icon: '💻', description: 'Raise equipment requests — laptop, monitor, keyboard, headset, building pass. Select device type and delivery address.' },
  { key: 'meeting', label: 'Organise First Meeting', icon: '🤝', description: 'Schedule welcome meeting with manager. Send calendar invite and prepare agenda covering first week expectations.' },
  { key: 'notify_manager', label: 'Notify Manager', icon: '📧', description: 'Inform the line manager of confirmed start date, equipment status and onboarding checklist. Share new starter profile.' },
  { key: 'plan_day1', label: 'Plan First Day', icon: '📅', description: 'Prepare day-one schedule: building access, desk assignment, welcome pack, team introductions and lunch arrangements.' },
  { key: 'inform_starter', label: 'Inform Starter', icon: '✉️', description: 'Send welcome email to the new starter with start date, office location, dress code, parking info and first day schedule.' },
  { key: 'accounts', label: 'Create Accounts & Licences', icon: '🔐', description: 'Create the new starter\'s Microsoft 365 account via InflowOnboarder — checks licence availability, creates the account, assigns the licence and adds to groups. Generates a temporary password.' },
  { key: 'day1_access', label: 'Day 1 Access Verification', icon: '✅', description: 'Confirm the new starter can log in, access email, Teams, shared drives and all required business applications on their first day.' },
]

export default function AdminOnboarding() {
  const { isSuperAdmin, company, session } = useAuth()
  const currency = company?.currency || 'GBP'
  const { selectedCompanyId, selectedCompany, refreshCompanies } = useAdminCompany()
  const { fyStartMonth } = useLanguage()
  const { showError, showSuccess } = useToast()
  const { features } = useFeatures()
  const [records, setRecords] = useState<OnboardRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'dashboard' | 'new' | 'list' | 'workflow' | 'upload' | 'setup' | 'offboarding' | 'offboard-workflow' | 'settings'>('dashboard')
  const [filterStatus, setFilterStatus] = useState('')
  const [onbPage, setOnbPage] = useState(1)
  const [offPage, setOffPage] = useState(1)
  const [frozenPage, setFrozenPage] = useState(1)
  const [complPage, setComplPage] = useState(1)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [workflowStep, setWorkflowStep] = useState(0)
  const [stepChecks, setStepChecks] = useState<Record<string, boolean>>({})
  const [stepSkips, setStepSkips] = useState<Record<string, boolean>>({})
  const [newForm, setNewForm] = useState<Record<string, string>>({
    firstname: '', surname: '', user_email: '', job_title: '', department: '',
    start_date: '', manager: '', manager_email: '', personal_email: '',
    location: '', telephone: '', employee_number: '', contract_type: 'Full-time', employment_category: 'employed',
    date_of_birth: '', gender: '', nationality: '', marital_status: '',
    address_line1: '', address_line2: '', city: '', county: '', postcode: '', country: 'United Kingdom',
    emergency_contact_name: '', emergency_contact_phone: '', emergency_contact_relationship: '',
    ni_number: '', bank_sort_code: '', bank_account_number: '', bank_account_name: '',
    probation_end_date: '', notice_period: '', weekly_hours: '37.5',
    annual_salary: '', tax_code: '', payroll_id: '', religion: '', salary_group: 'N/A', qualifications: '',
  })

  const [offboardRecords, setOffboardRecords] = useState<OffboardRecord[]>([])
  const [frozenEmployees, setFrozenEmployees] = useState<FrozenEmployee[]>([])
  const [offboardSelectedId, setOffboardSelectedId] = useState<number | null>(null)
  const [offboardStep, setOffboardStep] = useState(0)
  const [offboardChecks, setOffboardChecks] = useState<Record<string, boolean>>({})
  const [offboardSkips, setOffboardSkips] = useState<Record<string, boolean>>({})
  const [showFreezeModal, setShowFreezeModal] = useState<OffboardRecord | null>(null)
  const [reassignData, setReassignData] = useState<{ directReports: { id: string; first_name: string; last_name: string; email: string }[]; pendingActions: number } | null>(null)
  const [reassignTargetId, setReassignTargetId] = useState('')
  const [reassignCandidates, setReassignCandidates] = useState<{ id: string; first_name: string; last_name: string; email: string }[]>([])
  const [reassignSaving, setReassignSaving] = useState(false)
  const [offboardEmployeeSearch, setOffboardEmployeeSearch] = useState('')
  const [offboardEmployeeResults, setOffboardEmployeeResults] = useState<{ id: string; first_name: string; last_name: string; email: string; job_title: string; department: string }[]>([])
  const [offboardForm, setOffboardForm] = useState({ end_date: '', reason: '' })

  // Leaver review step data
  const [reviewShifts, setReviewShifts] = useState<{ id: number; date: string; shift_name: string; rota_name: string }[]>([])
  const [reviewBookings, setReviewBookings] = useState<{ id: number; booking_date: string; space_name: string }[]>([])
  const [reviewBenefits, setReviewBenefits] = useState<{ id: number; benefit_name: string; enrolled_at: string }[]>([])
  const [reviewAssets, setReviewAssets] = useState<{ id: number; asset_name: string; asset_type: string; assigned_date: string }[]>([])
  const [deletionCertificates, setDeletionCertificates] = useState<DeletionCertificate[]>([])

  // Custom offboarding steps state
  const [offboardCustomSteps, setOffboardCustomSteps] = useState<CustomStep[]>([])
  const [offboardEditingSteps, setOffboardEditingSteps] = useState<CustomStep[]>([])
  const [hasOffboardCustomSteps, setHasOffboardCustomSteps] = useState(false)
  const [settingsWorkflowType, setSettingsWorkflowType] = useState<'onboarding' | 'offboarding'>('onboarding')

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadRows, setUploadRows] = useState<Record<string, string>[]>([])
  const [uploadErrors, setUploadErrors] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState<{ success: number; failed: number } | null>(null)

  // Custom workflow steps state
  interface CustomStep { id?: number; step_key: string; label: string; icon: string; description: string; sort_order: number; is_default: boolean }
  const [customSteps, setCustomSteps] = useState<CustomStep[]>([])
  const [editingSteps, setEditingSteps] = useState<CustomStep[]>([])
  const [hasCustomSteps, setHasCustomSteps] = useState(false)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [settingsDirty, setSettingsDirty] = useState(false)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [editingIdx, setEditingIdx] = useState<number | null>(null)

  const activeSteps: CustomStep[] = hasCustomSteps ? customSteps : WORKFLOW_STEPS.map((s, i) => ({ step_key: s.key, label: s.label, icon: s.icon, description: s.description, sort_order: i, is_default: true }))

  // M365 provisioning state (InflowOnboarder v2)
  interface M365Actions {
    onboarding_id: number
    run_id: string | null
    run_status: string | null
    run_error: any
    run_result: any
    m365_user_id: string | null
    m365_upn: string | null
    approval_sent_at: string | null
    approval_status: string | null
    approved_by: string | null
    approved_at: string | null
    attempt_count_run: number
    is_v1_legacy: boolean
    create_account_status: string | null
    create_account_job_id: string | null
    licence_status: string | null
    licence_sku_id: string | null
    schedule_id: string | null
    schedule_status: string | null
    schedule_message: string | null
    schedule_stages: any[] | null
    schedule_next_due_at: string | null
    schedule_options: any | null
  }
  interface IfoSettings {
    approver_mode: 'manager' | 'nominated'
    approver_name: string | null
    approver_email: string | null
    account_domain: string | null
    licence_sku_id: string | null
    licence_sku_name: string | null
    licence_manager_name: string | null
    group_name: string | null
  }
  const [m365Actions, setM365Actions] = useState<M365Actions | null>(null)
  const [m365Upn, setM365Upn] = useState('')
  const [m365DisplayName, setM365DisplayName] = useState('')
  const [m365Location, setM365Location] = useState('GB')
  const [m365RunPolling, setM365RunPolling] = useState(false)
  const [m365Starting, setM365Starting] = useState(false)
  const [m365ApprovalSending, setM365ApprovalSending] = useState(false)
  const [m365Proceeding, setM365Proceeding] = useState(false)
  const [ifoConnected, setIfoConnected] = useState(false)
  const [ifoSettings, setIfoSettings] = useState<IfoSettings | null>(null)
  const [m365ScheduleMode, setM365ScheduleMode] = useState<'now' | 'schedule'>('now')
  const [m365SchedulingAvailable, setM365SchedulingAvailable] = useState(false)
  const [m365PrepareDays, setM365PrepareDays] = useState(3)
  const [m365ScheduleCreating, setM365ScheduleCreating] = useState(false)
  const [m365ScheduleCancelling, setM365ScheduleCancelling] = useState(false)
  const [m365ScheduleRefreshing, setM365ScheduleRefreshing] = useState(false)
  const [m365PanelRefreshing, setM365PanelRefreshing] = useState(false)


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
    'weekly hours': 'weekly_hours',
    'annual salary': 'annual_salary', 'tax code': 'tax_code', 'payroll id': 'payroll_id',
    'leave allowance': 'leave_allowance', 'assigned leave days': 'leave_allowance',
    'religion': 'religion', 'salary group': 'salary_group', 'qualifications': 'qualifications',
    'xero employee id': 'xero_employee_id',
    'employment category': 'employment_category', 'worker type': 'employment_category',
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
        if (isNonSso) {
          if (!out.employee_number) errors.push(`Row ${i + 2}: Missing Employee Number (required for Non-SSO)`)
        } else {
          if (!out.user_email) errors.push(`Row ${i + 2}: Missing Work Email`)
          else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.user_email))
            errors.push(`Row ${i + 2}: Invalid email "${out.user_email}"`)
        }
        return out
      })

      setUploadErrors(errors)
      setUploadRows(mapped)
    }
    reader.readAsArrayBuffer(file)
    e.target.value = ''
  }

  async function submitUpload() {
    if (uploadErrors.length > 0 || uploadRows.length === 0 || !selectedCompanyId) return
    const piiErrors: string[] = []
    uploadRows.forEach((row, i) => {
      const ni = validateNINumber(row.ni_number || '')
      const sc = validateSortCode(row.bank_sort_code || '')
      const ac = validateAccountNumber(row.bank_account_number || '')
      const rowErrs = [ni, sc, ac].filter(Boolean)
      if (rowErrs.length) piiErrors.push(`Row ${i + 1}: ${rowErrs.join(', ')}`)
    })
    if (piiErrors.length > 0) { showError(piiErrors.slice(0, 5).join(' | ')); return }
    setUploading(true)
    let success = 0, failed = 0

    await callRpcDirect('ensure_super_admin_access', { p_hours: 48 })

    const toInsert = uploadRows.map(row => {
      const s = sanitisePayload(row)
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
    const headers = ['First Name', 'Surname', 'Work Email', 'Personal Email', 'Job Title', 'Department', 'Manager Name', 'Manager Email', 'Location', 'Phone', 'Employee Number', 'Start Date', 'Contract Type', 'Date of Birth', 'Gender', 'Nationality', 'Marital Status', 'Religion', 'NI Number', 'Address Line 1', 'Address Line 2', 'City', 'County', 'Postcode', 'Country', 'Working Pattern', 'Weekly Hours', 'Probation End Date', 'Notice Period', 'Annual Salary', 'Salary Group', 'Tax Code', 'Payroll ID', 'Xero Employee ID', 'Leave Allowance', 'Qualifications', 'Emergency Contact Name', 'Emergency Contact Phone', 'Emergency Contact Relationship', 'Bank Account Name', 'Bank Sort Code', 'Bank Account Number']
    const ws = XLSX.utils.aoa_to_sheet([headers])
    ws['!cols'] = headers.map(() => ({ wch: 20 }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'New Starters')
    XLSX.writeFile(wb, 'new-starter-template.xlsx')
  }

  useEffect(() => {
    if (selectedCompanyId) {
      setRecords([])
      setOffboardRecords([])
      setFrozenEmployees([])
      load()
      loadOffboarding()
      loadCustomSteps()
      loadOffboardCustomSteps()
    }
  }, [selectedCompanyId])

  useEffect(() => {
    setOnbPage(1)
    setOffPage(1)
    setFrozenPage(1)
    setComplPage(1)
  }, [filterStatus, selectedCompanyId])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('onboarding').select('*, company:companies(name)').eq('company_id', selectedCompanyId).order('created_at', { ascending: false })
    setRecords((data as OnboardRecord[]) || [])
    setLoading(false)
  }

  async function loadOffboarding() {
    const [{ data: offData }, { data: frozenData }, { data: certData }] = await Promise.all([
      supabase.from('offboarding').select('*').eq('company_id', selectedCompanyId).order('created_at', { ascending: false }),
      supabase.from('frozen_employees').select('*').eq('company_id', selectedCompanyId).order('frozen_at', { ascending: false }),
      supabase.from('deletion_certificates').select('*').eq('company_id', selectedCompanyId).order('created_at', { ascending: false }),
    ])
    setOffboardRecords((offData as OffboardRecord[]) || [])
    setFrozenEmployees((frozenData as FrozenEmployee[]) || [])
    setDeletionCertificates((certData as DeletionCertificate[]) || [])
  }

  async function loadReviewData(employeeId: string) {
    const today = new Date().toISOString().split('T')[0]
    const [{ data: shifts }, { data: bookings }, { data: benefits }, { data: assets }] = await Promise.all([
      supabase.from('shift_assignments').select('id, date, shift_name, rota:rotas(name)').eq('employee_id', employeeId).gte('date', today),
      supabase.from('space_bookings').select('id, booking_date, space:spaces(name)').eq('employee_id', employeeId).gte('booking_date', today).neq('status', 'cancelled'),
      supabase.from('employee_benefits').select('id, benefit:benefits(name), enrolled_at').eq('employee_id', employeeId).is('unenrolled_at', null),
      supabase.from('company_assets').select('id, name, type, assigned_date').eq('assigned_to', employeeId),
    ])
    setReviewShifts((shifts || []).map((s: any) => ({ id: s.id, date: s.date, shift_name: s.shift_name || 'Shift', rota_name: s.rota?.name || '' })))
    setReviewBookings((bookings || []).map((b: any) => ({ id: b.id, booking_date: b.booking_date, space_name: b.space?.name || 'Space' })))
    setReviewBenefits((benefits || []).map((b: any) => ({ id: b.id, benefit_name: b.benefit?.name || 'Benefit', enrolled_at: b.enrolled_at })))
    setReviewAssets((assets || []).map((a: any) => ({ id: a.id, asset_name: a.name || 'Asset', asset_type: a.type || '', assigned_date: a.assigned_date || '' })))
  }

  async function loadOffboardCustomSteps() {
    if (!selectedCompanyId) return
    const { data } = await supabase.from('offboard_workflow_steps')
      .select('*').eq('company_id', selectedCompanyId).order('sort_order')
    if (data && data.length > 0) {
      setOffboardCustomSteps(data)
      setHasOffboardCustomSteps(true)
    } else {
      setOffboardCustomSteps([])
      setHasOffboardCustomSteps(false)
    }
  }

  async function loadCustomSteps() {
    if (!selectedCompanyId) return
    const { data } = await supabase.from('onboard_workflow_steps')
      .select('*').eq('company_id', selectedCompanyId).order('sort_order')
    if (data && data.length > 0) {
      setCustomSteps(data)
      setHasCustomSteps(true)
    } else {
      setCustomSteps([])
      setHasCustomSteps(false)
    }
  }

  async function saveCustomSteps() {
    if (!selectedCompanyId || !settingsDirty) return
    setSettingsSaving(true)
    try {
      await supabase.from('onboard_workflow_steps').delete().eq('company_id', selectedCompanyId)
      const rows = editingSteps.map((s, i) => ({
        company_id: selectedCompanyId,
        step_key: s.step_key,
        label: s.label,
        icon: s.icon,
        description: s.description,
        sort_order: i,
        is_default: s.is_default,
      }))
      const { error } = await supabase.from('onboard_workflow_steps').insert(rows)
      if (error) { showError('Failed to save workflow steps: ' + error.message); return }

      const oldStepKeys = new Set(activeSteps.map(s => s.step_key))
      const newStepKeys = editingSteps.map(s => s.step_key).filter(k => !oldStepKeys.has(k))
      if (newStepKeys.length > 0) {
        const { data: onboardedRecords } = await supabase.from('onboarding')
          .select('id, is_complete, custom_steps_completed')
          .eq('company_id', selectedCompanyId)
          .eq('is_complete', true)
        if (onboardedRecords) {
          for (const rec of onboardedRecords) {
            const existing = (rec.custom_steps_completed as Record<string, boolean>) || {}
            const updated = { ...existing }
            newStepKeys.forEach(k => { updated[k] = true })
            await supabase.from('onboarding').update({ custom_steps_completed: updated }).eq('id', rec.id)
          }
        }
      }

      showSuccess('Workflow steps saved')
      setSettingsDirty(false)
      loadCustomSteps()
      load()
    } finally {
      setSettingsSaving(false)
    }
  }

  function initEditingSteps() {
    const steps = hasCustomSteps
      ? customSteps.map(s => ({ ...s }))
      : WORKFLOW_STEPS.map((s, i) => ({ step_key: s.key, label: s.label, icon: s.icon, description: s.description, sort_order: i, is_default: true }))
    setEditingSteps(steps)
    setSettingsDirty(false)
    setEditingIdx(null)
  }

  async function searchEmployeesForOffboard(query: string) {
    setOffboardEmployeeSearch(query)
    if (query.length < 2) { setOffboardEmployeeResults([]); return }
    const { data } = await supabase.from('employees')
      .select('id, first_name, last_name, email, job_title, department')
      .eq('company_id', selectedCompanyId)
      .eq('is_active', true)
      .eq('is_frozen', false)
      .or(`first_name.ilike.%${query.replace(/[,.()"\\]/g, '')}%,last_name.ilike.%${query.replace(/[,.()"\\]/g, '')}%,email.ilike.%${query.replace(/[,.()"\\]/g, '')}%`)
      .limit(10)
    setOffboardEmployeeResults(data || [])
  }

  async function createOffboardRecord(emp: typeof offboardEmployeeResults[0]) {
    const { error } = await supabase.from('offboarding').insert({
      company_id: selectedCompanyId,
      employee_id: emp.id,
      employee_name: `${emp.first_name} ${emp.last_name}`,
      employee_email: emp.email,
      job_title: emp.job_title,
      department: emp.department,
      end_date: offboardForm.end_date || null,
      reason: offboardForm.reason || null,
      status: 'pending',
    })
    if (error) { showError('Failed to create offboarding record: ' + error.message); return }
    showSuccess(`Offboarding started for ${emp.first_name} ${emp.last_name}`)
    setOffboardEmployeeSearch('')
    setOffboardEmployeeResults([])
    setOffboardForm({ end_date: '', reason: '' })
    loadOffboarding()
  }

  function openOffboardWorkflow(record: OffboardRecord) {
    setOffboardSelectedId(record.id)
    setOffboardChecks(record.workflow_steps || {})
    setOffboardSkips(record.skipped_steps || {})
    const doneCount = OFFBOARD_STEPS.filter(s => record.workflow_steps?.[s.key] || record.skipped_steps?.[s.key]).length
    const nextStep = record.is_complete ? OFFBOARD_STEPS.length - 1 : Math.min(doneCount, OFFBOARD_STEPS.length - 1)
    setOffboardStep(nextStep)
    if (OFFBOARD_STEPS[nextStep]?.key === 'reassign_reports' && !record.workflow_steps?.reassign_reports && !record.skipped_steps?.reassign_reports) {
      loadReassignData(record)
    }
    if (OFFBOARD_STEPS[nextStep]?.key === 'remove_accounts') {
      loadLeaverM365Actions(record.id)
    }
    loadReviewData(record.employee_id)
    setTab('offboard-workflow')
  }

  async function completeOffboardStep(stepKey: string) {
    const record = offboardRecords.find(r => r.id === offboardSelectedId)
    if (!record) return
    const newChecks = { ...offboardChecks, [stepKey]: true }
    const newSkips = { ...offboardSkips, [stepKey]: false }
    setOffboardChecks(newChecks)
    setOffboardSkips(newSkips)

    const isLastStep = stepKey === OFFBOARD_STEPS[OFFBOARD_STEPS.length - 1].key
    if (isLastStep) {
      setShowFreezeModal(record)
      return
    }

    await supabase.from('offboarding').update({
      workflow_steps: newChecks,
      skipped_steps: newSkips,
      status: 'in-progress',
    }).eq('id', record.id)
    loadOffboarding()
    const nextIdx = offboardStep + 1
    if (nextIdx < OFFBOARD_STEPS.length) {
      setOffboardStep(nextIdx)
      if (OFFBOARD_STEPS[nextIdx]?.key === 'remove_accounts') loadLeaverM365Actions(record.id)
    }
  }

  async function skipOffboardStep(stepKey: string) {
    const record = offboardRecords.find(r => r.id === offboardSelectedId)
    if (!record) return
    const newSkips = { ...offboardSkips, [stepKey]: true }
    setOffboardSkips(newSkips)
    await supabase.from('offboarding').update({
      skipped_steps: newSkips,
      status: 'in-progress',
    }).eq('id', record.id)
    loadOffboarding()
    const nextIdx = offboardStep + 1
    if (nextIdx < OFFBOARD_STEPS.length) {
      setOffboardStep(nextIdx)
      if (OFFBOARD_STEPS[nextIdx]?.key === 'remove_accounts') loadLeaverM365Actions(record.id)
    }
  }

  async function uncompleteOffboardStep(stepKey: string) {
    const record = offboardRecords.find(r => r.id === offboardSelectedId)
    if (!record) return
    const newChecks = { ...offboardChecks, [stepKey]: false }
    const newSkips = { ...offboardSkips, [stepKey]: false }
    setOffboardChecks(newChecks)
    setOffboardSkips(newSkips)
    await supabase.from('offboarding').update({
      workflow_steps: newChecks,
      skipped_steps: newSkips,
    }).eq('id', record.id)
    loadOffboarding()
  }

  async function loadReassignData(record: OffboardRecord) {
    const today = new Date().toISOString().split('T')[0]
    const [reportsRes, pendingRes, candidatesRes, meetingsRes, validationsRes] = await Promise.all([
      supabase.from('employees').select('id, first_name, last_name, email')
        .eq('company_id', record.company_id).eq('manager_id', record.employee_id).eq('is_active', true),
      supabase.from('workflow_tracker').select('id', { count: 'exact', head: true })
        .eq('assigned_to', record.employee_email).eq('status', 'Pending').eq('company_id', record.company_id),
      supabase.from('employees').select('id, first_name, last_name, email')
        .eq('company_id', record.company_id).eq('is_active', true).neq('id', record.employee_id).order('first_name'),
      supabase.from('one_to_one_meetings').select('id', { count: 'exact', head: true })
        .eq('manager_id', record.employee_id).gte('scheduled_date', today),
      supabase.from('skill_validations').select('id', { count: 'exact', head: true })
        .eq('assigned_to', record.employee_id).eq('status', 'pending'),
    ])
    setReassignData({
      directReports: (reportsRes.data || []) as { id: string; first_name: string; last_name: string; email: string }[],
      pendingActions: (pendingRes.count || 0) + (meetingsRes.count || 0) + (validationsRes.count || 0),
    })
    setReassignCandidates((candidatesRes.data || []) as { id: string; first_name: string; last_name: string; email: string }[])
    setReassignTargetId('')
  }

  async function executeReassignment(record: OffboardRecord) {
    if (!reassignTargetId || !reassignData) return
    setReassignSaving(true)
    const target = reassignCandidates.find(c => c.id === reassignTargetId)
    if (!target) { setReassignSaving(false); return }

    const subIds = reassignData.directReports.map(r => r.id)
    if (subIds.length > 0) {
      await supabase.from('employees').update({ manager_id: reassignTargetId, manager_email: target.email })
        .in('id', subIds).eq('company_id', record.company_id)
    }

    if (reassignData.pendingActions > 0) {
      await supabase.from('workflow_tracker').update({ assigned_to: target.email })
        .eq('assigned_to', record.employee_email).eq('status', 'Pending').eq('company_id', record.company_id)
    }

    if (subIds.length > 0) {
      const { data: goalsToReassign } = await supabase.from('performance_goals')
        .select('id, employee_id')
        .eq('manager_id', record.employee_id)
        .in('status', ['active', 'pending', 'in_progress'])
        .eq('company_id', record.company_id)

      if (goalsToReassign && goalsToReassign.length > 0) {
        await supabase.from('performance_goals')
          .update({ manager_id: reassignTargetId, updated_at: new Date().toISOString() })
          .in('id', goalsToReassign.map(g => g.id))
          .eq('company_id', record.company_id)

        const targetName = `${target.first_name} ${target.last_name}`
        await supabase.from('workflow_tracker').insert({
          emp_display_name: targetName,
          step: 1,
          status: 'Complete',
          record_type: 'Performance',
          action: 'Goals reassigned during offboarding',
          employee_email: target.email,
          assigned_to: target.email,
          task_description: `${goalsToReassign.length} goal(s) reassigned to you from ${record.employee_name}'s direct reports`,
          approval_status: 'Reassigned',
          reminder_count: 1,
          company_id: record.company_id,
        })
        window.dispatchEvent(new Event('notifications-updated'))
      }
    }

    const today = new Date().toISOString().split('T')[0]
    const { data: futureMeetings } = await supabase.from('one_to_one_meetings')
      .select('id').eq('manager_id', record.employee_id).gte('scheduled_date', today)
    if (futureMeetings && futureMeetings.length > 0) {
      await supabase.from('one_to_one_meetings')
        .update({ manager_id: reassignTargetId })
        .in('id', futureMeetings.map(m => m.id))
    }

    const { data: pendingValidations } = await supabase.from('skill_validations')
      .select('id').eq('assigned_to', record.employee_id).eq('status', 'pending')
    if (pendingValidations && pendingValidations.length > 0) {
      await supabase.from('skill_validations')
        .update({ assigned_to: reassignTargetId })
        .in('id', pendingValidations.map(v => v.id))
    }

    const extras = (futureMeetings?.length || 0) + (pendingValidations?.length || 0)
    setReassignSaving(false)
    showSuccess(`${reassignData.directReports.length} employee(s), ${reassignData.pendingActions} pending action(s)${extras > 0 ? `, ${extras} meeting(s)/validation(s)` : ''} reassigned to ${target.first_name} ${target.last_name}`)
    completeOffboardStep('reassign_reports')
  }

  async function freezeEmployee(record: OffboardRecord, approve: boolean) {
    setShowFreezeModal(null)
    if (!approve) {
      showSuccess('Freeze declined — offboarding workflow left open')
      return
    }
    const newChecks = { ...offboardChecks, [OFFBOARD_STEPS[OFFBOARD_STEPS.length - 1].key]: true }
    await supabase.from('offboarding').update({
      workflow_steps: newChecks,
      skipped_steps: offboardSkips,
      is_complete: true,
      status: 'complete',
      frozen_at: new Date().toISOString(),
    }).eq('id', record.id)

    await supabase.from('employees').update({ is_active: false, is_frozen: true }).eq('id', record.employee_id)
    await supabase.from('company_users').update({ is_active: false }).eq('employee_id', record.employee_id).eq('company_id', selectedCompanyId)

    const deletionDate = new Date()
    deletionDate.setDate(deletionDate.getDate() + 30)
    const delDateStr = `${deletionDate.getFullYear()}-${String(deletionDate.getMonth() + 1).padStart(2, '0')}-${String(deletionDate.getDate()).padStart(2, '0')}`
    await supabase.from('frozen_employees').upsert({
      company_id: selectedCompanyId,
      employee_id: record.employee_id,
      employee_name: record.employee_name,
      employee_email: record.employee_email,
      deletion_date: delDateStr,
      status: 'awaiting_expiry',
    }, { onConflict: 'company_id,employee_id' })

    showSuccess(`${record.employee_name} has been frozen and added to deletion queue`)
    loadOffboarding()
    load()
    setTab('offboarding')
  }

  async function recoverEmployee(frozen: FrozenEmployee) {
    await supabase.from('employees').update({ is_active: true, is_frozen: false }).eq('id', frozen.employee_id)
    await supabase.from('company_users').update({ is_active: true }).eq('employee_id', frozen.employee_id).eq('company_id', selectedCompanyId)
    await supabase.from('frozen_employees').update({ status: 'recovered', recovered_at: new Date().toISOString() }).eq('id', frozen.id)
    showSuccess(`${frozen.employee_name} has been recovered and can log in again`)
    loadOffboarding()
    load()
  }

  async function cancelOffboarding(record: OffboardRecord) {
    if (!confirm(`Cancel offboarding for ${record.employee_name}?`)) return
    const { error } = await supabase.from('offboarding').delete().eq('id', record.id)
    if (error) { showError('Failed to cancel offboarding: ' + error.message); return }
    showSuccess(`Offboarding cancelled for ${record.employee_name}`)
    if (offboardSelectedId === record.id) { setOffboardSelectedId(null); setTab('offboarding') }
    loadOffboarding()
  }

  async function deleteEmployee(frozen: FrozenEmployee) {
    if (!confirm(`Permanently delete ${frozen.employee_name}? This will remove ALL data and generate a deletion certificate. This cannot be undone.`)) return
    const { data, error } = await callRpcDirect('delete_employee_permanently', { p_employee_id: frozen.employee_id })
    if (error) { showError('Failed to delete: ' + error); return }
    showSuccess(`${frozen.employee_name} has been permanently deleted. Deletion certificate generated: ${(data as any)?.certificate_ref || 'N/A'}`)
    loadOffboarding()
    load()
  }

  async function extendFrozenPeriod(frozen: FrozenEmployee) {
    if (frozen.extended_at) { showError('Extension already applied — maximum one extension per employee'); return }
    if (!confirm(`Extend deletion date for ${frozen.employee_name} by 15 days?`)) return
    await supabase.from('frozen_employees').update({ extended_at: new Date().toISOString(), extension_days: 15 }).eq('id', frozen.id)
    showSuccess(`Deletion date extended by 15 days for ${frozen.employee_name}`)
    loadOffboarding()
  }

  async function cancelAllShifts(record: OffboardRecord) {
    if (reviewShifts.length === 0) return
    const ids = reviewShifts.map(s => s.id)
    await supabase.from('shift_assignments').delete().in('id', ids)
    await supabase.from('offboarding').update({ cleanup_shifts_done: true }).eq('id', record.id)
    setReviewShifts([])
    completeOffboardStep('review_shifts')
    showSuccess(`${ids.length} future shift(s) cancelled`)
  }

  async function cancelAllBookings(record: OffboardRecord) {
    if (reviewBookings.length === 0) return
    const ids = reviewBookings.map(b => b.id)
    await supabase.from('space_bookings').update({ status: 'cancelled' }).in('id', ids)
    await supabase.from('offboarding').update({ cleanup_bookings_done: true }).eq('id', record.id)
    setReviewBookings([])
    completeOffboardStep('review_bookings')
    showSuccess(`${ids.length} future booking(s) cancelled`)
  }

  async function unenrolAllBenefits(record: OffboardRecord) {
    if (reviewBenefits.length === 0) return
    const ids = reviewBenefits.map(b => b.id)
    await supabase.from('employee_benefits').update({ unenrolled_at: new Date().toISOString(), unenrolled_reason: 'offboarding' }).in('id', ids)
    await supabase.from('offboarding').update({ cleanup_benefits_done: true }).eq('id', record.id)
    setReviewBenefits([])
    completeOffboardStep('review_benefits')
    showSuccess(`${ids.length} benefit enrolment(s) cancelled`)
  }

  async function confirmAssets(record: OffboardRecord) {
    await supabase.from('offboarding').update({ cleanup_assets_done: true }).eq('id', record.id)
    completeOffboardStep('review_assets')
    showSuccess('Company assets confirmed as accounted for')
  }

  async function generateDataExport(record: OffboardRecord) {
    try {
      const { data: exportData, error } = await callRpcDirect('export_employee_data', { p_employee_id: record.employee_id })
      if (error) throw error
      const { generateLeaverExport } = await import('../../lib/employeeDataExport')
      const blob = await generateLeaverExport(exportData as any, record.employee_name, record.end_date, record.reason)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${record.employee_name.replace(/\s+/g, '_')}_Leaver_Data_Export.zip`
      a.click()
      URL.revokeObjectURL(url)
      await supabase.from('offboarding').update({ data_exported_at: new Date().toISOString() }).eq('id', record.id)
      completeOffboardStep('export_data')
      showSuccess('Leaver data export downloaded successfully')
    } catch (err: any) {
      showError('Export failed: ' + (err?.message || 'Unknown error'))
    }
  }

  async function saveOffboardCustomSteps() {
    if (!selectedCompanyId) return
    setSettingsSaving(true)
    try {
      await supabase.from('offboard_workflow_steps').delete().eq('company_id', selectedCompanyId)
      const rows = offboardEditingSteps.map((s, i) => ({
        company_id: selectedCompanyId,
        step_key: s.step_key,
        label: s.label,
        icon: s.icon,
        description: s.description,
        sort_order: i,
        is_default: s.is_default,
      }))
      const { error } = await supabase.from('offboard_workflow_steps').insert(rows)
      if (error) { showError('Failed to save offboarding steps: ' + error.message); return }
      await loadOffboardCustomSteps()
      setSettingsDirty(false)
      showSuccess('Offboarding workflow steps saved')
    } finally {
      setSettingsSaving(false)
    }
  }

  function stripFormulaChars(val: string): string {
    return val.replace(/^[=+\-@\t\r]+/, '')
  }

  function sanitisePayload(form: Record<string, string>): Record<string, any> {
    const dateFields = ['start_date', 'date_of_birth', 'probation_end_date']
    const numericFields = ['weekly_hours', 'annual_salary', 'leave_allowance']
    const out: Record<string, any> = {}
    for (const [k, v] of Object.entries(form)) {
      if (dateFields.includes(k)) { out[k] = v || null }
      else if (numericFields.includes(k)) { out[k] = v ? parseFloat(v) : null }
      else { out[k] = v ? stripFormulaChars(v) : null }
    }
    return out
  }

  const isNonSso = selectedCompany?.auth_mode === 'non_sso'

  async function createStarter() {
    const emailRequired = !isNonSso
    if (!newForm.firstname || !newForm.surname || !selectedCompanyId) return
    if (emailRequired && !newForm.user_email) { showError('Work email is required for SSO companies'); return }
    if (isNonSso && !newForm.employee_number) { showError('Unique Employee ID is required for Non-SSO companies'); return }
    const niErr = validateNINumber(newForm.ni_number || '')
    if (niErr) { showError(niErr); return }
    const scErr = validateSortCode(newForm.bank_sort_code || '')
    if (scErr) { showError(scErr); return }
    const acErr = validateAccountNumber(newForm.bank_account_number || '')
    if (acErr) { showError(acErr); return }
    const sanitised = sanitisePayload(newForm)
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
      if (features.inflowonboarder_integration) {
        setM365Actions(null)
        const domain = ifoSettings?.account_domain
        setM365Upn(domain ? `${data.firstname.toLowerCase()}.${data.surname.toLowerCase()}@${domain}` : data.user_email)
        setM365DisplayName(`${data.firstname} ${data.surname}`)
        setM365Location('GB')
        loadM365Actions(data.id)
      }
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

  // ── M365 provisioning helpers (v2 workflow runs) ────────────────────────

  async function callIfo(action: string, body: Record<string, unknown> = {}) {
    if (!session || !selectedCompanyId) { console.log('[IFO] no session/company, skipping', action); return null }
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    console.log('[IFO] calling', action, body)
    const res = await fetch(`${supabaseUrl}/functions/v1/inflowonboarder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ company_id: selectedCompanyId, action, ...body }),
    })
    const data = await res.json()
    console.log('[IFO]', action, 'response:', res.status, data)
    if (!res.ok) { showError(data.error || 'Request failed'); return null }
    return data
  }

  async function callIfoLeaver(action: string, body: Record<string, unknown> = {}) {
    if (!session || !selectedCompanyId) { console.log('[IFO-LEAVER] no session/company, skipping', action); return null }
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    console.log('[IFO-LEAVER] calling', action, body)
    const res = await fetch(`${supabaseUrl}/functions/v1/inflowonboarder-leaver`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ company_id: selectedCompanyId, action, ...body }),
    })
    const data = await res.json()
    console.log('[IFO-LEAVER]', action, 'response:', res.status, data)
    if (!res.ok) { showError(data.error || 'Request failed'); return null }
    return data
  }

  async function loadM365Actions(onboardingId: number) {
    const [{ data }, { data: ifo }, { data: schedulingFlag }] = await Promise.all([
      supabase.from('onboarding_m365_actions').select('*').eq('onboarding_id', onboardingId).maybeSingle(),
      supabase.from('inflowonboarder_integrations')
        .select('status, approver_mode, approver_name, approver_email, account_domain, licence_sku_id, licence_sku_name, licence_manager_name, group_name, schedule_templates_cache')
        .eq('company_id', selectedCompanyId).maybeSingle(),
      supabase.from('company_features').select('is_enabled').eq('company_id', selectedCompanyId).eq('feature_key', 'm365_scheduling').maybeSingle(),
    ])
    setM365Actions(data as M365Actions | null)
    const m365SchedulingEnabled = schedulingFlag?.is_enabled === true
    setIfoConnected(ifo?.status === 'connected_ready')
    if (ifo) {
      setIfoSettings({
        approver_mode: ifo.approver_mode || 'manager',
        approver_name: ifo.approver_name,
        approver_email: ifo.approver_email,
        account_domain: ifo.account_domain,
        licence_sku_id: ifo.licence_sku_id,
        licence_sku_name: ifo.licence_sku_name,
        licence_manager_name: ifo.licence_manager_name,
        group_name: ifo.group_name,
      })
      const templates = Array.isArray(ifo.schedule_templates_cache) ? ifo.schedule_templates_cache : []
      const hasJoiner = templates.some((t: any) => t.id === 'hr.joiner' || t.templateId === 'hr.joiner')
      setM365SchedulingAvailable(hasJoiner && m365SchedulingEnabled)
    }
    if (data?.run_id && (!data?.run_status || ['checking_licence', 'provisioning'].includes(data?.run_status))) {
      const freshStatus = await callIfo('check-run', { run_id: data.run_id, onboarding_id: onboardingId })
      if (freshStatus?.status && freshStatus.status !== data.run_status) {
        const { data: refreshed } = await supabase.from('onboarding_m365_actions').select('*').eq('onboarding_id', onboardingId).maybeSingle()
        setM365Actions(refreshed as M365Actions | null)
      } else if (freshStatus?.status === 'checking_licence') {
        m365PollRun(data.run_id, onboardingId)
      }
    }
  }

  useEffect(() => {
    if (!selectedId || !m365Actions) return
    const isTerminal = m365Actions.run_status === 'completed' || m365Actions.run_status === 'failed'
    const isEngineStatus = !!m365Actions.run_status && !isTerminal
    const needsPoll = m365Actions.approval_status === 'pending' || (isEngineStatus && !['checking_licence', 'provisioning'].includes(m365Actions.run_status || ''))
    if (!needsPoll) return
    const slowPollStatuses = ['ready_for_approval', 'awaiting_approval']
    const pollInterval = slowPollStatuses.includes(m365Actions.run_status || '') || m365Actions.approval_status === 'pending' ? 5000 : 10000
    const timer = setInterval(async () => {
      const [{ data }, { data: wt }] = await Promise.all([
        supabase.from('onboarding_m365_actions').select('*').eq('onboarding_id', selectedId).maybeSingle(),
        supabase.from('workflow_tracker').select('status, approval_status, assigned_to, updated_at, created_at')
          .eq('onboard_id', selectedId).eq('record_type', 'M365 Provisioning').order('created_at', { ascending: false }).limit(1).maybeSingle(),
      ])
      if (data) {
        const merged = { ...data } as M365Actions
        if (wt) {
          merged.approval_sent_at = merged.approval_sent_at || wt.created_at
          if (wt.status === 'Complete' && (wt.approval_status === 'Approved' || wt.approval_status === 'Declined')) {
            merged.approval_status = wt.approval_status === 'Approved' ? 'approved' : 'declined'
            merged.approved_by = wt.assigned_to || 'Approver'
            merged.approved_at = wt.updated_at || new Date().toISOString()
          } else if (wt.status === 'Pending') {
            merged.approval_status = 'pending'
          }
        }
        setM365Actions(merged)
      }
    }, pollInterval)
    return () => clearInterval(timer)
  }, [m365Actions?.run_id, m365Actions?.approval_status, m365Actions?.run_status, selectedId])

  async function m365StartRun(record: OnboardRecord) {
    setM365Starting(true)
    const upn = m365Upn || record.user_email
    const result = await callIfo('start-run', {
      onboarding_id: record.id,
      attempt: m365Actions?.attempt_count_run || 0,
      input: {
        givenName: record.firstname,
        surname: record.surname,
        displayName: m365DisplayName || `${record.firstname} ${record.surname}`,
        userPrincipalName: upn,
        usageLocation: m365Location || 'GB',
        ...(record.job_title ? { jobTitle: record.job_title } : {}),
        ...(record.department ? { department: record.department } : {}),
        ...(record.start_date ? { employeeHireDate: record.start_date.slice(0, 10) } : {}),
      },
    })
    setM365Starting(false)
    if (result?.run_id) {
      showSuccess('M365 provisioning workflow started')
      await loadM365Actions(record.id)
      if (result.status === 'checking_licence') {
        m365PollRun(result.run_id, record.id)
      }
    }
  }

  async function m365PollRun(runId: string, onboardingId: number) {
    setM365RunPolling(true)
    for (let i = 0; i < 6; i++) {
      await new Promise(r => setTimeout(r, 5000))
      const result = await callIfo('check-run', { run_id: runId, onboarding_id: onboardingId })
      if (!result) break
      if (['ready_for_approval', 'licence_unavailable', 'completed', 'failed'].includes(result.status)) {
        if (result.status === 'completed') showSuccess('M365 provisioning complete')
        else if (result.status === 'failed') showError(result.friendlyError || 'Workflow failed')
        await loadM365Actions(onboardingId)
        setM365RunPolling(false)
        return
      }
    }
    await loadM365Actions(onboardingId)
    setM365RunPolling(false)
  }

  async function m365RefreshStatus(runId: string, onboardingId: number) {
    setM365RunPolling(true)
    const result = await callIfo('check-run', { run_id: runId, onboarding_id: onboardingId })
    if (result?.status) {
      if (result.status === 'completed') showSuccess('M365 provisioning complete')
      else if (result.status === 'failed') showError(result.friendlyError || 'Workflow failed')
      else if (result.status === 'ready_for_approval') showSuccess('Licence available — ready for approval')
      else if (result.status === 'licence_unavailable') showError(result.friendlyError || 'No licence seats available')
    }
    await loadM365Actions(onboardingId)
    setM365RunPolling(false)
  }

  async function m365RecheckRun(runId: string, onboardingId: number) {
    setM365RunPolling(true)
    const result = await callIfo('recheck-run', { run_id: runId, onboarding_id: onboardingId, attempt: (m365Actions?.attempt_count_run || 0) + 1 })
    if (result) {
      if (result.status === 'ready_for_approval') showSuccess('Licence now available — ready for approval')
      else if (result.status === 'licence_unavailable') showError(result.friendlyError || 'Still no seats available')
      await loadM365Actions(onboardingId)
    }
    setM365RunPolling(false)
  }

  async function m365SendApproval(record: OnboardRecord) {
    if (!ifoSettings) return
    setM365ApprovalSending(true)

    let approverEmail = ifoSettings.approver_email
    let approverName = ifoSettings.approver_name
    if (ifoSettings.approver_mode === 'manager') {
      approverEmail = (record as any).manager_email
      approverName = (record as any).manager
      if (!approverEmail) {
        showError('This starter has no manager set. Set a manager first, or switch to a nominated approver in the Integrations settings.')
        setM365ApprovalSending(false)
        return
      }
    }

    const starterName = `${record.firstname} ${record.surname}`
    const upn = m365Actions?.m365_upn || m365Upn || record.user_email
    const startDateStr = record.start_date ? new Date(record.start_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : ''
    const taskDesc = `${starterName} — ${record.job_title || 'New Starter'}${startDateStr ? `, starting ${startDateStr}` : ''}\nM365 account: ${upn}`

    const { error: wtErr } = await supabase.from('workflow_tracker').insert({
      company_id: selectedCompanyId,
      record_type: 'M365 Provisioning',
      onboard_id: record.id,
      emp_display_name: `${record.firstname} ${record.surname}`,
      action: 'Approve',
      employee_email: approverEmail,
      assigned_to: approverEmail,
      status: 'Pending',
      approval_status: 'pending',
      task_description: taskDesc,
    })
    if (wtErr) {
      showError(`Failed to create approval task: ${wtErr.message}`)
      setM365ApprovalSending(false)
      return
    }

    const { data: approverEmp } = await supabase.from('employees')
      .select('id').eq('user_email', approverEmail).eq('company_id', selectedCompanyId).maybeSingle()
    if (approverEmp) {
      await supabase.from('notifications').insert({
        company_id: selectedCompanyId,
        employee_id: approverEmp.id,
        type: 'action',
        notification_type: 'm365_approval',
        title: 'M365 Provisioning Approval',
        message: `Please approve M365 account provisioning for ${record.firstname} ${record.surname}`,
        send_email: true,
      })
    }

    await supabase.from('onboarding_m365_actions').update({
      approval_sent_at: new Date().toISOString(),
      approval_status: 'pending',
      updated_at: new Date().toISOString(),
    }).eq('onboarding_id', record.id)

    try {
      await callIfo('check-run', { run_id: m365Actions?.run_id, onboarding_id: record.id })
    } catch (_) {}

    showSuccess(`Approval request sent to ${approverName || approverEmail}`)
    await loadM365Actions(record.id)
    setM365ApprovalSending(false)
  }

  async function m365ProceedRun(record: OnboardRecord) {
    if (!m365Actions?.run_id) return
    setM365Proceeding(true)
    const approvedByRaw = m365Actions.approved_by || ''
    const emailMatch = approvedByRaw.match(/<([^>]+)>/)
    const approverEmail = emailMatch ? emailMatch[1] : approvedByRaw
    const approverName = emailMatch ? approvedByRaw.replace(/<[^>]+>/, '').trim() : approvedByRaw
    const result = await callIfo('proceed-run', {
      run_id: m365Actions.run_id,
      onboarding_id: record.id,
      approver_name: approverName,
      approver_email: approverEmail,
      approved_at: m365Actions.approved_at,
      attempt: (m365Actions?.attempt_count_run || 0) + 1,
    })
    setM365Proceeding(false)
    if (result) {
      if (result.status === 'completed') {
        showSuccess('M365 provisioning complete')
      } else if (result.status === 'provisioning' || result.status === 'checking_licence') {
        showSuccess('Provisioning started — polling for completion...')
        m365PollRun(m365Actions.run_id, record.id)
        return
      } else if (result.status === 'failed') {
        showError(result.friendlyError || 'Provisioning failed')
      }
      await loadM365Actions(record.id)
    }
  }

  async function m365MarkCompleteManual(onboardingId: number) {
    const result = await callIfo('mark-complete-manual', { onboarding_id: onboardingId })
    if (result) {
      showSuccess('Marked as manually completed')
      await loadM365Actions(onboardingId)
    }
  }

  // ── M365 scheduling helpers (joiner) ────────────────────────────────────

  async function m365SendScheduleApproval(record: OnboardRecord) {
    if (!selectedCompanyId) return
    setM365ApprovalSending(true)
    const startDate = record.start_date
    const prepDate = new Date(new Date(startDate).getTime() - m365PrepareDays * 86400000)
    const planDesc = `Schedule M365 Account for ${record.firstname} ${record.surname}:\n` +
      `• Prepare account: ${prepDate.toLocaleDateString('en-GB')} at 09:00\n` +
      `• Enable sign-in: ${new Date(startDate).toLocaleDateString('en-GB')} at 08:00`
    const approverMode = ifoSettings?.approver_mode || 'manager'
    let approverEmpId: string | null = null
    if (approverMode === 'manager' && record.manager_email) {
      const { data: mgr } = await supabase.from('employees').select('id').eq('user_email', record.manager_email).eq('company_id', selectedCompanyId).maybeSingle()
      approverEmpId = mgr?.id || null
    } else if (approverMode === 'nominated' && ifoSettings?.approver_email) {
      const { data: nom } = await supabase.from('employees').select('id').eq('user_email', ifoSettings.approver_email).eq('company_id', selectedCompanyId).maybeSingle()
      approverEmpId = nom?.id || null
    }
    if (!approverEmpId) { showError('Could not find the approver. Check the approver settings on the Integrations page.'); setM365ApprovalSending(false); return }
    await supabase.from('workflow_tracker').insert({
      company_id: selectedCompanyId,
      record_id: record.id,
      record_type: 'M365 Scheduling',
      task_description: planDesc,
      assigned_to: approverEmpId,
      status: 'pending',
    })
    await supabase.from('notifications').insert({
      company_id: selectedCompanyId,
      employee_id: approverEmpId,
      type: 'action',
      title: 'M365 Schedule Approval Required',
      message: `Please approve the M365 account schedule for ${record.firstname} ${record.surname}.`,
      is_read: false,
      action_type: 'M365 Scheduling',
      action_record_id: record.id,
    })
    await supabase.from('onboarding_m365_actions').upsert({
      onboarding_id: record.id,
      company_id: selectedCompanyId,
      approval_sent_at: new Date().toISOString(),
      approval_status: 'pending',
      schedule_status: 'pending_approval',
      schedule_options: { prepareDaysBefore: m365PrepareDays },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'onboarding_id' })
    showSuccess('Schedule approval sent')
    setM365ApprovalSending(false)
    await loadM365Actions(record.id)
  }

  async function m365CreateSchedule(record: OnboardRecord) {
    if (!selectedCompanyId || !m365Actions) return
    setM365ScheduleCreating(true)
    const upn = m365Upn || record.user_email
    const result = await callIfo('create-schedule', {
      onboarding_id: record.id,
      input: {
        givenName: record.firstname,
        surname: record.surname,
        displayName: m365DisplayName || `${record.firstname} ${record.surname}`,
        userPrincipalName: upn,
        usageLocation: m365Location || 'GB',
        startDate: record.start_date,
        jobTitle: record.job_title,
        department: record.department,
        employeeHireDate: record.start_date,
      },
      options: { prepareDaysBefore: m365Actions.schedule_options?.prepareDaysBefore || m365PrepareDays },
      approver_name: m365Actions.approved_by || 'InflowHR Approver',
      approver_email: ifoSettings?.approver_email || '',
      approved_at: m365Actions.approved_at || new Date().toISOString(),
      attempt: m365Actions.attempt_count_run || 0,
    })
    setM365ScheduleCreating(false)
    if (result) {
      if (result.use_run_now) {
        showError(result.error || 'Start date is too close — use Run Now instead')
        setM365ScheduleMode('now')
      } else {
        showSuccess('Schedule created')
      }
      await loadM365Actions(record.id)
    }
  }

  async function m365RefreshSchedule(scheduleId: string, onboardingId: number) {
    setM365ScheduleRefreshing(true)
    await callIfo('get-schedule', { schedule_id: scheduleId, onboarding_id: onboardingId })
    await loadM365Actions(onboardingId)
    setM365ScheduleRefreshing(false)
  }

  async function m365CancelSchedule(scheduleId: string, onboardingId: number, reason: string) {
    if (!confirm('Cancel this schedule? The engine will release any reserved licences and groups.')) return
    setM365ScheduleCancelling(true)
    const result = await callIfo('cancel-schedule', { schedule_id: scheduleId, onboarding_id: onboardingId, reason })
    setM365ScheduleCancelling(false)
    if (result) {
      showSuccess('Schedule cancelled')
      await loadM365Actions(onboardingId)
    }
  }

  async function m365RecheckSchedule(scheduleId: string, onboardingId: number) {
    setM365ScheduleRefreshing(true)
    const result = await callIfo('recheck-schedule', { schedule_id: scheduleId, onboarding_id: onboardingId })
    setM365ScheduleRefreshing(false)
    if (result) {
      showSuccess('Schedule rechecked')
      await loadM365Actions(onboardingId)
    }
  }

  // ── M365 offboarding helpers (leaver workflow runs) ────────────────────
  interface LeaverM365Actions {
    offboarding_id: number
    run_id: string | null
    run_status: string | null
    run_error: any
    run_result: any
    approval_sent_at: string | null
    approval_status: string | null
    approved_by: string | null
    approved_at: string | null
    employee_upn: string | null
    attempt_count_run: number
    schedule_id: string | null
    schedule_status: string | null
    schedule_message: string | null
    schedule_stages: any[] | null
    schedule_next_due_at: string | null
    schedule_options: any | null
  }
  interface IfoOffboardSettings {
    offboard_approver_mode: 'same_as_joiner' | 'nominated' | 'manager'
    offboard_approver_name: string | null
    offboard_approver_email: string | null
    approver_mode: 'manager' | 'nominated'
    approver_name: string | null
    approver_email: string | null
  }
  const [leaverM365Actions, setLeaverM365Actions] = useState<LeaverM365Actions | null>(null)
  const [leaverM365RunPolling, setLeaverM365RunPolling] = useState(false)
  const [leaverM365Starting, setLeaverM365Starting] = useState(false)
  const [leaverM365ApprovalSending, setLeaverM365ApprovalSending] = useState(false)
  const [leaverM365Proceeding, setLeaverM365Proceeding] = useState(false)
  const [leaverM365Refreshing, setLeaverM365Refreshing] = useState(false)
  const [ifoOffboardSettings, setIfoOffboardSettings] = useState<IfoOffboardSettings | null>(null)
  const [leaverScheduleMode, setLeaverScheduleMode] = useState<'now' | 'schedule'>('now')
  const [leaverSchedulingAvailable, setLeaverSchedulingAvailable] = useState(false)
  const [leaverLicenceRemovalDays, setLeaverLicenceRemovalDays] = useState(30)
  const [leaverScheduleCreating, setLeaverScheduleCreating] = useState(false)
  const [leaverScheduleCancelling, setLeaverScheduleCancelling] = useState(false)
  const [leaverScheduleRefreshing, setLeaverScheduleRefreshing] = useState(false)

  async function loadLeaverM365Actions(offboardingId: number) {
    setLeaverM365Refreshing(true)
    try {
      const [{ data }, { data: ifo }, { data: wt }, { data: schedulingFlag }] = await Promise.all([
        supabase.from('offboarding_m365_actions').select('*').eq('offboarding_id', offboardingId).maybeSingle(),
        supabase.from('inflowonboarder_integrations')
          .select('status, approver_mode, approver_name, approver_email, offboard_approver_mode, offboard_approver_name, offboard_approver_email, schedule_templates_cache')
          .eq('company_id', selectedCompanyId).maybeSingle(),
        supabase.from('workflow_tracker').select('status, approval_status, assigned_to, updated_at, created_at')
          .eq('onboard_id', offboardingId).eq('record_type', 'M365 Offboarding').order('created_at', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('company_features').select('is_enabled').eq('company_id', selectedCompanyId).eq('feature_key', 'm365_scheduling').maybeSingle(),
      ])
      const m365SchedulingEnabled = schedulingFlag?.is_enabled === true
      setIfoConnected(ifo?.status === 'connected_ready')
      if (ifo) {
        setIfoOffboardSettings({
          offboard_approver_mode: ifo.offboard_approver_mode || 'same_as_joiner',
          offboard_approver_name: ifo.offboard_approver_name,
          offboard_approver_email: ifo.offboard_approver_email,
          approver_mode: ifo.approver_mode || 'manager',
          approver_name: ifo.approver_name,
          approver_email: ifo.approver_email,
        })
        const templates = Array.isArray(ifo.schedule_templates_cache) ? ifo.schedule_templates_cache : []
        const hasLeaver = templates.some((t: any) => t.id === 'hr.leaver' || t.templateId === 'hr.leaver')
        setLeaverSchedulingAvailable(hasLeaver && m365SchedulingEnabled)
      }
      const terminalStatuses = ['completed', 'failed']
      if (data?.run_id && data?.run_status && !terminalStatuses.includes(data.run_status)) {
        const freshStatus = await callIfoLeaver('check-leaver-run', { run_id: data.run_id, offboarding_id: offboardingId })
        if (freshStatus?.status && freshStatus.status !== data.run_status) {
          const { data: refreshed } = await supabase.from('offboarding_m365_actions').select('*').eq('offboarding_id', offboardingId).maybeSingle()
          if (refreshed && wt) {
            const merged = { ...refreshed } as LeaverM365Actions
            merged.approval_sent_at = merged.approval_sent_at || wt.created_at
            if (wt.status === 'Complete' && (wt.approval_status === 'Approved' || wt.approval_status === 'Declined')) {
              merged.approval_status = wt.approval_status === 'Approved' ? 'approved' : 'declined'
              merged.approved_by = wt.assigned_to || 'Approver'
              merged.approved_at = wt.updated_at || new Date().toISOString()
            } else if (wt.status === 'Pending') {
              merged.approval_status = 'pending'
            }
            setLeaverM365Actions(merged)
          } else {
            setLeaverM365Actions(refreshed as LeaverM365Actions | null)
          }
          setLeaverM365Refreshing(false)
          return
        }
      }
      if (data && wt) {
        const merged = { ...data } as LeaverM365Actions
        merged.approval_sent_at = merged.approval_sent_at || wt.created_at
        if (wt.status === 'Complete' && (wt.approval_status === 'Approved' || wt.approval_status === 'Declined')) {
          merged.approval_status = wt.approval_status === 'Approved' ? 'approved' : 'declined'
          merged.approved_by = wt.assigned_to || 'Approver'
          merged.approved_at = wt.updated_at || new Date().toISOString()
        } else if (wt.status === 'Pending') {
          merged.approval_status = 'pending'
        }
        setLeaverM365Actions(merged)
      } else {
        setLeaverM365Actions(data as LeaverM365Actions | null)
      }
    } finally {
      setLeaverM365Refreshing(false)
    }
  }

  async function leaverM365StartRun(record: OffboardRecord) {
    setLeaverM365Starting(true)
    const upn = record.employee_email
    const result = await callIfoLeaver('start-leaver-run', {
      offboarding_id: record.id,
      user_principal_name: upn,
      attempt: leaverM365Actions?.attempt_count_run || 0,
    })
    setLeaverM365Starting(false)
    if (result?.run_id) {
      showSuccess('M365 offboarding workflow started')
      await loadLeaverM365Actions(record.id)
      if (result.status === 'checking_account') {
        leaverM365PollRun(result.run_id, record.id)
      }
    }
  }

  async function leaverM365PollRun(runId: string, offboardingId: number) {
    setLeaverM365RunPolling(true)
    for (let i = 0; i < 6; i++) {
      await new Promise(r => setTimeout(r, 5000))
      const result = await callIfoLeaver('check-leaver-run', { run_id: runId, offboarding_id: offboardingId })
      if (!result) break
      if (['ready_for_approval', 'account_blocked', 'completed', 'failed'].includes(result.status)) {
        if (result.status === 'completed') showSuccess('M365 offboarding complete')
        else if (result.status === 'failed') showError(result.friendlyError || 'Workflow failed')
        await loadLeaverM365Actions(offboardingId)
        setLeaverM365RunPolling(false)
        return
      }
    }
    await loadLeaverM365Actions(offboardingId)
    setLeaverM365RunPolling(false)
  }

  async function leaverM365RefreshStatus(runId: string, offboardingId: number) {
    setLeaverM365RunPolling(true)
    const result = await callIfoLeaver('check-leaver-run', { run_id: runId, offboarding_id: offboardingId })
    if (result?.status) {
      if (result.status === 'completed') showSuccess('M365 offboarding complete')
      else if (result.status === 'failed') showError(result.friendlyError || 'Offboarding failed')
      else if (result.status === 'ready_for_approval') showSuccess('Ready for approval')
      else if (result.status === 'account_blocked') showError(result.friendlyError || 'Account blocked — see details')
    }
    await loadLeaverM365Actions(offboardingId)
    setLeaverM365RunPolling(false)
  }

  async function leaverM365RecheckRun(runId: string, offboardingId: number) {
    setLeaverM365RunPolling(true)
    const result = await callIfoLeaver('recheck-leaver-run', { run_id: runId, offboarding_id: offboardingId, attempt: (leaverM365Actions?.attempt_count_run || 0) + 1 })
    if (result) {
      if (result.status === 'ready_for_approval') showSuccess('Account now ready for offboarding approval')
      else if (result.status === 'account_blocked') showError(result.friendlyError || 'Account still blocked')
      await loadLeaverM365Actions(offboardingId)
    }
    setLeaverM365RunPolling(false)
  }

  useEffect(() => {
    if (!leaverM365Actions?.run_id || !offboardSelectedId) return
    const isTerminal = leaverM365Actions.run_status === 'completed' || leaverM365Actions.run_status === 'failed'
    const isEngineStatus = !!leaverM365Actions.run_status && !isTerminal
    const needsPoll = leaverM365Actions.approval_status === 'pending' || isEngineStatus
    if (!needsPoll) return
    const slowPollStatuses = ['ready_for_approval', 'awaiting_approval', 'account_blocked']
    const pollInterval = slowPollStatuses.includes(leaverM365Actions.run_status || '') ? 60000 : 10000
    const timer = setInterval(async () => {
      if (isEngineStatus && leaverM365Actions?.run_id) {
        await callIfoLeaver('check-leaver-run', { run_id: leaverM365Actions.run_id, offboarding_id: offboardSelectedId })
      }
      const [{ data }, { data: wt }] = await Promise.all([
        supabase.from('offboarding_m365_actions').select('*').eq('offboarding_id', offboardSelectedId).maybeSingle(),
        supabase.from('workflow_tracker').select('status, approval_status, assigned_to, updated_at, created_at')
          .eq('onboard_id', offboardSelectedId).eq('record_type', 'M365 Offboarding').order('created_at', { ascending: false }).limit(1).maybeSingle(),
      ])
      if (data && wt) {
        const merged = { ...data } as LeaverM365Actions
        merged.approval_sent_at = merged.approval_sent_at || wt.created_at
        if (wt.status === 'Complete' && (wt.approval_status === 'Approved' || wt.approval_status === 'Declined')) {
          merged.approval_status = wt.approval_status === 'Approved' ? 'approved' : 'declined'
          merged.approved_by = wt.assigned_to || 'Approver'
          merged.approved_at = wt.updated_at || new Date().toISOString()
        } else if (wt.status === 'Pending') {
          merged.approval_status = 'pending'
        }
        setLeaverM365Actions(merged)
      } else if (data) {
        setLeaverM365Actions(data as LeaverM365Actions)
      }
    }, pollInterval)
    return () => clearInterval(timer)
  }, [leaverM365Actions?.run_id, leaverM365Actions?.approval_status, leaverM365Actions?.run_status, offboardSelectedId])

  async function leaverM365SendApproval(record: OffboardRecord) {
    if (!ifoOffboardSettings) return
    setLeaverM365ApprovalSending(true)

    let resolvedMode = ifoOffboardSettings.offboard_approver_mode
    let approverEmail: string | null = null
    let approverName: string | null = null

    if (resolvedMode === 'same_as_joiner') {
      resolvedMode = ifoOffboardSettings.approver_mode
      approverEmail = ifoOffboardSettings.approver_email
      approverName = ifoOffboardSettings.approver_name
    } else if (resolvedMode === 'nominated') {
      approverEmail = ifoOffboardSettings.offboard_approver_email
      approverName = ifoOffboardSettings.offboard_approver_name
    }

    if (resolvedMode === 'manager') {
      const { data: emp } = await supabase.from('employees').select('manager_email').eq('id', record.employee_id).maybeSingle()
      approverEmail = emp?.manager_email || null
      approverName = null
      if (!approverEmail) {
        showError('This leaver has no manager set. Set a manager first, or switch to a nominated approver in the Integrations settings.')
        setLeaverM365ApprovalSending(false)
        return
      }
    }

    if (!approverEmail) {
      showError('No approver email configured. Check the Offboarding Approver setting in Integrations.')
      setLeaverM365ApprovalSending(false)
      return
    }

    const { data: existingWt } = await supabase.from('workflow_tracker')
      .select('id, status').eq('onboard_id', record.id).eq('record_type', 'M365 Offboarding').eq('status', 'Pending').maybeSingle()
    if (existingWt) {
      showError('An approval request is already pending for this leaver. Use Refresh to check its status.')
      setLeaverM365ApprovalSending(false)
      return
    }

    const leaverName = record.employee_name
    const upn = leaverM365Actions?.employee_upn || record.employee_email
    const endDateStr = record.end_date ? new Date(record.end_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : ''
    const taskDesc = `${leaverName} — ${record.job_title || 'Leaver'}${endDateStr ? `, last day ${endDateStr}` : ''}\nM365 account: ${upn}`

    const { error: wtErr } = await supabase.from('workflow_tracker').insert({
      company_id: selectedCompanyId,
      record_type: 'M365 Offboarding',
      onboard_id: record.id,
      emp_display_name: leaverName,
      action: 'Approve',
      employee_email: approverEmail,
      assigned_to: approverEmail,
      status: 'Pending',
      approval_status: 'pending',
      task_description: taskDesc,
    })
    if (wtErr) {
      showError(`Failed to create approval task: ${wtErr.message}`)
      setLeaverM365ApprovalSending(false)
      return
    }

    const { data: approverEmp } = await supabase.from('employees')
      .select('id').eq('user_email', approverEmail).eq('company_id', selectedCompanyId).maybeSingle()
    if (approverEmp) {
      await supabase.from('notifications').insert({
        company_id: selectedCompanyId,
        employee_id: approverEmp.id,
        type: 'action',
        notification_type: 'm365_offboard_approval',
        title: 'M365 Offboarding Approval',
        message: `Offboarding ${record.employee_name}'s Microsoft 365 account needs your approval. Please approve it in the InflowHR app.`,
        send_email: true,
      })
    }

    if (leaverM365Actions) {
      setLeaverM365Actions({
        ...leaverM365Actions,
        approval_sent_at: new Date().toISOString(),
        approval_status: 'pending',
      })
    }

    try {
      await callIfoLeaver('check-leaver-run', { run_id: leaverM365Actions?.run_id, offboarding_id: record.id })
    } catch (_) {}

    showSuccess(`Approval request sent to ${approverName || approverEmail}`)
    await loadLeaverM365Actions(record.id)
    setLeaverM365ApprovalSending(false)
  }

  async function leaverM365ProceedRun(record: OffboardRecord) {
    if (!leaverM365Actions?.run_id) return
    setLeaverM365Proceeding(true)
    const approvedByRaw = leaverM365Actions.approved_by || ''
    const emailMatch = approvedByRaw.match(/<([^>]+)>/)
    const approverEmail = emailMatch ? emailMatch[1] : approvedByRaw
    const approverName = emailMatch ? approvedByRaw.replace(/<[^>]+>/, '').trim() : approvedByRaw
    const result = await callIfoLeaver('proceed-leaver-run', {
      run_id: leaverM365Actions.run_id,
      offboarding_id: record.id,
      approver_name: approverName,
      approver_email: approverEmail,
      approved_at: leaverM365Actions.approved_at,
      attempt: (leaverM365Actions?.attempt_count_run || 0) + 1,
    })
    setLeaverM365Proceeding(false)
    if (result) {
      if (result.status === 'completed') {
        showSuccess('M365 offboarding complete')
      } else if (result.status === 'awaiting_approval' || result.status === 'deprovisioning' || result.status === 'checking_account') {
        showSuccess(result.status === 'awaiting_approval' ? 'Approval submitted — processing offboarding...' : 'Deprovisioning started — polling for completion...')
        leaverM365PollRun(leaverM365Actions.run_id, record.id)
        return
      } else if (result.status === 'failed') {
        showError(result.friendlyError || 'Offboarding failed')
      }
      await loadLeaverM365Actions(record.id)
    }
  }

  async function leaverM365MarkCompleteManual(offboardingId: number) {
    const result = await callIfoLeaver('mark-leaver-complete-manual', { offboarding_id: offboardingId })
    if (result) {
      showSuccess('Marked as manually completed')
      await loadLeaverM365Actions(offboardingId)
    }
  }

  async function leaverSendScheduleApproval(record: OffboardRecord) {
    if (!selectedCompanyId || !ifoOffboardSettings) return
    setLeaverM365ApprovalSending(true)
    const leaveDate = record.end_date || new Date().toISOString().split('T')[0]
    const removalDate = new Date(new Date(leaveDate).getTime() + leaverLicenceRemovalDays * 86400000)
    const planDesc = `Schedule M365 Offboarding for ${record.employee_name}:\n` +
      `• Block access: ${new Date(leaveDate).toLocaleDateString('en-GB')} at 17:00\n` +
      `• Remove groups & licence: ${removalDate.toLocaleDateString('en-GB')} at 17:00`
    let resolvedMode = ifoOffboardSettings.offboard_approver_mode
    let approverEmail: string | null = null
    if (resolvedMode === 'same_as_joiner') {
      resolvedMode = ifoOffboardSettings.approver_mode
      approverEmail = ifoOffboardSettings.approver_email
    } else if (resolvedMode === 'nominated') {
      approverEmail = ifoOffboardSettings.offboard_approver_email
    }
    if (resolvedMode === 'manager') {
      const { data: emp } = await supabase.from('employees').select('manager_email').eq('id', record.employee_id).maybeSingle()
      approverEmail = emp?.manager_email || null
    }
    if (!approverEmail) { showError('No approver found. Check the approver settings on the Integrations page.'); setLeaverM365ApprovalSending(false); return }
    const { data: approverEmp } = await supabase.from('employees').select('id').eq('user_email', approverEmail).eq('company_id', selectedCompanyId).maybeSingle()
    const approverEmpId = approverEmp?.id || null
    if (!approverEmpId) { showError('Could not find the approver employee record. Check the approver settings.'); setLeaverM365ApprovalSending(false); return }
    await supabase.from('workflow_tracker').insert({
      company_id: selectedCompanyId,
      record_id: record.id,
      record_type: 'M365 Leaver Scheduling',
      task_description: planDesc,
      assigned_to: approverEmpId,
      status: 'pending',
    })
    await supabase.from('notifications').insert({
      company_id: selectedCompanyId,
      employee_id: approverEmpId,
      type: 'action',
      title: 'M365 Leaver Schedule Approval Required',
      message: `Please approve the M365 offboarding schedule for ${record.employee_name}.`,
      is_read: false,
      action_type: 'M365 Leaver Scheduling',
      action_record_id: record.id,
    })
    await supabase.from('offboarding_m365_actions').upsert({
      offboarding_id: record.id,
      company_id: selectedCompanyId,
      approval_sent_at: new Date().toISOString(),
      approval_status: 'pending',
      schedule_status: 'pending_approval',
      schedule_options: { licenceRemovalDelayDays: leaverLicenceRemovalDays },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'offboarding_id' })
    showSuccess('Schedule approval sent')
    setLeaverM365ApprovalSending(false)
    await loadLeaverM365Actions(record.id)
  }

  async function leaverCreateSchedule(record: OffboardRecord) {
    if (!selectedCompanyId || !leaverM365Actions) return
    setLeaverScheduleCreating(true)
    const result = await callIfoLeaver('create-leaver-schedule', {
      offboarding_id: record.id,
      user_principal_name: record.employee_email,
      display_name: record.employee_name,
      leave_date: record.end_date,
      options: { licenceRemovalDelayDays: leaverM365Actions.schedule_options?.licenceRemovalDelayDays || leaverLicenceRemovalDays },
      approver_name: leaverM365Actions.approved_by || 'InflowHR Approver',
      approver_email: ifoOffboardSettings?.offboard_approver_email || ifoOffboardSettings?.approver_email || '',
      approved_at: leaverM365Actions.approved_at || new Date().toISOString(),
      attempt: leaverM365Actions.attempt_count_run || 0,
    })
    setLeaverScheduleCreating(false)
    if (result) {
      if (result.use_run_now) {
        showError(result.error || 'Leave date is too close — use Run Now instead')
        setLeaverScheduleMode('now')
      } else {
        showSuccess('Leaver schedule created')
      }
      await loadLeaverM365Actions(record.id)
    }
  }

  async function leaverRefreshSchedule(scheduleId: string, offboardingId: number) {
    setLeaverScheduleRefreshing(true)
    await callIfoLeaver('get-leaver-schedule', { schedule_id: scheduleId, offboarding_id: offboardingId })
    await loadLeaverM365Actions(offboardingId)
    setLeaverScheduleRefreshing(false)
  }

  async function leaverCancelSchedule(scheduleId: string, offboardingId: number, reason: string) {
    if (!confirm('Cancel this schedule? The engine will release any reserved resources.')) return
    setLeaverScheduleCancelling(true)
    const result = await callIfoLeaver('cancel-leaver-schedule', { schedule_id: scheduleId, offboarding_id: offboardingId, reason })
    setLeaverScheduleCancelling(false)
    if (result) {
      showSuccess('Schedule cancelled')
      await loadLeaverM365Actions(offboardingId)
    }
  }

  async function leaverRecheckSchedule(scheduleId: string, offboardingId: number) {
    setLeaverScheduleRefreshing(true)
    const result = await callIfoLeaver('recheck-leaver-schedule', { schedule_id: scheduleId, offboarding_id: offboardingId })
    setLeaverScheduleRefreshing(false)
    if (result) {
      showSuccess('Schedule rechecked')
      await loadLeaverM365Actions(offboardingId)
    }
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
    const customCompleted = record.custom_steps_completed || {}
    Object.keys(customCompleted).forEach(k => { if (customCompleted[k]) checks[k] = true })
    setStepChecks(checks)
    const skipped = record.skipped_steps
    setStepSkips(skipped && typeof skipped === 'object' ? skipped : {})
    const doneCount = activeSteps.filter(s => {
      return checks[s.step_key] || (skipped && skipped[s.step_key])
    }).length
    setWorkflowStep(record.is_complete ? activeSteps.length - 1 : Math.min(doneCount, activeSteps.length - 1))
    setTab('workflow')
    if (features.inflowonboarder_integration) {
      setM365Actions(null)
      const domain = ifoSettings?.account_domain
      setM365Upn(domain ? `${record.firstname.toLowerCase()}.${record.surname.toLowerCase()}@${domain}` : record.user_email)
      setM365DisplayName(`${record.firstname} ${record.surname}`)
      setM365Location('GB')
      loadM365Actions(record.id)
    }
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
      let { data: emp } = await supabase.from('employees').select('id').eq('email', record.user_email).eq('company_id', selectedCompanyId).maybeSingle()
      if (!emp) {
        const created = await createEmployeeFromOnboard(record)
        if (!created) return
        const { data: newEmp } = await supabase.from('employees').select('id').eq('email', record.user_email).eq('company_id', selectedCompanyId).maybeSingle()
        emp = newEmp
      }
      const { error: activateErr } = await supabase.from('employees').update({ is_active: true }).eq('email', record.user_email).eq('company_id', selectedCompanyId)
      if (activateErr) { showError('Failed to activate employee: ' + activateErr.message); return }
      if (emp) {
        const { data: existingCu } = await supabase.from('company_users').select('id').eq('employee_id', emp.id).eq('company_id', selectedCompanyId).maybeSingle()
        if (!existingCu) {
          await supabase.from('company_users').insert({
            company_id: selectedCompanyId,
            employee_id: emp.id,
            role: 'employee',
            is_active: true,
          })
        }
        if (features.skills_passport) {
          await supabase.from('workflow_tracker').insert({
            company_id: selectedCompanyId,
            emp_display_name: `${record.firstname} ${record.surname}`,
            step: 1,
            status: 'Pending',
            record_type: 'Skills Mapping',
            action: 'Complete your skills passport',
            employee_email: record.user_email,
            assigned_to: record.user_email,
            task_description: 'Complete your skills passport — add your skills, certifications and career goals to help your organisation understand your capabilities.',
          })
        }
      }
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
    const niErr = validateNINumber(record.ni_number || '')
    if (niErr) { showError(niErr); return false }
    const scErr = validateSortCode(record.bank_sort_code || '')
    if (scErr) { showError(scErr); return false }
    const acErr = validateAccountNumber(record.bank_account_number || '')
    if (acErr) { showError(acErr); return false }
    const emailToUse = record.user_email || `${(record.employee_number || 'emp').toLowerCase()}@nonsso.local`
    const { data: existing } = await supabase.from('employees').select('id').eq('email', emailToUse).eq('company_id', selectedCompanyId).maybeSingle()
    if (existing) return true
    let empNum = record.employee_number || `EMP-${Date.now().toString().slice(-8)}`
    const { data: numClash } = await supabase.from('employees').select('id').eq('employee_number', empNum).eq('company_id', selectedCompanyId).maybeSingle()
    if (numClash) empNum = `EMP-${Date.now()}-${Math.floor(Math.random() * 1000)}`
    const uniqueEid = isNonSso ? (record.employee_number || empNum) : null
    const { data: newEmp, error } = await supabase.from('employees').insert({
      employee_number: empNum,
      first_name: record.firstname,
      last_name: record.surname,
      email: emailToUse,
      unique_employee_id: uniqueEid,
      job_title: record.job_title || '',
      department: record.department || '',
      start_date: record.start_date || toLocalDateStr(),
      phone: record.telephone || '',
      is_admin: false,
      is_active: false,
      company_id: selectedCompanyId,
      location: record.location || '',
      contract_type: record.contract_type || '',
      employment_category: record.employment_category || 'employed',
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
      weekly_hours: record.weekly_hours || null,
      annual_salary: record.annual_salary || null,
      tax_code: record.tax_code || null,
      payroll_id: record.payroll_id || null,
      leave_allowance: record.leave_allowance ?? 15,
    }).select('id').single()
    if (error) {
      showError(`Failed to create employee record: ${error.message}`)
      return false
    }

    if (newEmp) {
      const isZh = record.employment_category === 'shift_worker' && record.contract_type === 'Zero hours shift worker'
      const allowance = isZh ? 0 : (record.leave_allowance ?? 15)
      const { data: leaveTypes } = await supabase.from('leave_types').select('id, name, deducts_from_allowance').eq('company_id', selectedCompanyId)
      if (leaveTypes && leaveTypes.length > 0) {
        const year = new Date().getFullYear()
        const balances = leaveTypes.map(lt => {
          const bal: Record<string, unknown> = {
            employee_id: newEmp.id,
            leave_type_id: lt.id,
            year,
            total_allowance: lt.deducts_from_allowance ? allowance : 0,
            used: 0,
            carried_over: 0,
            company_id: selectedCompanyId,
          }
          if (isZh && lt.name === 'Annual Leave') bal.accrual_unit = 'hours'
          return bal
        })
        await supabase.from('leave_balances').insert(balances)
      }
    }

    return true
  }

  const stats = useMemo(() => {
    const now = new Date()
    const today = toLocalDateStr(now)

    const fyStart = new Date(now.getFullYear(), fyStartMonth - 1, 1)
    if (fyStart > now) fyStart.setFullYear(fyStart.getFullYear() - 1)
    const fyEnd = new Date(fyStart.getFullYear() + 1, fyStart.getMonth(), 0)

    const fyRecords = records.filter(r => {
      if (!r.start_date) return false
      return r.start_date >= toLocalDateStr(fyStart) && r.start_date <= toLocalDateStr(fyEnd)
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
    activeSteps.forEach(s => { stageMap[s.step_key] = 0 })
    stageMap['complete'] = 0
    records.filter(r => !r.is_complete).forEach(r => {
      const firstKey = activeSteps.length > 0 ? activeSteps[0].step_key : 'details'
      if (r.status === 'new') { stageMap[firstKey] = (stageMap[firstKey] || 0) + 1; return }
      const checks: Record<string, boolean> = {
        details: true, equipment: r.equipment_order === 'Y',
        meeting: r.first_day, notify_manager: r.first_day, plan_day1: r.first_day,
        inform_starter: r.first_week, accounts: r.elearning, day1_access: r.is_complete,
      }
      const skipped = r.skipped_steps
      const doneCount = activeSteps.filter(s => checks[s.step_key] || (skipped && skipped[s.step_key])).length
      const currentIdx = Math.min(doneCount, activeSteps.length - 1)
      const stepKey = activeSteps[currentIdx].step_key
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
  }, [records, fyStartMonth, activeSteps])

  const filtered = useMemo(() => {
    if (!filterStatus) return records
    if (filterStatus === 'pending') return records.filter(r => !r.is_complete)
    if (filterStatus === 'completed') return records.filter(r => r.is_complete)
    return records.filter(r => r.status === filterStatus)
  }, [records, filterStatus])

  const onbTotalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paginatedFiltered = filtered.slice((onbPage - 1) * PAGE_SIZE, onbPage * PAGE_SIZE)

  const activeOffboardRecords = useMemo(() => offboardRecords.filter(r => !r.is_complete), [offboardRecords])
  const offTotalPages = Math.max(1, Math.ceil(activeOffboardRecords.length / PAGE_SIZE))
  const paginatedActiveOffboard = activeOffboardRecords.slice((offPage - 1) * PAGE_SIZE, offPage * PAGE_SIZE)

  const frozenTotalPages = Math.max(1, Math.ceil(frozenEmployees.length / PAGE_SIZE))
  const paginatedFrozen = frozenEmployees.slice((frozenPage - 1) * PAGE_SIZE, frozenPage * PAGE_SIZE)

  const completedOffboardRecords = useMemo(() => offboardRecords.filter(r => r.is_complete), [offboardRecords])
  const complTotalPages = Math.max(1, Math.ceil(completedOffboardRecords.length / PAGE_SIZE))
  const paginatedCompletedOffboard = completedOffboardRecords.slice((complPage - 1) * PAGE_SIZE, complPage * PAGE_SIZE)

  const selectedRecord = records.find(r => r.id === selectedId)

  return (
    <div className="admin-section">
      <div className="admin-page-header">
        <h2>Onboard / Offboard</h2>
        <p>{records.length} onboarding · {offboardRecords.filter(r => !r.is_complete).length} offboarding</p>
      </div>

      <div className="admin-tabs">
        <button className={`admin-tab ${tab === 'dashboard' ? 'admin-tab-active' : ''}`} onClick={() => setTab('dashboard')}>Dashboard</button>
        <button className={`admin-tab ${tab === 'new' ? 'admin-tab-active' : ''}`} onClick={() => setTab('new')}>New Starter</button>
        <button className={`admin-tab ${tab === 'upload' ? 'admin-tab-active' : ''}`} onClick={() => setTab('upload')}>Bulk Upload</button>
        <button className={`admin-tab ${tab === 'list' ? 'admin-tab-active' : ''}`} onClick={() => setTab('list')}>Onboarding</button>
        {selectedId && <button className={`admin-tab ${tab === 'workflow' ? 'admin-tab-active' : ''}`} onClick={() => setTab('workflow')}>Onboard Workflow</button>}
        <button className={`admin-tab ${tab === 'offboarding' ? 'admin-tab-active' : ''}`} onClick={() => setTab('offboarding')}>Offboarding</button>
        {offboardSelectedId && <button className={`admin-tab ${tab === 'offboard-workflow' ? 'admin-tab-active' : ''}`} onClick={() => setTab('offboard-workflow')}>Offboarding Workflow</button>}
        <button className={`admin-tab ${tab === 'settings' ? 'admin-tab-active' : ''}`} onClick={() => { setTab('settings'); initEditingSteps() }}>Settings</button>
        {isSuperAdmin && (
          <button className={`admin-tab ${tab === 'setup' ? 'admin-tab-active' : ''}`} onClick={() => setTab('setup')} style={{ borderColor: '#7b1fa2', color: tab === 'setup' ? '#fff' : '#7b1fa2', background: tab === 'setup' ? '#7b1fa2' : undefined }}>
            Company Setup
          </button>
        )}
      </div>

      {tab === 'dashboard' && (
        <div className="admin-onboard-dash">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 14, marginBottom: 20 }}>
            {[
              { label: 'Total Starters', value: stats.total, color: '#4f46e5', bg: 'linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%)', icon: '👥' },
              { label: 'This FY', value: stats.fyTotal, color: '#0284c7', bg: 'linear-gradient(135deg, #e0f2fe 0%, #bae6fd 100%)', icon: '📊' },
              { label: 'In Progress', value: stats.pending, color: '#d97706', bg: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)', icon: '⏳' },
              { label: 'Due to Join', value: stats.dueJoining, color: '#7c3aed', bg: 'linear-gradient(135deg, #ede9fe 0%, #ddd6fe 100%)', icon: '🗓️' },
              { label: 'Overdue', value: stats.overdue, color: stats.overdue > 0 ? '#dc2626' : '#16a34a', bg: stats.overdue > 0 ? 'linear-gradient(135deg, #fef2f2 0%, #fecaca 100%)' : 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)', icon: stats.overdue > 0 ? '🚨' : '✅' },
              { label: 'Completed', value: stats.completed, color: '#16a34a', bg: 'linear-gradient(135deg, #f0fdf4 0%, #bbf7d0 100%)', icon: '🎉' },
            ].map((card, i) => (
              <div key={i} style={{
                background: card.bg, borderRadius: 14, padding: '16px 18px',
                border: `1px solid ${card.color}22`, position: 'relative', overflow: 'hidden',
              }}>
                <div style={{ position: 'absolute', top: 10, right: 12, fontSize: 28, opacity: 0.2 }}>{card.icon}</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: card.color, lineHeight: 1 }}>{card.value}</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: card.color, opacity: 0.7, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 }}>{card.label}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))', gap: 20, marginTop: 24 }}>
            {/* Line Graph — Onboarders per Month */}
            {(() => {
              const data = stats.monthlyBreakdown
              const max = Math.max(...data.map(x => x.count), 1)
              const padTop = 28, padBot = 32, padLeft = 30, padRight = 16
              const w = 660, h = 220
              const chartW = w - padLeft - padRight, chartH = h - padTop - padBot
              const points = data.map((m, i) => ({
                x: padLeft + (i / (data.length - 1)) * chartW,
                y: padTop + chartH - (m.count / max) * chartH,
                count: m.count,
                label: m.label,
              }))
              const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
              const areaPath = `${linePath} L${points[points.length - 1].x},${padTop + chartH} L${points[0].x},${padTop + chartH} Z`
              const gridLines = Array.from({ length: 5 }, (_, i) => {
                const val = Math.round((max / 4) * i)
                const y = padTop + chartH - (val / max) * chartH
                return { y, val }
              })
              return (
                <div style={{ background: 'var(--admin-card-bg, #fff)', borderRadius: 14, padding: '20px 20px 16px', border: '1px solid var(--admin-border, #e0e0e0)' }}>
                  <h4 style={{ margin: '0 0 2px', fontSize: 15, fontWeight: 700, color: 'var(--admin-text, #1e1e2d)' }}>Onboarders per Month</h4>
                  <p style={{ margin: '0 0 12px', fontSize: 12, color: '#888' }}>{stats.fyLabel}</p>
                  <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto' }}>
                    <defs>
                      <linearGradient id="lineGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#4f46e5" stopOpacity="0.18" />
                        <stop offset="100%" stopColor="#4f46e5" stopOpacity="0.01" />
                      </linearGradient>
                    </defs>
                    {gridLines.map((g, i) => (
                      <g key={i}>
                        <line x1={padLeft} y1={g.y} x2={w - padRight} y2={g.y} stroke="#e5e7eb" strokeWidth="1" />
                        <text x={padLeft - 6} y={g.y + 4} textAnchor="end" fill="#aaa" fontSize="10">{g.val}</text>
                      </g>
                    ))}
                    <path d={areaPath} fill="url(#lineGrad)" />
                    <path d={linePath} fill="none" stroke="#4f46e5" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    {points.map((p, i) => (
                      <g key={i}>
                        <circle cx={p.x} cy={p.y} r={p.count > 0 ? 4 : 2.5} fill={p.count > 0 ? '#4f46e5' : '#cbd5e1'} stroke="#fff" strokeWidth="2" />
                        {p.count > 0 && <text x={p.x} y={p.y - 10} textAnchor="middle" fill="#4f46e5" fontSize="12" fontWeight="700">{p.count}</text>}
                        <text x={p.x} y={padTop + chartH + 18} textAnchor="middle" fill="#999" fontSize="12">{p.label}</text>
                      </g>
                    ))}
                  </svg>
                </div>
              )
            })()}

            {/* Horizontal Bar Chart — Pipeline */}
            {(() => {
              const pipelineData = [
                ...activeSteps.map(s => ({ label: s.label, icon: s.icon, count: stats.stageMap[s.step_key] || 0, color: '#4f46e5' })),
                { label: 'Completed', icon: '✅', count: stats.stageMap['complete'] || 0, color: '#16a34a' },
              ]
              const maxCount = Math.max(...pipelineData.map(d => d.count), 1)
              return (
                <div style={{ background: 'var(--admin-card-bg, #fff)', borderRadius: 14, padding: '20px 20px 16px', border: '1px solid var(--admin-border, #e0e0e0)' }}>
                  <h4 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700, color: 'var(--admin-text, #1e1e2d)' }}>Onboarding Pipeline</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {pipelineData.map((d, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 16, width: 22, textAlign: 'center', flexShrink: 0 }}>{d.icon}</span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: d.count > 0 ? 'var(--admin-text, #333)' : '#bbb', width: 120, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label}</span>
                        <div style={{ flex: 1, height: 22, background: '#f1f5f9', borderRadius: 6, overflow: 'hidden', position: 'relative' }}>
                          <div style={{
                            height: '100%',
                            width: d.count > 0 ? `${Math.max((d.count / maxCount) * 100, 8)}%` : '0%',
                            background: d.color === '#16a34a'
                              ? 'linear-gradient(90deg, #16a34a 0%, #22c55e 100%)'
                              : `linear-gradient(90deg, #4f46e5 0%, #818cf8 100%)`,
                            borderRadius: 6,
                            transition: 'width 0.4s ease',
                          }} />
                          {d.count > 0 && (
                            <span style={{
                              position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                              fontSize: 11, fontWeight: 700, color: (d.count / maxCount) > 0.5 ? '#fff' : d.color,
                            }}>{d.count}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}
          </div>

          {stats.overdue > 0 && (
            <div style={{ marginTop: 20, background: '#fff3e0', border: '1px solid #ff9800', borderRadius: 12, padding: 16 }}>
              <h4 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600, color: '#e65100' }}>Overdue Onboarding ({stats.overdue})</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {records.filter(r => !r.is_complete && r.start_date && r.start_date < toLocalDateStr()).map(r => {
                  const daysOver = Math.floor((Date.now() - new Date(r.start_date).getTime()) / 86400000)
                  return (
                    <div key={r.id} style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, fontSize: 13, padding: '6px 0', borderBottom: '1px solid #ffe0b2' }}>
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
                ...(isNonSso
                  ? [{ key: 'employee_number', label: 'Unique Employee ID *' }]
                  : [{ key: 'user_email', label: 'Work Email *' }]
                ),
                { key: 'personal_email', label: 'Personal Email' },
                { key: 'job_title', label: 'Job Title' }, { key: 'department', label: 'Department' },
                { key: 'manager', label: 'Manager Name' }, { key: 'manager_email', label: 'Manager Email' },
                { key: 'location', label: 'Work Location' }, { key: 'telephone', label: 'Phone' },
                ...(isNonSso ? [] : [{ key: 'employee_number', label: 'Employee Number' }]),
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
              <div className="admin-form-field">
                <label>Employment Category</label>
                <select className="admin-select" value={newForm.employment_category === 'shift_worker' && newForm.contract_type === 'Zero hours shift worker' ? 'zero_hours' : newForm.employment_category} onChange={e => {
                  const val = e.target.value
                  if (val === 'zero_hours') {
                    setNewForm(p => ({...p, employment_category: 'shift_worker', contract_type: 'Zero hours shift worker', weekly_hours: '0', leave_allowance: '0'}))
                  } else if (val === 'shift_worker') {
                    setNewForm(p => ({...p, employment_category: 'shift_worker', contract_type: p.contract_type === 'Zero hours shift worker' ? 'Full-time' : p.contract_type, weekly_hours: p.weekly_hours === '0' ? '37.5' : p.weekly_hours, leave_allowance: p.leave_allowance === '0' ? '' : p.leave_allowance}))
                  } else {
                    setNewForm(p => ({...p, employment_category: val, weekly_hours: p.weekly_hours === '0' ? '37.5' : p.weekly_hours, leave_allowance: p.leave_allowance === '0' ? '' : p.leave_allowance}))
                  }
                }}>
                  <option value="employed">Employed (Salaried)</option>
                  <option value="shift_worker">Shift Worker</option>
                  <option value="zero_hours">Zero Hours</option>
                </select>
                <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
                  {newForm.employment_category === 'employed'
                    ? 'Paid a fixed salary divided by pay period. Uses timesheets for time recording.'
                    : newForm.contract_type === 'Zero hours shift worker'
                      ? 'Zero hours — no guaranteed hours, paid per shift worked × hourly rate. Leave allowance and weekly hours set to 0.'
                      : 'Works scheduled shifts, paid based on hours worked × hourly rate.'
                  }
                </div>
                <div style={{ fontSize: 11, color: '#1565c0', marginTop: 2 }}>
                  Payroll settings for this category are configured in Admin → Employees → Payroll Settings.
                </div>
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
                <label>Annual Salary ({currencySymbol(currency)})</label>
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
              <div className="admin-form-field">
                <label>{newForm.contract_type === 'Zero hours shift worker' ? 'Leave Allowance (hours — accrued)' : 'Leave Allowance (days)'}</label>
                <input type="number" className="admin-input" placeholder={newForm.contract_type === 'Zero hours shift worker' ? '0' : '15'} value={newForm.leave_allowance} onChange={e => setNewForm(p => ({...p, leave_allowance: e.target.value}))} readOnly={newForm.contract_type === 'Zero hours shift worker'} style={newForm.contract_type === 'Zero hours shift worker' ? { background: '#f5f5f5', cursor: 'default' } : {}} />
                {newForm.contract_type === 'Zero hours shift worker' && (
                  <div style={{ fontSize: 11, color: '#1565c0', marginTop: 2 }}>Zero hours workers start with 0 hours and accrue holiday based on hours worked.</div>
                )}
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
                      <th>#</th><th>Name</th><th>{isNonSso ? 'Employee ID' : 'Work Email'}</th><th>Job Title</th>
                      <th>Department</th><th>Start Date</th><th>Contract</th>
                    </tr>
                  </thead>
                  <tbody>
                    {uploadRows.map((row, i) => {
                      const hasError = !row.firstname || !row.surname || (isNonSso ? !row.employee_number : !row.user_email)
                      return (
                        <tr key={i} style={hasError ? { background: '#fff3e0' } : undefined}>
                          <td>{i + 1}</td>
                          <td><strong>{row.firstname} {row.surname}</strong></td>
                          <td>{isNonSso ? (row.employee_number || '—') : row.user_email}</td>
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
                <thead><tr><th>Name</th><th>Company</th><th>Role</th><th>Start Date</th><th>Status</th><th>Status Update</th><th>Progress</th><th>Actions</th></tr></thead>
                <tbody>
                  {paginatedFiltered.map(r => {
                    const skipped = r.skipped_steps || {}
                    const defaultDone = [true, r.equipment_order === 'Y', r.first_day, r.first_day, r.first_day, r.first_week, r.elearning, r.is_complete].filter(Boolean).length
                    const skippedCount = Object.values(skipped).filter(Boolean).length
                    const customCompleted = (r as any).custom_steps_completed || {}
                    const customDoneCount = Object.values(customCompleted).filter(Boolean).length
                    const totalSteps = activeSteps.length
                    const totalDone = hasCustomSteps ? (defaultDone + customDoneCount + skippedCount) : (defaultDone + skippedCount)
                    const displayDone = Math.min(totalDone, totalSteps)
                    const isOffboarded = offboardRecords.some(o => o.employee_email === r.user_email && o.is_complete)
                    const isFrozen = frozenEmployees.some(f => f.employee_email === r.user_email && f.status !== 'recovered')
                    return (
                      <tr key={r.id}>
                        <td><strong>{r.firstname} {r.surname}</strong></td>
                        <td style={{ fontSize: 12, color: '#666' }}>{r.company?.name || '—'}</td>
                        <td>{r.job_title || '—'}</td>
                        <td>{r.start_date ? new Date(r.start_date).toLocaleDateString('en-GB') : '—'}</td>
                        <td><span className={`admin-badge ${r.is_complete ? 'admin-badge-approved' : 'admin-badge-pending'}`}>{r.is_complete ? 'Onboarded' : r.status}</span></td>
                        <td>{isFrozen ? <span style={{ color: '#1565c0', fontWeight: 600, fontSize: 12 }}>Frozen</span> : isOffboarded ? <span style={{ color: '#c62828', fontWeight: 600, fontSize: 12 }}>Offboarded</span> : '—'}</td>
                        <td>
                          <div className="admin-progress-bar"><div className="admin-progress-fill" style={{width: `${(displayDone / totalSteps) * 100}%`}} /></div>
                          <span className="admin-progress-text">{displayDone}/{totalSteps}{skippedCount > 0 ? ` (${skippedCount} skipped)` : ''}</span>
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
              {onbTotalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 12 }}>
                  <button className="admin-action-btn" disabled={onbPage <= 1} onClick={() => setOnbPage(p => p - 1)}>Prev</button>
                  <span style={{ fontSize: 13 }}>Page {onbPage} of {onbTotalPages}</span>
                  <button className="admin-action-btn" disabled={onbPage >= onbTotalPages} onClick={() => setOnbPage(p => p + 1)}>Next</button>
                </div>
              )}
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
            {activeSteps.map((step, i) => {
              const done = stepChecks[step.step_key]
              const skipped = stepSkips[step.step_key]
              const isCurrent = i === workflowStep
              return (
                <div key={step.step_key} className={`admin-wf-step ${done ? 'admin-wf-done' : ''} ${skipped ? 'admin-wf-skipped' : ''} ${isCurrent ? 'admin-wf-current' : ''}`} onClick={() => { setWorkflowStep(i); if (step.step_key === 'accounts' && selectedId && features.inflowonboarder_integration) loadM365Actions(selectedId) }}>
                  <div className="admin-wf-connector" />
                  <div className="admin-wf-dot">{done ? '✓' : skipped ? '⏭' : step.icon}</div>
                  <div className="admin-wf-content">
                    <h4>{step.label}{skipped && <span className="admin-wf-skip-badge">Skipped</span>}</h4>
                    {isCurrent && (
                      <div className="admin-wf-detail">
                        <p>{step.description}</p>

                        {step.step_key === 'accounts' && features.inflowonboarder_integration && ifoConnected && selectedRecord && !done && (
                          <div style={{ border: '1px solid #90caf9', borderRadius: 10, padding: 16, marginTop: 12, marginBottom: 8, background: 'rgba(232,242,255,.5)' }} onClick={e => e.stopPropagation()}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                              <svg width="20" height="20" viewBox="0 0 512 512"><rect width="512" height="512" rx="64" fill="#0078D4"/><circle cx="256" cy="256" r="100" fill="none" stroke="#fff" strokeWidth="32"/><circle cx="256" cy="256" r="16" fill="#fff"/></svg>
                              <strong style={{ fontSize: 14, color: '#0078D4' }}>Microsoft 365 Provisioning</strong>
                              {m365RunPolling && <span style={{ fontSize: 12, color: '#1976d2', marginLeft: 8 }}>Polling...</span>}
                              <button className="admin-btn-sm" style={{ marginLeft: 'auto', padding: '2px 10px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}
                                disabled={m365RunPolling || m365PanelRefreshing}
                                onClick={async e => { e.stopPropagation(); setM365PanelRefreshing(true); await loadM365Actions(selectedRecord.id); setM365PanelRefreshing(false) }}
                                title="Refresh M365 status">
                                {m365PanelRefreshing ? <><div style={{ width: 12, height: 12, border: '2px solid #ccc', borderTopColor: '#0078D4', borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} /> Refreshing...</> : <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Refresh</>}
                              </button>
                            </div>

                            {/* V1 legacy starters */}
                            {m365Actions?.is_v1_legacy && (
                              <div style={{ background: 'rgba(255,248,225,.5)', border: '1px solid #ffe0b2', borderRadius: 6, padding: 10, marginBottom: 12 }}>
                                <p style={{ margin: 0, fontSize: 13, color: '#e65100', fontWeight: 600 }}>Legacy provisioning (v1)</p>
                                <p style={{ margin: '4px 0 8px', fontSize: 12, color: '#bf360c' }}>
                                  This starter was created before the automated workflow. Account: {m365Actions.m365_upn || 'unknown'}.
                                </p>
                                {m365Actions.run_status !== 'completed' && (
                                  <button className="admin-btn-sm" onClick={e => { e.stopPropagation(); m365MarkCompleteManual(selectedRecord.id) }}
                                    style={{ alignSelf: 'flex-start' }}>
                                    Mark Complete Manually
                                  </button>
                                )}
                                {m365Actions.run_status === 'completed' && (
                                  <p style={{ margin: 0, fontSize: 12, color: '#2e7d32', fontWeight: 600 }}>Marked as complete</p>
                                )}
                              </div>
                            )}

                            {/* No run yet — start form or schedule */}
                            {!m365Actions?.is_v1_legacy && (!m365Actions || (!m365Actions.run_id && !m365Actions.run_status && !m365Actions.schedule_id)) && (
                              <div style={{ marginBottom: 12 }}>
                                {m365SchedulingAvailable && (
                                  <div style={{ display: 'flex', gap: 0, marginBottom: 10, borderRadius: 6, overflow: 'hidden', border: '1px solid #90caf9', width: 'fit-content' }}>
                                    <button onClick={e => { e.stopPropagation(); setM365ScheduleMode('now') }}
                                      style={{ padding: '5px 14px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer',
                                        background: m365ScheduleMode === 'now' ? '#0078D4' : '#fff', color: m365ScheduleMode === 'now' ? '#fff' : '#0078D4' }}>
                                      Run Now
                                    </button>
                                    <button onClick={e => { e.stopPropagation(); setM365ScheduleMode('schedule') }}
                                      style={{ padding: '5px 14px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer',
                                        background: m365ScheduleMode === 'schedule' ? '#0078D4' : '#fff', color: m365ScheduleMode === 'schedule' ? '#fff' : '#0078D4' }}>
                                      Schedule
                                    </button>
                                  </div>
                                )}
                                {(!m365SchedulingAvailable || m365ScheduleMode === 'now') && (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                      <div style={{ flex: 1, minWidth: 0 }}>
                                        <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 2 }}>UPN (email)</label>
                                        <input className="admin-input" value={m365Upn} onChange={e => setM365Upn(e.target.value)} style={{ fontSize: 13, width: '100%', boxSizing: 'border-box' }} />
                                      </div>
                                      <div style={{ flex: 1, minWidth: 0 }}>
                                        <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 2 }}>Display Name</label>
                                        <input className="admin-input" value={m365DisplayName} onChange={e => setM365DisplayName(e.target.value)} style={{ fontSize: 13, width: '100%', boxSizing: 'border-box' }} />
                                      </div>
                                    </div>
                                    <div style={{ width: 100 }}>
                                      <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 2 }}>Country</label>
                                      <input className="admin-input" value={m365Location} onChange={e => setM365Location(e.target.value)} style={{ fontSize: 13, width: '100%', boxSizing: 'border-box' }} maxLength={2} />
                                    </div>
                                    <button className="admin-btn-sm admin-btn-save" disabled={m365Starting || m365RunPolling || !m365Upn}
                                      onClick={e => { e.stopPropagation(); m365StartRun(selectedRecord) }}
                                      style={{ background: '#0078D4', alignSelf: 'flex-start' }}>
                                      {m365Starting ? 'Starting...' : 'Start M365 Provisioning'}
                                    </button>
                                  </div>
                                )}
                                {m365SchedulingAvailable && m365ScheduleMode === 'schedule' && (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                      <div style={{ flex: 1, minWidth: 0 }}>
                                        <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 2 }}>UPN (email)</label>
                                        <input className="admin-input" value={m365Upn} onChange={e => setM365Upn(e.target.value)} style={{ fontSize: 13, width: '100%', boxSizing: 'border-box' }} />
                                      </div>
                                      <div style={{ flex: 1, minWidth: 0 }}>
                                        <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 2 }}>Display Name</label>
                                        <input className="admin-input" value={m365DisplayName} onChange={e => setM365DisplayName(e.target.value)} style={{ fontSize: 13, width: '100%', boxSizing: 'border-box' }} />
                                      </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                      <div style={{ width: 100 }}>
                                        <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 2 }}>Country</label>
                                        <input className="admin-input" value={m365Location} onChange={e => setM365Location(e.target.value)} style={{ fontSize: 13, width: '100%', boxSizing: 'border-box' }} maxLength={2} />
                                      </div>
                                      <div style={{ width: 160 }}>
                                        <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 2 }}>Prepare account on</label>
                                        <input className="admin-input" type="date"
                                          value={(() => { const d = new Date(new Date(selectedRecord.start_date).getTime() - m365PrepareDays * 86400000); return d.toISOString().split('T')[0] })()}
                                          min={new Date().toISOString().split('T')[0]}
                                          max={new Date(new Date(selectedRecord.start_date).getTime() - 86400000).toISOString().split('T')[0]}
                                          onChange={e => { const diff = Math.round((new Date(selectedRecord.start_date).getTime() - new Date(e.target.value).getTime()) / 86400000); setM365PrepareDays(Math.max(1, diff)) }}
                                          style={{ fontSize: 13, width: '100%', boxSizing: 'border-box' }} />
                                      </div>
                                    </div>
                                    <div style={{ background: 'rgba(232,242,255,.5)', border: '1px solid #bbdefb', borderRadius: 6, padding: 10 }}>
                                      <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 600, color: '#1565c0' }}>Schedule plan</p>
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                                          <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#e3f2fd', border: '1px solid #90caf9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#1565c0', flexShrink: 0 }}>1</span>
                                          <span>Prepare account — <strong>{new Date(new Date(selectedRecord.start_date).getTime() - m365PrepareDays * 86400000).toLocaleDateString('en-GB')}</strong> at 09:00</span>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                                          <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#e3f2fd', border: '1px solid #90caf9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#1565c0', flexShrink: 0 }}>2</span>
                                          <span>Enable sign-in — <strong>{new Date(selectedRecord.start_date).toLocaleDateString('en-GB')}</strong> at 08:00</span>
                                        </div>
                                      </div>
                                    </div>
                                    <button className="admin-btn-sm admin-btn-save" disabled={m365ApprovalSending || !m365Upn}
                                      onClick={e => { e.stopPropagation(); m365SendScheduleApproval(selectedRecord) }}
                                      style={{ background: '#0078D4', alignSelf: 'flex-start' }}>
                                      {m365ApprovalSending ? 'Sending...' : 'Send Schedule for Approval'}
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Schedule tracking panel */}
                            {!m365Actions?.is_v1_legacy && m365Actions?.schedule_id && (
                              <div style={{ marginBottom: 12 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                  <span style={{ fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
                                    background: m365Actions.schedule_status === 'scheduled' ? '#e3f2fd' : m365Actions.schedule_status === 'running' ? '#fff3e0' : m365Actions.schedule_status === 'completed' ? '#e8f5e9' : m365Actions.schedule_status === 'cancelled' ? '#fafafa' : m365Actions.schedule_status === 'failed' || m365Actions.schedule_status === 'missed' ? '#fce4ec' : m365Actions.schedule_status === 'blocked' ? '#fff8e1' : '#f5f5f5',
                                    color: m365Actions.schedule_status === 'scheduled' ? '#1565c0' : m365Actions.schedule_status === 'running' ? '#e65100' : m365Actions.schedule_status === 'completed' ? '#2e7d32' : m365Actions.schedule_status === 'cancelled' ? '#888' : m365Actions.schedule_status === 'failed' || m365Actions.schedule_status === 'missed' ? '#c62828' : m365Actions.schedule_status === 'blocked' ? '#f57f17' : '#666',
                                  }}>
                                    {(m365Actions.schedule_status || 'unknown').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                                  </span>
                                  <button className="admin-btn-sm" style={{ marginLeft: 'auto', padding: '2px 10px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}
                                    disabled={m365ScheduleRefreshing}
                                    onClick={e => { e.stopPropagation(); m365RefreshSchedule(m365Actions!.schedule_id!, selectedRecord.id) }}>
                                    {m365ScheduleRefreshing ? <><div style={{ width: 12, height: 12, border: '2px solid #ccc', borderTopColor: '#0078D4', borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} /> Refreshing...</> : <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Refresh</>}
                                  </button>
                                </div>
                                {m365Actions.schedule_message && (
                                  <p style={{ margin: '0 0 8px', fontSize: 12, color: '#555', background: 'rgba(0,0,0,.03)', padding: '6px 10px', borderRadius: 4 }}>{m365Actions.schedule_message}</p>
                                )}
                                {m365Actions.schedule_stages && Array.isArray(m365Actions.schedule_stages) && (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
                                    {m365Actions.schedule_stages.map((stage: any, si: number) => (
                                      <div key={si} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 8px', background: 'rgba(255,255,255,.6)', borderRadius: 4, border: '1px solid #e0e0e0' }}>
                                        <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                                          background: stage.status === 'completed' ? '#4caf50' : stage.status === 'running' ? '#ff9800' : stage.status === 'failed' ? '#f44336' : stage.status === 'skipped' ? '#bbb' : '#90caf9',
                                        }} />
                                        <span style={{ fontWeight: 600 }}>{(stage.name || '').replace(/_/g, ' ')}</span>
                                        <span style={{ color: '#888' }}>{stage.scheduledAt ? new Date(stage.scheduledAt).toLocaleString('en-GB') : ''}</span>
                                        <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 500,
                                          color: stage.status === 'completed' ? '#2e7d32' : stage.status === 'running' ? '#e65100' : stage.status === 'failed' ? '#c62828' : '#888',
                                        }}>{stage.status}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                  {m365Actions.schedule_status === 'blocked' && (
                                    <button className="admin-btn-sm" disabled={m365ScheduleRefreshing}
                                      onClick={e => { e.stopPropagation(); m365RecheckSchedule(m365Actions!.schedule_id!, selectedRecord.id) }}>
                                      Check Again
                                    </button>
                                  )}
                                  {!['completed', 'cancelled', 'failed'].includes(m365Actions.schedule_status || '') && (
                                    <button className="admin-btn-sm admin-btn-cancel" disabled={m365ScheduleCancelling}
                                      onClick={e => { e.stopPropagation(); m365CancelSchedule(m365Actions!.schedule_id!, selectedRecord.id, 'Cancelled by admin') }}>
                                      {m365ScheduleCancelling ? 'Cancelling...' : 'Cancel Schedule'}
                                    </button>
                                  )}
                                </div>
                                {m365Actions.schedule_status === 'completed' && m365Actions.run_result && (
                                  <div style={{ marginTop: 8, background: 'rgba(232,245,233,.5)', border: '1px solid #a5d6a7', borderRadius: 6, padding: 10 }}>
                                    <p style={{ margin: 0, fontSize: 13, color: '#2e7d32', fontWeight: 600 }}>Schedule completed</p>
                                    {m365Actions.m365_upn && <p style={{ margin: '2px 0 0', fontSize: 12, color: '#4caf50' }}>UPN: {m365Actions.m365_upn}</p>}
                                    {m365Actions.m365_user_id && <p style={{ margin: '2px 0 0', fontSize: 12, color: '#4caf50' }}>User ID: {m365Actions.m365_user_id}</p>}
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Schedule pending approval */}
                            {!m365Actions?.is_v1_legacy && m365Actions?.schedule_status === 'pending_approval' && !m365Actions.schedule_id && (
                              <div style={{ marginBottom: 12 }}>
                                {m365Actions.approval_status === 'pending' && (
                                  <div style={{ background: 'rgba(255,248,225,.5)', border: '1px solid #ffe0b2', borderRadius: 6, padding: 10 }}>
                                    <p style={{ margin: 0, fontSize: 13, color: '#e65100', fontWeight: 600 }}>Schedule awaiting approval</p>
                                    <p style={{ margin: '4px 0 0', fontSize: 12, color: '#bf360c' }}>
                                      Sent {m365Actions.approval_sent_at ? `on ${new Date(m365Actions.approval_sent_at).toLocaleString('en-GB')}` : ''}
                                    </p>
                                  </div>
                                )}
                                {m365Actions.approval_status === 'approved' && (
                                  <div>
                                    <div style={{ background: 'rgba(232,245,233,.5)', border: '1px solid #a5d6a7', borderRadius: 6, padding: 10, marginBottom: 8 }}>
                                      <p style={{ margin: 0, fontSize: 13, color: '#2e7d32', fontWeight: 600 }}>Schedule approved — ready to create</p>
                                    </div>
                                    <button className="admin-btn-sm admin-btn-save" disabled={m365ScheduleCreating}
                                      onClick={e => { e.stopPropagation(); m365CreateSchedule(selectedRecord) }}
                                      style={{ background: '#0078D4' }}>
                                      {m365ScheduleCreating ? 'Creating...' : 'Create Schedule'}
                                    </button>
                                  </div>
                                )}
                                {m365Actions.approval_status === 'declined' && (
                                  <div>
                                    <div style={{ background: 'rgba(255,235,238,.7)', border: '1px solid #ef9a9a', borderRadius: 6, padding: 10, marginBottom: 8 }}>
                                      <p style={{ margin: 0, fontSize: 13, color: '#c62828', fontWeight: 600 }}>Schedule approval declined</p>
                                    </div>
                                    <button className="admin-btn-sm admin-btn-save" disabled={m365ApprovalSending}
                                      onClick={e => { e.stopPropagation(); m365SendScheduleApproval(selectedRecord) }}
                                      style={{ background: '#0078D4' }}>
                                      Re-send for Approval
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Checking licence (or unknown status with a run_id) */}
                            {!m365Actions?.is_v1_legacy && (m365Actions?.run_status === 'checking_licence' || (m365Actions?.run_id && !m365Actions?.run_status)) && (
                              <div style={{ marginBottom: 12 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                  <span style={{ fontSize: 13, color: '#1976d2' }}>Checking licence availability...</span>
                                </div>
                                <button className="admin-btn-sm" disabled={m365RunPolling} style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                                  onClick={e => { e.stopPropagation(); m365RefreshStatus(m365Actions!.run_id!, selectedRecord.id) }}>
                                  {m365RunPolling ? <><div style={{ width: 12, height: 12, border: '2px solid #ccc', borderTopColor: '#0078D4', borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} /> Checking...</> : <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Refresh Status</>}
                                </button>
                              </div>
                            )}

                            {/* Licence unavailable */}
                            {!m365Actions?.is_v1_legacy && m365Actions?.run_status === 'licence_unavailable' && (
                              <div style={{ marginBottom: 12 }}>
                                <div style={{ background: 'rgba(255,248,225,.5)', border: '1px solid #ffe0b2', borderRadius: 6, padding: 10, marginBottom: 8 }}>
                                  <p style={{ margin: 0, fontSize: 13, color: '#e65100', fontWeight: 600 }}>No licence seats available</p>
                                  <p style={{ margin: '4px 0 0', fontSize: 12, color: '#bf360c' }}>
                                    {m365Actions.run_error?.message || 'Purchase more seats then click Re-check.'}
                                    {ifoSettings?.licence_manager_name && (
                                      <> Contact {ifoSettings.licence_manager_name} to add seats.</>
                                    )}
                                  </p>
                                </div>
                                <button className="admin-btn-sm" disabled={m365RunPolling}
                                  onClick={e => { e.stopPropagation(); m365RecheckRun(m365Actions!.run_id!, selectedRecord.id) }}
                                  style={{ alignSelf: 'flex-start' }}>
                                  {m365RunPolling ? 'Re-checking...' : 'Done — Re-check'}
                                </button>
                              </div>
                            )}

                            {/* Ready for approval — not yet sent */}
                            {!m365Actions?.is_v1_legacy && m365Actions?.run_status === 'ready_for_approval' && !m365Actions.approval_status && (
                              <div style={{ marginBottom: 12 }}>
                                <div style={{ background: 'rgba(232,242,255,.5)', border: '1px solid #90caf9', borderRadius: 6, padding: 10, marginBottom: 8 }}>
                                  <p style={{ margin: 0, fontSize: 13, color: '#1565c0', fontWeight: 600 }}>Licence available — ready for approval</p>
                                  <p style={{ margin: '4px 0 0', fontSize: 12, color: '#1976d2' }}>
                                    Approver: {ifoSettings?.approver_mode === 'manager'
                                      ? ((selectedRecord as any).manager || 'Joiner\'s manager')
                                      : (ifoSettings?.approver_name || ifoSettings?.approver_email || 'Nominated person')}
                                  </p>
                                </div>
                                <button className="admin-btn-sm admin-btn-save" disabled={m365ApprovalSending}
                                  onClick={e => { e.stopPropagation(); m365SendApproval(selectedRecord) }}
                                  style={{ background: '#0078D4', alignSelf: 'flex-start' }}>
                                  {m365ApprovalSending ? 'Sending...' : 'Send for Approval'}
                                </button>
                              </div>
                            )}

                            {/* Approval pending */}
                            {!m365Actions?.is_v1_legacy && m365Actions?.approval_status === 'pending' && (
                              <div style={{ marginBottom: 12, background: 'rgba(255,248,225,.5)', border: '1px solid #ffe0b2', borderRadius: 6, padding: 10 }}>
                                <p style={{ margin: 0, fontSize: 13, color: '#e65100', fontWeight: 600 }}>Waiting for approval</p>
                                <p style={{ margin: '4px 0 0', fontSize: 12, color: '#bf360c' }}>
                                  Sent to {ifoSettings?.approver_mode === 'manager'
                                    ? ((selectedRecord as any).manager_email || 'manager')
                                    : (ifoSettings?.approver_email || 'approver')}
                                  {m365Actions.approval_sent_at && <> on {new Date(m365Actions.approval_sent_at).toLocaleString('en-GB')}</>}
                                </p>
                              </div>
                            )}

                            {/* Approval approved — proceed */}
                            {!m365Actions?.is_v1_legacy && m365Actions?.approval_status === 'approved' && m365Actions?.run_status === 'ready_for_approval' && (
                              <div style={{ marginBottom: 12 }}>
                                <div style={{ background: 'rgba(232,245,233,.5)', border: '1px solid #a5d6a7', borderRadius: 6, padding: 10, marginBottom: 8 }}>
                                  <p style={{ margin: 0, fontSize: 13, color: '#2e7d32', fontWeight: 600 }}>Approved by {(m365Actions.approved_by || '').replace(/<[^>]+>/, '').trim() || m365Actions.approved_by}</p>
                                  {m365Actions.approved_at && <p style={{ margin: '2px 0 0', fontSize: 12, color: '#4caf50' }}>{new Date(m365Actions.approved_at).toLocaleString('en-GB')}</p>}
                                </div>
                                <button className="admin-btn-sm admin-btn-save" disabled={m365Proceeding}
                                  onClick={e => { e.stopPropagation(); m365ProceedRun(selectedRecord) }}
                                  style={{ background: '#0078D4', alignSelf: 'flex-start' }}>
                                  {m365Proceeding ? 'Proceeding...' : 'Proceed — Create Account'}
                                </button>
                              </div>
                            )}

                            {/* Approval declined */}
                            {!m365Actions?.is_v1_legacy && m365Actions?.approval_status === 'declined' && (
                              <div style={{ marginBottom: 12 }}>
                                <div style={{ background: 'rgba(255,235,238,.7)', border: '1px solid #ef9a9a', borderRadius: 6, padding: 10, marginBottom: 8 }}>
                                  <p style={{ margin: 0, fontSize: 13, color: '#c62828', fontWeight: 600 }}>Approval declined</p>
                                  <p style={{ margin: '4px 0 0', fontSize: 12, color: '#c62828' }}>
                                    Declined by {(m365Actions.approved_by || '').replace(/<[^>]+>/, '').trim() || m365Actions.approved_by}
                                    {m365Actions.approved_at && <> on {new Date(m365Actions.approved_at).toLocaleString('en-GB')}</>}
                                  </p>
                                </div>
                                <button className="admin-btn-sm admin-btn-save" disabled={m365ApprovalSending}
                                  onClick={e => { e.stopPropagation(); m365SendApproval(selectedRecord) }}
                                  style={{ background: '#0078D4', alignSelf: 'flex-start' }}>
                                  Re-send for Approval
                                </button>
                              </div>
                            )}

                            {/* Provisioning in progress */}
                            {!m365Actions?.is_v1_legacy && m365Actions?.run_status === 'provisioning' && (
                              <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontSize: 13, color: '#1976d2' }}>Provisioning in progress — creating account, assigning licence and adding to group...</span>
                              </div>
                            )}

                            {/* Awaiting approval (engine-side) */}
                            {!m365Actions?.is_v1_legacy && m365Actions?.run_status === 'awaiting_approval' && (
                              <div style={{ marginBottom: 12, background: 'rgba(255,248,225,.5)', border: '1px solid #ffe0b2', borderRadius: 6, padding: 10 }}>
                                <p style={{ margin: 0, fontSize: 13, color: '#e65100', fontWeight: 600 }}>Awaiting approval in InflowOnboarder</p>
                                <p style={{ margin: '4px 0 0', fontSize: 12, color: '#bf360c' }}>
                                  The engine is waiting for approval. This will update automatically.
                                </p>
                              </div>
                            )}

                            {/* Completed */}
                            {!m365Actions?.is_v1_legacy && m365Actions?.run_status === 'completed' && (
                              <div style={{ background: 'rgba(232,245,233,.5)', border: '1px solid #a5d6a7', borderRadius: 6, padding: 10, marginBottom: 12 }}>
                                <p style={{ margin: 0, fontSize: 13, color: '#2e7d32', fontWeight: 600 }}>M365 provisioning complete</p>
                                {m365Actions.m365_upn && <p style={{ margin: '2px 0 0', fontSize: 12, color: '#4caf50' }}>UPN: {m365Actions.m365_upn}</p>}
                                {m365Actions.m365_user_id && <p style={{ margin: '2px 0 0', fontSize: 12, color: '#4caf50' }}>User ID: {m365Actions.m365_user_id}</p>}
                                {m365Actions.run_result?.temporaryPassword && (
                                  <div style={{ marginTop: 6, padding: '6px 10px', background: 'rgba(255,248,225,.7)', border: '1px solid #ffe0b2', borderRadius: 4 }}>
                                    <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: '#e65100' }}>Temporary Password</p>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '2px 0 0' }}>
                                      <p style={{ margin: 0, fontSize: 13, fontFamily: 'monospace', color: '#bf360c' }}>{'•'.repeat(12)}</p>
                                      <button
                                        style={{ background: 'none', border: '1px solid #e65100', borderRadius: 3, padding: '1px 6px', fontSize: 11, color: '#e65100', cursor: 'pointer' }}
                                        onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(m365Actions.run_result.temporaryPassword) }}
                                      >Copy</button>
                                    </div>
                                    <p style={{ margin: '4px 0 0', fontSize: 11, color: '#e65100' }}>Share securely with the new starter — they must change it on first sign-in.</p>
                                  </div>
                                )}
                                {m365Actions.run_result?.manual && <p style={{ margin: '2px 0 0', fontSize: 12, color: '#666' }}>Completed manually by {m365Actions.run_result.completedBy}</p>}
                              </div>
                            )}

                            {/* Failed */}
                            {!m365Actions?.is_v1_legacy && m365Actions?.run_status === 'failed' && (
                              <div style={{ marginBottom: 12 }}>
                                <div style={{ background: 'rgba(255,235,238,.7)', border: '1px solid #ef9a9a', borderRadius: 6, padding: 10, marginBottom: 8 }}>
                                  <p style={{ margin: 0, fontSize: 13, color: '#c62828', fontWeight: 600 }}>Provisioning failed</p>
                                  {m365Actions.run_error && (
                                    <p style={{ margin: '4px 0 0', fontSize: 12, color: '#c62828' }}>
                                      {m365Actions.run_error.code}: {m365Actions.run_error.message}
                                    </p>
                                  )}
                                </div>
                                <div style={{ display: 'flex', gap: 8 }}>
                                  <button className="admin-btn-sm" disabled={m365RunPolling}
                                    onClick={e => { e.stopPropagation(); m365RecheckRun(m365Actions!.run_id!, selectedRecord.id) }}>
                                    Re-check
                                  </button>
                                  <button className="admin-btn-sm"
                                    onClick={e => { e.stopPropagation(); m365MarkCompleteManual(selectedRecord.id) }}>
                                    Mark Complete Manually
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        <div className="admin-wf-actions">
                          {done ? (
                            <button className="admin-btn-sm admin-btn-cancel" onClick={e => { e.stopPropagation(); uncompleteStep(step.step_key) }}>Undo</button>
                          ) : skipped ? (
                            <>
                              <button className="admin-btn-sm admin-btn-save" onClick={e => { e.stopPropagation(); completeStep(step.step_key) }}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                                Mark Complete
                              </button>
                              <button className="admin-btn-sm admin-btn-cancel" onClick={e => { e.stopPropagation(); uncompleteStep(step.step_key) }}>Undo Skip</button>
                            </>
                          ) : (
                            <>
                              <button className="admin-btn-sm admin-btn-save" onClick={e => { e.stopPropagation(); completeStep(step.step_key) }}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                                Mark Complete
                              </button>
                              {step.step_key !== 'details' && (
                                <button className="admin-btn-sm admin-btn-skip" onClick={e => { e.stopPropagation(); skipStep(step.step_key) }}>
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

      {tab === 'offboarding' && (
        <div>
          {/* New Offboard */}
          <div style={{ background: 'var(--admin-card-bg, #fff)', borderRadius: 12, padding: 20, border: '1px solid var(--admin-border, #e0e0e0)', marginBottom: 20 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>Start Offboarding</h3>
            <input
              className="admin-input"
              placeholder="Search employee by name or email..."
              value={offboardEmployeeSearch}
              onChange={e => searchEmployeesForOffboard(e.target.value)}
              style={{ marginBottom: 8 }}
            />
            {offboardEmployeeResults.length > 0 && (
              <div style={{ border: '1px solid #e0e0e0', borderRadius: 8, maxHeight: 200, overflowY: 'auto', marginBottom: 12 }}>
                {offboardEmployeeResults.map(emp => (
                  <div key={emp.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid #f0f0f0', fontSize: 13 }}>
                    <div>
                      <strong>{emp.first_name} {emp.last_name}</strong>
                      <span style={{ color: '#888', marginLeft: 8 }}>{emp.job_title} · {emp.department}</span>
                    </div>
                    <button className="admin-btn-sm admin-btn-save" onClick={() => {
                      setOffboardEmployeeSearch(`${emp.first_name} ${emp.last_name}`)
                      setOffboardEmployeeResults([])
                    }} style={{ display: 'none' }} />
                    <button className="admin-btn-sm" style={{ background: '#c62828', color: '#fff', border: 'none' }} onClick={() => createOffboardRecord(emp)}>
                      Start Offboarding
                    </button>
                  </div>
                ))}
              </div>
            )}
            {offboardEmployeeSearch.length >= 2 && offboardEmployeeResults.length > 0 && (
              <div className="admin-form-grid" style={{ marginTop: 0 }}>
                <div className="admin-form-field">
                  <label>Last Working Date</label>
                  <input type="date" className="admin-input" value={offboardForm.end_date} onChange={e => setOffboardForm(p => ({ ...p, end_date: e.target.value }))} />
                </div>
                <div className="admin-form-field">
                  <label>Reason</label>
                  <select className="admin-select" value={offboardForm.reason} onChange={e => setOffboardForm(p => ({ ...p, reason: e.target.value }))}>
                    <option value="">Select reason</option>
                    <option>Resignation</option>
                    <option>Redundancy</option>
                    <option>End of contract</option>
                    <option>Retirement</option>
                    <option>Dismissal</option>
                    <option>Mutual agreement</option>
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* Active Offboarding List */}
          {activeOffboardRecords.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 12px' }}>Active Offboarding</h3>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead><tr><th>Employee</th><th>Role</th><th>End Date</th><th>Reason</th><th>Progress</th><th>Actions</th></tr></thead>
                  <tbody>
                    {paginatedActiveOffboard.map(r => {
                      const doneCount = OFFBOARD_STEPS.filter(s => r.workflow_steps?.[s.key] || r.skipped_steps?.[s.key]).length
                      return (
                        <tr key={r.id}>
                          <td><strong>{r.employee_name}</strong><br /><span style={{ fontSize: 12, color: '#888' }}>{r.employee_email}</span></td>
                          <td>{r.job_title || '—'}</td>
                          <td>{r.end_date ? new Date(r.end_date).toLocaleDateString('en-GB') : '—'}</td>
                          <td>{r.reason || '—'}</td>
                          <td>
                            <div className="admin-progress-bar"><div className="admin-progress-fill" style={{ width: `${(doneCount / OFFBOARD_STEPS.length) * 100}%`, background: '#c62828' }} /></div>
                            <span className="admin-progress-text">{doneCount}/{OFFBOARD_STEPS.length}</span>
                          </td>
                          <td className="admin-actions">
                            <button className="admin-btn-sm admin-btn-save" onClick={() => openOffboardWorkflow(r)}>Workflow</button>
                            <button className="admin-btn-sm" style={{ background: '#e0e0e0', color: '#333', border: 'none' }} onClick={() => cancelOffboarding(r)}>Cancel</button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {offTotalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 12 }}>
                  <button className="admin-action-btn" disabled={offPage <= 1} onClick={() => setOffPage(p => p - 1)}>Prev</button>
                  <span style={{ fontSize: 13 }}>Page {offPage} of {offTotalPages}</span>
                  <button className="admin-action-btn" disabled={offPage >= offTotalPages} onClick={() => setOffPage(p => p + 1)}>Next</button>
                </div>
              )}
            </div>
          )}

          {/* Frozen Employees */}
          <div>
            <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 12px' }}>Frozen Employees — Deletion Queue</h3>
            {frozenEmployees.length > 0 ? (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead><tr><th>Employee</th><th>Frozen Date</th><th>Deletion Countdown</th><th>Status</th><th>Actions</th></tr></thead>
                  <tbody>
                    {paginatedFrozen.map(f => {
                      const now = new Date()
                      const effectiveDelDate = new Date(f.deletion_date)
                      if (f.extension_days) effectiveDelDate.setDate(effectiveDelDate.getDate() + f.extension_days)
                      const daysLeft = Math.ceil((effectiveDelDate.getTime() - now.getTime()) / 86400000)
                      const totalDays = 30 + (f.extension_days || 0)
                      const elapsed = totalDays - Math.max(daysLeft, 0)
                      const pct = Math.min(100, Math.max(0, (elapsed / totalDays) * 100))
                      const barColor = daysLeft <= 7 ? '#c62828' : daysLeft <= 15 ? '#ff9800' : '#4caf50'
                      const statusLabel = f.status === 'recovered' ? 'Recovered' : daysLeft <= 0 ? 'Ready to Delete' : 'Awaiting Expiry'
                      const statusColor = f.status === 'recovered' ? '#43a047' : daysLeft <= 0 ? '#c62828' : '#ff9800'
                      return (
                        <tr key={f.id}>
                          <td><strong>{f.employee_name}</strong><br /><span style={{ fontSize: 12, color: '#888' }}>{f.employee_email}</span></td>
                          <td>{new Date(f.frozen_at).toLocaleDateString('en-GB')}</td>
                          <td>
                            {f.status !== 'recovered' ? (
                              <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                                  <span style={{ fontWeight: 600, color: daysLeft <= 7 ? '#c62828' : '#333' }}>{daysLeft > 0 ? `${daysLeft} day${daysLeft !== 1 ? 's' : ''} remaining` : 'Expired'}</span>
                                  <span style={{ color: '#888' }}>{effectiveDelDate.toLocaleDateString('en-GB')}</span>
                                </div>
                                <div style={{ background: '#e0e0e0', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                                  <div style={{ background: barColor, height: '100%', width: `${pct}%`, borderRadius: 4, transition: 'width 0.3s' }} />
                                </div>
                                {f.extended_at && <span style={{ fontSize: 11, color: '#2196f3', marginTop: 2, display: 'block' }}>+15 day extension applied</span>}
                              </div>
                            ) : <span style={{ color: '#888' }}>—</span>}
                          </td>
                          <td><span className="admin-badge" style={{ background: statusColor, color: '#fff' }}>{statusLabel}</span></td>
                          <td className="admin-actions">
                            {f.status !== 'recovered' && (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                <div style={{ display: 'flex', gap: 4 }}>
                                  <button className="admin-btn-sm" style={{ background: '#43a047', color: '#fff', border: 'none' }} onClick={() => recoverEmployee(f)}>Recover</button>
                                  <button className="admin-btn-sm" style={{ background: '#c62828', color: '#fff', border: 'none' }} onClick={() => deleteEmployee(f)}>Delete Now</button>
                                </div>
                                {!f.extended_at && daysLeft > 0 && (
                                  <button className="admin-btn-sm" style={{ background: '#2196f3', color: '#fff', border: 'none', fontSize: 11 }} onClick={() => extendFrozenPeriod(f)}>
                                    Extend +15 Days
                                  </button>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="admin-empty">No frozen employees</div>
            )}
            {frozenTotalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 12 }}>
                <button className="admin-action-btn" disabled={frozenPage <= 1} onClick={() => setFrozenPage(p => p - 1)}>Prev</button>
                <span style={{ fontSize: 13 }}>Page {frozenPage} of {frozenTotalPages}</span>
                <button className="admin-action-btn" disabled={frozenPage >= frozenTotalPages} onClick={() => setFrozenPage(p => p + 1)}>Next</button>
              </div>
            )}
            <p style={{ margin: '12px 0 0', fontSize: 12, color: '#888', fontStyle: 'italic' }}>
              After the retention period expires, ALL employee data is permanently deleted and a deletion certificate is produced for GDPR compliance.
            </p>
          </div>

          {/* Deletion Certificates */}
          {deletionCertificates.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 12px' }}>Deletion Certificates</h3>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead><tr><th>Employee</th><th>Certificate Ref</th><th>Deleted</th><th>Retention</th><th>Data Categories</th></tr></thead>
                  <tbody>
                    {deletionCertificates.map(cert => (
                      <tr key={cert.id}>
                        <td><strong>{cert.employee_name}</strong><br /><span style={{ fontSize: 12, color: '#888' }}>{cert.employee_email}</span></td>
                        <td><code style={{ fontSize: 12, background: '#f5f5f5', padding: '2px 6px', borderRadius: 4 }}>{cert.certificate_reference}</code></td>
                        <td>{new Date(cert.deleted_at).toLocaleDateString('en-GB')}</td>
                        <td>{cert.retention_days} days{cert.data_export_provided && <span style={{ fontSize: 11, color: '#4caf50', marginLeft: 4 }}>(export provided)</span>}</td>
                        <td style={{ fontSize: 12 }}>
                          {cert.data_categories_held.length > 0 ? (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                              {cert.data_categories_held.map((cat, i) => (
                                <span key={i} style={{ background: '#e3f2fd', padding: '1px 6px', borderRadius: 4, fontSize: 11 }}>{cat.replace(/_/g, ' ')}</span>
                              ))}
                            </div>
                          ) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Completed Offboarding */}
          {completedOffboardRecords.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 12px', color: '#888' }}>Completed Offboarding</h3>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead><tr><th>Employee</th><th>Role</th><th>End Date</th><th>Reason</th><th>Frozen</th></tr></thead>
                  <tbody>
                    {paginatedCompletedOffboard.map(r => (
                      <tr key={r.id} style={{ opacity: 0.7 }}>
                        <td><strong>{r.employee_name}</strong></td>
                        <td>{r.job_title || '—'}</td>
                        <td>{r.end_date ? new Date(r.end_date).toLocaleDateString('en-GB') : '—'}</td>
                        <td>{r.reason || '—'}</td>
                        <td>{r.frozen_at ? new Date(r.frozen_at).toLocaleDateString('en-GB') : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {complTotalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 12 }}>
                  <button className="admin-action-btn" disabled={complPage <= 1} onClick={() => setComplPage(p => p - 1)}>Prev</button>
                  <span style={{ fontSize: 13 }}>Page {complPage} of {complTotalPages}</span>
                  <button className="admin-action-btn" disabled={complPage >= complTotalPages} onClick={() => setComplPage(p => p + 1)}>Next</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'offboard-workflow' && (() => {
        const record = offboardRecords.find(r => r.id === offboardSelectedId)
        if (!record) return <div className="admin-empty">Select an offboarding record</div>
        return (
          <div className="admin-workflow">
            <div className="admin-workflow-header">
              <h3>{record.employee_name}</h3>
              <p>{record.job_title} · Last day {record.end_date ? new Date(record.end_date).toLocaleDateString('en-GB') : 'TBC'}</p>
            </div>
            <div className="admin-workflow-timeline">
              {OFFBOARD_STEPS.map((step, i) => {
                const done = offboardChecks[step.key]
                const skipped = offboardSkips[step.key]
                const isCurrent = i === offboardStep
                return (
                  <div key={step.key} className={`admin-wf-step ${done ? 'admin-wf-done' : ''} ${skipped ? 'admin-wf-skipped' : ''} ${isCurrent ? 'admin-wf-current' : ''}`} onClick={() => { setOffboardStep(i); if (step.key === 'reassign_reports' && !done && !skipped && record) loadReassignData(record); if (step.key === 'remove_accounts') loadLeaverM365Actions(record.id) }}>
                    <div className="admin-wf-connector" />
                    <div className="admin-wf-dot">{done ? '✓' : skipped ? '⏭' : step.icon}</div>
                    <div className="admin-wf-content">
                      <h4>{step.label}{skipped && <span className="admin-wf-skip-badge">Skipped</span>}<span style={{ fontSize: 11, color: '#888', fontWeight: 400, marginLeft: 8 }}>{step.role}</span></h4>
                      {isCurrent && (
                        <div className="admin-wf-detail">
                          <p>{step.description}</p>

                          {/* M365 Offboarding panel (InflowOnboarder leaver) */}
                          {step.key === 'remove_accounts' && features.inflowonboarder_integration && ifoConnected && !done && !skipped && (
                            <div style={{ margin: '12px 0', padding: 14, background: 'rgba(0,120,212,.06)', borderRadius: 10, border: '1px solid rgba(0,120,212,.15)' }} onClick={e => e.stopPropagation()}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0078D4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
                                </svg>
                                <strong style={{ fontSize: 13, color: '#0078D4' }}>Microsoft 365 Offboarding</strong>
                                {leaverM365RunPolling && <span style={{ fontSize: 11, color: '#888', fontStyle: 'italic' }}>Checking...</span>}
                                <button className="admin-btn-sm" style={{ marginLeft: 'auto', padding: '2px 10px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}
                                  disabled={leaverM365RunPolling || leaverM365Refreshing}
                                  onClick={e => { e.stopPropagation(); loadLeaverM365Actions(record.id) }}
                                  title="Refresh M365 status">
                                  {leaverM365Refreshing ? <><div style={{ width: 12, height: 12, border: '2px solid #ccc', borderTopColor: '#0078D4', borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} /> Refreshing...</> : <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Refresh</>}
                                </button>
                              </div>

                              {/* No run yet — start or schedule */}
                              {!leaverM365Actions?.run_id && !leaverM365Actions?.schedule_id && !leaverM365Actions?.schedule_status && (
                                <div>
                                  {leaverSchedulingAvailable && (
                                    <div style={{ display: 'flex', gap: 0, marginBottom: 10, borderRadius: 6, overflow: 'hidden', border: '1px solid #90caf9', width: 'fit-content' }}>
                                      <button onClick={e => { e.stopPropagation(); setLeaverScheduleMode('now') }}
                                        style={{ padding: '5px 14px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer',
                                          background: leaverScheduleMode === 'now' ? '#0078D4' : '#fff', color: leaverScheduleMode === 'now' ? '#fff' : '#0078D4' }}>
                                        Run Now
                                      </button>
                                      <button onClick={e => { e.stopPropagation(); setLeaverScheduleMode('schedule') }}
                                        style={{ padding: '5px 14px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer',
                                          background: leaverScheduleMode === 'schedule' ? '#0078D4' : '#fff', color: leaverScheduleMode === 'schedule' ? '#fff' : '#0078D4' }}>
                                        Schedule
                                      </button>
                                    </div>
                                  )}
                                  {(!leaverSchedulingAvailable || leaverScheduleMode === 'now') && (
                                    <div>
                                      <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--text-muted, #666)' }}>
                                        Block sign-in, remove from groups, and revoke licences for <strong>{record.employee_email}</strong>
                                      </p>
                                      <button className="admin-btn-sm admin-btn-save" disabled={leaverM365Starting}
                                        onClick={e => { e.stopPropagation(); leaverM365StartRun(record) }}>
                                        {leaverM365Starting ? 'Starting...' : 'Start M365 Offboarding'}
                                      </button>
                                    </div>
                                  )}
                                  {leaverSchedulingAvailable && leaverScheduleMode === 'schedule' && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                      <div style={{ width: 180 }}>
                                        <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 2 }}>Remove licence & groups on</label>
                                        <input className="admin-input" type="date"
                                          value={(() => { if (!record.end_date) return ''; const d = new Date(new Date(record.end_date).getTime() + leaverLicenceRemovalDays * 86400000); return d.toISOString().split('T')[0] })()}
                                          min={record.end_date ? new Date(record.end_date).toISOString().split('T')[0] : ''}
                                          onChange={e => { if (!record.end_date) return; const diff = Math.round((new Date(e.target.value).getTime() - new Date(record.end_date).getTime()) / 86400000); setLeaverLicenceRemovalDays(Math.max(0, diff)) }}
                                          style={{ fontSize: 13, width: '100%', boxSizing: 'border-box' }} />
                                      </div>
                                      <div style={{ background: 'rgba(232,242,255,.5)', border: '1px solid #bbdefb', borderRadius: 6, padding: 10 }}>
                                        <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 600, color: '#1565c0' }}>Schedule plan</p>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                                            <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#e3f2fd', border: '1px solid #90caf9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#1565c0', flexShrink: 0 }}>1</span>
                                            <span>Block access — <strong>{record.end_date ? new Date(record.end_date).toLocaleDateString('en-GB') : 'leave date'}</strong> at 17:00</span>
                                          </div>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                                            <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#e3f2fd', border: '1px solid #90caf9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#1565c0', flexShrink: 0 }}>2</span>
                                            <span>Remove groups & licence — <strong>{record.end_date ? new Date(new Date(record.end_date).getTime() + leaverLicenceRemovalDays * 86400000).toLocaleDateString('en-GB') : `${leaverLicenceRemovalDays} days after`}</strong> at 17:00</span>
                                          </div>
                                        </div>
                                      </div>
                                      <button className="admin-btn-sm admin-btn-save" disabled={leaverM365ApprovalSending}
                                        onClick={e => { e.stopPropagation(); leaverSendScheduleApproval(record) }}
                                        style={{ background: '#0078D4', alignSelf: 'flex-start' }}>
                                        {leaverM365ApprovalSending ? 'Sending...' : 'Send Schedule for Approval'}
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Schedule pending approval */}
                              {leaverM365Actions?.schedule_status === 'pending_approval' && !leaverM365Actions.schedule_id && (
                                <div style={{ marginBottom: 8 }}>
                                  {leaverM365Actions.approval_status === 'pending' && (
                                    <div style={{ background: 'rgba(255,248,225,.5)', border: '1px solid #ffe0b2', borderRadius: 6, padding: 10 }}>
                                      <p style={{ margin: 0, fontSize: 13, color: '#e65100', fontWeight: 600 }}>Schedule awaiting approval</p>
                                      <p style={{ margin: '4px 0 0', fontSize: 12, color: '#bf360c' }}>
                                        Sent {leaverM365Actions.approval_sent_at ? `on ${new Date(leaverM365Actions.approval_sent_at).toLocaleString('en-GB')}` : ''}
                                      </p>
                                    </div>
                                  )}
                                  {leaverM365Actions.approval_status === 'approved' && (
                                    <div>
                                      <div style={{ background: 'rgba(232,245,233,.5)', border: '1px solid #a5d6a7', borderRadius: 6, padding: 10, marginBottom: 8 }}>
                                        <p style={{ margin: 0, fontSize: 13, color: '#2e7d32', fontWeight: 600 }}>Schedule approved — ready to create</p>
                                      </div>
                                      <button className="admin-btn-sm admin-btn-save" disabled={leaverScheduleCreating}
                                        onClick={e => { e.stopPropagation(); leaverCreateSchedule(record) }}
                                        style={{ background: '#0078D4' }}>
                                        {leaverScheduleCreating ? 'Creating...' : 'Create Schedule'}
                                      </button>
                                    </div>
                                  )}
                                  {leaverM365Actions.approval_status === 'declined' && (
                                    <div>
                                      <div style={{ background: 'rgba(255,235,238,.7)', border: '1px solid #ef9a9a', borderRadius: 6, padding: 10, marginBottom: 8 }}>
                                        <p style={{ margin: 0, fontSize: 13, color: '#c62828', fontWeight: 600 }}>Schedule approval declined</p>
                                      </div>
                                      <button className="admin-btn-sm admin-btn-save" disabled={leaverM365ApprovalSending}
                                        onClick={e => { e.stopPropagation(); leaverSendScheduleApproval(record) }}
                                        style={{ background: '#0078D4' }}>
                                        Re-send for Approval
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Schedule tracking panel */}
                              {leaverM365Actions?.schedule_id && (
                                <div style={{ marginBottom: 8 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                    <span style={{ fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
                                      background: leaverM365Actions.schedule_status === 'scheduled' ? '#e3f2fd' : leaverM365Actions.schedule_status === 'running' ? '#fff3e0' : leaverM365Actions.schedule_status === 'completed' ? '#e8f5e9' : leaverM365Actions.schedule_status === 'cancelled' ? '#fafafa' : leaverM365Actions.schedule_status === 'failed' || leaverM365Actions.schedule_status === 'missed' ? '#fce4ec' : leaverM365Actions.schedule_status === 'blocked' ? '#fff8e1' : '#f5f5f5',
                                      color: leaverM365Actions.schedule_status === 'scheduled' ? '#1565c0' : leaverM365Actions.schedule_status === 'running' ? '#e65100' : leaverM365Actions.schedule_status === 'completed' ? '#2e7d32' : leaverM365Actions.schedule_status === 'cancelled' ? '#888' : leaverM365Actions.schedule_status === 'failed' || leaverM365Actions.schedule_status === 'missed' ? '#c62828' : leaverM365Actions.schedule_status === 'blocked' ? '#f57f17' : '#666',
                                    }}>
                                      {(leaverM365Actions.schedule_status || 'unknown').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                                    </span>
                                    <button className="admin-btn-sm" style={{ marginLeft: 'auto', padding: '2px 10px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}
                                      disabled={leaverScheduleRefreshing}
                                      onClick={e => { e.stopPropagation(); leaverRefreshSchedule(leaverM365Actions!.schedule_id!, record.id) }}>
                                      {leaverScheduleRefreshing ? <><div style={{ width: 12, height: 12, border: '2px solid #ccc', borderTopColor: '#0078D4', borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} /> Refreshing...</> : <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Refresh</>}
                                    </button>
                                  </div>
                                  {leaverM365Actions.schedule_message && (
                                    <p style={{ margin: '0 0 8px', fontSize: 12, color: '#555', background: 'rgba(0,0,0,.03)', padding: '6px 10px', borderRadius: 4 }}>{leaverM365Actions.schedule_message}</p>
                                  )}
                                  {leaverM365Actions.schedule_stages && Array.isArray(leaverM365Actions.schedule_stages) && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
                                      {leaverM365Actions.schedule_stages.map((stage: any, si: number) => (
                                        <div key={si} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 8px', background: 'rgba(255,255,255,.6)', borderRadius: 4, border: '1px solid #e0e0e0' }}>
                                          <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                                            background: stage.status === 'completed' ? '#4caf50' : stage.status === 'running' ? '#ff9800' : stage.status === 'failed' ? '#f44336' : stage.status === 'skipped' ? '#bbb' : '#90caf9',
                                          }} />
                                          <span style={{ fontWeight: 600 }}>{(stage.name || '').replace(/_/g, ' ')}</span>
                                          <span style={{ color: '#888' }}>{stage.scheduledAt ? new Date(stage.scheduledAt).toLocaleString('en-GB') : ''}</span>
                                          <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 500,
                                            color: stage.status === 'completed' ? '#2e7d32' : stage.status === 'running' ? '#e65100' : stage.status === 'failed' ? '#c62828' : '#888',
                                          }}>{stage.status}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                    {leaverM365Actions.schedule_status === 'blocked' && (
                                      <button className="admin-btn-sm" disabled={leaverScheduleRefreshing}
                                        onClick={e => { e.stopPropagation(); leaverRecheckSchedule(leaverM365Actions!.schedule_id!, record.id) }}>
                                        Check Again
                                      </button>
                                    )}
                                    {!['completed', 'cancelled', 'failed'].includes(leaverM365Actions.schedule_status || '') && (
                                      <button className="admin-btn-sm admin-btn-cancel" disabled={leaverScheduleCancelling}
                                        onClick={e => { e.stopPropagation(); leaverCancelSchedule(leaverM365Actions!.schedule_id!, record.id, 'Cancelled by admin') }}>
                                        {leaverScheduleCancelling ? 'Cancelling...' : 'Cancel Schedule'}
                                      </button>
                                    )}
                                  </div>
                                  {leaverM365Actions.schedule_status === 'completed' && leaverM365Actions.run_result && (
                                    <div style={{ marginTop: 8, background: 'rgba(232,245,233,.5)', border: '1px solid #a5d6a7', borderRadius: 6, padding: 10 }}>
                                      <p style={{ margin: 0, fontSize: 13, color: '#2e7d32', fontWeight: 600 }}>Offboarding schedule completed</p>
                                      {leaverM365Actions.run_result?.devices?.length > 0 && (
                                        <div style={{ marginTop: 6 }}>
                                          <strong style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Devices to recover:</strong>
                                          {leaverM365Actions.run_result.devices.map((d: any, di: number) => (
                                            <div key={di} style={{ fontSize: 12, padding: '2px 0' }}>
                                              <strong>{d.deviceName}</strong> — {d.operatingSystem}{d.serialNumber ? ` (S/N: ${d.serialNumber})` : ''}
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Checking account */}
                              {leaverM365Actions?.run_status === 'checking_account' && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <div style={{ width: 16, height: 16, border: '2px solid #ccc', borderTopColor: '#0078D4', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                                  <span style={{ fontSize: 13 }}>Checking account status...</span>
                                </div>
                              )}

                              {/* Account blocked */}
                              {leaverM365Actions?.run_status === 'account_blocked' && (
                                <div>
                                  <div style={{ background: 'rgba(255,235,238,.7)', border: '1px solid #ef9a9a', borderRadius: 6, padding: 10, marginBottom: 8 }}>
                                    <p style={{ margin: 0, fontSize: 13, color: '#c62828', fontWeight: 600 }}>Account blocked</p>
                                    {leaverM365Actions.run_error && (
                                      <p style={{ margin: '4px 0 0', fontSize: 12, color: '#c62828' }}>
                                        {leaverM365Actions.run_error.friendlyMessage || leaverM365Actions.run_error.message || leaverM365Actions.run_error.code}
                                      </p>
                                    )}
                                  </div>
                                  <div style={{ display: 'flex', gap: 8 }}>
                                    <button className="admin-btn-sm" disabled={leaverM365RunPolling}
                                      onClick={e => { e.stopPropagation(); leaverM365RecheckRun(leaverM365Actions!.run_id!, record.id) }}>
                                      Done — Re-check
                                    </button>
                                    <button className="admin-btn-sm"
                                      onClick={e => { e.stopPropagation(); leaverM365MarkCompleteManual(record.id) }}>
                                      Mark Complete Manually
                                    </button>
                                  </div>
                                </div>
                              )}

                              {/* Ready for approval */}
                              {leaverM365Actions?.run_status === 'ready_for_approval' && (
                                <div>
                                  {leaverM365Actions.run_result?.message && (
                                    <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--text, #333)', background: 'rgba(255,255,255,.6)', padding: '8px 10px', borderRadius: 6, border: '1px solid #e0e0e0' }}>
                                      {leaverM365Actions.run_result.message}
                                    </p>
                                  )}
                                  {leaverM365Actions.approval_status === 'pending' ? (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#e65100' }}>
                                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                                      Waiting for approval
                                      <span style={{ fontSize: 11, color: '#888', marginLeft: 4 }}>(auto-refreshing)</span>
                                    </div>
                                  ) : leaverM365Actions.approval_status === 'approved' ? (
                                    <div>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: 13, color: '#2e7d32' }}>
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                                        Approved by {leaverM365Actions.approved_by}
                                      </div>
                                      <button className="admin-btn-sm admin-btn-save" disabled={leaverM365Proceeding}
                                        onClick={e => { e.stopPropagation(); leaverM365ProceedRun(record) }}>
                                        {leaverM365Proceeding ? 'Proceeding...' : 'Proceed with Offboarding'}
                                      </button>
                                    </div>
                                  ) : leaverM365Actions.approval_status === 'declined' ? (
                                    <div>
                                      <p style={{ margin: '0 0 8px', fontSize: 12, color: '#c62828' }}>Approval declined</p>
                                      <button className="admin-btn-sm" onClick={e => { e.stopPropagation(); leaverM365SendApproval(record) }}>
                                        Re-send for Approval
                                      </button>
                                    </div>
                                  ) : (
                                    <button className="admin-btn-sm admin-btn-save" disabled={leaverM365ApprovalSending}
                                      onClick={e => { e.stopPropagation(); leaverM365SendApproval(record) }}>
                                      {leaverM365ApprovalSending ? 'Sending...' : 'Send for Approval'}
                                    </button>
                                  )}
                                </div>
                              )}

                              {/* Awaiting approval (engine processing) */}
                              {leaverM365Actions?.run_status === 'awaiting_approval' && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <div style={{ width: 16, height: 16, border: '2px solid #ccc', borderTopColor: '#0078D4', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                                  <span style={{ fontSize: 13 }}>Processing offboarding...</span>
                                  <span style={{ fontSize: 11, color: '#888', marginLeft: 4 }}>(auto-refreshing)</span>
                                  <button className="admin-btn-sm" style={{ marginLeft: 8 }} disabled={leaverM365RunPolling}
                                    onClick={e => { e.stopPropagation(); leaverM365RefreshStatus(leaverM365Actions!.run_id!, record.id) }}>
                                    Refresh
                                  </button>
                                </div>
                              )}

                              {/* Deprovisioning */}
                              {leaverM365Actions?.run_status === 'deprovisioning' && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <div style={{ width: 16, height: 16, border: '2px solid #ccc', borderTopColor: '#0078D4', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                                  <span style={{ fontSize: 13 }}>Deprovisioning in progress...</span>
                                  <button className="admin-btn-sm" style={{ marginLeft: 8 }} disabled={leaverM365RunPolling}
                                    onClick={e => { e.stopPropagation(); leaverM365RefreshStatus(leaverM365Actions!.run_id!, record.id) }}>
                                    Refresh
                                  </button>
                                </div>
                              )}

                              {/* Completed */}
                              {leaverM365Actions?.run_status === 'completed' && (
                                <div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: 13, color: '#2e7d32', fontWeight: 600 }}>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                                    M365 offboarding complete
                                  </div>
                                  {leaverM365Actions.run_result?.devices?.length > 0 && (
                                    <div style={{ marginBottom: 8 }}>
                                      <strong style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Devices to recover:</strong>
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                        {leaverM365Actions.run_result.devices.map((d: any, di: number) => (
                                          <div key={di} style={{ fontSize: 12, padding: '4px 8px', background: 'rgba(255,255,255,.6)', borderRadius: 4, border: '1px solid #e0e0e0' }}>
                                            <strong>{d.deviceName}</strong> — {d.operatingSystem}{d.serialNumber ? ` (S/N: ${d.serialNumber})` : ''}{d.ownership ? ` · ${d.ownership}` : ''}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {leaverM365Actions.run_result?.keptGroups?.length > 0 && (
                                    <div style={{ marginBottom: 8 }}>
                                      <strong style={{ fontSize: 12, display: 'block', marginBottom: 4, color: '#e65100' }}>Groups kept (may need manual follow-up):</strong>
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                        {leaverM365Actions.run_result.keptGroups.map((g: any, gi: number) => (
                                          <span key={gi} style={{ fontSize: 12 }}>{g.name} — {g.reason}</span>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {leaverM365Actions.run_result?.removedGroups?.length > 0 && (
                                    <p style={{ margin: '0 0 4px', fontSize: 11, color: 'var(--text-muted, #888)' }}>
                                      Removed from {leaverM365Actions.run_result.removedGroups.length} group{leaverM365Actions.run_result.removedGroups.length !== 1 ? 's' : ''}
                                    </p>
                                  )}
                                  {leaverM365Actions.run_result?.removedLicences?.length > 0 && (
                                    <p style={{ margin: '0 0 4px', fontSize: 11, color: 'var(--text-muted, #888)' }}>
                                      Removed {leaverM365Actions.run_result.removedLicences.length} licence{leaverM365Actions.run_result.removedLicences.length !== 1 ? 's' : ''}
                                    </p>
                                  )}
                                </div>
                              )}

                              {/* Failed */}
                              {leaverM365Actions?.run_status === 'failed' && (
                                <div>
                                  <div style={{ background: 'rgba(255,235,238,.7)', border: '1px solid #ef9a9a', borderRadius: 6, padding: 10, marginBottom: 8 }}>
                                    <p style={{ margin: 0, fontSize: 13, color: '#c62828', fontWeight: 600 }}>Offboarding failed</p>
                                    {leaverM365Actions.run_error && (
                                      <p style={{ margin: '4px 0 0', fontSize: 12, color: '#c62828' }}>
                                        {leaverM365Actions.run_error.code}: {leaverM365Actions.run_error.message}
                                      </p>
                                    )}
                                  </div>
                                  <div style={{ display: 'flex', gap: 8 }}>
                                    <button className="admin-btn-sm" disabled={leaverM365RunPolling}
                                      onClick={e => { e.stopPropagation(); leaverM365RecheckRun(leaverM365Actions!.run_id!, record.id) }}>
                                      Re-check
                                    </button>
                                    <button className="admin-btn-sm"
                                      onClick={e => { e.stopPropagation(); leaverM365MarkCompleteManual(record.id) }}>
                                      Mark Complete Manually
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Review Future Shifts panel */}
                          {step.key === 'review_shifts' && !done && !skipped && (
                            <div style={{ margin: '12px 0', padding: 14, background: '#f5f5f5', borderRadius: 10 }}>
                              {reviewShifts.length === 0 ? (
                                <p style={{ margin: 0, fontSize: 13, color: '#666' }}>No future shifts found. You can mark this step complete.</p>
                              ) : (
                                <>
                                  <div style={{ background: '#e3f2fd', padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, display: 'inline-block', marginBottom: 10 }}>
                                    {reviewShifts.length} future shift{reviewShifts.length !== 1 ? 's' : ''}
                                  </div>
                                  <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', marginBottom: 10 }}>
                                    <thead><tr style={{ borderBottom: '1px solid #ddd' }}><th style={{ textAlign: 'left', padding: 6 }}>Date</th><th style={{ textAlign: 'left', padding: 6 }}>Shift</th><th style={{ textAlign: 'left', padding: 6 }}>Rota</th></tr></thead>
                                    <tbody>{reviewShifts.map(s => (
                                      <tr key={s.id} style={{ borderBottom: '1px solid #eee' }}><td style={{ padding: 6 }}>{new Date(s.date).toLocaleDateString('en-GB')}</td><td style={{ padding: 6 }}>{s.shift_name}</td><td style={{ padding: 6 }}>{s.rota_name}</td></tr>
                                    ))}</tbody>
                                  </table>
                                  <button className="admin-btn-sm admin-btn-cancel" onClick={e => { e.stopPropagation(); cancelAllShifts(record) }}>
                                    Cancel All Future Shifts
                                  </button>
                                </>
                              )}
                            </div>
                          )}

                          {/* Review Future Bookings panel */}
                          {step.key === 'review_bookings' && !done && !skipped && (
                            <div style={{ margin: '12px 0', padding: 14, background: '#f5f5f5', borderRadius: 10 }}>
                              {reviewBookings.length === 0 ? (
                                <p style={{ margin: 0, fontSize: 13, color: '#666' }}>No future bookings found. You can mark this step complete.</p>
                              ) : (
                                <>
                                  <div style={{ background: '#e8f5e9', padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, display: 'inline-block', marginBottom: 10 }}>
                                    {reviewBookings.length} future booking{reviewBookings.length !== 1 ? 's' : ''}
                                  </div>
                                  <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', marginBottom: 10 }}>
                                    <thead><tr style={{ borderBottom: '1px solid #ddd' }}><th style={{ textAlign: 'left', padding: 6 }}>Date</th><th style={{ textAlign: 'left', padding: 6 }}>Space</th></tr></thead>
                                    <tbody>{reviewBookings.map(b => (
                                      <tr key={b.id} style={{ borderBottom: '1px solid #eee' }}><td style={{ padding: 6 }}>{new Date(b.booking_date).toLocaleDateString('en-GB')}</td><td style={{ padding: 6 }}>{b.space_name}</td></tr>
                                    ))}</tbody>
                                  </table>
                                  <button className="admin-btn-sm admin-btn-cancel" onClick={e => { e.stopPropagation(); cancelAllBookings(record) }}>
                                    Cancel All Future Bookings
                                  </button>
                                </>
                              )}
                            </div>
                          )}

                          {/* Review Benefits panel */}
                          {step.key === 'review_benefits' && !done && !skipped && (
                            <div style={{ margin: '12px 0', padding: 14, background: '#f5f5f5', borderRadius: 10 }}>
                              {reviewBenefits.length === 0 ? (
                                <p style={{ margin: 0, fontSize: 13, color: '#666' }}>No active benefit enrolments found. You can mark this step complete.</p>
                              ) : (
                                <>
                                  <div style={{ background: '#fce4ec', padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, display: 'inline-block', marginBottom: 10 }}>
                                    {reviewBenefits.length} active enrolment{reviewBenefits.length !== 1 ? 's' : ''}
                                  </div>
                                  <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', marginBottom: 10 }}>
                                    <thead><tr style={{ borderBottom: '1px solid #ddd' }}><th style={{ textAlign: 'left', padding: 6 }}>Benefit</th><th style={{ textAlign: 'left', padding: 6 }}>Enrolled</th></tr></thead>
                                    <tbody>{reviewBenefits.map(b => (
                                      <tr key={b.id} style={{ borderBottom: '1px solid #eee' }}><td style={{ padding: 6 }}>{b.benefit_name}</td><td style={{ padding: 6 }}>{new Date(b.enrolled_at).toLocaleDateString('en-GB')}</td></tr>
                                    ))}</tbody>
                                  </table>
                                  <button className="admin-btn-sm admin-btn-cancel" onClick={e => { e.stopPropagation(); unenrolAllBenefits(record) }}>
                                    Unenrol All Benefits
                                  </button>
                                </>
                              )}
                            </div>
                          )}

                          {/* Review Assets panel */}
                          {step.key === 'review_assets' && !done && !skipped && (
                            <div style={{ margin: '12px 0', padding: 14, background: '#f5f5f5', borderRadius: 10 }}>
                              {reviewAssets.length === 0 ? (
                                <p style={{ margin: 0, fontSize: 13, color: '#666' }}>No company assets assigned. You can mark this step complete.</p>
                              ) : (
                                <>
                                  <div style={{ background: '#fff3e0', padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, display: 'inline-block', marginBottom: 10 }}>
                                    {reviewAssets.length} assigned asset{reviewAssets.length !== 1 ? 's' : ''}
                                  </div>
                                  <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', marginBottom: 10 }}>
                                    <thead><tr style={{ borderBottom: '1px solid #ddd' }}><th style={{ textAlign: 'left', padding: 6 }}>Asset</th><th style={{ textAlign: 'left', padding: 6 }}>Type</th></tr></thead>
                                    <tbody>{reviewAssets.map(a => (
                                      <tr key={a.id} style={{ borderBottom: '1px solid #eee' }}><td style={{ padding: 6 }}>{a.asset_name}</td><td style={{ padding: 6 }}>{a.asset_type}</td></tr>
                                    ))}</tbody>
                                  </table>
                                  <button className="admin-btn-sm admin-btn-save" onClick={e => { e.stopPropagation(); confirmAssets(record) }}>
                                    Confirm All Assets Accounted For
                                  </button>
                                </>
                              )}
                            </div>
                          )}

                          {/* Export Data panel */}
                          {step.key === 'export_data' && !done && !skipped && (
                            <div style={{ margin: '12px 0', padding: 14, background: '#f5f5f5', borderRadius: 10 }}>
                              <p style={{ margin: '0 0 10px', fontSize: 13, color: '#666' }}>
                                Generate a GDPR-compliant data export pack containing all personal data held for this employee. The export includes leave records, payslips, expenses, timesheets, shift history, and more.
                              </p>
                              {record.data_exported_at && (
                                <p style={{ margin: '0 0 10px', fontSize: 12, color: '#4caf50', fontWeight: 600 }}>
                                  Last exported: {new Date(record.data_exported_at!).toLocaleDateString('en-GB')}
                                </p>
                              )}
                              <button className="admin-btn-sm admin-btn-save" onClick={e => { e.stopPropagation(); generateDataExport(record) }}>
                                Download Data Export (ZIP)
                              </button>
                            </div>
                          )}

                          {step.key === 'reassign_reports' && !done && !skipped && reassignData && (
                            <div style={{ margin: '12px 0', padding: 14, background: '#f5f5f5', borderRadius: 10 }}>
                              <div style={{ display: 'flex', gap: 16, marginBottom: 10 }}>
                                <div style={{ background: '#e3f2fd', padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600 }}>
                                  {reassignData.directReports.length} direct report{reassignData.directReports.length !== 1 ? 's' : ''}
                                </div>
                                <div style={{ background: '#fff3e0', padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600 }}>
                                  {reassignData.pendingActions} pending action{reassignData.pendingActions !== 1 ? 's' : ''}
                                </div>
                              </div>
                              {reassignData.directReports.length === 0 && reassignData.pendingActions === 0 ? (
                                <p style={{ margin: '8px 0 0', fontSize: 13, color: '#666' }}>No direct reports or pending actions to reassign. You can mark this step complete.</p>
                              ) : (
                                <>
                                  {reassignData.directReports.length > 0 && (
                                    <div style={{ marginBottom: 10, fontSize: 13 }}>
                                      <strong>Reports:</strong> {reassignData.directReports.map(r => `${r.first_name} ${r.last_name}`).join(', ')}
                                    </div>
                                  )}
                                  <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 4 }}>Reassign to</label>
                                  <select value={reassignTargetId} onChange={e => setReassignTargetId(e.target.value)} style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #ccc', fontSize: 14, marginBottom: 10 }}>
                                    <option value="">Select new manager...</option>
                                    {reassignCandidates.map(c => (
                                      <option key={c.id} value={c.id}>{c.first_name} {c.last_name} ({c.email})</option>
                                    ))}
                                  </select>
                                  <button className="admin-btn-sm admin-btn-save" disabled={!reassignTargetId || reassignSaving} onClick={e => { e.stopPropagation(); executeReassignment(record) }}>
                                    {reassignSaving ? 'Reassigning...' : 'Reassign & Complete'}
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                          <div className="admin-wf-actions">
                            {done ? (
                              <button className="admin-btn-sm admin-btn-cancel" onClick={e => { e.stopPropagation(); uncompleteOffboardStep(step.key) }}>Undo</button>
                            ) : skipped ? (
                              <>
                                <button className="admin-btn-sm admin-btn-save" onClick={e => { e.stopPropagation(); completeOffboardStep(step.key) }}>
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                                  Mark Complete
                                </button>
                                <button className="admin-btn-sm admin-btn-cancel" onClick={e => { e.stopPropagation(); uncompleteOffboardStep(step.key) }}>Undo Skip</button>
                              </>
                            ) : step.key === 'reassign_reports' && reassignData && (reassignData.directReports.length > 0 || reassignData.pendingActions > 0) ? (
                              <button className="admin-btn-sm admin-btn-skip" onClick={e => { e.stopPropagation(); skipOffboardStep(step.key) }}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5 4 15 12 5 20"/><line x1="19" y1="5" x2="19" y2="19"/></svg>
                                Skip
                              </button>
                            ) : (
                              <>
                                <button className="admin-btn-sm admin-btn-save" onClick={e => { e.stopPropagation(); completeOffboardStep(step.key) }}>
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                                  Mark Complete
                                </button>
                                <button className="admin-btn-sm admin-btn-skip" onClick={e => { e.stopPropagation(); skipOffboardStep(step.key) }}>
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5 4 15 12 5 20"/><line x1="19" y1="5" x2="19" y2="19"/></svg>
                                  Skip
                                </button>
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
        )
      })()}

      {/* Freeze Confirmation Modal */}
      {showFreezeModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 28, maxWidth: 480, width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#fff3e0', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#e65100" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
              </div>
              <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700 }}>Freeze Employee Account</h3>
              <p style={{ margin: '0 0 12px', color: '#666', fontSize: 14, lineHeight: 1.5 }}>
                This will prevent <strong>{showFreezeModal.employee_name}</strong> from logging into the HR app and place them in the 30-day deletion queue.
              </p>
            </div>
            <div style={{ background: '#f9f9f9', borderRadius: 10, padding: 14, marginBottom: 16, fontSize: 13 }}>
              <p style={{ margin: '0 0 8px', fontWeight: 700, fontSize: 14 }}>What will happen:</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ color: '#4caf50' }}>✓</span> Employee login disabled</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ color: '#4caf50' }}>✓</span> GDPR data export auto-generated</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ color: '#4caf50' }}>✓</span> Employee marked as frozen</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ color: '#4caf50' }}>✓</span> 30-day deletion countdown starts</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ color: '#f57c00' }}>!</span> All data permanently deleted after 30 days</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ color: '#2196f3' }}>i</span> Deletion certificate produced on expiry</div>
              </div>
              {(() => {
                const incompleteSteps = OFFBOARD_STEPS.filter(s => !offboardChecks[s.key] && !offboardSkips[s.key] && s.key !== 'confirm_payments')
                if (incompleteSteps.length > 0) return (
                  <div style={{ marginTop: 10, padding: 10, background: '#fff3e0', borderRadius: 8, border: '1px solid #ffe0b2' }}>
                    <p style={{ margin: 0, fontSize: 12, color: '#e65100', fontWeight: 600 }}>{incompleteSteps.length} workflow step{incompleteSteps.length !== 1 ? 's' : ''} not yet completed:</p>
                    <p style={{ margin: '4px 0 0', fontSize: 12, color: '#bf360c' }}>{incompleteSteps.map(s => s.label).join(', ')}</p>
                  </div>
                )
                return null
              })()}
              {(features.xero_integration || features.sage_integration) && showFreezeModal.status !== 'final_run_complete' && (
                <div style={{ marginTop: 10, padding: 10, background: '#fce4ec', borderRadius: 8, border: '1px solid #f8bbd0' }}>
                  <p style={{ margin: 0, fontSize: 12, color: '#c62828', fontWeight: 600 }}>Payroll warning: Final pay run has not been confirmed</p>
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: '#b71c1c' }}>Ensure the employee's final payslip is processed in {features.xero_integration ? 'Xero' : 'Sage'} before freezing. You can still proceed, but the final pay run must be handled separately.</p>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button className="admin-btn" style={{ background: '#e0e0e0', color: '#333', border: 'none', padding: '10px 24px', borderRadius: 8, fontWeight: 600, cursor: 'pointer' }} onClick={() => freezeEmployee(showFreezeModal, false)}>
                Decline
              </button>
              <button className="admin-btn" style={{ background: '#c62828', color: '#fff', border: 'none', padding: '10px 24px', borderRadius: 8, fontWeight: 600, cursor: 'pointer' }} onClick={() => freezeEmployee(showFreezeModal, true)}>
                Approve & Freeze
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === 'settings' && (
        <div style={{ background: 'var(--admin-card-bg, #fff)', borderRadius: 12, padding: 24, border: '1px solid var(--admin-border, #e0e0e0)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 0, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--admin-border, #e0e0e0)' }}>
              <button
                onClick={() => { setSettingsWorkflowType('onboarding'); initEditingSteps() }}
                style={{ padding: '8px 18px', fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer', background: settingsWorkflowType === 'onboarding' ? 'var(--admin-accent, #1976d2)' : 'transparent', color: settingsWorkflowType === 'onboarding' ? '#fff' : 'inherit' }}
              >Onboarding Steps</button>
              <button
                onClick={() => {
                  setSettingsWorkflowType('offboarding')
                  const defaults = OFFBOARD_STEPS.map((s, i) => ({ step_key: s.key, label: s.label, icon: s.icon, description: s.description, sort_order: i, is_default: true }))
                  setOffboardEditingSteps(hasOffboardCustomSteps ? offboardCustomSteps : defaults)
                  setSettingsDirty(false)
                }}
                style={{ padding: '8px 18px', fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer', background: settingsWorkflowType === 'offboarding' ? 'var(--admin-accent, #1976d2)' : 'transparent', color: settingsWorkflowType === 'offboarding' ? '#fff' : 'inherit' }}
              >Offboarding Steps</button>
            </div>
            <button
              className="admin-btn-sm admin-btn-save"
              disabled={!settingsDirty || settingsSaving}
              onClick={settingsWorkflowType === 'onboarding' ? saveCustomSteps : saveOffboardCustomSteps}
              style={{ minWidth: 100, opacity: settingsDirty ? 1 : 0.5 }}
            >
              {settingsSaving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
          <div style={{ marginBottom: 20 }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700 }}>{settingsWorkflowType === 'onboarding' ? 'Onboarding' : 'Offboarding'} Workflow Steps</h3>
            <p style={{ margin: 0, fontSize: 13, color: '#888' }}>
              {settingsWorkflowType === 'onboarding'
                ? 'Customise the onboarding workflow for your company. Drag steps to reorder, edit titles and descriptions, or add new steps.'
                : 'Customise the offboarding workflow. Add company-specific steps (e.g. redundancy consultation, exit survey, TUPE checklist) alongside the default steps.'}
            </p>
          </div>

          {(() => {
            const steps = settingsWorkflowType === 'onboarding' ? editingSteps : offboardEditingSteps
            const setSteps = settingsWorkflowType === 'onboarding'
              ? (u: CustomStep[]) => { setEditingSteps(u); setSettingsDirty(true) }
              : (u: CustomStep[]) => { setOffboardEditingSteps(u); setSettingsDirty(true) }
            return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, position: 'relative' }}>
            {steps.map((step, i) => (
              <div key={step.step_key + '-' + i}>
                {i === 0 && (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0' }}>
                    <button
                      onClick={() => {
                        const key = `custom_${Date.now()}`
                        const newStep: CustomStep = { step_key: key, label: 'New Step', icon: '📋', description: 'Describe this step...', sort_order: 0, is_default: false }
                        setSteps([newStep, ...steps])
                        setEditingIdx(0)
                      }}
                      style={{ background: 'none', border: '2px dashed #c7d2fe', borderRadius: 8, padding: '4px 16px', cursor: 'pointer', color: '#4f46e5', fontSize: 18, lineHeight: 1, fontWeight: 700 }}
                      title="Add step before"
                    >+</button>
                  </div>
                )}

                <div
                  draggable
                  onDragStart={() => setDragIdx(i)}
                  onDragOver={e => { e.preventDefault() }}
                  onDrop={() => {
                    if (dragIdx === null || dragIdx === i) return
                    const updated = [...steps]
                    const [moved] = updated.splice(dragIdx, 1)
                    updated.splice(i, 0, moved)
                    setSteps(updated)
                    setDragIdx(null)
                  }}
                  onDragEnd={() => setDragIdx(null)}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 14, padding: 16,
                    background: dragIdx === i ? '#eef2ff' : 'var(--admin-card-bg, #fff)',
                    border: '1px solid var(--admin-border, #e5e7eb)', borderRadius: 10,
                    cursor: 'grab', transition: 'background 0.15s',
                    borderLeft: `4px solid ${step.is_default ? '#4f46e5' : '#10b981'}`,
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, paddingTop: 2, color: '#bbb', fontSize: 16, userSelect: 'none' }}>
                    <span>⠿</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#aaa', width: 22, height: 22, borderRadius: '50%', background: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
                  </div>

                  <div style={{ fontSize: 24, lineHeight: 1, paddingTop: 2 }}>{step.icon}</div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    {editingIdx === i ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <input
                            className="admin-input"
                            value={step.icon}
                            onChange={e => {
                              const updated = [...steps]
                              updated[i] = { ...updated[i], icon: e.target.value }
                              setSteps(updated)
                            }}
                            style={{ width: 50, textAlign: 'center', fontSize: 18, padding: '4px 6px' }}
                            placeholder="📋"
                          />
                          <input
                            className="admin-input"
                            value={step.label}
                            onChange={e => {
                              const updated = [...steps]
                              updated[i] = { ...updated[i], label: e.target.value }
                              setSteps(updated)
                            }}
                            style={{ flex: 1, fontWeight: 700, fontSize: 14 }}
                            placeholder="Step title"
                          />
                        </div>
                        <textarea
                          className="admin-input"
                          value={step.description}
                          onChange={e => {
                            const updated = [...steps]
                            updated[i] = { ...updated[i], description: e.target.value }
                            setSteps(updated)
                          }}
                          rows={2}
                          style={{ resize: 'vertical', fontSize: 13 }}
                          placeholder="Step description"
                        />
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button className="admin-btn-sm admin-btn-save" onClick={() => setEditingIdx(null)}>Done</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div style={{ fontWeight: 700, fontSize: 14, color: '#1e1e2d' }}>{step.label}</div>
                        <div style={{ fontSize: 12, color: '#888', marginTop: 2, lineHeight: 1.4 }}>{step.description}</div>
                      </>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    {editingIdx !== i && (
                      <button
                        onClick={() => setEditingIdx(i)}
                        style={{ background: 'none', border: '1px solid #e0e0e0', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12, color: '#666' }}
                      >Edit</button>
                    )}
                    <button
                      onClick={() => {
                        if (steps.length <= 1) return
                        const updated = steps.filter((_, idx) => idx !== i)
                        setSteps(updated)
                        if (editingIdx === i) setEditingIdx(null)
                      }}
                      style={{ background: 'none', border: '1px solid #fecaca', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12, color: '#dc2626' }}
                      title="Remove step"
                    >✕</button>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0' }}>
                  <button
                    onClick={() => {
                      const key = `custom_${Date.now()}`
                      const newStep: CustomStep = { step_key: key, label: 'New Step', icon: '📋', description: 'Describe this step...', sort_order: i + 1, is_default: false }
                      const updated = [...steps]
                      updated.splice(i + 1, 0, newStep)
                      setSteps(updated)
                      setEditingIdx(i + 1)
                    }}
                    style={{ background: 'none', border: '2px dashed #c7d2fe', borderRadius: 8, padding: '4px 16px', cursor: 'pointer', color: '#4f46e5', fontSize: 18, lineHeight: 1, fontWeight: 700 }}
                    title="Add step after"
                  >+</button>
                </div>
              </div>
            ))}
          </div>
            )
          })()}

          {settingsWorkflowType === 'onboarding' && hasCustomSteps && (
            <div style={{ marginTop: 16, padding: 12, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, fontSize: 13, color: '#166534' }}>
              Custom workflow active — {customSteps.length} steps configured for this company.
            </div>
          )}
          {settingsWorkflowType === 'onboarding' && !hasCustomSteps && (
            <div style={{ marginTop: 16, padding: 12, background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 8, fontSize: 13, color: '#4338ca' }}>
              Using default workflow ({WORKFLOW_STEPS.length} steps). Click Save Changes to customise for this company.
            </div>
          )}
          {settingsWorkflowType === 'offboarding' && hasOffboardCustomSteps && (
            <div style={{ marginTop: 16, padding: 12, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, fontSize: 13, color: '#166534' }}>
              Custom offboarding workflow active — {offboardCustomSteps.length} steps configured for this company.
            </div>
          )}
          {settingsWorkflowType === 'offboarding' && !hasOffboardCustomSteps && (
            <div style={{ marginTop: 16, padding: 12, background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 8, fontSize: 13, color: '#4338ca' }}>
              Using default offboarding workflow ({OFFBOARD_STEPS.length} steps). Click Save Changes to customise for this company.
            </div>
          )}
        </div>
      )}

      {tab === 'setup' && (
        <CompanySetupWizard onSetupComplete={(companyId) => { refreshCompanies(companyId); load() }} />
      )}
    </div>
  )
}
