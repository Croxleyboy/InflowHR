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

interface HandbookSection {
  id: number
  company_id: string | null
  section_key: string
  section_number: string
  title: string
  content: string
  handbook_version: string
  is_active: boolean
  created_at: string
  updated_at: string
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
  const [tab, setTab] = useState<'company' | 'global' | 'metrics' | 'handbook'>('company')
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

  const [handbookSections, setHandbookSections] = useState<HandbookSection[]>([])
  const [handbookLoading, setHandbookLoading] = useState(false)
  const [handbookMarkdown, setHandbookMarkdown] = useState('')
  const [handbookVersion, setHandbookVersion] = useState('1.0')
  const [handbookSaving, setHandbookSaving] = useState(false)
  const [handbookOverlaps, setHandbookOverlaps] = useState<{ id: number; question: string; matchedSection: string }[]>([])

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

  const loadHandbook = useCallback(async () => {
    if (!selectedCompanyId) return
    setHandbookLoading(true)
    const { data } = await supabase
      .from('handbook_sections')
      .select('*')
      .eq('company_id', selectedCompanyId)
      .order('section_number')
    setHandbookSections(data || [])
    setHandbookLoading(false)
  }, [selectedCompanyId])

  function parseMarkdownSections(md: string): { key: string; number: string; title: string; content: string }[] {
    const parts = md.split(/(?=^## )/m).filter(s => s.startsWith('## '))
    return parts.map((sec, i) => {
      const heading = sec.split('\n')[0].replace(/^## /, '')
      const slug = heading.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
      const numMatch = heading.match(/^(\d+)\.?\s/)
      return {
        key: `${String(i).padStart(2, '0')}-${slug}`,
        number: numMatch ? numMatch[1] : String(i),
        title: heading,
        content: sec.trim(),
      }
    })
  }

  async function handleHandbookSave() {
    if (!selectedCompanyId) return
    const sections = parseMarkdownSections(handbookMarkdown)
    if (sections.length === 0) {
      showToast('No sections found. The handbook should contain ## headings to split into sections.', 'error')
      return
    }
    setHandbookSaving(true)

    const { error: delError } = await supabase
      .from('handbook_sections')
      .delete()
      .eq('company_id', selectedCompanyId)
    if (delError) {
      showToast('Failed to clear existing sections.', 'error')
      setHandbookSaving(false)
      return
    }

    const rows = sections.map(s => ({
      company_id: selectedCompanyId,
      section_key: s.key,
      section_number: s.number,
      title: s.title,
      content: s.content,
      handbook_version: handbookVersion,
      is_active: true,
    }))

    const { error: insError } = await supabase.from('handbook_sections').insert(rows)
    if (insError) {
      showToast('Failed to save handbook sections.', 'error')
      setHandbookSaving(false)
      return
    }

    setHandbookMarkdown('')
    setHandbookSaving(false)
    loadHandbook()

    const handbookKeywords = sections.flatMap(s => {
      const words = s.title.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(w => w.length > 3)
      return words
    })
    const policyTerms = new Set(handbookKeywords)

    const { data: allArticles } = await supabase
      .from('help_articles')
      .select('id, question, keywords, data_query, is_active, company_id')
      .or(`company_id.is.null,company_id.eq.${selectedCompanyId}`)
      .eq('is_active', true)

    const overlapping = (allArticles || []).filter(a => {
      if (a.data_query) return false
      const articleText = `${a.question} ${a.keywords || ''}`.toLowerCase()
      const matchCount = [...policyTerms].filter(term => articleText.includes(term)).length
      return matchCount >= 2
    })

    if (overlapping.length > 0) {
      const companyOverlaps = overlapping.filter(a => a.company_id === selectedCompanyId)
      if (companyOverlaps.length > 0) {
        const ids = companyOverlaps.map(a => a.id)
        await supabase
          .from('help_articles')
          .update({ is_active: false })
          .in('id', ids)
        loadArticles()
      }

      const globalOverlaps = overlapping.filter(a => !a.company_id)

      const overlapDetails = overlapping.map(a => {
        const articleText = `${a.question} ${a.keywords || ''}`.toLowerCase()
        const matched = [...policyTerms].filter(term => articleText.includes(term))
        const matchedSection = sections.find(s => {
          const sWords = s.title.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(w => w.length > 3)
          return sWords.some(w => matched.includes(w))
        })
        return { id: a.id, question: a.question, matchedSection: matchedSection?.title || 'Multiple sections' }
      })
      setHandbookOverlaps(overlapDetails)

      const deactivated = companyOverlaps.length
      const globalCount = globalOverlaps.length
      let msg = `${sections.length} handbook sections saved.`
      if (deactivated > 0) msg += ` ${deactivated} overlapping company FAQ article${deactivated > 1 ? 's' : ''} automatically deactivated.`
      if (globalCount > 0) msg += ` ${globalCount} global article${globalCount > 1 ? 's' : ''} overlap but can only be managed by a super admin.`
      showToast(msg, 'success')
    } else {
      setHandbookOverlaps([])
      showToast(`${sections.length} handbook sections saved. Both AI assistants will now use them.`, 'success')
    }
  }

  async function handleHandbookDelete() {
    if (!selectedCompanyId) return
    if (!confirm('Remove all handbook sections for this company? The AI assistants will fall back to FAQ-only answers.')) return
    const { error } = await supabase.from('handbook_sections').delete().eq('company_id', selectedCompanyId)
    if (error) { showToast('Failed to remove handbook.', 'error'); return }
    showToast('Handbook sections removed.', 'success')
    setHandbookOverlaps([])
    loadHandbook()
  }

  function handleHandbookFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setHandbookMarkdown(reader.result as string)
    reader.readAsText(file)
    e.target.value = ''
  }

  useEffect(() => { loadArticles() }, [loadArticles])
  useEffect(() => { if (tab === 'metrics') loadMetrics() }, [tab, loadMetrics])
  useEffect(() => { if (tab === 'handbook') loadHandbook() }, [tab, loadHandbook])

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
        <button className={`admin-tab ${tab === 'handbook' ? 'active' : ''}`} onClick={() => setTab('handbook')}>
          Handbook {handbookSections.length > 0 ? `(${handbookSections.length})` : ''}
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

      {tab === 'handbook' && (
        <div className="admin-help-section">
          {handbookLoading ? (
            <p className="admin-help-loading">Loading handbook...</p>
          ) : handbookSections.length > 0 ? (
            <>
              <div className="admin-help-metrics-cards" style={{ marginBottom: '1.5rem' }}>
                <div className="admin-help-metric-card">
                  <div className="admin-help-metric-value">{handbookSections.length}</div>
                  <div className="admin-help-metric-label">Sections Loaded</div>
                </div>
                <div className="admin-help-metric-card">
                  <div className="admin-help-metric-value">{handbookSections[0]?.handbook_version || '—'}</div>
                  <div className="admin-help-metric-label">Version</div>
                </div>
                <div className="admin-help-metric-card">
                  <div className="admin-help-metric-value">{handbookSections[0]?.updated_at ? formatDate(handbookSections[0].updated_at) : '—'}</div>
                  <div className="admin-help-metric-label">Last Updated</div>
                </div>
                <div className="admin-help-metric-card">
                  <div className="admin-help-metric-value" style={{ color: 'var(--success, #22c55e)' }}>{handbookSections.filter(s => s.is_active).length}</div>
                  <div className="admin-help-metric-label">Active</div>
                </div>
              </div>

              {handbookOverlaps.length > 0 && (
                <div className="admin-help-metrics-section" style={{ marginBottom: '1.5rem', background: 'var(--warning-bg, #fffbeb)', border: '1px solid var(--warning-border, #fbbf24)', borderRadius: '8px', padding: '1rem 1.25rem' }}>
                  <h3 style={{ color: 'var(--warning-text, #92400e)', marginBottom: '0.5rem' }}>FAQ Overlap Detected</h3>
                  <p style={{ fontSize: '0.8125rem', color: 'var(--warning-text, #92400e)', marginBottom: '0.75rem' }}>
                    The following FAQ articles cover topics now in your handbook. Company articles were automatically deactivated to avoid conflicting answers. Global articles can only be managed by a super admin.
                  </p>
                  <table className="admin-help-table" style={{ fontSize: '0.8125rem' }}>
                    <thead>
                      <tr><th>FAQ Article</th><th>Overlaps With</th><th>Status</th></tr>
                    </thead>
                    <tbody>
                      {handbookOverlaps.map(o => {
                        const art = [...articles, ...globalArticles].find(a => a.id === o.id)
                        const isGlobal = art && !art.company_id
                        return (
                          <tr key={o.id}>
                            <td>{o.question}</td>
                            <td style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #6b7280)' }}>{o.matchedSection}</td>
                            <td>
                              {isGlobal ? (
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #6b7280)' }}>Global (unchanged)</span>
                              ) : (
                                <span style={{ fontSize: '0.75rem', color: 'var(--warning-text, #92400e)' }}>Deactivated</span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  <button
                    className="admin-btn admin-btn-secondary"
                    style={{ marginTop: '0.75rem', fontSize: '0.8125rem' }}
                    onClick={() => setHandbookOverlaps([])}
                  >
                    Dismiss
                  </button>
                </div>
              )}

              <div className="admin-help-metrics-section">
                <h3>Loaded Sections</h3>
                <p className="admin-page-subtitle">These sections are used by both AI assistants when employees ask policy questions.</p>
                <table className="admin-help-table">
                  <thead>
                    <tr>
                      <th>Section</th>
                      <th>Title</th>
                      <th>Length</th>
                      <th>Active</th>
                    </tr>
                  </thead>
                  <tbody>
                    {handbookSections.map(s => (
                      <tr key={s.id}>
                        <td>{s.section_number}</td>
                        <td>{s.title}</td>
                        <td>{s.content.length.toLocaleString()} chars</td>
                        <td>
                          <span className={`admin-help-toggle ${s.is_active ? 'active' : ''}`}>
                            {s.is_active ? 'Yes' : 'No'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="admin-help-metrics-section">
                <h3>Update Handbook</h3>
                <p className="admin-page-subtitle">Paste new handbook markdown or upload a .md file to replace all sections.</p>
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <label style={{ fontSize: '0.875rem', fontWeight: 500 }}>Version:</label>
                  <input
                    type="text"
                    value={handbookVersion}
                    onChange={e => setHandbookVersion(e.target.value)}
                    style={{ width: '80px', padding: '0.375rem 0.5rem', border: '1px solid var(--border, #e5e7eb)', borderRadius: '6px' }}
                  />
                  <label className="admin-btn admin-btn-secondary" style={{ cursor: 'pointer', margin: 0 }}>
                    Upload .md file
                    <input type="file" accept=".md,.txt" onChange={handleHandbookFileUpload} style={{ display: 'none' }} />
                  </label>
                </div>
                <textarea
                  rows={8}
                  value={handbookMarkdown}
                  onChange={e => setHandbookMarkdown(e.target.value)}
                  placeholder="Paste the full handbook markdown here. Sections are split on ## headings."
                  style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.8125rem', padding: '0.75rem', border: '1px solid var(--border, #e5e7eb)', borderRadius: '6px', resize: 'vertical' }}
                />
                {handbookMarkdown && (
                  <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary, #6b7280)', margin: '0.5rem 0' }}>
                    Preview: {parseMarkdownSections(handbookMarkdown).length} sections detected
                  </p>
                )}
                <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.75rem' }}>
                  <button
                    className="admin-btn admin-btn-primary"
                    onClick={handleHandbookSave}
                    disabled={handbookSaving || !handbookMarkdown.trim()}
                  >
                    {handbookSaving ? 'Saving...' : 'Replace All Sections'}
                  </button>
                  <button className="admin-btn admin-btn-danger" onClick={handleHandbookDelete}>
                    Remove Handbook
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="admin-help-empty">
              <p>No handbook loaded for this company. Upload your employee handbook to give the AI assistants access to your company's policies.</p>
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary, #6b7280)', marginTop: '0.5rem' }}>
                The handbook is split on ## headings into sections. Both the AI Help Agent and Enterprise AI will search relevant sections when employees ask policy questions.
              </p>
              <div style={{ marginTop: '1.5rem' }}>
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <label style={{ fontSize: '0.875rem', fontWeight: 500 }}>Version:</label>
                  <input
                    type="text"
                    value={handbookVersion}
                    onChange={e => setHandbookVersion(e.target.value)}
                    style={{ width: '80px', padding: '0.375rem 0.5rem', border: '1px solid var(--border, #e5e7eb)', borderRadius: '6px' }}
                  />
                  <label className="admin-btn admin-btn-secondary" style={{ cursor: 'pointer', margin: 0 }}>
                    Upload .md file
                    <input type="file" accept=".md,.txt" onChange={handleHandbookFileUpload} style={{ display: 'none' }} />
                  </label>
                </div>
                <textarea
                  rows={10}
                  value={handbookMarkdown}
                  onChange={e => setHandbookMarkdown(e.target.value)}
                  placeholder="Paste the full handbook markdown here. Sections are split on ## headings.&#10;&#10;Example:&#10;## 1. Welcome&#10;Your welcome policy content here...&#10;&#10;## 2. Annual Leave&#10;Your leave policy content here..."
                  style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.8125rem', padding: '0.75rem', border: '1px solid var(--border, #e5e7eb)', borderRadius: '6px', resize: 'vertical' }}
                />
                {handbookMarkdown && (
                  <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary, #6b7280)', margin: '0.5rem 0' }}>
                    Preview: {parseMarkdownSections(handbookMarkdown).length} sections detected
                  </p>
                )}
                <button
                  className="admin-btn admin-btn-primary"
                  onClick={handleHandbookSave}
                  disabled={handbookSaving || !handbookMarkdown.trim()}
                  style={{ marginTop: '0.75rem' }}
                >
                  {handbookSaving ? 'Saving...' : 'Load Handbook'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
