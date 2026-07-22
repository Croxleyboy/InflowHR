import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'

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

function formatDate(dateStr: string | null): string {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

export default function MyProfile() {
  const navigate = useNavigate()
  const { t } = useLanguage()
  const { employeeEmail: EMPLOYEE_EMAIL } = useAuth()
  const [tab, setTab] = useState<'personal' | 'job'>('personal')
  const [profile, setProfile] = useState<OnboardingRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [showMembers, setShowMembers] = useState(false)
  const [members, setMembers] = useState<DeptMember[]>([])

  const fetchData = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('onboarding')
      .select('firstname, surname, display_name, job_title, contract_type, user_email, date_of_birth, telephone, personal_email, address_line_1, address_line_2, address_line_3, address_line_4, emergency_contact_number, gender, nationality, religion, relationship, start_date, status, manager, location, employee_number, department, avatar_url')
      .eq('user_email', EMPLOYEE_EMAIL)
      .single()

    if (data) setProfile(data as OnboardingRecord)
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  if (loading) return <div className="feature-page"><p className="claims-empty">{t('common.loading')}</p></div>
  if (!profile) return <div className="feature-page"><p className="claims-empty">{t('my_profile.not_found')}</p></div>

  const initials = `${(profile.firstname || '')[0] || ''}${(profile.surname || '')[0] || ''}`
  const fullName = profile.display_name || `${profile.firstname} ${profile.surname}`

  const addressLines = [profile.address_line_1, profile.address_line_2, profile.address_line_3, profile.address_line_4].filter(Boolean)

  async function openMembers() {
    if (profile?.department) {
      const { data } = await supabase
        .from('employees')
        .select('first_name, last_name, job_title')
        .eq('department', profile!.department)
        .eq('is_active', true)
        .order('first_name')
      setMembers((data || []) as DeptMember[])
    }
    setShowMembers(true)
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
          {profile.avatar_url ? (
            <img className="my-profile-avatar-img" src={profile.avatar_url} alt={fullName} />
          ) : (
            <div className="my-profile-avatar">{initials}</div>
          )}
          <div className="my-profile-emp-info">
            <span className="my-profile-emp-name">{fullName}</span>
            <span className="my-profile-emp-role">{profile.job_title}</span>
            {tab === 'job' && <span className="my-profile-emp-email">{profile.user_email}</span>}
          </div>
          <span className="my-profile-contract-badge">{profile.contract_type}</span>
        </div>

        {tab === 'personal' && (
          <div className="my-profile-details">
            <div className="my-profile-grid">
              <div className="my-profile-field">
                <span className="my-profile-field-label">{t('my_profile.dob')}</span>
                <span className="my-profile-field-value">{formatDate(profile.date_of_birth)}</span>
              </div>
              <div className="my-profile-field">
                <span className="my-profile-field-label">{t('my_profile.business_number')}</span>
                <span className="my-profile-field-value">{profile.telephone || ''}</span>
              </div>
              <div className="my-profile-field">
                <span className="my-profile-field-label">{t('my_profile.personal_mobile')}</span>
                <span className="my-profile-field-value">{profile.telephone || ''}</span>
              </div>
              <div className="my-profile-field">
                <span className="my-profile-field-label">{t('my_profile.mobile_number')}</span>
                <span className="my-profile-field-value"></span>
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
                  <span className="my-profile-field-value">{profile.emergency_contact_number || ''}</span>
                </div>
                <div className="my-profile-field-block">
                  <span className="my-profile-field-label">{t('my_profile.gender')}</span>
                  <span className="my-profile-field-value">{profile.gender || ''}</span>
                </div>
                <div className="my-profile-field-block">
                  <span className="my-profile-field-label">{t('my_profile.nationality')}</span>
                  <span className="my-profile-field-value">{profile.nationality || ''}</span>
                </div>
                <div className="my-profile-field-block">
                  <span className="my-profile-field-label">{t('my_profile.religion')}</span>
                  <span className="my-profile-field-value">{profile.religion || ''}</span>
                </div>
                <div className="my-profile-field-block">
                  <span className="my-profile-field-label">{t('my_profile.relationship')}</span>
                  <span className="my-profile-field-value">{profile.relationship || ''}</span>
                </div>
              </div>
            </div>

            <div className="my-profile-divider" />

            <div className="my-profile-field">
              <span className="my-profile-field-label">{t('my_profile.education')}</span>
              <span className="my-profile-field-value"></span>
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

            <div style={{ textAlign: 'right', padding: '8px 0 4px' }}>
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
              <span className="my-profile-status-card-value">Grade 3</span>
            </div>
            <div className="my-profile-status-card">
              <span className="my-profile-status-card-header my-profile-status-purple">{t('my_profile.emp_status')}</span>
              <span className="my-profile-status-card-value">{t('my_profile.employed')}</span>
            </div>
            <div className="my-profile-status-card">
              <span className="my-profile-status-card-header my-profile-status-blue">{t('my_profile.emp_type')}</span>
              <span className="my-profile-status-card-value">{profile.contract_type}</span>
            </div>
            <div className="my-profile-status-card my-profile-status-tbc">
              <span className="my-profile-status-card-value">TBC</span>
            </div>
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
    </div>
  )
}
