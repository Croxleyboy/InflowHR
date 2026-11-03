import { useState, useRef, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useFeatures } from '../context/FeatureContext'
import { formatCurrency, formatDate, getFYRange } from '../lib/formatters'

const ASSISTANT_NAME = 'AI Assistant'

interface ChatMessage {
  role: 'bot' | 'user'
  text: string
  loading?: boolean
}

const STARTER_QUESTIONS = [
  'How many days of annual leave do I have left?',
  'What is the company policy on working from home?',
  'When is my next shift?',
  'How do I submit an expense claim?',
  'What benefits am I enrolled in?',
  'When is the next bank holiday?',
]

function renderMarkdown(text: string): string {
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>')
  html = html.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>')
  html = html.replace(/<\/ul>\s*<ul>/g, '')
  html = html.replace(/\n\n/g, '</p><p>')
  html = html.replace(/\n/g, '<br/>')
  if (!html.startsWith('<')) html = '<p>' + html + '</p>'
  return html
}

async function executeDataQuery(queryKey: string, employeeId: string, companyId: string, currency: string, params: Record<string, unknown> = {}): Promise<string> {
  switch (queryKey) {
    case 'get_leave_balance': {
      const { data: co } = await supabase.from('companies').select('fy_start_month').eq('id', companyId).single()
      const { fyYear, fyStart, fyEnd } = getFYRange(co?.fy_start_month || 4)
      const [balRes, reqRes] = await Promise.all([
        supabase.from('leave_balances')
          .select('leave_type_id, total_allowance, carried_over, lieu_days, leave_type:leave_type_id(name)')
          .eq('employee_id', employeeId)
          .eq('company_id', companyId)
          .eq('year', fyYear),
        supabase.from('leave_requests')
          .select('leave_type_id, days_requested')
          .eq('employee_id', employeeId)
          .eq('company_id', companyId)
          .eq('status', 'approved')
          .gte('start_date', fyStart)
          .lte('start_date', fyEnd)
      ])
      const data = balRes.data
      if (!data || data.length === 0) return 'No leave balance data found.'
      const usedByType = new Map<string, number>()
      for (const r of (reqRes.data || [])) {
        usedByType.set(r.leave_type_id, (usedByType.get(r.leave_type_id) || 0) + Number(r.days_requested))
      }
      const lines = data.map((b: any) => {
        const total = (b.total_allowance || 0) + (b.carried_over || 0) + (b.lieu_days || 0)
        const used = usedByType.get(b.leave_type_id) || 0
        const remaining = total - used
        const name = b.leave_type?.name || 'Leave'
        const parts = [`${b.total_allowance || 0} allowance`]
        if (b.carried_over) parts.push(`${b.carried_over} carried over`)
        if (b.lieu_days) parts.push(`${b.lieu_days} in lieu`)
        return `${name}: ${remaining} days remaining (${used} used of ${total} — ${parts.join(', ')})`
      })
      const totalRemaining = data.reduce((sum: number, b: any) => {
        const total = (b.total_allowance || 0) + (b.carried_over || 0) + (b.lieu_days || 0)
        return sum + total - (usedByType.get(b.leave_type_id) || 0)
      }, 0)
      const totalUsed = Array.from(usedByType.values()).reduce((s, v) => s + v, 0)
      lines.push(`\nTotal: ${totalRemaining} days remaining across all types (${totalUsed} used)`)
      return lines.join('\n')
    }
    case 'get_leave_requests': {
      let q = supabase
        .from('leave_requests')
        .select('start_date, end_date, status, days_requested, leave_type:leave_type_id(name)')
        .eq('employee_id', employeeId)
        .eq('company_id', companyId)
      if (params.start_date) q = q.gte('start_date', params.start_date as string)
      if (params.end_date) q = q.lte('end_date', params.end_date as string)
      if (params.status) q = q.eq('status', params.status as string)
      if (params.upcoming_only) q = q.gte('end_date', new Date().toISOString().split('T')[0])
      const { data } = await q.order('start_date').limit(10)
      if (!data || data.length === 0) return 'No leave requests found for that period.'
      const totalDays = data.reduce((sum: number, r: any) => sum + (Number(r.days_requested) || 0), 0)
      const lines = data.map((r: any) => {
        const name = r.leave_type?.name || 'Leave'
        return `${name}: ${formatDate(r.start_date)} to ${formatDate(r.end_date)} — ${r.status} (${r.days_requested} days)`
      })
      lines.push(`\nTotal: ${totalDays} days across ${data.length} request${data.length !== 1 ? 's' : ''}`)
      return lines.join('\n')
    }
    case 'get_expense_claims': {
      let q = supabase
        .from('expense_claims')
        .select('description, amount, status, submitted_at, category')
        .eq('employee_id', employeeId)
        .eq('company_id', companyId)
      if (params.start_date) q = q.gte('submitted_at', params.start_date as string)
      if (params.end_date) q = q.lte('submitted_at', (params.end_date as string) + 'T23:59:59')
      if (params.status === 'owed') {
        q = q.in('status', ['approved', 'processing'])
      } else if (params.status) {
        q = q.eq('status', params.status as string)
      }
      const { data } = await q.order('submitted_at', { ascending: false }).limit(20)
      if (!data || data.length === 0) return 'No expense claims found.'
      const total = data.reduce((sum: number, e: any) => sum + (Number(e.amount) || 0), 0)
      const lines = data.map((e: any) =>
        `${e.description || e.category || 'Expense'}: ${formatCurrency(Number(e.amount), currency)} — ${e.status}${e.submitted_at ? ` (${formatDate(e.submitted_at.split('T')[0])})` : ''}`
      )
      lines.push(`\nTotal: ${formatCurrency(total, currency)} across ${data.length} claim${data.length !== 1 ? 's' : ''}`)
      return lines.join('\n')
    }
    case 'get_next_shifts': {
      const startDate = (params.start_date as string) || new Date().toISOString().split('T')[0]
      const endDate = params.end_date as string | undefined
      const limit = Number(params.limit) || 50
      let query = supabase
        .from('shift_assignments')
        .select('date, rota_id, shift_template:shift_template_id(name, start_time, end_time)')
        .eq('employee_id', employeeId)
        .eq('company_id', companyId)
        .gte('date', startDate)
        .order('date')
        .limit(limit)
      if (endDate) query = query.lte('date', endDate)
      const { data: rawShifts } = await query
      if (!rawShifts || rawShifts.length === 0) return `No shifts found from ${formatDate(startDate)}${endDate ? ` to ${formatDate(endDate)}` : ''}.`
      const rotaIds = [...new Set(rawShifts.map((s: any) => s.rota_id).filter(Boolean))]
      let publishedRotaIds = new Set<string>()
      if (rotaIds.length > 0) {
        const { data: rotas } = await supabase
          .from('rotas')
          .select('id')
          .eq('company_id', companyId)
          .eq('status', 'published')
          .in('id', rotaIds)
        publishedRotaIds = new Set((rotas || []).map((r: any) => r.id))
      }
      const data = rawShifts.filter((s: any) => !s.rota_id || publishedRotaIds.has(s.rota_id))
      if (data.length === 0) return `No published shifts found from ${formatDate(startDate)}${endDate ? ` to ${formatDate(endDate)}` : ''}.`
      const lines = data.map((s: any) => {
        const t = s.shift_template as any
        return `${formatDate(s.date)} — ${t?.name || 'Shift'} (${t?.start_time?.slice(0, 5) || '?'} to ${t?.end_time?.slice(0, 5) || '?'})`
      })
      lines.push(`\nTotal: ${data.length} shift${data.length !== 1 ? 's' : ''} from ${formatDate(startDate)}${endDate ? ` to ${formatDate(endDate)}` : ''}`)
      return lines.join('\n')
    }
    case 'get_hours_worked': {
      let startDate = params.start_date as string | undefined
      let endDate = params.end_date as string | undefined
      if (!startDate) {
        const now = new Date()
        const dayOfWeek = now.getDay()
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
        const monday = new Date(now)
        monday.setDate(now.getDate() + mondayOffset)
        startDate = monday.toISOString().split('T')[0]
      }
      if (!endDate) endDate = new Date().toISOString().split('T')[0]
      const { data } = await supabase
        .from('timesheets')
        .select('date, hours')
        .eq('employee_id', employeeId)
        .eq('company_id', companyId)
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date')
      if (!data || data.length === 0) return 'No timesheet entries found for that period.'
      const total = data.reduce((sum: number, t: any) => sum + (Number(t.hours) || 0), 0)
      const lines = data.map((t: any) => `${formatDate(t.date)} — ${Number(t.hours).toFixed(1)} hours`)
      lines.push(`\nTotal: ${total.toFixed(1)} hours across ${data.length} ${data.length !== 1 ? 'entries' : 'entry'} (${formatDate(startDate)} to ${formatDate(endDate)})`)
      return lines.join('\n')
    }
    case 'get_payslip_summary': {
      const count = Math.min(Number(params.count) || 1, 3)
      const { data } = await supabase
        .from('payslips')
        .select('pay_period_start, pay_period_end, gross_pay, net_pay, payment_date, tax, national_insurance, pension')
        .eq('employee_id', employeeId)
        .eq('company_id', companyId)
        .order('payment_date', { ascending: false })
        .limit(count)
      if (!data || data.length === 0) return 'No payslip data found.'
      return data.map((p: any, i: number) => {
        const header = data.length > 1 ? `Payslip ${i + 1}:\n` : ''
        return header + [
          `Period: ${formatDate(p.pay_period_start)} to ${formatDate(p.pay_period_end)}`,
          `Gross Pay: ${formatCurrency(Number(p.gross_pay), currency)}`,
          `Tax: ${formatCurrency(Number(p.tax), currency)}`,
          `NI: ${formatCurrency(Number(p.national_insurance), currency)}`,
          `Pension: ${formatCurrency(Number(p.pension), currency)}`,
          `Net Pay: ${formatCurrency(Number(p.net_pay), currency)}`,
          `Paid: ${formatDate(p.payment_date)}`,
        ].join('\n')
      }).join('\n\n')
    }
    case 'get_my_profile': {
      const { data } = await supabase
        .from('employees')
        .select('first_name, last_name, job_title, department, start_date, manager_id')
        .eq('id', employeeId)
        .eq('company_id', companyId)
        .single()
      if (!data) return 'Profile information not available.'
      const lines = [
        `Name: ${data.first_name} ${data.last_name}`,
        `Job Title: ${data.job_title || 'Not set'}`,
        `Department: ${data.department || 'Not set'}`,
        data.start_date ? `Start Date: ${formatDate(data.start_date)}` : null,
      ]
      if (data.manager_id) {
        const { data: mgr } = await supabase
          .from('employees')
          .select('first_name, last_name, job_title')
          .eq('id', data.manager_id)
          .single()
        if (mgr) lines.push(`Manager: ${mgr.first_name} ${mgr.last_name}${mgr.job_title ? ` (${mgr.job_title})` : ''}`)
      } else {
        lines.push('Manager: Not assigned')
      }
      return lines.filter(Boolean).join('\n')
    }
    case 'get_benefits': {
      const { data } = await supabase
        .from('employee_benefits')
        .select('benefit:benefit_id(name, description), enrolled_at')
        .eq('employee_id', employeeId)
        .eq('company_id', companyId)
      if (!data || data.length === 0) return 'No benefits enrolled.'
      const lines = data.map((b: any) => {
        const name = b.benefit?.name || 'Benefit'
        const enrolled = b.enrolled_at ? ` (enrolled ${formatDate(b.enrolled_at.split('T')[0])})` : ''
        return `${name}${b.benefit?.description ? ` — ${b.benefit.description}` : ''}${enrolled}`
      })
      lines.push(`\nTotal: ${data.length} benefit${data.length !== 1 ? 's' : ''} enrolled`)
      return lines.join('\n')
    }
    case 'get_elearning_progress': {
      const { data } = await supabase
        .from('elearning_enrolments')
        .select('status, progress_pct, course:course_id(title)')
        .eq('employee_id', employeeId)
        .eq('company_id', companyId)
      if (!data || data.length === 0) return 'No e-learning courses assigned.'
      const lines = data.map((e: any) => {
        const title = e.course?.title || 'Course'
        const pct = e.progress_pct != null ? `${e.progress_pct}%` : e.status
        return `${title}: ${pct} (${e.status || 'enrolled'})`
      })
      const completed = data.filter((e: any) => e.status === 'completed').length
      lines.push(`\n${completed} of ${data.length} course${data.length !== 1 ? 's' : ''} completed`)
      return lines.join('\n')
    }
    case 'get_upcoming_holidays': {
      let q = supabase
        .from('company_holidays')
        .select('name, date')
        .eq('company_id', companyId)
      if (params.upcoming_only !== false) q = q.gte('date', new Date().toISOString().split('T')[0])
      const { data } = await q.order('date').limit(10)
      if (!data || data.length === 0) return 'No upcoming company holidays found.'
      const lines = data.map((h: any) => `${formatDate(h.date)} — ${h.name}`)
      lines.push(`\n${data.length} holiday${data.length !== 1 ? 's' : ''} listed`)
      return lines.join('\n')
    }
    default:
      return ''
  }
}

