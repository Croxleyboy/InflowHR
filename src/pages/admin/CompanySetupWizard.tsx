import { useState, useEffect, useRef } from 'react'
import { supabase, callRpcDirect } from '../../lib/supabase'
import { useLanguage } from '../../context/LanguageContext'
import { useToast } from '../../context/ToastContext'
import * as XLSX from 'xlsx'
import { validateNINumber, validateSortCode, validateAccountNumber } from '../../lib/validators'
import { toLocalDateStr } from '../../lib/formatters'

interface CompanyRow {
  id: string
  name: string
  domain: string
  is_active: boolean
  fy_start_month: number
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
  personal_email: string
  date_of_birth: string
  gender: string
  nationality: string
  marital_status: string
  address_line1: string
  address_line2: string
  city: string
  county: string
  postcode: string
  country: string
  emergency_contact_name: string
  emergency_contact_phone: string
  emergency_contact_relationship: string
  ni_number: string
  bank_sort_code: string
  bank_account_number: string
  bank_account_name: string
  probation_end_date: string
  notice_period: string
  weekly_hours: number
  leave_allowance: number | null
  qualifications: string
  religion: string
  salary_group: string
  xero_employee_id: string
}

const SETUP_COLUMN_MAP: Record<string, keyof SetupRow> = {
  'first name': 'firstname', 'firstname': 'firstname', 'first_name': 'firstname',
  'surname': 'surname', 'last name': 'surname', 'last_name': 'surname', 'lastname': 'surname',
  'work email': 'user_email', 'user_email': 'user_email', 'email': 'user_email', 'work_email': 'user_email',
  'personal email': 'personal_email', 'personal_email': 'personal_email',
  'job title': 'job_title', 'job_title': 'job_title',
  'department': 'department',
  'manager name': 'manager', 'manager': 'manager',
  'manager email': 'manager_email', 'manager_email': 'manager_email',
  'location': 'location',
  'phone': 'telephone', 'telephone': 'telephone',
  'employee number': 'employee_number', 'employee_number': 'employee_number',
  'start date': 'start_date', 'start_date': 'start_date',
  'contract type': 'contract_type', 'contract_type': 'contract_type',
  'annual salary': 'annual_salary', 'annual_salary': 'annual_salary', 'salary': 'annual_salary',
  'tax code': 'tax_code', 'tax_code': 'tax_code',
  'payroll id': 'payroll_id', 'payroll_id': 'payroll_id',
  'role': 'role',
  'date of birth': 'date_of_birth', 'date_of_birth': 'date_of_birth', 'dob': 'date_of_birth',
  'gender': 'gender', 'nationality': 'nationality',
  'marital status': 'marital_status', 'marital_status': 'marital_status',
  'address line 1': 'address_line1', 'address_line_1': 'address_line1',
  'address line 2': 'address_line2', 'address_line_2': 'address_line2',
  'address line 3': 'city', 'address_line_3': 'city',
  'address line 4': 'postcode', 'address_line_4': 'postcode',
  'city': 'city', 'county': 'county',
  'postcode': 'postcode', 'country': 'country',
  'emergency contact name': 'emergency_contact_name', 'emergency_contact_name': 'emergency_contact_name',
  'emergency contact phone': 'emergency_contact_phone', 'emergency_contact_number': 'emergency_contact_phone', 'emergency_contact_phone': 'emergency_contact_phone',
  'emergency contact relationship': 'emergency_contact_relationship',
  'ni number': 'ni_number', 'ni_number': 'ni_number',
  'bank sort code': 'bank_sort_code', 'bank_sort_code': 'bank_sort_code',
  'bank account number': 'bank_account_number', 'bank_account_number': 'bank_account_number',
  'bank account name': 'bank_account_name', 'bank_account_name': 'bank_account_name',
  'probation end date': 'probation_end_date', 'probation_end_date': 'probation_end_date',
  'notice period': 'notice_period', 'notice_period': 'notice_period',
  'weekly hours': 'weekly_hours', 'weekly_hours': 'weekly_hours',
  'leave allowance': 'leave_allowance', 'assigned leave days': 'leave_allowance',
  'qualifications': 'qualifications', 'qualification': 'qualifications',
  'religion': 'religion', 'faith': 'religion',
  'salary group': 'salary_group', 'salary_group': 'salary_group', 'pay grade': 'salary_group', 'pay band': 'salary_group',
  'xero employee id': 'xero_employee_id', 'xero_employee_id': 'xero_employee_id',
}

