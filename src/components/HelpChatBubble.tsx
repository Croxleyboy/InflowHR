import { useState, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useFeatures } from '../context/FeatureContext'
import { useLanguage } from '../context/LanguageContext'
import { formatCurrency, formatDate } from '../lib/formatters'

interface HelpArticle {
  id: number
  category: string
  question: string
  answer: string
  keywords: string
  data_query: string | null
}

interface ChatMessage {
  role: 'bot' | 'user'
  text: string
  articles?: HelpArticle[]
  loading?: boolean
}

const CATEGORIES = [
  { key: 'leave', label: 'Leave' },
  { key: 'pay', label: 'Pay' },
  { key: 'shifts', label: 'Shifts' },
  { key: 'timesheets', label: 'Timesheets' },
  { key: 'benefits', label: 'Benefits' },
  { key: 'rooms', label: 'Room Booking' },
  { key: 'elearning', label: 'Training' },
  { key: 'kudos', label: 'Kudos' },
  { key: 'meetings', label: '1:1 Meetings' },
  { key: 'performance', label: 'Performance' },
  { key: 'onboarding', label: 'Onboarding' },
  { key: 'policies', label: 'Policies' },
  { key: 'general', label: 'General' },
]

const STOP_WORDS = new Set([
  'i', 'me', 'my', 'we', 'our', 'you', 'your', 'it', 'its', 'the', 'a', 'an',
  'is', 'are', 'was', 'were', 'be', 'been', 'am', 'do', 'does', 'did', 'has',
  'have', 'had', 'will', 'would', 'can', 'could', 'should', 'may', 'might',
  'shall', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'and',
  'or', 'not', 'but', 'if', 'so', 'as', 'that', 'this', 'what', 'which',
  'who', 'how', 'when', 'where', 'why', 'all', 'each', 'any', 'some', 'no',
  'about', 'up', 'out', 'get', 'got', 'just', 'than', 'then', 'also', 'very',
  'too', 'much', 'many', 'more', 'most', 'other', 'into', 'here', 'there',
])

function getSignificantWords(text: string): string[] {
  return text.toLowerCase().split(/\s+/)
    .map(w => w.replace(/[^a-z0-9]/g, ''))
    .filter(w => w.length > 2 && !STOP_WORDS.has(w))
}

function articleMatchesQuery(article: HelpArticle, queryWords: string[]): boolean {
  const searchText = `${article.question} ${article.keywords}`.toLowerCase()
  return queryWords.some(w => searchText.includes(w))
}

