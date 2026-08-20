import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { useToast } from '../../context/ToastContext'
import {
  getCompanyFY, exportCompanyData, downloadCsv,
  validateImportCsv, importCompanyData,
  archiveCompanyData, deleteCompanyFYData,
} from '../../lib/companyArchive'

interface Company {
  id: string
  name: string
  domain: string
  microsoft_tenant_id: string | null
  is_active: boolean
  login_disabled: boolean
  created_at: string
  logo_url: string | null
  is_trial: boolean
  trial_start_date: string | null
  trial_end_date: string | null
  auth_mode: 'sso' | 'non_sso'
  nonsso_username: string | null
}

interface Employee {
  id: string
  first_name: string
  last_name: string
  email: string
  is_admin: boolean
}

interface CompanyAdminEntry {
  employee_id: string
  first_name: string
  last_name: string
  email: string
}

function generateUsername(companyName: string): string {
  const base = companyName.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12)
  const suffix = Math.floor(1000 + Math.random() * 9000)
  return `${base || 'user'}${suffix}`
}

function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%'
  let pwd = ''
  for (let i = 0; i < 16; i++) pwd += chars[Math.floor(Math.random() * chars.length)]
  return pwd
}

async function uploadCompanyLogo(companyId: string, file: File): Promise<string | null> {
  const ext = file.name.split('.').pop()?.toLowerCase() || 'png'
  const path = `${companyId}.${ext}`
  const { error } = await supabase.storage
    .from('company-logos')
    .upload(path, file, { upsert: true })
  if (error) return null
  const { data } = supabase.storage.from('company-logos').getPublicUrl(path)
  return data.publicUrl + '?t=' + Date.now()
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mql = window.matchMedia(query)
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [query])
  return matches
}

