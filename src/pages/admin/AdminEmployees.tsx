import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { useFeatures } from '../../context/FeatureContext'
import { validateNINumber, validateSortCode, validateAccountNumber } from '../../lib/validators'
import { currencySymbol } from '../../lib/formatters'
import EmployeeRecordModules from './EmployeeRecordModules'

const PAGE_SIZE = 30

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
  contracted_days: boolean[] | null
  weekly_hours: number | null
  location: string | null
  contract_type: string | null
  annual_salary: number | null
  hourly_rate: number | null
  tax_code: string | null
  payroll_id: string | null
  personal_email: string | null
  manager_name: string | null
  manager_email: string | null
  leave_allowance: number | null
  salary_group: string | null
  qualifications: string | null
  religion: string | null
  manager_id: string | null
  employment_category: string
  pay_pattern_override: string | null
  overtime_handling_override: string | null
  time_recording_override: string | null
  is_payroll_exception: boolean
  persona: string | null
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default function AdminEmployees() {
  const navigate = useNavigate()
  const { selectedCompanyId } = useAdminCompany()
  const { company } = useAuth()
  const currency = company?.currency || 'GBP'
  const { showError, showSuccess } = useToast()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [setupMap, setSetupMap] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [filterDept, setFilterDept] = useState('')
  const [filterActive, setFilterActive] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Record<string, any>>({})
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [uploading, setUploading] = useState<string | null>(null)
  const [revealedPii, setRevealedPii] = useState<Set<string>>(new Set())
  const { features } = useFeatures()
  const [empSkills, setEmpSkills] = useState<Record<string, { skill_name: string; proficiency: number; status: string }[]>>({})
  const [lieuDays, setLieuDays] = useState<Record<string, { balanceId: number; lieu_days: number }>>({})
  const [editLieuDays, setEditLieuDays] = useState<number>(0)
  const [activeTab, setActiveTab] = useState<'management' | 'records' | 'orgchart' | 'settings' | 'custom_fields'>('records')
  const [recordsSearch, setRecordsSearch] = useState('')
  const [selectedLetter, setSelectedLetter] = useState<string | null>(null)
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  // Worker type settings state
  interface WorkerTypeSetting {
    id?: number
    company_id: string
    worker_type: string
    pay_pattern: string
    overtime_handling: string
    time_recording: string
    overtime_rate_multiplier: number
  }
  const [workerSettings, setWorkerSettings] = useState<WorkerTypeSetting[]>([])

  // Custom fields state
  interface CustomFieldDef {
    id?: string
    company_id: string
    field_number: number
    title: string
    field_type: 'short' | 'long'
    default_value: string
    is_visible: boolean
  }
  const [customFields, setCustomFields] = useState<CustomFieldDef[]>([])
  const [customFieldsLoading, setCustomFieldsLoading] = useState(false)
  const [customFieldsSaving, setCustomFieldsSaving] = useState(false)
  const [moverPrompt, setMoverPrompt] = useState<{ empId: string; empName: string; changes: Record<string, { old: string; new: string }> } | null>(null)

  function maskValue(value: string | null, employeeId: string, field: string): string {
    if (!value) return '—'
    const key = `${employeeId}:${field}`
    if (revealedPii.has(key)) return value
    if (value.length <= 2) return '••'
    return value.slice(0, 2) + '•'.repeat(value.length - 2)
  }

  function toggleReveal(employeeId: string, field: string) {
    const key = `${employeeId}:${field}`
    setRevealedPii(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  useEffect(() => { if (selectedCompanyId) load() }, [selectedCompanyId])

  useEffect(() => {
    const targetId = expandedId || selectedEmployeeId
    if (!targetId || !features.skills_passport || empSkills[targetId]) return
    ;(async () => {
      const { data } = await supabase
        .from('employee_skills')
        .select('skill_name, proficiency, status')
        .eq('employee_id', targetId)
        .eq('company_id', selectedCompanyId)
      if (data) setEmpSkills(prev => ({ ...prev, [targetId]: data }))
    })()
  }, [expandedId, selectedEmployeeId])

  async function load() {
    setLoading(true)
    const [{ data }, { data: onbData }] = await Promise.all([
      supabase.from('employees').select('*').eq('company_id', selectedCompanyId).order('last_name'),
      supabase.from('onboarding').select('user_email, initial_setup_complete').eq('company_id', selectedCompanyId),
    ])
    setEmployees((data as Employee[]) || [])
    const map: Record<string, boolean> = {}
    ;(onbData || []).forEach((o: any) => { map[o.user_email?.toLowerCase()] = o.initial_setup_complete === true })
    setSetupMap(map)

    const { data: ltData } = await supabase.from('leave_types').select('id').eq('company_id', selectedCompanyId).eq('name', 'Annual Leave').limit(1).single()
    if (ltData) {
      const { data: balData } = await supabase.from('leave_balances')
        .select('id, employee_id, lieu_days')
        .eq('company_id', selectedCompanyId)
        .eq('leave_type_id', ltData.id)
        .eq('year', new Date().getFullYear())
      const lieuMap: Record<string, { balanceId: number; lieu_days: number }> = {}
      for (const b of (balData || []) as { id: number; employee_id: string; lieu_days: number }[]) {
        lieuMap[b.employee_id] = { balanceId: b.id, lieu_days: Number(b.lieu_days) || 0 }
      }
      setLieuDays(lieuMap)
    }

    // Load worker type settings
    const { data: wtsData } = await supabase
      .from('worker_type_settings')
      .select('*')
      .eq('company_id', selectedCompanyId)
    setWorkerSettings(wtsData || [])

    setLoading(false)
  }

  function startEdit(emp: Employee) {
    setEditingId(emp.id)
    setEditForm({
      first_name: emp.first_name, last_name: emp.last_name, email: emp.email,
      job_title: emp.job_title || '', department: emp.department || '', phone: emp.phone || '',
      is_active: emp.is_active, is_admin: emp.is_admin,
      date_of_birth: emp.date_of_birth || '', gender: emp.gender || '',
      nationality: emp.nationality || '', marital_status: emp.marital_status || '',
      address_line1: emp.address_line1 || '', address_line2: emp.address_line2 || '',
      city: emp.city || '', county: emp.county || '', postcode: emp.postcode || '',
      country: emp.country || 'United Kingdom',
      emergency_contact_name: emp.emergency_contact_name || '',
      emergency_contact_phone: emp.emergency_contact_phone || '',
      emergency_contact_relationship: emp.emergency_contact_relationship || '',
      ni_number: emp.ni_number || '',
      bank_sort_code: emp.bank_sort_code || '', bank_account_number: emp.bank_account_number || '',
      bank_account_name: emp.bank_account_name || '',
      probation_end_date: emp.probation_end_date || '', notice_period: emp.notice_period || '',
      employment_category: emp.employment_category || 'not_assigned',
      contracted_days: emp.contracted_days || [true,true,true,true,true,false,false], weekly_hours: emp.weekly_hours ?? '',
      location: emp.location || '', contract_type: emp.contract_type || '',
      annual_salary: emp.annual_salary ?? '', hourly_rate: emp.hourly_rate ?? '',
      tax_code: emp.tax_code || '',
      payroll_id: emp.payroll_id || '', personal_email: emp.personal_email || '',
      manager_name: emp.manager_name || '', manager_email: emp.manager_email || '',
      leave_allowance: emp.leave_allowance ?? 15,
      salary_group: emp.salary_group || 'N/A',
      qualifications: emp.qualifications || '',
      religion: emp.religion || '',
      start_date: emp.start_date || '',
      pay_pattern_override: emp.pay_pattern_override || '',
      overtime_handling_override: emp.overtime_handling_override || '',
      time_recording_override: emp.time_recording_override || '',
      is_payroll_exception: emp.is_payroll_exception || false,
      persona: emp.persona || 'standard',
    })
    setEditLieuDays(lieuDays[emp.id]?.lieu_days ?? 0)
  }

  async function saveEdit(id: string) {
    const niErr = validateNINumber(editForm.ni_number || '')
    if (niErr) { showError(niErr); return }
    const scErr = validateSortCode(editForm.bank_sort_code || '')
    if (scErr) { showError(scErr); return }
    const acErr = validateAccountNumber(editForm.bank_account_number || '')
    if (acErr) { showError(acErr); return }
    const dateFields = ['date_of_birth', 'probation_end_date', 'start_date']
    const numericFields = ['weekly_hours', 'annual_salary', 'hourly_rate', 'leave_allowance']
    const payload: Record<string, any> = {}
    for (const [k, v] of Object.entries(editForm)) {
      if (dateFields.includes(k)) { payload[k] = v || null }
      else if (numericFields.includes(k)) { payload[k] = v !== '' && v != null ? parseFloat(v) : null }
      else if (typeof v === 'string') { payload[k] = v || null }
      else { payload[k] = v }
    }
    const { error } = await supabase.from('employees').update(payload).eq('id', id)
    if (error) { showError('Failed to save employee: ' + error.message); return }
    const emp = employees.find(e => e.id === id)
    if (emp && (editForm.first_name !== emp.first_name || editForm.last_name !== emp.last_name)) {
      const onboardingUpdate: Record<string, string | null> = {}
      if (editForm.first_name !== emp.first_name) onboardingUpdate.firstname = editForm.first_name || null
      if (editForm.last_name !== emp.last_name) onboardingUpdate.surname = editForm.last_name || null
      if (Object.keys(onboardingUpdate).length > 0) {
        onboardingUpdate.display_name = `${editForm.first_name || ''} ${editForm.last_name || ''}`.trim()
        await supabase.from('onboarding').update(onboardingUpdate).eq('user_email', emp.email).eq('company_id', selectedCompanyId)
      }
    }
    if (lieuDays[id]?.balanceId) {
      const balUpdate: Record<string, any> = { lieu_days: editLieuDays }
      if (editForm.leave_allowance != null && editForm.leave_allowance !== '') {
        balUpdate.total_allowance = parseFloat(editForm.leave_allowance)
      }
      await supabase.from('leave_balances').update(balUpdate).eq('id', lieuDays[id].balanceId)
    }

    if (features.inflowonboarder_integration) {
      const emp = employees.find(e => e.id === id)
      if (emp) {
        const roleFields: { key: string; label: string }[] = [
          { key: 'job_title', label: 'Job Title' },
          { key: 'department', label: 'Department' },
          { key: 'location', label: 'Location' },
          { key: 'manager_name', label: 'Manager' },
          { key: 'persona', label: 'Persona' },
        ]
        const changes: Record<string, { old: string; new: string }> = {}
        for (const f of roleFields) {
          const oldVal = (emp as any)[f.key] || ''
          const newVal = editForm[f.key] || ''
          if (oldVal !== newVal) changes[f.label] = { old: oldVal, new: newVal }
        }
        if (Object.keys(changes).length > 0) {
          setMoverPrompt({ empId: id, empName: `${emp.first_name} ${emp.last_name}`, changes })
        }
      }
    }

    setEditingId(null)
    showSuccess('Employee updated')
    load()
  }

  async function deactivateEmployee(id: string) {
    if (!confirm('Deactivate this employee? This will mark them as inactive and reassign their pending approvals.')) return
    const { error } = await supabase.from('employees').update({ is_active: false }).eq('id', id)
    if (error) { showError('Failed to deactivate employee: ' + error.message); return }

    const { data: pendingItems } = await supabase.from('workflow_tracker')
      .select('id')
      .eq('assigned_to', employees.find(e => e.id === id)?.email || '')
      .eq('status', 'Pending')
      .eq('company_id', selectedCompanyId)
    if (pendingItems && pendingItems.length > 0) {
      const { data: admins } = await supabase.from('company_users')
        .select('auth_user_id')
        .eq('company_id', selectedCompanyId)
        .eq('role', 'admin')
        .limit(5)
      if (admins && admins.length > 0) {
        const adminIds = admins.map(a => a.auth_user_id).filter(Boolean)
        const { data: adminEmps } = await supabase.from('employees')
          .select('email')
          .in('auth_user_id', adminIds)
          .neq('id', id)
          .eq('is_active', true)
          .limit(1)
        const newAssignee = adminEmps?.[0]?.email
        if (newAssignee) {
          await supabase.from('workflow_tracker')
            .update({ assigned_to: newAssignee })
            .eq('assigned_to', employees.find(e => e.id === id)?.email || '')
            .eq('status', 'Pending')
            .eq('company_id', selectedCompanyId)
        }
      }
    }

    showSuccess('Employee deactivated')
    load()
  }

  async function permanentlyDeleteEmployee(emp: Employee) {
    const { data: managedGoals } = await supabase
      .from('performance_goals')
      .select('id, employee_id, title, status, employee:employees!performance_goals_employee_id_fkey(first_name, last_name)')
      .eq('manager_id', emp.id)
      .eq('company_id', selectedCompanyId)
      .in('status', ['active', 'on_hold'])

    if (managedGoals && managedGoals.length > 0) {
      const names = [...new Set(managedGoals.map((g: any) => g.employee ? `${g.employee.first_name} ${g.employee.last_name}` : 'Unknown'))]
      const proceed = confirm(
        `${emp.first_name} ${emp.last_name} has ${managedGoals.length} active goal(s) assigned to:\n\n` +
        names.join(', ') +
        `\n\nThese goals will be unassigned from their manager. An HR ticket will be created to reassign them.\n\nContinue with deletion?`
      )
      if (!proceed) return

      await supabase.from('performance_goals')
        .update({ manager_id: null, updated_at: new Date().toISOString() })
        .eq('manager_id', emp.id)
        .eq('company_id', selectedCompanyId)

      const { data: maxRef } = await supabase.from('hr_tickets')
        .select('ref').eq('company_id', selectedCompanyId)
        .order('ref', { ascending: false }).limit(1).maybeSingle()
      const nextNum = maxRef?.ref ? parseInt(maxRef.ref.replace('HR-', ''), 10) + 1 : 1
      const nextRef = `HR-${String(nextNum).padStart(3, '0')}`

      await supabase.from('hr_tickets').insert({
        ref: nextRef,
        title: `Reassign goals — ${emp.first_name} ${emp.last_name} deleted`,
        description: `${emp.first_name} ${emp.last_name} has been deleted and had ${managedGoals.length} active performance goal(s) assigned to: ${names.join(', ')}.\n\nThese goals now have no manager. Please reassign them to a new manager in Performance > Goals.`,
        category: 'general',
        priority: 'high',
        status: 'open',
        submitted_by: 'system',
        company_id: selectedCompanyId,
      })
    }

    if (!confirm(`Permanently delete ${emp.first_name} ${emp.last_name} and all their related records? This cannot be undone.`)) return

    const deletes: { table: string; column: string; value: string }[] = [
      { table: 'one_to_one_comments', column: 'author_id', value: emp.id },
      { table: 'one_to_one_meetings', column: 'employee_id', value: emp.id },
      { table: 'one_to_one_meetings', column: 'manager_id', value: emp.id },
      { table: 'performance_reviews', column: 'employee_id', value: emp.id },
      { table: 'performance_reviews', column: 'reviewer_id', value: emp.id },
      { table: 'course_enrolments', column: 'employee_id', value: emp.id },
      { table: 'employee_benefits', column: 'employee_id', value: emp.id },
      { table: 'kudos', column: 'from_employee_id', value: emp.id },
      { table: 'kudos', column: 'to_employee_id', value: emp.id },
      { table: 'notifications', column: 'employee_id', value: emp.id },
      { table: 'timesheets', column: 'employee_id', value: emp.id },
      { table: 'leave_requests', column: 'employee_id', value: emp.id },
      { table: 'leave_balances', column: 'employee_id', value: emp.id },
      { table: 'expense_line_items', column: 'claim_id', value: '__expense_claims__' },
      { table: 'expense_claims', column: 'employee_id', value: emp.id },
      { table: 'payslips', column: 'employee_id', value: emp.id },
      { table: 'shift_assignments', column: 'employee_id', value: emp.id },
      { table: 'space_bookings', column: 'employee_id', value: emp.id },
      { table: 'legal_timesheet_entries', column: 'employee_id', value: emp.id },
      { table: 'frozen_employees', column: 'employee_id', value: emp.id },
      { table: 'offboarding', column: 'employee_id', value: emp.id },
      { table: 'user_settings', column: 'employee_id', value: emp.id },
      { table: 'company_users', column: 'employee_id', value: emp.id },
    ]

    // Null out approved_by / reviewer references that point to this employee
    await supabase.from('expense_claims').update({ approved_by: null }).eq('approved_by', emp.id)
    await supabase.from('leave_requests').update({ approved_by: null }).eq('approved_by', emp.id)
    await supabase.from('timesheets').update({ approved_by: null }).eq('approved_by', emp.id)
    await supabase.from('employees').update({ manager_id: null }).eq('manager_id', emp.id)
    await supabase.from('announcements').update({ author_id: null }).eq('author_id', emp.id)
    await supabase.from('workflow_tracker').delete().eq('employee_email', emp.email)

    // Delete expense_line_items for this employee's claims first
    const { data: claims } = await supabase.from('expense_claims').select('id').eq('employee_id', emp.id)
    if (claims && claims.length > 0) {
      const claimIds = claims.map(c => c.id)
      await supabase.from('expense_line_items').delete().in('claim_id', claimIds)
    }

    for (const d of deletes) {
      if (d.value === '__expense_claims__') continue
      const { error: err } = await supabase.from(d.table).delete().eq(d.column, d.value)
      if (err) { showError(`Failed to delete ${d.table}: ${err.message}`); return }
    }

    const { error: onboardingErr } = await supabase.from('onboarding').delete().eq('user_email', emp.email)
    if (onboardingErr) { showError('Failed to delete onboarding record: ' + onboardingErr.message); return }

    // Delete avatar from storage
    const ext = emp.avatar_url?.split('.').pop()?.split('?')[0] || 'jpg'
    await supabase.storage.from('avatars').remove([`${emp.id}.${ext}`])

    const { error } = await supabase.from('employees').delete().eq('id', emp.id)
    if (error) {
      showError(`Failed to delete: ${error.message}`)
      return
    }
    showSuccess('Employee deleted')
    load()
  }

  async function uploadPhoto(emp: Employee, file: File) {
    setUploading(emp.id)
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
    const path = `${emp.id}.${ext}`
    const { error: uploadErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true })
    if (uploadErr) { showError('Upload failed: ' + uploadErr.message); setUploading(null); return }
    const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path)
    const avatarUrl = urlData.publicUrl + '?t=' + Date.now()
    const { error: empErr } = await supabase.from('employees').update({ avatar_url: avatarUrl }).eq('id', emp.id)
    const { error: onbErr } = await supabase.from('onboarding').update({ avatar_url: avatarUrl }).eq('user_email', emp.email)
    if (empErr || onbErr) showError('Photo uploaded but database update failed.')
    else showSuccess('Photo updated')
    setUploading(null)
    load()
  }

  async function removePhoto(emp: Employee) {
    if (!confirm('Remove this employee photo?')) return
    const { error: empErr } = await supabase.from('employees').update({ avatar_url: null }).eq('id', emp.id)
    if (empErr) { showError('Failed to remove photo: ' + empErr.message); return }
    const { error: onbErr } = await supabase.from('onboarding').update({ avatar_url: null }).eq('user_email', emp.email)
    if (onbErr) console.error('Onboarding photo update failed:', onbErr)
    showSuccess('Photo removed')
    load()
  }

  async function loadCustomFields() {
    setCustomFieldsLoading(true)
    const { data } = await supabase
      .from('company_custom_fields')
      .select('*')
      .eq('company_id', selectedCompanyId)
      .order('field_number')
    const existing = data || []
    const fields: CustomFieldDef[] = []
    for (let i = 1; i <= 5; i++) {
      const found = existing.find((f: any) => f.field_number === i)
      if (found) {
        fields.push({ id: found.id, company_id: found.company_id, field_number: found.field_number, title: found.title, field_type: found.field_type, default_value: found.default_value, is_visible: found.is_visible })
      } else {
        fields.push({ company_id: selectedCompanyId, field_number: i, title: '', field_type: 'short', default_value: '', is_visible: false })
      }
    }
    setCustomFields(fields)
    setCustomFieldsLoading(false)
  }

  async function saveCustomFields() {
    setCustomFieldsSaving(true)
    for (const f of customFields) {
      if (f.id) {
        await supabase.from('company_custom_fields').update({
          title: f.title, field_type: f.field_type, default_value: f.default_value, is_visible: f.is_visible, updated_at: new Date().toISOString(),
        }).eq('id', f.id)
      } else if (f.title.trim()) {
        await supabase.from('company_custom_fields').insert({
          company_id: selectedCompanyId, field_number: f.field_number,
          title: f.title, field_type: f.field_type, default_value: f.default_value, is_visible: f.is_visible,
        })
      }
    }
    showSuccess('Custom fields saved')
    setCustomFieldsSaving(false)
    loadCustomFields()
  }

  function getEffectiveSetting(emp: Employee, field: 'pay_pattern' | 'overtime_handling' | 'time_recording'): string {
    const overrideVal = emp[`${field}_override` as keyof Employee] as string | null
    if (overrideVal) return overrideVal
    const workerType = emp.employment_category === 'shift_worker' && emp.contract_type === 'Zero hours shift worker' ? 'zero_hours'
      : emp.employment_category === 'shift_worker' ? 'shift_worker' : 'employed'
    const setting = workerSettings.find(s => s.worker_type === workerType)
    if (setting) return setting[field]
    return field === 'pay_pattern' ? 'monthly' : field === 'time_recording' ? 'checkin' : 'none'
  }

  const departments = useMemo(() => {
    const depts = new Set<string>()
    employees.forEach(e => { if (e.department) depts.add(e.department) })
    return Array.from(depts).sort()
  }, [employees])

  const filtered = useMemo(() => {
    return employees.filter(e => {
      if (filterDept && e.department !== filterDept) return false
      if (filterActive === 'active' && !e.is_active) return false
      if (filterActive === 'inactive' && e.is_active) return false
      if (search) {
        const q = search.toLowerCase()
        if (!`${e.first_name} ${e.last_name} ${e.email} ${e.employee_number}`.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [employees, filterDept, filterActive, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  useEffect(() => { setPage(1) }, [search, filterDept, filterActive])

  const alphabeticalEmployees = useMemo(() => {
    return [...employees].sort((a, b) => {
      const nameA = `${a.first_name} ${a.last_name}`.toLowerCase()
      const nameB = `${b.first_name} ${b.last_name}`.toLowerCase()
      return nameA.localeCompare(nameB)
    })
  }, [employees])

  const recordsFiltered = useMemo(() => {
    return alphabeticalEmployees.filter(e => {
      if (selectedLetter && !e.first_name.toUpperCase().startsWith(selectedLetter)) return false
      if (recordsSearch) {
        const q = recordsSearch.toLowerCase()
        if (!`${e.first_name} ${e.last_name}`.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [alphabeticalEmployees, selectedLetter, recordsSearch])

  const availableLetters = useMemo(() => {
    const letters = new Set<string>()
    employees.forEach(e => { if (e.first_name) letters.add(e.first_name[0].toUpperCase()) })
    return letters
  }, [employees])

  const selectedEmployee = useMemo(() => {
    if (!selectedEmployeeId) return null
    return employees.find(e => e.id === selectedEmployeeId) || null
  }, [employees, selectedEmployeeId])

  const selectedIndex = useMemo(() => {
    if (!selectedEmployeeId) return -1
    return alphabeticalEmployees.findIndex(e => e.id === selectedEmployeeId)
  }, [alphabeticalEmployees, selectedEmployeeId])

  function navigateEmployee(direction: 'prev' | 'next') {
    if (selectedIndex < 0) return
    const newIndex = direction === 'prev' ? selectedIndex - 1 : selectedIndex + 1
    if (newIndex >= 0 && newIndex < alphabeticalEmployees.length) {
      setSelectedEmployeeId(alphabeticalEmployees[newIndex].id)
    }
  }

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return '—'
    return new Date(dateStr).toLocaleDateString('en-GB')
  }

  function calculateDuration(startDate: string | null): string {
    if (!startDate) return '—'
    const start = new Date(startDate)
    const now = new Date()
    const years = now.getFullYear() - start.getFullYear()
    const months = now.getMonth() - start.getMonth()
    const totalMonths = years * 12 + months
    if (totalMonths < 1) return 'Less than a month'
    const y = Math.floor(totalMonths / 12)
    const m = totalMonths % 12
    const parts: string[] = []
    if (y > 0) parts.push(`${y} year${y !== 1 ? 's' : ''}`)
    if (m > 0) parts.push(`${m} month${m !== 1 ? 's' : ''}`)
    return parts.join(', ')
  }

  return (
    <div className="admin-section">
      <div className="admin-page-header">
        <h2>Employees</h2>
        <p>{employees.length} employees · {employees.filter(e => e.is_active).length} active</p>
      </div>

      <div className="admin-tabs">
        <button className={`admin-tab ${activeTab === 'management' ? 'admin-tab-active' : ''}`} onClick={() => setActiveTab('management')}>Employee Management</button>
        <button className={`admin-tab ${activeTab === 'records' ? 'admin-tab-active' : ''}`} onClick={() => setActiveTab('records')}>Employee Records</button>
        <button className={`admin-tab ${activeTab === 'orgchart' ? 'admin-tab-active' : ''}`} onClick={() => setActiveTab('orgchart')}>Org Chart</button>
        <button className={`admin-tab ${activeTab === 'settings' ? 'admin-tab-active' : ''}`} onClick={() => setActiveTab('settings')}>Payroll Settings</button>
        <button className={`admin-tab ${activeTab === 'custom_fields' ? 'admin-tab-active' : ''}`} onClick={() => { setActiveTab('custom_fields'); if (customFields.length === 0) loadCustomFields() }}>Custom Fields</button>
      </div>

      {activeTab === 'records' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 0, minHeight: 600 }}>
          {/* Left panel: letter nav + search + employee list */}
          <div style={{ flex: sidebarCollapsed ? '0 0 0px' : '0 0 320px', minWidth: 0, borderRight: sidebarCollapsed ? 'none' : '1px solid #e0e0e0', display: 'flex', flexDirection: 'column', overflow: 'hidden', transition: 'flex-basis 0.25s ease' }}>
            {/* Letter navigation */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, padding: '12px 12px 8px', borderBottom: '1px solid #f0f0f0' }}>
              <button
                onClick={() => setSelectedLetter(null)}
                style={{ width: 28, height: 28, border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 11, fontWeight: selectedLetter === null ? 700 : 500, background: selectedLetter === null ? '#1565c0' : 'transparent', color: selectedLetter === null ? '#fff' : '#666' }}
              >All</button>
              {'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(letter => (
                <button
                  key={letter}
                  onClick={() => setSelectedLetter(selectedLetter === letter ? null : letter)}
                  disabled={!availableLetters.has(letter)}
                  style={{ width: 28, height: 28, border: 'none', borderRadius: 4, cursor: availableLetters.has(letter) ? 'pointer' : 'default', fontSize: 12, fontWeight: selectedLetter === letter ? 700 : 500, background: selectedLetter === letter ? '#1565c0' : 'transparent', color: !availableLetters.has(letter) ? '#ccc' : selectedLetter === letter ? '#fff' : '#666', opacity: availableLetters.has(letter) ? 1 : 0.4 }}
                >{letter}</button>
              ))}
            </div>
            {/* Search */}
            <div style={{ padding: '8px 12px' }}>
              <input
                placeholder="Search by name..."
                value={recordsSearch}
                onChange={e => setRecordsSearch(e.target.value)}
                className="admin-input"
                style={{ width: '100%', fontSize: 13 }}
              />
            </div>
            {/* Employee list */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {loading ? <div style={{ padding: 20, textAlign: 'center', color: '#999' }}>Loading...</div> : (
                recordsFiltered.length === 0 ? <div style={{ padding: 20, textAlign: 'center', color: '#999' }}>No employees found</div> : (
                  recordsFiltered.map(emp => (
                    <div
                      key={emp.id}
                      onClick={() => setSelectedEmployeeId(emp.id)}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid #f5f5f5', background: selectedEmployeeId === emp.id ? '#e3f2fd' : 'transparent', transition: 'background 0.15s' }}
                    >
                      {emp.avatar_url ? (
                        <img src={emp.avatar_url} alt="" style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover' }} />
                      ) : (
                        <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#e0e7ff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600, color: '#3730a3' }}>
                          {emp.first_name[0]}{emp.last_name[0]}
                        </div>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{emp.first_name} {emp.last_name}</div>
                        <div style={{ fontSize: 11, color: '#888', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{emp.job_title || emp.department || 'No role assigned'}</div>
                      </div>
                      <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, fontWeight: 600, background: emp.is_active ? '#e8f5e9' : '#ffebee', color: emp.is_active ? '#2e7d32' : '#c62828' }}>
                        {emp.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                  ))
                )
              )}
            </div>
          </div>

          {/* Collapse/expand chevron */}
          <button
            onClick={() => setSidebarCollapsed(c => !c)}
            title={sidebarCollapsed ? 'Show employee list' : 'Hide employee list'}
            style={{
              width: 24, flexShrink: 0, border: 'none', borderRight: '1px solid #e0e0e0',
              background: '#f5f5f5', cursor: 'pointer', display: 'flex', alignItems: 'center',
              justifyContent: 'center', padding: 0, color: '#666', transition: 'background 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = '#e8e8e8')}
            onMouseLeave={e => (e.currentTarget.style.background = '#f5f5f5')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              style={{ transform: sidebarCollapsed ? 'rotate(180deg)' : 'none', transition: 'transform 0.25s ease' }}>
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>

          {/* Right panel: employee record detail */}
          <div style={{ flex: 1, overflowY: 'auto', background: '#fafafa' }}>
            {!selectedEmployee ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#999', fontSize: 14 }}>
                Select an employee to view their record
              </div>
            ) : (
              <div style={{ padding: 24 }}>
                {/* Navigation bar */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                  <button
                    onClick={() => navigateEmployee('prev')}
                    disabled={selectedIndex <= 0}
                    className="admin-action-btn"
                    style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: selectedIndex <= 0 ? 0.4 : 1 }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
                    Previous
                  </button>
                  <span style={{ fontSize: 12, color: '#888' }}>{selectedIndex + 1} of {alphabeticalEmployees.length}</span>
                  <button
                    onClick={() => navigateEmployee('next')}
                    disabled={selectedIndex >= alphabeticalEmployees.length - 1}
                    className="admin-action-btn"
                    style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: selectedIndex >= alphabeticalEmployees.length - 1 ? 0.4 : 1 }}
                  >
                    Next
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
                  </button>
                </div>

                {/* Profile header card */}
                <div style={{ background: '#fff', borderRadius: 10, padding: 24, marginBottom: 20, border: '1px solid #e8e8e8' }}>
                  <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    {/* Photo */}
                    <div style={{ flexShrink: 0 }}>
                      {selectedEmployee.avatar_url ? (
                        <img src={selectedEmployee.avatar_url} alt="" style={{ width: 100, height: 100, borderRadius: '50%', objectFit: 'cover', border: '3px solid #e0e7ff' }} />
                      ) : (
                        <div style={{ width: 100, height: 100, borderRadius: '50%', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, fontWeight: 700, color: '#fff' }}>
                          {selectedEmployee.first_name[0]}{selectedEmployee.last_name[0]}
                        </div>
                      )}
                    </div>
                    {/* Name and key info */}
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <h3 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#1a1a1a' }}>{selectedEmployee.first_name} {selectedEmployee.last_name}</h3>
                      <div style={{ fontSize: 14, color: '#666', marginTop: 4 }}>{selectedEmployee.job_title || '—'}</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                        <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 12, fontWeight: 600, background: selectedEmployee.is_active ? '#e8f5e9' : '#ffebee', color: selectedEmployee.is_active ? '#2e7d32' : '#c62828' }}>
                          {selectedEmployee.is_active ? 'Active' : 'Inactive'}
                        </span>
                        {selectedEmployee.contract_type && (
                          <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 12, fontWeight: 600, background: '#e3f2fd', color: '#1565c0' }}>{selectedEmployee.contract_type}</span>
                        )}
                        {selectedEmployee.is_admin && (
                          <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 12, fontWeight: 600, background: '#fff3e0', color: '#e65100' }}>Admin</span>
                        )}
                      </div>
                    </div>
                    {/* Key stats */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px', fontSize: 12 }}>
                      <div><span style={{ color: '#999', display: 'block' }}>Employee ID</span><strong>{selectedEmployee.employee_number}</strong></div>
                      <div><span style={{ color: '#999', display: 'block' }}>Department</span><strong>{selectedEmployee.department || '—'}</strong></div>
                      <div><span style={{ color: '#999', display: 'block' }}>Start Date</span><strong>{formatDate(selectedEmployee.start_date)}</strong></div>
                      <div><span style={{ color: '#999', display: 'block' }}>Service</span><strong>{calculateDuration(selectedEmployee.start_date)}</strong></div>
                      <div><span style={{ color: '#999', display: 'block' }}>Location</span><strong>{selectedEmployee.location || '—'}</strong></div>
                      <div><span style={{ color: '#999', display: 'block' }}>Manager</span><strong>{selectedEmployee.manager_name || '—'}</strong></div>
                      {features.inflowonboarder_integration && (
                        <div><span style={{ color: '#999', display: 'block' }}>Persona</span><strong style={{ textTransform: 'capitalize' }}>{(selectedEmployee.persona || 'standard').replace('_', ' ')}</strong></div>
                      )}
                    </div>
                  </div>
                </div>

                <EmployeeRecordModules
                  employee={selectedEmployee}
                  companyId={selectedCompanyId}
                  lieuDays={lieuDays[selectedEmployee.id]?.lieu_days ?? 0}
                  maskValue={maskValue}
                  toggleReveal={toggleReveal}
                  formatDate={formatDate}
                  contractedDays={selectedEmployee.contracted_days}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'orgchart' && (
        <OrgChart employees={employees} />
      )}

      {activeTab === 'settings' && (
        <div className="admin-settings-section">
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="1.5" style={{ marginBottom: 16 }}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>Payroll Settings have moved</h3>
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
              Pay patterns, overtime handling, and worker type settings are now managed from the Payroll dashboard.
            </p>
            <button className="admin-btn admin-btn-primary" onClick={() => navigate('/admin/payroll')}>
              Go to Payroll Settings →
            </button>
          </div>
        </div>
      )}

      {activeTab === 'custom_fields' && (
        <div className="admin-settings-section">
          <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
            Define up to 5 custom profile fields for your employees. Set a title, choose short (single line) or long (multi-line) format,
            optionally set a default value, and toggle visibility. Visible fields appear in employee records and in the employee HR app.
          </p>

          {customFieldsLoading ? (
            <p style={{ fontSize: 13, color: '#999' }}>Loading...</p>
          ) : (
            <>
              <div style={{ display: 'grid', gap: 16 }}>
                {customFields.map((f, idx) => (
                  <div key={f.field_number} style={{ background: '#fff', borderRadius: 10, border: '1px solid #e0e0e0', padding: 20 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: '#333' }}>Field {f.field_number}</span>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                        <input type="checkbox" checked={f.is_visible}
                          onChange={e => setCustomFields(prev => prev.map((p, i) => i === idx ? { ...p, is_visible: e.target.checked } : p))}
                        />
                        Visible to employees
                      </label>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 12, marginBottom: 12 }}>
                      <div>
                        <label style={{ fontSize: 12, fontWeight: 600, color: '#555', display: 'block', marginBottom: 4 }}>Title</label>
                        <input type="text" value={f.title} placeholder={`e.g. Custom Field ${f.field_number}`}
                          onChange={e => setCustomFields(prev => prev.map((p, i) => i === idx ? { ...p, title: e.target.value } : p))}
                          style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13 }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: 12, fontWeight: 600, color: '#555', display: 'block', marginBottom: 4 }}>Field Type</label>
                        <select value={f.field_type}
                          onChange={e => setCustomFields(prev => prev.map((p, i) => i === idx ? { ...p, field_type: e.target.value as 'short' | 'long' } : p))}
                          style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13 }}
                        >
                          <option value="short">Short (single line)</option>
                          <option value="long">Long (multi-line)</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, color: '#555', display: 'block', marginBottom: 4 }}>Default Value (optional)</label>
                      {f.field_type === 'long' ? (
                        <textarea value={f.default_value} placeholder="Leave blank or set a default..."
                          onChange={e => setCustomFields(prev => prev.map((p, i) => i === idx ? { ...p, default_value: e.target.value } : p))}
                          rows={3}
                          style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13, resize: 'vertical' }}
                        />
                      ) : (
                        <input type="text" value={f.default_value} placeholder="Leave blank or set a default..."
                          onChange={e => setCustomFields(prev => prev.map((p, i) => i === idx ? { ...p, default_value: e.target.value } : p))}
                          style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13 }}
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                <button className="admin-btn admin-btn-primary" onClick={saveCustomFields} disabled={customFieldsSaving}>
                  {customFieldsSaving ? 'Saving...' : 'Save Custom Fields'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {activeTab === 'management' && <>
      <div className="admin-filters">
        <input placeholder="Search name, email, ID..." value={search} onChange={e => setSearch(e.target.value)} className="admin-input admin-search" />
        <select value={filterDept} onChange={e => setFilterDept(e.target.value)} className="admin-select">
          <option value="">All Departments</option>
          {departments.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={filterActive} onChange={e => setFilterActive(e.target.value)} className="admin-select">
          <option value="">All</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {loading ? <div className="admin-loading">Loading...</div> : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>ID</th><th>Name</th><th>Email</th><th>Department</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {paginated.map(emp => (
                <>
                  <tr key={emp.id} className={expandedId === emp.id ? 'admin-row-active' : ''}>
                    <td className="admin-td-mono">{emp.employee_number}</td>
                    <td>{editingId === emp.id ? (
                      <div className="admin-name-inputs">
                        <input className="admin-inline-input" value={editForm.first_name} onChange={e => setEditForm(f => ({...f, first_name: e.target.value}))} placeholder="First" />
                        <input className="admin-inline-input" value={editForm.last_name} onChange={e => setEditForm(f => ({...f, last_name: e.target.value}))} placeholder="Last" />
                      </div>
                    ) : <span className="admin-inline-avatar">{emp.avatar_url ? <img src={emp.avatar_url} alt="" /> : <span className="admin-avatar-initials">{emp.first_name[0]}{emp.last_name[0]}</span>}{emp.first_name} {emp.last_name}</span>}</td>
                    <td>{editingId === emp.id ? <input className="admin-inline-input" value={editForm.email} onChange={e => setEditForm(f => ({...f, email: e.target.value}))} /> : emp.email}</td>
                    <td>{editingId === emp.id ? <input className="admin-inline-input" value={editForm.department} onChange={e => setEditForm(f => ({...f, department: e.target.value}))} /> : (emp.department || '—')}</td>
                    <td>{editingId === emp.id ? <input className="admin-inline-input" value={editForm.job_title} onChange={e => setEditForm(f => ({...f, job_title: e.target.value}))} /> : (emp.job_title || '—')}</td>
                    <td>
                      <span className={`admin-badge ${emp.is_active ? 'admin-badge-approved' : 'admin-badge-rejected'}`}>{emp.is_active ? 'Active' : 'Inactive'}</span>
                      {setupMap[emp.email?.toLowerCase()] === false && (
                        <span style={{ display: 'inline-block', marginLeft: 6, fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: '#fff3e0', color: '#e65100' }}>Not logged in</span>
                      )}
                    </td>
                    <td className="admin-actions">
                      {editingId === emp.id ? (
                        <>
                          <button className="admin-btn-sm admin-btn-save" onClick={() => saveEdit(emp.id)}>Save</button>
                          <button className="admin-btn-sm admin-btn-cancel" onClick={() => setEditingId(null)}>Cancel</button>
                        </>
                      ) : (
                        <>
                          <button className="admin-btn-icon" onClick={() => setExpandedId(expandedId === emp.id ? null : emp.id)}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points={expandedId === emp.id ? "18 15 12 9 6 15" : "6 9 12 15 18 9"}/></svg>
                          </button>
                          <button className="admin-btn-icon" onClick={() => startEdit(emp)}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                          </button>
                          <button className="admin-btn-icon" title="Deactivate" onClick={() => deactivateEmployee(emp.id)}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
                          </button>
                          <button className="admin-btn-icon admin-btn-danger" title="Delete permanently" onClick={() => permanentlyDeleteEmployee(emp)}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                  {expandedId === emp.id && (
                    <tr key={`exp-${emp.id}`} className="admin-expanded-row">
                      <td colSpan={7}>
                        <div className="admin-expanded-content" style={{display:'flex', gap:'20px', alignItems:'flex-start'}}>
                          <div className="admin-photo-section">
                            <div className="admin-photo-preview">
                              {emp.avatar_url ? (
                                <img src={emp.avatar_url} alt={`${emp.first_name} ${emp.last_name}`} className="admin-photo-img" />
                              ) : (
                                <div className="admin-photo-placeholder">
                                  <span>{emp.first_name[0]}{emp.last_name[0]}</span>
                                </div>
                              )}
                            </div>
                            <div className="admin-photo-actions">
                              <label className="admin-btn-sm admin-btn-save admin-photo-upload-label">
                                {uploading === emp.id ? 'Uploading...' : emp.avatar_url ? 'Change Photo' : 'Upload Photo'}
                                <input type="file" accept="image/*" style={{display:'none'}} disabled={uploading === emp.id}
                                  onChange={e => { const f = e.target.files?.[0]; if (f) uploadPhoto(emp, f); e.target.value = '' }} />
                              </label>
                              {emp.avatar_url && (
                                <button className="admin-btn-sm admin-btn-cancel" onClick={() => removePhoto(emp)}>Remove</button>
                              )}
                            </div>
                          </div>
                          <div style={{flex:1}}>
                            {editingId === emp.id ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                                <fieldset style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 16 }}>
                                  <legend style={{ fontWeight: 700, fontSize: 13, color: '#1565c0' }}>Personal Details</legend>
                                  <div className="admin-detail-grid admin-detail-grid-3">
                                    {[
                                      { k: 'date_of_birth', l: 'Date of Birth', t: 'date' },
                                      { k: 'gender', l: 'Gender', t: 'select', opts: ['', 'Male', 'Female', 'Non-binary', 'Prefer not to say'] },
                                      { k: 'nationality', l: 'Nationality' },
                                      { k: 'marital_status', l: 'Marital Status', t: 'select', opts: ['', 'Single', 'Married', 'Civil Partnership', 'Divorced', 'Widowed', 'Prefer not to say'] },
                                      { k: 'religion', l: 'Religion' },
                                      { k: 'ni_number', l: 'NI Number' },
                                      { k: 'personal_email', l: 'Personal Email' },
                                    ].map(f => (
                                      <div key={f.k} className="admin-form-field">
                                        <label style={{ fontSize: 12 }}>{f.l}</label>
                                        {f.t === 'select' ? (
                                          <select className="admin-select" value={editForm[f.k] || ''} onChange={e => setEditForm(p => ({...p, [f.k]: e.target.value}))}>
                                            {f.opts!.map(o => <option key={o} value={o}>{o || '—'}</option>)}
                                          </select>
                                        ) : (
                                          <input className="admin-inline-input" type={f.t || 'text'} value={editForm[f.k] || ''} onChange={e => setEditForm(p => ({...p, [f.k]: e.target.value}))} />
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </fieldset>
                                <fieldset style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 16 }}>
                                  <legend style={{ fontWeight: 700, fontSize: 13, color: '#1565c0' }}>Address</legend>
                                  <div className="admin-detail-grid admin-detail-grid-3">
                                    {[
                                      { k: 'address_line1', l: 'Address Line 1' }, { k: 'address_line2', l: 'Address Line 2' },
                                      { k: 'city', l: 'City' }, { k: 'county', l: 'County' },
                                      { k: 'postcode', l: 'Postcode' }, { k: 'country', l: 'Country' },
                                    ].map(f => (
                                      <div key={f.k} className="admin-form-field">
                                        <label style={{ fontSize: 12 }}>{f.l}</label>
                                        <input className="admin-inline-input" value={editForm[f.k] || ''} onChange={e => setEditForm(p => ({...p, [f.k]: e.target.value}))} />
                                      </div>
                                    ))}
                                  </div>
                                </fieldset>
                                <fieldset style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 16 }}>
                                  <legend style={{ fontWeight: 700, fontSize: 13, color: '#1565c0' }}>Employment</legend>
                                  {(() => {
                                    const cat = editForm.employment_category || 'not_assigned'
                                    const ct = editForm.contract_type || ''
                                    const isContractor = cat === 'contractor'
                                    const isZeroHours = cat === 'shift_worker' && ct === 'Zero hours shift worker'

                                    const contractOpts = cat === 'employed'
                                      ? ['', 'Full-time', 'Part-time', 'Student', 'Temporary']
                                      : cat === 'shift_worker'
                                      ? ['', 'Full-time shift worker', 'Part-time shift worker', 'Weekends shift worker', 'Zero hours shift worker']
                                      : ['']

                                    const showField = (field: string) => {
                                      if (isZeroHours) return ['location', 'contract_type', 'manager_name', 'manager_email'].includes(field)
                                      if (isContractor) return !['contract_type', 'probation_end_date', 'notice_period', 'leave_allowance', 'salary_group', 'lieu_days', 'contracted_days'].includes(field)
                                      return true
                                    }

                                    function handleCategoryChange(newCat: string) {
                                      const u: Record<string, any> = { employment_category: newCat, contract_type: '' }
                                      if (newCat === 'not_assigned') {
                                        Object.assign(u, { weekly_hours: '', probation_end_date: '', notice_period: '', manager_name: '', manager_email: '', leave_allowance: '', salary_group: '', location: '' })
                                        setEditLieuDays(0)
                                      } else if (newCat === 'contractor') {
                                        Object.assign(u, { probation_end_date: '', notice_period: '', leave_allowance: '', salary_group: '' })
                                        setEditLieuDays(0)
                                      } else if (newCat === 'shift_worker') {
                                        u.contracted_days = null
                                      }
                                      setEditForm(p => ({ ...p, ...u }))
                                    }

                                    function handleContractChange(newCt: string) {
                                      const u: Record<string, any> = { contract_type: newCt }
                                      if (cat === 'shift_worker' && newCt === 'Zero hours shift worker') {
                                        Object.assign(u, { weekly_hours: '', probation_end_date: '', notice_period: '', leave_allowance: '', salary_group: '' })
                                        setEditLieuDays(0)
                                      }
                                      setEditForm(p => ({ ...p, ...u }))
                                    }

                                    return (
                                      <>
                                      <div className="admin-detail-grid admin-detail-grid-3">
                                        <div className="admin-form-field">
                                          <label style={{ fontSize: 12 }}>Work Pattern</label>
                                          <select className="admin-select" value={cat} onChange={e => handleCategoryChange(e.target.value)}>
                                            <option value="not_assigned">Not Assigned</option>
                                            <option value="employed">Employed</option>
                                            <option value="shift_worker">Shift Worker</option>
                                            <option value="contractor">Contractor</option>
                                          </select>
                                        </div>
                                        <div className="admin-form-field">
                                          <label style={{ fontSize: 12 }}>Start Date</label>
                                          <input className="admin-inline-input" type="date" value={editForm.start_date || ''} onChange={e => setEditForm(p => ({...p, start_date: e.target.value}))} />
                                        </div>
                                        {showField('location') && (
                                          <div className="admin-form-field">
                                            <label style={{ fontSize: 12 }}>Work Location</label>
                                            <input className="admin-inline-input" value={editForm.location || ''} onChange={e => setEditForm(p => ({...p, location: e.target.value}))} />
                                          </div>
                                        )}
                                        {showField('contract_type') && (
                                          <div className="admin-form-field">
                                            <label style={{ fontSize: 12 }}>Contract Type</label>
                                            <select className="admin-select" value={editForm.contract_type || ''} onChange={e => handleContractChange(e.target.value)} disabled={isZeroHours}>
                                              {contractOpts.map(o => <option key={o} value={o}>{o || '—'}</option>)}
                                            </select>
                                          </div>
                                        )}
                                        {showField('contracted_days') && (
                                          <div className="admin-form-field" style={{ gridColumn: 'span 2' }}>
                                            <label style={{ fontSize: 12 }}>Contracted Days {cat === 'shift_worker' ? '(variable — any day)' : ''}</label>
                                            {cat === 'shift_worker' ? (
                                              <span style={{ fontSize: 12, color: '#6b7280' }}>Shift workers can work any day — managed via rotas</span>
                                            ) : (
                                              <div style={{ display: 'flex', gap: 4 }}>
                                                {DAY_LABELS.map((d, i) => (
                                                  <button key={d} type="button" onClick={() => setEditForm(p => { const days = [...(p.contracted_days || [true,true,true,true,true,false,false])]; days[i] = !days[i]; return {...p, contracted_days: days} })}
                                                    style={{ width: 36, height: 32, border: (editForm.contracted_days || [true,true,true,true,true,false,false])[i] ? '2px solid #1565c0' : '1px solid #ccc', borderRadius: 6, background: (editForm.contracted_days || [true,true,true,true,true,false,false])[i] ? '#e3f2fd' : '#fff', color: (editForm.contracted_days || [true,true,true,true,true,false,false])[i] ? '#1565c0' : '#999', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>{d}</button>
                                                ))}
                                              </div>
                                            )}
                                          </div>
                                        )}
                                        {showField('weekly_hours') && (
                                          <div className="admin-form-field">
                                            <label style={{ fontSize: 12 }}>Weekly Hours</label>
                                            <input className="admin-inline-input" type="number" value={editForm.weekly_hours ?? ''} onChange={e => setEditForm(p => ({...p, weekly_hours: e.target.value}))} />
                                          </div>
                                        )}
                                        {showField('probation_end_date') && (
                                          <div className="admin-form-field">
                                            <label style={{ fontSize: 12 }}>Probation End Date</label>
                                            <input className="admin-inline-input" type="date" value={editForm.probation_end_date || ''} onChange={e => setEditForm(p => ({...p, probation_end_date: e.target.value}))} />
                                          </div>
                                        )}
                                        {showField('notice_period') && (
                                          <div className="admin-form-field">
                                            <label style={{ fontSize: 12 }}>Notice Period</label>
                                            <input className="admin-inline-input" value={editForm.notice_period || ''} onChange={e => setEditForm(p => ({...p, notice_period: e.target.value}))} />
                                          </div>
                                        )}
                                        {showField('manager_name') && (
                                          <div className="admin-form-field">
                                            <label style={{ fontSize: 12 }}>Manager Name</label>
                                            <input className="admin-inline-input" value={editForm.manager_name || ''} onChange={e => setEditForm(p => ({...p, manager_name: e.target.value}))} />
                                          </div>
                                        )}
                                        {showField('manager_email') && (
                                          <div className="admin-form-field">
                                            <label style={{ fontSize: 12 }}>Manager Email</label>
                                            <input className="admin-inline-input" value={editForm.manager_email || ''} onChange={e => setEditForm(p => ({...p, manager_email: e.target.value}))} />
                                          </div>
                                        )}
                                        {features.inflowonboarder_integration && (
                                          <div className="admin-form-field">
                                            <label style={{ fontSize: 12 }}>Persona Tier</label>
                                            <select className="admin-select" value={editForm.persona || 'standard'} onChange={e => setEditForm(p => ({...p, persona: e.target.value}))}>
                                              <option value="standard">Standard Information Worker</option>
                                              <option value="mobile">Mobile / Field Worker</option>
                                              <option value="strict_secure">Strict Secure / VIP</option>
                                              <option value="kiosk">Shared / Kiosk</option>
                                            </select>
                                          </div>
                                        )}
                                        {showField('leave_allowance') && (
                                          <div className="admin-form-field">
                                            <label style={{ fontSize: 12 }}>Leave Allowance (Days)</label>
                                            <input className="admin-inline-input" type="number" value={editForm.leave_allowance ?? ''} onChange={e => setEditForm(p => ({...p, leave_allowance: e.target.value}))} />
                                          </div>
                                        )}
                                        {showField('salary_group') && (
                                          <div className="admin-form-field">
                                            <label style={{ fontSize: 12 }}>Salary Group</label>
                                            <input className="admin-inline-input" value={editForm.salary_group || ''} onChange={e => setEditForm(p => ({...p, salary_group: e.target.value}))} />
                                          </div>
                                        )}
                                        {showField('lieu_days') && (
                                          <div className="admin-form-field">
                                            <label style={{ fontSize: 12 }}>Lieu Days</label>
                                            <input className="admin-inline-input" type="number" min="0" step="0.5" value={editLieuDays} onChange={e => setEditLieuDays(parseFloat(e.target.value) || 0)} />
                                          </div>
                                        )}
                                      </div>
                                      {cat !== 'not_assigned' && cat !== 'contractor' && (
                                        <div style={{ marginTop: 16, padding: 12, background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb' }}>
                                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                                            <span style={{ fontSize: 12, fontWeight: 700, color: '#374151' }}>Payroll Overrides</span>
                                            {editForm.is_payroll_exception && (
                                              <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: '#fef3c7', color: '#92400e' }}>Exception</span>
                                            )}
                                          </div>
                                          <p style={{ fontSize: 11, color: '#6b7280', margin: '0 0 8px' }}>
                                            Leave blank to use company defaults. Setting a value makes this employee an exception.
                                          </p>
                                          <div className="admin-detail-grid admin-detail-grid-3">
                                            <div className="admin-form-field">
                                              <label style={{ fontSize: 12 }}>Pay Pattern Override</label>
                                              <select className="admin-select" value={editForm.pay_pattern_override || ''} onChange={e => {
                                                const val = e.target.value || null
                                                setEditForm(p => ({ ...p, pay_pattern_override: val, is_payroll_exception: !!(val || p.overtime_handling_override || p.time_recording_override) }))
                                              }}>
                                                <option value="">Use company default</option>
                                                <option value="weekly">Weekly</option>
                                                <option value="bi_weekly">Bi-weekly</option>
                                                <option value="monthly">Monthly</option>
                                              </select>
                                            </div>
                                            <div className="admin-form-field">
                                              <label style={{ fontSize: 12 }}>Overtime Override</label>
                                              <select className="admin-select" value={editForm.overtime_handling_override || ''} onChange={e => {
                                                const val = e.target.value || null
                                                setEditForm(p => ({ ...p, overtime_handling_override: val, is_payroll_exception: !!(p.pay_pattern_override || val || p.time_recording_override) }))
                                              }}>
                                                <option value="">Use company default</option>
                                                <option value="none">None</option>
                                                <option value="overtime">Overtime (Paid)</option>
                                                <option value="toil">TOIL</option>
                                              </select>
                                            </div>
                                            {cat === 'shift_worker' && (
                                              <div className="admin-form-field">
                                                <label style={{ fontSize: 12 }}>Time Recording Override</label>
                                                <select className="admin-select" value={editForm.time_recording_override || ''} onChange={e => {
                                                  const val = e.target.value || null
                                                  setEditForm(p => ({ ...p, time_recording_override: val, is_payroll_exception: !!(p.pay_pattern_override || p.overtime_handling_override || val) }))
                                                }}>
                                                  <option value="">Use company default</option>
                                                  <option value="checkin">Check-in</option>
                                                  <option value="timesheet">Timesheets</option>
                                                </select>
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                      )}
                                      </>
                                    )
                                  })()}
                                </fieldset>
                                <fieldset style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 16 }}>
                                  <legend style={{ fontWeight: 700, fontSize: 13, color: '#1565c0' }}>Qualifications</legend>
                                  <div className="admin-form-field">
                                    <label style={{ fontSize: 12 }}>Qualifications</label>
                                    <textarea className="admin-inline-input" rows={4} value={editForm.qualifications || ''} onChange={e => setEditForm(p => ({...p, qualifications: e.target.value}))} style={{ resize: 'vertical', fontFamily: 'inherit' }} />
                                  </div>
                                </fieldset>
                                <fieldset style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 16 }}>
                                  <legend style={{ fontWeight: 700, fontSize: 13, color: '#1565c0' }}>Payroll</legend>
                                  <div className="admin-detail-grid admin-detail-grid-3">
                                    {[
                                      { k: 'annual_salary', l: `Annual Salary (${currencySymbol(currency)})`, t: 'number' },
                                      { k: 'tax_code', l: 'Tax Code' },
                                      { k: 'payroll_id', l: 'Payroll ID' },
                                    ].map(f => (
                                      <div key={f.k} className="admin-form-field">
                                        <label style={{ fontSize: 12 }}>{f.l}</label>
                                        <input className="admin-inline-input" type={f.t || 'text'} value={editForm[f.k] ?? ''} onChange={e => setEditForm(p => ({...p, [f.k]: e.target.value}))} />
                                      </div>
                                    ))}
                                    {editForm.employment_category === 'shift_worker' && (
                                      <div className="admin-form-field">
                                        <label style={{ fontSize: 12 }}>Hourly Rate ({currencySymbol(currency)})</label>
                                        <input className="admin-inline-input" type="number" step="0.01" value={editForm.hourly_rate ?? ''} onChange={e => setEditForm(p => ({...p, hourly_rate: e.target.value}))} />
                                      </div>
                                    )}
                                  </div>
                                </fieldset>
                                <fieldset style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 16 }}>
                                  <legend style={{ fontWeight: 700, fontSize: 13, color: '#1565c0' }}>Emergency Contact</legend>
                                  <div className="admin-detail-grid admin-detail-grid-3">
                                    {[
                                      { k: 'emergency_contact_name', l: 'Contact Name' },
                                      { k: 'emergency_contact_phone', l: 'Contact Phone' },
                                      { k: 'emergency_contact_relationship', l: 'Relationship' },
                                    ].map(f => (
                                      <div key={f.k} className="admin-form-field">
                                        <label style={{ fontSize: 12 }}>{f.l}</label>
                                        <input className="admin-inline-input" value={editForm[f.k] || ''} onChange={e => setEditForm(p => ({...p, [f.k]: e.target.value}))} />
                                      </div>
                                    ))}
                                  </div>
                                </fieldset>
                                <fieldset style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 16 }}>
                                  <legend style={{ fontWeight: 700, fontSize: 13, color: '#1565c0' }}>Bank Details</legend>
                                  <div className="admin-detail-grid admin-detail-grid-3">
                                    {[
                                      { k: 'bank_account_name', l: 'Account Name' },
                                      { k: 'bank_sort_code', l: 'Sort Code' },
                                      { k: 'bank_account_number', l: 'Account Number' },
                                    ].map(f => (
                                      <div key={f.k} className="admin-form-field">
                                        <label style={{ fontSize: 12 }}>{f.l}</label>
                                        <input className="admin-inline-input" value={editForm[f.k] || ''} onChange={e => setEditForm(p => ({...p, [f.k]: e.target.value}))} />
                                      </div>
                                    ))}
                                  </div>
                                </fieldset>
                              </div>
                            ) : (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                <div className="admin-detail-grid admin-detail-grid-3">
                                  <div><strong>Phone:</strong> {emp.phone || '—'}</div>
                                  <div><strong>Start Date:</strong> {emp.start_date ? new Date(emp.start_date).toLocaleDateString('en-GB') : '—'}</div>
                                  <div><strong>Admin:</strong> {emp.is_admin ? 'Yes' : 'No'}</div>
                                  <div><strong>Employee ID:</strong> {emp.employee_number}</div>
                                  <div><strong>Location:</strong> {emp.location || '—'}</div>
                                  <div><strong>Contract:</strong> {emp.contract_type || '—'}</div>
                                  <div><strong>DOB:</strong> {emp.date_of_birth ? new Date(emp.date_of_birth).toLocaleDateString('en-GB') : '—'}</div>
                                  <div><strong>Gender:</strong> {emp.gender || '—'}</div>
                                  <div><strong>Nationality:</strong> {emp.nationality || '—'}</div>
                                  <div><strong>Marital Status:</strong> {emp.marital_status || '—'}</div>
                                  <div><strong>Religion:</strong> {emp.religion || '—'}</div>
                                  <div><strong>NI Number:</strong> <span onClick={() => toggleReveal(emp.id, 'ni')} style={{ cursor: 'pointer' }} title="Click to reveal">{maskValue(emp.ni_number, emp.id, 'ni')}</span></div>
                                  <div><strong>Personal Email:</strong> {emp.personal_email || '—'}</div>
                                </div>
                                {(emp.address_line1 || emp.city || emp.postcode) && (
                                  <div>
                                    <strong>Address:</strong> {[emp.address_line1, emp.address_line2, emp.city, emp.county, emp.postcode, emp.country].filter(Boolean).join(', ') || '—'}
                                  </div>
                                )}
                                <div className="admin-detail-grid admin-detail-grid-3">
                                  <div><strong>Work Pattern:</strong> {({ not_assigned: 'Not Assigned', employed: 'Employed', shift_worker: 'Shift Worker', contractor: 'Contractor' } as Record<string, string>)[emp.employment_category] || 'Not Assigned'}</div>
                                  <div><strong>Contract:</strong> {emp.contract_type || '—'}</div>
                                  <div><strong>Location:</strong> {emp.location || '—'}</div>
                                  {emp.employment_category !== 'contractor' && <div><strong>Weekly Hours:</strong> {emp.weekly_hours ?? '—'}</div>}
                                  {emp.employment_category !== 'contractor' && <div><strong>Notice Period:</strong> {emp.notice_period || '—'}</div>}
                                  {emp.employment_category !== 'contractor' && <div><strong>Probation End:</strong> {emp.probation_end_date ? new Date(emp.probation_end_date).toLocaleDateString('en-GB') : '—'}</div>}
                                  <div><strong>Manager:</strong> {emp.manager_name || '—'}</div>
                                  <div><strong>Manager Email:</strong> {emp.manager_email || '—'}</div>
                                  {emp.employment_category !== 'contractor' && <div><strong>Leave Allowance:</strong> {emp.leave_allowance ?? 15} days</div>}
                                  {emp.employment_category !== 'contractor' && <div><strong>Lieu Days:</strong> {lieuDays[emp.id]?.lieu_days ?? 0} days</div>}
                                  {emp.employment_category !== 'contractor' && <div><strong>Salary Group:</strong> {emp.salary_group || 'N/A'}</div>}
                                  <div><strong>Contracted Days:</strong> {emp.employment_category === 'shift_worker' ? 'Variable (any day)' : emp.contracted_days ? emp.contracted_days.map((d, i) => d ? DAY_LABELS[i] : null).filter(Boolean).join(', ') : 'Mon–Fri'}</div>
                                  {emp.employment_category !== 'not_assigned' && emp.employment_category !== 'contractor' && (
                                    <>
                                      <div><strong>Pay Pattern:</strong> {(getEffectiveSetting(emp, 'pay_pattern') || '').replace('_', '-')} {emp.pay_pattern_override && <span style={{ fontSize: 10, color: '#92400e' }}>(override)</span>}</div>
                                      <div><strong>Overtime:</strong> {(getEffectiveSetting(emp, 'overtime_handling') || 'none').replace('_', ' ')} {emp.overtime_handling_override && <span style={{ fontSize: 10, color: '#92400e' }}>(override)</span>}</div>
                                      {emp.employment_category === 'shift_worker' && (
                                        <div><strong>Time Recording:</strong> {getEffectiveSetting(emp, 'time_recording') === 'checkin' ? 'Check-in' : 'Timesheets'} {emp.time_recording_override && <span style={{ fontSize: 10, color: '#92400e' }}>(override)</span>}</div>
                                      )}
                                    </>
                                  )}
                                </div>
                                {emp.qualifications && (
                                  <div>
                                    <strong>Qualifications:</strong> <span style={{ whiteSpace: 'pre-line' }}>{emp.qualifications}</span>
                                  </div>
                                )}
                                <div className="admin-detail-grid admin-detail-grid-3">
                                  <div><strong>Salary:</strong> {emp.annual_salary ? `${currencySymbol(currency)}${Number(emp.annual_salary).toLocaleString()}` : '—'}</div>
                                  {emp.employment_category === 'shift_worker' && (
                                    <div><strong>Hourly Rate:</strong> {emp.hourly_rate ? `${currencySymbol(currency)}${Number(emp.hourly_rate).toFixed(2)}` : '—'}</div>
                                  )}
                                  <div><strong>Tax Code:</strong> {emp.tax_code || '—'}</div>
                                  <div><strong>Payroll ID:</strong> {emp.payroll_id || '—'}</div>
                                </div>
                                {emp.emergency_contact_name && (
                                  <div className="admin-detail-grid admin-detail-grid-3">
                                    <div><strong>Emergency Contact:</strong> {emp.emergency_contact_name}</div>
                                    <div><strong>Emergency Phone:</strong> {emp.emergency_contact_phone || '—'}</div>
                                    <div><strong>Relationship:</strong> {emp.emergency_contact_relationship || '—'}</div>
                                  </div>
                                )}
                                {emp.bank_account_name && (
                                  <div className="admin-detail-grid admin-detail-grid-3">
                                    <div><strong>Bank Account:</strong> {emp.bank_account_name}</div>
                                    <div><strong>Sort Code:</strong> <span onClick={() => toggleReveal(emp.id, 'sc')} style={{ cursor: 'pointer' }} title="Click to reveal">{maskValue(emp.bank_sort_code, emp.id, 'sc')}</span></div>
                                    <div><strong>Account No:</strong> <span onClick={() => toggleReveal(emp.id, 'ac')} style={{ cursor: 'pointer' }} title="Click to reveal">{maskValue(emp.bank_account_number, emp.id, 'ac')}</span></div>
                                  </div>
                                )}
                                {features.skills_passport && empSkills[emp.id]?.length > 0 && (
                                  <div>
                                    <strong style={{ display: 'block', marginBottom: 6 }}>Skills</strong>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                      {empSkills[emp.id].map(s => {
                                        const statusColors: Record<string, { bg: string; color: string }> = {
                                          validated: { bg: '#e0e7ff', color: '#3730a3' },
                                          self_declared: { bg: '#f3e5f5', color: '#7b1fa2' },
                                          pending_validation: { bg: '#fff3e0', color: '#e65100' },
                                        }
                                        const sc = statusColors[s.status] || statusColors.self_declared
                                        return (
                                          <span key={s.skill_name} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 12, fontSize: 12, background: sc.bg, color: sc.color }}>
                                            {s.skill_name}
                                            <span style={{ fontSize: 10, opacity: 0.7 }}>
                                              ({['','Foundational','Developing','Proficient','Advanced','Expert'][s.proficiency]})
                                            </span>
                                            {s.status !== 'validated' && <span style={{ fontSize: 9, textTransform: 'uppercase', opacity: 0.6 }}>{s.status.replace('_', ' ')}</span>}
                                          </span>
                                        )
                                      })}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <div className="admin-empty">No employees found</div>}
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 12 }}>
              <button className="admin-action-btn" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</button>
              <span style={{ fontSize: 13 }}>Page {page} of {totalPages}</span>
              <button className="admin-action-btn" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</button>
            </div>
          )}
        </div>
      )}
      </>}

      {moverPrompt && (
        <div className="my-profile-modal-overlay" onClick={() => setMoverPrompt(null)}>
          <div className="my-profile-cr-modal" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <div className="my-profile-modal-header" style={{ background: '#e65100', justifyContent: 'space-between', padding: '14px 20px' }}>
              <span className="my-profile-modal-dept" style={{ fontSize: 16 }}>Role Change Detected</span>
              <button onClick={() => setMoverPrompt(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div style={{ padding: 20 }}>
              <p style={{ fontSize: 14, marginBottom: 12 }}>
                <strong>{moverPrompt.empName}</strong>'s details have changed. Would you like to start a role change to update their Microsoft 365 account?
              </p>
              <div style={{ background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 13 }}>
                {Object.entries(moverPrompt.changes).map(([label, val]) => (
                  <div key={label} style={{ marginBottom: 4 }}>
                    <strong>{label}:</strong> {val.old || '(none)'} → {val.new || '(none)'}
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => {
                  const empId = moverPrompt.empId
                  const emp = employees.find(e => e.id === empId)
                  setMoverPrompt(null)
                  if (emp) navigate('/admin/onboarding', { state: { tab: 'movers', moverEmployee: { id: emp.id, name: `${emp.first_name} ${emp.last_name}`, email: emp.email, changes: moverPrompt.changes } } })
                }}
                  style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: 'none', background: '#e65100', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                  Yes — Go to Movers
                </button>
                <button onClick={() => setMoverPrompt(null)}
                  style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: '1px solid #ccc', background: '#fff', color: '#333', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                  No — HR Record Only
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── Interactive Org Chart ─── */

const DEPT_COLORS: Record<string, string> = {
  'Human Resources': '#7c3aed',
  'Engineering': '#2563eb',
  'Marketing': '#d97706',
  'Sales': '#059669',
  'Finance': '#dc2626',
  'Operations': '#0891b2',
  'IT': '#4f46e5',
  'Legal': '#6b7280',
  'Design': '#ec4899',
  'Customer Support': '#f59e0b',
}

function getDeptColor(dept: string | null): string {
  if (!dept) return '#6b7280'
  return DEPT_COLORS[dept] || '#' + (
    Array.from(dept).reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0) >>> 0
  ).toString(16).slice(0, 6).padStart(6, '5')
}

interface OrgNode {
  employee: Employee
  children: OrgNode[]
  x: number
  y: number
}

const NODE_W = 200
const NODE_H = 80
const H_GAP = 32
const V_GAP = 60

function buildTree(employees: Employee[]): OrgNode[] {
  const byId = new Map(employees.map(e => [e.id, e]))
  const childrenMap = new Map<string | null, Employee[]>()
  employees.forEach(e => {
    const pid = e.manager_id
    if (!childrenMap.has(pid)) childrenMap.set(pid, [])
    childrenMap.get(pid)!.push(e)
  })

  function makeNode(emp: Employee): OrgNode {
    const kids = (childrenMap.get(emp.id) || []).map(makeNode)
    return { employee: emp, children: kids, x: 0, y: 0 }
  }

  const roots = (childrenMap.get(null) || []).map(makeNode)
  const orphanRoots = employees.filter(e => e.manager_id && !byId.has(e.manager_id))
  orphanRoots.forEach(e => {
    if (!roots.find(r => r.employee.id === e.id)) {
      roots.push(makeNode(e))
    }
  })
  return roots
}

function layoutTree(node: OrgNode, expandedIds: Set<string>, depth: number): number {
  node.y = depth * (NODE_H + V_GAP)
  const visibleChildren = expandedIds.has(node.employee.id) ? node.children : []

  if (visibleChildren.length === 0) {
    return NODE_W
  }

  let totalWidth = 0
  const childWidths: number[] = []
  visibleChildren.forEach((child, i) => {
    const w = layoutTree(child, expandedIds, depth + 1)
    childWidths.push(w)
    totalWidth += w
    if (i < visibleChildren.length - 1) totalWidth += H_GAP
  })

  let cx = -totalWidth / 2
  visibleChildren.forEach((child, i) => {
    child.x = cx + childWidths[i] / 2
    cx += childWidths[i] + H_GAP
  })

  return Math.max(NODE_W, totalWidth)
}

function flattenVisible(node: OrgNode, expandedIds: Set<string>, offsetX: number, offsetY: number, result: { node: OrgNode; ax: number; ay: number; parentX?: number; parentY?: number }[], parentX?: number, parentY?: number) {
  const ax = offsetX + node.x
  const ay = offsetY + node.y
  result.push({ node, ax, ay, parentX, parentY })
  if (expandedIds.has(node.employee.id)) {
    node.children.forEach(child => {
      flattenVisible(child, expandedIds, ax, 0, result, ax, ay)
    })
  }
}

function OrgChart({ employees }: { employees: Employee[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [dragging, setDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 })
  const [initialized, setInitialized] = useState(false)

  const activeEmployees = useMemo(() => employees.filter(e => e.is_active), [employees])
  const roots = useMemo(() => buildTree(activeEmployees), [activeEmployees])

  useEffect(() => {
    if (roots.length > 0 && !initialized) {
      const ids = new Set<string>()
      roots.forEach(r => ids.add(r.employee.id))
      setExpandedIds(ids)
      setInitialized(true)
    }
  }, [roots, initialized])

  const flatNodes = useMemo(() => {
    const result: { node: OrgNode; ax: number; ay: number; parentX?: number; parentY?: number }[] = []
    let totalRootWidth = 0
    const rootWidths: number[] = []
    roots.forEach((root, i) => {
      const w = layoutTree(root, expandedIds, 0)
      rootWidths.push(w)
      totalRootWidth += w
      if (i < roots.length - 1) totalRootWidth += H_GAP * 2
    })

    let rx = -totalRootWidth / 2
    roots.forEach((root, i) => {
      const offsetX = rx + rootWidths[i] / 2
      flattenVisible(root, expandedIds, offsetX, 0, result)
      rx += rootWidths[i] + H_GAP * 2
    })
    return result
  }, [roots, expandedIds])

  useEffect(() => {
    if (containerRef.current && initialized && flatNodes.length > 0) {
      const rect = containerRef.current.getBoundingClientRect()
      setPan({ x: rect.width / 2, y: 40 })
    }
  }, [initialized])

  function toggleExpand(id: string) {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return
    setDragging(true)
    dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!dragging) return
    setPan({
      x: dragStart.current.panX + (e.clientX - dragStart.current.x),
      y: dragStart.current.panY + (e.clientY - dragStart.current.y),
    })
  }

  function handleMouseUp() { setDragging(false) }

  function handleWheel(e: React.WheelEvent) {
    e.preventDefault()
    const delta = e.deltaY > 0 ? -0.08 : 0.08
    setZoom(z => Math.min(2, Math.max(0.2, z + delta)))
  }

  function handleReset() {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect()
      setPan({ x: rect.width / 2, y: 40 })
      setZoom(1)
    }
  }

  function expandAll() {
    const all = new Set<string>()
    activeEmployees.forEach(e => all.add(e.id))
    setExpandedIds(all)
  }

  function collapseAll() {
    const rootOnly = new Set<string>()
    roots.forEach(r => rootOnly.add(r.employee.id))
    setExpandedIds(rootOnly)
  }

  const hasChildren = (id: string) => activeEmployees.some(e => e.manager_id === id)
  const isExpanded = (id: string) => expandedIds.has(id)

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="admin-btn" onClick={expandAll} style={{ fontSize: 12, padding: '5px 14px' }}>Expand All</button>
        <button className="admin-btn" onClick={collapseAll} style={{ fontSize: 12, padding: '5px 14px' }}>Collapse All</button>
        <button className="admin-btn" onClick={handleReset} style={{ fontSize: 12, padding: '5px 14px' }}>Reset View</button>
        <span style={{ fontSize: 12, opacity: 0.5, marginLeft: 8 }}>Scroll to zoom, drag to pan, click nodes to expand</span>
      </div>

      <div
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        style={{
          width: '100%',
          height: 'calc(100vh - 260px)',
          minHeight: 400,
          border: '1px solid var(--border, #e5e7eb)',
          borderRadius: 12,
          overflow: 'hidden',
          cursor: dragging ? 'grabbing' : 'grab',
          background: 'var(--bg, #fafafa)',
          position: 'relative',
          userSelect: 'none',
        }}
      >
        <svg
          width="100%"
          height="100%"
          style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
        >
          <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
            {flatNodes.map(({ node, ax, ay, parentX, parentY }) => {
              if (parentX === undefined || parentY === undefined) return null
              const x1 = parentX
              const y1 = parentY + NODE_H / 2
              const x2 = ax
              const y2 = ay - NODE_H / 2
              const midY = (y1 + y2) / 2
              return (
                <path
                  key={`line-${node.employee.id}`}
                  d={`M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2}`}
                  fill="none"
                  stroke="var(--border, #cbd5e1)"
                  strokeWidth={2}
                  opacity={0.6}
                />
              )
            })}
          </g>
        </svg>

        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
          {flatNodes.map(({ node, ax, ay }) => {
            const emp = node.employee
            const dept = emp.department
            const deptColor = getDeptColor(dept)
            const childCount = node.children.length
            const expanded = isExpanded(emp.id)
            const canExpand = hasChildren(emp.id)

            return (
              <div
                key={emp.id}
                onClick={(e) => { e.stopPropagation(); if (canExpand) toggleExpand(emp.id) }}
                style={{
                  position: 'absolute',
                  left: pan.x + ax * zoom - (NODE_W * zoom) / 2,
                  top: pan.y + ay * zoom - (NODE_H * zoom) / 2,
                  width: NODE_W * zoom,
                  height: NODE_H * zoom,
                  transition: dragging ? 'none' : 'left 0.3s, top 0.3s',
                }}
              >
                <div style={{
                  width: NODE_W,
                  height: NODE_H,
                  transform: `scale(${zoom})`,
                  transformOrigin: 'top left',
                  background: 'var(--bg-card, #fff)',
                  border: `2px solid ${canExpand && expanded ? deptColor : 'var(--border, #d1d5db)'}`,
                  borderRadius: 10,
                  padding: '8px 10px',
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                  cursor: canExpand ? 'pointer' : 'default',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                  boxSizing: 'border-box',
                }}>
                  {emp.avatar_url ? (
                    <img src={emp.avatar_url} alt="" style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                  ) : (
                    <div style={{
                      width: 36, height: 36, borderRadius: '50%', background: deptColor,
                      color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 13, fontWeight: 700, flexShrink: 0,
                    }}>
                      {emp.first_name[0]}{emp.last_name[0]}
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                    <div style={{ fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text, #1a1a1a)' }}>
                      {emp.first_name} {emp.last_name}
                    </div>
                    <div style={{ fontSize: 10, opacity: 0.65, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text, #333)' }}>
                      {emp.job_title || 'No title'}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                      <span style={{
                        fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 4,
                        background: deptColor + '18', color: deptColor,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 90,
                      }}>
                        {dept || 'Unassigned'}
                      </span>
                      {canExpand && (
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4,
                          background: expanded ? '#dbeafe' : '#f3f4f6',
                          color: expanded ? '#2563eb' : '#6b7280',
                        }}>
                          {childCount} {expanded ? '▾' : '▸'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

    </div>
  )
}
