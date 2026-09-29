import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { supabase } from '../lib/supabase'

interface SurveyQuestion {
  id: string
  text: string
  type: 'radio' | 'checkbox' | 'scale' | 'text' | 'dynamic_lines'
  options?: string[]
  min?: number
  max?: number
  labels?: string[]
  required: boolean
}

interface PendingSurvey {
  id: string
  deployment_id: string
  status: string
  completed_at: string | null
  deployment: {
    id: string
    ends_at: string
    survey: {
      id: string
      title: string
      description: string
      banner_colour: string
      banner_image_url: string | null
      questions: SurveyQuestion[]
    }
  }
}

export default function MySurveys() {
  const navigate = useNavigate()
  const { employeeId, companyUser, employeeEmail } = useAuth()
  const { showSuccess, showError } = useToast()

  const [surveys, setSurveys] = useState<PendingSurvey[]>([])
  const [loading, setLoading] = useState(true)
  const [activeSurvey, setActiveSurvey] = useState<PendingSurvey | null>(null)
  const [answers, setAnswers] = useState<Record<string, any>>({})
  const [dynamicLines, setDynamicLines] = useState<Record<string, string[]>>({})
  const [submitting, setSubmitting] = useState(false)
  const [tab, setTab] = useState<'outstanding' | 'completed'>('outstanding')

  const loadSurveys = useCallback(async () => {
    if (!employeeId || !companyUser?.company_id) return
    setLoading(true)
    const { data } = await supabase
      .from('survey_responses')
      .select('*, deployment:survey_deployments(id, ends_at, survey:company_surveys(id, title, description, banner_colour, banner_image_url, questions))')
      .eq('company_id', companyUser.company_id)
      .eq('employee_id', employeeId)
      .order('created_at', { ascending: false })
    setSurveys((data as PendingSurvey[]) || [])
    setLoading(false)
  }, [employeeId, companyUser?.company_id])

  useEffect(() => { loadSurveys() }, [loadSurveys])

  const outstanding = useMemo(() => surveys.filter(s => s.status === 'pending'), [surveys])
  const completed = useMemo(() => surveys.filter(s => s.status === 'completed'), [surveys])

  function openSurvey(survey: PendingSurvey) {
    setActiveSurvey(survey)
    setAnswers({})
    setDynamicLines({})
  }

  function setAnswer(questionId: string, value: any) {
    setAnswers(prev => ({ ...prev, [questionId]: value }))
  }

  function toggleCheckbox(questionId: string, option: string) {
    setAnswers(prev => {
      const current: string[] = prev[questionId] || []
      return { ...prev, [questionId]: current.includes(option) ? current.filter(o => o !== option) : [...current, option] }
    })
  }

  function addDynamicLine(questionId: string) {
    setDynamicLines(prev => ({
      ...prev,
      [questionId]: [...(prev[questionId] || ['']), ''],
    }))
  }

  function updateDynamicLine(questionId: string, idx: number, value: string) {
    setDynamicLines(prev => ({
      ...prev,
      [questionId]: (prev[questionId] || []).map((l, i) => i === idx ? value : l),
    }))
  }

  function removeDynamicLine(questionId: string, idx: number) {
    setDynamicLines(prev => ({
      ...prev,
      [questionId]: (prev[questionId] || []).filter((_, i) => i !== idx),
    }))
  }

  async function submitSurvey() {
    if (!activeSurvey) return
    const questions = activeSurvey.deployment.survey.questions
    const missing = questions.filter(q => {
      if (!q.required) return false
      const val = q.type === 'dynamic_lines' ? dynamicLines[q.id] : answers[q.id]
      if (val === undefined || val === null || val === '') return true
      if (Array.isArray(val) && val.length === 0) return true
      return false
    })
    if (missing.length > 0) {
      showError(`Please answer all required questions (${missing.length} remaining)`)
      return
    }

    setSubmitting(true)
    const answerArray = questions.map(q => ({
      questionId: q.id,
      value: q.type === 'dynamic_lines' ? (dynamicLines[q.id] || []).filter(l => l.trim()) : answers[q.id],
    }))

    const { error } = await supabase
      .from('survey_responses')
      .update({
        status: 'completed',
        answers: answerArray,
        completed_at: new Date().toISOString(),
      })
      .eq('id', activeSurvey.id)
      .eq('employee_id', employeeId)

    if (error) { showError('Failed to submit: ' + error.message); setSubmitting(false); return }

    await supabase.from('survey_deployments')
      .update({ total_responses: (surveys.filter(s => s.deployment_id === activeSurvey.deployment_id && s.status === 'completed').length) + 1 })
      .eq('id', activeSurvey.deployment_id)

    await supabase.from('workflow_tracker').insert({
      company_id: companyUser?.company_id,
      assigned_to: employeeEmail || '',
      record_type: 'Survey',
      action: 'Survey Completed',
      task_description: `You completed "${activeSurvey.deployment.survey.title}"`,
      status: 'Complete',
      approval_status: 'Completed',
    })

    showSuccess('Survey submitted — thank you for your feedback!')
    setActiveSurvey(null)
    setSubmitting(false)
    window.dispatchEvent(new Event('notifications-updated'))
    loadSurveys()
  }

  function formatDateUK(iso: string) {
    if (!iso) return ''
    return new Date(iso).toLocaleDateString('en-GB')
  }

  function daysRemaining(endDate: string) {
    const diff = Math.ceil((new Date(endDate).getTime() - Date.now()) / 86400000)
    return diff > 0 ? diff : 0
  }

  // ── Survey completion form ────────────────────────────────────────────────

  if (activeSurvey) {
    const survey = activeSurvey.deployment.survey
    return (
      <div className="feature-page my-surveys-page">
        <header className="feature-header">
          <button className="feature-back" onClick={() => setActiveSurvey(null)}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
          <h1 className="feature-title">Complete Survey</h1>
        </header>

        <div className="survey-completion-form">
          <div className="survey-completion-banner" style={{ background: survey.banner_colour }}>
            {survey.banner_image_url && <img src={survey.banner_image_url} alt="" className="survey-banner-img" />}
            <h2>{survey.title}</h2>
            <p>{survey.description}</p>
            <span className="survey-completion-deadline">Due by {formatDateUK(activeSurvey.deployment.ends_at)}</span>
          </div>

          <div className="survey-questions">
            {survey.questions.map((q, idx) => (
              <div key={q.id} className="survey-fill-question">
                <div className="survey-fill-q-header">
                  <span className="survey-fill-q-num">Q{idx + 1}</span>
                  <span className="survey-fill-q-text">{q.text}</span>
                  {q.required && <span className="survey-fill-required">*</span>}
                </div>

                {q.type === 'radio' && (
                  <div className="survey-fill-options">
                    {(q.options || []).map(opt => (
                      <label key={opt} className={`survey-fill-radio ${answers[q.id] === opt ? 'selected' : ''}`}>
                        <input type="radio" name={q.id} checked={answers[q.id] === opt} onChange={() => setAnswer(q.id, opt)} />
                        <span className="survey-fill-radio-dot" />
                        {opt}
                      </label>
                    ))}
                  </div>
                )}

                {q.type === 'checkbox' && (
                  <div className="survey-fill-options">
                    {(q.options || []).map(opt => (
                      <label key={opt} className={`survey-fill-check ${(answers[q.id] || []).includes(opt) ? 'selected' : ''}`}>
                        <input type="checkbox" checked={(answers[q.id] || []).includes(opt)} onChange={() => toggleCheckbox(q.id, opt)} />
                        <span className="survey-fill-check-box" />
                        {opt}
                      </label>
                    ))}
                  </div>
                )}

                {q.type === 'scale' && (
                  <div className="survey-fill-scale">
                    {q.labels && <span className="survey-scale-label-left">{q.labels[0]}</span>}
                    <div className="survey-scale-dots">
                      {Array.from({ length: (q.max || 10) - (q.min || 1) + 1 }, (_, i) => (q.min || 1) + i).map(val => (
                        <button
                          key={val}
                          className={`survey-scale-dot ${answers[q.id] === val ? 'active' : ''}`}
                          onClick={() => setAnswer(q.id, val)}
                        >
                          {val}
                        </button>
                      ))}
                    </div>
                    {q.labels && <span className="survey-scale-label-right">{q.labels[1]}</span>}
                  </div>
                )}

                {q.type === 'text' && (
                  <textarea
                    className="survey-fill-text"
                    value={answers[q.id] || ''}
                    onChange={e => setAnswer(q.id, e.target.value)}
                    placeholder="Type your answer here..."
                    rows={3}
                  />
                )}

                {q.type === 'dynamic_lines' && (
                  <div className="survey-fill-dynamic">
                    {(dynamicLines[q.id] || ['']).map((line, li) => (
                      <div key={li} className="survey-dynamic-row">
                        <input value={line} onChange={e => updateDynamicLine(q.id, li, e.target.value)} placeholder={`Line ${li + 1}`} />
                        {(dynamicLines[q.id] || []).length > 1 && (
                          <button className="survey-dynamic-remove" onClick={() => removeDynamicLine(q.id, li)}>×</button>
                        )}
                      </div>
                    ))}
                    <button className="survey-dynamic-add" onClick={() => addDynamicLine(q.id)}>+ Add another line</button>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="survey-completion-actions">
            <button className="survey-back-btn" onClick={() => setActiveSurvey(null)}>Back to Surveys</button>
            <button className="survey-submit-btn" onClick={submitSurvey} disabled={submitting}>
              {submitting ? 'Submitting...' : 'Submit Survey'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Survey list ───────────────────────────────────────────────────────────

  return (
    <div className="feature-page my-surveys-page">
      <header className="feature-header my-surveys-header">
        <button className="feature-back" onClick={() => navigate('/')}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <div className="feature-header-center">
          <h1 className="feature-title">My Surveys</h1>
          <p className="feature-subtitle">Complete surveys assigned to you by your organisation</p>
        </div>
        <button className="feature-refresh" onClick={loadSurveys}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 4v6h-6M1 20v-6h6"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
        </button>
      </header>

      <div className="my-surveys-summary">
        <div className="my-surveys-stat">
          <span className="my-surveys-stat-num">{outstanding.length}</span>
          <span className="my-surveys-stat-label">Outstanding</span>
        </div>
        <div className="my-surveys-stat">
          <span className="my-surveys-stat-num">{completed.length}</span>
          <span className="my-surveys-stat-label">Completed</span>
        </div>
      </div>

      <div className="survey-tabs" style={{ marginTop: 0 }}>
        <button className={`survey-tab ${tab === 'outstanding' ? 'active' : ''}`} onClick={() => setTab('outstanding')}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          Outstanding {outstanding.length > 0 && <span className="survey-tab-badge">{outstanding.length}</span>}
        </button>
        <button className={`survey-tab ${tab === 'completed' ? 'active' : ''}`} onClick={() => setTab('completed')}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          Completed
        </button>
      </div>

      {loading && <p style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)' }}>Loading surveys...</p>}

      {tab === 'outstanding' && !loading && (
        <div className="survey-card-grid">
          {outstanding.length === 0 ? (
            <div className="survey-empty-state">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              <h3>All caught up!</h3>
              <p>No outstanding surveys. We'll notify you when a new one is assigned.</p>
            </div>
          ) : outstanding.map(s => (
            <div key={s.id} className="survey-employee-card">
              <div className="survey-card-accent" style={{ background: s.deployment.survey.banner_colour }} />
              <div className="survey-card-body">
                <div className="survey-card-top">
                  <div className="survey-card-icon" style={{ background: `${s.deployment.survey.banner_colour}18`, color: s.deployment.survey.banner_colour }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                  </div>
                  <span className="survey-card-days" style={{ color: daysRemaining(s.deployment.ends_at) <= 3 ? '#ef4444' : '#f59e0b' }}>
                    {daysRemaining(s.deployment.ends_at)} days left
                  </span>
                </div>
                <h4>{s.deployment.survey.title}</h4>
                <p>{s.deployment.survey.description}</p>
                <div className="survey-card-footer">
                  <span className="survey-card-qs">{s.deployment.survey.questions.length} questions</span>
                  <button className="survey-start-btn" onClick={() => openSurvey(s)}>
                    Start Survey
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'completed' && !loading && (
        <div className="survey-card-grid">
          {completed.length === 0 ? (
            <div className="survey-empty-state">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              <h3>No completed surveys yet</h3>
              <p>Surveys you complete will appear here for your records.</p>
            </div>
          ) : completed.map(s => (
            <div key={s.id} className="survey-employee-card survey-card-completed">
              <div className="survey-card-accent" style={{ background: s.deployment.survey.banner_colour }} />
              <div className="survey-card-body">
                <div className="survey-card-top">
                  <div className="survey-card-icon" style={{ background: '#dcfce7', color: '#16a34a' }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                  </div>
                  <span className="survey-card-completed-badge">Completed</span>
                </div>
                <h4>{s.deployment.survey.title}</h4>
                <p className="survey-card-completed-date">Submitted {formatDateUK(s.completed_at || '')}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
