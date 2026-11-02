import { useState, useEffect, useCallback } from 'react'
import { supabase, callRpcDirect } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { useToast } from '../../context/ToastContext'
import { useNavigate } from 'react-router-dom'

interface ManagedCompany {
  id: string
  msp_managed_id: string
  name: string
  domain: string
  is_active: boolean
  is_trial: boolean
  employee_count: number
  onboarded_at: string | null
  consent_status: 'pending' | 'approved' | 'rejected'
}

interface MspUserAccessRow {
  id: string
  employee_id: string
  managed_company_id: string
  permissions: Record<string, boolean>
  is_active: boolean
  employee_name: string
  employee_email: string
}

interface MspStats {
  managed_count: number
  total_employees: number
  active_companies: number
  trial_companies: number
}

interface MspCompanyOption {
  id: string
  name: string
  msp_tier: string | null
  msp_wholesale_discount: number | null
}

export default function AdminMSPDashboard() {
  const { isSuperAdmin, isMspAdmin, mspCompanyId } = useAuth()
  const { setSelectedCompanyId } = useAdminCompany()
  const { showToast } = useToast()
  const navigate = useNavigate()

  const [managedCompanies, setManagedCompanies] = useState<ManagedCompany[]>([])
  const [mspUsers, setMspUsers] = useState<MspUserAccessRow[]>([])
  const [stats, setStats] = useState<MspStats>({ managed_count: 0, total_employees: 0, active_companies: 0, trial_companies: 0 })
  const [loading, setLoading] = useState(true)
  const [mspCompanyName, setMspCompanyName] = useState('')
  const [mspTier, setMspTier] = useState<string | null>(null)
  const [mspDiscount, setMspDiscount] = useState<number | null>(null)
  const [activeTab, setActiveTab] = useState<'companies' | 'users' | 'audit'>('companies')
  const [auditLog, setAuditLog] = useState<{ id: string; action: string; actor_id: string; managed_company_id: string; details: any; created_at: string }[]>([])
  const [auditLoading, setAuditLoading] = useState(false)

  const [grantEmail, setGrantEmail] = useState('')
  const [grantCompanyId, setGrantCompanyId] = useState('')
  const [granting, setGranting] = useState(false)

  // Super admin: list of MSP companies to choose from
  const [mspCompanies, setMspCompanies] = useState<MspCompanyOption[]>([])
  const [selectedMspId, setSelectedMspId] = useState<string | null>(null)

  // Add client company form
  const [allCompanies, setAllCompanies] = useState<{ id: string; name: string }[]>([])
  const [addClientCompanyId, setAddClientCompanyId] = useState('')
  const [addingClient, setAddingClient] = useState(false)

  // Onboard new client form
  const [showOnboardForm, setShowOnboardForm] = useState(false)
  const [onboardForm, setOnboardForm] = useState({ name: '', domain: '', authMode: 'sso' as 'sso' | 'non_sso', timezone: 'Europe/London', date_format: 'DD/MM/YYYY', currency: 'GBP', isTrial: false, trialStart: '', trialEnd: '' })
  const [onboarding, setOnboarding] = useState(false)

  const effectiveMspId = mspCompanyId || selectedMspId

  // Super admin: load list of MSP companies (super admins can view but need MSP grant to manage)
  useEffect(() => {
    if (!isSuperAdmin) return
    ;(async () => {
      const { data } = await supabase
        .from('companies')
        .select('id, name, msp_tier, msp_wholesale_discount')
        .eq('is_msp', true)
        .order('name')
      const mspList = (data || []) as any as MspCompanyOption[]
      setMspCompanies(mspList)
      if (mspList.length === 1 && !mspCompanyId) {
        setSelectedMspId(mspList[0].id)
      }
    })()
  }, [isSuperAdmin, mspCompanyId])

  // Load all non-MSP companies for the "add client" dropdown (available to MSP admins)
  useEffect(() => {
    if (!effectiveMspId) return
    ;(async () => {
      const { data } = await supabase
        .from('companies')
        .select('id, name')
        .neq('id', effectiveMspId)
        .eq('is_active', true)
        .order('name')
      setAllCompanies((data || []) as any[])
    })()
  }, [effectiveMspId])

  const loadData = useCallback(async () => {
    if (!effectiveMspId && !isSuperAdmin) return
    if (!effectiveMspId) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const { data: mspCo } = await supabase
        .from('companies')
        .select('name, msp_tier, msp_wholesale_discount')
        .eq('id', effectiveMspId)
        .single()
      if (mspCo) {
        setMspCompanyName((mspCo as any).name || '')
        setMspTier((mspCo as any).msp_tier || null)
        setMspDiscount((mspCo as any).msp_wholesale_discount || null)
      }

      const { data: managed } = await supabase
        .from('msp_managed_companies')
        .select('id, managed_company_id, added_at, consent_status, companies:managed_company_id(id, name, domain, is_active, is_trial)')
        .eq('msp_company_id', effectiveMspId)
        .eq('is_active', true)

      const companies: ManagedCompany[] = []
      for (const row of (managed || []) as any[]) {
        const co = row.companies
        if (!co) continue
        const { count } = await supabase
          .from('employees')
          .select('id', { count: 'exact', head: true })
          .eq('company_id', co.id)
          .eq('status', 'active')
        companies.push({
          id: co.id,
          msp_managed_id: row.id,
          name: co.name,
          domain: co.domain,
          is_active: co.is_active,
          is_trial: co.is_trial,
          employee_count: count || 0,
          onboarded_at: row.added_at,
          consent_status: row.consent_status || 'pending',
        })
      }
      setManagedCompanies(companies)

      const totalEmps = companies.reduce((sum, c) => sum + c.employee_count, 0)
      setStats({
        managed_count: companies.length,
        total_employees: totalEmps,
        active_companies: companies.filter(c => c.is_active && !c.is_trial).length,
        trial_companies: companies.filter(c => c.is_trial).length,
      })

      const { data: users } = await supabase
        .from('msp_user_access')
        .select('id, employee_id, managed_company_id, permissions, is_active, employees:employee_id(first_name, last_name, email)')
        .eq('msp_company_id', effectiveMspId)
        .eq('is_active', true)

      const userRows: MspUserAccessRow[] = ((users || []) as any[]).map(u => ({
        id: u.id,
        employee_id: u.employee_id,
        managed_company_id: u.managed_company_id,
        permissions: u.permissions || {},
        is_active: u.is_active,
        employee_name: u.employees ? `${u.employees.first_name} ${u.employees.last_name}` : 'Unknown',
        employee_email: u.employees?.email || '',
      }))
      setMspUsers(userRows)
    } catch (err) {
      console.error('MSP dashboard load error:', err)
    }
    setLoading(false)
  }, [effectiveMspId, isSuperAdmin])

  useEffect(() => { loadData() }, [loadData])

  const loadAuditLog = useCallback(async () => {
    if (!effectiveMspId && !isSuperAdmin) return
    setAuditLoading(true)
    const query = supabase.from('msp_audit_log').select('id, action, actor_id, managed_company_id, details, created_at').order('created_at', { ascending: false }).limit(100)
    if (effectiveMspId) query.eq('msp_company_id', effectiveMspId)
    const { data } = await query
    setAuditLog((data as any[]) || [])
    setAuditLoading(false)
  }, [effectiveMspId, isSuperAdmin])

  useEffect(() => { if (activeTab === 'audit') loadAuditLog() }, [activeTab, loadAuditLog])

  const handleManageCompany = (companyId: string) => {
    setSelectedCompanyId(companyId)
    navigate('/admin')
    showToast('Switched to managed company', 'success')
  }

  const sendConsentNotification = async (managedCompanyId: string, mspManagedId: string) => {
    const { data: admins } = await supabase
      .from('employees')
      .select('id, company_id')
      .eq('company_id', managedCompanyId)
      .eq('role', 'admin')
      .eq('status', 'active')
    if (!admins || admins.length === 0) return

    for (const admin of admins) {
      await supabase.from('notifications').insert({
        employee_id: admin.id,
        company_id: admin.company_id,
        title: 'MSP Partner Access Request',
        message: `${mspCompanyName} has requested to manage your company as an MSP partner. Please review and approve or reject this request.`,
        type: 'action',
        notification_type: 'msp_consent_request',
        is_read: false,
        metadata: { msp_managed_id: mspManagedId, msp_company_name: mspCompanyName },
      })
    }
  }

  const handleAddClientCompany = async () => {
    if (!addClientCompanyId || !effectiveMspId) return
    setAddingClient(true)
    try {
      const { data: insertedRow, error } = await supabase
        .from('msp_managed_companies')
        .insert({
          msp_company_id: effectiveMspId,
          managed_company_id: addClientCompanyId,
          added_by: (await supabase.auth.getUser()).data.user?.id,
          consent_status: 'pending',
        })
        .select('id')
        .single()
      if (error) {
        if (error.code === '23505') {
          showToast('This company is already linked to this MSP', 'error')
        } else {
          throw error
        }
      } else {
        if (insertedRow) await sendConsentNotification(addClientCompanyId, insertedRow.id)
        showToast('Client company linked — consent request sent to their admin', 'success')
        setAddClientCompanyId('')
        loadData()
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to add client company', 'error')
    }
    setAddingClient(false)
  }

  const handleRemoveClientCompany = async (companyId: string) => {
    if (!effectiveMspId) return
    try {
      const { error } = await supabase
        .from('msp_managed_companies')
        .update({ is_active: false })
        .eq('msp_company_id', effectiveMspId)
        .eq('managed_company_id', companyId)
      if (error) throw error
      showToast('Client company removed', 'success')
      loadData()
    } catch (err: any) {
      showToast(err.message || 'Failed to remove client company', 'error')
    }
  }

  const handleOnboardNewClient = async () => {
    if (!onboardForm.name.trim() || !effectiveMspId) return
    if (onboardForm.authMode === 'sso' && !onboardForm.domain.trim()) {
      showToast('Email domain is required for SSO companies', 'error')
      return
    }
    if (onboardForm.isTrial && (!onboardForm.trialStart || !onboardForm.trialEnd)) {
      showToast('Trial companies require both start and end dates', 'error')
      return
    }
    setOnboarding(true)
    try {
      const domain = onboardForm.authMode === 'sso' ? onboardForm.domain.trim().toLowerCase().replace(/^@/, '') : ''
      const isNonSso = onboardForm.authMode === 'non_sso'

      const insertPayload: Record<string, unknown> = {
        name: onboardForm.name.trim(),
        domain,
        microsoft_tenant_id: isNonSso ? null : `pending-${Date.now()}`,
        is_active: true,
        is_trial: onboardForm.isTrial,
        auth_mode: onboardForm.authMode,
        timezone: onboardForm.timezone,
        date_format: onboardForm.date_format,
        currency: onboardForm.currency,
        managed_by_msp_id: effectiveMspId,
      }
      if (onboardForm.isTrial) {
        insertPayload.trial_start_date = onboardForm.trialStart
        insertPayload.trial_end_date = onboardForm.trialEnd
      }

      const { data: newCo, error: insertError } = await supabase.from('companies').insert(insertPayload).select('id').single()
      if (insertError) throw new Error(insertError.message)

      if (newCo) {
        // Link as managed company (consent pending until client admin approves)
        const { data: mspRow } = await supabase.from('msp_managed_companies').insert({
          msp_company_id: effectiveMspId,
          managed_company_id: newCo.id,
          added_by: (await supabase.auth.getUser()).data.user?.id,
          consent_status: 'pending',
        }).select('id').single()

        // Non-SSO account setup
        if (isNonSso) {
          const slug = onboardForm.name.trim().toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20)
          const username = `${slug}admin`
          const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%'
          let password = ''
          for (let i = 0; i < 14; i++) password += chars[Math.floor(Math.random() * chars.length)]
          const email = `${username}@nonsso.inflowhr.local`
          await callRpcDirect('create_nonsso_account', {
            p_email: email,
            p_password: password,
            p_company_id: newCo.id,
            p_company_name: onboardForm.name.trim(),
          })
        }

        // Default leave types
        await supabase.from('leave_types').insert([
          { name: 'Annual Leave', company_id: newCo.id, deducts_from_allowance: true },
          { name: 'Sick Leave', company_id: newCo.id, deducts_from_allowance: false },
          { name: 'Jury Duty', company_id: newCo.id, deducts_from_allowance: false },
          { name: 'Bereavement', company_id: newCo.id, deducts_from_allowance: true },
          { name: 'Exam Leave', company_id: newCo.id, deducts_from_allowance: true },
          { name: 'Carers Leave', company_id: newCo.id, deducts_from_allowance: true },
          { name: 'Career Break', company_id: newCo.id, deducts_from_allowance: true },
          { name: 'Lieu Days', company_id: newCo.id, deducts_from_allowance: false },
        ])

        // Default features
        const allFeatureKeys = ['expenses', 'leave', 'kudos', 'elearning', 'timesheets', 'payroll', 'performance', 'shifts', 'benefits', 'legal_timesheets', 'space_booking', 'asset_management', 'email_notifications']
        const defaultEnabled = ['expenses', 'leave', 'kudos', 'elearning', 'timesheets']
        await supabase.from('company_features').insert(
          allFeatureKeys.map(key => ({
            company_id: newCo.id,
            feature_key: key,
            is_enabled: onboardForm.isTrial ? true : defaultEnabled.includes(key),
            custom_price: onboardForm.isTrial ? 0 : null,
          }))
        )

        // Email notification settings
        await supabase.from('email_notification_settings').insert({
          company_id: newCo.id,
          leave_enabled: false,
          expenses_enabled: false,
          shifts_enabled: false,
          kudos_enabled: false,
          space_booking_enabled: false,
          performance_reminders_enabled: false,
          elearning_reminders_enabled: false,
        })

        // Welcome announcement
        await supabase.from('announcements').insert({
          title: 'Welcome to your new HR App',
          body: "Take a look within 'Settings' and choose the guide to get to know your app and its features.",
          submitted_by_name: 'InflowHR',
          is_pinned: true,
          company_id: newCo.id,
        })

        // Auto-grant support access
        await callRpcDirect('grant_support_access_for_company', {
          p_company_id: newCo.id,
          p_hours: 48,
        })

        // Send consent notification to the new company's admins
        if (mspRow) await sendConsentNotification(newCo.id, mspRow.id)

        // Audit log
        await supabase.rpc('log_msp_action' as any, {
          p_msp_company_id: effectiveMspId,
          p_managed_company_id: newCo.id,
          p_action: 'onboard_client',
          p_details: { company_name: onboardForm.name.trim(), auth_mode: onboardForm.authMode },
        })
      }

      showToast(`${onboardForm.name.trim()} onboarded successfully`, 'success')
      setOnboardForm({ name: '', domain: '', authMode: 'sso', timezone: 'Europe/London', date_format: 'DD/MM/YYYY', currency: 'GBP', isTrial: false, trialStart: '', trialEnd: '' })
      setShowOnboardForm(false)
      loadData()
      // Refresh the "link existing" dropdown too
      const { data: refreshed } = await supabase.from('companies').select('id, name').neq('id', effectiveMspId).eq('is_active', true).order('name')
      setAllCompanies((refreshed || []) as any[])
    } catch (err: any) {
      showToast(err.message || 'Failed to onboard client', 'error')
    }
    setOnboarding(false)
  }

  const handleGrantAccess = async () => {
    if (!grantEmail || !grantCompanyId || !effectiveMspId) return
    setGranting(true)
    try {
      const { data: emp, error: empErr } = await supabase
        .from('employees')
        .select('id')
        .eq('company_id', effectiveMspId)
        .eq('email', grantEmail.trim().toLowerCase())
        .eq('status', 'active')
        .single()
      if (empErr || !emp) throw new Error('Employee not found in your MSP company. Check the email address.')

      const { error } = await supabase.rpc('grant_msp_user_access' as any, {
        p_employee_id: emp.id,
        p_msp_company_id: effectiveMspId,
        p_managed_company_id: grantCompanyId,
        p_permissions: { full_access: true },
      })
      if (error) throw error
      await supabase.rpc('log_msp_action' as any, {
        p_msp_company_id: effectiveMspId,
        p_managed_company_id: grantCompanyId,
        p_action: 'grant_access',
        p_details: { email: grantEmail },
      })
      showToast('Access granted successfully', 'success')
      setGrantEmail('')
      setGrantCompanyId('')
      loadData()
    } catch (err: any) {
      showToast(err.message || 'Failed to grant access', 'error')
    }
    setGranting(false)
  }

  const handleRevokeAccess = async (accessId: string) => {
    if (!effectiveMspId) return
    const revokedUser = mspUsers.find(u => u.id === accessId)
    try {
      const { error } = await supabase.rpc('revoke_msp_user_access' as any, {
        p_access_id: accessId,
      })
      if (error) throw error
      if (revokedUser) {
        await supabase.rpc('log_msp_action' as any, {
          p_msp_company_id: effectiveMspId,
          p_managed_company_id: revokedUser.managed_company_id,
          p_action: 'revoke_access',
          p_details: { email: revokedUser.employee_email, name: revokedUser.employee_name },
        })
      }
      showToast('Access revoked', 'success')
      loadData()
    } catch (err: any) {
      showToast(err.message || 'Failed to revoke access', 'error')
    }
  }

  const formatDate = (d: string | null) => {
    if (!d) return '—'
    const dt = new Date(d)
    return `${dt.getDate().toString().padStart(2, '0')}/${(dt.getMonth() + 1).toString().padStart(2, '0')}/${dt.getFullYear()}`
  }

  if (!isMspAdmin && !isSuperAdmin) {
    return <div style={{ padding: 32, textAlign: 'center', color: '#666' }}>You do not have MSP access.</div>
  }

  // Super admin needs to pick an MSP company first
  if (isSuperAdmin && !effectiveMspId) {
    return (
      <div style={{ maxWidth: 600, margin: '0 auto', padding: 32 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 16px' }}>MSP Partner Dashboard</h1>
        {mspCompanies.length === 0 ? (
          <p style={{ color: '#666' }}>No companies have been marked as MSP partners yet. Set a company as an MSP Partner in Company Management first.</p>
        ) : (
          <>
            <p style={{ color: '#666', margin: '0 0 12px' }}>Select an MSP partner company to manage:</p>
            <select
              value=""
              onChange={e => setSelectedMspId(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, background: '#fff' }}
            >
              <option value="">Select MSP company...</option>
              {mspCompanies.map(co => (
                <option key={co.id} value={co.id}>{co.name} — {tierDisplayLabel(co.msp_tier)}</option>
              ))}
            </select>
          </>
        )}
      </div>
    )
  }

  if (loading) {
    return <div style={{ padding: 32, textAlign: 'center' }}>Loading MSP Dashboard...</div>
  }

  const tierLabel = tierDisplayLabel(mspTier)

  // Companies already managed — exclude from "add client" dropdown
  const managedIds = new Set(managedCompanies.map(c => c.id))
  const availableClients = allCompanies.filter(c => !managedIds.has(c.id))

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>MSP Partner Dashboard</h1>
          {isSuperAdmin && mspCompanies.length > 1 && (
            <select
              value={effectiveMspId || ''}
              onChange={e => setSelectedMspId(e.target.value)}
              style={{ padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, background: '#fff' }}
            >
              {mspCompanies.map(co => (
                <option key={co.id} value={co.id}>{co.name}</option>
              ))}
            </select>
          )}
        </div>
        {mspCompanyName && (
          <p style={{ margin: '4px 0 0', color: '#666', fontSize: 14 }}>
            {mspCompanyName} — {tierLabel} Partner
            {mspDiscount != null && ` (${mspDiscount}% wholesale discount)`}
          </p>
        )}
      </div>

      {/* Stats cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24 }}>
        <StatCard label="Managed Companies" value={stats.managed_count} color="#4f46e5" />
        <StatCard label="Total Employees" value={stats.total_employees} color="#0891b2" />
        <StatCard label="Active Companies" value={stats.active_companies} color="#16a34a" />
        <StatCard label="Trial Companies" value={stats.trial_companies} color="#d97706" />
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid #e5e7eb', marginBottom: 20 }}>
        <TabBtn label="Managed Companies" active={activeTab === 'companies'} onClick={() => setActiveTab('companies')} />
        <TabBtn label="MSP Users" active={activeTab === 'users'} onClick={() => setActiveTab('users')} />
        <TabBtn label="Audit Log" active={activeTab === 'audit'} onClick={() => setActiveTab('audit')} />
      </div>

      {activeTab === 'companies' && (
        <div>
          {/* Client company actions — available to MSP admins */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
            <button
              onClick={() => setShowOnboardForm(!showOnboardForm)}
              style={{
                padding: '10px 20px', background: showOnboardForm ? '#e5e7eb' : '#4f46e5', color: showOnboardForm ? '#374151' : '#fff',
                border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 14,
              }}
            >
              {showOnboardForm ? 'Cancel' : 'Onboard New Client'}
            </button>
            {!showOnboardForm && availableClients.length > 0 && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <select
                  value={addClientCompanyId}
                  onChange={e => setAddClientCompanyId(e.target.value)}
                  style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, background: '#fff', minWidth: 220 }}
                >
                  <option value="">Link existing company...</option>
                  {availableClients.map(co => (
                    <option key={co.id} value={co.id}>{co.name}</option>
                  ))}
                </select>
                <button
                  onClick={handleAddClientCompany}
                  disabled={addingClient || !addClientCompanyId}
                  style={{
                    padding: '8px 16px', background: addingClient ? '#9ca3af' : '#16a34a', color: '#fff',
                    border: 'none', borderRadius: 6, cursor: addingClient ? 'default' : 'pointer', fontWeight: 600, fontSize: 13,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {addingClient ? 'Linking...' : 'Link'}
                </button>
              </div>
            )}
          </div>

          {/* Onboard new client form */}
          {showOnboardForm && (
            <div style={{ border: '1px solid #d1d5db', borderRadius: 10, padding: 24, marginBottom: 20, background: '#f9fafb' }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 16px' }}>Onboard New Client Company</h3>
              <p style={{ fontSize: 13, color: '#666', margin: '0 0 16px' }}>The client company admin will receive a consent request and must approve before you can manage their data.</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Company Name *</label>
                  <input
                    value={onboardForm.name}
                    onChange={e => setOnboardForm({ ...onboardForm, name: e.target.value })}
                    placeholder="Acme Ltd"
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14 }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Auth Mode</label>
                  <select
                    value={onboardForm.authMode}
                    onChange={e => setOnboardForm({ ...onboardForm, authMode: e.target.value as 'sso' | 'non_sso' })}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, background: '#fff' }}
                  >
                    <option value="sso">SSO (Microsoft / Google)</option>
                    <option value="non_sso">Non-SSO (Username / Password)</option>
                  </select>
                </div>
                {onboardForm.authMode === 'sso' && (
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Email Domain *</label>
                    <input
                      value={onboardForm.domain}
                      onChange={e => setOnboardForm({ ...onboardForm, domain: e.target.value })}
                      placeholder="acme.co.uk"
                      style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14 }}
                    />
                  </div>
                )}
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Timezone</label>
                  <select
                    value={onboardForm.timezone}
                    onChange={e => setOnboardForm({ ...onboardForm, timezone: e.target.value })}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, background: '#fff' }}
                  >
                    <option value="Europe/London">Europe/London</option>
                    <option value="America/New_York">America/New_York</option>
                    <option value="America/Chicago">America/Chicago</option>
                    <option value="America/Los_Angeles">America/Los_Angeles</option>
                    <option value="Asia/Dubai">Asia/Dubai</option>
                    <option value="Asia/Singapore">Asia/Singapore</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Date Format</label>
                  <select
                    value={onboardForm.date_format}
                    onChange={e => setOnboardForm({ ...onboardForm, date_format: e.target.value })}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, background: '#fff' }}
                  >
                    <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                    <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                    <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Currency</label>
                  <select
                    value={onboardForm.currency}
                    onChange={e => setOnboardForm({ ...onboardForm, currency: e.target.value })}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, background: '#fff' }}
                  >
                    <option value="GBP">GBP (£)</option>
                    <option value="USD">USD ($)</option>
                    <option value="EUR">EUR (€)</option>
                    <option value="AED">AED (د.إ)</option>
                    <option value="SGD">SGD (S$)</option>
                  </select>
                </div>
              </div>
              <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={onboardForm.isTrial}
                    onChange={e => setOnboardForm({ ...onboardForm, isTrial: e.target.checked })}
                  />
                  Trial company
                </label>
                {onboardForm.isTrial && (
                  <>
                    <input
                      type="date"
                      value={onboardForm.trialStart}
                      onChange={e => setOnboardForm({ ...onboardForm, trialStart: e.target.value })}
                      style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
                    />
                    <span style={{ fontSize: 13, color: '#666' }}>to</span>
                    <input
                      type="date"
                      value={onboardForm.trialEnd}
                      onChange={e => setOnboardForm({ ...onboardForm, trialEnd: e.target.value })}
                      style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
                    />
                  </>
                )}
              </div>
              <div style={{ marginTop: 20, display: 'flex', gap: 12 }}>
                <button
                  onClick={handleOnboardNewClient}
                  disabled={onboarding || !onboardForm.name.trim()}
                  style={{
                    padding: '10px 24px', background: onboarding ? '#9ca3af' : '#4f46e5', color: '#fff',
                    border: 'none', borderRadius: 8, cursor: onboarding ? 'default' : 'pointer', fontWeight: 600, fontSize: 14,
                  }}
                >
                  {onboarding ? 'Creating...' : 'Create & Link Company'}
                </button>
                <button
                  onClick={() => setShowOnboardForm(false)}
                  style={{
                    padding: '10px 24px', background: '#fff', color: '#374151',
                    border: '1px solid #d1d5db', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 14,
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {managedCompanies.length === 0 ? (
            <p style={{ color: '#666', textAlign: 'center', padding: 32 }}>No managed companies yet. Click "Onboard New Client" to create one, or link an existing company.</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
              {managedCompanies.map(co => (
                <div key={co.id} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 20, background: '#fff' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                    <div>
                      <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{co.name}</h3>
                      <p style={{ margin: '2px 0 0', fontSize: 13, color: '#888' }}>{co.domain}</p>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <span style={{
                        fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 12,
                        background: co.is_trial ? '#fef3c7' : co.is_active ? '#dcfce7' : '#fee2e2',
                        color: co.is_trial ? '#92400e' : co.is_active ? '#166534' : '#991b1b',
                      }}>
                        {co.is_trial ? 'Trial' : co.is_active ? 'Active' : 'Inactive'}
                      </span>
                      <span style={{
                        fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 12,
                        background: co.consent_status === 'approved' ? '#dcfce7' : co.consent_status === 'rejected' ? '#fee2e2' : '#fef3c7',
                        color: co.consent_status === 'approved' ? '#166534' : co.consent_status === 'rejected' ? '#991b1b' : '#92400e',
                      }}>
                        {co.consent_status === 'approved' ? 'Consent Approved' : co.consent_status === 'rejected' ? 'Consent Rejected' : 'Consent Pending'}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 20, fontSize: 13, color: '#555', marginBottom: 14 }}>
                    <span>{co.employee_count} employee{co.employee_count !== 1 ? 's' : ''}</span>
                    <span>Added: {formatDate(co.onboarded_at)}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {co.consent_status === 'approved' ? (
                      <button
                        onClick={() => handleManageCompany(co.id)}
                        style={{
                          flex: 1, padding: '8px 0', background: '#4f46e5', color: '#fff',
                          border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13,
                        }}
                      >
                        Manage Company
                      </button>
                    ) : (
                      <span style={{ flex: 1, padding: '8px 0', textAlign: 'center', fontSize: 13, color: '#888', fontStyle: 'italic' }}>
                        {co.consent_status === 'pending' ? 'Awaiting client consent' : 'Client declined access'}
                      </span>
                    )}
                    <button
                      onClick={() => handleRemoveClientCompany(co.id)}
                      style={{
                        padding: '8px 12px', background: '#fee2e2', color: '#991b1b',
                        border: '1px solid #fecaca', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 12,
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'users' && (
        <div>
          {/* Grant access form */}
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 20, marginBottom: 20, background: '#f9fafb' }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 12px' }}>Grant MSP User Access</h3>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Employee Email</label>
                <input
                  type="email"
                  value={grantEmail}
                  onChange={e => setGrantEmail(e.target.value)}
                  placeholder="user@yourcompany.com"
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14 }}
                />
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Client Company</label>
                <select
                  value={grantCompanyId}
                  onChange={e => setGrantCompanyId(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, background: '#fff' }}
                >
                  <option value="">Select company...</option>
                  {managedCompanies.map(co => (
                    <option key={co.id} value={co.id}>{co.name}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={handleGrantAccess}
                disabled={granting || !grantEmail || !grantCompanyId}
                style={{
                  padding: '8px 20px', background: granting ? '#9ca3af' : '#4f46e5', color: '#fff',
                  border: 'none', borderRadius: 6, cursor: granting ? 'default' : 'pointer', fontWeight: 600, fontSize: 13,
                  whiteSpace: 'nowrap',
                }}
              >
                {granting ? 'Granting...' : 'Grant Access'}
              </button>
            </div>
          </div>

          {/* User list */}
          {mspUsers.length === 0 ? (
            <p style={{ color: '#666', textAlign: 'center', padding: 32 }}>No MSP user access records.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                  <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600 }}>Name</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600 }}>Email</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600 }}>Client Company</th>
                  <th style={{ textAlign: 'right', padding: '8px 12px', fontWeight: 600 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {mspUsers.map(u => {
                  const companyName = managedCompanies.find(c => c.id === u.managed_company_id)?.name || u.managed_company_id
                  return (
                    <tr key={u.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '8px 12px' }}>{u.employee_name}</td>
                      <td style={{ padding: '8px 12px', color: '#666' }}>{u.employee_email}</td>
                      <td style={{ padding: '8px 12px' }}>{companyName}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                        <button
                          onClick={() => handleRevokeAccess(u.id)}
                          style={{
                            padding: '4px 12px', background: '#fee2e2', color: '#991b1b',
                            border: '1px solid #fecaca', borderRadius: 4, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                          }}
                        >
                          Revoke
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === 'audit' && (
        <div>
          {auditLoading ? (
            <p style={{ textAlign: 'center', color: '#888', padding: 32 }}>Loading audit log...</p>
          ) : auditLog.length === 0 ? (
            <p style={{ textAlign: 'center', color: '#888', padding: 32 }}>No audit log entries yet.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
                  <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600 }}>Date</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600 }}>Action</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600 }}>Company</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600 }}>Details</th>
                </tr>
              </thead>
              <tbody>
                {auditLog.map(entry => {
                  const companyName = managedCompanies.find(c => c.id === entry.managed_company_id)?.name || entry.managed_company_id || '—'
                  const actionLabel = entry.action.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
                  const detailStr = entry.details ? Object.entries(entry.details).map(([k, v]) => `${k}: ${v}`).join(', ') : '—'
                  return (
                    <tr key={entry.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>{formatDate(entry.created_at)}</td>
                      <td style={{ padding: '8px 12px' }}>
                        <span style={{
                          fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 12,
                          background: entry.action === 'grant_access' ? '#dcfce7' : entry.action === 'revoke_access' ? '#fee2e2' : '#f3f4f6',
                          color: entry.action === 'grant_access' ? '#166534' : entry.action === 'revoke_access' ? '#991b1b' : '#374151',
                        }}>
                          {actionLabel}
                        </span>
                      </td>
                      <td style={{ padding: '8px 12px' }}>{companyName}</td>
                      <td style={{ padding: '8px 12px', color: '#666', fontSize: 12 }}>{detailStr}</td>
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
}

function tierDisplayLabel(tier: string | null): string {
  if (tier === 'starter') return 'Starter'
  if (tier === 'growth') return 'Growth'
  if (tier === 'enterprise') return 'Enterprise'
  return 'Standard'
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: '16px 20px', background: '#fff' }}>
      <p style={{ margin: 0, fontSize: 12, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</p>
      <p style={{ margin: '6px 0 0', fontSize: 28, fontWeight: 700, color }}>{value}</p>
    </div>
  )
}

function TabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '10px 20px', background: 'none', border: 'none', borderBottom: active ? '2px solid #4f46e5' : '2px solid transparent',
        color: active ? '#4f46e5' : '#6b7280', fontWeight: 600, fontSize: 14, cursor: 'pointer',
        marginBottom: -2,
      }}
    >
      {label}
    </button>
  )
}
