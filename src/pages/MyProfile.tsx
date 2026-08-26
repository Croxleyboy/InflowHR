import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useFeatures } from '../context/FeatureContext'
import { formatDate } from '../lib/formatters'

interface DeptMember {
  first_name: string
  last_name: string
  job_title: string | null
}

interface OnboardingRecord {
  firstname: string
  surname: string
  display_name: string
  job_title: string
  contract_type: string
  user_email: string
  date_of_birth: string | null
  telephone: string | null
  personal_email: string | null
  address_line_1: string | null
  address_line_2: string | null
  address_line_3: string | null
  address_line_4: string | null
  emergency_contact_number: string | null
  gender: string | null
  nationality: string | null
  religion: string | null
  relationship: string | null
  start_date: string | null
  status: string
  manager: string | null
  location: string | null
  employee_number: string | null
  department: string | null
  avatar_url: string | null
}

export default function MyProfile() {
  const navigate = useNavigate()
  const { t } = useLanguage()
  const { employeeEmail: EMPLOYEE_EMAIL, employeeId, companyUser, updateAvatarUrl } = useAuth()
  const { showError, showSuccess } = useToast()
  const { features } = useFeatures()
  const [tab, setTab] = useState<'personal' | 'job'>('personal')
  const [profile, setProfile] = useState<OnboardingRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [showMembers, setShowMembers] = useState(false)
  const [members, setMembers] = useState<DeptMember[]>([])
  const [avatarUploading, setAvatarUploading] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const [empData, setEmpData] = useState<{
    date_of_birth: string | null; salary_group: string | null; qualifications: string | null;
    contract_type: string | null; phone: string | null; personal_email: string | null;
    address_line1: string | null; address_line2: string | null; city: string | null;
    county: string | null; postcode: string | null; country: string | null;
    emergency_contact_name: string | null; emergency_contact_phone: string | null;
    emergency_contact_relationship: string | null;
    gender: string | null; nationality: string | null; marital_status: string | null;
    religion: string | null;
  } | null>(null)
  const [showAssets, setShowAssets] = useState(false)
  const [myAssets, setMyAssets] = useState<{ asset_name: string; asset_type: string }[]>([])
  const [showSkills, setShowSkills] = useState(false)
  const [showChangeRequest, setShowChangeRequest] = useState(false)
  const [changeType, setChangeType] = useState('')
  const [currentInfo, setCurrentInfo] = useState('')
  const [newInfo, setNewInfo] = useState('')
  const [additionalDetails, setAdditionalDetails] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const fetchData = useCallback(async () => {
    if (!EMPLOYEE_EMAIL || !companyUser?.company_id) return
    setLoading(true)
    const selectCols = 'firstname, surname, display_name, job_title, contract_type, user_email, date_of_birth, telephone, personal_email, address_line_1, address_line_2, address_line_3, address_line_4, emergency_contact_number, gender, nationality, religion, relationship, start_date, status, manager, location, employee_number, department, avatar_url'

    let { data } = await supabase
      .from('onboarding')
      .select(selectCols)
      .eq('user_email', EMPLOYEE_EMAIL)
      .eq('company_id', companyUser.company_id)
      .maybeSingle()

    if (!data) {
      const localPart = EMPLOYEE_EMAIL.split('@')[0].toLowerCase()
      const { data: fuzzy } = await supabase
        .from('onboarding')
        .select(selectCols)
        .eq('company_id', companyUser.company_id)
        .ilike('user_email', `${localPart}@%`)
        .limit(1)
        .maybeSingle()
      data = fuzzy
    }

    if (data) setProfile(data as OnboardingRecord)

    if (employeeId && companyUser?.company_id) {
      const { data: emp } = await supabase
        .from('employees')
        .select('date_of_birth, salary_group, qualifications, contract_type, phone, personal_email, address_line1, address_line2, city, county, postcode, country, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, gender, nationality, marital_status, religion')
        .eq('id', employeeId)
        .eq('company_id', companyUser.company_id)
        .maybeSingle()
      if (emp) setEmpData(emp)
    }

    setLoading(false)
  }, [EMPLOYEE_EMAIL, employeeId, companyUser?.company_id])

  useEffect(() => { fetchData() }, [fetchData])

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !employeeId) return
    setAvatarUploading(true)
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
    const path = `${employeeId}.${ext}`
    const { error: uploadErr } = await supabase.storage
      .from('avatars')
      .upload(path, file, { upsert: true })
    if (uploadErr) {
      setAvatarUploading(false)
      return
    }
    const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path)
    const newUrl = urlData.publicUrl + '?t=' + Date.now()
    const { error: empErr } = await supabase.from('employees').update({ avatar_url: newUrl }).eq('id', employeeId).eq('company_id', companyUser?.company_id)
    if (empErr) { showError('Failed to update photo: ' + empErr.message); setAvatarUploading(false); return }
    const onbEmail = profile?.user_email || EMPLOYEE_EMAIL
    const { error: onbErr } = await supabase.from('onboarding').update({ avatar_url: newUrl }).eq('user_email', onbEmail).eq('company_id', companyUser?.company_id)
    if (onbErr) { showError('Failed to update photo: ' + onbErr.message); setAvatarUploading(false); return }
    setProfile(prev => prev ? { ...prev, avatar_url: newUrl } : prev)
    updateAvatarUrl(newUrl)
    showSuccess('Photo updated')
    setAvatarUploading(false)
    if (avatarInputRef.current) avatarInputRef.current.value = ''
  }

  if (loading) return <div className="feature-page"><p className="claims-empty">{t('common.loading')}</p></div>
  if (!profile) return <div className="feature-page"><p className="claims-empty">{t('my_profile.not_found')}</p></div>

  const initials = `${(profile.firstname || '')[0] || ''}${(profile.surname || '')[0] || ''}`
  const fullName = profile.display_name || `${profile.firstname} ${profile.surname}`

  const addressLines = empData?.address_line1
    ? [empData.address_line1, empData.address_line2, empData.city, empData.county, empData.postcode, empData.country].filter(Boolean)
    : [profile.address_line_1, profile.address_line_2, profile.address_line_3, profile.address_line_4].filter(Boolean)

  async function openAssets() {
    if (!employeeId || !companyUser?.company_id) return
    const { data } = await supabase
      .from('company_assets')
      .select('asset_name, asset_type')
      .eq('company_id', companyUser.company_id)
      .eq('assigned_to', employeeId)
      .order('asset_type')
    setMyAssets((data as { asset_name: string; asset_type: string }[]) || [])
    setShowAssets(true)
  }

  async function openMembers() {
    if (profile?.department) {
      const { data } = await supabase
        .from('employees')
        .select('first_name, last_name, job_title')
        .eq('department', profile!.department)
        .eq('company_id', companyUser?.company_id)
        .eq('is_active', true)
        .order('first_name')
      setMembers((data || []) as DeptMember[])
    }
    setShowMembers(true)
  }

  const CHANGE_TYPES = [
    { value: 'name', label: 'Name' },
    { value: 'address', label: 'Address' },
    { value: 'phone', label: 'Phone Number' },
    { value: 'email', label: 'Personal Email' },
    { value: 'emergency-contact', label: 'Emergency Contact' },
    { value: 'bank-details', label: 'Bank Details' },
    { value: 'marital-status', label: 'Marital Status' },
    { value: 'other', label: 'Other' },
  ]

  async function submitChangeRequest() {
    if (!changeType || !currentInfo.trim() || !newInfo.trim() || !companyUser?.company_id) return
    setSubmitting(true)

    const { data: allRefs } = await supabase
      .from('hr_tickets')
      .select('ref')
      .eq('company_id', companyUser.company_id)
    const maxNum = (allRefs || []).reduce((max: number, r: { ref: string }) => {
      const num = parseInt(r.ref.replace('HR-', ''), 10)
      return isNaN(num) ? max : Math.max(max, num)
    }, 0)
    const ref = `HR-${String(maxNum + 1).padStart(3, '0')}`

    const typeLabel = CHANGE_TYPES.find(c => c.value === changeType)?.label || changeType
    const title = `Profile Change: ${typeLabel}`
    const description = `Change Type: ${typeLabel}\n\nCurrent Info: ${currentInfo.trim()}\n\nChange To: ${newInfo.trim()}${additionalDetails.trim() ? `\n\nAdditional Details: ${additionalDetails.trim()}` : ''}`

    const fullName = profile?.display_name || `${profile?.firstname} ${profile?.surname}`

    const { error } = await supabase.from('hr_tickets').insert({
      ref,
      title,
      description,
      category: 'user-request',
      priority: 'medium',
      status: 'open',
      submitted_by: fullName || 'Employee',
      assigned_to: 'HR Team',
      assigned_to_provider: false,
      company_id: companyUser.company_id,
    })

    if (error) {
      showError('Failed to submit request: ' + error.message)
      setSubmitting(false)
      return
    }

    setChangeType('')
    setCurrentInfo('')
    setNewInfo('')
    setAdditionalDetails('')
    setShowChangeRequest(false)
    showSuccess('Your request has been submitted to HR')
    setSubmitting(false)
  }

  return (
    <div className="feature-page my-profile-page">
      <header className="my-profile-header">
        <button className="my-profile-back" onClick={() => navigate('/')}>
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
            <circle cx="18" cy="18" r="17" stroke="#7b1fa2" strokeWidth="2" />
            <path d="M21 12l-6 6 6 6" stroke="#7b1fa2" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="my-profile-header-center">
          <h1 className="my-profile-title">
            {tab === 'personal'
              ? t('my_profile.title')
              : <>{t('my_profile.job_title_header')} <span className="my-profile-title-accent">{t('my_profile.job_title_accent')}</span></>
            }
          </h1>
          <p className="my-profile-subtitle">{tab === 'personal' ? t('my_profile.subtitle') : ''}</p>
        </div>
        <button className="feature-refresh" onClick={fetchData}>
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="14" stroke="#1565c0" strokeWidth="2" />
            <path d="M22 14a6.5 6.5 0 0 0-11.3-1.5M10 18a6.5 6.5 0 0 0 11.3 1.5" stroke="#1565c0" strokeWidth="2" strokeLinecap="round" />
            <path d="M22 10v4h-4M10 22v-4h4" stroke="#1565c0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </header>

      <div className="my-profile-tabs">
        <button className={`my-profile-tab ${tab === 'personal' ? 'my-profile-tab-active' : ''}`} onClick={() => setTab('personal')}>
          {t('my_profile.tab_personal')}
        </button>
        <button className={`my-profile-tab ${tab === 'job' ? 'my-profile-tab-active' : ''}`} onClick={() => setTab('job')}>
          {t('my_profile.tab_job')}
        </button>
      </div>

      <div className="my-profile-card">
        <div className="my-profile-emp-row">
          <div className="my-profile-avatar-wrap" onClick={() => avatarInputRef.current?.click()}>
            {profile.avatar_url ? (
              <img className="my-profile-avatar-img" src={profile.avatar_url} alt={fullName} />
            ) : (
              <div className="my-profile-avatar">{initials}</div>
            )}
            <div className="my-profile-avatar-overlay">
              {avatarUploading ? (
                <span className="my-profile-avatar-spinner" />
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                  <circle cx="12" cy="13" r="4"/>
                </svg>
              )}
            </div>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              onChange={handleAvatarChange}
              style={{ display: 'none' }}
            />
          </div>
          <div className="my-profile-emp-info">
            <span className="my-profile-emp-name">{fullName}</span>
            <span className="my-profile-emp-role">{profile.job_title}</span>
            {tab === 'job' && <span className="my-profile-emp-email">{profile.user_email}</span>}
          </div>
          <span className="my-profile-contract-badge">{empData?.contract_type || profile.contract_type}</span>
        </div>

        {tab === 'personal' && (
          <div className="my-profile-details">
            <div className="my-profile-grid">
              <div className="my-profile-field">
                <span className="my-profile-field-label">{t('my_profile.dob')}</span>
                <span className="my-profile-field-value">{formatDate(empData?.date_of_birth || profile.date_of_birth || null)}</span>
              </div>
              <div className="my-profile-field">
                <span className="my-profile-field-label">{t('my_profile.business_number')}</span>
                <span className="my-profile-field-value">{empData?.phone || profile.telephone || ''}</span>
              </div>
              <div className="my-profile-field">
                <span className="my-profile-field-label">{t('my_profile.personal_email')}</span>
                <span className="my-profile-field-value">{empData?.personal_email || profile.personal_email || ''}</span>
              </div>
            </div>

            <div className="my-profile-divider" />

            <div className="my-profile-grid">
              <div className="my-profile-field">
                <span className="my-profile-field-label">{t('my_profile.home_address')}</span>
                <div className="my-profile-address">
                  {addressLines.map((line, i) => (
                    <span key={i}>{line}</span>
                  ))}
                </div>
              </div>
              <div className="my-profile-field">
                <div className="my-profile-field-block">
                  <span className="my-profile-field-label">{t('my_profile.emergency_contact')}</span>
                  <span className="my-profile-field-value">{empData?.emergency_contact_name ? `${empData.emergency_contact_name} — ${empData.emergency_contact_phone || ''}` : (profile.emergency_contact_number || '')}</span>
                </div>
                <div className="my-profile-field-block">
                  <span className="my-profile-field-label">{t('my_profile.gender')}</span>
                  <span className="my-profile-field-value">{empData?.gender || profile.gender || ''}</span>
                </div>
                <div className="my-profile-field-block">
                  <span className="my-profile-field-label">{t('my_profile.nationality')}</span>
                  <span className="my-profile-field-value">{empData?.nationality || profile.nationality || ''}</span>
                </div>
                <div className="my-profile-field-block">
                  <span className="my-profile-field-label">{t('my_profile.religion')}</span>
                  <span className="my-profile-field-value">{empData?.religion || profile.religion || ''}</span>
                </div>
                <div className="my-profile-field-block">
                  <span className="my-profile-field-label">{t('my_profile.relationship')}</span>
                  <span className="my-profile-field-value">{empData?.marital_status || profile.relationship || ''}</span>
                </div>
              </div>
            </div>

            <div className="my-profile-divider" />

            <div className="my-profile-field">
              <span className="my-profile-field-label">{t('my_profile.education')}</span>
              <span className="my-profile-field-value" style={{ whiteSpace: 'pre-line' }}>{empData?.qualifications || ''}</span>
            </div>
          </div>
        )}

        {tab === 'job' && (
          <div className="my-profile-details">
            <div className="my-profile-grid">
              <div className="my-profile-field">
                <span className="my-profile-field-label">{t('my_profile.start_date')}</span>
                <span className="my-profile-field-value">{formatDate(profile.start_date)}</span>
              </div>
              <div className="my-profile-field">
                <span className="my-profile-field-label">{t('my_profile.current_status')}</span>
                <span className="my-profile-field-value">{profile.status}</span>
              </div>
              <div className="my-profile-field">
                <span className="my-profile-field-label">{t('my_profile.manager_assigned')}</span>
                <span className="my-profile-field-value">{profile.manager || ''}</span>
              </div>
              <div className="my-profile-field">
                <span className="my-profile-field-label">{t('my_profile.work_location')}</span>
                <span className="my-profile-field-value">{profile.location || ''}</span>
              </div>
            </div>

            <div className="my-profile-grid" style={{ marginTop: 12 }}>
              <div className="my-profile-field">
                <span className="my-profile-field-label">{t('my_profile.employee_id')}</span>
                <span className="my-profile-field-value">{profile.employee_number || ''}</span>
              </div>
              <div className="my-profile-field">
                <span className="my-profile-field-label">{t('my_profile.department')}</span>
                <span className="my-profile-field-value">{profile.department || ''}</span>
              </div>
            </div>

            <div style={{ textAlign: 'right', padding: '8px 0 4px', display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
              {features.skills_passport && (
                <button className="my-profile-members-btn" onClick={() => setShowSkills(true)}>My Skills</button>
              )}
              {features.asset_management && (
                <button className="my-profile-members-btn" onClick={openAssets}>My Assets</button>
              )}
              <button className="my-profile-members-btn" onClick={openMembers}>{t('my_profile.members')}</button>
            </div>
          </div>
        )}
      </div>

      {tab === 'job' && (
        <div className="my-profile-employment-status">
          <h3 className="my-profile-employment-status-title">{t('my_profile.employment_status')}</h3>
          <div className="my-profile-status-cards">
            <div className="my-profile-status-card">
              <span className="my-profile-status-card-header my-profile-status-blue">{t('my_profile.salary_group')}</span>
              <span className="my-profile-status-card-value">{empData?.salary_group || 'N/A'}</span>
            </div>
            <div className="my-profile-status-card">
              <span className="my-profile-status-card-header my-profile-status-purple">{t('my_profile.emp_status')}</span>
              <span className="my-profile-status-card-value">{t('my_profile.employed')}</span>
            </div>
            <div className="my-profile-status-card">
              <span className="my-profile-status-card-header my-profile-status-blue">{t('my_profile.emp_type')}</span>
              <span className="my-profile-status-card-value">{empData?.contract_type || profile.contract_type}</span>
            </div>

          </div>
        </div>
      )}
      <button className="my-profile-cr-fab" onClick={() => setShowChangeRequest(true)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
        Request Profile Change
      </button>

      {showChangeRequest && (
        <div className="my-profile-modal-overlay" onClick={() => setShowChangeRequest(false)}>
          <div className="my-profile-cr-modal" onClick={e => e.stopPropagation()}>
            <div className="my-profile-modal-header">
              <span className="my-profile-modal-dept">Profile Change Request</span>
              <button className="my-profile-cr-close-btn" onClick={() => setShowChangeRequest(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
            <p className="my-profile-cr-hint">Request a change to your profile details. Your HR team will review and action it.</p>
            <div className="my-profile-cr-form">
              <div className="my-profile-cr-field">
                <label className="my-profile-cr-label">Change Type <span className="my-profile-cr-req">*</span></label>
                <select
                  className="my-profile-cr-select"
                  value={changeType}
                  onChange={e => setChangeType(e.target.value)}
                >
                  <option value="">— Select what you need to change —</option>
                  {CHANGE_TYPES.map(ct => (
                    <option key={ct.value} value={ct.value}>{ct.label}</option>
                  ))}
                </select>
              </div>

              <div className="my-profile-cr-field">
                <label className="my-profile-cr-label">What's Wrong / Current Info <span className="my-profile-cr-req">*</span></label>
                <input
                  className="my-profile-cr-input"
                  type="text"
                  placeholder="e.g. My surname is shown as Smith"
                  value={currentInfo}
                  onChange={e => setCurrentInfo(e.target.value)}
                />
              </div>

              <div className="my-profile-cr-field">
                <label className="my-profile-cr-label">Change To / Correct Info <span className="my-profile-cr-req">*</span></label>
                <input
                  className="my-profile-cr-input"
                  type="text"
                  placeholder="e.g. It should be Jones"
                  value={newInfo}
                  onChange={e => setNewInfo(e.target.value)}
                />
              </div>

              <div className="my-profile-cr-field">
                <label className="my-profile-cr-label">Additional Details <span className="my-profile-cr-optional">(optional)</span></label>
                <textarea
                  className="my-profile-cr-textarea"
                  placeholder="Any extra context to help HR process this faster"
                  value={additionalDetails}
                  onChange={e => { if (e.target.value.length <= 150) setAdditionalDetails(e.target.value) }}
                  maxLength={150}
                />
                <span className="my-profile-cr-charcount">{additionalDetails.length}/150</span>
              </div>

              <button
                className="my-profile-cr-submit"
                onClick={submitChangeRequest}
                disabled={submitting || !changeType || !currentInfo.trim() || !newInfo.trim()}
              >
                {submitting ? 'Submitting...' : 'Submit Request'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAssets && (
        <div className="my-profile-modal-overlay" onClick={() => setShowAssets(false)}>
          <div className="my-profile-modal" onClick={e => e.stopPropagation()}>
            <div className="my-profile-modal-header">
              <span className="my-profile-modal-dept">My Assets</span>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            </div>
            <div className="my-profile-modal-list">
              {myAssets.length === 0 && (
                <div style={{ padding: 16, textAlign: 'center', color: '#999', fontSize: 13 }}>No assets assigned to you</div>
              )}
              {myAssets.map((a, i) => (
                <div key={i} className="my-profile-modal-row">
                  <span className="my-profile-modal-name">{a.asset_name}</span>
                  <span className="my-profile-modal-role">{a.asset_type}</span>
                </div>
              ))}
            </div>
            <button className="my-profile-modal-close" onClick={() => setShowAssets(false)}>
              {t('my_profile.close')}
            </button>
          </div>
        </div>
      )}
      {showMembers && (
        <div className="my-profile-modal-overlay" onClick={() => setShowMembers(false)}>
          <div className="my-profile-modal" onClick={e => e.stopPropagation()}>
            <div className="my-profile-modal-header">
              <span className="my-profile-modal-dept">{profile.department}</span>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            <div className="my-profile-modal-list">
              {members.map((m, i) => (
                <div key={i} className="my-profile-modal-row">
                  <span className="my-profile-modal-name">{m.first_name} {m.last_name}</span>
                  <span className="my-profile-modal-role">{m.job_title || ''}</span>
                </div>
              ))}
            </div>
            <button className="my-profile-modal-close" onClick={() => setShowMembers(false)}>
              {t('my_profile.close')}
            </button>
          </div>
        </div>
      )}
      {showSkills && (
        <div className="my-profile-modal-overlay" onClick={() => setShowSkills(false)}>
          <div className="my-profile-cr-modal" style={{ maxHeight: '85vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
            <div className="my-profile-modal-header">
              <span className="my-profile-modal-dept">My Skills Passport</span>
              <button className="my-profile-cr-close-btn" onClick={() => setShowSkills(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
            <SkillsPassportEmbed companyId={companyUser?.company_id || ''} employeeId={employeeId || ''} showSuccess={showSuccess} showError={showError} />
          </div>
        </div>
      )}
    </div>
  )
}

const PROFICIENCY_LABELS = ['', 'Foundational', 'Developing', 'Proficient', 'Advanced', 'Expert']
const PROFICIENCY_COLORS = ['', '#6b7280', '#3b82f6', '#8b5cf6', '#f59e0b', '#10b981']
const STATUS_LABELS: Record<string, string> = { self_declared: 'Self-declared', pending_validation: 'Pending', validated: 'Validated', rejected: 'Rejected' }
const STATUS_COLORS: Record<string, string> = { self_declared: '#6b7280', pending_validation: '#f59e0b', validated: '#16a34a', rejected: '#dc2626' }
const TIMEFRAME_LABELS: Record<string, string> = { '6_months': 'Within 6 months', '1_year': 'Within 1 year', '2_years': 'Within 2 years', '3_plus_years': '3+ years' }

interface SkillCategory { id: string; name: string }
interface SkillOption { id: string; category_id: string; name: string }
interface EmployeeSkillItem { id: string; skill_id: string; proficiency: number; status: string; skill_name?: string; category_name?: string }

function SkillsPassportEmbed({ companyId, employeeId, showSuccess, showError }: { companyId: string; employeeId: string; showSuccess: (m: string) => void; showError: (m: string) => void }) {
  const [tab, setTab] = useState<'skills' | 'certs' | 'goals'>('skills')
  const [categories, setCategories] = useState<SkillCategory[]>([])
  const [allSkills, setAllSkills] = useState<SkillOption[]>([])
  const [mySkills, setMySkills] = useState<EmployeeSkillItem[]>([])
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    if (!companyId || !employeeId) return
    setLoading(true)
    const [catRes, skillRes, myRes] = await Promise.all([
      supabase.from('skill_categories').select('id, name').eq('company_id', companyId).order('sort_order, name'),
      supabase.from('skills').select('id, category_id, name').eq('company_id', companyId).eq('is_active', true).order('name'),
      supabase.from('employee_skills').select('*').eq('employee_id', employeeId).eq('company_id', companyId),
    ])
    const cats = catRes.data || []
    const sks = skillRes.data || []
    setCategories(cats)
    setAllSkills(sks)
    const catMap = new Map(cats.map(c => [c.id, c.name]))
    const skMap = new Map(sks.map(s => [s.id, s]))
    setMySkills((myRes.data || []).map(es => {
      const sk = skMap.get(es.skill_id)
      return { ...es, skill_name: sk?.name || 'Unknown', category_name: sk ? catMap.get(sk.category_id) || '' : '' }
    }))
    setLoading(false)
  }, [companyId, employeeId])

  useEffect(() => { loadData() }, [loadData])

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {(['skills', 'certs', 'goals'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: tab === t ? 600 : 400, border: tab === t ? '2px solid var(--text)' : '1px solid var(--border)', background: tab === t ? 'var(--text)' : 'transparent', color: tab === t ? 'var(--bg)' : 'var(--text)', cursor: 'pointer' }}>
            {t === 'skills' ? 'My Skills' : t === 'certs' ? 'Certifications' : 'Career Goals'}
          </button>
        ))}
      </div>
      {loading && <p style={{ color: 'var(--text-muted)', textAlign: 'center' }}>Loading...</p>}
      {!loading && tab === 'skills' && <SkillsTab companyId={companyId} employeeId={employeeId} categories={categories} allSkills={allSkills} mySkills={mySkills} onRefresh={loadData} showSuccess={showSuccess} showError={showError} />}
      {!loading && tab === 'certs' && <CertsTab companyId={companyId} employeeId={employeeId} showSuccess={showSuccess} showError={showError} />}
      {!loading && tab === 'goals' && <GoalsTab companyId={companyId} employeeId={employeeId} showSuccess={showSuccess} showError={showError} />}
    </div>
  )
}

function SkillsTab({ companyId, employeeId, categories, allSkills, mySkills, onRefresh, showSuccess, showError }: {
  companyId: string; employeeId: string; categories: SkillCategory[]; allSkills: SkillOption[]; mySkills: EmployeeSkillItem[]
  onRefresh: () => void; showSuccess: (m: string) => void; showError: (m: string) => void
}) {
  const [showAdd, setShowAdd] = useState(false)
  const [addSkillId, setAddSkillId] = useState('')
  const [addProf, setAddProf] = useState(3)
  const [saving, setSaving] = useState(false)

  const existingIds = new Set(mySkills.map(s => s.skill_id))
  const available = allSkills.filter(s => !existingIds.has(s.id))

  async function addSkill() {
    if (!addSkillId) return
    setSaving(true)
    const { error } = await supabase.from('employee_skills').insert({ company_id: companyId, employee_id: employeeId, skill_id: addSkillId, proficiency: addProf, status: 'self_declared' })
    setSaving(false)
    if (error) { showError(error.message); return }
    showSuccess('Skill added')
    setAddSkillId(''); setAddProf(3); setShowAdd(false)
    onRefresh()
  }

  async function removeSkill(esId: string) {
    await supabase.from('skill_evidence').delete().eq('employee_skill_id', esId)
    await supabase.from('employee_skills').delete().eq('id', esId)
    showSuccess('Skill removed')
    onRefresh()
  }

  async function requestValidation(es: EmployeeSkillItem) {
    const { data: emp } = await supabase.from('employees').select('manager_id').eq('id', employeeId).single()
    if (!emp?.manager_id) { showError('No manager assigned'); return }
    await supabase.from('employee_skills').update({ status: 'pending_validation' }).eq('id', es.id)
    await supabase.from('skill_validations').insert({ company_id: companyId, employee_skill_id: es.id, requested_by: employeeId, assigned_to: emp.manager_id })
    const { data: mgr } = await supabase.from('employees').select('email').eq('id', emp.manager_id).single()
    if (mgr?.email) {
      await supabase.from('workflow_tracker').insert({ company_id: companyId, type: 'Skill Validation', reference_id: es.id, assigned_to: mgr.email, status: 'Pending', description: `Skill validation requested for ${es.skill_name}` })
      window.dispatchEvent(new Event('notifications-updated'))
    }
    showSuccess('Validation request sent')
    onRefresh()
  }

  async function updateProf(esId: string, prof: number) {
    await supabase.from('employee_skills').update({ proficiency: prof, updated_at: new Date().toISOString() }).eq('id', esId)
    onRefresh()
  }

  const grouped = categories.map(c => ({ ...c, skills: mySkills.filter(s => s.category_name === c.name) })).filter(g => g.skills.length > 0)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{mySkills.length} skill{mySkills.length !== 1 ? 's' : ''}</span>
        <button onClick={() => setShowAdd(true)} style={{ padding: '6px 14px', borderRadius: 8, fontSize: 13, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', color: 'var(--text)' }}>+ Add Skill</button>
      </div>
      {showAdd && (
        <div style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 8, marginBottom: 12 }}>
          <select value={addSkillId} onChange={e => setAddSkillId(e.target.value)} style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid var(--border)', marginBottom: 8 }}>
            <option value="">Select a skill...</option>
            {categories.map(cat => {
              const cs = available.filter(s => s.category_id === cat.id)
              if (cs.length === 0) return null
              return <optgroup key={cat.id} label={cat.name}>{cs.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>
            })}
          </select>
          <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
            {[1,2,3,4,5].map(n => (
              <button key={n} onClick={() => setAddProf(n)} style={{ flex: 1, padding: '4px 2px', borderRadius: 6, fontSize: 11, fontWeight: addProf === n ? 600 : 400, border: `2px solid ${addProf === n ? PROFICIENCY_COLORS[n] : 'var(--border)'}`, background: addProf === n ? PROFICIENCY_COLORS[n] + '20' : 'transparent', color: addProf === n ? PROFICIENCY_COLORS[n] : 'var(--text-muted)', cursor: 'pointer' }}>
                {PROFICIENCY_LABELS[n]}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={addSkill} disabled={saving} style={{ padding: '6px 16px', borderRadius: 8, background: '#1565c0', color: '#fff', border: 'none', cursor: 'pointer' }}>{saving ? 'Adding...' : 'Add'}</button>
            <button onClick={() => setShowAdd(false)} style={{ padding: '6px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', color: 'var(--text)' }}>Cancel</button>
          </div>
        </div>
      )}
      {mySkills.length === 0 && !showAdd && <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No skills recorded yet. Add your first skill to start building your passport.</p>}
      {grouped.map(g => (
        <div key={g.id} style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{g.name}</div>
          {g.skills.map(es => (
            <div key={es.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 120 }}>
                <div style={{ fontWeight: 500, fontSize: 14 }}>{es.skill_name}</div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
                  <select value={es.proficiency} onChange={e => updateProf(es.id, Number(e.target.value))} style={{ padding: '1px 6px', borderRadius: 10, fontSize: 11, border: `1px solid ${PROFICIENCY_COLORS[es.proficiency]}`, color: PROFICIENCY_COLORS[es.proficiency], background: 'transparent', cursor: 'pointer' }}>
                    {[1,2,3,4,5].map(n => <option key={n} value={n}>{PROFICIENCY_LABELS[n]}</option>)}
                  </select>
                  <span style={{ padding: '1px 6px', borderRadius: 10, fontSize: 11, background: STATUS_COLORS[es.status] + '20', color: STATUS_COLORS[es.status] }}>{STATUS_LABELS[es.status]}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                {(es.status === 'self_declared' || es.status === 'rejected') && (
                  <button onClick={() => requestValidation(es)} style={{ padding: '3px 8px', borderRadius: 6, fontSize: 11, border: '1px solid #3b82f6', color: '#3b82f6', background: 'transparent', cursor: 'pointer' }}>Validate</button>
                )}
                <button onClick={() => removeSkill(es.id)} style={{ padding: '3px 8px', borderRadius: 6, fontSize: 11, border: '1px solid #dc2626', color: '#dc2626', background: 'transparent', cursor: 'pointer' }}>✕</button>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function CertsTab({ companyId, employeeId, showSuccess, showError }: { companyId: string; employeeId: string; showSuccess: (m: string) => void; showError: (m: string) => void }) {
  const [certs, setCerts] = useState<{ id: string; name: string; issuing_body: string; issue_date: string; expiry_date: string | null; credential_id: string | null; status: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', issuing_body: '', issue_date: '', expiry_date: '', credential_id: '' })
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('employee_certifications').select('id, name, issuing_body, issue_date, expiry_date, credential_id, status').eq('employee_id', employeeId).eq('company_id', companyId).order('issue_date', { ascending: false })
    setCerts(data || [])
    setLoading(false)
  }, [companyId, employeeId])

  useEffect(() => { load() }, [load])

  async function addCert() {
    if (!form.name.trim() || !form.issuing_body.trim() || !form.issue_date) return
    setSaving(true)
    const today = new Date().toISOString().split('T')[0]
    const { error } = await supabase.from('employee_certifications').insert({ company_id: companyId, employee_id: employeeId, name: form.name.trim(), issuing_body: form.issuing_body.trim(), issue_date: form.issue_date, expiry_date: form.expiry_date || null, credential_id: form.credential_id.trim() || null, status: form.expiry_date && form.expiry_date < today ? 'expired' : 'active' })
    setSaving(false)
    if (error) { showError(error.message); return }
    showSuccess('Certification added')
    setForm({ name: '', issuing_body: '', issue_date: '', expiry_date: '', credential_id: '' })
    setShowAdd(false)
    load()
  }

  if (loading) return <p style={{ color: 'var(--text-muted)', textAlign: 'center' }}>Loading...</p>

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{certs.length} certification{certs.length !== 1 ? 's' : ''}</span>
        <button onClick={() => setShowAdd(true)} style={{ padding: '6px 14px', borderRadius: 8, fontSize: 13, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', color: 'var(--text)' }}>+ Add</button>
      </div>
      {showAdd && (
        <div style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 8, marginBottom: 12 }}>
          <input placeholder="Certification name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid var(--border)', marginBottom: 8, boxSizing: 'border-box' }} />
          <input placeholder="Issuing body" value={form.issuing_body} onChange={e => setForm({ ...form, issuing_body: e.target.value })} style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid var(--border)', marginBottom: 8, boxSizing: 'border-box' }} />
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, display: 'block', marginBottom: 2 }}>Issue Date</label>
              <input type="date" value={form.issue_date} onChange={e => setForm({ ...form, issue_date: e.target.value })} style={{ width: '100%', padding: 6, borderRadius: 8, border: '1px solid var(--border)', boxSizing: 'border-box' }} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, display: 'block', marginBottom: 2 }}>Expiry (optional)</label>
              <input type="date" value={form.expiry_date} onChange={e => setForm({ ...form, expiry_date: e.target.value })} style={{ width: '100%', padding: 6, borderRadius: 8, border: '1px solid var(--border)', boxSizing: 'border-box' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={addCert} disabled={saving} style={{ padding: '6px 16px', borderRadius: 8, background: '#1565c0', color: '#fff', border: 'none', cursor: 'pointer' }}>{saving ? 'Saving...' : 'Add'}</button>
            <button onClick={() => setShowAdd(false)} style={{ padding: '6px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', color: 'var(--text)' }}>Cancel</button>
          </div>
        </div>
      )}
      {certs.length === 0 && !showAdd && <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No certifications recorded.</p>}
      {certs.map(c => (
        <div key={c.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 500, fontSize: 14 }}>{c.name}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.issuing_body} · {formatDate(c.issue_date)}{c.expiry_date ? ` — ${formatDate(c.expiry_date)}` : ''}</div>
          </div>
          <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: 11, background: c.status === 'active' ? '#dcfce7' : '#fee2e2', color: c.status === 'active' ? '#16a34a' : '#dc2626' }}>{c.status === 'active' ? 'Active' : 'Expired'}</span>
        </div>
      ))}
    </div>
  )
}

function GoalsTab({ companyId, employeeId, showSuccess, showError }: { companyId: string; employeeId: string; showSuccess: (m: string) => void; showError: (m: string) => void }) {
  const [aspiration, setAspiration] = useState<{ id: string; target_role: string | null; target_department: string | null; timeframe: string | null; notes: string | null } | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ target_role: '', target_department: '', timeframe: '', notes: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data } = await supabase.from('employee_career_aspirations').select('*').eq('employee_id', employeeId).eq('company_id', companyId).maybeSingle()
      setAspiration(data)
      if (data) setForm({ target_role: data.target_role || '', target_department: data.target_department || '', timeframe: data.timeframe || '', notes: data.notes || '' })
      setLoading(false)
    }
    load()
  }, [companyId, employeeId])

  async function save() {
    setSaving(true)
    const payload = { company_id: companyId, employee_id: employeeId, target_role: form.target_role.trim() || null, target_department: form.target_department.trim() || null, timeframe: form.timeframe || null, notes: form.notes.trim() || null, updated_at: new Date().toISOString() }
    const { error } = aspiration
      ? await supabase.from('employee_career_aspirations').update(payload).eq('id', aspiration.id)
      : await supabase.from('employee_career_aspirations').insert(payload)
    setSaving(false)
    if (error) { showError(error.message); return }
    showSuccess('Career goals saved')
    setEditing(false)
    const { data } = await supabase.from('employee_career_aspirations').select('*').eq('employee_id', employeeId).eq('company_id', companyId).maybeSingle()
    setAspiration(data)
  }

  if (loading) return <p style={{ color: 'var(--text-muted)', textAlign: 'center' }}>Loading...</p>

  if (!aspiration && !editing) {
    return (
      <div style={{ textAlign: 'center', padding: 16 }}>
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Share your career aspirations to help your organisation understand your development interests.</p>
        <button onClick={() => setEditing(true)} style={{ padding: '8px 20px', borderRadius: 8, background: '#1565c0', color: '#fff', border: 'none', cursor: 'pointer' }}>Set Career Goals</button>
      </div>
    )
  }

  if (editing) {
    return (
      <div>
        <div style={{ marginBottom: 8 }}>
          <label style={{ fontSize: 12, display: 'block', marginBottom: 2, fontWeight: 500 }}>Target Role</label>
          <input value={form.target_role} onChange={e => setForm({ ...form, target_role: e.target.value })} placeholder="e.g. Senior Developer" style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid var(--border)', boxSizing: 'border-box' }} />
        </div>
        <div style={{ marginBottom: 8 }}>
          <label style={{ fontSize: 12, display: 'block', marginBottom: 2, fontWeight: 500 }}>Department</label>
          <input value={form.target_department} onChange={e => setForm({ ...form, target_department: e.target.value })} placeholder="e.g. Engineering" style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid var(--border)', boxSizing: 'border-box' }} />
        </div>
        <div style={{ marginBottom: 8 }}>
          <label style={{ fontSize: 12, display: 'block', marginBottom: 2, fontWeight: 500 }}>Timeframe</label>
          <select value={form.timeframe} onChange={e => setForm({ ...form, timeframe: e.target.value })} style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid var(--border)', boxSizing: 'border-box' }}>
            <option value="">Select...</option>
            {Object.entries(TIMEFRAME_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, display: 'block', marginBottom: 2, fontWeight: 500 }}>Notes</label>
          <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} placeholder="Additional details..." style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid var(--border)', boxSizing: 'border-box' }} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={save} disabled={saving} style={{ padding: '6px 16px', borderRadius: 8, background: '#1565c0', color: '#fff', border: 'none', cursor: 'pointer' }}>{saving ? 'Saving...' : 'Save'}</button>
          <button onClick={() => setEditing(false)} style={{ padding: '6px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', color: 'var(--text)' }}>Cancel</button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <strong>Career Goals</strong>
        <button onClick={() => setEditing(true)} style={{ padding: '4px 12px', borderRadius: 6, fontSize: 12, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', color: 'var(--text)' }}>Edit</button>
      </div>
      {aspiration?.target_role && <div style={{ marginBottom: 6 }}><span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Target Role</span><div style={{ fontWeight: 500 }}>{aspiration.target_role}</div></div>}
      {aspiration?.target_department && <div style={{ marginBottom: 6 }}><span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Department</span><div style={{ fontWeight: 500 }}>{aspiration.target_department}</div></div>}
      {aspiration?.timeframe && <div style={{ marginBottom: 6 }}><span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Timeframe</span><div style={{ fontWeight: 500 }}>{TIMEFRAME_LABELS[aspiration.timeframe] || aspiration.timeframe}</div></div>}
      {aspiration?.notes && <div><span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Notes</span><div>{aspiration.notes}</div></div>}
    </div>
  )
}
