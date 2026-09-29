import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAdminCompany } from '../../context/AdminCompanyContext'
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

interface InsightDeployment {
  id: string
  survey_id: string
  status: string
  starts_at: string
  ends_at: string
  target_type: string
  target_values: string[]
  total_recipients: number
  total_responses: number
  created_at: string
  survey: {
    id: string
    title: string
    description: string
    banner_colour: string
    questions: SurveyQuestion[]
    category?: string
  }
}

interface InsightResponse {
  id: string
  deployment_id: string
  employee_id: string
  status: string
  answers: { questionId: string; value: any }[]
  completed_at: string | null
  employee: { first_name: string; last_name: string; department: string | null } | null
}

export default function SurveyInsights() {
  const navigate = useNavigate()
  const { selectedCompanyId } = useAdminCompany()
  const { showError } = useToast()

  const [deployments, setDeployments] = useState<InsightDeployment[]>([])
  const [responses, setResponses] = useState<InsightResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [timeRange, setTimeRange] = useState<'30' | '90' | '365' | 'all'>('all')

  const loadData = useCallback(async () => {
    if (!selectedCompanyId) return
    setLoading(true)
    const { data: deps, error: dErr } = await supabase
      .from('survey_deployments')
      .select('*, survey:company_surveys(id, title, description, banner_colour, questions)')
      .eq('company_id', selectedCompanyId)
      .order('created_at', { ascending: false })
    if (dErr) { showError('Failed to load deployments'); setLoading(false); return }

    const allDeps = (deps || []) as InsightDeployment[]
    setDeployments(allDeps)

    if (allDeps.length > 0) {
      const depIds = allDeps.map(d => d.id)
      const { data: resps } = await supabase
        .from('survey_responses')
        .select('*, employee:employees(first_name, last_name, department)')
        .eq('company_id', selectedCompanyId)
        .in('deployment_id', depIds)
        .order('completed_at', { ascending: false })
      setResponses((resps || []) as InsightResponse[])
    }
    setLoading(false)
  }, [selectedCompanyId, showError])

  useEffect(() => { loadData() }, [loadData])

  const filteredDeps = useMemo(() => {
    let deps = deployments
    if (timeRange !== 'all') {
      const cutoff = new Date(Date.now() - Number(timeRange) * 86400000)
      deps = deps.filter(d => new Date(d.created_at) >= cutoff)
    }
    return deps
  }, [deployments, timeRange])

  const filteredResponses = useMemo(() => {
    const depIds = new Set(filteredDeps.map(d => d.id))
    return responses.filter(r => depIds.has(r.deployment_id))
  }, [filteredDeps, responses])

  const overview = useMemo(() => {
    const totalDeployed = filteredDeps.length
    const totalCompleted = filteredDeps.filter(d => d.status === 'completed').length
    const totalActive = filteredDeps.filter(d => d.status === 'active').length
    const totalRecipients = filteredResponses.length
    const totalResponded = filteredResponses.filter(r => r.status === 'completed').length
    const responseRate = totalRecipients > 0 ? Math.round((totalResponded / totalRecipients) * 100) : 0
    const avgCompletionDays = (() => {
      const completed = filteredResponses.filter(r => r.status === 'completed' && r.completed_at)
      if (completed.length === 0) return 0
      const dep = (id: string) => filteredDeps.find(d => d.id === id)
      const daysArr = completed.map(r => {
        const d = dep(r.deployment_id)
        if (!d) return 0
        return Math.max(0, Math.ceil((new Date(r.completed_at!).getTime() - new Date(d.starts_at).getTime()) / 86400000))
      })
      return Math.round(daysArr.reduce((a, b) => a + b, 0) / daysArr.length)
    })()
    return { totalDeployed, totalCompleted, totalActive, totalRecipients, totalResponded, responseRate, avgCompletionDays }
  }, [filteredDeps, filteredResponses])

  const departmentBreakdown = useMemo(() => {
    const depts: Record<string, { sent: number; completed: number }> = {}
    filteredResponses.forEach(r => {
      const dept = r.employee?.department || 'Unassigned'
      if (!depts[dept]) depts[dept] = { sent: 0, completed: 0 }
      depts[dept].sent++
      if (r.status === 'completed') depts[dept].completed++
    })
    return Object.entries(depts)
      .map(([dept, d]) => ({ dept, ...d, rate: d.sent > 0 ? Math.round((d.completed / d.sent) * 100) : 0 }))
      .sort((a, b) => b.sent - a.sent)
  }, [filteredResponses])

  const sentimentScores = useMemo(() => {
    const scores: { surveyTitle: string; questionText: string; avg: number; maxScale: number; count: number; colour: string }[] = []
    filteredDeps.forEach(dep => {
      if (!dep.survey) return
      dep.survey.questions.forEach(q => {
        if (q.type !== 'scale') return
        const depResponses = filteredResponses.filter(r => r.deployment_id === dep.id && r.status === 'completed')
        const vals = depResponses.map(r => {
          const ans = r.answers.find(a => a.questionId === q.id)
          return ans ? Number(ans.value) : NaN
        }).filter(n => !isNaN(n))
        if (vals.length === 0) return
        const avg = vals.reduce((a, b) => a + b, 0) / vals.length
        const maxScale = q.max || 10
        scores.push({
          surveyTitle: dep.survey.title,
          questionText: q.text,
          avg: Number(avg.toFixed(1)),
          maxScale,
          count: vals.length,
          colour: dep.survey.banner_colour,
        })
      })
    })
    return scores.sort((a, b) => b.avg - a.avg)
  }, [filteredDeps, filteredResponses])

  const topChoices = useMemo(() => {
    const results: { surveyTitle: string; questionText: string; topOption: string; topPct: number; totalVotes: number; colour: string }[] = []
    filteredDeps.forEach(dep => {
      if (!dep.survey) return
      dep.survey.questions.forEach(q => {
        if (q.type !== 'radio') return
        const depResponses = filteredResponses.filter(r => r.deployment_id === dep.id && r.status === 'completed')
        const counts: Record<string, number> = {}
        ;(q.options || []).forEach(o => { counts[o] = 0 })
        depResponses.forEach(r => {
          const ans = r.answers.find(a => a.questionId === q.id)
          if (ans && counts[ans.value] !== undefined) counts[ans.value]++
        })
        const total = Object.values(counts).reduce((a, b) => a + b, 0)
        if (total === 0) return
        const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1])
        results.push({
          surveyTitle: dep.survey.title,
          questionText: q.text,
          topOption: sorted[0][0],
          topPct: Math.round((sorted[0][1] / total) * 100),
          totalVotes: total,
          colour: dep.survey.banner_colour,
        })
      })
    })
    return results.sort((a, b) => b.totalVotes - a.totalVotes).slice(0, 12)
  }, [filteredDeps, filteredResponses])

  const engagementTrend = useMemo(() => {
    const months: Record<string, { sent: number; completed: number }> = {}
    filteredDeps.forEach(dep => {
      const key = new Date(dep.starts_at).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })
      if (!months[key]) months[key] = { sent: 0, completed: 0 }
    })
    filteredResponses.forEach(r => {
      const dep = filteredDeps.find(d => d.id === r.deployment_id)
      if (!dep) return
      const key = new Date(dep.starts_at).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })
      if (!months[key]) months[key] = { sent: 0, completed: 0 }
      months[key].sent++
      if (r.status === 'completed') months[key].completed++
    })
    return Object.entries(months).map(([month, d]) => ({
      month,
      ...d,
      rate: d.sent > 0 ? Math.round((d.completed / d.sent) * 100) : 0,
    }))
  }, [filteredDeps, filteredResponses])

  const surveyPerformance = useMemo(() => {
    return filteredDeps
      .filter(d => d.survey)
      .map(dep => {
        const depResps = filteredResponses.filter(r => r.deployment_id === dep.id)
        const completed = depResps.filter(r => r.status === 'completed').length
        const total = depResps.length
        return {
          id: dep.id,
          title: dep.survey.title,
          colour: dep.survey.banner_colour,
          status: dep.status,
          starts_at: dep.starts_at,
          ends_at: dep.ends_at,
          total,
          completed,
          rate: total > 0 ? Math.round((completed / total) * 100) : 0,
        }
      })
      .sort((a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime())
  }, [filteredDeps, filteredResponses])

  const textHighlights = useMemo(() => {
    const items: { surveyTitle: string; questionText: string; responses: string[]; colour: string }[] = []
    filteredDeps.forEach(dep => {
      if (!dep.survey) return
      dep.survey.questions.forEach(q => {
        if (q.type !== 'text' && q.type !== 'dynamic_lines') return
        const depResps = filteredResponses.filter(r => r.deployment_id === dep.id && r.status === 'completed')
        const texts: string[] = []
        depResps.forEach(r => {
          const ans = r.answers.find(a => a.questionId === q.id)
          if (!ans) return
          if (Array.isArray(ans.value)) texts.push(...ans.value.filter((v: string) => v.trim()))
          else if (typeof ans.value === 'string' && ans.value.trim()) texts.push(ans.value)
        })
        if (texts.length > 0) {
          items.push({ surveyTitle: dep.survey.title, questionText: q.text, responses: texts, colour: dep.survey.banner_colour })
        }
      })
    })
    return items
  }, [filteredDeps, filteredResponses])

  function formatDateUK(iso: string) {
    if (!iso) return ''
    return new Date(iso).toLocaleDateString('en-GB')
  }

  if (loading) {
    return (
      <div className="admin-surveys-page">
        <div className="si-loading">
          <div className="si-loading-spinner" />
          <p>Loading survey insights...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="admin-surveys-page">
      <div className="si-header">
        <div className="si-header-left">
          <button className="si-back" onClick={() => navigate('/admin/surveys')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
          <div>
            <h2>Survey Insights</h2>
            <p>Cross-survey analytics and company health indicators</p>
          </div>
        </div>
        <div className="si-filters">
          <select value={timeRange} onChange={e => setTimeRange(e.target.value as any)} className="si-filter-select">
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="365">Last 12 months</option>
            <option value="all">All time</option>
          </select>
        </div>
      </div>

      {deployments.length === 0 ? (
        <div className="si-empty">
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
          <h3>No survey data yet</h3>
          <p>Deploy surveys to start gathering insights about your organisation.</p>
          <button className="si-action-btn" onClick={() => navigate('/admin/surveys')}>Go to Surveys</button>
        </div>
      ) : (
        <>
          {/* ── Overview KPIs ──────────────────────────────────────────────── */}
          <div className="si-kpi-grid">
            <div className="si-kpi">
              <div className="si-kpi-icon si-kpi-blue">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
              </div>
              <div className="si-kpi-data">
                <span className="si-kpi-num">{overview.totalDeployed}</span>
                <span className="si-kpi-label">Surveys Deployed</span>
              </div>
            </div>
            <div className="si-kpi">
              <div className="si-kpi-icon si-kpi-green">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              </div>
              <div className="si-kpi-data">
                <span className="si-kpi-num">{overview.totalResponded}</span>
                <span className="si-kpi-label">Responses Collected</span>
              </div>
            </div>
            <div className="si-kpi">
              <div className="si-kpi-icon si-kpi-indigo">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
              </div>
              <div className="si-kpi-data">
                <span className="si-kpi-num">{overview.responseRate}%</span>
                <span className="si-kpi-label">Overall Response Rate</span>
              </div>
            </div>
            <div className="si-kpi">
              <div className="si-kpi-icon si-kpi-amber">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              </div>
              <div className="si-kpi-data">
                <span className="si-kpi-num">{overview.avgCompletionDays}d</span>
                <span className="si-kpi-label">Avg. Completion Time</span>
              </div>
            </div>
          </div>

          {/* ── Two-column layout ─────────────────────────────────────────── */}
          <div className="si-two-col">

            {/* ── Engagement Trend ──────────────────────────────────────────── */}
            <div className="si-card si-card-wide">
              <div className="si-card-header">
                <h3>Engagement Trend</h3>
                <span className="si-card-subtitle">Response rates by deployment period</span>
              </div>
              {engagementTrend.length === 0 ? (
                <p className="si-no-data">No trend data available</p>
              ) : (
                <div className="si-trend-chart">
                  {engagementTrend.map((m, i) => {
                    const maxSent = Math.max(...engagementTrend.map(e => e.sent), 1)
                    return (
                      <div key={i} className="si-trend-col">
                        <div className="si-trend-bars">
                          <div className="si-trend-bar si-trend-sent" style={{ height: `${(m.sent / maxSent) * 100}%` }} title={`${m.sent} sent`} />
                          <div className="si-trend-bar si-trend-done" style={{ height: `${(m.completed / maxSent) * 100}%` }} title={`${m.completed} completed`} />
                        </div>
                        <span className="si-trend-label">{m.month}</span>
                        <span className="si-trend-rate">{m.rate}%</span>
                      </div>
                    )
                  })}
                </div>
              )}
              <div className="si-trend-legend">
                <span><span className="si-legend-dot si-legend-sent" /> Assigned</span>
                <span><span className="si-legend-dot si-legend-done" /> Completed</span>
              </div>
            </div>

            {/* ── Department Breakdown ──────────────────────────────────────── */}
            <div className="si-card">
              <div className="si-card-header">
                <h3>Department Engagement</h3>
                <span className="si-card-subtitle">Response rates by department</span>
              </div>
              {departmentBreakdown.length === 0 ? (
                <p className="si-no-data">No department data</p>
              ) : (
                <div className="si-dept-list">
                  {departmentBreakdown.map(d => (
                    <div key={d.dept} className="si-dept-row">
                      <div className="si-dept-info">
                        <span className="si-dept-name">{d.dept}</span>
                        <span className="si-dept-count">{d.completed}/{d.sent}</span>
                      </div>
                      <div className="si-dept-bar-track">
                        <div className="si-dept-bar-fill" style={{ width: `${d.rate}%`, background: d.rate >= 75 ? '#16a34a' : d.rate >= 50 ? '#f59e0b' : '#ef4444' }} />
                      </div>
                      <span className={`si-dept-rate ${d.rate >= 75 ? 'high' : d.rate >= 50 ? 'mid' : 'low'}`}>{d.rate}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── Survey Performance ────────────────────────────────────────── */}
            <div className="si-card">
              <div className="si-card-header">
                <h3>Survey Performance</h3>
                <span className="si-card-subtitle">Individual deployment results</span>
              </div>
              <div className="si-survey-perf">
                {surveyPerformance.slice(0, 10).map(s => (
                  <div key={s.id} className="si-perf-row">
                    <div className="si-perf-accent" style={{ background: s.colour }} />
                    <div className="si-perf-info">
                      <span className="si-perf-title">{s.title}</span>
                      <span className="si-perf-dates">{formatDateUK(s.starts_at)} – {formatDateUK(s.ends_at)}</span>
                    </div>
                    <div className="si-perf-stats">
                      <span className={`si-perf-status ${s.status}`}>{s.status}</span>
                      <div className="si-perf-bar-track">
                        <div className="si-perf-bar-fill" style={{ width: `${s.rate}%` }} />
                      </div>
                      <span className="si-perf-rate">{s.completed}/{s.total} ({s.rate}%)</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Sentiment Scores (Scale Questions) ───────────────────────── */}
            {sentimentScores.length > 0 && (
              <div className="si-card si-card-wide">
                <div className="si-card-header">
                  <h3>Sentiment Scores</h3>
                  <span className="si-card-subtitle">Average ratings from scale-based questions</span>
                </div>
                <div className="si-sentiment-grid">
                  {sentimentScores.slice(0, 12).map((s, i) => {
                    const pct = (s.avg / s.maxScale) * 100
                    const color = pct >= 70 ? '#16a34a' : pct >= 50 ? '#f59e0b' : '#ef4444'
                    return (
                      <div key={i} className="si-sentiment-card">
                        <div className="si-sentiment-score" style={{ color }}>{s.avg}</div>
                        <div className="si-sentiment-ring" style={{ background: `conic-gradient(${color} ${pct}%, var(--border) ${pct}%)` }}>
                          <div className="si-sentiment-ring-inner" />
                        </div>
                        <div className="si-sentiment-text">
                          <span className="si-sentiment-q">{s.questionText}</span>
                          <span className="si-sentiment-survey">{s.surveyTitle} · {s.count} responses</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* ── Top Choices (Radio Questions) ────────────────────────────── */}
            {topChoices.length > 0 && (
              <div className="si-card si-card-wide">
                <div className="si-card-header">
                  <h3>Key Findings</h3>
                  <span className="si-card-subtitle">Most selected answers across surveys</span>
                </div>
                <div className="si-findings-grid">
                  {topChoices.map((c, i) => (
                    <div key={i} className="si-finding-card">
                      <div className="si-finding-top">
                        <span className="si-finding-pct" style={{ color: c.colour }}>{c.topPct}%</span>
                        <span className="si-finding-answer">{c.topOption}</span>
                      </div>
                      <span className="si-finding-question">{c.questionText}</span>
                      <span className="si-finding-meta">{c.surveyTitle} · {c.totalVotes} responses</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Text Feedback Highlights ──────────────────────────────────── */}
            {textHighlights.length > 0 && (
              <div className="si-card si-card-wide">
                <div className="si-card-header">
                  <h3>Employee Feedback</h3>
                  <span className="si-card-subtitle">Open-text responses from surveys</span>
                </div>
                <div className="si-feedback-sections">
                  {textHighlights.slice(0, 6).map((t, i) => (
                    <div key={i} className="si-feedback-section">
                      <div className="si-feedback-q">
                        <div className="si-feedback-dot" style={{ background: t.colour }} />
                        <div>
                          <span className="si-feedback-question">{t.questionText}</span>
                          <span className="si-feedback-survey">{t.surveyTitle}</span>
                        </div>
                      </div>
                      <div className="si-feedback-list">
                        {t.responses.slice(0, 5).map((r, j) => (
                          <div key={j} className="si-feedback-item">{r}</div>
                        ))}
                        {t.responses.length > 5 && (
                          <span className="si-feedback-more">+{t.responses.length - 5} more responses</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
