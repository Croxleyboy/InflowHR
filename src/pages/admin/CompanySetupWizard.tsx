import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useLanguage } from '../../context/LanguageContext'
import * as XLSX from 'xlsx'

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

interface CompanySetupWizardProps {
  selectedCompanyId: string
  onSetupComplete: () => void
}

export default function CompanySetupWizard({ selectedCompanyId, onSetupComplete }: CompanySetupWizardProps) {
  const { t } = useLanguage()

  const [companies, setCompanies] = useState<CompanyRow[]>([])
  const [setupStep, setSetupStep] = useState(0)
  const [setupCompanyId, setSetupCompanyId] = useState('')
  const [setupRows, setSetupRows] = useState<SetupRow[]>([])
  const [setupErrors, setSetupErrors] = useState<string[]>([])
  const [adminEmail, setAdminEmail] = useState('')
  const [processing, setProcessing] = useState(false)
  const [processResult, setProcessResult] = useState<{ onboarding: number; employees: number; payslips: number; admin: string } | null>(null)
  const setupFileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadCompanies()
  }, [])

  async function loadCompanies() {
    const { data } = await supabase.from('companies').select('id, name, domain, is_active').order('name')
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
        { name: 'Annual Leave', company_id: companyId, deducts_from_allowance: true },
        { name: 'Sick Leave', company_id: companyId, deducts_from_allowance: false },
        { name: 'Jury Duty', company_id: companyId, deducts_from_allowance: false },
        { name: 'Bereavement', company_id: companyId, deducts_from_allowance: true },
        { name: 'Exam Leave', company_id: companyId, deducts_from_allowance: true },
        { name: 'Carers Leave', company_id: companyId, deducts_from_allowance: true },
        { name: 'Career Break', company_id: companyId, deducts_from_allowance: true },
        { name: 'Lieu Days', company_id: companyId, deducts_from_allowance: false },
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
        { company_id: companyId, feature_key: 'space_booking', is_enabled: false },
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
          await supabase.from('leave_balances').insert(
            leaveTypes.map(lt => ({
              employee_id: employeeId,
              leave_type_id: lt.id,
              year: now.getFullYear(),
              total_allowance: 25,
              used: 0,
              carried_over: 0,
              company_id: setupCompanyId,
            }))
          )
        }
      }
    }

    setProcessResult({ onboarding: onboardCount, employees: empCount, payslips: payslipCount, admin: assignedAdmin })
    setProcessing(false)
    onSetupComplete()
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
            <div style={{ textAlign: 'center', padding: '60px 20px' }}>
              <div style={{ fontSize: 48, marginBottom: 16, animation: 'spin 1s linear infinite' }}>⚙️</div>
              <h3>Processing...</h3>
              <p style={{ color: '#666' }}>Creating employee records, payslips and leave balances. Please wait.</p>
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
  )
}
