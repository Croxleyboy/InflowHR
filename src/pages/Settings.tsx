import { useState, useCallback, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useFeatures, type Features } from '../context/FeatureContext'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { supabase } from '../lib/supabase'
import { useToast } from '../context/ToastContext'
import { getExportCategories, getDateRange, buildEmployeeExportZip } from '../lib/employeeDataExport'
import { toLocalDateStr, formatDate } from '../lib/formatters'
import { useUserPreferences } from '../hooks/useUserPreferences'
import type { Lang } from '../lib/translations'

const INFO_CARD_LABELS: { key: string; label: string; featureKey?: keyof Features }[] = [
  { key: 'checkin', label: "Today's Status" },
  { key: 'leave', label: 'Leave Balance', featureKey: 'leave' },
  { key: 'expenses', label: 'Expenses', featureKey: 'expenses' },
  { key: 'documents', label: 'Documents', featureKey: 'profile' },
  { key: 'profile', label: 'My Profile', featureKey: 'profile' },
  { key: 'payslips', label: 'Payslips', featureKey: 'payslips' },
  { key: 'kudos', label: 'Kudos', featureKey: 'kudos' },
  { key: 'performance', label: '1:1 Meetings', featureKey: 'performance' },
  { key: 'elearning', label: 'E-Learning', featureKey: 'elearning' },
  { key: 'benefits', label: 'Benefits', featureKey: 'benefits' },
  { key: 'timesheets', label: 'Timesheets', featureKey: 'timesheets' },
  { key: 'shifts', label: 'My Shifts', featureKey: 'shifts' },
  { key: 'space_booking', label: 'Space Booking', featureKey: 'space_booking' },
  { key: 'legal_timesheets', label: 'Legal Timesheets', featureKey: 'legal_timesheets' },
  { key: 'asset_management', label: 'My Assets', featureKey: 'asset_management' },
  { key: 'skills_passport', label: 'Skills Passport', featureKey: 'skills_passport' },
  { key: 'notifications', label: 'My Notifications' },
]

const DEFAULT_INFO_KEYS = INFO_CARD_LABELS.map(c => c.key)

const featureLabels: { key: keyof Features; tKey: string }[] = [
  { key: 'expenses', tKey: 'dashboard.expenses' },
  { key: 'leave', tKey: 'dashboard.leave_remaining' },
  { key: 'profile', tKey: 'dashboard.my_profile' },
  { key: 'payslips', tKey: 'dashboard.payslips' },
  { key: 'kudos', tKey: 'dashboard.kudos' },
  { key: 'benefits', tKey: 'dashboard.benefits' },
  { key: 'elearning', tKey: 'dashboard.elearning' },
  { key: 'performance', tKey: 'dashboard.performance' },
  { key: 'timesheets', tKey: 'dashboard.timesheets' },
  { key: 'shifts', tKey: 'dashboard.shifts' },
  { key: 'legal_timesheets', tKey: 'dashboard.legal_timesheets' },
  { key: 'space_booking', tKey: 'dashboard.space_booking' },
]