export default function EnterpriseAIChat() {
  const { employeeId, employeeName, companyUser, company, session } = useAuth()
  const { features } = useFeatures()

  const [isOpen, setIsOpen] = useState(false)
  const [isClosing, setIsClosing] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const [feedback, setFeedback] = useState<Record<number, 'up' | 'down'>>({})
  const [userScrolled, setUserScrolled] = useState(false)
  const [isDocked, setIsDocked] = useState(() => {
    try { return localStorage.getItem('eai-docked') === '1' } catch { return false }
  })

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesAreaRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const fabRef = useRef<HTMLButtonElement>(null)
  const touchStartY = useRef(0)

  const companyId = companyUser?.company_id
  const currency = company?.currency || 'GBP'
  const firstName = employeeName?.split(' ')[0] || ''

  const [layoutMode, setLayoutMode] = useState<'mobile' | 'tablet' | 'desktop'>('desktop')

  useEffect(() => {
    function check() {
      const w = window.innerWidth
      setLayoutMode(w < 640 ? 'mobile' : w < 1024 ? 'tablet' : 'desktop')
    }
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  const isDesktop = layoutMode === 'desktop'

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsClosing(true)
      if (layoutMode === 'mobile') document.body.style.overflow = ''
      setTimeout(() => {
        setIsOpen(false)
        setIsClosing(false)
        fabRef.current?.focus()
      }, 220)
    }
  }, [layoutMode])

  useEffect(() => {
    if (!isOpen) return
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, handleKeyDown])

  if (!features.enterprise_ai || !features.employee_help) return null

  function scrollToBottom() {
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
  }

  function jumpToBottom() {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    setUserScrolled(false)
  }

  function handleScroll() {
    if (!messagesAreaRef.current) return
    const el = messagesAreaRef.current
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    setUserScrolled(!atBottom)
  }

  function handleOpen() {
    setIsOpen(true)
    setIsClosing(false)
    if (messages.length === 0) {
      setMessages([{
        role: 'bot',
        text: `Hi ${firstName}! I'm your company's AI assistant. I have full access to company policies, your leave types, benefits, and can look up your personal HR data. Ask me anything!`,
      }])
    }
    setTimeout(() => inputRef.current?.focus(), 300)
    if (layoutMode === 'mobile') document.body.style.overflow = 'hidden'
  }

  function handleClose() {
    setIsClosing(true)
    if (layoutMode === 'mobile') document.body.style.overflow = ''
    setTimeout(() => {
      setIsOpen(false)
      setIsClosing(false)
      fabRef.current?.focus()
    }, 220)
  }

  function handleNewChat() {
    setMessages([{
      role: 'bot',
      text: `Hi ${firstName}! I'm your company's AI assistant. I have full access to company policies, your leave types, benefits, and can look up your personal HR data. Ask me anything!`,
    }])
    setFeedback({})
    setCopiedIdx(null)
    setUserScrolled(false)
    setTimeout(() => inputRef.current?.focus(), 100)
  }

  function toggleDock() {
    const next = !isDocked
    setIsDocked(next)
    try { localStorage.setItem('eai-docked', next ? '1' : '0') } catch { /* */ }
  }

  function handleHeaderTouchStart(e: React.TouchEvent) {
    touchStartY.current = e.touches[0].clientY
  }
  function handleHeaderTouchEnd(e: React.TouchEvent) {
    const diff = e.changedTouches[0].clientY - touchStartY.current
    if (diff > 60) handleClose()
  }

  async function handleSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault()
    const q = query.trim()
    if (!q || loading || !session || !companyId) return
    setQuery('')
    setLoading(true)

    setMessages(prev => [...prev, { role: 'user', text: q }])

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
      const res = await fetch(`${supabaseUrl}/functions/v1/enterprise-ai-agent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ company_id: companyId, query: q }),
      })
      const data = await res.json()

      if (res.ok && data.tool_call && employeeId && companyId) {
        const result = await executeDataQuery(data.tool_call, employeeId, companyId, currency, data.params || {})
        if (result) {
          const followUpRes = await fetch(`${supabaseUrl}/functions/v1/enterprise-ai-agent`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              company_id: companyId,
              query: `The employee asked: "${q}"\n\nHere is the data from their HR records:\n${result}\n\nPlease provide a helpful, conversational answer using this data. Address them by their first name.`,
            }),
          })
          const followUpData = await followUpRes.json()
          if (followUpRes.ok && followUpData.answer) {
            setMessages(prev => [...prev, { role: 'bot', text: followUpData.answer }])
          } else {
            setMessages(prev => [...prev, { role: 'bot', text: result }])
          }
        } else {
          setMessages(prev => [...prev, { role: 'bot', text: "I looked that up but couldn't find any data. Try rephrasing your question or contact your HR team for help." }])
        }
      } else if (res.ok && data.answer) {
        setMessages(prev => [...prev, { role: 'bot', text: data.answer }])
      } else {
        const errorMsg = data.error || "Sorry, I couldn't process that request. Please try again shortly."
        setMessages(prev => [...prev, { role: 'bot', text: errorMsg }])
      }
    } catch {
      setMessages(prev => [...prev, { role: 'bot', text: "Sorry, I couldn't reach the AI service. Please try again shortly." }])
    }
    setLoading(false)
    scrollToBottom()
  }

  function handleStarterClick(question: string) {
    setQuery(question)
    setTimeout(() => {
      setQuery('')
      setLoading(true)
      setMessages(prev => [...prev, { role: 'user', text: question }])
      handleSubmitDirect(question)
    }, 50)
  }

  async function handleSubmitDirect(q: string) {
    if (!session || !companyId) return
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
      const res = await fetch(`${supabaseUrl}/functions/v1/enterprise-ai-agent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ company_id: companyId, query: q }),
      })
      const data = await res.json()

      if (res.ok && data.tool_call && employeeId && companyId) {
        const result = await executeDataQuery(data.tool_call, employeeId, companyId, currency, data.params || {})
        if (result) {
          const followUpRes = await fetch(`${supabaseUrl}/functions/v1/enterprise-ai-agent`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              company_id: companyId,
              query: `The employee asked: "${q}"\n\nHere is the data from their HR records:\n${result}\n\nPlease provide a helpful, conversational answer using this data. Address them by their first name.`,
            }),
          })
          const followUpData = await followUpRes.json()
          if (followUpRes.ok && followUpData.answer) {
            setMessages(prev => [...prev, { role: 'bot', text: followUpData.answer }])
          } else {
            setMessages(prev => [...prev, { role: 'bot', text: result }])
          }
        } else {
          setMessages(prev => [...prev, { role: 'bot', text: "I looked that up but couldn't find any data. Try rephrasing your question or contact your HR team for help." }])
        }
      } else if (res.ok && data.answer) {
        setMessages(prev => [...prev, { role: 'bot', text: data.answer }])
      } else {
        const errorMsg = data.error || "Sorry, I couldn't process that request. Please try again shortly."
        setMessages(prev => [...prev, { role: 'bot', text: errorMsg }])
      }
    } catch {
      setMessages(prev => [...prev, { role: 'bot', text: "Sorry, I couldn't reach the AI service. Please try again shortly." }])
    }
    setLoading(false)
    scrollToBottom()
  }

  function handleCopyMessage(text: string, idx: number) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedIdx(idx)
      setTimeout(() => setCopiedIdx(null), 2000)
    }).catch(() => {})
  }

  function handleTextareaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  function autoGrowTextarea(el: HTMLTextAreaElement) {
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }

  const panelClass = [
    'eai-panel',
    `eai-${layoutMode}`,
    isDocked ? 'eai-docked' : '',
    isClosing ? 'eai-closing' : 'eai-opening',
  ].filter(Boolean).join(' ')

  const overlayClass = `eai-overlay ${isClosing ? 'eai-overlay-closing' : 'eai-overlay-opening'}`

  const showStarters = messages.length <= 1

  return (
    <>
      {isOpen && <div className={overlayClass} onClick={handleClose} />}

      {isOpen && (
        <div
          ref={panelRef}
          className={panelClass}
          role="dialog"
          aria-modal="true"
          aria-label={ASSISTANT_NAME}
        >
          {/* Header */}
          <div
            className="eai-header"
            onTouchStart={handleHeaderTouchStart}
            onTouchEnd={handleHeaderTouchEnd}
          >
            {layoutMode === 'mobile' && <div className="eai-handle" />}
            <div className="eai-header-left">
              <div className="eai-header-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a4 4 0 0 1 4 4c0 1.95-1.4 3.58-3.25 3.93"/>
                  <path d="M8.24 4.77A4 4 0 0 1 12 2"/>
                  <path d="M14 10.5V19a2 2 0 0 1-4 0v-8.5"/>
                  <circle cx="12" cy="6" r="1"/>
                </svg>
              </div>
              <div className="eai-header-info">
                <span className="eai-header-name">{ASSISTANT_NAME}</span>
                <span className="eai-header-status">
                  <span className="eai-status-dot" />
                  Powered by your company's AI
                </span>
              </div>
            </div>
            <div className="eai-header-actions">
              {messages.length > 1 && (
                <button className="eai-header-btn" onClick={handleNewChat} aria-label="New chat" title="New chat">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
                  </svg>
                </button>
              )}
              {isDesktop && (
                <button className="eai-header-btn" onClick={toggleDock} aria-label={isDocked ? 'Centre panel' : 'Dock to side'} title={isDocked ? 'Centre panel' : 'Dock to side'}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    {isDocked ? (
                      <><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="3" x2="12" y2="21"/></>
                    ) : (
                      <><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="15" y1="3" x2="15" y2="21"/></>
                    )}
                  </svg>
                </button>
              )}
              <button className="eai-header-btn" onClick={handleClose} aria-label="Close" title="Close">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          </div>

          <div className="eai-body">
            <div className="eai-main">
              {/* Messages area */}
              <div className="eai-messages" ref={messagesAreaRef} onScroll={handleScroll}>
                <div aria-live="polite" aria-atomic="false" className="eai-sr-only" />

                {messages.map((msg, i) => (
                  <div key={i} className={`eai-msg eai-msg-${msg.role}`}>
                    {msg.role === 'bot' && (
                      <div className="eai-msg-avatar">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 2a4 4 0 0 1 4 4c0 1.95-1.4 3.58-3.25 3.93"/>
                          <path d="M8.24 4.77A4 4 0 0 1 12 2"/>
                          <path d="M14 10.5V19a2 2 0 0 1-4 0v-8.5"/>
                          <circle cx="12" cy="6" r="1"/>
                        </svg>
                      </div>
                    )}
                    <div className={`eai-msg-content ${msg.role === 'user' ? 'eai-msg-user-bubble' : 'eai-msg-bot-card'}`}>
                      <div
                        className="eai-msg-text"
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.text) }}
                      />

                      {msg.role === 'bot' && i > 0 && (
                        <div className="eai-msg-actions">
                          <button
                            className="eai-msg-action-btn"
                            onClick={() => handleCopyMessage(msg.text, i)}
                            title="Copy"
                            aria-label="Copy answer"
                          >
                            {copiedIdx === i ? (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                            ) : (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                            )}
                          </button>
                          <button
                            className={`eai-msg-action-btn ${feedback[i] === 'up' ? 'eai-feedback-active' : ''}`}
                            onClick={() => setFeedback(prev => ({ ...prev, [i]: 'up' }))}
                            title="Helpful"
                            aria-label="Mark as helpful"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill={feedback[i] === 'up' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
                          </button>
                          <button
                            className={`eai-msg-action-btn ${feedback[i] === 'down' ? 'eai-feedback-active' : ''}`}
                            onClick={() => setFeedback(prev => ({ ...prev, [i]: 'down' }))}
                            title="Not helpful"
                            aria-label="Mark as not helpful"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill={feedback[i] === 'down' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {showStarters && (
                  <div className="eai-starters">
                    <p className="eai-starters-label">Try asking:</p>
                    <div className="eai-starters-grid">
                      {STARTER_QUESTIONS.map((sq, i) => (
                        <button
                          key={i}
                          className="eai-starter-btn"
                          onClick={() => handleStarterClick(sq)}
                          disabled={loading}
                        >
                          {sq}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {loading && (
                  <div className="eai-msg eai-msg-bot">
                    <div className="eai-msg-avatar">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 2a4 4 0 0 1 4 4c0 1.95-1.4 3.58-3.25 3.93"/>
                        <path d="M8.24 4.77A4 4 0 0 1 12 2"/>
                        <path d="M14 10.5V19a2 2 0 0 1-4 0v-8.5"/>
                        <circle cx="12" cy="6" r="1"/>
                      </svg>
                    </div>
                    <div className="eai-msg-content eai-msg-bot-card">
                      <div className="eai-typing">
                        <span /><span /><span />
                      </div>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Jump to bottom */}
              {userScrolled && (
                <button className="eai-jump-btn" onClick={jumpToBottom} aria-label="Jump to latest message">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                  New message
                </button>
              )}

              {/* Input */}
              <div className="eai-input-area">
                <form className="eai-input-form" onSubmit={handleSubmit}>
                  <textarea
                    ref={inputRef}
                    className="eai-textarea"
                    value={query}
                    onChange={e => { setQuery(e.target.value); autoGrowTextarea(e.target) }}
                    onKeyDown={handleTextareaKeyDown}
                    placeholder="Ask me anything..."
                    maxLength={1000}
                    disabled={loading}
                    rows={1}
                  />
                  <button
                    type="submit"
                    className="eai-send-btn"
                    disabled={!query.trim() || loading}
                    aria-label="Send"
                    title="Send"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                    </svg>
                  </button>
                </form>
                {isDesktop && (
                  <div className="eai-input-hint">Enter to send · Shift + Enter for a new line · Esc to close</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {!isOpen && (
        <button ref={fabRef} className="eai-fab" onClick={handleOpen} aria-label={`Open ${ASSISTANT_NAME}`}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a4 4 0 0 1 4 4c0 1.95-1.4 3.58-3.25 3.93"/>
            <path d="M8.24 4.77A4 4 0 0 1 12 2"/>
            <path d="M14 10.5V19a2 2 0 0 1-4 0v-8.5"/>
            <circle cx="12" cy="6" r="1"/>
          </svg>
        </button>
      )}
    </>
  )
}
