import { useState, useEffect, useCallback } from 'react'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { useToast } from '../../context/ToastContext'
import { supabase } from '../../lib/supabase'
import { formatDate } from '../../lib/formatters'

interface HelpArticle {
  id: number
  company_id: string | null
  category: string
  question: string
  answer: string
  keywords: string
  sort_order: number
  is_active: boolean
  data_query: string | null
  created_at: string
  updated_at: string
}

interface SearchLog {
  id: number
  query: string
  matched: boolean
  result_count: number
  top_article_id: number | null
  ai_generated: boolean
  created_at: string
}

const CATEGORIES = ['leave', 'pay', 'shifts', 'timesheets', 'benefits', 'rooms', 'elearning', 'kudos', 'meetings', 'performance', 'onboarding', 'policies', 'general']
const DATA_QUERY_OPTIONS = [
  { value: '', label: 'None (static answer)' },
  { value: 'leave_balance', label: 'Leave Balance' },
  { value: 'leave_requests', label: 'Upcoming Leave Requests' },
  { value: 'next_shift', label: 'Next Shift' },
  { value: 'hours_worked', label: 'Hours Worked This Week' },
  { value: 'last_payslip', label: 'Last Payslip' },
  { value: 'my_manager', label: 'Manager Name' },
  { value: 'my_department', label: 'Department & Profile' },
]