export default function AdminCompanies() {
  const { company: myCompany } = useAuth()
  const { refreshCompanies } = useAdminCompany()
  const { showError, showSuccess } = useToast()
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', domain: '', isTrial: false, trialStart: '', trialEnd: '', authMode: 'sso' as 'sso' | 'non_sso' })
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [admins, setAdmins] = useState<Record<string, CompanyAdminEntry[]>>({})
  const [employees, setEmployees] = useState<Record<string, Employee[]>>({})
  const [editingAdmin, setEditingAdmin] = useState<string | null>(null)
  const [savingAdmin, setSavingAdmin] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState<string | null>(null)
  const [exporting, setExporting] = useState<string | null>(null)
  const [archiving, setArchiving] = useState<string | null>(null)
  const [showArchiveConfirm, setShowArchiveConfirm] = useState<string | null>(null)
  const [importingFor, setImportingFor] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<{ success: boolean; message: string } | null>(null)
  const [editingCompany, setEditingCompany] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ name: '', domain: '' })
  const [savingEdit, setSavingEdit] = useState(false)
  const [createdCredentials, setCreatedCredentials] = useState<{ username: string; password: string; companyName: string } | null>(null)
  const logoInputRef = useRef<HTMLInputElement>(null)
  const editLogoRef = useRef<HTMLInputElement>(null)
  const importFileRef = useRef<HTMLInputElement>(null)

  const isMobile = useMediaQuery('(max-width: 1024px)')

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('companies')
      .select('*')
      .order('created_at', { ascending: false })
    const cos = (data as Company[]) || []
    setCompanies(cos)

    const adminMap: Record<string, CompanyAdminEntry[]> = {}
    const companyIds = cos.map(co => co.id)
    if (companyIds.length > 0) {
      const { data: allAdmins } = await supabase
        .from('company_users')
        .select('company_id, employee_id, employee:employees!company_users_employee_id_fkey(first_name, last_name, email)')
        .in('company_id', companyIds)
        .eq('role', 'admin')
      for (const co of cos) {
        const matches = (allAdmins || []).filter((a: any) => a.company_id === co.id)
        adminMap[co.id] = matches.map((cu: any) => {
          const emp = Array.isArray(cu.employee) ? cu.employee[0] : cu.employee
          return { employee_id: cu.employee_id, first_name: emp?.first_name || '', last_name: emp?.last_name || '', email: emp?.email || '' }
        })
      }
    }
    setAdmins(adminMap)
    setLoading(false)
  }

  async function loadEmployees(companyId: string) {
    if (employees[companyId]) return
    const { data } = await supabase
      .from('employees')
      .select('id, first_name, last_name, email, is_admin')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .order('first_name')
    setEmployees(prev => ({ ...prev, [companyId]: (data as Employee[]) || [] }))
  }

  useEffect(() => { load() }, [])

  function handleLogoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setLogoFile(file)
    const reader = new FileReader()
    reader.onload = ev => setLogoPreview(ev.target?.result as string)
    reader.readAsDataURL(file)
  }

  async function addCompany() {
    if (!form.name.trim()) return
    if (form.authMode === 'sso' && !form.domain.trim()) {
      showError('Email domain is required for SSO companies')
      return
    }
    if (form.isTrial && (!form.trialStart || !form.trialEnd)) {
      showError('Trial companies require both start and end dates')
      return
    }
    if (form.isTrial && form.trialEnd <= form.trialStart) {
      showError('Trial end date must be after start date')
      return
    }
    setSaving(true)
    const domain = form.authMode === 'sso' ? form.domain.trim().toLowerCase().replace(/^@/, '') : ''

    const isNonSso = form.authMode === 'non_sso'
    const username = isNonSso ? generateUsername(form.name) : null
    const password = isNonSso ? generatePassword() : null

    const insertPayload: Record<string, unknown> = {
      name: form.name.trim(),
      domain,
      microsoft_tenant_id: isNonSso ? null : `pending-${Date.now()}`,
      is_active: true,
      is_trial: form.isTrial,
      auth_mode: form.authMode,
    }
    if (isNonSso && username) {
      insertPayload.nonsso_username = username
    }
    if (form.isTrial) {
      insertPayload.trial_start_date = form.trialStart
      insertPayload.trial_end_date = form.trialEnd
    }
    const { data: newCo, error: insertError } = await supabase.from('companies').insert(insertPayload).select('id').single()

    if (insertError) {
      alert(`Failed to add company: ${insertError.message}`)
      setSaving(false)
      return
    }

    if (newCo) {
      if (isNonSso && username && password) {
        const email = `${username}@nonsso.inflowhr.local`
        const { data: rpcResult, error: rpcErr } = await supabase.rpc('create_nonsso_account' as any, {
          p_email: email,
          p_password: password,
          p_company_id: newCo.id,
          p_company_name: form.name.trim(),
        })
        const rpcData = rpcResult as { success?: boolean; error?: string; employee_id?: string } | null
        if (rpcErr) {
          showError('Company created but failed to create login account: ' + rpcErr.message)
        } else if (rpcData?.error) {
          showError('Company created but failed to create login account: ' + rpcData.error)
        } else {
          setCreatedCredentials({ username: email, password, companyName: form.name.trim() })

          if (form.isTrial && rpcData?.employee_id) {
            await supabase.from('onboarding').insert({
              firstname: form.name.trim(),
              surname: 'Admin',
              user_email: email,
              job_title: 'Company Administrator',
              department: 'Administration',
              status: 'Onboarded',
              appstatus: 'active',
              is_complete: true,
              first_day: true,
              first_week: true,
              first_month: true,
              elearning: true,
              company_id: newCo.id,
            })

            const now = new Date()
            const { data: leaveTypes } = await supabase.from('leave_types').select('id, deducts_from_allowance').eq('company_id', newCo.id)
            if (leaveTypes && leaveTypes.length > 0) {
              await supabase.from('leave_balances').insert(
                leaveTypes.map(lt => ({
                  employee_id: rpcData.employee_id,
                  leave_type_id: lt.id,
                  year: now.getFullYear(),
                  total_allowance: lt.deducts_from_allowance ? 25 : 0,
                  used: 0,
                  carried_over: 0,
                  company_id: newCo.id,
                }))
              )
            }
          }
        }
      }

      if (logoFile) {
        const logoUrl = await uploadCompanyLogo(newCo.id, logoFile)
        if (logoUrl) {
          const { error } = await supabase.from('companies').update({ logo_url: logoUrl }).eq('id', newCo.id)
          if (error) showError('Failed to save company logo: ' + error.message)
        }
      }

      const { error: leaveTypesError } = await supabase.from('leave_types').insert([
        { name: 'Annual Leave', company_id: newCo.id, deducts_from_allowance: true },
        { name: 'Sick Leave', company_id: newCo.id, deducts_from_allowance: false },
        { name: 'Jury Duty', company_id: newCo.id, deducts_from_allowance: false },
        { name: 'Bereavement', company_id: newCo.id, deducts_from_allowance: true },
        { name: 'Exam Leave', company_id: newCo.id, deducts_from_allowance: true },
        { name: 'Carers Leave', company_id: newCo.id, deducts_from_allowance: true },
        { name: 'Career Break', company_id: newCo.id, deducts_from_allowance: true },
        { name: 'Lieu Days', company_id: newCo.id, deducts_from_allowance: false },
      ])
      if (leaveTypesError) showError('Failed to create default leave types: ' + leaveTypesError.message)

      const allFeatureKeys = [
        'expenses', 'leave', 'kudos', 'elearning', 'timesheets',
        'payroll', 'performance', 'shifts', 'benefits', 'legal_timesheets',
        'space_booking', 'asset_management',
      ]
      const defaultEnabled = ['expenses', 'leave', 'kudos', 'elearning', 'timesheets']
      const featureRows = allFeatureKeys.map(key => ({
        company_id: newCo.id,
        feature_key: key,
        is_enabled: form.isTrial ? true : defaultEnabled.includes(key),
        custom_price: form.isTrial ? 0 : null,
      }))
      const { error: featuresError } = await supabase.from('company_features').insert(featureRows)
      if (featuresError) showError('Failed to create default company features: ' + featuresError.message)

      if (form.isTrial) {
        const { data: pricingRows } = await supabase.from('subscription_pricing').select('feature_key').eq('is_addon', false)
        const coreKey = pricingRows?.[0]?.feature_key || 'hr_core'
        await supabase.from('company_features').upsert({
          company_id: newCo.id,
          feature_key: coreKey,
          is_enabled: true,
          custom_price: 0,
        }, { onConflict: 'company_id,feature_key' })
      }

      await supabase.from('announcements').insert({
        title: 'Welcome to your new HR App',
        body: "Take a look within 'Settings' and choose the guide to get to know your app and its features.",
        submitted_by_name: 'InflowHR',
        is_pinned: true,
        company_id: newCo.id,
      })
    }

    setForm({ name: '', domain: '', isTrial: false, trialStart: '', trialEnd: '', authMode: 'sso' })
    setLogoFile(null)
    setLogoPreview(null)
    setShowForm(false)
    setSaving(false)
    load()
    refreshCompanies()
    showSuccess('Company registered successfully')
  }

  async function handleEditLogo(companyId: string, file: File) {
    setUploadingLogo(companyId)
    const logoUrl = await uploadCompanyLogo(companyId, file)
    if (logoUrl) {
      const { error } = await supabase.from('companies').update({ logo_url: logoUrl }).eq('id', companyId)
      if (error) {
        showError('Failed to save company logo: ' + error.message)
        setUploadingLogo(null)
        return
      }
    }
    setUploadingLogo(null)
    load()
  }

  async function removeLogo(companyId: string) {
    const { error } = await supabase.from('companies').update({ logo_url: null }).eq('id', companyId)
    if (error) { showError('Failed to remove logo: ' + error.message); return }
    load()
  }

  async function toggleActive(id: string, currentlyActive: boolean) {
    if (id === myCompany?.id && currentlyActive) {
      alert('You cannot disable your own company.')
      return
    }
    const { error } = await supabase.from('companies').update({ is_active: !currentlyActive }).eq('id', id)
    if (error) { showError('Failed to update company status: ' + error.message); return }
    load()
  }

  async function deleteCompany(id: string) {
    if (id === myCompany?.id) {
      alert('You cannot delete your own company.')
      return
    }
    const company = companies.find(c => c.id === id)
    if (!confirm(`Delete "${company?.name || 'this company'}" and ALL its data? This cannot be undone.`)) return
    await supabase.from('benefit_enrollments').delete().eq('company_id', id)
    await supabase.from('benefit_options').delete().eq('company_id', id)
    await supabase.from('benefit_types').delete().eq('company_id', id)
    await supabase.from('shift_swap_requests').delete().eq('company_id', id)
    await supabase.from('shift_assignments').delete().eq('company_id', id)
    await supabase.from('shift_templates').delete().eq('company_id', id)
    await supabase.from('rotas').delete().eq('company_id', id)
    await supabase.from('employee_availability').delete().eq('company_id', id)
    await supabase.from('legal_timesheet_entries').delete().eq('company_id', id)
    await supabase.from('legal_matters').delete().eq('company_id', id)
    await supabase.from('legal_clients').delete().eq('company_id', id)
    await supabase.from('hr_tickets').delete().eq('company_id', id)
    await supabase.from('company_features').delete().eq('company_id', id)
    await supabase.from('company_elearning_courses').delete().eq('company_id', id)
    await supabase.from('benefits').delete().eq('company_id', id)
    await supabase.from('courses').delete().eq('company_id', id)
    const { error } = await supabase.rpc('delete_company_data' as any, { p_company_id: id })
    if (error) {
      alert('Error deleting company: ' + error.message)
      return
    }
    load()
    refreshCompanies()
  }

  async function toggleLoginDisabled(id: string, currentlyDisabled: boolean) {
    if (id === myCompany?.id && !currentlyDisabled) {
      alert('You cannot disable login for your own company.')
      return
    }
    const { error } = await supabase.from('companies').update({ login_disabled: !currentlyDisabled }).eq('id', id)
    if (error) { showError('Failed to update login status: ' + error.message); return }
    load()
  }

  async function startEditAdmin(companyId: string) {
    await loadEmployees(companyId)
    setEditingAdmin(companyId)
  }

  async function addAdmin(companyId: string, employeeId: string) {
    setSavingAdmin(true)

    const { error: promoteEmpError } = await supabase
      .from('employees')
      .update({ is_admin: true })
      .eq('id', employeeId)
    if (promoteEmpError) {
      showError('Failed to assign admin: ' + promoteEmpError.message)
      setSavingAdmin(false)
      return
    }

    const { data: cuByEmp } = await supabase
      .from('company_users')
      .select('id')
      .eq('company_id', companyId)
      .eq('employee_id', employeeId)
      .maybeSingle()

    if (cuByEmp) {
      const { error } = await supabase
        .from('company_users')
        .update({ role: 'admin' })
        .eq('id', cuByEmp.id)
      if (error) showError('Failed to assign admin: ' + error.message)
    } else {
      const { error } = await supabase
        .from('company_users')
        .insert({ company_id: companyId, employee_id: employeeId, role: 'admin', is_active: true })
      if (error) showError('Failed to assign admin: ' + error.message)
    }

    setEditingAdmin(null)
    setSavingAdmin(false)
    setEmployees(prev => { const next = { ...prev }; delete next[companyId]; return next })
    load()
    showSuccess('Admin added')
  }

  async function removeAdmin(companyId: string, employeeId: string) {
    setSavingAdmin(true)

    const { error: demoteEmpError } = await supabase
      .from('employees')
      .update({ is_admin: false })
      .eq('id', employeeId)
    if (demoteEmpError) {
      showError('Failed to remove admin: ' + demoteEmpError.message)
      setSavingAdmin(false)
      return
    }

    const { error: demoteCuError } = await supabase
      .from('company_users')
      .update({ role: 'employee' })
      .eq('company_id', companyId)
      .eq('employee_id', employeeId)
    if (demoteCuError) showError('Failed to remove admin: ' + demoteCuError.message)

    setSavingAdmin(false)
    setEmployees(prev => { const next = { ...prev }; delete next[companyId]; return next })
    load()
    showSuccess('Admin removed')
  }

  function startEditCompany(c: Company) {
    setEditingCompany(c.id)
    setEditForm({ name: c.name, domain: c.domain })
  }

  async function saveEditCompany(id: string) {
    if (!editForm.name.trim()) { showError('Company name is required'); return }
    setSavingEdit(true)
    const updates: Record<string, unknown> = { name: editForm.name.trim() }
    const co = companies.find(c => c.id === id)
    if (co?.auth_mode === 'sso') {
      if (!editForm.domain.trim()) { showError('Email domain is required for SSO companies'); setSavingEdit(false); return }
      updates.domain = editForm.domain.trim().toLowerCase().replace(/^@/, '')
    }
    const { error } = await supabase.from('companies').update(updates).eq('id', id)
    if (error) { showError('Failed to update company: ' + error.message); setSavingEdit(false); return }
    setEditingCompany(null)
    setSavingEdit(false)
    load()
    refreshCompanies()
    showSuccess('Company updated')
  }

  async function handleExport(companyId: string, companyName: string) {
    if (!confirm(`This export includes personal data (names, emails, NI numbers, bank details, salary, leave records).\n\nThis action will be logged for GDPR compliance.\n\nProceed with export for ${companyName}?`)) return
    setExporting(companyId)
    try {
      const fy = await getCompanyFY(companyId)
      const csv = await exportCompanyData(companyId, companyName, fy)
      const safeName = companyName.replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-')
      downloadCsv(csv, `${safeName}-Export-${fy.label.replace(/\s/g, '-')}.csv`)
      await supabase.rpc('log_gdpr_action' as any, {
        p_company_id: companyId,
        p_table_name: 'company_export',
        p_record_id: companyId,
        p_action: 'FULL_DATA_EXPORT',
        p_metadata: { fy_label: fy.label, format: 'csv' },
      })
      showSuccess(`Export downloaded for ${companyName} (${fy.label})`)
    } catch {
      showError('Export failed — please try again')
    }
    setExporting(null)
  }

  async function handleArchive(companyId: string, companyName: string, deleteData: boolean) {
    setShowArchiveConfirm(null)
    setArchiving(companyId)
    try {
      const fy = await getCompanyFY(companyId)
      const result = await archiveCompanyData(companyId, companyName, fy)
      if (!result.success) {
        showError('Archive failed: ' + (result.error || 'Unknown error'))
        setArchiving(null)
        return
      }
      if (deleteData) {
        const delResult = await deleteCompanyFYData(companyId, fy)
        if (delResult.errors.length > 0) {
          showError(`Archive saved but ${delResult.errors.length} table(s) failed to delete`)
        } else {
          showSuccess(`Archived & deleted ${delResult.deleted} record(s) for ${companyName}`)
        }
      } else {
        showSuccess(`Archive saved for ${companyName} (${fy.label})`)
      }
    } catch {
      showError('Archive failed — please try again')
    }
    setArchiving(null)
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    const companyId = importingFor
    e.target.value = ''
    if (!file || !companyId) return
    setImportingFor(null)

    const text = await file.text()
    const validation = validateImportCsv(text)
    if (!validation.valid) {
      setImportResult({ success: false, message: 'Validation failed:\n' + validation.errors.join('\n') })
      return
    }

    const company = companies.find(c => c.id === companyId)
    if (!confirm(
      `Import ${validation.tables.reduce((s, t) => s + t.rowCount, 0)} rows across ${validation.tables.length} tables into "${company?.name}"?\n\nSource: ${validation.companyName} (${validation.fyLabel})`
    )) return

    const result = await importCompanyData(text, companyId)
    if (result.success) {
      setImportResult({ success: true, message: `Successfully imported ${result.imported} records` })
      showSuccess(`Imported ${result.imported} records into ${company?.name}`)
    } else {
      setImportResult({ success: false, message: `Imported ${result.imported} records with errors:\n${result.errors.join('\n')}` })
      showError(`Import completed with ${result.errors.length} error(s)`)
    }
  }

  function renderAdminsCell(c: Company) {
    const companyAdmins = admins[c.id] || []
    const isEditing = editingAdmin === c.id
    const emps = employees[c.id] || []
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {companyAdmins.map(a => (
          <div key={a.employee_id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 13 }}>{a.first_name} {a.last_name}</span>
            <button
              className="admin-btn-icon admin-btn-danger"
              title={`Remove ${a.first_name} as admin`}
              onClick={() => removeAdmin(c.id, a.employee_id)}
              disabled={savingAdmin}
              style={{ flexShrink: 0 }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        ))}
        {companyAdmins.length === 0 && (
          <span className="admin-no-admin">No admin assigned</span>
        )}
        {isEditing ? (
          <div className="admin-edit-admin-cell">
            <select
              className="admin-inline-select admin-admin-select"
              defaultValue=""
              onChange={e => { if (e.target.value) addAdmin(c.id, e.target.value) }}
              disabled={savingAdmin}
            >
              <option value="">Select employee...</option>
              {emps.filter(emp => !companyAdmins.some(a => a.employee_id === emp.id)).map(emp => (
                <option key={emp.id} value={emp.id}>
                  {emp.first_name} {emp.last_name} ({emp.email})
                </option>
              ))}
            </select>
            <button className="admin-btn-sm admin-btn-cancel" onClick={() => setEditingAdmin(null)}>
              Cancel
            </button>
          </div>
        ) : (
          <button
            className="admin-btn-sm"
            style={{ background: '#1565c0', color: '#fff', border: 'none', fontSize: 12, padding: '3px 8px', alignSelf: 'flex-start' }}
            onClick={() => startEditAdmin(c.id)}
          >
            + Add Admin
          </button>
        )}
      </div>
    )
  }

  function renderTrialBadge(c: Company) {
    if (!c.is_trial) return <span style={{ color: '#bbb', fontSize: 12 }}>—</span>
    const expired = c.trial_end_date && new Date(c.trial_end_date) < new Date()
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span className="admin-badge" style={{
          background: expired ? '#ffebee' : '#e3f2fd',
          color: expired ? '#c62828' : '#1565c0',
          fontWeight: 600,
        }}>
          {expired ? 'Expired' : 'Trial'}
        </span>
        {c.trial_end_date && (
          <span style={{ fontSize: 11, color: '#999' }}>
            Ends {new Date(c.trial_end_date).toLocaleDateString('en-GB')}
          </span>
        )}
      </div>
    )
  }

  function renderAuthBadge(c: Company) {
    if (c.auth_mode === 'non_sso') {
      return (
        <span className="admin-badge" style={{ background: '#fff3e0', color: '#e65100', fontWeight: 600 }}>
          Non-SSO
        </span>
      )
    }
    return (
      <span className="admin-badge" style={{ background: '#e8f5e9', color: '#2e7d32', fontWeight: 600 }}>
        SSO
      </span>
    )
  }

  function renderActionButtons(c: Company) {
    return (
      <>
        <button
          className="admin-btn-sm"
          style={{ background: '#1565c0', color: '#fff', border: 'none' }}
          title="Edit company details"
          onClick={() => startEditCompany(c)}
        >
          Edit
        </button>
        <button
          className="admin-btn-sm"
          style={{ background: '#1565c0', color: '#fff', border: 'none' }}
          title="Export company data as CSV"
          onClick={() => handleExport(c.id, c.name)}
          disabled={exporting === c.id}
        >
          {exporting === c.id ? 'Exporting...' : 'Export'}
        </button>
        <button
          className="admin-btn-sm"
          style={{ background: '#2e7d32', color: '#fff', border: 'none' }}
          title="Import data from CSV"
          onClick={() => {
            setImportingFor(c.id)
            importFileRef.current?.click()
          }}
        >
          Import
        </button>
        <button
          className="admin-btn-sm"
          style={{ background: '#e65100', color: '#fff', border: 'none' }}
          title="Archive company FY data"
          onClick={() => setShowArchiveConfirm(c.id)}
          disabled={archiving === c.id}
        >
          {archiving === c.id ? 'Archiving...' : 'Archive'}
        </button>
        <button
          className={`admin-btn-sm ${c.is_active ? 'admin-btn-cancel' : 'admin-btn-save'}`}
          onClick={() => toggleActive(c.id, c.is_active)}
        >
          {c.is_active ? 'Disable' : 'Enable'}
        </button>
        <button
          className="admin-btn-icon admin-btn-danger"
          onClick={() => deleteCompany(c.id)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      </>
    )
  }

  function renderLogoCell(c: Company) {
    return (
      <div className="admin-logo-cell">
        {c.logo_url ? (
          <div className="admin-logo-cell-wrap">
            <img src={c.logo_url} alt={c.name} className="admin-logo-thumb" />
            <div className="admin-logo-cell-actions">
              <button
                className="admin-btn-icon"
                title="Change logo"
                onClick={() => {
                  const input = editLogoRef.current
                  if (input) {
                    input.setAttribute('data-company-id', c.id)
                    input.click()
                  }
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </button>
              <button
                className="admin-btn-icon admin-btn-danger"
                title="Remove logo"
                onClick={() => removeLogo(c.id)}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>
        ) : (
          <button
            className="admin-logo-upload-sm"
            onClick={() => {
              const input = editLogoRef.current
              if (input) {
                input.setAttribute('data-company-id', c.id)
                input.click()
              }
            }}
          >
            {uploadingLogo === c.id ? '...' : '+'}
          </button>
        )}
      </div>
    )
  }

  function renderCardView() {
    return (
      <div className="admin-co-cards">
        {companies.map(c => (
          <div key={c.id} className="admin-co-card">
            <div className="admin-co-card-header">
              {c.logo_url ? (
                <img src={c.logo_url} alt={c.name} style={{ width: 40, height: 40, borderRadius: 8, objectFit: 'contain' }} />
              ) : (
                <div className="admin-co-card-logo-placeholder" onClick={() => {
                  const input = editLogoRef.current
                  if (input) { input.setAttribute('data-company-id', c.id); input.click() }
                }} style={{ cursor: 'pointer' }}>
                  {uploadingLogo === c.id ? '...' : '+'}
                </div>
              )}
              <div className="admin-co-card-info">
                {editingCompany === c.id ? (
                  <input
                    className="admin-input"
                    value={editForm.name}
                    onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                    style={{ fontSize: 14, fontWeight: 700, padding: '4px 8px' }}
                  />
                ) : (
                  <div className="admin-co-card-name">{c.name}</div>
                )}
                {editingCompany === c.id && c.auth_mode === 'sso' ? (
                  <input
                    className="admin-input"
                    value={editForm.domain}
                    onChange={e => setEditForm(f => ({ ...f, domain: e.target.value }))}
                    style={{ fontSize: 12, padding: '3px 8px', marginTop: 4 }}
                  />
                ) : (
                  <div className="admin-co-card-domain">{c.auth_mode === 'non_sso' ? 'Non-SSO' : c.domain}</div>
                )}
              </div>
              <div className="admin-co-card-badges">
                <span className={`admin-badge ${c.is_active ? 'admin-badge-approved' : 'admin-badge-rejected'}`}>
                  {c.is_active ? 'Active' : 'Disabled'}
                </span>
                {renderAuthBadge(c)}
              </div>
            </div>

            {editingCompany === c.id && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <button className="admin-btn-sm admin-btn-save" onClick={() => saveEditCompany(c.id)} disabled={savingEdit}>
                  {savingEdit ? 'Saving...' : 'Save'}
                </button>
                <button className="admin-btn-sm admin-btn-cancel" onClick={() => setEditingCompany(null)}>Cancel</button>
              </div>
            )}

            <div className="admin-co-card-grid">
              <div className="admin-co-card-field">
                <label>Trial</label>
                {renderTrialBadge(c)}
              </div>
              <div className="admin-co-card-field">
                <label>Login</label>
                <label className="admin-toggle-switch">
                  <input type="checkbox" checked={!c.login_disabled} onChange={() => toggleLoginDisabled(c.id, c.login_disabled)} />
                  <span className="admin-toggle-slider" />
                </label>
              </div>
              <div className="admin-co-card-field">
                <label>Registered</label>
                <span>{new Date(c.created_at).toLocaleDateString('en-GB')}</span>
              </div>
              {c.auth_mode === 'non_sso' && c.nonsso_username && (
                <div className="admin-co-card-field">
                  <label>Login Account</label>
                  <span style={{ fontSize: 12, fontFamily: 'monospace', wordBreak: 'break-all' }}>{c.nonsso_username}</span>
                </div>
              )}
              <div className="admin-co-card-admins admin-co-card-field">
                <label>Company Admins</label>
                {renderAdminsCell(c)}
              </div>
            </div>

            <div className="admin-co-card-actions">
              {renderActionButtons(c)}
            </div>
          </div>
        ))}
        {companies.length === 0 && <div className="admin-empty">No companies registered</div>}
      </div>
    )
  }

  function renderTableView() {
    return (
      <div className="admin-table-wrap admin-co-table-wrap">
        <table className="admin-table admin-co-table">
          <thead>
            <tr>
              <th>Logo</th>
              <th>Company</th>
              <th>Domain</th>
              <th>Auth</th>
              <th>Company Admins</th>
              <th>Status</th>
              <th>Trial</th>
              <th>Login</th>
              <th>Registered</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {companies.map(c => (
              <tr key={c.id} className="admin-co-row">
                <td data-label="Logo">{renderLogoCell(c)}</td>
                <td data-label="Company">
                  {editingCompany === c.id ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <input
                        className="admin-input"
                        value={editForm.name}
                        onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                        style={{ fontSize: 13, padding: '4px 8px', fontWeight: 700 }}
                      />
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="admin-btn-sm admin-btn-save" onClick={() => saveEditCompany(c.id)} disabled={savingEdit}>
                          {savingEdit ? '...' : 'Save'}
                        </button>
                        <button className="admin-btn-sm admin-btn-cancel" onClick={() => setEditingCompany(null)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <strong>{c.name}</strong>
                  )}
                </td>
                <td data-label="Domain">
                  {editingCompany === c.id && c.auth_mode === 'sso' ? (
                    <input
                      className="admin-input"
                      value={editForm.domain}
                      onChange={e => setEditForm(f => ({ ...f, domain: e.target.value }))}
                      style={{ fontSize: 13, padding: '4px 8px' }}
                    />
                  ) : (
                    c.auth_mode === 'non_sso' ? <span style={{ color: '#999', fontSize: 12 }}>—</span> : c.domain
                  )}
                </td>
                <td data-label="Auth">{renderAuthBadge(c)}</td>
                <td data-label="Company Admins">{renderAdminsCell(c)}</td>
                <td data-label="Status">
                  <span className={`admin-badge ${c.is_active ? 'admin-badge-approved' : 'admin-badge-rejected'}`}>
                    {c.is_active ? 'Active' : 'Disabled'}
                  </span>
                </td>
                <td data-label="Trial">{renderTrialBadge(c)}</td>
                <td data-label="Login">
                  <label className="admin-toggle-switch">
                    <input type="checkbox" checked={!c.login_disabled} onChange={() => toggleLoginDisabled(c.id, c.login_disabled)} />
                    <span className="admin-toggle-slider" />
                  </label>
                </td>
                <td data-label="Registered">{new Date(c.created_at).toLocaleDateString('en-GB')}</td>
                <td data-label="Actions" className="admin-actions">
                  {renderActionButtons(c)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {companies.length === 0 && <div className="admin-empty">No companies registered</div>}
      </div>
    )
  }

  return (
    <div className="admin-section">
      <div className="admin-page-header">
        <h2>Company Management</h2>
        <p>Manage which organisations can access InflowHR</p>
      </div>

      <div style={{ marginBottom: 20 }}>
        {!showForm ? (
          <button className="admin-btn admin-btn-primary" onClick={() => setShowForm(true)}>
            + Register New Company
          </button>
        ) : (
          <div className="admin-add-form">
            <h3>Register New Company</h3>
            <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: '#555' }}>Authentication</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <label className="admin-toggle-switch">
                    <input type="checkbox" checked={form.authMode === 'non_sso'} onChange={e => setForm(f => ({ ...f, authMode: e.target.checked ? 'non_sso' : 'sso', domain: e.target.checked ? '' : f.domain }))} />
                    <span className="admin-toggle-slider" />
                  </label>
                  <span style={{ fontSize: 13, color: form.authMode === 'non_sso' ? '#e65100' : '#2e7d32', fontWeight: 600 }}>
                    {form.authMode === 'non_sso' ? 'Non-SSO' : 'SSO (Microsoft)'}
                  </span>
                </div>
              </div>
            </div>

            {form.authMode === 'sso' && (
              <p style={{ color: '#666', fontSize: 13, marginBottom: 16 }}>
                Add a company domain to allow their employees to sign in with Microsoft SSO.
                The Microsoft tenant ID will be captured automatically on first login.
              </p>
            )}
            {form.authMode === 'non_sso' && (
              <div style={{ background: '#fff3e0', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#e65100' }}>
                Non-SSO mode will auto-generate a unique username and password for this company.
                Employees will not require a work email — a unique employee ID will be used instead.
              </div>
            )}
            <div className="admin-form-grid">
              <div className="admin-form-field">
                <label>Company Name *</label>
                <input
                  className="admin-input"
                  placeholder="e.g. Acme Corp"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                />
              </div>
              {form.authMode === 'sso' && (
                <div className="admin-form-field">
                  <label>Email Domain *</label>
                  <input
                    className="admin-input"
                    placeholder="e.g. acme.com"
                    value={form.domain}
                    onChange={e => setForm(f => ({ ...f, domain: e.target.value }))}
                  />
                </div>
              )}
              <div className="admin-form-field">
                <label>Company Logo</label>
                <div className="admin-logo-upload">
                  {logoPreview ? (
                    <div className="admin-logo-preview-wrap">
                      <img src={logoPreview} alt="Logo preview" className="admin-logo-preview" />
                      <button className="admin-logo-remove" onClick={() => { setLogoFile(null); setLogoPreview(null) }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round">
                          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                  ) : (
                    <button className="admin-logo-upload-btn" onClick={() => logoInputRef.current?.click()}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                        <circle cx="8.5" cy="8.5" r="1.5" />
                        <polyline points="21 15 16 10 5 21" />
                      </svg>
                      <span>Upload logo</span>
                    </button>
                  )}
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={handleLogoSelect}
                  />
                </div>
              </div>
              <div className="admin-form-field">
                <label>Trial</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <label className="admin-toggle-switch">
                    <input type="checkbox" checked={form.isTrial} onChange={e => setForm(f => ({ ...f, isTrial: e.target.checked }))} />
                    <span className="admin-toggle-slider" />
                  </label>
                  <span style={{ fontSize: 13, color: form.isTrial ? '#1565c0' : '#999', fontWeight: 600 }}>
                    {form.isTrial ? 'Yes' : 'No'}
                  </span>
                </div>
              </div>
              {form.isTrial && (
                <>
                  <div className="admin-form-field">
                    <label>Trial Start Date</label>
                    <input
                      className="admin-input"
                      type="date"
                      value={form.trialStart}
                      onChange={e => setForm(f => ({ ...f, trialStart: e.target.value }))}
                    />
                  </div>
                  <div className="admin-form-field">
                    <label>Trial End Date</label>
                    <input
                      className="admin-input"
                      type="date"
                      value={form.trialEnd}
                      onChange={e => setForm(f => ({ ...f, trialEnd: e.target.value }))}
                    />
                  </div>
                </>
              )}
            </div>
            {form.isTrial && (
              <div style={{ background: '#e3f2fd', borderRadius: 8, padding: '10px 14px', marginTop: 12, fontSize: 13, color: '#1565c0' }}>
                Trial companies receive all features (including add-ons) enabled at £0 for the trial period.
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="admin-btn admin-btn-primary" onClick={addCompany} disabled={saving}>
                {saving ? 'Saving...' : 'Register Company'}
              </button>
              <button className="admin-btn" onClick={() => { setShowForm(false); setLogoFile(null); setLogoPreview(null); setForm({ name: '', domain: '', isTrial: false, trialStart: '', trialEnd: '', authMode: 'sso' }) }}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      {loading ? <div className="admin-loading">Loading...</div> : (
        isMobile ? renderCardView() : renderTableView()
      )}

      <input
        ref={editLogoRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={e => {
          const file = e.target.files?.[0]
          const companyId = e.target.getAttribute('data-company-id')
          if (file && companyId) handleEditLogo(companyId, file)
          e.target.value = ''
        }}
      />

      <input
        ref={importFileRef}
        type="file"
        accept=".csv"
        style={{ display: 'none' }}
        onChange={handleImportFile}
      />

      {showArchiveConfirm && (() => {
        const company = companies.find(c => c.id === showArchiveConfirm)
        return (
          <div className="admin-modal-overlay" onClick={() => setShowArchiveConfirm(null)}>
            <div className="admin-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
              <h3 style={{ margin: '0 0 12px' }}>Archive {company?.name}</h3>
              <p style={{ fontSize: 14, color: '#555', margin: '0 0 16px' }}>
                This will create a CSV archive of all company data for the current financial year
                and save it to the company documents folder.
              </p>
              <p style={{ fontSize: 13, color: '#c62828', fontWeight: 600, margin: '0 0 16px' }}>
                Would you also like to delete the company's FY data after archiving?
                Employees and user accounts will be kept.
              </p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  className="admin-btn"
                  onClick={() => setShowArchiveConfirm(null)}
                >
                  Cancel
                </button>
                <button
                  className="admin-btn admin-btn-primary"
                  onClick={() => handleArchive(showArchiveConfirm, company?.name || '', false)}
                >
                  Archive Only
                </button>
                <button
                  className="admin-btn"
                  style={{ background: '#c62828', color: '#fff', border: 'none' }}
                  onClick={() => handleArchive(showArchiveConfirm, company?.name || '', true)}
                >
                  Archive & Delete Data
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {importResult && (
        <div className="admin-modal-overlay" onClick={() => setImportResult(null)}>
          <div className="admin-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <h3 style={{ margin: '0 0 12px', color: importResult.success ? '#2e7d32' : '#c62828' }}>
              {importResult.success ? 'Import Complete' : 'Import Issues'}
            </h3>
            <pre style={{ fontSize: 13, whiteSpace: 'pre-wrap', background: '#f5f5f5', padding: 12, borderRadius: 6, margin: '0 0 16px' }}>
              {importResult.message}
            </pre>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="admin-btn admin-btn-primary" onClick={() => setImportResult(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {createdCredentials && (
        <div className="admin-modal-overlay" onClick={() => setCreatedCredentials(null)}>
          <div className="admin-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 500 }}>
            <h3 style={{ margin: '0 0 12px', color: '#2e7d32' }}>
              Non-SSO Account Created
            </h3>
            <p style={{ fontSize: 14, color: '#555', margin: '0 0 16px' }}>
              Login credentials for <strong>{createdCredentials.companyName}</strong> have been created.
              Save these details securely — the password cannot be retrieved later.
            </p>
            <div style={{ background: '#f5f5f5', borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, color: '#999', textTransform: 'uppercase', fontWeight: 600, display: 'block', marginBottom: 2 }}>Username</label>
                <code style={{ fontSize: 14, fontFamily: 'monospace', wordBreak: 'break-all' }}>{createdCredentials.username}</code>
              </div>
              <div>
                <label style={{ fontSize: 11, color: '#999', textTransform: 'uppercase', fontWeight: 600, display: 'block', marginBottom: 2 }}>Password</label>
                <code style={{ fontSize: 14, fontFamily: 'monospace', wordBreak: 'break-all' }}>{createdCredentials.password}</code>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="admin-btn admin-btn-primary" onClick={() => setCreatedCredentials(null)}>
                I've Saved These Details
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
