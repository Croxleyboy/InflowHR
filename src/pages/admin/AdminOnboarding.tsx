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
import { toLocalDateStr } from '../../lib/formatters'

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
}

const OFFBOARD_STEPS = [
  { key: 'approve_resignation', label: 'Approve Resignation', icon: '📝', description: 'Review and formally approve the employee resignation or termination. Update HR records with the leaving reason and confirm final working date.', role: 'HR' },
  { key: 'recover_equipment', label: 'Recover Equipment', icon: '💻', description: 'Collect all company equipment — laptop, monitor, phone, building pass, keys, parking permit. Complete the asset return checklist and update the inventory register.', role: 'HR' },
  { key: 'leaving_meeting', label: 'Organise Leaving Meeting', icon: '🤝', description: 'Schedule an exit interview and farewell meeting with the line manager. Cover handover tasks, knowledge transfer, and gather feedback on their experience.', role: 'Manager' },
  { key: 'remove_accounts', label: 'Remove Accounts & Licences', icon: '🔐', description: 'Disable Active Directory / Entra account, revoke Microsoft 365 licence, remove from security groups and distribution lists. Archive mailbox if required.', role: 'HR' },
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
  const { selectedCompanyId, selectedCompany, refreshCompanies } = useAdminCompany()
  const { fyStartMonth } = useLanguage()
  const { showError, showSuccess } = useToast()
  const { features } = useFeatures()
  const [records, setRecords] = useState<OnboardRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'dashboard' | 'new' | 'list' | 'workflow' | 'upload' | 'setup' | 'offboarding' | 'offboard-workflow'>('dashboard')
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
    const [{ data: offData }, { data: frozenData }] = await Promise.all([
      supabase.from('offboarding').select('*').eq('company_id', selectedCompanyId).order('created_at', { ascending: false }),
      supabase.from('frozen_employees').select('*').eq('company_id', selectedCompanyId).order('frozen_at', { ascending: false }),
    ])
    setOffboardRecords((offData as OffboardRecord[]) || [])
    setFrozenEmployees((frozenData as FrozenEmployee[]) || [])
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
    if (offboardStep < OFFBOARD_STEPS.length - 1) setOffboardStep(offboardStep + 1)
  }

  function skipOffboardStep(stepKey: string) {
    const record = offboardRecords.find(r => r.id === offboardSelectedId)
    if (!record) return
    const newSkips = { ...offboardSkips, [stepKey]: true }
    setOffboardSkips(newSkips)
    supabase.from('offboarding').update({
      skipped_steps: newSkips,
      status: 'in-progress',
    }).eq('id', record.id)
    loadOffboarding()
    if (offboardStep < OFFBOARD_STEPS.length - 1) setOffboardStep(offboardStep + 1)
  }

  function uncompleteOffboardStep(stepKey: string) {
    setOffboardChecks(prev => ({ ...prev, [stepKey]: false }))
    setOffboardSkips(prev => ({ ...prev, [stepKey]: false }))
  }

  async function loadReassignData(record: OffboardRecord) {
    const [reportsRes, pendingRes, candidatesRes] = await Promise.all([
      supabase.from('employees').select('id, first_name, last_name, email')
        .eq('company_id', record.company_id).eq('manager_id', record.employee_id).eq('is_active', true),
      supabase.from('workflow_tracker').select('id', { count: 'exact', head: true })
        .eq('assigned_to', record.employee_email).eq('status', 'Pending').eq('company_id', record.company_id),
      supabase.from('employees').select('id, first_name, last_name, email')
        .eq('company_id', record.company_id).eq('is_active', true).neq('id', record.employee_id).order('first_name'),
    ])
    setReassignData({
      directReports: (reportsRes.data || []) as { id: string; first_name: string; last_name: string; email: string }[],
      pendingActions: pendingRes.count || 0,
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

    setReassignSaving(false)
    showSuccess(`${reassignData.directReports.length} employee(s) and ${reassignData.pendingActions} pending action(s) reassigned to ${target.first_name} ${target.last_name}`)
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
    if (!confirm(`Permanently delete ${frozen.employee_name}? This cannot be undone.`)) return
    await supabase.from('frozen_employees').delete().eq('id', frozen.id)
    await supabase.from('company_users').delete().eq('employee_id', frozen.employee_id).eq('company_id', selectedCompanyId)
    await supabase.from('employees').delete().eq('id', frozen.employee_id)
    showSuccess(`${frozen.employee_name} has been permanently deleted`)
    loadOffboarding()
    load()
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
        <button className={`admin-tab ${tab === 'list' ? 'admin-tab-active' : ''}`} onClick={() => setTab('list')}>All Records</button>
        {selectedId && <button className={`admin-tab ${tab === 'workflow' ? 'admin-tab-active' : ''}`} onClick={() => setTab('workflow')}>Onboard Workflow</button>}
        <button className={`admin-tab ${tab === 'offboarding' ? 'admin-tab-active' : ''}`} onClick={() => setTab('offboarding')}>Offboarding</button>
        {offboardSelectedId && <button className={`admin-tab ${tab === 'offboard-workflow' ? 'admin-tab-active' : ''}`} onClick={() => setTab('offboard-workflow')}>Offboarding Workflow</button>}
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

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 20, marginTop: 24 }}>
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
                <select className="admin-select" value={newForm.employment_category} onChange={e => setNewForm(p => ({...p, employment_category: e.target.value}))}>
                  <option value="employed">Employed (Salaried)</option>
                  <option value="shift_worker">Shift Worker</option>
                </select>
                <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
                  {newForm.employment_category === 'employed'
                    ? 'Paid a fixed salary divided by pay period. Uses timesheets for time recording.'
                    : newForm.contract_type === 'Zero hours shift worker'
                      ? 'Zero hours — no guaranteed hours, paid per shift worked × hourly rate.'
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
              <div className="admin-form-field">
                <label>Leave Allowance (days)</label>
                <input type="number" className="admin-input" placeholder="15" value={newForm.leave_allowance} onChange={e => setNewForm(p => ({...p, leave_allowance: e.target.value}))} />
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
                <thead><tr><th>Name</th><th>Company</th><th>Role</th><th>Start Date</th><th>Status</th><th>Progress</th><th>Actions</th></tr></thead>
                <tbody>
                  {paginatedFiltered.map(r => {
                    const skipped = r.skipped_steps || {}
                    const completedSteps = [true, r.equipment_order === 'Y', r.first_day, r.first_day, r.first_day, r.first_week, r.elearning, r.is_complete].filter(Boolean).length
                    const skippedCount = Object.values(skipped).filter(Boolean).length
                    const totalDone = completedSteps + skippedCount
                    return (
                      <tr key={r.id}>
                        <td><strong>{r.firstname} {r.surname}</strong></td>
                        <td style={{ fontSize: 12, color: '#666' }}>{r.company?.name || '—'}</td>
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
                  <thead><tr><th>Employee</th><th>Frozen Date</th><th>Deletion Date</th><th>Status</th><th>Actions</th></tr></thead>
                  <tbody>
                    {paginatedFrozen.map(f => {
                      const now = new Date()
                      const delDate = new Date(f.deletion_date)
                      const daysLeft = Math.ceil((delDate.getTime() - now.getTime()) / 86400000)
                      const statusLabel = f.status === 'recovered' ? 'Recovered' : daysLeft <= 0 ? 'Ready to Delete' : 'Awaiting Expiry'
                      const statusColor = f.status === 'recovered' ? '#43a047' : daysLeft <= 0 ? '#c62828' : '#ff9800'
                      return (
                        <tr key={f.id}>
                          <td><strong>{f.employee_name}</strong><br /><span style={{ fontSize: 12, color: '#888' }}>{f.employee_email}</span></td>
                          <td>{new Date(f.frozen_at).toLocaleDateString('en-GB')}</td>
                          <td>{new Date(f.deletion_date).toLocaleDateString('en-GB')}{daysLeft > 0 && f.status !== 'recovered' && <span style={{ fontSize: 12, color: '#888', marginLeft: 4 }}>({daysLeft}d)</span>}</td>
                          <td><span className="admin-badge" style={{ background: statusColor, color: '#fff' }}>{statusLabel}</span></td>
                          <td className="admin-actions">
                            {f.status !== 'recovered' && (
                              <>
                                <button className="admin-btn-sm" style={{ background: '#43a047', color: '#fff', border: 'none' }} onClick={() => recoverEmployee(f)}>Recover</button>
                                <button className="admin-btn-sm" style={{ background: '#c62828', color: '#fff', border: 'none' }} onClick={() => deleteEmployee(f)}>Delete</button>
                              </>
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
          </div>

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
                  <div key={step.key} className={`admin-wf-step ${done ? 'admin-wf-done' : ''} ${skipped ? 'admin-wf-skipped' : ''} ${isCurrent ? 'admin-wf-current' : ''}`} onClick={() => { setOffboardStep(i); if (step.key === 'reassign_reports' && !done && !skipped && record) loadReassignData(record) }}>
                    <div className="admin-wf-connector" />
                    <div className="admin-wf-dot">{done ? '✓' : skipped ? '⏭' : step.icon}</div>
                    <div className="admin-wf-content">
                      <h4>{step.label}{skipped && <span className="admin-wf-skip-badge">Skipped</span>}<span style={{ fontSize: 11, color: '#888', fontWeight: 400, marginLeft: 8 }}>{step.role}</span></h4>
                      {isCurrent && (
                        <div className="admin-wf-detail">
                          <p>{step.description}</p>
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
          <div style={{ background: '#fff', borderRadius: 16, padding: 28, maxWidth: 440, width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#fff3e0', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#e65100" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
              </div>
              <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700 }}>Freeze Employee Account</h3>
              <p style={{ margin: 0, color: '#666', fontSize: 14, lineHeight: 1.5 }}>
                This will prevent <strong>{showFreezeModal.employee_name}</strong> from logging into the HR app and place them in the 30-day deletion queue.
              </p>
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

      {tab === 'setup' && (
        <CompanySetupWizard onSetupComplete={(companyId) => { refreshCompanies(companyId); load() }} />
      )}
    </div>
  )
}
