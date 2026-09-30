import { useState } from 'react'
import { Link } from 'react-router-dom'
import { createClient } from '@supabase/supabase-js'

const BLOCKED_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'hotmail.com',
  'hotmail.co.uk', 'outlook.com', 'live.com', 'live.co.uk', 'msn.com',
  'aol.com', 'icloud.com', 'me.com', 'mac.com', 'mail.com', 'protonmail.com',
  'proton.me', 'zoho.com', 'yandex.com', 'gmx.com', 'gmx.co.uk',
  'fastmail.com', 'tutanota.com', 'tuta.com', 'hey.com', 'pm.me',
  'inbox.com', 'rediffmail.com', 'qq.com', '163.com', 'web.de',
  'btinternet.com', 'sky.com', 'virginmedia.com', 'talktalk.net',
  'ntlworld.com', 'blueyonder.co.uk', 'rocketmail.com',
])

function isPersonalEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split('@')[1]
  return !domain || BLOCKED_EMAIL_DOMAINS.has(domain)
}

const anonClient = createClient(
  (import.meta.env.VITE_SUPABASE_URL || '').trim(),
  (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim(),
  { auth: { persistSession: false } }
)

export default function TrialSignup() {
  const [fullName, setFullName] = useState('')
  const [workEmail, setWorkEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [agreeTerms, setAgreeTerms] = useState(false)
  const [agreePrivacy, setAgreePrivacy] = useState(false)
  const [agreeCookies, setAgreeCookies] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const personalEmailBlocked = workEmail.includes('@') && isPersonalEmail(workEmail)
  const canSubmit = fullName.trim() && workEmail.trim() && !personalEmailBlocked && phone.trim() && password.length >= 8 && agreeTerms && agreePrivacy && agreeCookies && !loading

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    if (isPersonalEmail(workEmail)) {
      setError('Please use your work email address. Personal email addresses are not accepted.')
      return
    }
    setLoading(true)
    setError('')

    try {
      const { error: insertError } = await anonClient
        .from('trial_requests')
        .insert({
          full_name: fullName.trim(),
          work_email: workEmail.trim().toLowerCase(),
          phone: phone.trim(),
        })

      if (insertError) {
        if (insertError.message?.includes('trial_requests_email_unique')) {
          setError('This email address has already been submitted for a trial.')
        } else {
          setError(insertError.message || 'Failed to submit request.')
        }
        setLoading(false)
        return
      }

      setSubmitted(true)
    } catch {
      setError('Unable to submit your request. Please try again.')
    }
    setLoading(false)
  }

  if (submitted) {
    return (
      <div className="trial-page">
        <div className="trial-card">
          <div className="trial-success">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#4caf50" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
              <polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
            <h2>Trial Request Submitted</h2>
            <p>Thank you for your interest in InflowHR. Your trial request has been received and will be reviewed shortly.</p>
            <p>You will receive your login credentials once your trial account has been set up.</p>
            <Link to="/" className="trial-back-link">Back to Login</Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="trial-page">
      <div className="trial-card">
        <div className="trial-header">
          <img src="/inflowhr-logo-alt.svg" alt="InflowHR" className="trial-logo" />
          <h1>Try InflowHR Free</h1>
          <p>Experience the full HR platform with a 14-day trial. No credit card required.</p>
        </div>

        <form className="trial-form" onSubmit={handleSubmit}>
          <div className="trial-field">
            <label htmlFor="trial-name">Full Name</label>
            <input
              id="trial-name"
              type="text"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              placeholder="e.g. Jane Smith"
              required
            />
          </div>

          <div className="trial-field">
            <label htmlFor="trial-email">Work Email</label>
            <input
              id="trial-email"
              type="email"
              value={workEmail}
              onChange={e => setWorkEmail(e.target.value)}
              placeholder="e.g. jane@company.co.uk"
              required
            />
            {personalEmailBlocked && (
              <span className="trial-field-hint" style={{ color: '#e53935' }}>Please use your work email address. Personal email domains are not accepted.</span>
            )}
          </div>

          <div className="trial-field">
            <label htmlFor="trial-phone">Phone Number</label>
            <input
              id="trial-phone"
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="e.g. 07700 900000"
              required
            />
          </div>

          <div className="trial-field">
            <label htmlFor="trial-password">Password (min 8 characters)</label>
            <input
              id="trial-password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Choose a secure password"
              minLength={8}
              required
            />
            {password.length > 0 && password.length < 8 && (
              <span className="trial-field-hint">Password must be at least 8 characters</span>
            )}
          </div>

          <div className="trial-agreements">
            <label className="trial-checkbox">
              <input type="checkbox" checked={agreeTerms} onChange={e => setAgreeTerms(e.target.checked)} />
              <span>I agree to the <a href="/privacy" target="_blank" rel="noopener noreferrer">Terms of Use</a></span>
            </label>
            <label className="trial-checkbox">
              <input type="checkbox" checked={agreePrivacy} onChange={e => setAgreePrivacy(e.target.checked)} />
              <span>I agree to the <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a></span>
            </label>
            <label className="trial-checkbox">
              <input type="checkbox" checked={agreeCookies} onChange={e => setAgreeCookies(e.target.checked)} />
              <span>I agree to the <a href="/privacy" target="_blank" rel="noopener noreferrer">Cookie Policy</a></span>
            </label>
          </div>

          {error && <p className="trial-error">{error}</p>}

          <button type="submit" className="trial-submit-btn" disabled={!canSubmit}>
            {loading ? 'Submitting...' : 'Create Account'}
          </button>
        </form>

        <div className="trial-footer">
          <Link to="/" className="trial-back-link">Already have an account? Sign in</Link>
        </div>
      </div>
    </div>
  )
}
