import React, { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { useFeatures } from '../../context/FeatureContext'
import { validateNINumber, validateSortCode, validateAccountNumber } from '../../lib/validators'
import { currencySymbol } from '../../lib/formatters'
import EmployeeRecordModules from './EmployeeRecordModules'

const PAGE_SIZE = 15

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
  has_company_device: boolean
  is_frozen: boolean
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function empStatus(emp: Employee): { label: string; bg: string; color: string; cls: string } {
  if (emp.is_frozen) return { label: 'Frozen', bg: '#e3f2fd', color: '#1565c0', cls: 'admin-badge-info' }
  if (emp.is_active) return { label: 'Active', bg: '#e8f5e9', color: '#2e7d32', cls: 'admin-badge-approved' }
  return { label: 'Inactive', bg: '#ffebee', color: '#c62828', cls: 'admin-badge-rejected' }
}

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
  const [filterActive, setFilterActive] = useState('active')
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
  const [activeTab, setActiveTab] = useState<'management' | 'records' | 'orgchart' | 'settings' | 'custom_fields' | 'changelog'>('records')
  const [recordsSearch, setRecordsSearch] = useState('')
  const [selectedLetter, setSelectedLetter] = useState<string | null>(null)
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [recordsPage, setRecordsPage] = useState(1)
  const [showFrozenSection, setShowFrozenSection] = useState(false)
  const [showDirectReports, setShowDirectReports] = useState(false)

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
  const [identityProvider, setIdentityProvider] = useState<'entra' | 'google_workspace'>('entra')
  const [moverPrompt, setMoverPrompt] = useState<{ empId: string; empName: string; empEmail: string; changes: Record<string, { old: string; new: string }> } | null>(null)
  const [m365DeletePrompt, setM365DeletePrompt] = useState<{ emp: Employee; m365Upn: string; hasIfo: boolean; offboarding: boolean } | null>(null)

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
    const [{ data }, { data: onbData }, { data: companyData }] = await Promise.all([
      supabase.from('employees').select('*').eq('company_id', selectedCompanyId).order('last_name'),
      supabase.from('onboarding').select('user_email, initial_setup_complete').eq('company_id', selectedCompanyId),
      supabase.from('companies').select('identity_provider').eq('id', selectedCompanyId).single(),
    ])
    setEmployees((data as Employee[]) || [])
    if (companyData?.identity_provider) setIdentityProvider(companyData.identity_provider as 'entra' | 'google_workspace')
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
      persona: emp.persona || 'information-worker',
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

    // Fetch current record before update for audit trail
    const { data: oldRecord } = await supabase.from('employees').select('*').eq('id', id).single()

    const { error } = await supabase.from('employees').update(payload).eq('id', id)
    if (error) { showError('Failed to save employee: ' + error.message); return }

    // Audit log — record changed fields
    if (oldRecord) {
      const changedFields: Record<string, { old: any; new: any }> = {}
      for (const [k, v] of Object.entries(payload)) {
        const oldVal = (oldRecord as any)[k]
        if (JSON.stringify(oldVal) !== JSON.stringify(v)) {
          changedFields[k] = { old: oldVal ?? null, new: v ?? null }
        }
      }
      if (Object.keys(changedFields).length > 0) {
        const { data: userData } = await supabase.auth.getUser()
        await supabase.from('gdpr_audit_logs').insert({
          actor_id: userData.user?.id,
          actor_role: 'company_admin',
          company_id: selectedCompanyId,
          table_name: 'employees',
          record_id: id,
          action: 'UPDATE',
          old_data: changedFields,
          new_data: Object.fromEntries(Object.entries(changedFields).map(([k, v]) => [k, v.new])),
          metadata: { employee_name: `${oldRecord.first_name} ${oldRecord.last_name}`, source: 'admin_employees' },
        })
      }
    }
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

    if (features.inflowonboarder_integration && editForm.has_company_device) {
      const emp = employees.find(e => e.id === id)
      if (emp) {
        const oldPersona = emp.persona || 'information-worker'
        const newPersona = editForm.persona || 'information-worker'
        if (oldPersona !== newPersona) {
          setMoverPrompt({ empId: id, empName: `${emp.first_name} ${emp.last_name}`, empEmail: emp.email || '', changes: { persona: { old: oldPersona, new: newPersona } } })
        }
      }
    }

    setEditingId(null)
    showSuccess('Employee updated')
    load()
  }

  async function deactivateEmployee(id: string) {
    if (!confirm('Deactivate this employee? This will mark them as inactive and reassign their pending approvals.')) return
    const emp = employees.find(e => e.id === id)
    const { error } = await supabase.from('employees').update({ is_active: false }).eq('id', id)
    if (error) { showError('Failed to deactivate employee: ' + error.message); return }

    // Audit log — deactivation
    const { data: userData } = await supabase.auth.getUser()
    await supabase.from('gdpr_audit_logs').insert({
      actor_id: userData.user?.id,
      actor_role: 'company_admin',
      company_id: selectedCompanyId,
      table_name: 'employees',
      record_id: id,
      action: 'UPDATE',
      old_data: { is_active: { old: true, new: false } },
      new_data: { is_active: false },
      metadata: { employee_name: emp ? `${emp.first_name} ${emp.last_name}` : 'Unknown', source: 'admin_employees', change_type: 'deactivation' },
    })

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

    // Check if employee has an M365 account that needs cleanup
    const { data: m365Row } = await supabase
      .from('onboarding_m365_actions')
      .select('m365_upn')
      .eq('company_id', selectedCompanyId)
      .eq('onboarding_id', (await supabase.from('onboarding').select('id').eq('user_email', emp.email).eq('company_id', selectedCompanyId).maybeSingle()).data?.id || -1)
      .maybeSingle()

    if (m365Row?.m365_upn) {
      setM365DeletePrompt({ emp, m365Upn: m365Row.m365_upn, hasIfo: !!features.inflowonboarder_integration, offboarding: false })
      return
    }

    if (!confirm(`Permanently delete ${emp.first_name} ${emp.last_name} and all their related records? This cannot be undone.`)) return

    await executeCascadeDelete(emp)
  }

  async function executeCascadeDelete(emp: Employee) {
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

    await supabase.from('expense_claims').update({ approved_by: null }).eq('approved_by', emp.id)
    await supabase.from('leave_requests').update({ approved_by: null }).eq('approved_by', emp.id)
    await supabase.from('timesheets').update({ approved_by: null }).eq('approved_by', emp.id)
    await supabase.from('employees').update({ manager_id: null }).eq('manager_id', emp.id)
    await supabase.from('announcements').update({ author_id: null }).eq('author_id', emp.id)
    await supabase.from('workflow_tracker').delete().eq('employee_email', emp.email)

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

  async function handleM365DeleteConfirm() {
    if (!m365DeletePrompt) return
    const { emp, m365Upn, hasIfo } = m365DeletePrompt

    if (hasIfo) {
      setM365DeletePrompt(p => p ? { ...p, offboarding: true } : null)
      try {
        const { data: sessionData } = await supabase.auth.getSession()
        const token = sessionData?.session?.access_token
        if (!token) { showError('Session expired — please sign in again'); setM365DeletePrompt(null); return }

        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
        const res = await fetch(`${supabaseUrl}/functions/v1/inflowonboarder-leaver`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({
            company_id: selectedCompanyId,
            action: 'start-leaver-run',
            userPrincipalName: m365Upn,
            displayName: `${emp.first_name} ${emp.last_name}`,
            source: 'employee_delete',
          }),
        })
        const data = await res.json()
        if (!res.ok) {
          showError(`M365 offboarding failed: ${data.error || 'Unknown error'}. You can still delete the HR record — clean up M365 manually.`)
        } else {
          showSuccess('M365 account blocked, groups removed, licence released')
        }
      } catch {
        showError('M365 offboarding request failed. You can still delete the HR record — clean up M365 manually.')
      }
    }

    setM365DeletePrompt(null)
    await executeCascadeDelete(emp)
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
      if (filterActive === 'active' && (!e.is_active || e.is_frozen)) return false
      if (filterActive === 'inactive' && (e.is_active || e.is_frozen)) return false
      if (filterActive === 'frozen' && !e.is_frozen) return false
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

  const recordsActive = useMemo(() => recordsFiltered.filter(e => e.is_active && !e.is_frozen), [recordsFiltered])
  const recordsFrozen = useMemo(() => recordsFiltered.filter(e => e.is_frozen), [recordsFiltered])
  const RECORDS_PAGE_SIZE = 15
  const recordsTotalPages = Math.max(1, Math.ceil(recordsActive.length / RECORDS_PAGE_SIZE))
  const recordsPaginated = recordsActive.slice((recordsPage - 1) * RECORDS_PAGE_SIZE, recordsPage * RECORDS_PAGE_SIZE)

  useEffect(() => { setRecordsPage(1) }, [selectedLetter, recordsSearch])

  const availableLetters = useMemo(() => {
    const letters = new Set<string>()
    employees.forEach(e => { if (e.first_name) letters.add(e.first_name[0].toUpperCase()) })
    return letters
  }, [employees])

  const selectedEmployee = useMemo(() => {
    if (!selectedEmployeeId) return null
    return employees.find(e => e.id === selectedEmployeeId) || null
  }, [employees, selectedEmployeeId])

  const directReports = useMemo(() => {
    if (!selectedEmployeeId) return []
    return employees.filter(e => e.manager_id === selectedEmployeeId && !(!e.is_active && !e.is_frozen))
      .sort((a, b) => `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`))
  }, [employees, selectedEmployeeId])

  useEffect(() => { setShowDirectReports(false) }, [selectedEmployeeId])

  useEffect(() => {
    if (!selectedEmployeeId && alphabeticalEmployees.length > 0) {
      const firstActive = alphabeticalEmployees.find(e => e.is_active && !e.is_frozen)
      if (firstActive) setSelectedEmployeeId(firstActive.id)
    }
  }, [alphabeticalEmployees])

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
        <p>{employees.length} employees · {employees.filter(e => e.is_active && !e.is_frozen).length} active{employees.some(e => e.is_frozen) ? ` · ${employees.filter(e => e.is_frozen).length} frozen` : ''}</p>
      </div>

      <div className="admin-tabs">
        <button className={`admin-tab ${activeTab === 'management' ? 'admin-tab-active' : ''}`} onClick={() => setActiveTab('management')}>Employee Management</button>
        <button className={`admin-tab ${activeTab === 'records' ? 'admin-tab-active' : ''}`} onClick={() => setActiveTab('records')}>Employee Records</button>
        <button className={`admin-tab ${activeTab === 'orgchart' ? 'admin-tab-active' : ''}`} onClick={() => setActiveTab('orgchart')}>Org Chart</button>
        <button className={`admin-tab ${activeTab === 'settings' ? 'admin-tab-active' : ''}`} onClick={() => setActiveTab('settings')}>Payroll Settings</button>
        <button className={`admin-tab ${activeTab === 'custom_fields' ? 'admin-tab-active' : ''}`} onClick={() => { setActiveTab('custom_fields'); if (customFields.length === 0) loadCustomFields() }}>Custom Fields</button>
        <button className={`admin-tab ${activeTab === 'changelog' ? 'admin-tab-active' : ''}`} onClick={() => setActiveTab('changelog')}>Change Log</button>
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
                recordsActive.length === 0 && recordsFrozen.length === 0 ? <div style={{ padding: 20, textAlign: 'center', color: '#999' }}>No employees found</div> : (<>
                  {recordsPaginated.map(emp => (
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
                    </div>
                  ))}
                  {recordsTotalPages > 1 && (
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid #e0e0e0' }}>
                      <button disabled={recordsPage <= 1} onClick={() => setRecordsPage(p => p - 1)} style={{ border: 'none', background: 'none', cursor: recordsPage <= 1 ? 'default' : 'pointer', color: recordsPage <= 1 ? '#ccc' : '#1565c0', fontSize: 12, fontWeight: 600, padding: '4px 8px' }}>‹ Prev</button>
                      <span style={{ fontSize: 11, color: '#666' }}>{recordsPage} / {recordsTotalPages}</span>
                      <button disabled={recordsPage >= recordsTotalPages} onClick={() => setRecordsPage(p => p + 1)} style={{ border: 'none', background: 'none', cursor: recordsPage >= recordsTotalPages ? 'default' : 'pointer', color: recordsPage >= recordsTotalPages ? '#ccc' : '#1565c0', fontSize: 12, fontWeight: 600, padding: '4px 8px' }}>Next ›</button>
                    </div>
                  )}
                  {recordsFrozen.length > 0 && (
                    <>
                      <button
                        onClick={() => setShowFrozenSection(v => !v)}
                        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', border: 'none', borderBottom: '1px solid #e0e0e0', background: '#e3f2fd', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#1565c0' }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ transform: showFrozenSection ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}><polyline points="9 18 15 12 9 6"/></svg>
                        Frozen Employees ({recordsFrozen.length})
                      </button>
                      {showFrozenSection && recordsFrozen.map(emp => (
                        <div
                          key={emp.id}
                          onClick={() => setSelectedEmployeeId(emp.id)}
                          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid #f5f5f5', background: selectedEmployeeId === emp.id ? '#bbdefb' : '#e3f2fd', transition: 'background 0.15s' }}
                        >
                          {emp.avatar_url ? (
                            <img src={emp.avatar_url} alt="" style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover' }} />
                          ) : (
                            <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#bbdefb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600, color: '#1565c0' }}>
                              {emp.first_name[0]}{emp.last_name[0]}
                            </div>
                          )}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{emp.first_name} {emp.last_name}</div>
                            <div style={{ fontSize: 11, color: '#888', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{emp.job_title || emp.department || 'No role assigned'}</div>
                          </div>
                          <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, fontWeight: 600, background: '#e3f2fd', color: '#1565c0' }}>Frozen</span>
                        </div>
                      ))}
                    </>
                  )}
                </>)
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
                        <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 12, fontWeight: 600, background: empStatus(selectedEmployee).bg, color: empStatus(selectedEmployee).color }}>
                          {empStatus(selectedEmployee).label}
                        </span>
                        {selectedEmployee.contract_type && (
                          <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 12, fontWeight: 600, background: '#e3f2fd', color: '#1565c0' }}>{selectedEmployee.contract_type}</span>
                        )}
                        {selectedEmployee.is_admin && (
                          <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 12, fontWeight: 600, background: '#fff3e0', color: '#e65100' }}>Admin</span>
                        )}
                      </div>
                      {directReports.length > 0 && (
                        <button
                          onClick={() => setShowDirectReports(!showDirectReports)}
                          style={{ marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', fontSize: 12, fontWeight: 600, border: '1px solid #c5cae9', borderRadius: 6, background: '#e8eaf6', color: '#283593', cursor: 'pointer' }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                          People I Manage ({directReports.length})
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points={showDirectReports ? "18 15 12 9 6 15" : "6 9 12 15 18 9"}/></svg>
                        </button>
                      )}
                    </div>
                    {/* Key stats */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px', fontSize: 12 }}>
                      <div><span style={{ color: '#999', display: 'block' }}>Employee ID</span><strong>{selectedEmployee.employee_number}</strong></div>
                      <div><span style={{ color: '#999', display: 'block' }}>Department</span><strong>{selectedEmployee.department || '—'}</strong></div>
                      <div><span style={{ color: '#999', display: 'block' }}>Start Date</span><strong>{formatDate(selectedEmployee.start_date)}</strong></div>
                      <div><span style={{ color: '#999', display: 'block' }}>Service</span><strong>{calculateDuration(selectedEmployee.start_date)}</strong></div>
                      <div><span style={{ color: '#999', display: 'block' }}>Location</span><strong>{selectedEmployee.location || '—'}</strong></div>
                      <div><span style={{ color: '#999', display: 'block' }}>Manager</span><strong>{selectedEmployee.manager_name || '—'}</strong></div>
                      <div><span style={{ color: '#999', display: 'block' }}>Manager Email</span><strong style={{ fontSize: 11 }}>{selectedEmployee.manager_email || '—'}</strong></div>
                      {features.inflowonboarder_integration && (
                        <>
                          <div><span style={{ color: '#999', display: 'block' }}>Company Device</span><strong>{selectedEmployee.has_company_device ? 'Yes' : 'No'}</strong></div>
                          {identityProvider !== 'google_workspace' && (
                            <div><span style={{ color: '#999', display: 'block' }}>Persona</span><strong style={{ textTransform: 'capitalize' }}>{selectedEmployee.has_company_device ? (selectedEmployee.persona || 'information-worker').replace(/-/g, ' ') : '—'}</strong></div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  {selectedEmployee.is_active && !selectedEmployee.is_frozen && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 16, paddingTop: 16, borderTop: '1px solid #e8e8e8' }}>
                      <button
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', fontSize: 12, fontWeight: 600, border: '1px solid #ffe0b2', borderRadius: 8, background: '#fff8e1', color: '#e65100', cursor: 'pointer' }}
                        onClick={() => navigate('/admin/onboarding', { state: { tab: 'jml', jmlSection: 'movers', prefill: { empId: selectedEmployee.id, empName: `${selectedEmployee.first_name} ${selectedEmployee.last_name}`, empEmail: selectedEmployee.email } } })}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 3h5v5"/><path d="M21 3l-7 7"/><path d="M11 13l-7 7"/><path d="M3 21h5v-5"/></svg>
                        Start Role Change
                      </button>
                      <button
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', fontSize: 12, fontWeight: 600, border: '1px solid #ffcdd2', borderRadius: 8, background: '#ffebee', color: '#c62828', cursor: 'pointer' }}
                        onClick={() => navigate('/admin/onboarding', { state: { tab: 'jml', jmlSection: 'leavers', prefill: { empId: selectedEmployee.id, empName: `${selectedEmployee.first_name} ${selectedEmployee.last_name}`, empEmail: selectedEmployee.email } } })}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                        Start Offboarding
                      </button>
                    </div>
                  )}
                </div>

                {showDirectReports && directReports.length > 0 && (
                  <div style={{ background: '#fff', borderRadius: 10, padding: 16, marginBottom: 20, border: '1px solid #e8e8e8' }}>
                    <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600, color: '#1a1a1a' }}>Direct Reports ({directReports.length})</h4>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid #e0e0e0' }}>
                          <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600, color: '#666' }}>First Name</th>
                          <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600, color: '#666' }}>Last Name</th>
                          <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600, color: '#666' }}>Department</th>
                          <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600, color: '#666' }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {directReports.map(dr => (
                          <tr key={dr.id} style={{ borderBottom: '1px solid #f5f5f5', cursor: 'pointer', background: dr.is_frozen ? '#e3f2fd' : undefined }} onClick={() => { setSelectedEmployeeId(dr.id); setShowDirectReports(false) }}>
                            <td style={{ padding: '8px' }}>{dr.first_name}</td>
                            <td style={{ padding: '8px' }}>{dr.last_name}</td>
                            <td style={{ padding: '8px' }}>{dr.department || '—'}</td>
                            <td style={{ padding: '8px' }}>
                              <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, fontWeight: 600, background: empStatus(dr).bg, color: empStatus(dr).color }}>{empStatus(dr).label}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

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

      {activeTab === 'changelog' && (
        <EmployeeChangeLog companyId={selectedCompanyId} />
      )}

      {activeTab === 'management' && <>
      <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid #e0e0e0', marginBottom: 16 }}>
        {([
          { key: 'active', label: 'Active', count: employees.filter(e => e.is_active && !e.is_frozen).length },
          { key: 'frozen', label: 'Frozen', count: employees.filter(e => e.is_frozen).length },
          { key: 'inactive', label: 'Deleted / Removed', count: employees.filter(e => !e.is_active && !e.is_frozen).length },
        ] as const).map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilterActive(tab.key)}
            style={{
              padding: '10px 20px',
              border: 'none',
              borderBottom: filterActive === tab.key ? '2px solid #1565c0' : '2px solid transparent',
              marginBottom: -2,
              background: 'transparent',
              color: filterActive === tab.key ? '#1565c0' : '#666',
              fontWeight: filterActive === tab.key ? 600 : 400,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            {tab.label} <span style={{ fontSize: 12, opacity: 0.7 }}>({tab.count})</span>
          </button>
        ))}
      </div>
      <div className="admin-filters">
        <input placeholder="Search name, email, ID..." value={search} onChange={e => setSearch(e.target.value)} className="admin-input admin-search" />
        <select value={filterDept} onChange={e => setFilterDept(e.target.value)} className="admin-select">
          <option value="">All Departments</option>
          {departments.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      {loading ? <div className="admin-loading">Loading...</div> : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>ID</th><th>Name</th><th>Email</th><th>Department</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {paginated.map(emp => (
                <>
                  <tr key={emp.id} className={expandedId === emp.id ? 'admin-row-active' : ''} style={emp.is_frozen ? { background: '#e3f2fd' } : (!emp.is_active && !emp.is_frozen) ? { background: '#ffebee' } : undefined}>
                    <td className="admin-td-mono">{emp.employee_number}</td>
                    <td>{editingId === emp.id ? (
                      <div className="admin-name-inputs">
                        <input className="admin-inline-input" value={editForm.first_name} onChange={e => setEditForm(f => ({...f, first_name: e.target.value}))} placeholder="First" />
                        <input className="admin-inline-input" value={editForm.last_name} onChange={e => setEditForm(f => ({...f, last_name: e.target.value}))} placeholder="Last" />
                      </div>
                    ) : <span className="admin-inline-avatar">{emp.avatar_url ? <img src={emp.avatar_url} alt="" /> : <span className="admin-avatar-initials">{emp.first_name[0]}{emp.last_name[0]}</span>}{emp.first_name} {emp.last_name}</span>}</td>
                    <td>{editingId === emp.id ? <input className="admin-inline-input" value={editForm.email} onChange={e => setEditForm(f => ({...f, email: e.target.value}))} /> : emp.email}</td>
                    <td>{editingId === emp.id ? (features.inflowonboarder_integration ? <span style={{ fontSize: 13, color: '#333' }} title="Use the Mover workflow to change this field">{editForm.department || '—'}</span> : <input className="admin-inline-input" value={editForm.department} onChange={e => setEditForm(f => ({...f, department: e.target.value}))} />) : (emp.department || '—')}</td>
                    <td>{editingId === emp.id ? (features.inflowonboarder_integration ? <span style={{ fontSize: 13, color: '#333' }} title="Use the Mover workflow to change this field">{editForm.job_title || '—'}</span> : <input className="admin-inline-input" value={editForm.job_title} onChange={e => setEditForm(f => ({...f, job_title: e.target.value}))} />) : (emp.job_title || '—')}</td>
                    <td>
                      <span className={`admin-badge ${empStatus(emp).cls}`}>{empStatus(emp).label}</span>
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
                                            <label style={{ fontSize: 12 }}>Work Location {features.inflowonboarder_integration && <span style={{ fontSize: 10, color: '#e65100' }}>🔒 Mover workflow</span>}</label>
                                            {features.inflowonboarder_integration
                                              ? <div style={{ padding: '6px 10px', background: '#f5f5f5', borderRadius: 6, fontSize: 13, color: '#333', border: '1px solid #e0e0e0', minHeight: 32, display: 'flex', alignItems: 'center' }}>{editForm.location || <span style={{ color: '#999' }}>—</span>}</div>
                                              : <input className="admin-inline-input" value={editForm.location || ''} onChange={e => setEditForm(p => ({...p, location: e.target.value}))} />
                                            }
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
                                            <label style={{ fontSize: 12 }}>Manager Name {features.inflowonboarder_integration && <span style={{ fontSize: 10, color: '#e65100' }}>🔒 Mover workflow</span>}</label>
                                            {features.inflowonboarder_integration
                                              ? <div style={{ padding: '6px 10px', background: '#f5f5f5', borderRadius: 6, fontSize: 13, color: '#333', border: '1px solid #e0e0e0', minHeight: 32, display: 'flex', alignItems: 'center' }}>{editForm.manager_name || <span style={{ color: '#999' }}>—</span>}</div>
                                              : <input className="admin-inline-input" value={editForm.manager_name || ''} onChange={e => setEditForm(p => ({...p, manager_name: e.target.value}))} />
                                            }
                                          </div>
                                        )}
                                        {showField('manager_email') && (
                                          <div className="admin-form-field">
                                            <label style={{ fontSize: 12 }}>Manager Email {features.inflowonboarder_integration && <span style={{ fontSize: 10, color: '#e65100' }}>🔒 Mover workflow</span>}</label>
                                            {features.inflowonboarder_integration
                                              ? <div style={{ padding: '6px 10px', background: '#f5f5f5', borderRadius: 6, fontSize: 13, color: '#333', border: '1px solid #e0e0e0', minHeight: 32, display: 'flex', alignItems: 'center' }}>{editForm.manager_email || <span style={{ color: '#999' }}>—</span>}</div>
                                              : <input className="admin-inline-input" value={editForm.manager_email || ''} onChange={e => setEditForm(p => ({...p, manager_email: e.target.value}))} />
                                            }
                                          </div>
                                        )}
                                        {features.inflowonboarder_integration && (
                                          <div style={{ gridColumn: 'span 2', padding: '8px 12px', background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 8, fontSize: 12, color: '#6d4c00', marginBottom: 4 }}>
                                            Job title, department, location and manager are locked — use the <strong>Mover workflow</strong> in JML to change these fields so that M365 and HR records stay in sync.
                                          </div>
                                        )}
                                        {features.inflowonboarder_integration && (
                                          <>
                                            <div className="admin-form-field">
                                              <label style={{ fontSize: 12 }}>Company Device</label>
                                              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                                                  <input type="checkbox" checked={!!editForm.has_company_device} onChange={e => setEditForm(p => ({...p, has_company_device: e.target.checked}))} />
                                                  Has a managed company device
                                                </label>
                                              </div>
                                            </div>
                                            {identityProvider !== 'google_workspace' && (
                                            <div className="admin-form-field">
                                              <label style={{ fontSize: 12 }}>Persona</label>
                                              {editForm.has_company_device ? (
                                                <select className="admin-select" value={editForm.persona || 'information-worker'} onChange={e => setEditForm(p => ({...p, persona: e.target.value}))}>
                                                  <option value="information-worker">Information worker</option>
                                                  <option value="mobile-field-worker">Mobile and field worker</option>
                                                  <option value="secure-vip">Secure VIP</option>
                                                  <option value="shared-kiosk">Shared kiosk</option>
                                                </select>
                                              ) : (
                                                <div style={{ fontSize: 12, color: '#888', padding: '6px 0' }}>No company device assigned — persona changes not applicable</div>
                                              )}
                                            </div>
                                            )}
                                          </>
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

      {m365DeletePrompt && (
        <div className="my-profile-modal-overlay" onClick={() => setM365DeletePrompt(null)}>
          <div className="my-profile-cr-modal" style={{ maxWidth: 500 }} onClick={e => e.stopPropagation()}>
            <div className="my-profile-modal-header" style={{ background: m365DeletePrompt.hasIfo ? '#c62828' : '#e65100', justifyContent: 'space-between', padding: '14px 20px' }}>
              <span className="my-profile-modal-dept" style={{ fontSize: 16 }}>Microsoft 365 Account Detected</span>
              <button onClick={() => setM365DeletePrompt(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div style={{ padding: 20 }}>
              <p style={{ fontSize: 14, marginBottom: 12 }}>
                <strong>{m365DeletePrompt.emp.first_name} {m365DeletePrompt.emp.last_name}</strong> has a Microsoft 365 account (<span style={{ fontFamily: 'monospace', fontSize: 13 }}>{m365DeletePrompt.m365Upn}</span>).
              </p>

              {m365DeletePrompt.hasIfo ? (
                <>
                  <div style={{ background: '#fbe9e7', border: '1px solid #ef9a9a', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 13 }}>
                    <strong>Deleting this employee will also:</strong>
                    <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
                      <li>Block their Microsoft 365 sign-in</li>
                      <li>Remove them from all security groups</li>
                      <li>Release their licence</li>
                    </ul>
                  </div>
                  <p style={{ fontSize: 12, color: '#666', marginBottom: 16 }}>
                    If the M365 cleanup fails, you will be notified but the HR record will still be deleted. You can then clean up M365 manually.
                  </p>
                </>
              ) : (
                <>
                  <div style={{ background: '#fff3e0', border: '1px solid #ffcc80', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 13 }}>
                    <strong>Manual steps required:</strong>
                    <p style={{ margin: '8px 0 0' }}>Without InflowOnboarder, deleting this employee will only remove the HR record. You must manually:</p>
                    <ol style={{ margin: '8px 0 0', paddingLeft: 20 }}>
                      <li>Block their sign-in in Microsoft Entra ID</li>
                      <li>Remove them from security groups</li>
                      <li>Release their licence</li>
                      <li>Optionally delete the M365 account after 30 days</li>
                    </ol>
                  </div>
                </>
              )}

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  disabled={m365DeletePrompt.offboarding}
                  onClick={handleM365DeleteConfirm}
                  style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: 'none', background: '#c62828', color: '#fff', fontWeight: 700, fontSize: 14, cursor: m365DeletePrompt.offboarding ? 'wait' : 'pointer', opacity: m365DeletePrompt.offboarding ? 0.7 : 1 }}>
                  {m365DeletePrompt.offboarding ? 'Offboarding M365...' : m365DeletePrompt.hasIfo ? 'Offboard M365 & Delete' : 'I understand, delete anyway'}
                </button>
                <button onClick={() => setM365DeletePrompt(null)}
                  style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: '1px solid #ccc', background: '#fff', color: '#333', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {moverPrompt && (
        <div className="my-profile-modal-overlay" onClick={() => setMoverPrompt(null)}>
          <div className="my-profile-cr-modal" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <div className="my-profile-modal-header" style={{ background: '#e65100', justifyContent: 'space-between', padding: '14px 20px' }}>
              <span className="my-profile-modal-dept" style={{ fontSize: 16 }}>Persona Change Detected</span>
              <button onClick={() => setMoverPrompt(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div style={{ padding: 20 }}>
              <p style={{ fontSize: 14, marginBottom: 12 }}>
                <strong>{moverPrompt.empName}</strong>'s persona has changed. Would you like to start a role change to update their Microsoft 365 account?
              </p>
              <div style={{ background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 13 }}>
                <strong>Persona:</strong> {moverPrompt.changes.persona.old || '(none)'} → {moverPrompt.changes.persona.new || '(none)'}
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={async () => {
                  setMoverPrompt(null)
                  navigate('/admin/onboarding', { state: { tab: 'jml', jmlSection: 'movers', prefill: { empId: moverPrompt.empId, empName: moverPrompt.empName, empEmail: moverPrompt.empEmail, personaChange: moverPrompt.changes.persona } } })
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

/* ─── Employee Change Log ─── */

const FIELD_LABELS: Record<string, string> = {
  job_title: 'Job Title', department: 'Department', location: 'Location',
  annual_salary: 'Annual Salary', hourly_rate: 'Hourly Rate', persona: 'Persona',
  manager_name: 'Manager', first_name: 'First Name', last_name: 'Last Name',
  email: 'Email', work_email: 'Work Email', phone: 'Phone',
  date_of_birth: 'Date of Birth', ni_number: 'NI Number',
  bank_sort_code: 'Sort Code', bank_account_number: 'Account Number',
  employment_category: 'Employment Type', leave_allowance: 'Leave Allowance',
  weekly_hours: 'Weekly Hours', start_date: 'Start Date',
  probation_end_date: 'Probation End Date', is_active: 'Active Status',
  gender: 'Gender', nationality: 'Nationality', marital_status: 'Marital Status',
  address_line1: 'Address Line 1', address_line2: 'Address Line 2',
  city: 'City', county: 'County', postcode: 'Postcode', country: 'Country',
  emergency_contact_name: 'Emergency Contact', emergency_contact_phone: 'Emergency Phone',
  emergency_contact_relationship: 'Emergency Relationship', bank_account_name: 'Bank Account Name',
  notice_period: 'Notice Period', contract_type: 'Contract Type',
  tax_code: 'Tax Code', payroll_id: 'Payroll ID', personal_email: 'Personal Email',
  manager_email: 'Manager Email', salary_group: 'Salary Group', qualifications: 'Qualifications',
  religion: 'Religion', is_admin: 'Admin', contracted_days: 'Contracted Days',
  pay_pattern_override: 'Pay Pattern Override', overtime_handling_override: 'Overtime Override',
  time_recording_override: 'Time Recording Override', is_payroll_exception: 'Payroll Exception',
}

const CHANGELOG_PAGE_SIZE = 25

interface AuditLogEntry {
  id: number
  performed_at: string
  actor_id: string
  actor_role: string
  company_id: string | null
  table_name: string
  record_id: string | null
  action: string
  old_data: any
  new_data: any
  metadata: any
}

function EmployeeChangeLog({ companyId }: { companyId: string }) {
  const [entries, setEntries] = useState<AuditLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [actionFilter, setActionFilter] = useState('')
  const [searchText, setSearchText] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [currentPage, setCurrentPage] = useState(1)

  async function loadLogs() {
    setLoading(true)
    let query = supabase
      .from('gdpr_audit_logs')
      .select('*')
      .eq('company_id', companyId)
      .eq('table_name', 'employees')
      .order('performed_at', { ascending: false })
      .limit(500)

    if (actionFilter) {
      query = query.eq('action', actionFilter)
    }
    if (dateFrom) {
      query = query.gte('performed_at', dateFrom + 'T00:00:00')
    }
    if (dateTo) {
      query = query.lte('performed_at', dateTo + 'T23:59:59')
    }

    const { data } = await query
    setEntries((data as AuditLogEntry[]) || [])
    setCurrentPage(1)
    setLoading(false)
  }

  useEffect(() => { if (companyId) loadLogs() }, [companyId, actionFilter, dateFrom, dateTo])

  const filtered = useMemo(() => {
    if (!searchText) return entries
    const q = searchText.toLowerCase()
    return entries.filter(e => {
      const empName = e.metadata?.employee_name || ''
      const actorId = e.actor_id || ''
      return empName.toLowerCase().includes(q) || actorId.toLowerCase().includes(q)
    })
  }, [entries, searchText])

  const totalPages = Math.max(1, Math.ceil(filtered.length / CHANGELOG_PAGE_SIZE))
  const paginated = filtered.slice((currentPage - 1) * CHANGELOG_PAGE_SIZE, currentPage * CHANGELOG_PAGE_SIZE)

  function formatFieldName(key: string): string {
    return FIELD_LABELS[key] || key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  }

  function formatValue(val: any): string {
    if (val === null || val === undefined) return '(empty)'
    if (typeof val === 'boolean') return val ? 'Yes' : 'No'
    if (Array.isArray(val)) return val.map((v, i) => v ? DAY_LABELS[i] : null).filter(Boolean).join(', ') || '(none)'
    return String(val)
  }

  function renderChangedFields(entry: AuditLogEntry) {
    const oldData = entry.old_data
    if (!oldData || typeof oldData !== 'object') return null

    // Check if old_data has the {field: {old, new}} shape
    const fields = Object.entries(oldData)
    const isDetailedFormat = fields.length > 0 && fields.every(([, v]) => v && typeof v === 'object' && 'old' in v && 'new' in v)

    if (isDetailedFormat) {
      return (
        <div style={{ display: 'grid', gap: 6 }}>
          {fields.map(([field, val]: [string, any]) => (
            <div key={field} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '6px 10px', background: '#f8f9fc', borderRadius: 6 }}>
              <span style={{ fontWeight: 600, color: '#333', minWidth: 140 }}>{formatFieldName(field)}</span>
              <span style={{ color: '#c62828', textDecoration: 'line-through' }}>{formatValue(val.old)}</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
              <span style={{ color: '#2e7d32', fontWeight: 600 }}>{formatValue(val.new)}</span>
            </div>
          ))}
        </div>
      )
    }

    // Fallback: show old_data and new_data as JSON
    return (
      <div style={{ display: 'grid', gap: 8 }}>
        {entry.old_data && (
          <div>
            <strong style={{ fontSize: 11, color: '#c62828', textTransform: 'uppercase' }}>Old Data</strong>
            <pre style={{ fontSize: 11, margin: '4px 0', padding: 8, background: '#fff', borderRadius: 6, overflow: 'auto', maxHeight: 150 }}>
              {JSON.stringify(entry.old_data, null, 2)}
            </pre>
          </div>
        )}
        {entry.new_data && (
          <div>
            <strong style={{ fontSize: 11, color: '#2e7d32', textTransform: 'uppercase' }}>New Data</strong>
            <pre style={{ fontSize: 11, margin: '4px 0', padding: 8, background: '#fff', borderRadius: 6, overflow: 'auto', maxHeight: 150 }}>
              {JSON.stringify(entry.new_data, null, 2)}
            </pre>
          </div>
        )}
      </div>
    )
  }

  const ACTION_COLORS: Record<string, { bg: string; color: string }> = {
    UPDATE: { bg: '#fff3e0', color: '#e65100' },
    INSERT: { bg: '#e8f5e9', color: '#2e7d32' },
    DELETE: { bg: '#ffebee', color: '#c62828' },
  }

  const ROLE_COLORS: Record<string, { bg: string; color: string }> = {
    super_admin: { bg: '#e3f2fd', color: '#1565c0' },
    company_admin: { bg: '#f3e5f5', color: '#7b1fa2' },
    employee: { bg: '#e8f5e9', color: '#2e7d32' },
  }

  return (
    <div style={{ padding: '16px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Employee Change Log</h3>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#8b8fa3' }}>
            Read-only audit trail of all employee record changes
          </p>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16, alignItems: 'flex-end' }}>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#8b8fa3', display: 'block', marginBottom: 4 }}>Action</label>
          <select className="admin-select" style={{ minWidth: 140, fontSize: 13 }} value={actionFilter} onChange={e => setActionFilter(e.target.value)}>
            <option value="">All Actions</option>
            <option value="UPDATE">UPDATE</option>
            <option value="INSERT">INSERT</option>
            <option value="DELETE">DELETE</option>
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#8b8fa3', display: 'block', marginBottom: 4 }}>Search</label>
          <input className="admin-input" style={{ minWidth: 180, fontSize: 13 }} placeholder="Employee name or actor..." value={searchText} onChange={e => setSearchText(e.target.value)} />
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#8b8fa3', display: 'block', marginBottom: 4 }}>From</label>
          <input className="admin-input" type="date" style={{ fontSize: 13 }} value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#8b8fa3', display: 'block', marginBottom: 4 }}>To</label>
          <input className="admin-input" type="date" style={{ fontSize: 13 }} value={dateTo} onChange={e => setDateTo(e.target.value)} />
        </div>
        {(actionFilter || searchText || dateFrom || dateTo) && (
          <button className="admin-btn-sm" onClick={() => { setActionFilter(''); setSearchText(''); setDateFrom(''); setDateTo('') }} style={{ fontSize: 12, padding: '6px 12px', marginBottom: 1 }}>
            Clear Filters
          </button>
        )}
      </div>

      <div style={{ padding: '8px 14px', background: '#f8f9fc', borderRadius: 8, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8b8fa3" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
        <span style={{ fontSize: 12, color: '#8b8fa3' }}>
          This log is read-only. Showing {filtered.length} entries for employee record changes.
        </span>
      </div>

      {loading ? (
        <div className="admin-loading">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="admin-empty" style={{ padding: 40 }}>No change log entries found</div>
      ) : (
        <>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Date/Time</th>
                  <th>Actor</th>
                  <th>Employee</th>
                  <th>Action</th>
                  <th>Changed Fields</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {paginated.map(entry => {
                  const actionColor = ACTION_COLORS[entry.action] || { bg: '#f5f5f5', color: '#666' }
                  const roleColor = ROLE_COLORS[entry.actor_role] || { bg: '#f5f5f5', color: '#666' }
                  const isExpanded = expandedId === entry.id
                  const empName = entry.metadata?.employee_name || '—'
                  const changeType = entry.metadata?.change_type

                  // Count changed fields
                  let fieldCount = 0
                  let fieldNames: string[] = []
                  if (entry.old_data && typeof entry.old_data === 'object') {
                    fieldNames = Object.keys(entry.old_data)
                    fieldCount = fieldNames.length
                  }

                  return (
                    <React.Fragment key={entry.id}>
                      <tr style={{ cursor: fieldCount > 0 ? 'pointer' : 'default' }} onClick={() => fieldCount > 0 && setExpandedId(isExpanded ? null : entry.id)}>
                        <td style={{ fontSize: 12, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                          {new Date(entry.performed_at).toLocaleDateString('en-GB')}{' '}
                          {new Date(entry.performed_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td>
                          <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: roleColor.bg, color: roleColor.color }}>
                            {entry.actor_role.replace('_', ' ')}
                          </span>
                        </td>
                        <td style={{ fontSize: 13, fontWeight: 500 }}>{empName}</td>
                        <td>
                          <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: actionColor.bg, color: actionColor.color }}>
                            {changeType === 'deactivation' ? 'DEACTIVATION' : entry.action}
                          </span>
                        </td>
                        <td style={{ fontSize: 12, color: '#666' }}>
                          {fieldCount > 0 ? (
                            <span>
                              {fieldNames.slice(0, 3).map(f => formatFieldName(f)).join(', ')}
                              {fieldCount > 3 && ` +${fieldCount - 3} more`}
                            </span>
                          ) : '—'}
                        </td>
                        <td style={{ fontSize: 12, color: '#8b8fa3', width: 30, textAlign: 'center' }}>
                          {fieldCount > 0 ? (isExpanded ? '▼' : '▶') : ''}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={6} style={{ padding: 0 }}>
                            <div style={{ padding: '12px 16px', background: '#f8f9fc', borderTop: '1px solid #e5e7eb' }}>
                              {renderChangedFields(entry)}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
              <button className="admin-btn-sm" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} style={{ padding: '6px 12px', fontSize: 13 }}>
                Previous
              </button>
              {Array.from({ length: Math.min(totalPages, 10) }, (_, i) => {
                let page: number
                if (totalPages <= 10) {
                  page = i + 1
                } else if (currentPage <= 5) {
                  page = i + 1
                } else if (currentPage >= totalPages - 4) {
                  page = totalPages - 9 + i
                } else {
                  page = currentPage - 4 + i
                }
                return (
                  <button key={page} onClick={() => setCurrentPage(page)} style={{
                    padding: '6px 12px', fontSize: 13, fontWeight: currentPage === page ? 700 : 400,
                    background: currentPage === page ? '#1565c0' : '#f5f5f5', color: currentPage === page ? '#fff' : '#333',
                    border: 'none', borderRadius: 4, cursor: 'pointer',
                  }}>
                    {page}
                  </button>
                )
              })}
              <button className="admin-btn-sm" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} style={{ padding: '6px 12px', fontSize: 13 }}>
                Next
              </button>
              <span style={{ fontSize: 12, color: '#888', marginLeft: 8 }}>
                Showing {((currentPage - 1) * CHANGELOG_PAGE_SIZE) + 1}–{Math.min(currentPage * CHANGELOG_PAGE_SIZE, filtered.length)} of {filtered.length}
              </span>
            </div>
          )}
        </>
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

  const orgChartEmployees = useMemo(() => employees.filter(e => e.is_active), [employees])
  const roots = useMemo(() => buildTree(orgChartEmployees), [orgChartEmployees])

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

  const hasChildren = (id: string) => orgChartEmployees.some(e => e.manager_id === id)
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
                  background: emp.is_frozen ? '#e3f2fd' : 'var(--bg-card, #fff)',
                  border: `2px solid ${emp.is_frozen ? '#90caf9' : canExpand && expanded ? deptColor : 'var(--border, #d1d5db)'}`,
                  borderRadius: 10,
                  padding: '8px 10px',
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                  cursor: canExpand ? 'pointer' : 'default',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                  boxSizing: 'border-box',
                  opacity: emp.is_frozen ? 0.85 : 1,
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
                      {emp.is_frozen && (
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4,
                          background: '#bbdefb', color: '#1565c0',
                        }}>
                          Frozen
                        </span>
                      )}
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