const monthLabels = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export default function Settings() {
  const { features, companyFeatures, setFeatures } = useFeatures()
  const { lang, setLang, t, fyStartMonth, setFyStartMonth } = useLanguage()
  const { employeeName, employeeEmail, companyUser, isSuperAdmin, portalRole, company, signOut } = useAuth()
  const { dark, toggle } = useTheme()
  const { showError, showSuccess } = useToast()
  const { prefs, updatePref } = useUserPreferences()
  const navigate = useNavigate()
  const [draft, setDraft] = useState<Features>({ ...features })
  const [draftLang, setDraftLang] = useState<Lang>(lang)
  const [draftFy, setDraftFy] = useState(fyStartMonth)
  const [saved, setSaved] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportConfirm, setExportConfirm] = useState<{
    data: Record<string, unknown>
    categories: { key: string; label: string; count: number }[]
    dateRange: { earliest: string; latest: string }
    companyName: string
  } | null>(null)
  const dashLayout = prefs.dashboard_layout
  const dashMode = prefs.dashboard_mode
  const cardOrder = (() => {
    if (prefs.info_card_order && prefs.info_card_order.length > 0) {
      const valid = prefs.info_card_order.filter(k => DEFAULT_INFO_KEYS.includes(k))
      const missing = DEFAULT_INFO_KEYS.filter(k => !valid.includes(k))
      return [...valid, ...missing]
    }
    return [...DEFAULT_INFO_KEYS]
  })()
  const cardHidden = new Set(prefs.info_card_hidden || [])
  const [isDesktop, setIsDesktop] = useState(window.innerWidth >= 768)
  const [consents, setConsents] = useState<Record<string, boolean>>({})
  const [consentsLoading, setConsentsLoading] = useState(true)
  const [consentSaving, setConsentSaving] = useState<string | null>(null)
  const [hasFeatureSwitching, setHasFeatureSwitching] = useState(false)
  const [dashCardsOpen, setDashCardsOpen] = useState(false)
  const [featuresOpen, setFeaturesOpen] = useState(false)
  const [delegationsOpen, setDelegationsOpen] = useState(false)
  const [delegationsOut, setDelegationsOut] = useState<{ id: string; delegate_id: string; delegate_name: string; start_date: string; end_date: string; scope: string; reason: string; is_active: boolean }[]>([])
  const [delegationsIn, setDelegationsIn] = useState<{ id: string; delegator_id: string; delegator_name: string; start_date: string; end_date: string; scope: string; reason: string; is_active: boolean }[]>([])
  const [delegationsLoading, setDelegationsLoading] = useState(true)
  const [isManager, setIsManager] = useState(false)
  const [showNewDelegation, setShowNewDelegation] = useState(false)
  const [colleagues, setColleagues] = useState<{ id: string; name: string }[]>([])
  const [newDel, setNewDel] = useState({ delegate_id: '', start_date: '', end_date: '', scope: 'all', reason: '' })
  const [delSaving, setDelSaving] = useState(false)
  const [identityProvider, setIdentityProvider] = useState<'entra' | 'google_workspace'>('entra')
  const [skipLicence, setSkipLicence] = useState(false)
  const [idpSaving, setIdpSaving] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  const isCompanyAdmin = isSuperAdmin || companyUser?.role === 'admin'
  const canSwitchFeatures = isCompanyAdmin || hasFeatureSwitching
  const hasPortalAccess = isCompanyAdmin || !!portalRole

  useEffect(() => {
    if (isCompanyAdmin || !portalRole || !companyUser?.company_id) return
    supabase.from('admin_portal_roles')
      .select('permissions')
      .eq('company_id', companyUser.company_id)
      .eq('role_key', portalRole)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.permissions?.feature_switching) setHasFeatureSwitching(true)
      })
  }, [isCompanyAdmin, portalRole, companyUser?.company_id])

  const handleDownloadMyData = useCallback(async () => {
    if (!companyUser?.employee_id) { showError('No employee record linked'); return }
    setExporting(true)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await supabase.rpc('export_employee_data' as any, { p_employee_id: companyUser.employee_id })
      if (error) { showError('Export failed: ' + error.message); setExporting(false); return }
      const exportData = data as Record<string, unknown>
      const categories = getExportCategories(exportData as Parameters<typeof getExportCategories>[0])
      const dateRange = getDateRange(exportData as Parameters<typeof getDateRange>[0])
      setExportConfirm({
        data: exportData,
        categories,
        dateRange,
        companyName: company?.name || 'Unknown Company',
      })
    } catch {
      showError('Export failed — please try again')
    }
    setExporting(false)
  }, [companyUser?.employee_id, company?.name, showError, showSuccess])

  const handleConfirmDownload = useCallback(async () => {
    if (!exportConfirm) return
    setExporting(true)
    try {
      const exportData = exportConfirm.data as Parameters<typeof buildEmployeeExportZip>[0]
      const blob = await buildEmployeeExportZip(exportData, employeeName || 'Employee')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${(employeeName || 'employee').replace(/\s+/g, '-').toLowerCase()}-data-export-${new Date().toLocaleDateString('en-GB').replace(/\//g, '-')}.zip`
      a.click()
      URL.revokeObjectURL(url)

      if (isSuperAdmin || companyUser?.role === 'admin') {
        try {
          await supabase.rpc('log_gdpr_action' as never, {
            p_company_id: companyUser?.company_id,
            p_action: 'employee_data_export',
            p_details: { employee_id: companyUser?.employee_id, format: 'excel_zip', categories: exportConfirm.categories.length },
          } as never)
        } catch { /* audit log failure should not block download */ }
      }

      showSuccess('Your data has been downloaded as Excel/ZIP')
    } catch {
      showError('Download failed — please try again')
    }
    setExportConfirm(null)
    setExporting(false)
  }, [exportConfirm, employeeName, isSuperAdmin, companyUser, showError, showSuccess])

  useEffect(() => {
    if (!companyUser?.employee_id || !companyUser?.company_id) { setConsentsLoading(false); return }
    supabase.from('employee_consents')
      .select('consent_type, withdrawn_at')
      .eq('employee_id', companyUser.employee_id)
      .eq('company_id', companyUser.company_id)
      .then(({ data }) => {
        const map: Record<string, boolean> = {}
        ;(data || []).forEach((c: { consent_type: string; withdrawn_at: string | null }) => {
          map[c.consent_type] = !c.withdrawn_at
        })
        setConsents(map)
        setConsentsLoading(false)
      })
  }, [companyUser?.employee_id, companyUser?.company_id])

  useEffect(() => {
    if (!companyUser?.employee_id || !companyUser?.company_id) { setDelegationsLoading(false); return }
    Promise.all([
      supabase.rpc('get_my_delegations_out'),
      supabase.rpc('get_my_delegations_in'),
      supabase.from('employees')
        .select('id')
        .eq('company_id', companyUser.company_id)
        .eq('manager_id', companyUser.employee_id)
        .eq('is_active', true)
        .limit(1),
      employeeEmail ? supabase.from('employees')
        .select('id')
        .eq('company_id', companyUser.company_id)
        .eq('manager_email', employeeEmail)
        .eq('is_active', true)
        .limit(1) : Promise.resolve({ data: null }),
    ]).then(([outRes, inRes, byIdRes, byEmailRes]) => {
      if (outRes.data) setDelegationsOut(outRes.data as typeof delegationsOut)
      if (inRes.data) setDelegationsIn(inRes.data as typeof delegationsIn)
      const hasReports = (byIdRes.data && byIdRes.data.length > 0) || (byEmailRes.data && byEmailRes.data.length > 0)
      setIsManager(!!hasReports)
      const hasActive = (outRes.data as typeof delegationsOut)?.some(d => d.is_active) || (inRes.data as typeof delegationsIn)?.some(d => d.is_active)
      if (hasActive) setDelegationsOpen(true)
      setDelegationsLoading(false)
    })
  }, [companyUser?.employee_id, companyUser?.company_id, employeeEmail])

  useEffect(() => {
    if (!companyUser?.company_id || !companyUser?.employee_id) return
    supabase.from('employees')
      .select('id, first_name, last_name')
      .eq('company_id', companyUser.company_id)
      .neq('id', companyUser.employee_id)
      .order('first_name')
      .then(({ data }) => {
        if (data) setColleagues(data.map(e => ({ id: e.id, name: `${e.first_name} ${e.last_name}` })))
      })
  }, [companyUser?.company_id, companyUser?.employee_id])

  useEffect(() => {
    if (!isCompanyAdmin || !companyUser?.company_id) return
    supabase.from('companies')
      .select('identity_provider, skip_licence_assignment')
      .eq('id', companyUser.company_id)
      .single()
      .then(({ data }) => {
        if (data) {
          setIdentityProvider(data.identity_provider || 'entra')
          setSkipLicence(!!data.skip_licence_assignment)
        }
      })
  }, [isCompanyAdmin, companyUser?.company_id])

  async function saveIdentityProvider(provider: 'entra' | 'google_workspace') {
    if (!companyUser?.company_id || idpSaving) return
    setIdpSaving(true)
    const { error } = await supabase.from('companies').update({ identity_provider: provider }).eq('id', companyUser.company_id)
    setIdpSaving(false)
    if (error) { showError('Failed to update identity provider'); return }
    setIdentityProvider(provider)
    showSuccess(`Identity provider set to ${provider === 'entra' ? 'Microsoft Entra ID' : 'Google Workspace'}`)
  }

  async function saveSkipLicence(val: boolean) {
    if (!companyUser?.company_id || idpSaving) return
    setIdpSaving(true)
    const { error } = await supabase.from('companies').update({ skip_licence_assignment: val }).eq('id', companyUser.company_id)
    setIdpSaving(false)
    if (error) { showError('Failed to update setting'); return }
    setSkipLicence(val)
    showSuccess(`Licence assignment ${val ? 'skipped' : 'enabled'}`)
  }

  const handleCreateDelegation = useCallback(async () => {
    if (!companyUser?.company_id || !companyUser?.employee_id) return
    if (!newDel.delegate_id || !newDel.start_date || !newDel.end_date) {
      showError('Please fill in the delegate, start date and end date')
      return
    }
    if (newDel.end_date < newDel.start_date) {
      showError('End date must be on or after start date')
      return
    }
    setDelSaving(true)
    const { error } = await supabase.from('approval_delegations').insert({
      company_id: companyUser.company_id,
      delegator_id: companyUser.employee_id,
      delegate_id: newDel.delegate_id,
      start_date: newDel.start_date,
      end_date: newDel.end_date,
      scope: newDel.scope,
      reason: newDel.reason,
    })
    if (error) { showError('Failed to create delegation: ' + error.message); setDelSaving(false); return }
    const { data } = await supabase.rpc('get_my_delegations_out')
    if (data) setDelegationsOut(data as typeof delegationsOut)
    setNewDel({ delegate_id: '', start_date: '', end_date: '', scope: 'all', reason: '' })
    setShowNewDelegation(false)
    setDelSaving(false)
    showSuccess('Delegation created')
  }, [companyUser, newDel, showError, showSuccess])

  const handleCancelDelegation = useCallback(async (delegationId: string) => {
    const { error } = await supabase.from('approval_delegations')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', delegationId)
    if (error) { showError('Failed to cancel delegation'); return }
    setDelegationsOut(prev => prev.map(d => d.id === delegationId ? { ...d, is_active: false } : d))
    showSuccess('Delegation cancelled')
  }, [showError, showSuccess])

  const today = useMemo(() => toLocalDateStr(), [])
  const activeDelegationsOut = useMemo(() => delegationsOut.filter(d => d.is_active), [delegationsOut])
  const pastDelegationsOut = useMemo(() => delegationsOut.filter(d => !d.is_active), [delegationsOut])
  const activeDelegationsIn = useMemo(() => delegationsIn.filter(d => d.is_active && d.start_date <= today && d.end_date >= today), [delegationsIn, today])

  const handleConsentToggle = useCallback(async (consentType: string) => {
    if (!companyUser?.employee_id || !companyUser?.company_id) return
    setConsentSaving(consentType)
    const currentlyGranted = consents[consentType] ?? false

    if (currentlyGranted) {
      const { error } = await supabase.from('employee_consents')
        .update({ withdrawn_at: new Date().toISOString() })
        .eq('employee_id', companyUser.employee_id)
        .eq('company_id', companyUser.company_id)
        .eq('consent_type', consentType)
      if (error) { showError('Failed to update consent'); setConsentSaving(null); return }
      setConsents(prev => ({ ...prev, [consentType]: false }))
      showSuccess('Consent withdrawn')
    } else {
      const existing = await supabase.from('employee_consents')
        .select('id')
        .eq('employee_id', companyUser.employee_id)
        .eq('company_id', companyUser.company_id)
        .eq('consent_type', consentType)
        .maybeSingle()

      if (existing.data) {
        const { error } = await supabase.from('employee_consents')
          .update({ granted_at: new Date().toISOString(), withdrawn_at: null, consent_version: '1.0' })
          .eq('id', existing.data.id)
        if (error) { showError('Failed to update consent'); setConsentSaving(null); return }
      } else {
        const { error } = await supabase.from('employee_consents')
          .insert({
            employee_id: companyUser.employee_id,
            company_id: companyUser.company_id,
            consent_type: consentType,
            consent_version: '1.0',
          })
        if (error) { showError('Failed to record consent'); setConsentSaving(null); return }
      }
      setConsents(prev => ({ ...prev, [consentType]: true }))
      if (consentType === 'geolocation') {
        navigator.geolocation.getCurrentPosition(
          () => {
            showSuccess('Geolocation enabled — weather will appear on your dashboard')
          },
          (err) => {
            if (err.code === err.PERMISSION_DENIED) {
              showError('Browser location permission denied. Please allow location access in your browser settings, then try again.')
              supabase.from('employee_consents')
                .update({ withdrawn_at: new Date().toISOString() })
                .eq('employee_id', companyUser.employee_id)
                .eq('company_id', companyUser.company_id)
                .eq('consent_type', 'geolocation')
                .then(() => setConsents(prev => ({ ...prev, geolocation: false })))
            } else {
              showSuccess('Geolocation consent saved')
            }
          },
          { timeout: 10000 }
        )
      } else {
        showSuccess('Consent granted')
      }
    }
    setConsentSaving(null)
  }, [companyUser?.employee_id, companyUser?.company_id, consents, showError, showSuccess])

  function handleToggle(key: keyof Features) {
    setDraft(d => ({ ...d, [key]: !d[key] }))
    setSaved(false)
  }

  async function handleSave() {
    setFeatures(draft)
    setLang(draftLang)
    setFyStartMonth(draftFy)

    if (companyUser?.company_id) {
      const { error: settingsError } = await supabase.from('app_settings').update({
        language: draftLang,
        financial_year_start_month: draftFy,
        updated_at: new Date().toISOString(),
      }).eq('company_id', companyUser.company_id)
      if (settingsError) { showError('Failed to update settings: ' + settingsError.message); return }

      const featureRows = (Object.keys(draft) as (keyof Features)[]).map(key => ({
        company_id: companyUser.company_id,
        feature_key: key === 'payslips' ? 'payroll' : key,
        is_visible: draft[key],
      }))
      try {
        await Promise.all(featureRows.map(row =>
          supabase.from('company_features')
            .update({ is_visible: row.is_visible })
            .eq('company_id', row.company_id)
            .eq('feature_key', row.feature_key)
        ))
      } catch (e: any) {
        showError('Failed to update feature toggles: ' + (e?.message || String(e)))
        return
      }
    }

    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="settings-page">
      <h1>{t('settings.title')}</h1>

      {!isDesktop && (
        <section className="settings-section settings-quick-actions">
          <div className="settings-action-row">
            <button className="settings-action-btn" onClick={toggle}>
              {dark ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="5" /><g stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></g></svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
              )}
              <span>{dark ? 'Light Mode' : 'Dark Mode'}</span>
            </button>
            <button className="settings-action-btn settings-action-logout" onClick={signOut}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              <span>Sign Out</span>
            </button>
          </div>
        </section>
      )}

      <section className="settings-section">
        <h2>{t('settings.profile')}</h2>
        <div className="settings-info">
          <div className="settings-row"><span className="settings-label">{t('settings.name')}</span><span>{employeeName}</span></div>
          <div className="settings-row"><span className="settings-label">{t('settings.email')}</span><span>{employeeEmail}</span></div>
          <div className="settings-row"><span className="settings-label">{t('settings.role')}</span><span>{companyUser?.role === 'admin' ? 'Administrator' : 'Employee'}</span></div>
        </div>
      </section>

      <section className="settings-section">
        <h2>{t('settings.app_info')}</h2>
        <div className="settings-info">
          <div className="settings-row"><span className="settings-label">{t('settings.version')}</span><span>1.0.0</span></div>
          <div className="settings-row"><span className="settings-label">{t('settings.environment')}</span><span>Production</span></div>
        </div>
      </section>

      {isCompanyAdmin && (
        <section className="settings-section">
          <h2>{t('settings.app_settings')}</h2>
          <div className="settings-info">
            <div className="settings-row">
              <span className="settings-label">{t('settings.language')}</span>
              <div className="language-selector">
                <button
                  className={`lang-btn ${draftLang === 'en' ? 'lang-active' : ''}`}
                  onClick={() => { setDraftLang('en'); setSaved(false) }}
                >English</button>
                <button
                  className={`lang-btn ${draftLang === 'de' ? 'lang-active' : ''}`}
                  onClick={() => { setDraftLang('de'); setSaved(false) }}
                >Deutsch</button>
              </div>
            </div>
            <div className="settings-row">
              <span className="settings-label">{t('settings.financial_year')}</span>
              <select
                className="fy-select"
                value={draftFy}
                onChange={e => { setDraftFy(Number(e.target.value)); setSaved(false) }}
              >
                {monthLabels.map((m, i) => (
                  <option key={i} value={i + 1}>{m}</option>
                ))}
              </select>
            </div>
          </div>
        </section>
      )}

      {isCompanyAdmin && (
        <section className="settings-section">
          <h2>Identity Provider</h2>
          <div className="settings-info">
            <div className="settings-row">
              <span className="settings-label">Provider</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className={`lang-btn ${identityProvider === 'entra' ? 'lang-active' : ''}`}
                  onClick={() => saveIdentityProvider('entra')}
                  disabled={idpSaving}
                >Microsoft Entra ID</button>
                <button
                  className={`lang-btn ${identityProvider === 'google_workspace' ? 'lang-active' : ''}`}
                  onClick={() => saveIdentityProvider('google_workspace')}
                  disabled={idpSaving}
                >Google Workspace</button>
              </div>
            </div>
            <div className="settings-row">
              <span className="settings-label">Skip Licence Assignment</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 13, color: 'var(--text-muted, #8b8fa3)' }}>{skipLicence ? 'On' : 'Off'}</span>
                <button
                  className={`ts-toggle ${skipLicence ? 'ts-toggle-on' : ''}`}
                  onClick={() => saveSkipLicence(!skipLicence)}
                  disabled={idpSaving}
                  aria-label="Toggle skip licence assignment"
                >
                  <span className="ts-toggle-knob" />
                </button>
              </div>
            </div>
            {identityProvider === 'google_workspace' && (
              <div style={{ background: '#fff8e1', borderRadius: 8, padding: 12, marginTop: 8, border: '1px solid #ffe082', fontSize: 13 }}>
                ⚠️ InflowOnboarder M365 provisioning, licence assignment, and persona management are not available for Google Workspace companies.
              </div>
            )}
            {skipLicence && (
              <div style={{ background: '#e3f2fd', borderRadius: 8, padding: 12, marginTop: 8, border: '1px solid #90caf9', fontSize: 13 }}>
                Licence search and assignment will be skipped during onboarding. Enable this when not all employees receive a full Microsoft 365 or Google Workspace licence.
              </div>
            )}
          </div>
        </section>
      )}

      {canSwitchFeatures && (
        <section className="settings-section">
          <button className="settings-section-toggle" onClick={() => setFeaturesOpen(v => !v)}>
            <h2>{t('settings.features')}</h2>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: featuresOpen ? 'rotate(180deg)' : undefined, transition: 'transform 0.2s' }}><path d="M6 9l6 6 6-6"/></svg>
          </button>
          {featuresOpen && (
            <>
              <p className="settings-hint">{t('settings.features_hint')}</p>
              <div className="feature-toggles">
                {featureLabels.filter(({ key }) => companyFeatures[key] || key === 'elearning').map(({ key, tKey }) => {
                  const disabled = !companyFeatures[key]
                  return (
                    <div className="toggle-row" key={key} style={disabled ? { opacity: 0.5 } : undefined}>
                      <span>{t(tKey)}{disabled ? ' (disabled)' : ''}</span>
                      <button
                        className={`toggle-switch ${draft[key] && !disabled ? 'toggle-on' : 'toggle-off'}`}
                        onClick={() => !disabled && handleToggle(key)}
                        role="switch"
                        aria-checked={draft[key] && !disabled}
                        disabled={disabled}
                        style={disabled ? { cursor: 'not-allowed' } : undefined}
                      >
                        <span className="toggle-knob" />
                      </button>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </section>
      )}

      {isDesktop && (
        <section className="settings-section">
          <h2>Dashboard Layout</h2>
          <div className="settings-info">
            <div className="settings-row">
              <span className="settings-label">Default view</span>
              <div className="language-selector">
                <button
                  className={`lang-btn ${dashLayout === 'detailed' ? 'lang-active' : ''}`}
                  onClick={() => updatePref('dashboard_layout', 'detailed')}
                >Detailed</button>
                <button
                  className={`lang-btn ${dashLayout === 'cards' ? 'lang-active' : ''}`}
                  onClick={() => updatePref('dashboard_layout', 'cards')}
                >Cards</button>
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="settings-section">
        <h2>Dashboard Style</h2>
        <div className="settings-info">
          <div className="settings-row">
            <span className="settings-label">Card style</span>
            <div className="language-selector">
              {isDesktop && dashLayout === 'detailed' ? (
                <button className="lang-btn lang-active">Full Dashboard</button>
              ) : (
                <>
                  <button
                    className={`lang-btn ${dashMode === 'plain' ? 'lang-active' : ''}`}
                    onClick={() => updatePref('dashboard_mode', 'plain')}
                  >Plain</button>
                  <button
                    className={`lang-btn ${dashMode === 'simple' ? 'lang-active' : ''}`}
                    onClick={() => updatePref('dashboard_mode', 'simple')}
                  >Coloured</button>
                  <button
                    className={`lang-btn ${dashMode === 'info' ? 'lang-active' : ''}`}
                    onClick={() => updatePref('dashboard_mode', 'info')}
                  >Info Cards</button>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      {dashMode === 'info' && !(isDesktop && dashLayout === 'detailed') && (
        <section className="settings-section">
          <button className="settings-section-toggle" onClick={() => setDashCardsOpen(v => !v)}>
            <h2>Dashboard Cards</h2>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: dashCardsOpen ? 'rotate(180deg)' : undefined, transition: 'transform 0.2s' }}><path d="M6 9l6 6 6-6"/></svg>
          </button>
          {dashCardsOpen && <>
          <p className="settings-hint" style={{ marginBottom: 10 }}>Toggle cards on or off and reorder them with the arrows.</p>
          <div className="card-manager-list">
            {cardOrder.filter(key => {
              const def = INFO_CARD_LABELS.find(c => c.key === key)
              if (!def) return false
              if (def.featureKey && !features[def.featureKey]) return false
              return true
            }).map((key, idx, arr) => {
              const def = INFO_CARD_LABELS.find(c => c.key === key)!
              const hidden = cardHidden.has(key)
              return (
                <div className="card-manager-row" key={key}>
                  <div className="card-manager-arrows">
                    <button
                      disabled={idx === 0}
                      onClick={() => {
                        const newOrder = [...cardOrder]
                        const fullIdx = newOrder.indexOf(key)
                        const prevKey = arr[idx - 1]
                        const prevFullIdx = newOrder.indexOf(prevKey)
                        newOrder[prevFullIdx] = key
                        newOrder[fullIdx] = prevKey
                        updatePref('info_card_order', newOrder)
                      }}
                      aria-label="Move up"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 15l-6-6-6 6"/></svg>
                    </button>
                    <button
                      disabled={idx === arr.length - 1}
                      onClick={() => {
                        const newOrder = [...cardOrder]
                        const fullIdx = newOrder.indexOf(key)
                        const nextKey = arr[idx + 1]
                        const nextFullIdx = newOrder.indexOf(nextKey)
                        newOrder[nextFullIdx] = key
                        newOrder[fullIdx] = nextKey
                        updatePref('info_card_order', newOrder)
                      }}
                      aria-label="Move down"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>
                    </button>
                  </div>
                  <span className="card-manager-label">{def.label}</span>
                  <button
                    className={`toggle-switch ${!hidden ? 'toggle-on' : 'toggle-off'}`}
                    onClick={() => {
                      const newHidden = new Set(cardHidden)
                      if (hidden) newHidden.delete(key)
                      else newHidden.add(key)
                      updatePref('info_card_hidden', [...newHidden])
                    }}
                    role="switch"
                    aria-checked={!hidden}
                  >
                    <span className="toggle-knob" />
                  </button>
                </div>
              )
            })}
          </div>
          </>}
        </section>
      )}


      <section className="settings-section">
        <h2>Your Data</h2>
        <div className="settings-info">
          <button className="settings-row settings-row-btn" onClick={handleDownloadMyData} disabled={exporting}>
            <span className="settings-row-left">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              <span>{exporting ? 'Exporting…' : 'Download My Data'}</span>
            </span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
          </button>
          <button className="settings-row settings-row-btn" onClick={() => navigate('/user-guide')}>
            <span className="settings-row-left">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
              </svg>
              <span>User Guide</span>
            </span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
          </button>
          <button className="settings-row settings-row-btn" onClick={() => navigate('/privacy')}>
            <span className="settings-row-left">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
              <span>Privacy Notice</span>
            </span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
          </button>
        </div>
      </section>

      {!consentsLoading && companyUser?.employee_id && (
        <section className="settings-section">
          <h2>Data Consents</h2>
          <p className="settings-hint" style={{ marginBottom: 12 }}>
            Manage your consent for optional data processing. You can withdraw consent at any time. <a href="/privacy" style={{ color: 'var(--primary, #6C4FBF)' }}>View our Privacy Notice</a>
          </p>
          <div className="feature-toggles">
            <div className="toggle-row">
              <div>
                <span>Religion or belief data</span>
                <p style={{ fontSize: 12, color: '#64748b', margin: '2px 0 0' }}>Used to accommodate religious observance and dietary requirements</p>
              </div>
              <button
                className={`toggle-switch ${consents.special_category ? 'toggle-on' : 'toggle-off'}`}
                onClick={() => handleConsentToggle('special_category')}
                disabled={consentSaving === 'special_category'}
                role="switch"
                aria-checked={consents.special_category ?? false}
              >
                <span className="toggle-knob" />
              </button>
            </div>
            <div className="toggle-row">
              <div>
                <span>Geolocation check-in</span>
                <p style={{ fontSize: 12, color: '#64748b', margin: '2px 0 0' }}>Records GPS coordinates when you check in/out for timesheets or shifts</p>
              </div>
              <button
                className={`toggle-switch ${consents.geolocation ? 'toggle-on' : 'toggle-off'}`}
                onClick={() => handleConsentToggle('geolocation')}
                disabled={consentSaving === 'geolocation'}
                role="switch"
                aria-checked={consents.geolocation ?? false}
              >
                <span className="toggle-knob" />
              </button>
            </div>
          </div>
        </section>
      )}

      {!delegationsLoading && companyUser?.employee_id && (isManager || activeDelegationsOut.length > 0 || activeDelegationsIn.length > 0) && (
        <section className="settings-section">
          <button className="settings-section-toggle" onClick={() => setDelegationsOpen(v => !v)}>
            <h2>Approval Delegation</h2>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: delegationsOpen ? 'rotate(180deg)' : undefined, transition: 'transform 0.2s' }}><path d="M6 9l6 6 6-6"/></svg>
          </button>
          {delegationsOpen && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {isManager && (
                <p className="settings-hint" style={{ margin: 0 }}>
                  Temporarily delegate your approval responsibilities (leave, expenses, timesheets) to a colleague — for example during annual leave.
                </p>
              )}

              {activeDelegationsOut.length > 0 && (
                <div>
                  <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 8px', color: 'var(--text-secondary, #64748b)' }}>My Active Delegations</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {activeDelegationsOut.map(d => {
                      const isNow = d.start_date <= today && d.end_date >= today
                      const isFuture = d.start_date > today
                      return (
                        <div key={d.id} style={{ background: 'var(--bg-secondary, #f8fafc)', borderRadius: 8, padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                              {d.delegate_name}
                              {isNow && <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4, background: '#dcfce7', color: '#166534' }}>Active now</span>}
                              {isFuture && <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4, background: '#fef3c7', color: '#92400e' }}>Upcoming</span>}
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--text-secondary, #64748b)' }}>
                              {formatDate(d.start_date)} — {formatDate(d.end_date)}
                              {d.scope !== 'all' && <span style={{ marginLeft: 8 }}>({d.scope})</span>}
                            </div>
                            {d.reason && <div style={{ fontSize: 12, color: 'var(--text-secondary, #64748b)', marginTop: 2 }}>{d.reason}</div>}
                          </div>
                          <button
                            onClick={() => handleCancelDelegation(d.id)}
                            style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid var(--border, #e2e8f0)', background: 'transparent', cursor: 'pointer', fontSize: 12, color: '#ef4444' }}
                          >Cancel</button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {activeDelegationsIn.length > 0 && (
                <div>
                  <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 8px', color: 'var(--text-secondary, #64748b)' }}>Covering For</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {activeDelegationsIn.map(d => (
                      <div key={d.id} style={{ background: 'var(--bg-secondary, #f8fafc)', borderRadius: 8, padding: '12px 14px' }}>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{d.delegator_name}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary, #64748b)' }}>
                          {formatDate(d.start_date)} — {formatDate(d.end_date)}
                          {d.scope !== 'all' && <span style={{ marginLeft: 8 }}>({d.scope})</span>}
                        </div>
                        {d.reason && <div style={{ fontSize: 12, color: 'var(--text-secondary, #64748b)', marginTop: 2 }}>{d.reason}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {isManager && (
                <>
                  {!showNewDelegation ? (
                    <button
                      onClick={() => setShowNewDelegation(true)}
                      style={{ alignSelf: 'flex-start', padding: '8px 16px', borderRadius: 8, border: 'none', background: 'var(--primary, #6C4FBF)', color: '#fff', cursor: 'pointer', fontWeight: 500, fontSize: 14 }}
                    >+ New Delegation</button>
                  ) : (
                    <div style={{ background: 'var(--bg-secondary, #f8fafc)', borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>New Delegation</h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary, #64748b)' }}>Delegate to</label>
                        <select
                          value={newDel.delegate_id}
                          onChange={e => setNewDel(p => ({ ...p, delegate_id: e.target.value }))}
                          style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border, #e2e8f0)', background: 'var(--bg, #fff)', fontSize: 14 }}
                        >
                          <option value="">Select a colleague…</option>
                          {colleagues.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary, #64748b)' }}>Start date</label>
                          <input
                            type="date"
                            value={newDel.start_date}
                            onChange={e => setNewDel(p => ({ ...p, start_date: e.target.value }))}
                            style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border, #e2e8f0)', background: 'var(--bg, #fff)', fontSize: 14 }}
                          />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary, #64748b)' }}>End date</label>
                          <input
                            type="date"
                            value={newDel.end_date}
                            onChange={e => setNewDel(p => ({ ...p, end_date: e.target.value }))}
                            style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border, #e2e8f0)', background: 'var(--bg, #fff)', fontSize: 14 }}
                          />
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary, #64748b)' }}>Scope</label>
                        <select
                          value={newDel.scope}
                          onChange={e => setNewDel(p => ({ ...p, scope: e.target.value }))}
                          style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border, #e2e8f0)', background: 'var(--bg, #fff)', fontSize: 14 }}
                        >
                          <option value="all">All approvals (leave, expenses, timesheets)</option>
                          <option value="leave">Leave only</option>
                          <option value="expenses">Expenses only</option>
                          <option value="timesheets">Timesheets only</option>
                        </select>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary, #64748b)' }}>Reason (optional)</label>
                        <input
                          type="text"
                          value={newDel.reason}
                          onChange={e => setNewDel(p => ({ ...p, reason: e.target.value }))}
                          placeholder="e.g. Annual leave"
                          style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border, #e2e8f0)', background: 'var(--bg, #fff)', fontSize: 14 }}
                        />
                      </div>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button
                          onClick={() => { setShowNewDelegation(false); setNewDel({ delegate_id: '', start_date: '', end_date: '', scope: 'all', reason: '' }) }}
                          style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid var(--border, #e2e8f0)', background: 'transparent', cursor: 'pointer', fontSize: 14 }}
                        >Cancel</button>
                        <button
                          onClick={handleCreateDelegation}
                          disabled={delSaving}
                          style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: 'var(--primary, #6C4FBF)', color: '#fff', cursor: 'pointer', fontWeight: 500, fontSize: 14 }}
                        >{delSaving ? 'Saving…' : 'Create Delegation'}</button>
                      </div>
                    </div>
                  )}

                  {pastDelegationsOut.length > 0 && (
                    <div>
                      <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 8px', color: 'var(--text-secondary, #64748b)' }}>Past Delegations</h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {pastDelegationsOut.slice(0, 5).map(d => (
                          <div key={d.id} style={{ background: 'var(--bg-secondary, #f8fafc)', borderRadius: 8, padding: '10px 14px', opacity: 0.7 }}>
                            <div style={{ fontWeight: 600, fontSize: 13 }}>{d.delegate_name}</div>
                            <div style={{ fontSize: 12, color: 'var(--text-secondary, #64748b)' }}>
                              {formatDate(d.start_date)} — {formatDate(d.end_date)}
                              <span style={{ marginLeft: 8, color: '#94a3b8' }}>Cancelled</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </section>
      )}

      {hasPortalAccess && (
        <section className="settings-section settings-admin-section">
          <button className="settings-admin-btn" onClick={() => navigate('/admin')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            {t('settings.admin_portal')}
          </button>
        </section>
      )}

      <div className="settings-save-sticky">
        <button className="save-btn" onClick={handleSave}>
          {saved ? t('settings.saved') : t('settings.save')}
        </button>
      </div>

      {exportConfirm && (
        <div className="modal-overlay" onClick={() => setExportConfirm(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg, #fff)', borderRadius: '0 0 16px 16px', width: '100%', maxWidth: 520, padding: '24px 20px', maxHeight: '95dvh', overflowY: 'auto' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 18 }}>Confirm Data Download</h3>
            <div style={{ background: 'var(--bg-secondary, #f8fafc)', borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontWeight: 600, color: 'var(--text-secondary, #64748b)', fontSize: 13 }}>Company</span>
                <span style={{ fontWeight: 600 }}>{exportConfirm.companyName}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontWeight: 600, color: 'var(--text-secondary, #64748b)', fontSize: 13 }}>Period</span>
                <span>{exportConfirm.dateRange.earliest} — {exportConfirm.dateRange.latest}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 600, color: 'var(--text-secondary, #64748b)', fontSize: 13 }}>Format</span>
                <span>Excel (.xlsx) in ZIP archive</span>
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-secondary, #64748b)' }}>Data categories included:</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {exportConfirm.categories.map(c => (
                  <span key={c.key} style={{
                    background: 'var(--primary-light, #ede9f7)',
                    color: 'var(--primary, #6C4FBF)',
                    padding: '4px 10px',
                    borderRadius: 12,
                    fontSize: 12,
                    fontWeight: 500,
                  }}>
                    {c.label} ({c.count})
                  </span>
                ))}
              </div>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-secondary, #64748b)', margin: '0 0 16px' }}>
              This download contains all personal data held under GDPR Art. 15/20 (Right of access / Right to data portability). This action will be recorded in the audit log.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn-secondary" onClick={() => setExportConfirm(null)} style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid var(--border, #e2e8f0)', background: 'transparent', cursor: 'pointer' }}>Cancel</button>
              <button className="save-btn" onClick={handleConfirmDownload} disabled={exporting} style={{ padding: '8px 20px', borderRadius: 6 }}>
                {exporting ? 'Downloading…' : 'Download'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
