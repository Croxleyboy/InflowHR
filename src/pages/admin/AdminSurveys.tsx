import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { useAuth } from '../../context/AuthContext'
import { useFeatures } from '../../context/FeatureContext'
import { useToast } from '../../context/ToastContext'
import { supabase } from '../../lib/supabase'

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

interface SurveyTemplate {
  id: string
  title: string
  description: string
  category: string
  icon: string
  banner_colour: string
  questions: SurveyQuestion[]
}

interface CompanySurvey {
  id: string
  company_id: string
  template_id: string | null
  title: string
  description: string
  banner_image_url: string | null
  banner_colour: string
  questions: SurveyQuestion[]
  delivery_channels: string[]
  is_custom: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

interface Deployment {
  id: string
  company_id: string
  survey_id: string
  status: string
  starts_at: string
  ends_at: string
  target_type: string
  target_values: string[]
  total_recipients: number
  total_responses: number
  created_by: string | null
  created_at: string
  survey?: CompanySurvey
}

interface SurveyResponse {
  id: string
  deployment_id: string
  employee_id: string
  status: string
  answers: any[]
  completed_at: string | null
  employee?: { first_name: string; last_name: string; department: string | null }
}

const TEMPLATE_CATEGORIES = [
  { key: 'all', label: 'All Templates' },
  { key: 'onboarding', label: 'Onboarding' },
  { key: 'exit', label: 'Exit & Loyalty' },
  { key: 'performance', label: 'Performance' },
  { key: 'feedback', label: 'Feedback' },
  { key: 'engagement', label: 'Engagement' },
  { key: 'wellbeing', label: 'Wellbeing' },
  { key: 'culture', label: 'DEI & Culture' },
  { key: 'operations', label: 'Operations' },
]

const QUESTION_TYPES = [
  { value: 'radio', label: 'Single Choice', icon: '○' },
  { value: 'checkbox', label: 'Multiple Choice', icon: '☑' },
  { value: 'scale', label: 'Rating Scale', icon: '★' },
  { value: 'text', label: 'Free Text', icon: '✎' },
  { value: 'dynamic_lines', label: 'Dynamic Lines', icon: '≡' },
]

const TARGET_TAGS = ['new_starter', 'leaver', 'probation', 'returning', 'promoted', 'contractor']

const CATEGORY_ICONS: Record<string, string> = {
  engagement: '💬',
  onboarding: '🚀',
  exit: '🚪',
  performance: '📈',
  feedback: '📋',
  wellbeing: '🧘',
  culture: '🌍',
  operations: '⚙️',
}

export default function AdminSurveys() {
  const { selectedCompanyId } = useAdminCompany()
  const { employeeName, employeeEmail } = useAuth()
  const { features } = useFeatures()
  const { showSuccess, showError } = useToast()

  const [tab, setTab] = useState<'templates' | 'surveys' | 'active' | 'analytics' | 'builder'>('templates')

  // Templates state
  const [templates, setTemplates] = useState<SurveyTemplate[]>([])
  const [templateFilter, setTemplateFilter] = useState('all')

  // Company surveys state
  const [companySurveys, setCompanySurveys] = useState<CompanySurvey[]>([])
  const [editingSurvey, setEditingSurvey] = useState<CompanySurvey | null>(null)

  // Deployments state
  const [deployments, setDeployments] = useState<Deployment[]>([])
  const [deployModal, setDeployModal] = useState<CompanySurvey | null>(null)
  const [deployEndDate, setDeployEndDate] = useState('')
  const [deployTargetType, setDeployTargetType] = useState('all')
  const [deployTargetValues, setDeployTargetValues] = useState<string[]>([])
  const [departments, setDepartments] = useState<string[]>([])

  // Analytics state
  const [analyticsDeployment, setAnalyticsDeployment] = useState<string>('')
  const [responses, setResponses] = useState<SurveyResponse[]>([])

  // Builder state
  const [builderTitle, setBuilderTitle] = useState('')
  const [builderDesc, setBuilderDesc] = useState('')
  const [builderColour, setBuilderColour] = useState('#4F46E5')
  const [builderQuestions, setBuilderQuestions] = useState<SurveyQuestion[]>([])
  const [builderChannels, setBuilderChannels] = useState<string[]>(['pc', 'mobile'])
  const [builderBannerUrl, setBuilderBannerUrl] = useState('')

  const loadTemplates = useCallback(async () => {
    const { data } = await supabase.from('survey_templates').select('*').order('category')
    setTemplates((data as SurveyTemplate[]) || [])
  }, [])

  const loadCompanySurveys = useCallback(async () => {
    if (!selectedCompanyId) return
    const { data } = await supabase.from('company_surveys').select('*').eq('company_id', selectedCompanyId).order('created_at', { ascending: false })
    setCompanySurveys((data as CompanySurvey[]) || [])
  }, [selectedCompanyId])

  const loadDeployments = useCallback(async () => {
    if (!selectedCompanyId) return
    const { data } = await supabase
      .from('survey_deployments')
      .select('*, survey:company_surveys(*)')
      .eq('company_id', selectedCompanyId)
      .order('created_at', { ascending: false })
    setDeployments((data as Deployment[]) || [])
  }, [selectedCompanyId])

  const loadDepartments = useCallback(async () => {
    if (!selectedCompanyId) return
    const { data } = await supabase.from('employees').select('department').eq('company_id', selectedCompanyId)
    const depts = [...new Set((data || []).map(e => e.department).filter(Boolean))] as string[]
    setDepartments(depts.sort())
  }, [selectedCompanyId])

  useEffect(() => {
    loadTemplates()
  }, [loadTemplates])

  useEffect(() => {
    if (selectedCompanyId) {
      loadCompanySurveys()
      loadDeployments()
      loadDepartments()
    }
  }, [selectedCompanyId, loadCompanySurveys, loadDeployments, loadDepartments])

  const activeDeployments = useMemo(() => deployments.filter(d => d.status === 'active'), [deployments])
  const completedDeployments = useMemo(() => deployments.filter(d => d.status !== 'active'), [deployments])

  const filteredTemplates = useMemo(() => {
    if (templateFilter === 'all') return templates
    return templates.filter(t => t.category === templateFilter)
  }, [templates, templateFilter])

  // ── Template actions ──────────────────────────────────────────────────────

  async function copyTemplateToCompany(template: SurveyTemplate) {
    if (!selectedCompanyId) return
    const { error } = await supabase.from('company_surveys').insert({
      company_id: selectedCompanyId,
      template_id: template.id,
      title: template.title,
      description: template.description,
      banner_colour: template.banner_colour,
      questions: template.questions,
      delivery_channels: ['pc', 'mobile'],
      is_custom: false,
      created_by: employeeName || employeeEmail,
    })
    if (error) { showError('Failed to add survey: ' + error.message); return }
    showSuccess(`"${template.title}" added to your surveys`)
    loadCompanySurveys()
    setTab('surveys')
  }

  // ── Survey CRUD ───────────────────────────────────────────────────────────

  async function saveSurveyEdit() {
    if (!editingSurvey) return
    const { error } = await supabase.from('company_surveys').update({
      title: editingSurvey.title,
      description: editingSurvey.description,
      banner_colour: editingSurvey.banner_colour,
      questions: editingSurvey.questions,
      delivery_channels: editingSurvey.delivery_channels,
      updated_at: new Date().toISOString(),
    }).eq('id', editingSurvey.id).eq('company_id', selectedCompanyId)
    if (error) { showError('Save failed: ' + error.message); return }
    showSuccess('Survey updated')
    setEditingSurvey(null)
    loadCompanySurveys()
  }

  async function deleteSurvey(id: string) {
    if (!confirm('Delete this survey? This cannot be undone.')) return
    await supabase.from('company_surveys').delete().eq('id', id).eq('company_id', selectedCompanyId)
    showSuccess('Survey deleted')
    loadCompanySurveys()
  }

  // ── Deploy ────────────────────────────────────────────────────────────────

  async function deploySurvey() {
    if (!deployModal || !selectedCompanyId || !deployEndDate) return
    if (activeDeployments.length >= 3) {
      showError('Maximum 3 surveys can be running at the same time. Complete or cancel an active survey first.')
      return
    }
    const { error } = await supabase.from('survey_deployments').insert({
      company_id: selectedCompanyId,
      survey_id: deployModal.id,
      starts_at: new Date().toISOString(),
      ends_at: new Date(deployEndDate + 'T23:59:59').toISOString(),
      target_type: deployTargetType,
      target_values: deployTargetValues,
      created_by: employeeName || employeeEmail,
    })
    if (error) { showError('Deploy failed: ' + error.message); return }
    showSuccess(`"${deployModal.title}" is now live`)
    setDeployModal(null)
    setDeployEndDate('')
    setDeployTargetType('all')
    setDeployTargetValues([])
    loadDeployments()
    setTab('active')
  }

  async function cancelDeployment(id: string) {
    if (!confirm('Cancel this survey deployment? Responses already collected will be kept.')) return
    await supabase.from('survey_deployments').update({ status: 'cancelled' }).eq('id', id).eq('company_id', selectedCompanyId)
    showSuccess('Deployment cancelled')
    loadDeployments()
  }

  async function completeDeployment(id: string) {
    await supabase.from('survey_deployments').update({ status: 'completed' }).eq('id', id).eq('company_id', selectedCompanyId)
    showSuccess('Deployment marked as completed')
    loadDeployments()
  }

  // ── Analytics ─────────────────────────────────────────────────────────────

  async function loadResponses(deploymentId: string) {
    setAnalyticsDeployment(deploymentId)
    const { data } = await supabase
      .from('survey_responses')
      .select('*, employee:employees(first_name, last_name, department)')
      .eq('deployment_id', deploymentId)
      .eq('company_id', selectedCompanyId)
      .order('completed_at', { ascending: false })
    setResponses((data as SurveyResponse[]) || [])
  }

  const analyticsData = useMemo(() => {
    const dep = deployments.find(d => d.id === analyticsDeployment)
    if (!dep || !dep.survey) return null
    const survey = dep.survey
    const completed = responses.filter(r => r.status === 'completed')
    const questionStats = survey.questions.map((q: SurveyQuestion) => {
      const answers = completed.map(r => {
        const a = (r.answers as any[]).find((ans: any) => ans.questionId === q.id)
        return a?.value
      }).filter(Boolean)

      if (q.type === 'radio') {
        const counts: Record<string, number> = {}
        ;(q.options || []).forEach(opt => { counts[opt] = 0 })
        answers.forEach(v => { if (counts[v] !== undefined) counts[v]++ })
        return { question: q, type: 'bar', data: counts, total: answers.length }
      }
      if (q.type === 'scale') {
        const nums = answers.map(Number).filter(n => !isNaN(n))
        const avg = nums.length ? (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1) : '0'
        const dist: Record<number, number> = {}
        for (let i = (q.min || 1); i <= (q.max || 10); i++) dist[i] = 0
        nums.forEach(n => { if (dist[n] !== undefined) dist[n]++ })
        return { question: q, type: 'scale', avg, distribution: dist, total: nums.length }
      }
      if (q.type === 'checkbox') {
        const counts: Record<string, number> = {}
        ;(q.options || []).forEach(opt => { counts[opt] = 0 })
        answers.forEach((v: string[]) => { if (Array.isArray(v)) v.forEach(item => { if (counts[item] !== undefined) counts[item]++ }) })
        return { question: q, type: 'multi_bar', data: counts, total: completed.length }
      }
      if (q.type === 'text' || q.type === 'dynamic_lines') {
        return { question: q, type: 'text', responses: answers, total: answers.length }
      }
      return { question: q, type: 'unknown', total: 0 }
    })
    return { deployment: dep, survey, completed: completed.length, pending: responses.length - completed.length, questionStats }
  }, [analyticsDeployment, deployments, responses])

  // ── Builder ───────────────────────────────────────────────────────────────

  async function saveCustomSurvey() {
    if (!selectedCompanyId) return
    if (!builderTitle.trim()) { showError('Survey title is required'); return }
    if (builderQuestions.length === 0) { showError('Add at least one question'); return }
    const invalid = builderQuestions.find(q => !q.text.trim())
    if (invalid) { showError('All questions must have text'); return }

    const { error } = await supabase.from('company_surveys').insert({
      company_id: selectedCompanyId,
      title: builderTitle.trim(),
      description: builderDesc.trim(),
      banner_colour: builderColour,
      banner_image_url: builderBannerUrl || null,
      questions: builderQuestions,
      delivery_channels: builderChannels,
      is_custom: true,
      created_by: employeeName || employeeEmail,
    })
    if (error) { showError('Failed to create survey: ' + error.message); return }
    showSuccess('Custom survey created')
    setBuilderTitle('')
    setBuilderDesc('')
    setBuilderColour('#4F46E5')
    setBuilderQuestions([])
    setBuilderChannels(['pc', 'mobile'])
    setBuilderBannerUrl('')
    loadCompanySurveys()
    setTab('surveys')
  }

  // ── Render helpers ────────────────────────────────────────────────────────

  function renderBarChart(data: Record<string, number>, total: number) {
    const maxVal = Math.max(...Object.values(data), 1)
    return (
      <div className="survey-bar-chart">
        {Object.entries(data).map(([label, count]) => (
          <div key={label} className="survey-bar-row">
            <span className="survey-bar-label">{label}</span>
            <div className="survey-bar-track">
              <div className="survey-bar-fill" style={{ width: `${(count / maxVal) * 100}%` }} />
            </div>
            <span className="survey-bar-count">{count} ({total ? Math.round((count / total) * 100) : 0}%)</span>
          </div>
        ))}
      </div>
    )
  }

  function renderScaleChart(avg: string, distribution: Record<number, number>, total: number, q: SurveyQuestion) {
    const maxVal = Math.max(...Object.values(distribution), 1)
    return (
      <div className="survey-scale-chart">
        <div className="survey-scale-avg">
          <span className="survey-scale-avg-num">{avg}</span>
          <span className="survey-scale-avg-label">average from {total} responses</span>
        </div>
        <div className="survey-scale-bars">
          {Object.entries(distribution).map(([val, count]) => (
            <div key={val} className="survey-scale-bar-col">
              <div className="survey-scale-bar-fill" style={{ height: `${(count / maxVal) * 100}%` }} />
              <span>{val}</span>
            </div>
          ))}
        </div>
        {q.labels && <div className="survey-scale-labels"><span>{q.labels[0]}</span><span>{q.labels[1]}</span></div>}
      </div>
    )
  }

  function formatDateUK(iso: string) {
    if (!iso) return ''
    const d = new Date(iso)
    return d.toLocaleDateString('en-GB')
  }

  function daysRemaining(endDate: string) {
    const diff = Math.ceil((new Date(endDate).getTime() - Date.now()) / 86400000)
    return diff > 0 ? diff : 0
  }

  // ── Question editor (shared by edit modal and builder) ────────────────────

  function renderQuestionEditor(questions: SurveyQuestion[], setQuestions: (q: SurveyQuestion[]) => void, maxQuestions = 20) {
    return (
      <div className="survey-question-list">
        {questions.map((q, idx) => (
          <div key={q.id} className="survey-question-card">
            <div className="survey-question-header">
              <span className="survey-question-num">Q{idx + 1}</span>
              <input
                className="survey-question-input"
                value={q.text}
                onChange={e => {
                  const arr = [...questions]
                  arr[idx] = { ...arr[idx], text: e.target.value }
                  setQuestions(arr)
                }}
                placeholder="Enter your question..."
              />
              <div className="survey-question-actions">
                <button className="survey-q-btn" onClick={() => { const arr = [...questions]; const ni = idx - 1; if (ni >= 0) { [arr[idx], arr[ni]] = [arr[ni], arr[idx]]; setQuestions(arr) } }} disabled={idx === 0} title="Move up">↑</button>
                <button className="survey-q-btn" onClick={() => { const arr = [...questions]; const ni = idx + 1; if (ni < arr.length) { [arr[idx], arr[ni]] = [arr[ni], arr[idx]]; setQuestions(arr) } }} disabled={idx === questions.length - 1} title="Move down">↓</button>
                <button className="survey-q-btn survey-q-btn-delete" onClick={() => setQuestions(questions.filter((_, i) => i !== idx))} title="Remove">×</button>
              </div>
            </div>
            <div className="survey-question-config">
              <select value={q.type} onChange={e => {
                const type = e.target.value as SurveyQuestion['type']
                const update: Partial<SurveyQuestion> = { type }
                if (type === 'scale') { update.min = 1; update.max = 10; update.labels = ['Low', 'High']; delete (update as any).options }
                else if (type === 'text' || type === 'dynamic_lines') { delete (update as any).options }
                else { update.options = update.options || q.options || ['Option 1', 'Option 2'] }
                const arr = [...questions]; arr[idx] = { ...arr[idx], ...update }; setQuestions(arr)
              }}>
                {QUESTION_TYPES.map(qt => <option key={qt.value} value={qt.value}>{qt.icon} {qt.label}</option>)}
              </select>
              <label className="survey-required-toggle">
                <input type="checkbox" checked={q.required} onChange={e => { const arr = [...questions]; arr[idx] = { ...arr[idx], required: e.target.checked }; setQuestions(arr) }} />
                Required
              </label>
            </div>
            {(q.type === 'radio' || q.type === 'checkbox') && q.options && (
              <div className="survey-options-editor">
                {q.options.map((opt, oi) => (
                  <div key={oi} className="survey-option-row">
                    <span className="survey-option-icon">{q.type === 'radio' ? '○' : '☐'}</span>
                    <input
                      value={opt}
                      onChange={e => {
                        const opts = [...(q.options || [])]
                        opts[oi] = e.target.value
                        const arr = [...questions]; arr[idx] = { ...arr[idx], options: opts }; setQuestions(arr)
                      }}
                    />
                    <button className="survey-q-btn survey-q-btn-delete" onClick={() => {
                      const opts = (q.options || []).filter((_, i) => i !== oi)
                      const arr = [...questions]; arr[idx] = { ...arr[idx], options: opts }; setQuestions(arr)
                    }}>×</button>
                  </div>
                ))}
                <button className="survey-add-option-btn" onClick={() => {
                  const opts = [...(q.options || []), `Option ${(q.options?.length || 0) + 1}`]
                  const arr = [...questions]; arr[idx] = { ...arr[idx], options: opts }; setQuestions(arr)
                }}>+ Add option</button>
              </div>
            )}
            {q.type === 'scale' && (
              <div className="survey-scale-config">
                <label>Min: <input type="number" value={q.min || 1} onChange={e => { const arr = [...questions]; arr[idx] = { ...arr[idx], min: Number(e.target.value) }; setQuestions(arr) }} style={{ width: 60 }} /></label>
                <label>Max: <input type="number" value={q.max || 10} onChange={e => { const arr = [...questions]; arr[idx] = { ...arr[idx], max: Number(e.target.value) }; setQuestions(arr) }} style={{ width: 60 }} /></label>
                <label>Low label: <input value={q.labels?.[0] || ''} onChange={e => { const arr = [...questions]; arr[idx] = { ...arr[idx], labels: [e.target.value, q.labels?.[1] || 'High'] }; setQuestions(arr) }} /></label>
                <label>High label: <input value={q.labels?.[1] || ''} onChange={e => { const arr = [...questions]; arr[idx] = { ...arr[idx], labels: [q.labels?.[0] || 'Low', e.target.value] }; setQuestions(arr) }} /></label>
              </div>
            )}
            {q.type === 'dynamic_lines' && (
              <div className="survey-dynamic-hint">Respondents can add multiple text lines as answers.</div>
            )}
          </div>
        ))}
        {questions.length < maxQuestions && (
          <button className="survey-add-question-btn" onClick={() => {
            setQuestions([...questions, { id: `q${Date.now()}`, text: '', type: 'radio', options: ['Option 1', 'Option 2'], required: true }])
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add Question ({questions.length}/20)
          </button>
        )}
      </div>
    )
  }

  // ── Main render ───────────────────────────────────────────────────────────

  return (
    <div className="admin-surveys-page">
      <div className="survey-hero">
        <div className="survey-hero-text">
          <h2>Surveys & Feedback</h2>
          <p>Create, deploy and analyse employee surveys across your organisation.</p>
        </div>
        <div className="survey-hero-stats">
          <div className="survey-hero-stat">
            <span className="survey-hero-stat-num">{templates.length}</span>
            <span className="survey-hero-stat-label">Templates</span>
          </div>
          <div className="survey-hero-stat">
            <span className="survey-hero-stat-num">{companySurveys.length}</span>
            <span className="survey-hero-stat-label">My Surveys</span>
          </div>
          <div className="survey-hero-stat">
            <span className="survey-hero-stat-num">{activeDeployments.length}<span className="survey-hero-stat-max">/3</span></span>
            <span className="survey-hero-stat-label">Active</span>
          </div>
        </div>
      </div>

      <div className="survey-tabs">
        {(['templates', 'surveys', 'active', 'analytics', 'builder'] as const).map(t => (
          <button key={t} className={`survey-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t === 'templates' && (
              <><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg> Templates</>
            )}
            {t === 'surveys' && (
              <><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg> My Surveys</>
            )}
            {t === 'active' && (
              <><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg> Active {activeDeployments.length > 0 && <span className="survey-tab-badge">{activeDeployments.length}</span>}</>
            )}
            {t === 'analytics' && (
              <><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg> Analytics</>
            )}
            {t === 'builder' && (
              <><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Create New</>
            )}
          </button>
        ))}
      </div>

      {/* ── Templates Tab ──────────────────────────────────────────────────── */}
      {tab === 'templates' && (
        <div className="survey-templates-tab">
          <div className="survey-section-header">
            <div>
              <h3>Survey Catalogue</h3>
              <p>Browse {templates.length} ready-made UK HR survey templates. Add to your library to customise and deploy.</p>
            </div>
          </div>
          <div className="survey-category-filters">
            {TEMPLATE_CATEGORIES.map(c => (
              <button key={c.key} className={`survey-cat-btn ${templateFilter === c.key ? 'active' : ''}`} onClick={() => setTemplateFilter(c.key)}>
                {c.key !== 'all' && <span className="survey-cat-icon">{CATEGORY_ICONS[c.key]}</span>} {c.label}
              </button>
            ))}
          </div>
          <div className="survey-template-grid">
            {filteredTemplates.map(tmpl => (
              <div key={tmpl.id} className="survey-template-card">
                <div className="survey-template-accent" style={{ background: tmpl.banner_colour }} />
                <div className="survey-template-content">
                  <div className="survey-template-top">
                    <div className="survey-template-icon" style={{ background: `${tmpl.banner_colour}18` }}><span style={{ fontSize: '1.1rem' }}>{CATEGORY_ICONS[tmpl.category] || '📋'}</span></div>
                    <span className="survey-template-category">{tmpl.category}</span>
                  </div>
                  <h4>{tmpl.title}</h4>
                  <p>{tmpl.description}</p>
                  <div className="survey-template-footer">
                    <span className="survey-template-qs">{tmpl.questions.length} questions</span>
                    <button className="survey-use-btn" onClick={() => copyTemplateToCompany(tmpl)}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                      Add
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── My Surveys Tab ─────────────────────────────────────────────────── */}
      {tab === 'surveys' && (
        <div className="survey-my-tab">
          <p className="survey-tab-desc">Your company's survey library. Edit, preview, or deploy surveys from here.</p>
          {companySurveys.length === 0 ? (
            <div className="survey-empty">
              <p>No surveys yet. Browse the <button className="survey-link-btn" onClick={() => setTab('templates')}>Templates</button> catalogue or <button className="survey-link-btn" onClick={() => setTab('builder')}>create your own</button>.</p>
            </div>
          ) : (
            <div className="survey-list">
              {companySurveys.map(s => (
                <div key={s.id} className="survey-list-card">
                  <div className="survey-list-colour" style={{ background: s.banner_colour }} />
                  <div className="survey-list-body">
                    <h4>{s.title}</h4>
                    <p>{s.description}</p>
                    <div className="survey-list-meta">
                      <span>{s.questions.length} questions</span>
                      <span>{s.is_custom ? 'Custom' : 'From template'}</span>
                      <span>Channels: {s.delivery_channels.join(', ')}</span>
                    </div>
                  </div>
                  <div className="survey-list-actions">
                    <button className="survey-action-btn survey-action-edit" onClick={() => setEditingSurvey({ ...s })}>Edit</button>
                    <button className="survey-action-btn survey-action-deploy" onClick={() => { setDeployModal(s); setDeployEndDate('') }} disabled={activeDeployments.length >= 3}>Deploy</button>
                    <button className="survey-action-btn survey-action-delete" onClick={() => deleteSurvey(s.id)}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Active Tab ─────────────────────────────────────────────────────── */}
      {tab === 'active' && (
        <div className="survey-active-tab">
          <p className="survey-tab-desc">Currently running surveys. Maximum 3 can be active at once.</p>
          <div className="survey-active-slots">
            {[0, 1, 2].map(i => {
              const dep = activeDeployments[i]
              if (!dep) return (
                <div key={i} className="survey-slot survey-slot-empty">
                  <div className="survey-slot-num">Slot {i + 1}</div>
                  <p>Available</p>
                </div>
              )
              const progress = dep.total_recipients > 0 ? Math.round((dep.total_responses / dep.total_recipients) * 100) : 0
              const days = daysRemaining(dep.ends_at)
              return (
                <div key={i} className="survey-slot survey-slot-active" style={{ borderTop: `4px solid ${dep.survey?.banner_colour || '#4F46E5'}` }}>
                  <div className="survey-slot-num">Slot {i + 1}</div>
                  <h4>{dep.survey?.title || 'Survey'}</h4>
                  <div className="survey-progress-bar">
                    <div className="survey-progress-fill" style={{ width: `${progress}%` }} />
                  </div>
                  <div className="survey-slot-stats">
                    <span>{dep.total_responses}/{dep.total_recipients} responses ({progress}%)</span>
                    <span>{days} days remaining</span>
                  </div>
                  <div className="survey-slot-info">
                    <span>Target: {dep.target_type === 'all' ? 'All employees' : `${dep.target_type}: ${dep.target_values.join(', ')}`}</span>
                    <span>Ends: {formatDateUK(dep.ends_at)}</span>
                  </div>
                  <div className="survey-slot-actions">
                    <button className="survey-action-btn" onClick={() => { loadResponses(dep.id); setTab('analytics') }}>View Results</button>
                    <button className="survey-action-btn survey-action-complete" onClick={() => completeDeployment(dep.id)}>Complete</button>
                    <button className="survey-action-btn survey-action-delete" onClick={() => cancelDeployment(dep.id)}>Cancel</button>
                  </div>
                </div>
              )
            })}
          </div>

          {completedDeployments.length > 0 && (
            <>
              <h3 style={{ marginTop: 24 }}>Past Deployments</h3>
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Survey</th>
                    <th>Status</th>
                    <th>Target</th>
                    <th>Responses</th>
                    <th>Period</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {completedDeployments.map(dep => (
                    <tr key={dep.id}>
                      <td>{dep.survey?.title || '—'}</td>
                      <td><span className={`survey-status-badge ${dep.status}`}>{dep.status}</span></td>
                      <td>{dep.target_type === 'all' ? 'All' : `${dep.target_type}: ${dep.target_values.join(', ')}`}</td>
                      <td>{dep.total_responses}/{dep.total_recipients}</td>
                      <td>{formatDateUK(dep.starts_at)} – {formatDateUK(dep.ends_at)}</td>
                      <td><button className="survey-action-btn" onClick={() => { loadResponses(dep.id); setTab('analytics') }}>Analytics</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      {/* ── Analytics Tab ──────────────────────────────────────────────────── */}
      {tab === 'analytics' && (
        <div className="survey-analytics-tab">
          <div className="survey-analytics-selector">
            <label>Select deployment:</label>
            <select value={analyticsDeployment} onChange={e => loadResponses(e.target.value)}>
              <option value="">— Choose a survey deployment —</option>
              {deployments.map(d => (
                <option key={d.id} value={d.id}>{d.survey?.title || 'Survey'} ({formatDateUK(d.starts_at)} – {formatDateUK(d.ends_at)})</option>
              ))}
            </select>
          </div>

          {analyticsData && (
            <div className="survey-analytics-content">
              <div className="survey-analytics-summary">
                <div className="survey-stat-card">
                  <div className="survey-stat-num">{analyticsData.completed}</div>
                  <div className="survey-stat-label">Completed</div>
                </div>
                <div className="survey-stat-card">
                  <div className="survey-stat-num">{analyticsData.pending}</div>
                  <div className="survey-stat-label">Pending</div>
                </div>
                <div className="survey-stat-card">
                  <div className="survey-stat-num">{analyticsData.completed + analyticsData.pending > 0 ? Math.round((analyticsData.completed / (analyticsData.completed + analyticsData.pending)) * 100) : 0}%</div>
                  <div className="survey-stat-label">Response Rate</div>
                </div>
              </div>

              <div className="survey-question-results">
                {analyticsData.questionStats.map((qs: any, idx: number) => (
                  <div key={idx} className="survey-result-card">
                    <h4>Q{idx + 1}: {qs.question.text}</h4>
                    <span className="survey-result-count">{qs.total} responses</span>
                    {qs.type === 'bar' && renderBarChart(qs.data, qs.total)}
                    {qs.type === 'multi_bar' && renderBarChart(qs.data, qs.total)}
                    {qs.type === 'scale' && renderScaleChart(qs.avg, qs.distribution, qs.total, qs.question)}
                    {qs.type === 'text' && (
                      <div className="survey-text-responses">
                        {qs.responses.length === 0 ? <p className="survey-no-data">No text responses yet</p> : qs.responses.map((r: string, i: number) => (
                          <div key={i} className="survey-text-response">{r}</div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {!analyticsData && analyticsDeployment && <p>Loading analytics...</p>}
          {!analyticsDeployment && <p className="survey-no-data">Select a deployment above to view response analytics.</p>}
        </div>
      )}

      {/* ── Builder Tab ────────────────────────────────────────────────────── */}
      {tab === 'builder' && (
        <div className="survey-builder-tab">
          <p className="survey-tab-desc">Design a custom survey with your own branding and questions.</p>

          <div className="survey-builder-preview" style={{ background: builderColour }}>
            {builderBannerUrl && <img src={builderBannerUrl} alt="Banner" className="survey-builder-banner-img" />}
            <h3 style={{ color: '#fff' }}>{builderTitle || 'Your Survey Title'}</h3>
            <p style={{ color: 'rgba(255,255,255,0.85)' }}>{builderDesc || 'Survey description will appear here...'}</p>
          </div>

          <div className="survey-builder-form">
            <div className="survey-builder-row">
              <div className="survey-builder-field">
                <label>Survey Title *</label>
                <input value={builderTitle} onChange={e => setBuilderTitle(e.target.value)} placeholder="e.g. Q4 Team Feedback" />
              </div>
              <div className="survey-builder-field">
                <label>Banner Colour</label>
                <div className="survey-colour-picker">
                  {['#4F46E5', '#10B981', '#EF4444', '#F59E0B', '#8B5CF6', '#0EA5E9', '#EC4899', '#64748B', '#14B8A6', '#F97316'].map(c => (
                    <button key={c} className={`survey-colour-swatch ${builderColour === c ? 'active' : ''}`} style={{ background: c }} onClick={() => setBuilderColour(c)} />
                  ))}
                </div>
              </div>
            </div>
            <div className="survey-builder-field">
              <label>Description</label>
              <textarea value={builderDesc} onChange={e => setBuilderDesc(e.target.value)} placeholder="Describe the purpose of this survey..." rows={2} />
            </div>
            <div className="survey-builder-field">
              <label>Banner Image URL (optional)</label>
              <input value={builderBannerUrl} onChange={e => setBuilderBannerUrl(e.target.value)} placeholder="https://..." />
            </div>
            <div className="survey-builder-field">
              <label>Delivery Channels</label>
              <div className="survey-channel-toggles">
                {['pc', 'mobile', 'teams'].map(ch => {
                  const isTeams = ch === 'teams'
                  const disabled = isTeams && !features.teams_integration
                  return (
                    <label key={ch} className={`survey-channel-toggle ${disabled ? 'disabled' : ''}`}>
                      <input
                        type="checkbox"
                        checked={builderChannels.includes(ch)}
                        disabled={disabled}
                        onChange={e => {
                          if (e.target.checked) setBuilderChannels([...builderChannels, ch])
                          else setBuilderChannels(builderChannels.filter(c => c !== ch))
                        }}
                      />
                      <span className="survey-channel-label">
                        {ch === 'pc' && '🖥 Desktop'}
                        {ch === 'mobile' && '📱 Mobile'}
                        {ch === 'teams' && '💬 Teams'}
                      </span>
                      {disabled && <span className="survey-channel-disabled-hint">Requires Teams subscription</span>}
                    </label>
                  )
                })}
              </div>
            </div>

            <h3>Questions</h3>
            {renderQuestionEditor(builderQuestions, setBuilderQuestions)}

            <div className="survey-builder-actions">
              <button className="survey-save-btn" onClick={saveCustomSurvey}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                Save Survey
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Modal ─────────────────────────────────────────────────────── */}
      {editingSurvey && (
        <div className="survey-modal-overlay" onClick={() => setEditingSurvey(null)}>
          <div className="survey-modal" onClick={e => e.stopPropagation()}>
            <div className="survey-modal-header">
              <h3>Edit Survey</h3>
              <button className="survey-modal-close" onClick={() => setEditingSurvey(null)}>×</button>
            </div>
            <div className="survey-modal-body">
              <div className="survey-builder-field">
                <label>Title</label>
                <input value={editingSurvey.title} onChange={e => setEditingSurvey({ ...editingSurvey, title: e.target.value })} />
              </div>
              <div className="survey-builder-field">
                <label>Description</label>
                <textarea value={editingSurvey.description || ''} onChange={e => setEditingSurvey({ ...editingSurvey, description: e.target.value })} rows={2} />
              </div>
              <div className="survey-builder-field">
                <label>Banner Colour</label>
                <div className="survey-colour-picker">
                  {['#4F46E5', '#10B981', '#EF4444', '#F59E0B', '#8B5CF6', '#0EA5E9', '#EC4899', '#64748B', '#14B8A6', '#F97316'].map(c => (
                    <button key={c} className={`survey-colour-swatch ${editingSurvey.banner_colour === c ? 'active' : ''}`} style={{ background: c }} onClick={() => setEditingSurvey({ ...editingSurvey, banner_colour: c })} />
                  ))}
                </div>
              </div>
              <div className="survey-builder-field">
                <label>Delivery Channels</label>
                <div className="survey-channel-toggles">
                  {['pc', 'mobile', 'teams'].map(ch => {
                    const disabled = ch === 'teams' && !features.teams_integration
                    return (
                      <label key={ch} className={`survey-channel-toggle ${disabled ? 'disabled' : ''}`}>
                        <input
                          type="checkbox"
                          checked={editingSurvey.delivery_channels.includes(ch)}
                          disabled={disabled}
                          onChange={e => {
                            const channels = e.target.checked
                              ? [...editingSurvey.delivery_channels, ch]
                              : editingSurvey.delivery_channels.filter(c => c !== ch)
                            setEditingSurvey({ ...editingSurvey, delivery_channels: channels })
                          }}
                        />
                        <span className="survey-channel-label">
                          {ch === 'pc' && '🖥 Desktop'}{ch === 'mobile' && '📱 Mobile'}{ch === 'teams' && '💬 Teams'}
                        </span>
                        {disabled && <span className="survey-channel-disabled-hint">Requires Teams subscription</span>}
                      </label>
                    )
                  })}
                </div>
              </div>
              <h4>Questions</h4>
              {renderQuestionEditor(editingSurvey.questions, (q) => setEditingSurvey({ ...editingSurvey, questions: q }))}
            </div>
            <div className="survey-modal-footer">
              <button className="survey-action-btn" onClick={() => setEditingSurvey(null)}>Cancel</button>
              <button className="survey-save-btn" onClick={saveSurveyEdit}>Save Changes</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Deploy Modal ───────────────────────────────────────────────────── */}
      {deployModal && (
        <div className="survey-modal-overlay" onClick={() => setDeployModal(null)}>
          <div className="survey-modal survey-modal-sm" onClick={e => e.stopPropagation()}>
            <div className="survey-modal-header">
              <h3>Deploy: {deployModal.title}</h3>
              <button className="survey-modal-close" onClick={() => setDeployModal(null)}>×</button>
            </div>
            <div className="survey-modal-body">
              <div className="survey-builder-field">
                <label>End Date *</label>
                <input type="date" value={deployEndDate} onChange={e => setDeployEndDate(e.target.value)} min={new Date().toISOString().split('T')[0]} />
              </div>
              <div className="survey-builder-field">
                <label>Target Audience</label>
                <select value={deployTargetType} onChange={e => { setDeployTargetType(e.target.value); setDeployTargetValues([]) }}>
                  <option value="all">All Employees</option>
                  <option value="department">By Department</option>
                  <option value="tag">By Tag</option>
                </select>
              </div>
              {deployTargetType === 'department' && (
                <div className="survey-builder-field">
                  <label>Select Departments</label>
                  <div className="survey-target-checkboxes">
                    {departments.map(d => (
                      <label key={d}>
                        <input type="checkbox" checked={deployTargetValues.includes(d)} onChange={e => {
                          if (e.target.checked) setDeployTargetValues([...deployTargetValues, d])
                          else setDeployTargetValues(deployTargetValues.filter(v => v !== d))
                        }} />
                        {d}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {deployTargetType === 'tag' && (
                <div className="survey-builder-field">
                  <label>Select Tags</label>
                  <div className="survey-target-checkboxes">
                    {TARGET_TAGS.map(tag => (
                      <label key={tag}>
                        <input type="checkbox" checked={deployTargetValues.includes(tag)} onChange={e => {
                          if (e.target.checked) setDeployTargetValues([...deployTargetValues, tag])
                          else setDeployTargetValues(deployTargetValues.filter(v => v !== tag))
                        }} />
                        {tag.replace(/_/g, ' ')}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="survey-modal-footer">
              <button className="survey-action-btn" onClick={() => setDeployModal(null)}>Cancel</button>
              <button className="survey-save-btn" onClick={deploySurvey} disabled={!deployEndDate}>
                🚀 Deploy Survey
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