export default function AdminHelp() {
  const { selectedCompanyId } = useAdminCompany()
  const { showToast } = useToast()
  const [tab, setTab] = useState<'company' | 'global' | 'metrics'>('company')
  const [articles, setArticles] = useState<HelpArticle[]>([])
  const [globalArticles, setGlobalArticles] = useState<HelpArticle[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [filterCategory, setFilterCategory] = useState('')
  const [form, setForm] = useState({
    category: 'general',
    question: '',
    answer: '',
    keywords: '',
    sort_order: 0,
    data_query: '',
    is_active: true,
  })

  const [searchLogs, setSearchLogs] = useState<SearchLog[]>([])
  const [metricsLoading, setMetricsLoading] = useState(false)
  const [metricsPeriod, setMetricsPeriod] = useState<'7' | '30' | '90'>('30')

  const loadArticles = useCallback(async () => {
    if (!selectedCompanyId) return
    setLoading(true)
    const [companyRes, globalRes] = await Promise.all([
      supabase
        .from('help_articles')
        .select('*')
        .eq('company_id', selectedCompanyId)
        .order('category')
        .order('sort_order'),
      supabase
        .from('help_articles')
        .select('*')
        .is('company_id', null)
        .order('category')
        .order('sort_order'),
    ])
    setArticles(companyRes.data || [])
    setGlobalArticles(globalRes.data || [])
    setLoading(false)
  }, [selectedCompanyId])

  const loadMetrics = useCallback(async () => {
    if (!selectedCompanyId) return
    setMetricsLoading(true)
    const since = new Date()
    since.setDate(since.getDate() - parseInt(metricsPeriod))
    const { data } = await supabase
      .from('help_search_logs')
      .select('id, query, matched, result_count, top_article_id, ai_generated, created_at')
      .eq('company_id', selectedCompanyId)
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: false })
      .limit(500)
    setSearchLogs(data || [])
    setMetricsLoading(false)
  }, [selectedCompanyId, metricsPeriod])

  useEffect(() => { loadArticles() }, [loadArticles])
  useEffect(() => { if (tab === 'metrics') loadMetrics() }, [tab, loadMetrics])

  function resetForm() {
    setForm({ category: 'general', question: '', answer: '', keywords: '', sort_order: 0, data_query: '', is_active: true })
    setEditingId(null)
    setShowForm(false)
  }

  function handleEdit(article: HelpArticle) {
    setForm({
      category: article.category,
      question: article.question,
      answer: article.answer,
      keywords: article.keywords,
      sort_order: article.sort_order,
      data_query: article.data_query || '',
      is_active: article.is_active,
    })
    setEditingId(article.id)
    setShowForm(true)
  }

  async function handleSave() {
    if (!selectedCompanyId || !form.question.trim() || !form.answer.trim()) {
      showToast('Please fill in the question and answer fields.', 'error')
      return
    }

    const payload = {
      company_id: selectedCompanyId,
      category: form.category,
      question: form.question.trim(),
      answer: form.answer.trim(),
      keywords: form.keywords.trim(),
      sort_order: form.sort_order,
      data_query: form.data_query || null,
      is_active: form.is_active,
      updated_at: new Date().toISOString(),
    }

    if (editingId) {
      const { error } = await supabase.from('help_articles').update(payload).eq('id', editingId)
      if (error) { showToast('Failed to update article.', 'error'); return }
      showToast('Article updated.', 'success')
    } else {
      const { error } = await supabase.from('help_articles').insert(payload)
      if (error) { showToast('Failed to create article.', 'error'); return }
      showToast('Article created.', 'success')
    }
    resetForm()
    loadArticles()
  }

  async function handleDelete(id: number) {
    if (!confirm('Are you sure you want to delete this article?')) return
    const { error } = await supabase.from('help_articles').delete().eq('id', id)
    if (error) { showToast('Failed to delete article.', 'error'); return }
    showToast('Article deleted.', 'success')
    loadArticles()
  }

  async function handleToggleActive(article: HelpArticle) {
    await supabase.from('help_articles').update({ is_active: !article.is_active, updated_at: new Date().toISOString() }).eq('id', article.id)
    loadArticles()
  }

  const filteredGlobal = filterCategory
    ? globalArticles.filter(a => a.category === filterCategory)
    : globalArticles

  const totalSearches = searchLogs.length
  const matchedSearches = searchLogs.filter(l => l.matched).length
  const unmatchedSearches = totalSearches - matchedSearches
  const aiAnsweredSearches = searchLogs.filter(l => l.ai_generated).length
  const faqMatchedSearches = matchedSearches - aiAnsweredSearches
  const matchRate = totalSearches > 0 ? Math.round((matchedSearches / totalSearches) * 100) : 0

  const unmatchedQueries = searchLogs
    .filter(l => !l.matched)
    .reduce((acc, l) => {
      const key = l.query.toLowerCase().trim()
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {} as Record<string, number>)
  const topUnmatched = Object.entries(unmatchedQueries)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)

  const topArticleHits = searchLogs
    .filter(l => l.top_article_id)
    .reduce((acc, l) => {
      acc[l.top_article_id!] = (acc[l.top_article_id!] || 0) + 1
      return acc
    }, {} as Record<number, number>)
  const allArticles = [...articles, ...globalArticles]
  const topHitArticles = Object.entries(topArticleHits)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id, count]) => ({
      article: allArticles.find(a => a.id === parseInt(id)),
      count,
    }))
    .filter(h => h.article)

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Employee Help</h1>
        <p className="admin-page-subtitle">Manage FAQ articles that employees see in the help chat</p>
      </div>

      <div className="admin-tabs">
        <button className={`admin-tab ${tab === 'company' ? 'active' : ''}`} onClick={() => setTab('company')}>
          Company Articles ({articles.length})
        </button>
        <button className={`admin-tab ${tab === 'global' ? 'active' : ''}`} onClick={() => setTab('global')}>
          Built-in Articles ({globalArticles.length})
        </button>
        <button className={`admin-tab ${tab === 'metrics' ? 'active' : ''}`} onClick={() => setTab('metrics')}>
          Search Metrics
        </button>
      </div>

      {tab === 'company' && (
        <div className="admin-help-section">
          <div className="admin-help-toolbar">
            <button className="admin-btn admin-btn-primary" onClick={() => { resetForm(); setShowForm(true) }}>
              + Add Article
            </button>
          </div>

          {showForm && (
            <div className="admin-help-form">
              <h3>{editingId ? 'Edit Article' : 'New Article'}</h3>
              <div className="admin-help-form-grid">
                <div className="admin-help-form-field">
                  <label>Category</label>
                  <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                    {CATEGORIES.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
                  </select>
                </div>
                <div className="admin-help-form-field">
                  <label>Sort Order</label>
                  <input type="number" value={form.sort_order} onChange={e => setForm(f => ({ ...f, sort_order: parseInt(e.target.value) || 0 }))} />
                </div>
                <div className="admin-help-form-field full-width">
                  <label>Question</label>
                  <input type="text" value={form.question} onChange={e => setForm(f => ({ ...f, question: e.target.value }))} placeholder="e.g. What is the company holiday policy?" />
                </div>
                <div className="admin-help-form-field full-width">
                  <label>Answer</label>
                  <textarea rows={4} value={form.answer} onChange={e => setForm(f => ({ ...f, answer: e.target.value }))} placeholder="The answer employees will see..." />
                </div>
                <div className="admin-help-form-field">
                  <label>Keywords (comma-separated)</label>
                  <input type="text" value={form.keywords} onChange={e => setForm(f => ({ ...f, keywords: e.target.value }))} placeholder="e.g. holiday, vacation, time off" />
                </div>
                <div className="admin-help-form-field">
                  <label>Data Query (optional)</label>
                  <select value={form.data_query} onChange={e => setForm(f => ({ ...f, data_query: e.target.value }))}>
                    {DATA_QUERY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                {form.data_query && (
                  <div className="admin-help-form-field full-width">
                    <p className="admin-help-hint">
                      Use {'{{' + form.data_query.replace('my_manager', 'manager_name').replace('my_department', 'department') + '}}'} in your answer to insert the employee's live data.
                    </p>
                  </div>
                )}
                <div className="admin-help-form-field">
                  <label className="admin-help-checkbox">
                    <input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
                    Active
                  </label>
                </div>
              </div>
              <div className="admin-help-form-actions">
                <button className="admin-btn admin-btn-secondary" onClick={resetForm}>Cancel</button>
                <button className="admin-btn admin-btn-primary" onClick={handleSave}>{editingId ? 'Update' : 'Create'}</button>
              </div>
            </div>
          )}

          {loading ? (
            <p className="admin-help-loading">Loading...</p>
          ) : articles.length === 0 ? (
            <div className="admin-help-empty">
              <p>No company-specific articles yet. Add your own FAQ entries that are specific to your organisation.</p>
              <p>Employees will also see the built-in articles from the "Built-in Articles" tab.</p>
            </div>
          ) : (
            <table className="admin-help-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Question</th>
                  <th>Data Query</th>
                  <th>Active</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {articles.map(a => (
                  <tr key={a.id}>
                    <td><span className="admin-help-category-badge">{a.category}</span></td>
                    <td>{a.question}</td>
                    <td>{a.data_query || '—'}</td>
                    <td>
                      <button className={`admin-help-toggle ${a.is_active ? 'active' : ''}`} onClick={() => handleToggleActive(a)}>
                        {a.is_active ? 'Yes' : 'No'}
                      </button>
                    </td>
                    <td>
                      <button className="admin-btn admin-btn-sm" onClick={() => handleEdit(a)}>Edit</button>
                      <button className="admin-btn admin-btn-sm admin-btn-danger" onClick={() => handleDelete(a.id)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'global' && (
        <div className="admin-help-section">
          <div className="admin-help-toolbar">
            <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className="admin-help-filter">
              <option value="">All Categories</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
            </select>
            <span className="admin-help-count">{filteredGlobal.length} articles</span>
          </div>

          {loading ? (
            <p className="admin-help-loading">Loading...</p>
          ) : (
            <div className="admin-help-global-list">
              {filteredGlobal.map(a => (
                <div key={a.id} className="admin-help-global-card">
                  <div className="admin-help-global-header">
                    <span className="admin-help-category-badge">{a.category}</span>
                    {a.data_query && <span className="admin-help-data-badge">Live data: {a.data_query}</span>}
                  </div>
                  <h4>{a.question}</h4>
                  <p>{a.answer}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'metrics' && (
        <div className="admin-help-section">
          <div className="admin-help-toolbar">
            <select value={metricsPeriod} onChange={e => setMetricsPeriod(e.target.value as '7' | '30' | '90')} className="admin-help-filter">
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
            </select>
            <button className="admin-btn admin-btn-sm" onClick={loadMetrics}>Refresh</button>
          </div>

          {metricsLoading ? (
            <p className="admin-help-loading">Loading metrics...</p>
          ) : totalSearches === 0 ? (
            <div className="admin-help-empty">
              <p>No search data yet. Metrics will appear here once employees start using the help chat.</p>
            </div>
          ) : (
            <>
              <div className="admin-help-metrics-cards">
                <div className="admin-help-metric-card">
                  <div className="admin-help-metric-value">{totalSearches}</div>
                  <div className="admin-help-metric-label">Total Searches</div>
                </div>
                <div className="admin-help-metric-card">
                  <div className="admin-help-metric-value" style={{ color: 'var(--success, #22c55e)' }}>{faqMatchedSearches}</div>
                  <div className="admin-help-metric-label">FAQ Matched</div>
                </div>
                <div className="admin-help-metric-card">
                  <div className="admin-help-metric-value" style={{ color: '#7c3aed' }}>{aiAnsweredSearches}</div>
                  <div className="admin-help-metric-label">AI Answered</div>
                </div>
                <div className="admin-help-metric-card">
                  <div className="admin-help-metric-value" style={{ color: 'var(--error, #ef4444)' }}>{unmatchedSearches}</div>
                  <div className="admin-help-metric-label">No Match</div>
                </div>
                <div className="admin-help-metric-card">
                  <div className="admin-help-metric-value">{matchRate}%</div>
                  <div className="admin-help-metric-label">Match Rate</div>
                </div>
              </div>

              {topUnmatched.length > 0 && (
                <div className="admin-help-metrics-section">
                  <h3>Top Unanswered Questions</h3>
                  <p className="admin-page-subtitle">These queries returned no results — consider adding articles to cover them.</p>
                  <table className="admin-help-table">
                    <thead>
                      <tr>
                        <th>Question</th>
                        <th>Times Asked</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topUnmatched.map(([query, count]) => (
                        <tr key={query}>
                          <td>{query}</td>
                          <td>{count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {topHitArticles.length > 0 && (
                <div className="admin-help-metrics-section">
                  <h3>Most Searched Articles</h3>
                  <p className="admin-page-subtitle">Articles most frequently returned as the top result.</p>
                  <table className="admin-help-table">
                    <thead>
                      <tr>
                        <th>Category</th>
                        <th>Question</th>
                        <th>Hits</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topHitArticles.map(h => (
                        <tr key={h.article!.id}>
                          <td><span className="admin-help-category-badge">{h.article!.category}</span></td>
                          <td>{h.article!.question}</td>
                          <td>{h.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="admin-help-metrics-section">
                <h3>Recent Searches</h3>
                <table className="admin-help-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Query</th>
                      <th>Source</th>
                      <th>Matched</th>
                      <th>Results</th>
                    </tr>
                  </thead>
                  <tbody>
                    {searchLogs.slice(0, 50).map(log => (
                      <tr key={log.id}>
                        <td>{formatDate(log.created_at)}</td>
                        <td>{log.query}</td>
                        <td>
                          <span className="admin-help-category-badge" style={log.ai_generated ? { background: '#7c3aed', color: '#fff' } : undefined}>
                            {log.ai_generated ? 'AI' : 'FAQ'}
                          </span>
                        </td>
                        <td>
                          <span className={`admin-help-toggle ${log.matched ? 'active' : ''}`}>
                            {log.matched ? 'Yes' : 'No'}
                          </span>
                        </td>
                        <td>{log.result_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
