import { useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'

export default function InitialSetup() {
  const { t } = useLanguage()
  const { employeeEmail, employeeName, employeeId, companyUser, markSetupComplete } = useAuth()
  const initials = employeeName.split(' ').map(n => n[0]).join('').toUpperCase() || '?'

  const [dob, setDob] = useState('')
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [nextOfKinName, setNextOfKinName] = useState('')
  const [nextOfKinPhone, setNextOfKinPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setAvatarFile(file)
    const reader = new FileReader()
    reader.onload = () => setAvatarPreview(reader.result as string)
    reader.readAsDataURL(file)
  }

  const isValid = dob && avatarFile && nextOfKinName.trim() && nextOfKinPhone.trim()

  async function handleSubmit() {
    if (!isValid || !avatarFile) return
    setSaving(true)
    setError(null)

    let avatarUrl = ''
    if (employeeId) {
      const ext = avatarFile.name.split('.').pop()?.toLowerCase() || 'jpg'
      const path = `${employeeId}.${ext}`
      const { error: uploadErr } = await supabase.storage
        .from('avatars')
        .upload(path, avatarFile, { upsert: true })
      if (uploadErr) {
        setError(uploadErr.message)
        setSaving(false)
        return
      }
      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path)
      avatarUrl = urlData.publicUrl + '?t=' + Date.now()

      await supabase.from('employees')
        .update({ avatar_url: avatarUrl })
        .eq('id', employeeId)
    }

    const onbUpdate: Record<string, any> = {
      date_of_birth: dob,
      emergency_contact_name: nextOfKinName.trim(),
      emergency_contact_number: nextOfKinPhone.trim(),
      emergency_contact_phone: nextOfKinPhone.trim(),
      initial_setup_complete: true,
    }
    if (avatarUrl) onbUpdate.avatar_url = avatarUrl
    let q = supabase.from('onboarding').update(onbUpdate).eq('user_email', employeeEmail)
    if (companyUser?.company_id) q = q.eq('company_id', companyUser.company_id)
    const { error: updErr } = await q

    if (updErr) {
      setError(updErr.message)
      setSaving(false)
      return
    }

    if (employeeId) {
      const empUpdate: Record<string, any> = {
        date_of_birth: dob,
        emergency_contact_name: nextOfKinName.trim(),
        emergency_contact_phone: nextOfKinPhone.trim(),
      }
      if (avatarUrl) empUpdate.avatar_url = avatarUrl
      await supabase.from('employees').update(empUpdate).eq('id', employeeId)
    }

    markSetupComplete()
  }

  return (
    <div className="initial-setup-page">
      <div className="setup-card">
        <div className="setup-header">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.5">
            <circle cx="12" cy="8" r="4" />
            <path d="M20 21a8 8 0 1 0-16 0" />
          </svg>
          <h1>{t('setup.title')}</h1>
          <p>{t('setup.subtitle')}</p>
        </div>

        <div className="setup-body">
          <div className="setup-avatar-section" onClick={() => fileRef.current?.click()}>
            {avatarPreview ? (
              <img className="setup-avatar-img" src={avatarPreview} alt="Avatar" />
            ) : (
              <div className="setup-avatar-placeholder">{initials}</div>
            )}
            <span className="setup-avatar-label">
              {avatarPreview ? t('setup.change_photo') : t('setup.add_photo')}
            </span>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
          </div>

          <div className="form-field">
            <label className="field-label">{t('setup.date_of_birth')}</label>
            <input
              type="date"
              className="form-input"
              value={dob}
              onChange={e => setDob(e.target.value)}
            />
          </div>

          <div className="setup-section-label">{t('setup.next_of_kin')}</div>

          <div className="form-field">
            <label className="field-label">{t('setup.kin_name')}</label>
            <input
              type="text"
              className="form-input"
              placeholder={t('setup.kin_name_placeholder')}
              value={nextOfKinName}
              onChange={e => setNextOfKinName(e.target.value)}
            />
          </div>

          <div className="form-field">
            <label className="field-label">{t('setup.kin_phone')}</label>
            <input
              type="tel"
              className="form-input"
              placeholder={t('setup.kin_phone_placeholder')}
              value={nextOfKinPhone}
              onChange={e => setNextOfKinPhone(e.target.value)}
            />
          </div>

          {error && <p className="form-error">{error}</p>}

          <button
            className="setup-submit-btn"
            onClick={handleSubmit}
            disabled={!isValid || saving}
          >
            {saving ? t('setup.saving') : t('setup.continue')}
          </button>

          <p className="setup-hint">{t('setup.required_hint')}</p>
        </div>
      </div>
    </div>
  )
}