const SETUP_STEPS = [
  { label: 'Select Company', icon: '🏢' },
  { label: 'Upload Data', icon: '📤' },
  { label: 'Review & Assign Admin', icon: '👀' },
  { label: 'Process', icon: '✅' },
]

interface CompanySetupWizardProps {
  onSetupComplete: (companyId?: string) => void
}

export default function CompanySetupWizard({ onSetupComplete }: CompanySetupWizardProps) {
  const { t } = useLanguage()
  const { showError, showSuccess } = useToast()

  const [companies, setCompanies] = useState<CompanyRow[]>([])
  const [setupStep, setSetupStep] = useState(0)
  const [setupCompanyId, setSetupCompanyId] = useState('')
  const [setupRows, setSetupRows] = useState<SetupRow[]>([])
  const [setupErrors, setSetupErrors] = useState<string[]>([])
  const [adminEmail, setAdminEmail] = useState('')
  const [processing, setProcessing] = useState(false)
  const [processProgress, setProcessProgress] = useState({ current: 0, total: 0, phase: '' })
  const [processResult, setProcessResult] = useState<{ onboarding: number; employees: number; payslips: number; admin: string; errors: string[] } | null>(null)
  const setupFileRef = useRef<HTMLInputElement>(null)
  const [fyStartMonth, setFyStartMonth] = useState(4)

  useEffect(() => {
    loadCompanies()
  }, [])

  async function loadCompanies() {
    const { data } = await supabase.from('companies').select('id, name, domain, is_active, fy_start_month').order('name')
    setCompanies((data as CompanyRow[]) || [])
  }

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
        const out: Record<string, any> = { contract_type: 'Full-time', annual_salary: 0, tax_code: '1257L', payroll_id: '', role: 'employee', personal_email: '', date_of_birth: '', gender: '', nationality: '', marital_status: '', address_line1: '', address_line2: '', city: '', county: '', postcode: '', country: 'United Kingdom', emergency_contact_name: '', emergency_contact_phone: '', emergency_contact_relationship: '', ni_number: '', bank_sort_code: '', bank_account_number: '', bank_account_name: '', probation_end_date: '', notice_period: '', weekly_hours: 37.5, leave_allowance: null, qualifications: '', religion: '', salary_group: '' }
        for (const [excelCol, val] of Object.entries(row)) {
          const key = SETUP_COLUMN_MAP[excelCol.toLowerCase().trim()]
          if (key) {
            if (key === 'annual_salary' || key === 'weekly_hours') {
              out[key] = Number(val) || 0
            } else if (['start_date', 'date_of_birth', 'probation_end_date'].includes(key)) {
              if (typeof val === 'number') {
                const d = XLSX.SSF.parse_date_code(val)
                out[key] = `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
              } else {
                const str = String(val).trim()
                const ddmmyyyy = str.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/)
                if (ddmmyyyy) {
                  out[key] = `${ddmmyyyy[3]}-${ddmmyyyy[2].padStart(2, '0')}-${ddmmyyyy[1].padStart(2, '0')}`
                } else {
                  out[key] = str
                }
              }
            } else {
              out[key] = String(val).trim().replace(/^[=+\-@\t\r]+/, '')
            }
          }
        }
        if (!out.firstname) errors.push(`Row ${i + 2}: Missing First Name`)
        if (!out.surname) errors.push(`Row ${i + 2}: Missing Surname`)
        if (!out.user_email) errors.push(`Row ${i + 2}: Missing Work Email`)
        else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.user_email))
          errors.push(`Row ${i + 2}: Invalid email "${out.user_email}"`)
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
    const headers = ['First Name', 'Surname', 'Work Email', 'Personal Email', 'Job Title', 'Department', 'Manager Name', 'Manager Email', 'Location', 'Phone', 'Employee Number', 'Start Date', 'Contract Type', 'Date of Birth', 'Gender', 'Nationality', 'Marital Status', 'Religion', 'NI Number', 'Address Line 1', 'Address Line 2', 'City', 'County', 'Postcode', 'Country', 'Working Pattern', 'Weekly Hours', 'Probation End Date', 'Notice Period', 'Annual Salary', 'Tax Code', 'Payroll ID', 'Xero Employee ID', 'Salary Group', 'Qualifications', 'Assigned Leave Days', 'Emergency Contact Name', 'Emergency Contact Phone', 'Emergency Contact Relationship', 'Bank Account Name', 'Bank Sort Code', 'Bank Account Number', 'Role']
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
        { name: 'Annual Leave', company_id: companyId, deducts_from_allowance: true },
        { name: 'Sick Leave', company_id: companyId, deducts_from_allowance: false },
        { name: 'Jury Duty', company_id: companyId, deducts_from_allowance: false },
        { name: 'Bereavement', company_id: companyId, deducts_from_allowance: true },
        { name: 'Exam Leave', company_id: companyId, deducts_from_allowance: true },
        { name: 'Carers Leave', company_id: companyId, deducts_from_allowance: true },
        { name: 'Career Break', company_id: companyId, deducts_from_allowance: true },
        { name: 'Lieu Days', company_id: companyId, deducts_from_allowance: false },
      ]
      const { error: leaveTypesErr } = await supabase.from('leave_types').insert(defaultLeaveTypes)
      if (leaveTypesErr) { showError('Failed to create leave types: ' + leaveTypesErr.message); return }
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
        { company_id: companyId, feature_key: 'elearning', is_enabled: true },
        { company_id: companyId, feature_key: 'timesheets', is_enabled: true },
        { company_id: companyId, feature_key: 'payroll', is_enabled: false },
        { company_id: companyId, feature_key: 'performance', is_enabled: false },
        { company_id: companyId, feature_key: 'shifts', is_enabled: false },
        { company_id: companyId, feature_key: 'benefits', is_enabled: false },
        { company_id: companyId, feature_key: 'legal_timesheets', is_enabled: false },
        { company_id: companyId, feature_key: 'space_booking', is_enabled: false },
      ]
      const { error: featuresErr } = await supabase.from('company_features').insert(standardFeatures)
      if (featuresErr) { showError('Failed to create company features: ' + featuresErr.message); return }
    }

    const { data: existingAnn } = await supabase
      .from('announcements')
      .select('id')
      .eq('company_id', companyId)
      .limit(1)

    if (!existingAnn || existingAnn.length === 0) {
      await supabase.from('announcements').insert({
        title: 'Welcome to your new HR App',
        body: "Take a look within 'Settings' and choose the guide to get to know your app and its features.",
        submitted_by_name: 'InflowHR',
        is_pinned: true,
        company_id: companyId,
      })
    }
  }

  async function processSetup() {
    if (!setupCompanyId) return
    setProcessing(true)

    await callRpcDirect('ensure_super_admin_access', { p_hours: 48 })

    const company = companies.find(c => c.id === setupCompanyId)
    let onboardCount = 0, empCount = 0, payslipCount = 0
    let assignedAdmin = ''
    const errors: string[] = []

    await ensureCompanyFoundation(setupCompanyId)

    const now = new Date()
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    const paymentDate = new Date(periodEnd)
    paymentDate.setDate(paymentDate.getDate() - 3)

    const piiErrors: string[] = []
    setupRows.forEach((row, i) => {
      const ni = validateNINumber(row.ni_number || '')
      const sc = validateSortCode(row.bank_sort_code || '')
      const ac = validateAccountNumber(row.bank_account_number || '')
      const rowErrs = [ni, sc, ac].filter(Boolean)
      if (rowErrs.length) piiErrors.push(`Row ${i + 1} (${row.firstname} ${row.surname}): ${rowErrs.join(', ')}`)
    })
    if (piiErrors.length > 0) { showError(piiErrors.slice(0, 5).join(' | ')); setProcessing(false); return }

    const total = setupRows.length
    setProcessProgress({ current: 0, total, phase: 'Setting up foundation...' })
    await new Promise(r => setTimeout(r, 0))

    for (let rowIndex = 0; rowIndex < setupRows.length; rowIndex++) {
      const row = setupRows[rowIndex]
      setProcessProgress({ current: rowIndex + 1, total, phase: `Processing ${row.firstname} ${row.surname}...` })
      // 1. Create onboarding record (skip if already exists)
      const { data: existingOnb } = await supabase.from('onboarding').select('id').eq('user_email', row.user_email).eq('company_id', setupCompanyId).maybeSingle()
      if (existingOnb) {
        onboardCount++
      } else {
        const { error: onbErr } = await supabase.from('onboarding').insert({
          firstname: row.firstname,
          surname: row.surname,
          user_email: row.user_email,
          personal_email: row.personal_email || null,
          job_title: row.job_title,
          department: row.department,
          manager: row.manager,
          manager_email: row.manager_email,
          location: row.location,
          telephone: row.telephone,
          employee_number: row.employee_number,
          start_date: row.start_date || null,
          contract_type: row.contract_type,
          status: 'Onboarded',
          appstatus: 'active',
          is_complete: true,
          first_day: true,
          first_week: true,
          first_month: true,
          elearning: true,
          company_id: setupCompanyId,
          date_of_birth: row.date_of_birth || null,
          gender: row.gender || null,
          nationality: row.nationality || null,
          marital_status: row.marital_status || null,
          address_line1: row.address_line1 || null,
          address_line2: row.address_line2 || null,
          city: row.city || null,
          county: row.county || null,
          postcode: row.postcode || null,
          country: row.country || null,
          emergency_contact_name: row.emergency_contact_name || null,
          emergency_contact_phone: row.emergency_contact_phone || null,
          emergency_contact_relationship: row.emergency_contact_relationship || null,
          ni_number: row.ni_number || null,
          bank_sort_code: row.bank_sort_code || null,
          bank_account_number: row.bank_account_number || null,
          bank_account_name: row.bank_account_name || null,
          probation_end_date: row.probation_end_date || null,
          notice_period: row.notice_period || null,
          weekly_hours: row.weekly_hours || null,
          annual_salary: row.annual_salary || null,
          tax_code: row.tax_code || null,
          payroll_id: row.payroll_id || null,
          religion: row.religion || null,
        })
        if (!onbErr) {
          onboardCount++
        } else {
          errors.push(`Onboarding ${row.firstname} ${row.surname}: ${onbErr.message}`)
        }
      }

      // 2. Create employee record
      const { data: existing } = await supabase.from('employees').select('id').eq('email', row.user_email).eq('company_id', setupCompanyId).maybeSingle()
      let employeeId = existing?.id

      if (existing) {
        empCount++
      } else {
        const { data: newEmp, error: empErr } = await supabase.from('employees').insert({
          employee_number: row.employee_number || `EMP-${Date.now().toString().slice(-6)}`,
          first_name: row.firstname,
          last_name: row.surname,
          email: row.user_email,
          personal_email: row.personal_email || null,
          job_title: row.job_title || '',
          department: row.department || '',
          start_date: row.start_date || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
          phone: row.telephone || '',
          is_admin: row.role === 'admin',
          is_active: true,
          company_id: setupCompanyId,
          location: row.location || null,
          contract_type: row.contract_type || 'Full-time',
          manager_name: row.manager || null,
          manager_email: row.manager_email || null,
          date_of_birth: row.date_of_birth || null,
          gender: row.gender || null,
          nationality: row.nationality || null,
          marital_status: row.marital_status || null,
          address_line1: row.address_line1 || null,
          address_line2: row.address_line2 || null,
          city: row.city || null,
          county: row.county || null,
          postcode: row.postcode || null,
          country: row.country || null,
          emergency_contact_name: row.emergency_contact_name || null,
          emergency_contact_phone: row.emergency_contact_phone || null,
          emergency_contact_relationship: row.emergency_contact_relationship || null,
          ni_number: row.ni_number || null,
          bank_sort_code: row.bank_sort_code || null,
          bank_account_number: row.bank_account_number || null,
          bank_account_name: row.bank_account_name || null,
          probation_end_date: row.probation_end_date || null,
          notice_period: row.notice_period || null,
          weekly_hours: row.weekly_hours || null,
          annual_salary: row.annual_salary || null,
          tax_code: row.tax_code || null,
          payroll_id: row.payroll_id || null,
          leave_allowance: row.leave_allowance ?? 15,
          qualifications: row.qualifications || null,
          religion: row.religion || null,
          salary_group: row.salary_group || null,
        }).select('id').single()
        if (!empErr && newEmp) {
          empCount++
          employeeId = newEmp.id
        } else if (empErr) {
          errors.push(`${row.firstname} ${row.surname}: ${empErr.message}`)
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
          pay_period_start: toLocalDateStr(periodStart),
          pay_period_end: toLocalDateStr(periodEnd),
          gross_pay: Math.round(monthlySalary * 100) / 100,
          tax: Math.round(tax * 100) / 100,
          national_insurance: Math.round(ni * 100) / 100,
          pension: Math.round(pension * 100) / 100,
          other_deductions: 0,
          net_pay: Math.round(netPay * 100) / 100,
          payment_date: toLocalDateStr(paymentDate),
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

      // 4. Create/update company_users record for admin role
      if (row.user_email === adminEmail && company && employeeId) {
        const { data: sessionData } = await supabase.auth.getUser()
        const authUserId = sessionData?.user?.id
        let adminErr: any = null
        if (authUserId) {
          const { data: existingCU } = await supabase.from('company_users')
            .select('id')
            .eq('auth_user_id', authUserId)
            .eq('company_id', setupCompanyId)
            .maybeSingle()
          if (existingCU) {
            const { error } = await supabase.from('company_users')
              .update({ role: 'admin', is_active: true, employee_id: employeeId })
              .eq('id', existingCU.id)
            adminErr = error
          } else {
            const { error } = await supabase.from('company_users').insert({
              auth_user_id: authUserId,
              company_id: setupCompanyId,
              role: 'admin',
              is_active: true,
              employee_id: employeeId,
            })
            adminErr = error
          }
        } else {
          const { error } = await supabase.from('company_users').insert({
            company_id: setupCompanyId,
            role: 'admin',
            is_active: true,
            employee_id: employeeId,
          })
          adminErr = error
        }
        if (!adminErr) {
          assignedAdmin = `${row.firstname} ${row.surname} (${row.user_email})`
        } else {
          errors.push(`Admin assignment for ${row.user_email}: ${adminErr.message}`)
        }
      }

      // 5. Create leave balances for each leave type
      if (employeeId) {
        const allowance = row.leave_allowance ?? 15
        const { data: leaveTypes } = await supabase.from('leave_types').select('id, deducts_from_allowance').eq('company_id', setupCompanyId)
        if (leaveTypes && leaveTypes.length > 0) {
          const { error: leaveBalErr } = await supabase.from('leave_balances').insert(
            leaveTypes.map(lt => ({
              employee_id: employeeId,
              leave_type_id: lt.id,
              year: now.getFullYear(),
              total_allowance: lt.deducts_from_allowance ? allowance : 0,
              used: 0,
              carried_over: 0,
              company_id: setupCompanyId,
            }))
          )
          if (leaveBalErr) errors.push(`Leave balances for ${row.firstname} ${row.surname}: ${leaveBalErr.message}`)
        }
      }
    }

    setProcessProgress({ current: total, total, phase: 'Finalising setup...' })

    // 6. Create welcome announcement
    const { data: existingAnnouncement } = await supabase
      .from('announcements')
      .select('id')
      .eq('company_id', setupCompanyId)
      .eq('title', 'Welcome to InflowHR!')
      .maybeSingle()
    if (!existingAnnouncement) {
      const { error: announcementErr } = await supabase.from('announcements').insert({
        title: 'Welcome to InflowHR!',
        body: 'Welcome to your new HR app! Take a look around and explore all the features available to you. Head to E-Learning to get started with your onboarding modules, check your profile in the Directory, and submit your first expense or leave request. If you need help, speak to your company admin.',
        company_id: setupCompanyId,
        is_pinned: true,
        published_at: new Date().toISOString(),
        submitted_by_name: 'InflowHR',
      })
      if (announcementErr) errors.push(`Welcome announcement: ${announcementErr.message}`)
    }

    setProcessResult({ onboarding: onboardCount, employees: empCount, payslips: payslipCount, admin: assignedAdmin, errors })
    setProcessing(false)
    if (errors.length === 0) showSuccess('Company setup complete')
    else showError(`Setup completed with ${errors.length} error${errors.length !== 1 ? 's' : ''}`)
    onSetupComplete(setupCompanyId)
  }

  function resetSetup() {
    setSetupStep(0)
    setSetupCompanyId('')
    setSetupRows([])
    setSetupErrors([])
    setAdminEmail('')
    setProcessResult(null)
  }

  const setupCompany = companies.find(c => c.id === setupCompanyId)

  return (
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
                <select className="admin-select" value={setupCompanyId} onChange={e => {
                  setSetupCompanyId(e.target.value)
                  const co = companies.find(c => c.id === e.target.value)
                  setFyStartMonth(co?.fy_start_month ?? 4)
                }}>
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
              {setupCompanyId && (
                <div style={{ background: '#e3f2fd', border: '1px solid #90caf9', borderRadius: 8, padding: 16, marginTop: 16 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Financial Year Settings</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <label style={{ fontWeight: 600, fontSize: 13 }}>FY starts in</label>
                    <select
                      className="admin-select"
                      style={{ width: 160 }}
                      value={fyStartMonth}
                      onChange={async e => {
                        const month = parseInt(e.target.value)
                        setFyStartMonth(month)
                        await supabase.from('companies').update({ fy_start_month: month }).eq('id', setupCompanyId)
                      }}
                    >
                      {['January','February','March','April','May','June','July','August','September','October','November','December'].map((m, i) => (
                        <option key={i + 1} value={i + 1}>{m}</option>
                      ))}
                    </select>
                    <span style={{ fontSize: 12, color: '#555' }}>
                      Sets billing periods, payslip dates, and expense reporting for this company
                    </span>
                  </div>
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
            Required columns: First Name, Surname, Work Email. Optional: Personal Email, Job Title, Department, Manager Name/Email, Location, Phone, Employee Number, Start Date, Contract Type, Date of Birth, Gender, Nationality, Marital Status, NI Number, Address (Line 1/2, City, County, Postcode, Country), Working Pattern, Weekly Hours, Probation End Date, Notice Period, Annual Salary, Tax Code, Payroll ID, Emergency Contact (Name/Phone/Relationship), Bank Details (Account Name/Sort Code/Account Number), Role (admin/employee/hr).
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
              <li><strong>{setupRows.length}</strong> annual leave balances (default 15 days)</li>
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
                  <h4 style={{ margin: '0 0 8px', color: '#2e7d32' }}>{t('admin_onboard.what_created')}</h4>
                  <ul style={{ margin: 0, paddingLeft: 20, color: '#333', fontSize: 14 }}>
                    <li><strong>8</strong> {t('admin_onboard.leave_types_count')}</li>
                    <li><strong>10</strong> {t('admin_onboard.feature_toggles_count')}</li>
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
            <div style={{ textAlign: 'center', padding: '60px 20px', maxWidth: 500, margin: '0 auto' }}>
              <h3 style={{ marginBottom: 24 }}>Processing Employees</h3>
              <div style={{ background: 'var(--border, #e0e0e0)', borderRadius: 8, height: 28, overflow: 'hidden', position: 'relative', marginBottom: 12 }}>
                <div style={{
                  height: '100%',
                  width: `${processProgress.total > 0 ? (processProgress.current / processProgress.total) * 100 : 0}%`,
                  background: 'linear-gradient(90deg, #43a047, #66bb6a)',
                  borderRadius: 8,
                  transition: 'width 0.3s ease',
                  display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 8,
                  minWidth: processProgress.current > 0 ? 40 : 0,
                }}>
                  {processProgress.current > 0 && (
                    <span style={{ color: '#fff', fontSize: 12, fontWeight: 700 }}>
                      {Math.round((processProgress.current / processProgress.total) * 100)}%
                    </span>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--text-muted, #666)', marginBottom: 8 }}>
                <span>{processProgress.current} of {processProgress.total}</span>
                <span>{processProgress.total - processProgress.current} remaining</span>
              </div>
              <p style={{ color: 'var(--text-muted, #888)', fontSize: 14, margin: 0 }}>{processProgress.phase}</p>
            </div>
          )}

          {processResult && (
            <div style={{ textAlign: 'center', padding: '40px 20px' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
              <h3 style={{ color: '#2e7d32' }}>{t('admin_onboard.setup_complete')}</h3>

              <div style={{ background: '#e8f5e9', border: '1px solid #43a047', borderRadius: 12, padding: 24, maxWidth: 500, margin: '24px auto', textAlign: 'left' }}>
                {processResult.onboarding === 0 && processResult.employees === 0 ? (
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#2e7d32', marginBottom: 8 }}>{t('admin_onboard.foundation_created')}</div>
                    <ul style={{ margin: 0, paddingLeft: 20, color: '#333', fontSize: 14 }}>
                      <li>8 {t('admin_onboard.leave_types_created')}</li>
                      <li>{t('admin_onboard.features_configured')}</li>
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
                    <li>Add employees via Onboarding — New Starter or Bulk Upload</li>
                  )}
                  {!processResult.admin && (
                    <li>Assign a company admin in Subscriptions &gt; Companies</li>
                  )}
                  <li>Configure feature toggles in Subscriptions &gt; Company Features</li>
                  {setupCompany && !setupCompany.is_active && (
                    <li><strong>Enable the company domain</strong> in Companies so employees can log in</li>
                  )}
                  <li>Employees will complete their own personal details (DOB, address, emergency contact) on first login</li>
                </ol>
              </div>

              {processResult.errors.length > 0 && (
                <div style={{ background: '#ffebee', border: '1px solid #ef5350', borderRadius: 8, padding: 16, maxWidth: 500, margin: '16px auto', textAlign: 'left' }}>
                  <h4 style={{ margin: '0 0 8px', color: '#c62828' }}>Errors ({processResult.errors.length})</h4>
                  <ul style={{ margin: 0, paddingLeft: 20, color: '#b71c1c', fontSize: 13 }}>
                    {processResult.errors.map((err, i) => <li key={i}>{err}</li>)}
                  </ul>
                </div>
              )}

              <button className="admin-btn admin-btn-primary" onClick={resetSetup} style={{ marginTop: 24 }}>
                Set Up Another Company
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