async function executeDataQuery(queryKey: string, employeeId: string, companyId: string, currency: string): Promise<string> {
  switch (queryKey) {
    case 'leave_balance': {
      const { data } = await supabase
        .from('leave_balances')
        .select('total_allowance, used, carried_over, leave_type:leave_type_id(name)')
        .eq('employee_id', employeeId)
        .eq('company_id', companyId)
      if (!data || data.length === 0) return 'No leave balance data found.'
      return data.map((b: any) => {
        const remaining = (b.total_allowance || 0) + (b.carried_over || 0) - (b.used || 0)
        const name = b.leave_type?.name || 'Leave'
        return `${name}: ${remaining} days remaining (${b.used || 0} used of ${(b.total_allowance || 0) + (b.carried_over || 0)})`
      }).join('\n')
    }
    case 'leave_requests': {
      const today = new Date().toISOString().split('T')[0]
      const { data } = await supabase
        .from('leave_requests')
        .select('start_date, end_date, status, days_requested, leave_type:leave_type_id(name)')
        .eq('employee_id', employeeId)
        .eq('company_id', companyId)
        .gte('end_date', today)
        .order('start_date')
        .limit(5)
      if (!data || data.length === 0) return 'No upcoming leave requests.'
      return data.map((r: any) => {
        const name = r.leave_type?.name || 'Leave'
        return `${name}: ${formatDate(r.start_date)} to ${formatDate(r.end_date)} — ${r.status} (${r.days_requested} days)`
      }).join('\n')
    }
    case 'next_shift': {
      const today = new Date().toISOString().split('T')[0]
      const { data } = await supabase
        .from('shift_assignments')
        .select('date, shift_template:shift_template_id(name, start_time, end_time)')
        .eq('employee_id', employeeId)
        .gte('date', today)
        .order('date')
        .limit(1)
        .single()
      if (!data) return 'No upcoming shifts found.'
      const t = data.shift_template as any
      return `${formatDate(data.date)} — ${t?.name || 'Shift'} (${t?.start_time?.slice(0, 5) || '?'} to ${t?.end_time?.slice(0, 5) || '?'})`
    }
    case 'hours_worked': {
      const now = new Date()
      const dayOfWeek = now.getDay()
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
      const monday = new Date(now)
      monday.setDate(now.getDate() + mondayOffset)
      const startOfWeek = monday.toISOString().split('T')[0]
      const { data } = await supabase
        .from('timesheets')
        .select('date, hours')
        .eq('employee_id', employeeId)
        .gte('date', startOfWeek)
        .order('date')
      if (!data || data.length === 0) return 'No timesheet entries this week.'
      const total = data.reduce((sum: number, t: any) => sum + (Number(t.hours) || 0), 0)
      return `${total.toFixed(1)} hours logged this week (${data.length} entries)`
    }
    case 'last_payslip': {
      const { data } = await supabase
        .from('payslips')
        .select('pay_period_start, pay_period_end, gross_pay, net_pay, payment_date, tax, national_insurance, pension')
        .eq('employee_id', employeeId)
        .order('payment_date', { ascending: false })
        .limit(1)
        .single()
      if (!data) return 'No payslip data found.'
      return [
        `Period: ${formatDate(data.pay_period_start)} to ${formatDate(data.pay_period_end)}`,
        `Gross Pay: ${formatCurrency(Number(data.gross_pay), currency)}`,
        `Tax: ${formatCurrency(Number(data.tax), currency)}`,
        `NI: ${formatCurrency(Number(data.national_insurance), currency)}`,
        `Pension: ${formatCurrency(Number(data.pension), currency)}`,
        `Net Pay: ${formatCurrency(Number(data.net_pay), currency)}`,
        `Paid: ${formatDate(data.payment_date)}`,
      ].join('\n')
    }
    case 'my_manager': {
      const { data } = await supabase
        .from('employees')
        .select('manager_id')
        .eq('id', employeeId)
        .single()
      if (!data?.manager_id) return 'No manager assigned.'
      const { data: mgr } = await supabase
        .from('employees')
        .select('first_name, last_name, job_title')
        .eq('id', data.manager_id)
        .single()
      if (!mgr) return 'Manager information not available.'
      return `${mgr.first_name} ${mgr.last_name}${mgr.job_title ? ` (${mgr.job_title})` : ''}`
    }
    case 'my_department': {
      const { data } = await supabase
        .from('employees')
        .select('department, job_title, first_name, last_name, start_date')
        .eq('id', employeeId)
        .single()
      if (!data) return 'Profile information not available.'
      return [
        `Name: ${data.first_name} ${data.last_name}`,
        `Job Title: ${data.job_title || 'Not set'}`,
        `Department: ${data.department || 'Not set'}`,
        data.start_date ? `Start Date: ${formatDate(data.start_date)}` : null,
      ].filter(Boolean).join('\n')
    }
    default:
      return ''
  }
}

async function resolveAnswer(article: HelpArticle, employeeId: string, companyId: string, currency: string): Promise<string> {
  if (!article.data_query) return article.answer
  const result = await executeDataQuery(article.data_query, employeeId, companyId, currency)
  const placeholders: Record<string, string> = {
    leave_balance: result,
    leave_requests: result,
    next_shift: result,
    hours_worked: result,
    last_payslip: result,
    manager_name: result,
    department: result,
  }
  let answer = article.answer
  for (const [key, val] of Object.entries(placeholders)) {
    answer = answer.replace(`{{${key}}}`, val)
  }
  return answer
}

