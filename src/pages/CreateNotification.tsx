import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'

export default function CreateNotification() {
  const navigate = useNavigate()
  const { t } = useLanguage()
  const { employeeId: HARDCODED_EMPLOYEE_ID, employeeName: HARDCODED_EMPLOYEE_NAME, companyUser, isSuperAdmin } = useAuth()

  useEffect(() => {
    if (isSuperAdmin || companyUser?.role === 'admin') return
    if (!HARDCODED_EMPLOYEE_ID) return
    supabase.from('employees')
      .select('can_post_notifications')
      .eq('id', HARDCODED_EMPLOYEE_ID)
      .eq('company_id', companyUser?.company_id)
      .single()
      .then(({ data }) => {
        if (!data?.can_post_notifications) navigate('/notifications', { replace: true })
      })
  }, [HARDCODED_EMPLOYEE_ID, isSuperAdmin, companyUser?.role, navigate])
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const canSubmit = title.trim().length > 0 && message.trim().length > 0

  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)

    const row: Record<string, any> = {
      title: title.trim(),
      body: message.trim(),
      submitted_by_name: HARDCODED_EMPLOYEE_NAME,
      is_pinned: false,
      company_id: companyUser?.company_id,
      published_at: new Date().toISOString(),
    }
    if (HARDCODED_EMPLOYEE_ID) row.author_id = HARDCODED_EMPLOYEE_ID

    const { error: insertErr } = await supabase.from('announcements').insert(row)

    if (insertErr) {
      setError(insertErr.message)
      setSubmitting(false)
      return
    }

    navigate('/notifications', { state: { tab: 'company' } })
  }

  return (
    <div className="feature-page create-notif-page">
      <header className="create-notif-header">
        <button className="create-notif-back" onClick={() => navigate('/notifications')}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 className="create-notif-title">{t('create_notif.title')}</h1>
      </header>

      <div className="create-notif-banner">
        <svg viewBox="0 0 480 160" xmlns="http://www.w3.org/2000/svg" className="create-notif-banner-svg">
          <defs>
            <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#1a3a5c" />
              <stop offset="100%" stopColor="#2d5a8e" />
            </linearGradient>
          </defs>
          <rect width="480" height="160" fill="url(#bg)" />
          <rect x="30" y="50" width="60" height="80" rx="4" fill="#3d6b99" opacity="0.6" />
          <rect x="35" y="55" width="50" height="35" rx="2" fill="#5a8ec7" opacity="0.5" />
          <circle cx="60" cy="45" r="8" fill="#e8a838" />
          <rect x="100" y="40" width="80" height="90" rx="4" fill="#4a7fb5" opacity="0.5" />
          <rect x="105" y="45" width="70" height="40" rx="2" fill="#6ba3d6" opacity="0.4" />
          <circle cx="140" cy="35" r="7" fill="#c8e600" />
          <rect x="200" y="60" width="70" height="70" rx="4" fill="#3d6b99" opacity="0.6" />
          <circle cx="235" cy="55" r="9" fill="#e8a838" />
          <rect x="290" y="45" width="85" height="85" rx="4" fill="#4a7fb5" opacity="0.5" />
          <rect x="295" y="50" width="75" height="38" rx="2" fill="#6ba3d6" opacity="0.4" />
          <circle cx="380" cy="100" r="12" fill="#43a047" opacity="0.4" />
          <circle cx="420" cy="70" r="8" fill="#c8e600" opacity="0.5" />
          <rect x="400" y="90" width="50" height="40" rx="3" fill="#3d6b99" opacity="0.4" />
          <circle cx="50" cy="130" r="4" fill="#c8e600" opacity="0.6" />
          <circle cx="170" cy="120" r="5" fill="#e8a838" opacity="0.5" />
          <circle cx="350" cy="130" r="4" fill="#43a047" opacity="0.5" />
        </svg>
      </div>

      <div className="create-notif-form">
        <input
          className="create-notif-input"
          type="text"
          placeholder={t('create_notif.title_placeholder')}
          value={title}
          onChange={e => setTitle(e.target.value)}
        />

        <label className="create-notif-label">{t('create_notif.broadcast_label')}</label>

        <textarea
          className="create-notif-textarea"
          placeholder={t('create_notif.message_placeholder')}
          value={message}
          onChange={e => setMessage(e.target.value)}
          rows={5}
        />

        <p className="create-notif-hint">{t('create_notif.hint')}</p>

        {error && <p className="form-error" style={{ color: '#c62828', marginBottom: 12 }}>{error}</p>}

        <button
          className="create-notif-submit"
          onClick={handleSubmit}
          disabled={!canSubmit || submitting}
        >
          {submitting ? t('create_notif.submitting') : t('create_notif.submit')}
        </button>
      </div>
    </div>
  )
}
