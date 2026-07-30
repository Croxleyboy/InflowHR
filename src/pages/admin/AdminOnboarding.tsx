import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { useLanguage } from '../../context/LanguageContext'
import * as XLSX from 'xlsx'

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
}

interface CompanyRow {
  id: string
  name: string
  domain: string
  is_active: boolean
}

interface SetupRow {
  firstname: string
  surname: string
  user_email: string
  job_title: string
  department: string
  manager: string
  manager_email: string
  location: string
  telephone: string
  employee_number: string
  start_date: string
  contract_type: string
  annual_salary: number
  tax_code: string
  payroll_id: string
  role: string
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

const SETUP_COLUMN_MAP: Record<string, keyof SetupRow> = {
  'first name': 'firstname', 'surname': 'surname', 'work email': 'user_email',
  'job title': 'job_title', 'department': 'department',
  'manager name': 'manager', 'manager email': 'manager_email', 'location': 'location',
  'phone': 'telephone', 'employee number': 'employee_number', 'start date': 'start_date',
  'contract type': 'contract_type', 'annual salary': 'annual_salary',
  'tax code': 'tax_code', 'payroll id': 'payroll_id', 'role': 'role',
}

const SETUP_STEPS = [
  { label: 'Select Company', icon: '🏢' },
  { label: 'Upload Data', icon: '📤' },
  { label: 'Review & Assign Admin', icon: '👀' },
  { label: 'Process', icon: '✅' },
]

export default function AdminOnboarding() {
  const { isSuperAdmin } = useAuth()
  const { selectedCompanyId } = useAdminCompany()
  const { fyStartMonth } = useLanguage()
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
  })

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadRows, setUploadRows] = useState<Record<string, string>[]>([])
  const [uploadErrors, setUploadErrors] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState<{ success: number; failed: number } | null>(null)

  // Company Setup state
  const [companies, setCompanies] = useState<CompanyRow[]>([])
  const [setupStep, setSetupStep] = useState(0)
  const [setupCompanyId, setSetupCompanyId] = useState('')
  const [setupRows, setSetupRows] = useState<SetupRow[]>([])
  const [setupErrors, setSetupErrors] = useState<string[]>([])
  const [adminEmail, setAdminEmail] = useState('')
  const [processing, setProcessing] = useState(false)
  const [processResult, setProcessResult] = useState<{ onboarding: number; employees: number; payslips: number; admin: string } | null>(null)
  const setupFileRef = useRef<HTMLInputElement>(null)

  const COLUMN_MAP: Record<string, string> = {
    'first name': 'firstname', 'surname': 'surname', 'work email': 'user_email',
    'personal email': 'personal_email', 'job title': 'job_title', 'department': 'department',
    'manager name': 'manager', 'manager email': 'manager_email', 'location': 'location',
    'phone': 'telephone', 'employee number': 'employee_number', 'start date': 'start_date',
    'contract type': 'contract_type',
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
            if (key === 'start_date' && typeof val === 'number') {
              const d = XLSX.SSF.parse_date_code(val)
              strVal = `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
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

    for (const row of uploadRows) {
      const { error } = await supabase.from('onboarding').insert({
        ...row, status: 'new', is_complete: false, company_id: selectedCompanyId,
      })
      if (error) failed++
      else success++
    }

    setUploadResult({ success, failed })
    setUploading(false)
    if (success > 0) load()
  }

  function clearUpload() {
    setUploadRows([])
    setUploadErrors([])
    setUploadResult(null)
  }

  useEffect(() => { if (selectedCompanyId) load() }, [selectedCompanyId])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('onboarding').select('*').eq('company_id', selectedCompanyId).order('created_at', { ascending: false })
    setRecords((data as OnboardRecord[]) || [])
    setLoading(false)
  }

  async function loadCompanies() {
    const { data } = await supabase.from('companies').select('id, name, domain, is_active').order('name')
    setCompanies((data as CompanyRow[]) || [])
  }

  async function createStarter() {
    if (!newForm.firstname || !newForm.surname || !newForm.user_email || !selectedCompanyId) return
    const { data } = await supabase.from('onboarding').insert({
      ...newForm, status: 'new', is_complete: false, company_id: selectedCompanyId,
    }).select().single()
    if (data) {
      setSelectedId(data.id)
      setWorkflowStep(0)
      setStepChecks({})
      setTab('workflow')
      load()
    }
  }

  async function updateOnboardStatus(id: number, updates: Record<string, any>) {
    await supabase.from('onboarding').update(updates).eq('id', id)
    load()
  }

  async function deleteRecord(id: number) {
    if (!confirm('Delete this onboarding record?')) return
    await supabase.from('onboarding').delete().eq('id', id)
    setRecords(prev => prev.filter(r => r.id !== id))
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
    const skipped = (record as any).skipped_steps
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
      await supabase.from('employees').update({ is_active: true }).eq('email', record.user_email).eq('company_id', selectedCompanyId)
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
    const empNum = record.employee_number || `EMP-${Date.now().toString().slice(-6)}`
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
    })
    if (error) {
      alert(`Failed to create employee record: ${error.message}`)
      return false
    }
    return true
  }

  // --- Company Setup functions ---

  function handleSetupFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setSetupErrors([])

    const reader = new FileReader()
    reader.onload = (evt) => {
      const data = new Uint8Array(evt.target!.result as ArrayBuffer)
      const workbook = XLSX.read(data, { type: 'array' })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const raw: Record<string, any>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' })

      if (raw.length === 0) {
        setSetupErrors(['The spreadsheet is empty or has no data rows.'])
        return
      }

      const errors: string[] = []
      const mapped: SetupRow[] = raw.map((row, i) => {
        const out: Record<string, any> = { contract_type: 'Full-time', annual_salary: 0, tax_code: '1257L', payroll_id: '', role: 'employee' }
        for (const [excelCol, val] of Object.entries(row)) {
          const key = SETUP_COLUMN_MAP[excelCol.toLowerCase().trim()]
          if (key) {
            if (key === 'annual_salary') {
              out[key] = Number(val) || 0
            } else if (key === 'start_date' && typeof val === 'number') {
              const d = XLSX.SSF.parse_date_code(val)
              out[key] = `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
            } else {
              out[key] = String(val).trim()
            }
          }
        }
        if (!out.firstname) errors.push(`Row ${i + 2}: Missing First Name`)
        if (!out.surname) errors.push(`Row ${i + 2}: Missing Surname`)
        if (!out.user_email) errors.push(`Row ${i + 2}: Missing Work Email`)
        else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.user_email))
          errors.push(`Row ${i + 2}: Invalid email "${out.user_email}"`)
        if (out.annual_salary <= 0) errors.push(`Row ${i + 2}: Missing or invalid Annual Salary`)
        if (out.role && !['admin', 'employee', 'hr'].includes(out.role))
          errors.push(`Row ${i + 2}: Role must be admin, employee or hr`)
        return out as SetupRow
      })

      setSetupErrors(errors)
      setSetupRows(mapped)
      const firstAdmin = mapped.find(r => r.role === 'admin')
      if (firstAdmin) setAdminEmail(firstAdmin.user_email)
    }
    reader.readAsArrayBuffer(file)
    e.target.value = ''
  }

  function generateTemplate() {
    const headers = ['First Name', 'Surname', 'Work Email', 'Job Title', 'Department', 'Manager Name', 'Manager Email', 'Location', 'Phone', 'Employee Number', 'Start Date', 'Contract Type', 'Annual Salary', 'Tax Code', 'Payroll ID', 'Role']
    const ws = XLSX.utils.aoa_to_sheet([headers])
    ws['!cols'] = headers.map(() => ({ wch: 20 }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Employees')
    XLSX.writeFile(wb, 'company-setup-template.xlsx')
  }

  async function ensureCompanyFoundation(companyId: string) {
    const { data: existingTypes } = await supabase
      .from('leave_types')
      .select('id')
      .eq('company_id', companyId)
      .limit(1)

    if (!existingTypes || existingTypes.length === 0) {
      const defaultLeaveTypes = [
        { name: 'Annual Leave', company_id: companyId },
        { name: 'Sick Leave', company_id: companyId },
        { name: 'Compassionate Leave', company_id: companyId },
        { name: 'Parental Leave', company_id: companyId },
        { name: 'Unpaid Leave', company_id: companyId },
      ]
      await supabase.from('leave_types').insert(defaultLeaveTypes)
    }

    const { data: existingFeatures } = await supabase
      .from('company_features')
      .select('id')
      .eq('company_id', companyId)
      .limit(1)

    if (!existingFeatures || existingFeatures.length === 0) {
      const standardFeatures = [
        { company_id: companyId, feature_key: 'expenses', is_enabled: true },
        { company_id: companyId, feature_key: 'leave', is_enabled: true },
        { company_id: companyId, feature_key: 'kudos', is_enabled: true },
        { company_id: companyId, feature_key: 'payroll', is_enabled: true },
        { company_id: companyId, feature_key: 'timesheets', is_enabled: false },
        { company_id: companyId, feature_key: 'performance', is_enabled: false },
        { company_id: companyId, feature_key: 'shifts', is_enabled: false },
        { company_id: companyId, feature_key: 'elearning', is_enabled: false },
        { company_id: companyId, feature_key: 'benefits', is_enabled: false },
        { company_id: companyId, feature_key: 'legal_timesheets', is_enabled: false },
      ]
      await supabase.from('company_features').insert(standardFeatures)
    }
  }

  async function processSetup() {
    if (!setupCompanyId) return
    setProcessing(true)

    const company = companies.find(c => c.id === setupCompanyId)
    let onboardCount = 0, empCount = 0, payslipCount = 0
    let assignedAdmin = ''

    await ensureCompanyFoundation(setupCompanyId)

    const now = new Date()
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    const paymentDate = new Date(periodEnd)
    paymentDate.setDate(paymentDate.getDate() - 3)

    for (const row of setupRows) {
      // 1. Create onboarding record
      const { error: onbErr } = await supabase.from('onboarding').insert({
        firstname: row.firstname,
        surname: row.surname,
        user_email: row.user_email,
        job_title: row.job_title,
        department: row.department,
        manager: row.manager,
        manager_email: row.manager_email,
        location: row.location,
        telephone: row.telephone,
        employee_number: row.employee_number,
        start_date: row.start_date,
        contract_type: row.contract_type,
        status: 'Onboarded',
        is_complete: true,
        company_id: setupCompanyId,
      })
      if (!onbErr) onboardCount++

      // 2. Create employee record
      const { data: existing } = await supabase.from('employees').select('id').eq('email', row.user_email).eq('company_id', setupCompanyId).maybeSingle()
      let employeeId = existing?.id

      if (!existing) {
        const { error: empErr } = await supabase.from('employees').insert({
          employee_number: row.employee_number || `EMP-${Date.now().toString().slice(-6)}`,
          first_name: row.firstname,
          last_name: row.surname,
          email: row.user_email,
          job_title: row.job_title || '',
          department: row.department || '',
          start_date: row.start_date || now.toISOString().split('T')[0],
          phone: row.telephone || '',
          is_admin: row.role === 'admin',
          is_active: true,
          company_id: setupCompanyId,
        })
        if (!empErr) {
          empCount++
          const { data: newEmp } = await supabase.from('employees').select('id').eq('email', row.user_email).maybeSingle()
          if (newEmp) employeeId = newEmp.id
        }
      }

      // 3. Create initial payslip with salary data
      if (employeeId && row.annual_salary > 0) {
        const monthlySalary = row.annual_salary / 12
        const tax = monthlySalary * 0.2
        const ni = monthlySalary * 0.12
        const pension = monthlySalary * 0.05
        const netPay = monthlySalary - tax - ni - pension

        const { error: payErr } = await supabase.from('payslips').insert({
          employee_id: employeeId,
          reference_number: `PAY-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${row.employee_number || employeeId.slice(0, 4)}`,
          pay_period_start: periodStart.toISOString().split('T')[0],
          pay_period_end: periodEnd.toISOString().split('T')[0],
          gross_pay: Math.round(monthlySalary * 100) / 100,
          tax: Math.round(tax * 100) / 100,
          national_insurance: Math.round(ni * 100) / 100,
          pension: Math.round(pension * 100) / 100,
          other_deductions: 0,
          net_pay: Math.round(netPay * 100) / 100,
          payment_date: paymentDate.toISOString().split('T')[0],
          status: 'draft',
          tax_code: row.tax_code || '1257L',
          annual_salary: row.annual_salary,
          payroll_id: row.payroll_id || '',
          overtime: 0,
          adjustments: 0,
          company_id: setupCompanyId,
        })
        if (!payErr) payslipCount++
      }

      // 4. Create company_users record for admin role
      if (row.user_email === adminEmail && company) {
        await supabase.from('company_users').insert({
          company_id: setupCompanyId,
          role: 'admin',
          is_active: true,
          employee_id: employeeId,
        })
        assignedAdmin = `${row.firstname} ${row.surname} (${row.user_email})`
      }

      // 5. Create leave balances for each leave type
      if (employeeId) {
        const { data: leaveTypes } = await supabase.from('leave_types').select('id').eq('company_id', setupCompanyId)
        if (leaveTypes && leaveTypes.length > 0) {
          for (const lt of leaveTypes) {
            await supabase.from('leave_balances').insert({
              employee_id: employeeId,
              leave_type_id: lt.id,
              year: now.getFullYear(),
              total_allowance: 25,
              used: 0,
              carried_over: 0,
              company_id: setupCompanyId,
            })
          }
        }
      }
    }

    setProcessResult({ onboarding: onboardCount, employees: empCount, payslips: payslipCount, admin: assignedAdmin })
    setProcessing(false)
    load()
  }

  function resetSetup() {
    setSetupStep(0)
    setSetupCompanyId('')
    setSetupRows([])
    setSetupErrors([])
    setAdminEmail('')
    setProcessResult(null)
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
      const skipped = (r as any).skipped_steps
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
  const setupCompany = companies.find(c => c.id === setupCompanyId)

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
          <button className={`admin-tab ${tab === 'setup' ? 'admin-tab-active' : ''}`} onClick={() => { setTab('setup'); loadCompanies() }} style={{ borderColor: '#7b1fa2', color: tab === 'setup' ? '#fff' : '#7b1fa2', background: tab === 'setup' ? '#7b1fa2' : undefined }}>
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
          <div className="admin-form-grid">
            {[
              { key: 'firstname', label: 'First Name' }, { key: 'surname', label: 'Surname' },
              { key: 'user_email', label: 'Work Email' }, { key: 'personal_email', label: 'Personal Email' },
              { key: 'job_title', label: 'Job Title' }, { key: 'department', label: 'Department' },
              { key: 'manager', label: 'Manager Name' }, { key: 'manager_email', label: 'Manager Email' },
              { key: 'location', label: 'Location' }, { key: 'telephone', label: 'Phone' },
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
                <option>Full-time</option><option>Part-time</option><option>Contract</option><option>Guest</option>
              </select>
            </div>
          </div>
          <button className="admin-btn admin-btn-primary" onClick={createStarter}>Create & Start Workflow</button>
        </div>
      )}

      {tab === 'upload' && (
        <div className="admin-add-form">
          <h3>Bulk Upload New Starters</h3>
          <p style={{ color: '#666', marginBottom: 16 }}>Upload an Excel file (.xlsx) to create multiple new starter records at once.</p>

          <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
            <a href="/new-starter-template.xlsx" download className="admin-btn admin-btn-primary" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Download Template
            </a>
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
                    const skipped = (r as any).skipped_steps || {}
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
        <div className="admin-add-form">
          {/* Stepper */}
          <div style={{ display: 'flex', gap: 0, marginBottom: 32, justifyContent: 'center' }}>
            {SETUP_STEPS.map((s, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center' }}>
                <div style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 100,
                }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: i < setupStep ? '#43a047' : i === setupStep ? '#7b1fa2' : '#e0e0e0',
                    color: i <= setupStep ? '#fff' : '#999', fontSize: 18, fontWeight: 700,
                    transition: 'all 0.3s',
                  }}>
                    {i < setupStep ? '✓' : s.icon}
                  </div>
                  <span style={{ fontSize: 12, color: i === setupStep ? '#7b1fa2' : '#666', fontWeight: i === setupStep ? 700 : 400 }}>{s.label}</span>
                </div>
                {i < SETUP_STEPS.length - 1 && (
                  <div style={{ width: 40, height: 2, background: i < setupStep ? '#43a047' : '#e0e0e0', margin: '0 4px', marginBottom: 20 }} />
                )}
              </div>
            ))}
          </div>

          {/* Step 1: Select Company */}
          {setupStep === 0 && (
            <div>
              <h3>Select Company</h3>
              <p style={{ color: '#666', marginBottom: 16 }}>Choose the company you want to set up with employee and salary data.</p>

              {companies.length === 0 ? (
                <div style={{ background: '#fff3e0', border: '1px solid #ff9800', borderRadius: 8, padding: 16, textAlign: 'center' }}>
                  <p style={{ color: '#e65100', margin: 0 }}>No companies found. Add a company in the Companies page first.</p>
                </div>
              ) : (
                <>
                  <div className="admin-form-field" style={{ maxWidth: 400 }}>
                    <label>Company</label>
                    <select className="admin-select" value={setupCompanyId} onChange={e => setSetupCompanyId(e.target.value)}>
                      <option value="">-- Select a company --</option>
                      {companies.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.domain}) {c.is_active ? '' : '— Inactive'}
                        </option>
                      ))}
                    </select>
                  </div>
                  {setupCompanyId && setupCompany && (
                    <div style={{ background: '#f3e5f5', border: '1px solid #ce93d8', borderRadius: 8, padding: 16, marginTop: 16 }}>
                      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                        <div><strong>Company:</strong> {setupCompany.name}</div>
                        <div><strong>Domain:</strong> {setupCompany.domain}</div>
                        <div><strong>Status:</strong> <span style={{ color: setupCompany.is_active ? '#43a047' : '#ff9800' }}>{setupCompany.is_active ? 'Active' : 'Inactive'}</span></div>
                      </div>
                      {setupCompany.is_active && (
                        <p style={{ color: '#e65100', fontSize: 13, marginTop: 8, marginBottom: 0 }}>
                          This company is currently active. Users with this domain can already log in. Consider disabling it until setup is complete.
                        </p>
                      )}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
                    <button className="admin-btn admin-btn-primary" disabled={!setupCompanyId} onClick={() => setSetupStep(1)}>
                      Next: Upload Data
                    </button>
                    <button className="admin-btn" disabled={!setupCompanyId} style={{ background: '#ff9800', color: '#fff' }} onClick={() => { setSetupRows([]); setSetupStep(3) }}>
                      Skip to Foundation Only
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Step 2: Upload Data */}
          {setupStep === 1 && (
            <div>
              <h3>Upload Employee & Salary Data</h3>
              <p style={{ color: '#666', marginBottom: 8 }}>
                Upload an Excel file with employee details and salary information for <strong>{setupCompany?.name}</strong>.
              </p>
              <p style={{ color: '#999', fontSize: 13, marginBottom: 16 }}>
                Required columns: First Name, Surname, Work Email, Annual Salary. Optional: Job Title, Department, Manager Name/Email, Location, Phone, Employee Number, Start Date, Contract Type, Tax Code, Payroll ID, Role (admin/employee/hr).
              </p>

              <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
                <button className="admin-btn admin-btn-primary" onClick={generateTemplate} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Download Blank Template
                </button>
                <a href="/move2modern-setup.xlsx" download className="admin-btn" style={{ background: '#e8eaf6', color: '#1a237e', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Download Sample (Move2Modern)
                </a>
                <button className="admin-btn" style={{ background: '#43a047', color: '#fff' }} onClick={() => setupFileRef.current?.click()}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6 }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  Upload Excel File
                </button>
                <input ref={setupFileRef} type="file" accept=".xlsx,.xls" onChange={handleSetupFileSelect} style={{ display: 'none' }} />
              </div>

              {setupErrors.length > 0 && (
                <div style={{ background: '#fff3e0', border: '1px solid #ff9800', borderRadius: 8, padding: 12, marginBottom: 16 }}>
                  <strong style={{ color: '#e65100' }}>Validation Errors ({setupErrors.length})</strong>
                  <ul style={{ margin: '8px 0 0', paddingLeft: 20, color: '#bf360c', fontSize: 13 }}>
                    {setupErrors.map((err, i) => <li key={i}>{err}</li>)}
                  </ul>
                </div>
              )}

              {setupRows.length > 0 && (
                <div style={{ background: '#e8f5e9', border: '1px solid #43a047', borderRadius: 8, padding: 12, marginBottom: 16 }}>
                  <strong style={{ color: '#2e7d32' }}>{setupRows.length} employee{setupRows.length !== 1 ? 's' : ''} loaded successfully</strong>
                </div>
              )}

              {setupRows.length === 0 && (
                <div style={{ border: '2px dashed #ccc', borderRadius: 12, padding: '40px 20px', textAlign: 'center', color: '#999', cursor: 'pointer' }} onClick={() => setupFileRef.current?.click()}>
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="1.5" style={{ marginBottom: 8 }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  <p style={{ margin: 0, fontSize: 15 }}>Click to select an Excel file</p>
                  <p style={{ margin: '4px 0 0', fontSize: 13 }}>Accepts .xlsx files with employee and salary data</p>
                </div>
              )}

              <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
                <button className="admin-btn" style={{ background: '#e0e0e0', color: '#333' }} onClick={() => { setSetupStep(0); setSetupRows([]); setSetupErrors([]) }}>Back</button>
                <button className="admin-btn" style={{ background: '#ff9800', color: '#fff' }} onClick={() => { setSetupRows([]); setSetupStep(3) }}>
                  Skip — Foundation Only
                </button>
                <button className="admin-btn admin-btn-primary" disabled={setupRows.length === 0 || setupErrors.length > 0} onClick={() => setSetupStep(2)}>
                  Next: Review Data
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Review & Assign Admin */}
          {setupStep === 2 && (
            <div>
              <h3>Review Data & Assign Admin</h3>
              <p style={{ color: '#666', marginBottom: 16 }}>
                Review the data below for <strong>{setupCompany?.name}</strong>. Select which employee will be the company admin.
              </p>

              <div className="admin-form-field" style={{ maxWidth: 400, marginBottom: 20 }}>
                <label style={{ fontWeight: 700 }}>Company Admin</label>
                <select className="admin-select" value={adminEmail} onChange={e => setAdminEmail(e.target.value)}>
                  <option value="">-- Select admin --</option>
                  {setupRows.map((r, i) => (
                    <option key={i} value={r.user_email}>{r.firstname} {r.surname} ({r.user_email})</option>
                  ))}
                </select>
                <p style={{ fontSize: 12, color: '#666', marginTop: 4 }}>This person will have admin access to their company's data in the admin portal.</p>
              </div>

              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>#</th><th>Name</th><th>Email</th><th>Job Title</th>
                      <th>Department</th><th>Salary</th><th>Tax Code</th><th>Role</th>
                    </tr>
                  </thead>
                  <tbody>
                    {setupRows.map((row, i) => (
                      <tr key={i} style={row.user_email === adminEmail ? { background: '#f3e5f5' } : undefined}>
                        <td>{i + 1}</td>
                        <td><strong>{row.firstname} {row.surname}</strong></td>
                        <td>{row.user_email}</td>
                        <td>{row.job_title || '—'}</td>
                        <td>{row.department || '—'}</td>
                        <td style={{ fontFamily: 'monospace' }}>&pound;{Number(row.annual_salary).toLocaleString()}</td>
                        <td>{row.tax_code || '1257L'}</td>
                        <td>
                          <span className={`admin-badge ${row.user_email === adminEmail ? 'admin-badge-approved' : 'admin-badge-pending'}`}>
                            {row.user_email === adminEmail ? 'Admin' : (row.role || 'employee')}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ background: '#e8eaf6', borderRadius: 8, padding: 16, marginTop: 20 }}>
                <h4 style={{ margin: '0 0 8px', color: '#1a237e' }}>What will be created:</h4>
                <ul style={{ margin: 0, paddingLeft: 20, color: '#333', fontSize: 14 }}>
                  <li><strong>{setupRows.length}</strong> onboarding records (status: Onboarded)</li>
                  <li><strong>{setupRows.length}</strong> employee records (active, visible in Directory)</li>
                  <li><strong>{setupRows.filter(r => r.annual_salary > 0).length}</strong> initial payslips (draft, current month)</li>
                  <li><strong>{setupRows.length}</strong> annual leave balances (25 days)</li>
                  {adminEmail && <li><strong>1</strong> company admin: {adminEmail}</li>}
                </ul>
              </div>

              <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
                <button className="admin-btn" style={{ background: '#e0e0e0', color: '#333' }} onClick={() => setSetupStep(1)}>Back</button>
                <button className="admin-btn" style={{ background: '#ff9800', color: '#fff' }} onClick={() => { setAdminEmail(''); setSetupStep(3) }}>
                  Skip Admin — Process Employees Only
                </button>
                <button className="admin-btn admin-btn-primary" disabled={!adminEmail} onClick={() => setSetupStep(3)} style={{ background: '#43a047' }}>
                  Process {setupRows.length} Employees
                </button>
              </div>
            </div>
          )}

          {/* Step 4: Process */}
          {setupStep === 3 && (
            <div>
              {!processResult && !processing && (
                <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                  <div style={{ fontSize: 48, marginBottom: 16 }}>{setupRows.length > 0 ? '🚀' : '🏗️'}</div>
                  <h3>{setupRows.length > 0 ? 'Ready to Process' : 'Create Company Foundation'}</h3>
                  <p style={{ color: '#666', maxWidth: 500, margin: '0 auto 24px' }}>
                    {setupRows.length > 0
                      ? <>This will create all employee records, onboarding entries, payslips, and leave balances for <strong>{setupCompany?.name}</strong>. This action cannot be undone.</>
                      : <>This will create the foundation records for <strong>{setupCompany?.name}</strong> — leave types (Annual, Sick, Compassionate, Parental, Unpaid) and company feature toggles. Employees can then be added later via onboarding and will be able to use expenses, leave, notifications etc. without RLS errors.</>
                    }
                  </p>

                  {setupRows.length === 0 && (
                    <div style={{ background: '#e8f5e9', border: '1px solid #43a047', borderRadius: 8, padding: 16, maxWidth: 500, margin: '0 auto 24px', textAlign: 'left' }}>
                      <h4 style={{ margin: '0 0 8px', color: '#2e7d32' }}>What will be created / Was erstellt wird:</h4>
                      <ul style={{ margin: 0, paddingLeft: 20, color: '#333', fontSize: 14 }}>
                        <li><strong>5</strong> leave types / Urlaubsarten (Annual, Sick, Compassionate, Parental, Unpaid)</li>
                        <li><strong>10</strong> company feature toggles / Funktionsschalter (standard features enabled)</li>
                      </ul>
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                    <button className="admin-btn" style={{ background: '#e0e0e0', color: '#333' }} onClick={() => setSetupStep(setupRows.length > 0 ? 2 : 1)}>Back</button>
                    <button className="admin-btn admin-btn-primary" onClick={processSetup} style={{ background: '#43a047', padding: '12px 32px', fontSize: 16 }}>
                      {setupRows.length > 0 ? 'Confirm & Process' : 'Create Foundation Records'}
                    </button>
                  </div>
                </div>
              )}

              {processing && (
                <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                  <div style={{ fontSize: 48, marginBottom: 16, animation: 'spin 1s linear infinite' }}>⚙️</div>
                  <h3>Processing...</h3>
                  <p style={{ color: '#666' }}>Creating employee records, payslips and leave balances. Please wait.</p>
                </div>
              )}

              {processResult && (
                <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                  <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
                  <h3 style={{ color: '#2e7d32' }}>Company Setup Complete / Unternehmens-Setup abgeschlossen</h3>

                  <div style={{ background: '#e8f5e9', border: '1px solid #43a047', borderRadius: 12, padding: 24, maxWidth: 500, margin: '24px auto', textAlign: 'left' }}>
                    {processResult.onboarding === 0 && processResult.employees === 0 ? (
                      <div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: '#2e7d32', marginBottom: 8 }}>Foundation records created / Grunddaten erstellt</div>
                        <ul style={{ margin: 0, paddingLeft: 20, color: '#333', fontSize: 14 }}>
                          <li>5 leave types created / Urlaubsarten erstellt (Annual, Sick, Compassionate, Parental, Unpaid)</li>
                          <li>Company features configured / Unternehmensfunktionen konfiguriert</li>
                        </ul>
                      </div>
                    ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                        <div>
                          <div style={{ fontSize: 28, fontWeight: 700, color: '#2e7d32' }}>{processResult.onboarding}</div>
                          <div style={{ fontSize: 13, color: '#666' }}>Onboarding Records</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 28, fontWeight: 700, color: '#1565c0' }}>{processResult.employees}</div>
                          <div style={{ fontSize: 13, color: '#666' }}>Employee Records</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 28, fontWeight: 700, color: '#7b1fa2' }}>{processResult.payslips}</div>
                          <div style={{ fontSize: 13, color: '#666' }}>Payslips Created</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: '#e65100' }}>{processResult.admin || 'None'}</div>
                          <div style={{ fontSize: 13, color: '#666' }}>Company Admin</div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div style={{ background: '#fff3e0', border: '1px solid #ff9800', borderRadius: 8, padding: 16, maxWidth: 500, margin: '16px auto', textAlign: 'left' }}>
                    <h4 style={{ margin: '0 0 8px', color: '#e65100' }}>Next Steps / Nächste Schritte</h4>
                    <ol style={{ margin: 0, paddingLeft: 20, color: '#333', fontSize: 14 }}>
                      {processResult.employees > 0 && (
                        <>
                          <li>Review the employee data in the Employees admin page</li>
                          <li>Check payslips in the Payroll admin page and mark as "processed" or "paid"</li>
                        </>
                      )}
                      {processResult.employees === 0 && (
                        <>
                          <li>Add employees via Onboarding — New Starter or Bulk Upload</li>
                          <li>Assign a company admin in Subscriptions &gt; Companies</li>
                        </>
                      )}
                      <li>Configure feature toggles in Subscriptions &gt; Company Features</li>
                      {setupCompany && !setupCompany.is_active && (
                        <li><strong>Enable the company domain</strong> in Companies so employees can log in</li>
                      )}
                      <li>Employees will complete their own personal details (DOB, address, emergency contact) on first login</li>
                    </ol>
                  </div>

                  <button className="admin-btn admin-btn-primary" onClick={resetSetup} style={{ marginTop: 24 }}>
                    Set Up Another Company
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