export default function HelpChatBubble() {
  const { features } = useFeatures()
  const { employeeId, employeeName, companyUser, company, session } = useAuth()
  const { t } = useLanguage()
  const location = useLocation()
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [expandedArticle, setExpandedArticle] = useState<number | null>(null)
  const [resolvedAnswers, setResolvedAnswers] = useState<Record<number, string>>({})
  const [showChips, setShowChips] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  if (!features.employee_help || location.pathname.startsWith('/admin')) return null

  const companyId = companyUser?.company_id
  const currency = company?.currency || 'GBP'

  function scrollToBottom() {
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
  }

  function handleOpen() {
    setIsOpen(true)
    if (messages.length === 0) {
      const firstName = employeeName?.split(' ')[0] || ''
      setMessages([{
        role: 'bot',
        text: `Hi ${firstName}! How can I help you today? Choose a topic below or type your question.`,
      }])
      setShowChips(true)
    }
    setTimeout(() => inputRef.current?.focus(), 200)
  }

  function handleNewQuestion() {
    const firstName = employeeName?.split(' ')[0] || ''
    setMessages([{
      role: 'bot',
      text: `Hi ${firstName}! How can I help you today? Choose a topic below or type your question.`,
    }])
    setExpandedArticle(null)
    setResolvedAnswers({})
    setShowChips(true)
    setQuery('')
    setTimeout(() => inputRef.current?.focus(), 100)
  }

  async function searchArticles(searchQuery: string): Promise<HelpArticle[]> {
    if (!companyId) return []

    const queryWords = getSignificantWords(searchQuery)
    if (queryWords.length === 0) return []

    const { data } = await supabase
      .from('help_articles')
      .select('id, category, question, answer, keywords, data_query')
      .or(`company_id.is.null,company_id.eq.${companyId}`)
      .eq('is_active', true)
      .textSearch('search_vector', searchQuery, { type: 'websearch' })
      .order('sort_order')
      .limit(10)

    if (data && data.length > 0) {
      const relevant = data.filter(a => articleMatchesQuery(a, queryWords))
      if (relevant.length > 0) return relevant.slice(0, 5)
    }

    if (queryWords.length === 0) return []

    const ilikeFilters = queryWords.map(w =>
      `question.ilike.%${w}%,keywords.ilike.%${w}%`
    )

    let fallbackArticles: HelpArticle[] = []

    if (queryWords.length <= 3) {
      for (const filter of ilikeFilters) {
        const { data: partial } = await supabase
          .from('help_articles')
          .select('id, category, question, answer, keywords, data_query')
          .or(`company_id.is.null,company_id.eq.${companyId}`)
          .eq('is_active', true)
          .or(filter)
          .order('sort_order')
          .limit(8)
        if (partial) fallbackArticles.push(...partial)
      }
    } else {
      const { data: partial } = await supabase
        .from('help_articles')
        .select('id, category, question, answer, keywords, data_query')
        .or(`company_id.is.null,company_id.eq.${companyId}`)
        .eq('is_active', true)
        .or(ilikeFilters.join(','))
        .order('sort_order')
        .limit(10)
      if (partial) fallbackArticles = partial
    }

    const seen = new Set<number>()
    const unique = fallbackArticles.filter(a => {
      if (seen.has(a.id)) return false
      seen.add(a.id)
      return true
    })

    const scored = unique.map(a => {
      const text = `${a.question} ${a.keywords}`.toLowerCase()
      const matchCount = queryWords.filter(w => text.includes(w)).length
      return { article: a, score: matchCount }
    })
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)

    if (scored.length > 0 && scored[0].score < Math.ceil(queryWords.length / 2) && queryWords.length > 2) {
      return []
    }

    return scored.map(s => s.article)
  }

  async function handleCategoryClick(category: string) {
    if (!companyId) return
    setLoading(true)
    setShowChips(false)

    setMessages(prev => [...prev, { role: 'user', text: CATEGORIES.find(c => c.key === category)?.label || category }])

    const { data } = await supabase
      .from('help_articles')
      .select('id, category, question, answer, keywords, data_query')
      .or(`company_id.is.null,company_id.eq.${companyId}`)
      .eq('is_active', true)
      .eq('category', category)
      .order('sort_order')
      .limit(8)

    const articles = data || []
    if (articles.length > 0) {
      setMessages(prev => [...prev, {
        role: 'bot',
        text: `Here are the most common ${CATEGORIES.find(c => c.key === category)?.label?.toLowerCase() || category} questions:`,
        articles,
      }])
    } else {
      setMessages(prev => [...prev, {
        role: 'bot',
        text: `I don't have any articles for ${category} yet. Try asking a specific question or contact HR for help.`,
      }])
    }
    setLoading(false)
    scrollToBottom()
  }

  async function logSearch(searchQuery: string, matched: boolean, resultCount: number, topArticleId: number | null, aiGenerated = false) {
    if (!companyId || !employeeId) return
    supabase.from('help_search_logs').insert({
      company_id: companyId,
      employee_id: employeeId,
      query: searchQuery.slice(0, 500),
      matched,
      result_count: resultCount,
      top_article_id: topArticleId,
      ai_generated: aiGenerated,
    }).then()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const q = query.trim()
    if (!q || loading) return
    setQuery('')
    setLoading(true)
    setShowChips(false)

    setMessages(prev => [...prev, { role: 'user', text: q }])

    const articles = await searchArticles(q)

    if (articles.length > 0) {
      logSearch(q, true, articles.length, articles[0]?.id || null)
      setMessages(prev => [...prev, {
        role: 'bot',
        text: `I found ${articles.length} result${articles.length > 1 ? 's' : ''} that might help:`,
        articles,
      }])
    } else if (features.ai_help_agent && session) {
      try {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
        const res = await fetch(`${supabaseUrl}/functions/v1/ai-help-agent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
          body: JSON.stringify({ company_id: companyId, query: q }),
        })
        const data = await res.json()
        if (res.ok && data.answer) {
          logSearch(q, true, 0, null, true)
          setMessages(prev => [...prev, { role: 'bot', text: data.answer }])
        } else {
          logSearch(q, false, 0, null)
          setMessages(prev => [...prev, {
            role: 'bot',
            text: "Sorry, I couldn't find a related answer for that question. Try rephrasing with different keywords, browse a topic below, or contact your HR team directly for help.",
          }])
          setShowChips(true)
        }
      } catch {
        logSearch(q, false, 0, null)
        setMessages(prev => [...prev, {
          role: 'bot',
          text: "Sorry, I couldn't find a related answer for that question. Try rephrasing with different keywords, browse a topic below, or contact your HR team directly for help.",
        }])
        setShowChips(true)
      }
    } else {
      logSearch(q, false, 0, null)
      setMessages(prev => [...prev, {
        role: 'bot',
        text: "Sorry, I couldn't find a related answer for that question. Try rephrasing with different keywords, browse a topic below, or contact your HR team directly for help.",
      }])
      setShowChips(true)
    }
    setLoading(false)
    scrollToBottom()
  }

  async function handleArticleClick(article: HelpArticle) {
    if (expandedArticle === article.id) {
      setExpandedArticle(null)
      return
    }
    setExpandedArticle(article.id)
    if (!resolvedAnswers[article.id] && article.data_query && employeeId && companyId) {
      const resolved = await resolveAnswer(article, employeeId, companyId, currency)
      setResolvedAnswers(prev => ({ ...prev, [article.id]: resolved }))
    }
    setTimeout(() => {
      const el = document.querySelector(`[data-article-id="${article.id}"]`)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 100)
  }

  return (
    <>
      {isOpen && <div className="help-chat-overlay" onClick={() => setIsOpen(false)} />}

      {isOpen && (
        <div className="help-chat-panel">
          <div className="help-chat-header">
            <div className="help-chat-header-title">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              <span>{t('help.title') === 'help.title' ? 'Employee Help' : t('help.title')}</span>
            </div>
            <div className="help-chat-header-actions">
              {messages.length > 1 && (
                <button className="help-chat-new-btn" onClick={handleNewQuestion} aria-label="New question" title="Start new question">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
                  </svg>
                </button>
              )}
              <button className="help-chat-close" onClick={() => setIsOpen(false)} aria-label="Close">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          </div>

          <div className="help-chat-messages">
            {messages.map((msg, i) => (
              <div key={i} className={`help-chat-message help-chat-message-${msg.role}`}>
                {msg.role === 'bot' && (
                  <div className="help-chat-avatar">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                    </svg>
                  </div>
                )}
                <div className="help-chat-bubble">
                  <p>{msg.text}</p>
                  {msg.articles && msg.articles.length > 0 && (
                    <div className="help-chat-articles">
                      {msg.articles.map(article => (
                        <button
                          key={article.id}
                          data-article-id={article.id}
                          className={`help-chat-article-card ${expandedArticle === article.id ? 'expanded' : ''}`}
                          onClick={() => handleArticleClick(article)}
                        >
                          <div className="help-chat-article-question">
                            <span>{article.question}</span>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={expandedArticle === article.id ? 'rotated' : ''}>
                              <polyline points="6 9 12 15 18 9"/>
                            </svg>
                          </div>
                          {expandedArticle === article.id && (
                            <div className="help-chat-article-answer">
                              {(resolvedAnswers[article.id] || article.answer).split('\n').map((line, li) => (
                                <p key={li}>{line}</p>
                              ))}
                              {article.data_query && !resolvedAnswers[article.id] && (
                                <p className="help-chat-loading-data">Loading your data...</p>
                              )}
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {showChips && (
              <div className="help-chat-chips">
                {CATEGORIES.map(cat => (
                  <button key={cat.key} className="help-chat-chip" onClick={() => handleCategoryClick(cat.key)}>
                    {cat.label}
                  </button>
                ))}
              </div>
            )}

            {loading && (
              <div className="help-chat-message help-chat-message-bot">
                <div className="help-chat-avatar">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                  </svg>
                </div>
                <div className="help-chat-bubble">
                  <div className="help-chat-typing">
                    <span /><span /><span />
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          <form className="help-chat-input" onSubmit={handleSubmit}>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Type your question..."
              disabled={loading}
            />
            <button type="submit" disabled={!query.trim() || loading} aria-label="Send">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </button>
          </form>
        </div>
      )}

      {!isOpen && (
        <button className="help-chat-fab" onClick={handleOpen} aria-label="Open help chat">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </button>
      )}
    </>
  )
}
